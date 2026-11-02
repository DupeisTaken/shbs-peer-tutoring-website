"""Inspect a Docker-save stream without extracting image files.

``read_image_archive(stream)`` returns a mapping from RepoTag to selected image
metadata. Each image contains its config digest and ordered layer records with
DiffID, archive payload size, and snapshot chain ID. Whole configs are never
returned. ``summarize_pairs`` compares two ordered pairs from that mapping.

The byte metrics describe exported layer payloads. Content union and chain-key
weighted union are sharing proxies, not registry transfer or host allocation.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import PurePosixPath
import re
import subprocess
import sys
import tarfile


METADATA_LIMIT = 4 * 1024 * 1024
MEMBER_LIMIT = 32768
CHUNK_SIZE = 512 * 1024
MAX_INTEGER = (1 << 63) - 1
_SHA256 = re.compile(r"sha256:[a-f0-9]{64}\Z")
_CONFIG_NAME = re.compile(r"(?:([a-f0-9]{64})\.json|blobs/sha256/([a-f0-9]{64}))\Z")
_TAG = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/@-]{0,511}\Z")


def _fail(message):
    raise ValueError(message)


def _path(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        _fail("Invalid archive path")
    parts = value.rstrip("/").split("/")
    if (
        value.startswith("/") or "\\" in value or "\x00" in value
        or any(part in ("", ".", "..") for part in parts)
        or str(PurePosixPath(value)) != value.rstrip("/")
    ):
        _fail("Noncanonical archive path")
    return value.rstrip("/")


def _tag(value):
    if not isinstance(value, str) or not _TAG.fullmatch(value):
        _fail("Invalid image tag")
    return value


def _pairs_without_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail("Duplicate JSON key")
        result[key] = value
    return result


def _json(raw):
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs_without_duplicates,
                          parse_constant=lambda _: _fail("Nonstandard JSON constant"))
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise ValueError("Invalid archive JSON metadata") from exc


def _config_digest(name):
    match = _CONFIG_NAME.fullmatch(name)
    if not match:
        _fail("Unsupported config identity path")
    return "sha256:" + (match.group(1) or match.group(2))


def _chain(parent, diff_id):
    if parent is None:
        return diff_id
    return "sha256:" + hashlib.sha256(f"{parent} {diff_id}".encode("ascii")).hexdigest()


class _BoundedTarInfo(tarfile.TarInfo):
    """Bound extended headers before tarfile reads their metadata into memory."""

    def _proc_member(self, archive):
        metadata_types = (tarfile.XHDTYPE, tarfile.XGLTYPE,
                          tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK)
        if self.type in metadata_types:
            total = getattr(archive, "_storage_extended_metadata_bytes", 0) + self.size
            if self.size < 0 or total > METADATA_LIMIT:
                _fail("Extended archive metadata limit exceeded")
            archive._storage_extended_metadata_bytes = total
        elif self.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE):
            _fail("Unsupported archive member type")
        return super()._proc_member(archive)


def read_image_archive(stream):
    """Read a binary Docker-save stream; return tag -> selected image metadata.

    Metadata retained for configs/manifest is capped at 4 MiB in total. Large
    payloads are hashed in fixed-size chunks and are never materialized on disk.
    Configs can precede manifest.json, including OCI-style blob member names.
    """
    members = {}
    metadata = {}
    metadata_bytes = 0
    try:
        with tarfile.open(fileobj=stream, mode="r|", tarinfo=_BoundedTarInfo) as archive:
            for member in archive:
                if len(members) >= MEMBER_LIMIT:
                    _fail("Archive member limit exceeded")
                name = _path(member.name)
                if name in members:
                    _fail("Duplicate archive member")
                if member.isdir():
                    members[name] = {"directory": True}
                    continue
                if not member.isfile() or not 0 <= member.size <= MAX_INTEGER:
                    _fail("Unsupported archive member type or size")
                potential_metadata = name == "manifest.json" or bool(_CONFIG_NAME.fullmatch(name))
                if name == "manifest.json" and member.size > METADATA_LIMIT:
                    _fail("Manifest metadata limit exceeded")
                capture = potential_metadata and member.size <= METADATA_LIMIT
                chunks = [] if capture else None
                digest = hashlib.sha256()
                prefix = b""
                consumed = 0
                payload = archive.extractfile(member)
                if payload is None:
                    _fail("Unreadable archive member")
                with payload:
                    while True:
                        chunk = payload.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        consumed += len(chunk)
                        digest.update(chunk)
                        if not prefix:
                            prefix = chunk[:4]
                        if chunks is not None:
                            chunks.append(chunk)
                if consumed != member.size:
                    _fail("Truncated archive member")
                members[name] = {"size": member.size, "digest": "sha256:" + digest.hexdigest(), "prefix": prefix}
                if chunks is not None:
                    raw = b"".join(chunks)
                    # Blob paths can denote layers as well as configs. Only JSON
                    # candidates consume the aggregate retained-metadata budget.
                    if name == "manifest.json" or name.endswith(".json") or raw.lstrip().startswith((b"{", b"[")):
                        metadata_bytes += len(raw)
                        if metadata_bytes > METADATA_LIMIT:
                            _fail("Aggregate metadata limit exceeded")
                        metadata[name] = raw
        # Consume padding/EOF before the CLI waits for its producer. This avoids
        # leaving the owned docker-save process blocked on a full stdout pipe.
        while stream.read(CHUNK_SIZE):
            pass
    except (tarfile.TarError, EOFError, OSError) as exc:
        raise ValueError("Invalid or truncated Docker image archive") from exc

    if "manifest.json" not in metadata:
        _fail("Missing Docker archive manifest")
    manifest = _json(metadata["manifest.json"])
    if not isinstance(manifest, list) or not manifest or len(manifest) > 256:
        _fail("Invalid Docker archive manifest")
    images = {}
    content_sizes = {}
    for entry in manifest:
        if not isinstance(entry, dict):
            _fail("Invalid manifest image entry")
        config_name = _path(entry.get("Config"))
        expected_config_digest = _config_digest(config_name)
        if config_name not in metadata or members[config_name].get("digest") != expected_config_digest:
            _fail("Missing config or inconsistent config identity")
        config = _json(metadata[config_name])
        rootfs = config.get("rootfs") if isinstance(config, dict) else None
        if not isinstance(rootfs, dict) or rootfs.get("type") != "layers":
            _fail("Invalid config rootfs")
        diff_ids = rootfs.get("diff_ids")
        layer_names = entry.get("Layers")
        tags = entry.get("RepoTags")
        if (
            not isinstance(diff_ids, list) or len(diff_ids) > 4096
            or not all(isinstance(item, str) and _SHA256.fullmatch(item) for item in diff_ids)
            or not isinstance(layer_names, list) or len(layer_names) != len(diff_ids)
            or not isinstance(tags, list) or not tags or len(tags) > 256
        ):
            _fail("Invalid manifest/config layer or tag metadata")
        layers = []
        parent = None
        for name, diff_id in zip(layer_names, diff_ids):
            name = _path(name)
            item = members.get(name)
            if not item or "size" not in item or name == config_name or name == "manifest.json":
                _fail("Missing layer payload")
            blob_match = re.fullmatch(r"blobs/sha256/([a-f0-9]{64})", name)
            if blob_match and item["digest"] != "sha256:" + blob_match.group(1):
                _fail("Inconsistent layer blob identity")
            encoding = ("gzip" if item["prefix"].startswith(b"\x1f\x8b") else
                        "zstd" if item["prefix"] == b"\x28\xb5\x2f\xfd" else "uncompressed")
            compressed = encoding != "uncompressed"
            if not compressed and item["digest"] != diff_id:
                _fail("Inconsistent uncompressed layer identity")
            # For compressed payloads DiffID is the config's uncompressed
            # identity. This tool does not decompress them or estimate disk use.
            size = item["size"]
            if diff_id in content_sizes and content_sizes[diff_id] != size:
                _fail("Inconsistent exported payload sizes for one DiffID")
            content_sizes[diff_id] = size
            parent = _chain(parent, diff_id)
            layers.append({"diff_id": diff_id, "payload_bytes": size, "chain_id": parent,
                           "payload_encoding": encoding, "diff_id_verified_from_payload": not compressed})
        for value in tags:
            tag = _tag(value)
            if tag in images:
                _fail("Duplicate manifest image tag")
            images[tag] = {"config_digest": expected_config_digest, "layers": layers, "exported_layer_payload_bytes": sum(layer["payload_bytes"] for layer in layers)}
    return images


def _summarize_pair(images, tags):
    if not isinstance(tags, (tuple, list)) or len(tags) != 2 or len(set(tags)) != 2:
        _fail("Each image pair must contain two distinct tags")
    contents = {}
    chains = {}
    single = {}
    for tag in tags:
        _tag(tag)
        if tag not in images:
            _fail("Requested image tag missing from archive")
        image = images[tag]
        single[tag] = image["exported_layer_payload_bytes"]
        for layer in image["layers"]:
            size = layer["payload_bytes"]
            diff_id = layer["diff_id"]
            chain_id = layer["chain_id"]
            if diff_id in contents and contents[diff_id] != size:
                _fail("Inconsistent content payload sizes")
            if chain_id in chains and chains[chain_id] != (diff_id, size):
                _fail("Inconsistent snapshot chain metadata")
            contents[diff_id] = size
            chains[chain_id] = (diff_id, size)
    return {"tags": list(tags), "single_image_payload_bytes": single,
            "unique_content_payload_bytes": sum(contents.values()),
            "chain_key_weighted_payload_bytes": sum(size for _, size in chains.values()),
            "unique_content_layers": len(contents), "unique_snapshot_chains": len(chains)}


def summarize_pairs(images, baseline_tags, candidate_tags):
    """Compare ordered baseline/candidate pairs using exported payload bytes.

    Positive candidate-minus-baseline deltas mean more bytes. The chain-weighted
    metric conservatively counts a payload again under each distinct parent chain;
    it remains a structural sharing proxy, never actual allocated host storage.
    """
    baseline = _summarize_pair(images, baseline_tags)
    candidate = _summarize_pair(images, candidate_tags)
    metrics = ("unique_content_payload_bytes", "chain_key_weighted_payload_bytes")
    return {"schema_version": 1,
            "metric_scope": "Exported layer payload bytes only. Content union and chain-key-weighted union are sharing proxies; neither is registry transfer size nor actual host disk allocation.",
            "images": {tag: images[tag] for tag in dict.fromkeys([*baseline_tags, *candidate_tags])},
            "baseline": baseline, "candidate": candidate,
            "candidate_minus_baseline_bytes": {key: candidate[key] - baseline[key] for key in metrics},
            "single_image_candidate_minus_baseline_bytes": [candidate["single_image_payload_bytes"][c] - baseline["single_image_payload_bytes"][b] for b, c in zip(baseline_tags, candidate_tags)]}


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 5:
        print("Usage: image_storage_metrics.py BASE_A BASE_B CANDIDATE_A CANDIDATE_B OUTPUT_JSON", file=sys.stderr)
        return 64
    try:
        tags = [_tag(value) for value in args[:4]]
        if len(set(tags)) != 4:
            _fail("Four distinct CI-owned image tags are required")
        # Only this child is owned here. Never stop a daemon or unrelated process.
        child = subprocess.Popen(["docker", "image", "save", *tags], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            images = read_image_archive(child.stdout)
            if child.wait() != 0:
                _fail("docker image save failed")
        except BaseException:
            if child.poll() is None:
                child.kill()
            # Bounded failure cleanup avoids Popen.__exit__'s unbounded wait.
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            raise
        finally:
            child.stdout.close()
        result = summarize_pairs(images, tags[:2], tags[2:])
        result["checks"] = {
            "content_union_does_not_grow": result["candidate_minus_baseline_bytes"]["unique_content_payload_bytes"] <= 0,
            "chain_weighted_proxy_does_not_grow": result["candidate_minus_baseline_bytes"]["chain_key_weighted_payload_bytes"] <= 0,
        }
        # Preserve the selected raw measurements even when a regression makes
        # the CI gate fail, so reviewers can inspect both unfavorable results.
        with open(args[4], "w", encoding="utf-8") as output:
            json.dump(result, output, indent=2, sort_keys=True)
            output.write("\n")
        if not all(result["checks"].values()):
            print("Candidate image storage metrics grew; inspect the saved report.", file=sys.stderr)
            return 1
        return 0
    except (ValueError, OSError) as exc:
        print(f"Image storage measurement failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
