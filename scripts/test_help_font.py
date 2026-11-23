"""Bounded corpus/pin checks: no FontTools, browser, database or Node execution."""

import hashlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("help_font", Path(__file__).with_name("subset-help-font.py"))
HELP_FONT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELP_FONT)


class HelpFontTests(unittest.TestCase):
    def test_input_must_match_the_reviewed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            font = Path(directory) / "synthetic-font.bin"
            font.write_bytes(b"synthetic font input")
            expected = hashlib.sha256(font.read_bytes()).hexdigest()
            HELP_FONT.verify_font(font, expected)
            with self.assertRaisesRegex(ValueError, "pinned OFL source"):
                HELP_FONT.verify_font(font)

    def test_generation_reads_the_shared_decoded_runtime_corpus(self):
        calls = []

        def runner(command, **options):
            calls.append((command, options))
            return subprocess.CompletedProcess(command, 0, "完整截图，标注：龘", "")

        self.assertEqual(HELP_FONT.help_corpus("owned-node", runner), "完整截图，标注：龘")
        command, options = calls[0]
        self.assertEqual(command[:3], ["owned-node", "--import", "tsx"])
        self.assertTrue(command[3].endswith("help-font-corpus.ts"))
        self.assertEqual(command[-1], "--print")
        self.assertTrue(options["check"])
        self.assertEqual(options["encoding"], "utf-8")
        self.assertEqual(options["timeout"], 60)

    def test_empty_corpus_is_rejected(self):
        def runner(command, **_options):
            return subprocess.CompletedProcess(command, 0, " \n", "")

        with self.assertRaisesRegex(ValueError, "empty"):
            HELP_FONT.help_corpus(run=runner)


if __name__ == "__main__":
    unittest.main()
