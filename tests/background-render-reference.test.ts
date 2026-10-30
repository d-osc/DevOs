// Reference renderer for native migration parity; never a production entry.
import Cairo from 'cairo';
import {drawDesign, designStyles} from '../packages/compat/background-legacy/design.js';
for (let phase = 0; phase < 4; phase++) for (let mode = 0; mode < 2; mode++) for (let style = 0; style < 24; style++) {
    if (phase > 0 && style < 9) continue;
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 640, 360), cr = new Cairo.Context(surface);
    drawDesign(cr, {name: 'DevOs', background: mode === 0 ? '#202020' : '#e7e8ec', accent: '#00aaff', style: designStyles[style]!.id}, 640, 360, [0.8, 7.3, 83.25, 1000.25][phase]!);
    surface.writeToPNG(`build/background-native-parity/reference-${mode}-${style}-${phase}.png`); cr.$dispose(); surface.finish();
}
print('PASS static reference frames');
