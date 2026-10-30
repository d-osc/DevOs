"""Generate missing Store brand SVGs from the project's existing Font Awesome font.

Uses the same fontTools workflow as tools/maintenance/build-fa-icons.py.
Normal builds consume the committed SVGs and need no fonts or network.
"""
import re
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

root = Path(__file__).resolve().parents[2]
font = TTFont(root / 'assets/font/fa-brands-400.woff2')
css = (root / 'assets/css/brands.css').read_text('utf-8')
glyphs = font.getGlyphSet()
for app, brand, color in [('chatgpt', 'openai', '#10a37f'), ('firefox', 'firefox-browser', '#ff7139')]:
    match = re.search(r'\.fa-' + brand + r'\{--fa:"\\([0-9a-f]+)"\}', css)
    if not match:
        raise ValueError(f'Missing Font Awesome brand: {brand}')
    glyph = font.getBestCmap()[int(match[1], 16)]
    # Normalize glyph bounds to a square, preserving proportions and padding.
    pen = SVGPathPen(glyphs)
    glyphs[glyph].draw(TransformPen(pen, (1, 0, 0, -1, 0, font['hhea'].ascent)))
    width = font['hmtx'][glyph][0]
    side = max(width, font['head'].unitsPerEm)
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-(side-width)/2:g} 0 {side} {side}"><!-- Font Awesome Brands: {brand}, assets/font/fa-brands-400.woff2 --><path fill="{color}" d="{pen.getCommands()}"/></svg>\n'
    (root / f'data/icons/hicolor/scalable/apps/dev-os-store-{app}.svg').write_text(svg, 'utf-8')
    print(f'Generated {app} Store icon')
