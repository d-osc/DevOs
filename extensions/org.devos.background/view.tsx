import {
    type GtkTypes as Gtk, React, DrawingArea, EventBox, Overlay, createRoot, Gdk, Gio, GLib, useEffect, useState, useRef, type GdkPixbufTypes, type SettingsValues
} from '@dev-os/core';
import Cairo from 'cairo';
import {loadPicture, pictureLayout, type WallpaperConfig} from './wallpaper.js';
import {DesktopWidgets} from './desktop-widgets.js';
import {designStyle, drawDesign} from './design.js';
import {isMotion, MOTION_INTERVAL_MS} from './motion.js';

export interface BackgroundConfig {name: string; background: string; accent: string; foreground?: string; muted?: string; style?: string;}
function rgb(color: string): [number, number, number] {
    return [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255,
        parseInt(color.slice(5, 7), 16) / 255];
}
export function drawBackground(canvas: Gtk.DrawingArea, context: Cairo.Context, config: BackgroundConfig, size?: {width: number; height: number}): boolean {
    const width = size?.width ?? canvas.get_allocated_width();
    const height = size?.height ?? canvas.get_allocated_height();
    drawDesign(context, config, width, height);
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
        const canvas = canvasRef.current;
        if (!canvas || config.mode !== 'design' || !isMotion(designStyle(config.style))) return;
        const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MOTION_INTERVAL_MS, () => { if (canvas.get_mapped()) canvas.queue_draw(); return GLib.SOURCE_CONTINUE; });
        return () => { GLib.source_remove(source); };
    }, [config.mode, config.style]);
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
