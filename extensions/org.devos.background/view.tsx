import Cairo from 'cairo';
import type Gtk from '@girs/gtk-3.0';
import {React, DrawingArea, createRoot} from '@dev-os/react-gtk';

export interface BackgroundConfig {name: string; background: string; accent: string;}
function rgb(color: string): [number, number, number] {
    return [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255,
        parseInt(color.slice(5, 7), 16) / 255];
}
export function drawBackground(canvas: Gtk.DrawingArea, context: Cairo.Context, config: BackgroundConfig): boolean {
    const width = canvas.get_allocated_width();
    const height = canvas.get_allocated_height();
    context.setSourceRGB(...rgb(config.background));
    context.paint();
    const glow = new Cairo.RadialGradient(width * .7, height * .48, 0,
        width * .7, height * .48, width * .6);
    glow.addColorStopRGBA(0, .18, .39, .36, .36);
    glow.addColorStopRGBA(1, .04, .07, .1, 0);
    context.setSource(glow);
    context.paint();
    context.setSourceRGBA(.62, .83, .81, .045);
    context.setLineWidth(1);
    for (let x = 0; x < width; x += 72) {
        context.moveTo(x + .5, 0); context.lineTo(x + .5, height);
    }
    for (let y = 0; y < height; y += 72) {
        context.moveTo(0, y + .5); context.lineTo(width, y + .5);
    }
    context.stroke();
    context.save();
    context.translate(width * .72, height * .48);
    context.rotate(-.42);
    const radius = Math.min(width * .21, height * .31);
    for (let index = 0; index < 14; index++) {
        context.save();
        context.rotate(index * .09);
        context.scale(1, .5 + index * .025);
        context.arc(0, 0, radius * (.75 + index * .018), 0, Math.PI * 2);
        context.setSourceRGBA(...rgb(config.accent), .10 + index * .012);
        context.setLineWidth(1.1);
        context.stroke(); context.restore();
    }
    context.restore();
    const left = Math.max(36, width * .085);
    const baseline = height * .38;
    const scale = Math.min(1.25, Math.max(.65, width / 1440));
    const text = (value: string, x: number, y: number, size: number, color: [number, number, number, number], bold = false) => {
        context.selectFontFace('Sans', Cairo.FontSlant.NORMAL,
            bold ? Cairo.FontWeight.BOLD : Cairo.FontWeight.NORMAL);
        context.setFontSize(size * scale);
        context.setSourceRGBA(...color); context.moveTo(x, y); context.showText(value);
    };
    text(`${config.name.toUpperCase()}  /  WAYLAND`, left, baseline, 12,
        [...rgb(config.accent), 1], true);
    text('Make room', left, baseline + 65 * scale, 48, [.9, .95, .96, 1], true);
    text('for your ideas.', left, baseline + 125 * scale, 48, [.9, .95, .96, 1], true);
    text('A small beginning. An open desktop.', left, baseline + 173 * scale, 16, [.58, .67, .7, 1]);
    text('SUPER + SPACE   Applications     /     SUPER + ENTER   Terminal',
        left, height - 64 * scale, 12, [.58, .67, .7, 1]);
    text('WAYLAND SESSION    ·    GJS / GTK', left, height - 36 * scale, 10, [.38, .51, .54, 1]);
    return false;
}

export function BackgroundView({config}: {config: BackgroundConfig}) {
    return <DrawingArea onDraw={(canvas, context) => drawBackground(canvas, context, config)} />;
}
export function mountBackground(window: Gtk.ApplicationWindow, config: BackgroundConfig) {
    const root = createRoot(window);
    root.render(<BackgroundView config={config} />);
    return root;
}
