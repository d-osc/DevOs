import {Gio, GLib, activeFamily, activeTheme, paletteFor, type ThemeFamily, type ThemeName} from '@dev-os/core';
import type {Config} from '@dev-os/config';
import {createLockBackground, removeLockBackground} from './lock-background.js';

export function lockArguments(image: string, theme: ThemeName = activeTheme(), family: ThemeFamily = activeFamily()): string[] {
    const palette = paletteFor(theme, family);
    const hex = (color: string) => color.slice(1);
    const accent = hex(palette.accentFg), background = hex(theme === 'dark' ? palette.s0 : palette.s1);
    const text = hex(palette.fgStrong), error = hex(palette.error), warning = hex(palette.warning);
    return ['swaylock', '--config', '/dev/null', '--image', `:${image}`, '--scaling', 'fit', '--color', background,
        '--ignore-empty-password', '--show-failed-attempts', '--indicator-idle-visible',
        '--indicator-caps-lock', '--show-keyboard-layout', '--indicator-radius', '58',
        '--indicator-thickness', '3', '--font', 'Sans', '--font-size', '16',
        '--inside-color', `${background}ee`, '--ring-color', `${accent}99`, '--line-color', '00000000',
        '--separator-color', '00000000', '--text-color', text, '--key-hl-color', accent,
        '--bs-hl-color', warning, '--inside-ver-color', background, '--ring-ver-color', accent,
        '--text-ver-color', text, '--line-ver-color', '00000000',
        '--inside-wrong-color', background, '--ring-wrong-color', error,
        '--text-wrong-color', error, '--line-wrong-color', '00000000',
        '--inside-clear-color', background, '--ring-clear-color', accent,
        '--text-clear-color', text, '--line-clear-color', '00000000'];
}

/** Keep the locker independent of shell shutdown; only PAM/compositor may unlock the session. */
export class LockScreen {
    private process: Gio.Subprocess | undefined;
    private secured = false;
    private coverSupported = false;
    private waiting: Array<(secured: boolean) => void> = [];
    private notify(secured: boolean) {
        this.secured = secured;
        const waiting = this.waiting; this.waiting = [];
        waiting.forEach(ready => ready(secured));
    }

    /** `onReady` fires once the lock surface is up, or at once when it already is or cannot be shown. */
    start(config: Config, report: (message: string) => void, onReady?: (secured: boolean) => void): boolean {
        if (this.process) {
            if (this.secured) { if (this.coverSupported) this.process.send_signal(12); onReady?.(true); }
            else if (onReady) this.waiting.push(onReady);
            return true;
        } // SIGUSR2 restores the clock cover; never unlocks.
        if (!GLib.find_program_in_path('swaylock')) {
            report('Lock screen requires swaylock. Install it with: sudo apt install swaylock');
            onReady?.(false);
            return false;
        }
        let image: string | undefined;
        if (onReady) this.waiting.push(onReady);
        try {
            const help = Gio.Subprocess.new(['swaylock', '--help'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            const [, stdout, stderr] = help.communicate_utf8(null, null);
            const readiness = `${stdout ?? ''}${stderr ?? ''}`.includes('--ready-fd');
            this.coverSupported = `${stdout ?? ''}${stderr ?? ''}`.includes('DEV_OS_LOCK_COVER');
            image = createLockBackground(config);
            const launcher = new Gio.SubprocessLauncher({flags:
                readiness ? Gio.SubprocessFlags.STDOUT_PIPE : Gio.SubprocessFlags.NONE});
            launcher.setenv('DEV_OS_LOCK_CLOCK', '1', true);
            // The patched swaylock draws the clock; give it readable colors for the wallpaper of the active theme.
            launcher.setenv('DEV_OS_LOCK_CLOCK_COLOR', paletteFor(activeTheme(), activeFamily()).fgStrong.slice(1), true);
            launcher.setenv('DEV_OS_LOCK_CLOCK_MUTED', paletteFor(activeTheme(), activeFamily()).fgMuted.slice(1), true);
            launcher.setenv('DEV_OS_LOCK_COVER', this.coverSupported ? '1' : '0', true);
            const process = launcher.spawnv([...lockArguments(image), ...(readiness ? ['--ready-fd', '1'] : [])]);
            this.process = process;
            if (readiness) {
                const output = new Gio.DataInputStream({base_stream: process.get_stdout_pipe()!});
                output.read_line_async(GLib.PRIORITY_DEFAULT, null, (_stream, result) => {
                    if (this.process !== process) { output.close(null); return; }
                    try {
                        const [line] = output.read_line_finish(result);
                        if (line !== null) { this.secured = true; report('Session locked'); }
                    } catch (error) { report(`Lock screen readiness failed: ${String(error)}`); }
                    finally { output.close(null); this.notify(this.secured); }
                });
            } else this.notify(false); // Legacy lockers cannot confirm readiness for lid blanking.
            const wallpaper = image;
            process.wait_async(null, (_source, result) => {
                try {
                    process.wait_finish(result);
                    if (!process.get_successful()) report('Lock screen failed. Check swaylock and compositor support.');
                } catch (error) { report(`Lock screen failed: ${String(error)}`); }
                finally { this.process = undefined; this.notify(false); removeLockBackground(wallpaper); }
            });
            return true;
        } catch (error) {
            if (image) removeLockBackground(image);
            report(`Could not lock session: ${String(error)}`);
            this.notify(false);
            return false;
        }
    }
}
