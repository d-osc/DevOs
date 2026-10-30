import {Gio, GLib} from '@dev-os/core';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import type {SettingsValues} from '@dev-os/core';
import type {BackgroundConfig} from './view.js';
import {designStyle} from './design.js';

export type BackgroundMode = 'design' | 'solid' | 'picture';
export type PictureFit = 'cover' | 'contain' | 'stretch';
export interface WallpaperConfig extends BackgroundConfig {mode: BackgroundMode; imagePath: string; fit: PictureFit;}
export function wallpaperConfig(config: BackgroundConfig, values: SettingsValues): WallpaperConfig {
    const mode = values.mode === 'solid' || values.mode === 'picture' ? values.mode : 'design';
    return {...config, mode, style: designStyle(values.style), fit: values.fit === 'contain' || values.fit === 'stretch' ? values.fit : 'cover',
        imagePath: typeof values.imagePath === 'string' ? values.imagePath : '',
        background: values.useDesktopColor === false && typeof values.color === 'string' && /^#[\da-f]{6}$/i.test(values.color) ? values.color : config.background};
}
export function pictureLayout(width: number, height: number, imageWidth: number, imageHeight: number, fit: PictureFit) {
    if ([width, height, imageWidth, imageHeight].some(value => !Number.isFinite(value) || value <= 0))
        throw new Error('Picture and canvas dimensions must be positive.');
    const scale = fit === 'contain' ? Math.min(width / imageWidth, height / imageHeight) : Math.max(width / imageWidth, height / imageHeight);
    const sx = fit === 'stretch' ? width / imageWidth : scale;
    const sy = fit === 'stretch' ? height / imageHeight : scale;
    return {sx, sy, x: (width - imageWidth * sx) / 2, y: (height - imageHeight * sy) / 2};
}
export function loadPicture(path: string, cancel: Gio.Cancellable): Promise<GdkPixbuf.Pixbuf> {
    return new Promise((resolve, reject) => {
        if (!GLib.path_is_absolute(path) || path.includes('\0')) { reject(new Error('Choose an absolute local picture path.')); return; }
        GdkPixbuf.Pixbuf.get_file_info_async(path, cancel, (_source, info) => {
            let width: number, height: number;
            try {
                const [format, w, h] = GdkPixbuf.Pixbuf.get_file_info_finish(info);
                if (!format || w < 1 || h < 1) throw new Error('This file is not a supported picture.');
                width = Math.min(w, 4096); height = Math.min(h, 4096);
            } catch (error) { reject(error); return; }
            Gio.File.new_for_path(path).read_async(GLib.PRIORITY_DEFAULT, cancel, (file, result) => {
                let stream: Gio.FileInputStream;
                try { stream = file!.read_finish(result); } catch (error) { reject(error); return; }
                GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, width, height, true, cancel, (_source, ready) => {
                    try {
                        const pixels = GdkPixbuf.Pixbuf.new_from_stream_finish(ready);
                        resolve(pixels.apply_embedded_orientation() ?? pixels);
                    } catch (error) { reject(error); }
                    finally { stream.close_async(GLib.PRIORITY_DEFAULT, null, (source, closed) => { try { source!.close_finish(closed); } catch { /* Already disposed. */ } }); }
                });
            });
        });
    });
}
