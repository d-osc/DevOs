import {Gio, GLib} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
export interface App {id: string; name: string; description?: string; category?: string; icon?: string; version?: string; origin?: string; package?: string; desktopId?: string; website?: string; removable?: boolean; registry?: import('./registry.js').RegistryDetails; userPackage?: string;}
export interface StoreState {available: boolean; connected: boolean; installed: App[]; catalog: App[]; updates?: App[]; sourceName?: string; message?: string;}
export type Action = 'get' | 'browse' | 'updates' | 'install' | 'remove' | 'update';
export interface StoreControls {busy: boolean; request(action: Action, id?: string): Promise<StoreState>;}
export class AppStore implements StoreControls {
    busy = false;
    private disposed = false;
    private processes = new Set<Gio.Subprocess>();
    async request(action: Action, id?: string): Promise<StoreState> {
        if (this.disposed) throw new Error('App Store closed.');
        if (this.busy) throw new Error('Wait for the current operation to finish.');
        this.busy = true;
        try {
            const local = `${ROOT}/bin/dev-os-app-store`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-app-store');
            if (!helper) throw new Error('App Store service is not installed.');
            const process = Gio.Subprocess.new(['d', helper], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            this.processes.add(process);
            return await new Promise<StoreState>((resolve, reject) => process.communicate_utf8_async(JSON.stringify({action, id}), null, (_source, result) => {
                this.processes.delete(process);
                try {const [, output] = process.communicate_utf8_finish(result); const data = JSON.parse(output || '{}'); if (!data.ok) throw new Error(data.error || 'App Store disconnected.'); resolve(data);} catch (error) {reject(error);}
            }));
        } finally {this.busy = false;}
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
