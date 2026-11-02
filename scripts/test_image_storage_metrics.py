"""Synthetic Docker-save fixtures; no daemon, image build, or subprocess needed."""

import gzip
import hashlib
import io
import json
import tarfile
import unittest
from unittest.mock import patch

from image_storage_metrics import METADATA_LIMIT, main, read_image_archive, summarize_pairs


def digest(payload):
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def archive_bytes(members):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        for name, payload in members:
            member = tarfile.TarInfo(name)
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))
    return stream.getvalue()


def fixture(images, *, blobs=False, manifest_first=False, compressed=False):
    """images is [(tag, [raw layer payloads])]; identical members are shared."""
    members = {}
    manifest = []
    for tag, layers in images:
        config = json.dumps({"rootfs": {"type": "layers", "diff_ids": [digest(layer) for layer in layers]}, "config": {"Env": ["PRIVATE_SENTINEL=not-output"]}}, sort_keys=True).encode()
        config_hash = digest(config).split(":")[1]
        config_name = f"blobs/sha256/{config_hash}" if blobs else f"{config_hash}.json"
        members[config_name] = config
        paths = []
        for layer in layers:
            if compressed:
                layer = gzip.compress(layer, mtime=0)
            layer_hash = digest(layer).split(":")[1]
            name = f"blobs/sha256/{layer_hash}" if blobs else f"{layer_hash}/layer.tar"
            paths.append(name)
            members[name] = layer
        manifest.append({"Config": config_name, "RepoTags": [tag], "Layers": paths})
    manifest_member = ("manifest.json", json.dumps(manifest).encode())
    ordered = list(members.items())
    return [manifest_member, *ordered] if manifest_first else [*ordered, manifest_member]


def image_manifest(members, mutate=None, *, docker=False):
    """Add the original content-addressed manifest carried by containerd save."""
    contents = dict(members)
    entry = json.loads(contents["manifest.json"])[0]
    def descriptor(name, media_type):
        return {"mediaType": media_type, "digest": digest(contents[name]), "size": len(contents[name])}
    manifest = {
        "schemaVersion": 2,
        "mediaType": ("application/vnd.docker.distribution.manifest.v2+json" if docker
                      else "application/vnd.oci.image.manifest.v1+json"),
        "config": descriptor(entry["Config"], "application/vnd.docker.container.image.v1+json" if docker
                             else "application/vnd.oci.image.config.v1+json"),
        "layers": [descriptor(name, "application/vnd.oci.image.layer.v1.tar+gzip" if contents[name].startswith(b"\x1f\x8b")
                              else "application/vnd.oci.image.layer.v1.tar") for name in entry["Layers"]],
    }
    if mutate:
        mutate(manifest)
    raw = json.dumps(manifest, sort_keys=True).encode()
    return ("blobs/sha256/" + digest(raw)[7:], raw)


