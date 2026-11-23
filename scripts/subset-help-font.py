"""Subset the pinned OFL font using the same decoded runtime corpus as CI."""

import argparse
import hashlib
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_FONT_SHA256 = "faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9"


def verify_font(filename, expected=EXPECTED_FONT_SHA256):
    actual = hashlib.sha256(Path(filename).read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError("Font input does not match the pinned OFL source SHA-256: " + actual)


def help_corpus(node="node", run=None):
    runner = run or subprocess.run
    result = runner(
        [node, "--import", "tsx", str(ROOT / "scripts/help-font-corpus.ts"), "--print"],
        cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    if not result.stdout.strip():
        raise ValueError("The shared help font corpus is empty")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("font", type=Path)
    parser.add_argument("--node", default="node", help="Node executable for the installed repository runtime")
    args = parser.parse_args()
    verify_font(args.font)
    corpus = help_corpus(args.node)

    # Bounded helper tests need no FontTools installation or generated artifact.
    from fontTools import subset

    options = subset.Options()
    options.name_IDs = ["*"]
    options.recalc_timestamp = False
    font = subset.load_font(str(args.font), options)
    missing = {ord(character) for character in corpus if not character.isspace()} - set(font.getBestCmap())
    if missing:
        raise ValueError("Missing pinned-source glyphs: " + repr(sorted(missing)))
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=corpus)
    subsetter.subset(font)
    destination = ROOT / "public/fonts/help/noto-sans-sc.otf"
    destination.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(destination), options)
    print("Created help font subset:", destination.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
