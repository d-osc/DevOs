import {
    type GtkTypes as Gtk, React, DrawingArea, EventBox, Overlay, createRoot, Gdk, Gio, useEffect, useState, useRef, type GdkPixbufTypes, type SettingsValues
} from '@dev-os/core';
import Cairo from 'cairo';
import {loadPicture, pictureLayout, type WallpaperConfig} from './wallpaper.js';
import {DesktopWidgets} from './desktop-widgets.js';

export interface BackgroundConfig {name: string; background: string; accent: string;}
function rgb(color: string): [number, number, number] {
    return [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255,
        parseInt(color.slice(5, 7), 16) / 255];
}
export function drawBackground(canvas: Gtk.DrawingArea, context: Cairo.Context, config: BackgroundConfig, size?: {width: number; height: number}): boolean {
    const width = size?.width ?? canvas.get_allocated_width();
    const height = size?.height ?? canvas.get_allocated_height();
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

export function WallpaperCanvas({config, preview = false, onError}: {config: WallpaperConfig; preview?: boolean; onError?(message: string): void}) {
    const [picture, setPicture] = useState<{path: string; pixels: GdkPixbufTypes.Pixbuf} | null>(null);
    const canvasRef = useRef<Gtk.DrawingArea | null>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!preview || !canvas) return;
        const signal = canvas.connect('size-allocate', () => {
            const height = Math.max(180, Math.round(canvas.get_allocated_width() * 9 / 16));
            if (canvas.height_request !== height) canvas.height_request = height;
        });
        return () => canvas.disconnect(signal);
    }, [preview]);
    useEffect(() => {
        const cancel = new Gio.Cancellable();
        setPicture(null); onError?.('');
        if (config.mode === 'picture' && config.imagePath) {
            void loadPicture(config.imagePath, cancel).then(pixels => {
                if (!cancel.is_cancelled()) setPicture({path: config.imagePath, pixels});
            }).catch(error => { if (!cancel.is_cancelled()) { onError?.(String(error)); if (!preview) printerr(`Wallpaper: ${String(error)}`); } });
        }
        return () => cancel.cancel();
    }, [config.mode, config.imagePath]);
    return <DrawingArea ref={canvasRef} id={preview ? 'background-preview' : undefined} heightRequest={preview ? 260 : undefined} onDraw={(canvas, context) => {
        const width = canvas.get_allocated_width(), height = canvas.get_allocated_height();
        if (config.mode === 'design') {
            if (preview) {
                context.save(); context.scale(width / 1920, height / 1080);
                drawBackground(canvas, context, config, {width: 1920, height: 1080});
                context.restore(); return false;
            }
            return drawBackground(canvas, context, config);
        }
        context.setSourceRGB(...rgb(config.background)); context.paint();
        if (config.mode === 'picture' && picture?.path === config.imagePath) {
            const layout = pictureLayout(width, height, picture.pixels.get_width(), picture.pixels.get_height(), config.fit);
            context.save(); context.rectangle(0, 0, width, height); context.clip();
            context.translate(layout.x, layout.y); context.scale(layout.sx, layout.sy);
            Gdk.cairo_set_source_pixbuf(context, picture.pixels, 0, 0); context.paint(); context.restore();
        }
        return false;
    }} />;
}
export function BackgroundView({config, widgets = {}, changed, desktopKey = 'default'}: {config: BackgroundConfig | WallpaperConfig; widgets?: SettingsValues; changed?(values: SettingsValues): void; desktopKey?: string}) {
    return <EventBox expand fill hexpand vexpand><Overlay id="desktop-widgets" expand fill hexpand vexpand><WallpaperCanvas config={{mode: 'design', imagePath: '', fit: 'cover', ...config}} /><DesktopWidgets key={desktopKey} values={widgets} changed={changed} /></Overlay></EventBox>;
}
export function mountBackground(window: Gtk.ApplicationWindow, config: BackgroundConfig, widgets: SettingsValues = {}, changed?: (values: SettingsValues) => void, desktopKey = 'default') {
    const root = createRoot(window);
    root.render(<BackgroundView config={config} widgets={widgets} changed={changed} desktopKey={desktopKey} />);
    return root;
}
