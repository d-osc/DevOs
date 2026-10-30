import {Gio, GLib} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
export interface Disk {name: string; path: string; type: string; size: number; fstype: string | null; label: string | null; mountpoints: (string | null)[]; ro: boolean; model: string | null; tran: string | null; pttype: string | null; fsavail: number | null; fsused: number | null; uuid: string | null; blocked?: string; children?: Disk[];}
export interface DiskState {devices: Disk[]; wsl: boolean;}
export interface DiskControls {request(action: 'get'): Promise<DiskState>; destroy(): void;}
export class Disks implements DiskControls {
    private processes = new Set<Gio.Subprocess>();
    request(action: 'get'): Promise<DiskState> {
        const local = `${ROOT}/bin/dev-os-disks`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-disks');
        if (!helper) return Promise.reject(new Error('Disk tools are not installed.'));
        const child = Gio.Subprocess.new(['d', helper], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        this.processes.add(child);
        return new Promise((resolve, reject) => child.communicate_utf8_async(JSON.stringify({action}), null, (_source, result) => {
            this.processes.delete(child);
            try {const [, output] = child.communicate_utf8_finish(result); const data = JSON.parse(output || '{}'); if (!data.ok) throw new Error(data.error || 'Disk inventory failed.'); resolve(data);} catch (error) {reject(error);}
        }));
    }
    destroy() {for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
