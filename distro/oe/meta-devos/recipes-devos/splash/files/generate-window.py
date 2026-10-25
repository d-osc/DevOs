#!/usr/bin/env python3
"""Generate devos-splash-window.js from the .in template and the font table of devos-splash.c (single source of the glyphs)."""
import re
from pathlib import Path

here = Path(__file__).resolve().parent
source = (here / 'devos-splash.c').read_text()
table = source.split('FONT[95][5] = {')[1].split('\n};')[0]
rows = re.findall(r'\{((?:0x[0-9A-Fa-f]{2},?){5})\}', table)
assert len(rows) == 95, len(rows)
font = '[' + ','.join('[' + r + ']' for r in rows) + ']'
(here / 'devos-splash-window.js').write_text((here / 'devos-splash-window.js.in').read_text().replace('/*FONT*/', font))
