import {Gio, GLib} from '@dev-os/core';
import type {Config} from '@dev-os/config';
import {createLockBackground, removeLockBackground} from './lock-background.js';

export function lockArguments(config: Pick<Config, 'accent' | 'background'>, image: string): string[] {
    const accent = config.accent.slice(1);
    const background = config.background.slice(1);
    return ['swaylock', '--config', '/dev/null', '--image', `:${image}`, '--scaling', 'fit', '--color', background,
        '--ignore-empty-password', '--show-failed-attempts', '--indicator-idle-visible',
        '--indicator-caps-lock', '--show-keyboard-layout', '--indicator-radius', '58',
        '--indicator-thickness', '4', '--font', 'Sans', '--font-size', '16',
        '--inside-color', `${background}ee`, '--ring-color', `${accent}88`, '--line-color', '00000000',
        '--separator-color', '00000000', '--text-color', 'eef4fa', '--key-hl-color', accent,
        '--bs-hl-color', 'e9bb79', '--inside-ver-color', background, '--ring-ver-color', accent,
        '--text-ver-color', 'eef4fa', '--line-ver-color', '00000000',
        '--inside-wrong-color', background, '--ring-wrong-color', 'ed7d8c',
        '--text-wrong-color', 'ed7d8c', '--line-wrong-color', '00000000',
        '--inside-clear-color', background, '--ring-clear-color', accent,
        '--text-clear-color', 'eef4fa', '--line-clear-color', '00000000'];
}

/** Keep the locker independent of shell shutdown; only PAM/compositor may unlock the session. */
export class LockScreen {
    private process: Gio.Subprocess | undefined;

    start(config: Config, report: (message: string) => void): boolean {
        if (this.process) return true;
        if (!GLib.find_program_in_path('swaylock')) {
            report('Lock screen requires swaylock. Install it with: sudo apt install swaylock');
            return false;
        }
        let image: string | undefined;
        try {
            const help = Gio.Subprocess.new(['swaylock', '--help'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            const [, stdout, stderr] = help.communicate_utf8(null, null);
            const readiness = `${stdout ?? ''}${stderr ?? ''}`.includes('--ready-fd');
            image = createLockBackground(config);
            const process = Gio.Subprocess.new([...lockArguments(config, image), ...(readiness ? ['--ready-fd', '1'] : [])],
                readiness ? Gio.SubprocessFlags.STDOUT_PIPE : Gio.SubprocessFlags.NONE);
            this.process = process;
            if (readiness) {
                const output = new Gio.DataInputStream({base_stream: process.get_stdout_pipe()!});
                output.read_line_async(GLib.PRIORITY_DEFAULT, null, (_stream, result) => {
                    try {
                        const [line] = output.read_line_finish(result);
                        if (line !== null) report('Session locked');
                    } catch (error) { report(`Lock screen readiness failed: ${String(error)}`); }
                    finally { output.close(null); }
                });
            }
            const wallpaper = image;
            process.wait_async(null, (_source, result) => {
                try {
                    process.wait_finish(result);
                    if (!process.get_successful()) report('Lock screen failed. Check swaylock and compositor support.');
                } catch (error) { report(`Lock screen failed: ${String(error)}`); }
                finally { this.process = undefined; removeLockBackground(wallpaper); }
            });
            return true;
        } catch (error) {
            if (image) removeLockBackground(image);
            report(`Could not lock session: ${String(error)}`);
            return false;
        }
    }
}
