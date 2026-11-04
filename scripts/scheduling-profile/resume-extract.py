"""Extract bounded, flat GitHub measurement artifacts without executing content."""
import os
from pathlib import Path
import re
import stat
import sys
import zipfile

MAX_ENTRIES = 256
MAX_FILE = 768 * 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024 * 1024
MAX_ARCHIVE = 512 * 1024 * 1024


def extract(archive: str, destination: str, remaining: int) -> int:
    if not 0 <= remaining <= 10 * 1024 * 1024 * 1024:
        raise ValueError("Invalid campaign extraction budget")
    target = Path(destination)
    if target.is_symlink() or not target.is_dir() or any(target.iterdir()):
        raise ValueError("Extraction requires an empty real directory")
    if Path(archive).stat().st_size > MAX_ARCHIVE:
        raise ValueError("Archive size limit exceeded")
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if not 0 < len(entries) <= MAX_ENTRIES:
            raise ValueError("Archive entry limit exceeded")
        seen = set()
        total = 0
        # Validate the entire directory before writing even the first file.
        for entry in entries:
            name = entry.filename
            if (entry.orig_filename != name
                    or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,254}", name)
                    or name.endswith((".", " "))
                    or re.match(r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", name, re.I)
                    or entry.is_dir() or entry.external_attr & 0x10):
                raise ValueError("Unsafe artifact member")
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if mode not in (0, stat.S_IFREG) or entry.flag_bits & 1:
                raise ValueError("Links, special files and encryption are forbidden")
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("Unsupported ZIP compression")
            if name.casefold() in seen:
                raise ValueError("Duplicate artifact member")
            seen.add(name.casefold())
            if not 0 <= entry.file_size <= MAX_FILE:
                raise ValueError("Artifact member limit exceeded")
            total += entry.file_size
            if total > min(MAX_TOTAL, remaining):
                raise ValueError("Expanded archive limit exceeded")
        for entry in entries:
            written = 0
            # zipfile verifies local headers, overlaps and CRC when read to EOF.
            # Exclusive creation and explicit regular writes never follow links.
            with source.open(entry) as member:
                fd = os.open(target / entry.filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as output:
                    while chunk := member.read(1024 * 1024):
                        written += len(chunk)
                        if written > entry.file_size or written > MAX_FILE:
                            raise ValueError("Artifact member exceeds declared size")
                        output.write(chunk)
            if written != entry.file_size:
                raise ValueError("Artifact member size differs")
    return total


if __name__ == "__main__":
    try:
        if len(sys.argv) != 4:
            raise ValueError("Expected archive and destination")
        print(extract(sys.argv[1], sys.argv[2], int(sys.argv[3])))
    except Exception:
        # Provider member paths and signed URLs never enter public diagnostics.
        sys.exit("Artifact ZIP extraction failed safety or integrity validation")
