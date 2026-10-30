import Cairo from 'cairo';
import {GLib} from '@dev-os/core/base';
import {activeFamily, activeTheme, paletteFor, type ThemeFamily, type ThemeName} from '@dev-os/core/theme';
import type {Config} from '@dev-os/config';

/** Wallpaper only; authentication and the central password indicator belong to swaylock. */
export function createLockBackground(config: Pick<Config, 'name'>, theme: ThemeName = activeTheme(), family: ThemeFamily = activeFamily()): string {
    const palette = paletteFor(theme, family), accent = palette.accentFg;
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
    const rounded = (x: number, y: number, width: number, height: number, radius: number) => {
        context.newPath();
        context.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
        context.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
        context.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
        context.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
        context.closePath();
    };
    const glow = (x: number, y: number, radius: number, opacity: number) => {
        const value = Number.parseInt(accent.slice(1), 16);
        const gradient = new Cairo.RadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStopRGBA(0, ((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, opacity);
        gradient.addColorStopRGBA(1, 0, 0, 0, 0);
        context.setSource(gradient); context.paint();
    };
    try {
        color(theme === 'dark' ? palette.s0 : palette.s1); context.paint();
        glow(300, 190, 1050, .18); glow(1720, 940, 1000, .11);
        // Broad, quiet contours frame the identity without competing with input.
        context.setLineWidth(1.2);
        for (let i = 0; i < 10; i++) {
            color(accent, .025 + i * .003);
            context.moveTo(-120, 480 + i * 36);
            context.curveTo(430, 180 + i * 18, 1350, 1220 + i * 24, 2040, 610 + i * 34);
            context.stroke();
        }
        color('#000000', theme === 'dark' ? .3 : .1); rounded(650, 222, 620, 626, 34); context.fill();
        color(palette.s1, .94); rounded(650, 210, 620, 626, 34); context.fillPreserve();
        color(accent, .14); context.setLineWidth(1); context.stroke();
        // Avatar, username, and the real swaylock indicator share one centre line.
        color(accent, .09); context.arc(960, 293, 39, 0, Math.PI * 2); context.fill();
        color(accent, .3); context.arc(960, 293, 39, 0, Math.PI * 2); context.stroke();
        color(accent, .9); context.arc(960, 282, 10, 0, Math.PI * 2); context.fill();
        context.arc(960, 315, 21, Math.PI, Math.PI * 2); context.closePath(); context.fill();
        const realName = GLib.get_real_name().trim();
        const name = (!realName || realName === 'Unknown' ? GLib.get_user_name() : realName).slice(0, 40);
        let size = 40;
        context.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        do {context.setFontSize(size);} while (context.textExtents(name).width > 500 && --size > 22);
        label(name, 383, size, palette.fgStrong, true);
        label('Welcome back', 419, 18, palette.fgMuted);
        // The password itself and all authentication states remain native swaylock.
        color(accent, .06); context.arc(960, 540, 92, 0, Math.PI * 2); context.fill();
        color(accent, .11); context.arc(960, 540, 92, 0, Math.PI * 2); context.stroke();
        label('Enter your password', 702, 22, palette.fg);
        label('Enter to unlock  \u00b7  Esc to clear', 739, 15, palette.fgMuted);
        context.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        context.setFontSize(22); color(accent);
        context.moveTo(80, 87); context.showText(config.name.slice(0, 28));
        // Small lock badge balances the brand without introducing fake controls.
        rounded(1620, 51, 220, 50, 25); color(accent, .07); context.fillPreserve();
        color(accent, .15); context.stroke();
        color(accent, .85); context.setLineWidth(2);
        context.arc(1650, 71, 6, Math.PI, Math.PI * 2); context.stroke();
        rounded(1641, 71, 18, 15, 3); context.stroke();
        context.setFontSize(15); context.moveTo(1674, 82); context.showText('Session locked');
        label('Your workspace, on pause.', 995, 17, palette.fgMuted);
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
