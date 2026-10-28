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


def fixture(images, *, blobs=False, manifest_first=False):
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
            layer_hash = digest(layer).split(":")[1]
            name = f"blobs/sha256/{layer_hash}" if blobs else f"{layer_hash}/layer.tar"
            paths.append(name)
            members[name] = layer
        manifest.append({"Config": config_name, "RepoTags": [tag], "Layers": paths})
    manifest_member = ("manifest.json", json.dumps(manifest).encode())
    ordered = list(members.items())
    return [manifest_member, *ordered] if manifest_first else [*ordered, manifest_member]


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
