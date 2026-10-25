import {
    type GtkTypes as Gtk, React, DrawingArea, EventBox, Overlay, createRoot, Gdk, Gio, GLib, useEffect, useState, useRef, type GdkPixbufTypes, type SettingsValues
} from '@dev-os/core';
import Cairo from 'cairo';
import {loadPicture, pictureLayout, type WallpaperConfig} from './wallpaper.js';
import {DesktopWidgets} from './desktop-widgets.js';
import {designStyle, drawDesign} from './design.js';
import {isMotion} from './motion.js';
import {motionInterval, readOnBattery} from './pace.js';

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

export function WallpaperCanvas({config, preview = false, paused = false, onError}: {config: WallpaperConfig; preview?: boolean; paused?: boolean; onError?(message: string): void}) {
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
        const canvas = canvasRef.current, style = designStyle(config.style);
        if (!canvas || paused || config.mode !== 'design' || !isMotion(style)) return;
        // One timer at a time, re-armed after each frame so the pace follows the power source (checked every 30 s). Frames are drawn at
        // a low priority: input and the panel always go first.
        let source = 0, battery = readOnBattery(), checked = GLib.get_monotonic_time();
        const frame = () => {
            source = 0;
            if (canvas.get_mapped()) canvas.queue_draw();
            if (GLib.get_monotonic_time() - checked > 30e6) { battery = readOnBattery(); checked = GLib.get_monotonic_time(); }
            source = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, motionInterval(style, battery), frame);
            return GLib.SOURCE_REMOVE;
        };
        source = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, motionInterval(style, battery), frame);
        return () => { if (source) GLib.source_remove(source); };
    }, [config.mode, config.style, paused]);
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
                // The preview is a few hundred pixels wide: draw it at 720p, not full HD.
                context.save(); context.scale(width / 1280, height / 720);
                drawBackground(canvas, context, config, {width: 1280, height: 720});
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
export function BackgroundView({config, widgets = {}, changed, desktopKey = 'default', paused = false}: {config: BackgroundConfig | WallpaperConfig; widgets?: SettingsValues; changed?(values: SettingsValues): void; desktopKey?: string; paused?: boolean}) {
    return <EventBox expand fill hexpand vexpand><Overlay id="desktop-widgets" expand fill hexpand vexpand><WallpaperCanvas paused={paused} config={{mode: 'design', imagePath: '', fit: 'cover', ...config}} /><DesktopWidgets key={desktopKey} values={widgets} changed={changed} /></Overlay></EventBox>;
}
export function mountBackground(window: Gtk.ApplicationWindow, config: BackgroundConfig, widgets: SettingsValues = {}, changed?: (values: SettingsValues) => void, desktopKey = 'default', paused = false) {
    const root = createRoot(window);
    root.render(<BackgroundView config={config} widgets={widgets} changed={changed} desktopKey={desktopKey} paused={paused} />);
    return root;
}
