import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export const systemPages = [
    {id: 'display', title: 'Display', icon: 'video-display-symbolic', description: 'Connected screens, resolution, scaling and arrangement'},
    {id: 'sound', title: 'Sound', icon: 'audio-volume-high-symbolic', description: 'Output volume, mute, input and audio devices'},
    {id: 'power', title: 'Power & battery', icon: 'battery-good-symbolic', description: 'Battery status and supported power profiles'},
    {id: 'storage', title: 'Storage', icon: 'drive-harddisk-symbolic', description: 'Disk usage, available space and your files'},
    {id: 'time', title: 'Date & time', icon: 'preferences-system-time-symbolic', description: 'Time zone, automatic time and the system clock'},
    {id: 'language', title: 'Language', icon: 'input-keyboard-symbolic', description: 'Keyboard languages and switching shortcuts'},
    {id: 'core', title: 'Desktop', icon: 'preferences-desktop-symbolic', description: 'Desktop appearance and session preferences'},
    {id: 'about', title: 'About', icon: 'help-about-symbolic', description: 'DevOs version, device specifications and runtime information'},
] as const;
export type SystemPage = 'system' | 'display' | 'sound' | 'power' | 'storage' | 'about';
export const isSystemPage = (page: string): page is SystemPage => ['system', 'display', 'sound', 'power', 'storage', 'about'].includes(page);
export interface SystemState {
    hostManaged: boolean; hostname: string; os: string; kernel: string; architecture: string; cpu: string; processors: number; memory: number; session: string;
    desktopBuild: Record<string, unknown>;
    storage: {path: string; total: number; used: number; free: number}[];
    batteries: {name: string; status: string; percent: number | null}[];
    power: {available: boolean; active: string; profiles: string[]; degraded: string; error: string};
    tools: Record<string, boolean>; hostSettings: boolean;
}
export interface SystemControls {load(): Promise<SystemState>; open(page: string, host: boolean): Promise<void>; profile(id: string): Promise<SystemState>; destroy(): void;}
export class LinuxSystem implements SystemControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    private request(value: object): Promise<{state: SystemState}> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('System settings closed.')); return;}
            try {
                const process = Gio.Subprocess.new(['d', `${ROOT}/bin/dev-os-system`], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                this.processes.add(process);
                let timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 75, () => {timeout = 0; process.force_exit(); return GLib.SOURCE_REMOVE;});
                process.communicate_utf8_async(JSON.stringify(value), null, (_source, result) => {
                    if (timeout) GLib.source_remove(timeout); this.processes.delete(process);
                    try {const [, stdout, stderr] = process.communicate_utf8_finish(result); const response = JSON.parse(stdout || '{}'); if (!process.get_successful() || response.ok !== true) throw new Error(response.error || stderr || 'System settings failed.'); resolve(response);}
                    catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    async load() {return (await this.request({action: 'get'})).state;}
    async open(page: string, host: boolean) {await this.request({action: 'open', page, host});}
    async profile(id: string) {return (await this.request({action: 'power', profile: id})).state;}
    destroy() {this.disposed = true; for (const process of this.processes) process.force_exit(); this.processes.clear();}
}
export const formatBytes = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
