import {Gio, GLib} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
export type SoundMode = 'dynamic' | 'game' | 'movie' | 'music' | 'voice' | 'custom1' | 'custom2' | 'custom3';
export type CustomSlot = 'custom1' | 'custom2' | 'custom3';
/** Result of `dev-os-speaker get`: the real PipeWire outputs, the saved settings and what the filter graph is really doing. */
export interface SpeakerState {
    supported: boolean; reason: string;
    speakers: {name: string; title: string}[]; device: string;
    /** "AI Noise-Canceling Speaker": the voice-band filter. */
    voice: boolean; mode: SoundMode; smart: boolean;
    /** Volume Booster: extra gain into a soft saturator. */
    boost: boolean;
    /** Bass, mid, treble in dB per custom slot. */
    custom: Record<CustomSlot, [number, number, number]>;
    /** The mode in use right now (Voice while an app records and the smart switch is on). */
    effective: SoundMode;
    running: boolean; active: boolean;
    filters: {available: boolean; reason: string};
    warning: string;
}
export type SpeakerAction = 'get' | 'voice' | 'boost' | 'mode' | 'smart' | 'device' | 'custom';
export interface SpeakerControls {request(action: SpeakerAction, ...args: string[]): Promise<SpeakerState>; destroy(): void;}
export const unsupportedSpeaker: SpeakerState = {supported: false, reason: '', speakers: [], device: '', voice: false, boost: false, mode: 'dynamic', smart: true, custom: {custom1: [0, 0, 0], custom2: [0, 0, 0], custom3: [0, 0, 0]}, effective: 'dynamic', running: false, active: false, filters: {available: false, reason: ''}, warning: ''};
/** The backend is equalizer curves, not Dolby Atmos, so the descriptions say what each curve does. */
export const soundModes: Record<SoundMode, {title: string; description: string}> = {
    dynamic: {title: 'Dynamic', description: 'No sound processing. Audio plays as it is.'},
    game: {title: 'Game', description: 'Lifts the upper mids and treble so footsteps and effects stand out.'},
    movie: {title: 'Movie', description: 'Fuller bass and clearer highs for film soundtracks.'},
    music: {title: 'Music', description: 'A balanced curve with warmer bass and brighter highs.'},
    voice: {title: 'Voice', description: 'Pulls back the bass and lifts the voice range so every word is clear.'},
    custom1: {title: 'Custom 1', description: 'Your own bass, mid and treble levels.'},
    custom2: {title: 'Custom 2', description: 'Your own bass, mid and treble levels.'},
    custom3: {title: 'Custom 3', description: 'Your own bass, mid and treble levels.'},
};
export class Speaker implements SpeakerControls {
    private processes = new Set<Gio.Subprocess>(); private disposed = false;
    request(action: SpeakerAction, ...args: string[]): Promise<SpeakerState> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Sound settings closed.')); return;}
            try {
                const local = `${ROOT}/bin/dev-os-speaker`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-speaker');
                if (!helper) throw new Error('Sound effects are not installed.');
                const child = Gio.Subprocess.new(['python3', helper, action, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE); this.processes.add(child);
                let timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 90, () => {timer = 0; child.force_exit(); return GLib.SOURCE_REMOVE;});
                child.communicate_utf8_async(null, null, (_source, result) => {
                    if (timer) GLib.source_remove(timer); this.processes.delete(child);
                    try {const [, out, err] = child.communicate_utf8_finish(result); const response = JSON.parse(out || '{}'); if (!child.get_successful() || response.ok !== true) throw new Error(response.error || err || 'Sound settings failed.'); resolve(response as SpeakerState);} catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    destroy() {this.disposed = true; for (const child of this.processes) child.force_exit(); this.processes.clear();}
}
