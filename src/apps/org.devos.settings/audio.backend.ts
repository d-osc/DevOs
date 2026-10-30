import {Gio, GLib} from '@dev-os/core/base';

export type AudioKind = 'sink' | 'source' | 'sink-input';
export interface AudioItem {id: number; name: string; title: string; volume: number; muted: boolean; device?: number;}
export interface AudioState {outputs: AudioItem[]; inputs: AudioItem[]; applications: AudioItem[]; defaultOutput: string; defaultInput: string;}
export interface AudioControls {load(): Promise<AudioState>; volume(kind: AudioKind, id: number, value: number): Promise<void>; mute(kind: AudioKind, id: number, muted: boolean): Promise<void>; select(kind: 'sink' | 'source', name: string): Promise<void>; route(id: number, output: number): Promise<void>; destroy(): void;}
interface PulseItem {index: number; name?: string; description?: string; mute?: boolean; sink?: number; volume?: Record<string, {value: number}>; properties?: Record<string, string>;}
export function audioItem(item: PulseItem): AudioItem {
    const channels = Object.values(item.volume ?? {}).map(channel => channel.value / 65536 * 100).filter(Number.isFinite);
    return {id: item.index, name: item.name ?? String(item.index), title: item.description || item.properties?.['application.name'] || item.properties?.['media.name'] || item.name || 'Application', volume: channels.length ? Math.round(channels.reduce((a, b) => a + b, 0) / channels.length) : 0, muted: item.mute === true, device: item.sink};
}
export class LinuxAudio implements AudioControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    private run(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Sound settings closed.')); return;}
            try {
                const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE}); launcher.setenv('LC_ALL', 'C', true);
                const child = launcher.spawnv(['pactl', ...args]); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(null, null, (_source, result) => {if (timer) GLib.source_remove(timer); this.processes.delete(child); try {const [, out, err] = child.communicate_utf8_finish(result); if (!child.get_successful()) throw new Error(err?.trim() || 'The audio service did not respond.'); resolve(out || '');} catch (reason) {reject(reason);}});
            } catch (reason) {reject(reason);}
        });
    }
    async load(): Promise<AudioState> {
        const [sinks, sources, streams, info] = await Promise.all(['sinks', 'sources', 'sink-inputs'].map(type => this.run(['--format=json', 'list', type])).concat(this.run(['--format=json', 'info'])));
        const inputs = JSON.parse(sources) as PulseItem[], details = JSON.parse(info) as {default_sink_name?: string; default_source_name?: string};
        return {outputs: (JSON.parse(sinks) as PulseItem[]).map(audioItem), inputs: inputs.filter(input => !input.name?.endsWith('.monitor')).map(audioItem), applications: (JSON.parse(streams) as PulseItem[]).map(audioItem), defaultOutput: details.default_sink_name ?? '', defaultInput: details.default_source_name ?? ''};
    }
    private id(value: number) {if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid audio device.'); return String(value);}
    async volume(kind: AudioKind, id: number, value: number) {if (!Number.isFinite(value)) throw new Error('Invalid volume.'); await this.run([`set-${kind}-volume`, this.id(id), `${Math.round(Math.max(0, Math.min(100, value)))}%`]);}
    async mute(kind: AudioKind, id: number, muted: boolean) {await this.run([`set-${kind}-mute`, this.id(id), muted ? '1' : '0']);}
    async select(kind: 'sink' | 'source', name: string) {if (!name || name.startsWith('-')) throw new Error('Invalid audio device.'); await this.run([`set-default-${kind}`, name]);}
    async route(id: number, output: number) {await this.run(['move-sink-input', this.id(id), this.id(output)]);}
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
