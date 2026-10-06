import Cairo from 'cairo';
import {GLib} from '@dev-os/core';
import type {Config} from '@dev-os/config';

/** Wallpaper only; authentication and the central password indicator belong to swaylock. */
export function createLockBackground(config: Pick<Config, 'name' | 'accent' | 'background'>): string {
    const directory = GLib.dir_make_tmp('dev-os-lock-XXXXXX');
    const path = GLib.build_filenamev([directory, 'background.png']);
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1920, 1080);
    const context = new Cairo.Context(surface);
    const color = (hex: string, opacity = 1) => {
        const value = Number.parseInt(hex.replace('#', ''), 16);
        context.setSourceRGBA(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255,
            (value & 255) / 255, opacity);
    };
    const label = (text: string, y: number, size: number, hex: string, bold = false) => {
        context.selectFontFace('Sans', Cairo.FontSlant.NORMAL,
            bold ? Cairo.FontWeight.BOLD : Cairo.FontWeight.NORMAL);
        context.setFontSize(size);
        color(hex);
        const extent = context.textExtents(text);
        context.moveTo(960 - extent.width / 2 - extent.xBearing, y);
        context.showText(text);
    };
    try {
        color(config.background); context.paint();
        const glow = new Cairo.RadialGradient(960, 420, 20, 960, 420, 900);
        const accent = Number.parseInt(config.accent.slice(1), 16);
        glow.addColorStopRGBA(0, ((accent >> 16) & 255) / 255, ((accent >> 8) & 255) / 255,
            (accent & 255) / 255, 0.12);
        glow.addColorStopRGBA(1, 0, 0, 0, 0);
        context.setSource(glow); context.paint();
        color(config.accent, 0.035); context.setLineWidth(1);
        for (let x = 0; x <= 1920; x += 80) { context.moveTo(x, 0); context.lineTo(x, 1080); }
        for (let y = 0; y <= 1080; y += 80) { context.moveTo(0, y); context.lineTo(1920, y); }
        context.stroke();
        label(config.name.slice(0, 40), 225, 22, config.accent, true);
        // Leave the screen center clear for swaylock's native password indicator.
        const realName = GLib.get_real_name().trim();
        label((!realName || realName === 'Unknown' ? GLib.get_user_name() : realName).slice(0, 40),
            375, 42, '#eef4fa', true);
        label('Session locked', 415, 18, '#9aafbd');
        label('Type your password to unlock', 700, 20, '#d1dfe8');
        label('Enter to unlock  ·  Esc to clear', 735, 15, '#8da2b2');
        surface.writeToPNG(path);
        return path;
    } catch (error) {
        GLib.unlink(path); GLib.rmdir(directory);
        throw error;
    } finally {
        context.$dispose(); surface.finish();
    }
}

export function removeLockBackground(path: string): void {
    GLib.unlink(path);
    GLib.rmdir(GLib.path_get_dirname(path));
}
