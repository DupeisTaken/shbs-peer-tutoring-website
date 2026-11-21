# Help PDF font

`noto-sans-sc.otf` is a static subset of Noto Sans SC Regular 2.004. It is
distributed under the [SIL Open Font License](OFL.txt). Original font metadata
is retained. PDF downloads embed the subset, so Chinese text works offline and
does not depend on fonts installed on the server or reader's computer. Both
editions use this font because English directions also quote Chinese interface labels.

Pinned upstream commit: `523d033d6cb47f4a80c58a35753646f5c3608a78`.

- [Original font](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf)
- [Original license](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/LICENSE)
- Original font SHA-256: `faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9`.

Download that input to an ignored local folder. With FontTools in an isolated
Python environment, run from the repository root:

```sh
python scripts/subset-help-font.py /path/to/NotoSansSC-Regular.otf
# If Node is not on PATH, append: --node /path/to/node
```

The helper checks the input against the pinned SHA-256 above and uses the installed
Node/tsx runtime to read the same decoded corpus as CI: both article languages,
audience titles, complete capture metadata/callouts, annotation notices, PDF labels,
ASCII and bullet/separator characters. JSON Unicode escapes are decoded before
glyph collection. It refuses missing glyphs and disables timestamp recalculation.
Repeat it when adding new Chinese characters, then run the help checks
and visually verify both language editions. The application never downloads
the upstream font while serving a PDF.
