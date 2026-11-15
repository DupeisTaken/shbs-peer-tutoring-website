from pathlib import Path
from fontTools import subset
import argparse
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description='Subset the pinned OFL Noto Sans SC input for the help PDF corpus')
p.add_argument('font', type=Path)
a = p.parse_args()
corpus = ''.join((ROOT / name).read_text(encoding='utf8') for name in ['src/lib/help/participant-content.ts','src/lib/help/management-content.ts','src/lib/help/catalogue.ts','src/server/help/pdf.ts','docs/guides/help/captures.json'])
corpus += ''.join(chr(c) for c in range(32,127)) + '•·—→'
options = subset.Options()
options.name_IDs = ['*']
font = subset.load_font(str(a.font), options)
missing = set(ord(c) for c in corpus if not c.isspace()) - set(font.getBestCmap())
if missing: raise ValueError('Missing source glyphs: '+repr(sorted(missing)))
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=corpus)
subsetter.subset(font)
destination = ROOT / 'public/fonts/help/noto-sans-sc.otf'
destination.parent.mkdir(parents=True, exist_ok=True)
subset.save_font(font, str(destination), options)
print('Created help font subset:',destination.stat().st_size,'bytes')
