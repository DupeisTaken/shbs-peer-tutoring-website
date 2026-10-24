# Public QR export font

`shbs-public-qr.otf` is a static subset of Noto Sans SC Regular 2.004,
distributed under the SIL Open Font License 1.1 in `OFL.txt`. The original
copyright and font metadata are retained in the binary.

Upstream release: [Noto Sans CJK 2.004](https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004).
Both inputs are pinned to commit `523d033d6cb47f4a80c58a35753646f5c3608a78`:

- [Original font](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf)
- [Original license](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/LICENSE)

The subset includes printable ASCII and `同伴辅导伙伴报名学习巡查队网站首页`.
This covers the fixed English/Chinese destination labels and complete serialized
URLs, including punycode hostnames. It is intentionally not a general-purpose
font for arbitrary translated content. When changing labels, add any new glyphs
and verify both locales with network access disabled in the rendering tests.

## Reproduce the subset

Download the pinned source into a temporary directory and save the pinned license
as `OFL.txt` beside the committed font. With Python and FontTools installed in an
isolated environment (FontTools 4.60.1 was used), run from the repository root:

```sh
python -m fontTools.subset /path/to/NotoSansSC-Regular.otf --unicodes=U+0020-007E --text=同伴辅导伙伴报名学习巡查队网站首页 --no-ignore-missing-unicodes --name-IDs='*' --output-file=public/fonts/public-qr/shbs-public-qr.otf
```

The source font and FontTools are authoring inputs only. The application reads
the committed OTF through `node:fs` and passes its bytes to `next/og`; it does not
load machine fonts or download fonts while handling a request. Keeping the asset
in `public/` also includes it in the existing standalone Docker runtime copy.
