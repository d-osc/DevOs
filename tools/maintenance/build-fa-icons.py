"""Extract the Dev OS base icons from the Font Awesome webfonts in assets/ into compact SVG-path JSON.

Normal builds are offline and read data/icons/fa/*.json. Regenerate on a workstation with
`pip install fonttools brotli` and `python tools/maintenance/build-fa-icons.py [assets-dir]`.
"""
import json, re, sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

root = Path(__file__).resolve().parents[2]
assets = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'assets'
out = root / 'data/icons/fa'
mapping = json.loads((root / 'extensions/org.devos.icons/fa/mapping.json').read_text('utf-8'))
fonts = json.loads((root / 'extensions/org.devos.icons/fa/fonts.json').read_text('utf-8'))

# name -> codepoint from fontawesome.css (`.fa-a,.fa-b{--fa:"\f120"}`)
names = {}
for selectors, value in re.findall(r'((?:\.fa-[a-z0-9-]+,?)+)\{--fa:"([^"]+)"\}', (assets / 'css/fontawesome.css').read_text('utf-8')):
    match = re.fullmatch(r'\\([0-9a-f]{1,6}) ?', value)
    text = value.replace('\\', '')
    if not match and not text: continue
    code = int(match.group(1), 16) if match else ord(text[0])
    for selector in selectors.split(','):
        if selector: names[selector[4:]] = code

wanted = sorted(set(mapping.values()))
missing = [n for n in wanted if n not in names]
if missing: sys.exit(f'Unknown Font Awesome names: {missing}')
out.mkdir(parents=True, exist_ok=True)
for old in out.glob('*.json'): old.unlink()

def outline(font, glyph, ascent):
    pen = SVGPathPen(font.getGlyphSet(), ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
    # Flip y so the origin is the top of the em square.
    font.getGlyphSet()[glyph].draw(TransformPen(pen, (1, 0, 0, -1, 0, ascent)))
    return pen.getCommands()

report = {}
for pack, styles in fonts.items():
    for style, stem in styles.items():
        font = TTFont(assets / 'font' / f'{stem}.woff2')
        cmap, hmtx = font.getBestCmap(), font['hmtx']
        upm, ascent = font['head'].unitsPerEm, font['hhea'].ascent
        icons = {}
        for name in wanted:
            code = names[name]
            if code not in cmap: continue
            glyph = cmap[code]
            entry = {'w': hmtx[glyph][0], 'd': outline(font, glyph, ascent)}
            if (code + 0x100000) in cmap:  # duotone secondary layer
                entry['d2'] = outline(font, cmap[code + 0x100000], ascent)
            if entry['d']: icons[name] = entry
        report[f'{pack}-{style}'] = len(icons)
        (out / f'{pack}-{style}.json').write_text(json.dumps({'upm': upm, 'icons': icons}, separators=(',', ':')), 'utf-8')
(out / 'index.json').write_text(json.dumps({'mapping': mapping, 'sets': report}, indent=1), 'utf-8')
print(json.dumps(report, indent=1), f'of {len(wanted)} icons')
