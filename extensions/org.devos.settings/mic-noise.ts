import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export type NoiseMode = 'authentic' | 'general' | 'conference';
/** Result of `dev-os-microphone get`: the real PipeWire microphones, the saved mode and what is really running. */
export interface MicNoiseState {
    supported: boolean; reason: string;
    mode: NoiseMode;
    /** The mode that is really processing the default input right now (authentic when nothing is). */
    active: NoiseMode; running: boolean;
    sources: {name: string; title: string}[]; device: string;
    /** The WebRTC noise suppression plugin is installed; without it only Authentic Recording is offered. */
    noise: {available: boolean; reason: string};
    warning: string;
}
export type MicNoiseAction = 'get' | 'mode' | 'device';
export interface MicNoiseControls {request(action: MicNoiseAction, ...args: string[]): Promise<MicNoiseState>; destroy(): void;}
export const unsupportedMicNoise: MicNoiseState = {supported: false, reason: '', mode: 'authentic', active: 'authentic', running: false, sources: [], device: '', noise: {available: false, reason: ''}, warning: ''};
/** Texts follow the MyASUS card. The backend is WebRTC noise suppression and gain control, so the Multi-presenter text says what it really does. */
export const noiseModes: Record<NoiseMode, {title: string; description: string}> = {
    general: {title: '360° Recording Mode', description: 'Reduce ambient noise from your surroundings to capture the best tone and audio details from all around you.'},
    authentic: {title: 'Authentic Recording', description: 'Turn off AI noise-canceling functions.'},
    conference: {title: 'Multi-presenter Mode', description: 'Filters out ambient noise and evens out the volume of everyone in a shared space, near or far, so the whole meeting is heard. It does not tell speakers apart.'},
};
export class MicNoise implements MicNoiseControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    request(action: MicNoiseAction, ...args: string[]): Promise<MicNoiseState> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Microphone settings closed.')); return;}
            try {
                const local = `${ROOT}/bin/dev-os-microphone`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-microphone');
                if (!helper) throw new Error('Microphone noise canceling is not installed.');
                const child = Gio.Subprocess.new(['python3', helper, action, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 90, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(null, null, (_source, result) => {
                    if (timer) GLib.source_remove(timer); this.processes.delete(child);
                    try {const [, out, err] = child.communicate_utf8_finish(result); const response = JSON.parse(out || '{}'); if (!child.get_successful() || response.ok !== true) throw new Error(response.error || err || 'Microphone settings failed.'); resolve(response as MicNoiseState);} catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
