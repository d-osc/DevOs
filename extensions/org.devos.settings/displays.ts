import {Gio, GLib} from '@dev-os/core';

export interface OutputMode {width: number; height: number; refresh: number; current?: boolean; preferred?: boolean;}
export interface DisplayOutput {name: string; description: string; enabled: boolean; modes: OutputMode[]; position: {x: number; y: number}; scale: number; transform: string;}
export interface DisplayChange {name: string; mode: string; scale: number; transform: string; x: number; y: number;}
export interface DisplayControls {load(): Promise<DisplayOutput[]>; preview(change: DisplayChange): Promise<void>; keep(): void; revert(): Promise<void>; destroy(): void;}
export const modeId = (mode: OutputMode) => `${mode.width}x${mode.height}@${mode.refresh}Hz`;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const transforms = ['normal', '90', '180', '270', 'flipped', 'flipped-90', 'flipped-180', 'flipped-270'];
export function changeArgs(change: DisplayChange, outputs: DisplayOutput[]): string[] {
    const output = outputs.find(output => output.name === change.name);
    if (!output?.enabled || !output.modes.some(mode => modeId(mode) === change.mode)) throw new Error('Select a connected display and one of its supported modes.');
    if (!Number.isFinite(change.scale) || change.scale < 0.5 || change.scale > 4 || !transforms.includes(change.transform) || ![change.x, change.y].every(value => Number.isInteger(value) && Math.abs(value) <= 32768)) throw new Error('Invalid display scale, rotation or position.');
    return ['--output', output.name, '--on', '--mode', change.mode, '--scale', String(change.scale), '--transform', change.transform, '--pos', `${change.x},${change.y}`];
}
export function restoreArgs(outputs: DisplayOutput[]): string[] {
    return outputs.flatMap(output => {
        if (!output.enabled) return ['--output', output.name, '--off'];
        const mode = output.modes.find(mode => mode.current);
        if (!mode) throw new Error('Cannot safely restore the current display mode.');
        return ['--output', output.name, '--on', '--mode', modeId(mode), '--scale', String(output.scale), '--transform', output.transform, '--pos', `${output.position.x},${output.position.y}`];
    });
}
export function runDisplay(argv: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            const child = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
            child.communicate_utf8_async(null, null, (_source, result) => {
                if (timer) GLib.source_remove(timer);
                try {const [, out, err] = child.communicate_utf8_finish(result); if (!child.get_successful()) throw new Error(err?.trim() || 'The compositor rejected the display configuration.'); resolve(out || '');} catch (error) {reject(error);}
            });
        } catch (error) {reject(error);}
    });
}
export class LinuxDisplays implements DisplayControls {
    private marker = ''; private rollback: string[] = []; private pending = false;
    async load(): Promise<DisplayOutput[]> {
        if (!GLib.find_program_in_path('wlr-randr')) throw new Error('Display controls are not installed. Install the DevOs wlr-randr package.');
        const value: unknown = JSON.parse(await runDisplay(['wlr-randr', '--json']));
        if (!Array.isArray(value)) throw new Error('Invalid display information from the compositor.');
        return value as DisplayOutput[];
    }
    async preview(change: DisplayChange) {
        if (this.pending) throw new Error('Keep or revert the current preview first.');
        const outputs = await this.load(), args = changeArgs(change, outputs);
        const rollback = restoreArgs(outputs);
        await runDisplay(['wlr-randr', '--dryrun', ...args]);
        // A separate process restores the layout even if Settings exits or crashes.
        const marker = `${GLib.get_user_runtime_dir()}/devos-display-${GLib.uuid_string_random()}`;
        const file = Gio.File.new_for_path(marker).create(Gio.FileCreateFlags.PRIVATE, null); file.close(null);
        const command = `sleep 30; if test -f ${quote(marker)}; then wlr-randr ${rollback.map(quote).join(' ')}; rm -f ${quote(marker)}; fi`;
        try {Gio.Subprocess.new(['/bin/sh', '-c', command], Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);} catch (error) {Gio.File.new_for_path(marker).delete(null); throw error;}
        this.marker = marker; this.rollback = rollback; this.pending = true;
        try {await runDisplay(['wlr-randr', ...args]);} catch (error) {await this.revert(); throw error;}
    }
    keep() {if (this.pending && !Gio.File.new_for_path(this.marker).query_exists(null)) {this.pending = false; throw new Error('The preview expired and was reverted. Refresh the display settings.');} if (this.marker) Gio.File.new_for_path(this.marker).delete(null); this.marker = ''; this.pending = false;}
    async revert() {if (!this.pending) return; await runDisplay(['wlr-randr', ...this.rollback]); if (this.marker && Gio.File.new_for_path(this.marker).query_exists(null)) Gio.File.new_for_path(this.marker).delete(null); this.marker = ''; this.pending = false;}
    destroy() {if (this.pending) void this.revert().catch(() => {});}
}