class ImageStorageMetricsTests(unittest.TestCase):
    def read(self, members):
        return read_image_archive(io.BytesIO(archive_bytes(members)))

    def test_legacy_and_blob_paths_and_either_manifest_order(self):
        for blobs in (False, True):
            for first in (False, True):
                with self.subTest(blobs=blobs, manifest_first=first):
                    images = self.read(fixture([("base:a", [b"common", b"app-a"])], blobs=blobs, manifest_first=first))
                    self.assertEqual(images["base:a"]["exported_layer_payload_bytes"], 11)
                    self.assertEqual(images["base:a"]["layers"][0]["chain_id"], digest(b"common"))
                    self.assertNotIn("PRIVATE_SENTINEL", json.dumps(images))
                    self.assertEqual(images["base:a"]["manifest_digests"], [])

    def test_manifest_proof_binds_config_and_ordered_payloads(self):
        for docker in (False, True):
            for compressed in (False, True):
                for layers in ([], [b"common", b"app-a"]):
                    members = fixture([("base:a", layers)], blobs=True, compressed=compressed)
                    proof = image_manifest(members, docker=docker)
                    for reverse in (False, True):
                        ordered = [*members, proof]
                        if reverse:
                            ordered.reverse()
                        with self.subTest(docker=docker, compressed=compressed, layers=layers, reverse=reverse):
                            image = self.read(ordered)["base:a"]
                            self.assertEqual(image["manifest_digests"], [digest(proof[1])])
                            self.assertEqual([layer["diff_id"] for layer in image["layers"]], [digest(layer) for layer in layers])
                            self.assertNotIn("PRIVATE_SENTINEL", json.dumps(image))

    def test_manifest_hash_and_referenced_payloads_are_verified(self):
        members = fixture([("base:a", [b"a"])], blobs=True, compressed=True)
        proof = image_manifest(members)
        with self.assertRaisesRegex(ValueError, "manifest blob identity"):
            self.read([*members, (proof[0], proof[1] + b" ")])
        for target in (0, 1):
            changed = list(members)
            changed[target] = (changed[target][0], changed[target][1] + b"changed")
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, "descriptor payload"):
                self.read([*changed, proof])
            with self.subTest(missing=target), self.assertRaisesRegex(ValueError, "descriptor payload"):
                self.read([*members[:target], *members[target + 1:], proof])

    def test_manifest_descriptor_sizes_and_digests_fail_closed(self):
        members = fixture([("base:a", [b"a"])], blobs=True)
        for target in ("config", "layer"):
            for field, value in (("size", -1), ("size", True), ("size", 999),
                                 ("digest", "sha256:invalid"), ("digest", digest(b"absent"))):
                def mutate(manifest):
                    descriptor = manifest["config"] if target == "config" else manifest["layers"][0]
                    descriptor[field] = value
                with self.subTest(target=target, field=field, value=value), self.assertRaisesRegex(ValueError, "descriptor"):
                    self.read([*members, image_manifest(members, mutate)])

    def test_manifest_proof_requires_exact_layer_order_and_count(self):
        members = fixture([("base:a", [b"a", b"b"])], blobs=True, compressed=True)
        for replacement in (lambda layers: layers[::-1], lambda layers: layers[:1],
                            lambda layers: layers + layers[:1], lambda layers: [layers[0], layers[0]]):
            def mutate(manifest):
                manifest["layers"] = replacement(manifest["layers"])
            image = self.read([*members, image_manifest(members, mutate)])["base:a"]
            self.assertEqual(image["manifest_digests"], [])

    def test_config_substitution_cannot_borrow_manifest_with_same_diff_ids(self):
        members = fixture([("base:a", [b"a"])], blobs=True)
        proof = image_manifest(members)
        config = json.loads(members[0][1])
        config["config"]["Env"] = ["OTHER_PRIVATE_SENTINEL=not-output"]
        raw = json.dumps(config).encode()
        name = "blobs/sha256/" + digest(raw)[7:]
        manifest = json.loads(members[-1][1])
        manifest[0]["Config"] = name
        members[-1] = ("manifest.json", json.dumps(manifest).encode())
        image = self.read([*members, (name, raw), proof])["base:a"]
        self.assertEqual(image["config_digest"], digest(raw))
        self.assertEqual(image["manifest_digests"], [])
        self.assertNotIn("PRIVATE_SENTINEL", json.dumps(image))

    def test_compressed_layer_substitution_cannot_borrow_manifest_with_same_config(self):
        members = fixture([("base:a", [b"a"])], blobs=True, compressed=True)
        proof = image_manifest(members)
        replacement = gzip.compress(b"a", mtime=1)
        self.assertEqual(len(replacement), len(members[1][1]))
        name = "blobs/sha256/" + digest(replacement)[7:]
        manifest = json.loads(members[-1][1])
        manifest[0]["Layers"] = [name]
        members[-1] = ("manifest.json", json.dumps(manifest).encode())
        image = self.read([*members, (name, replacement), proof])["base:a"]
        self.assertEqual(image["manifest_digests"], [])

    def test_missing_manifest_and_non_manifest_json_cannot_grant_proof(self):
        members = fixture([("base:a", [b"a"])], blobs=True)
        for media_type in ("application/vnd.oci.image.index.v1+json", "unrelated", None, []):
            def mutate(manifest):
                manifest["mediaType"] = media_type
            image = self.read([*members, image_manifest(members, mutate)])["base:a"]
            self.assertEqual(image["manifest_digests"], [])
        self.assertEqual(self.read(members)["base:a"]["manifest_digests"], [])

    def test_invalid_manifest_structure_cannot_grant_proof(self):
        members = fixture([("base:a", [b"a"])], blobs=True)
        for field, value in (("schemaVersion", 1), ("schemaVersion", "2"),
                             ("config", []), ("layers", None), ("layers", [None])):
            def mutate(manifest):
                manifest[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                self.read([*members, image_manifest(members, mutate)])

    def test_pair_unions_distinguish_content_from_parent_chains(self):
        images = self.read(fixture([
            ("base:a", [b"a", b"shared"]),
            ("base:b", [b"b", b"shared"]),
            ("candidate:a", [b"shared", b"a"]),
            ("candidate:b", [b"shared", b"b"]),
        ]))
        result = summarize_pairs(images, ["base:a", "base:b"], ["candidate:a", "candidate:b"])
        self.assertEqual(result["baseline"]["unique_content_payload_bytes"], 8)
        self.assertEqual(result["baseline"]["chain_key_weighted_payload_bytes"], 14)
        self.assertEqual(result["candidate"]["chain_key_weighted_payload_bytes"], 8)
        self.assertEqual(result["candidate_minus_baseline_bytes"]["chain_key_weighted_payload_bytes"], -6)
        self.assertEqual(result["single_image_candidate_minus_baseline_bytes"], [0, 0])
        self.assertIn("neither", result["metric_scope"])

    def test_multiple_tags_for_same_image(self):
        members = fixture([("base:a", [b"a"])])
        manifest = json.loads(members[-1][1])
        manifest[0]["RepoTags"].append("base:b")
        members[-1] = ("manifest.json", json.dumps(manifest).encode())
        images = self.read(members)
        self.assertEqual(images["base:a"], images["base:b"])

    def test_empty_image(self):
        images = self.read(fixture([("base:a", [])]))
        self.assertEqual(images["base:a"]["exported_layer_payload_bytes"], 0)

    def test_duplicate_members_are_rejected(self):
        members = fixture([("base:a", [b"a"])])
        with self.assertRaisesRegex(ValueError, "Duplicate archive member"):
            self.read([*members, members[0]])

    def test_duplicate_tags_are_rejected(self):
        members = fixture([("base:a", [b"a"])])
        manifest = json.loads(members[-1][1])
        manifest[0]["RepoTags"].append("base:a")
        members[-1] = ("manifest.json", json.dumps(manifest).encode())
        with self.assertRaisesRegex(ValueError, "Duplicate manifest image tag"):
            self.read(members)

    def test_missing_manifest_config_and_layer_are_rejected(self):
        members = fixture([("base:a", [b"a"])])
        for omitted in range(len(members)):
            with self.subTest(omitted=omitted), self.assertRaises(ValueError):
                self.read(members[:omitted] + members[omitted + 1:])

    def test_truncated_payload_is_rejected(self):
        data = archive_bytes(fixture([("base:a", [b"a" * 8192])], manifest_first=True))
        with self.assertRaises(ValueError):
            read_image_archive(io.BytesIO(data[:3000]))

    def test_invalid_config_digest_and_layer_digest_are_rejected(self):
        members = fixture([("base:a", [b"a"])])
        for target in (0, 1):
            changed = list(members)
            changed[target] = (changed[target][0], changed[target][1] + b"changed")
            with self.subTest(target=target), self.assertRaises(ValueError):
                self.read(changed)

    def test_invalid_blob_payload_identity_is_rejected(self):
        members = fixture([("base:a", [b"a"])], blobs=True)
        members[1] = (members[1][0], b"changed-layer")
        with self.assertRaisesRegex(ValueError, "layer blob identity"):
            self.read(members)

    def test_malformed_rootfs_and_diff_id_metadata_is_rejected(self):
        for rootfs in (None, {"type": "other", "diff_ids": []},
                       {"type": "layers", "diff_ids": ["sha256:wrong"]},
                       {"type": "layers", "diff_ids": "not-an-array"}):
            members = fixture([("base:a", [b"a"])])
            config = json.dumps({"rootfs": rootfs}).encode()
            config_name = digest(config).split(":")[1] + ".json"
            manifest = json.loads(members[-1][1])
            manifest[0]["Config"] = config_name
            members[0] = (config_name, config)
            members[-1] = ("manifest.json", json.dumps(manifest).encode())
            with self.subTest(rootfs=rootfs), self.assertRaises(ValueError):
                self.read(members)

    def test_manifest_layer_count_and_missing_tag_are_rejected(self):
        for key, replacement in (("Layers", []), ("RepoTags", []), ("Config", "../escape.json")):
            members = fixture([("base:a", [b"a"])])
            manifest = json.loads(members[-1][1])
            manifest[0][key] = replacement
            members[-1] = ("manifest.json", json.dumps(manifest).encode())
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.read(members)

    def test_duplicate_json_keys_are_rejected(self):
        with self.assertRaises(ValueError):
            self.read([("manifest.json", b'[{"Config":"a","Config":"b"}]')])

    def test_metadata_limit_is_enforced(self):
        with self.assertRaisesRegex(ValueError, "metadata limit"):
            self.read([("manifest.json", b" " * (METADATA_LIMIT + 1))])

    def test_extended_tar_metadata_is_bounded_before_reading(self):
        member = tarfile.TarInfo("extended")
        member.type = tarfile.XHDTYPE
        member.size = METADATA_LIMIT + 1
        # A header alone suffices: the parser must reject its declared metadata
        # size before trying to allocate/read the deliberately absent payload.
        data = member.tobuf() + b"\x00" * 1024
        with self.assertRaisesRegex(ValueError, "metadata limit"):
            read_image_archive(io.BytesIO(data))

    def test_unsafe_paths_and_archive_links_are_rejected(self):
        for name in ("/absolute", "../parent", "a/../parent", "a\\b", "a//b"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.read([(name, b"data")])
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as archive:
            member = tarfile.TarInfo("linked")
            member.type = tarfile.SYMTYPE
            member.linkname = "target"
            archive.addfile(member)
        with self.assertRaises(ValueError):
            read_image_archive(io.BytesIO(stream.getvalue()))

    def test_same_diff_id_with_different_compressed_payload_sizes_is_rejected(self):
        members = {}
        manifest = []
        for index, raw in enumerate((b"a", b"a" * 1000)):
            payload = gzip.compress(raw, mtime=0)
            name = "blobs/sha256/" + digest(payload).split(":")[1]
            config = json.dumps({"rootfs": {"type": "layers", "diff_ids": [digest(b"claimed-common-content")]}}).encode()
            config_name = digest(config).split(":")[1] + ".json"
            members[name] = payload
            members[config_name] = config
            manifest.append({"Config": config_name, "RepoTags": [f"image:{index}"], "Layers": [name]})
        with self.assertRaisesRegex(ValueError, "Inconsistent exported payload sizes"):
            self.read([*members.items(), ("manifest.json", json.dumps(manifest).encode())])

    def test_missing_pair_tag_and_duplicate_pair_tag_are_rejected(self):
        images = self.read(fixture([("base:a", [b"a"]), ("base:b", [b"b"])]))
        for tags in (["base:a", "missing:tag"], ["base:a", "base:a"]):
            with self.subTest(tags=tags), self.assertRaises(ValueError):
                summarize_pairs(images, ["base:a", "base:b"], tags)

    def test_cli_saves_report_before_failing_growth_gate(self):
        data = archive_bytes(fixture([
            ("base:a", [b"shared", b"a"]),
            ("base:b", [b"shared", b"b"]),
            ("candidate:a", [b"shared", b"larger-a"]),
            ("candidate:b", [b"shared", b"larger-b"]),
        ]))
        class Child:
            stdout = io.BytesIO(data)
            def wait(self, timeout=None):
                return 0
        captured = io.StringIO()
        class Output:
            def __enter__(self):
                return captured
            def __exit__(self, *args):
                return False
        with patch("image_storage_metrics.subprocess.Popen", return_value=Child()), \
             patch("image_storage_metrics.open", return_value=Output()), \
             patch("image_storage_metrics.sys.stderr", new=io.StringIO()):
            status = main(["base:a", "base:b", "candidate:a", "candidate:b", "unused.json"])
        self.assertEqual(status, 1)
        saved = json.loads(captured.getvalue())
        self.assertFalse(saved["checks"]["content_union_does_not_grow"])
        self.assertFalse(saved["checks"]["chain_weighted_proxy_does_not_grow"])


if __name__ == "__main__":
    unittest.main()
