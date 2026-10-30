import type {} from '@girs/gst-1.0';
import Gst from 'gi://Gst?version=1.0';
import {Gio, GLib} from '@dev-os/core/base';
import {isMicrophoneSource} from './sources.js';
export {Gst};
export type CaptureKind = 'camera' | 'microphone';
export interface CaptureDevice {title: string; device: Gst.Device;}
export function devices(kind: CaptureKind): CaptureDevice[] {
    Gst.init([]);
    const monitor = new Gst.DeviceMonitor();
    monitor.add_filter(kind === 'camera' ? 'Video/Source' : 'Audio/Source', null);
    if (!monitor.start()) throw new Error('Device discovery failed. Check GStreamer device providers and Linux drivers.');
    try {return (monitor.get_devices() ?? []).filter(device => {
        if (kind !== 'microphone') return true;
        const properties = device.get_properties();
        return isMicrophoneSource({deviceClass: properties?.get_string('device.class'),
            deviceName: properties?.get_string('device.name'), nodeName: properties?.get_string('node.name')});
    }).map(device => ({title: device.get_display_name(), device}));}
    finally {monitor.stop();}
}
export function capturePath(kind: CaptureKind): string {
    const directory = GLib.build_filenamev([GLib.get_home_dir(), kind === 'camera' ? 'Pictures' : 'Music', kind === 'camera' ? 'Camera' : 'Recordings']);
    if (GLib.mkdir_with_parents(directory, 0o700) !== 0) throw new Error('Could not create the capture folder.');
    return GLib.build_filenamev([directory, `${GLib.DateTime.new_now_local().format('%Y-%m-%d_%H-%M-%S')}-${GLib.uuid_string_random().slice(0, 8)}.${kind === 'camera' ? 'jpg' : 'wav'}`]);
}
export class Capture {
    private pipeline?: Gst.Pipeline;
    private bus?: Gst.Bus;
    private busSignal = 0;
    private folder?: string;
    private photograph?: string;
    private recording?: string;
    private stopping = false;
    private stopTimer = 0;
    private previewTimer = 0;
    constructor(private kind: CaptureKind, private status: (message: string) => void,
        private level: (value: number) => void, private ended: () => void, private preview: (jpeg: string) => void = () => {}) {Gst.init([]);}
    start(device: CaptureDevice | undefined, record: boolean, test = false): void {
        this.close();
        let launch: string;
        if (this.kind === 'camera') {
            this.folder = GLib.dir_make_tmp('devos-camera-XXXXXX');
            launch = `decodebin name=decode ! videoconvert name=convert ! tee name=t t. ! queue ! videoconvert ! videoscale add-borders=true ! videorate drop-only=true ! video/x-raw,width=640,height=480,framerate=10/1 ! jpegenc quality=75 ! appsink name=preview sync=false max-buffers=1 drop=true t. ! queue leaky=downstream max-size-buffers=1 ! valve name=shutter drop=true ! videoconvert ! jpegenc ! multifilesink name=photos async=false post-messages=true max-files=2`;
        } else {
            this.recording = record ? capturePath('microphone') : undefined;
            launch = `audioconvert name=convert ! audioresample ! level name=meter interval=100000000 post-messages=true ! ${record ? 'wavenc ! filesink name=recording' : 'fakesink sync=false'}`;
        }
        try {
            const pipeline = Gst.parse_launch(launch) as Gst.Pipeline; this.pipeline = pipeline;
            const source = test ? Gst.ElementFactory.make(this.kind === 'camera' ? 'videotestsrc' : 'audiotestsrc', 'input') : device?.device.create_element('input');
            if (!source) throw new Error('Select an available device first.');
            if (test) source.set_property('is-live', true);
            if (!pipeline.add(source) || !source.link(pipeline.get_by_name(this.kind === 'camera' ? 'decode' : 'convert')!)) throw new Error('Could not connect to the capture driver.');
            if (this.folder) pipeline.get_by_name('photos')!.set_property('location', GLib.build_filenamev([this.folder, '%05d.jpg']));
            if (this.recording) pipeline.get_by_name('recording')!.set_property('location', this.recording);
            const bus = pipeline.get_bus()!; this.bus = bus; bus.add_signal_watch();
            this.busSignal = bus.connect('message', (_bus, message: Gst.Message) => this.message(message));
            if (pipeline.set_state(Gst.State.PLAYING) === Gst.StateChangeReturn.FAILURE) throw new Error('Cannot open the device. It may be busy, disconnected or access denied.');
            this.status(this.kind === 'camera' ? 'Camera is on' : record ? 'Recording microphone' : 'Microphone is on · level test');
            if (this.kind === 'camera') this.previewTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                const sample = (pipeline.get_by_name('preview') as unknown as {emit(signal: string, timeout: number): Gst.Sample | null}).emit('try-pull-sample', 0);
                const buffer = sample?.get_buffer();
                if (buffer) this.preview(GLib.base64_encode(buffer.extract_dup(0, buffer.get_size())));
                return GLib.SOURCE_CONTINUE;
            });
        } catch (error) {this.close(); throw error;}
    }
    photo() {
        if (!this.pipeline || this.kind !== 'camera' || this.photograph) return;
        this.photograph = capturePath('camera');
        this.pipeline.get_by_name('shutter')!.set_property('drop', false);
        this.status('Taking photo…');
    }
    stop() {
        if (!this.pipeline || this.stopping) return;
        if (this.recording) {
            this.stopping = true; this.status('Saving recording…');
            this.stopTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                this.stopTimer = 0; this.status('Recording could not be finalized. Check the audio device.'); this.close(); this.ended(); return GLib.SOURCE_REMOVE;
            });
            this.pipeline.send_event(Gst.Event.new_eos());
        } else {this.close(); this.status('Capture is off'); this.ended();}
    }
    private message(message: Gst.Message) {
        if (message.type === Gst.MessageType.ERROR) {
            const [error] = message.parse_error(); this.status(`Device error: ${error?.message ?? 'Capture failed'}`); this.close(); this.ended();
        } else if (message.type === Gst.MessageType.EOS) {
            const saved = this.recording; this.recording = undefined; this.close(); this.status(saved ? `Saved · ${saved}` : 'Capture is off'); this.ended();
        } else if (message.type === Gst.MessageType.ELEMENT) {
            const data = message.get_structure();
            if (data?.get_name() === 'level') {
                const raw = data.get_value('peak') as number[] | {n_values: number; get_nth(index: number): number};
                const values = Array.isArray(raw) ? raw : Array.from({length: raw.n_values}, (_, index) => raw.get_nth(index));
                this.level(values.length ? Math.max(0, Math.min(1, Math.pow(10, Math.max(...values) / 20))) : 0);
            } else if (data?.get_name() === 'GstMultiFileSink' && this.photograph) {
                this.pipeline?.get_by_name('shutter')?.set_property('drop', true);
                const path = data.get_string('filename'), destination = this.photograph; this.photograph = undefined;
                try {
                    if (!path) throw new Error('No photo was returned by the camera.');
                    Gio.File.new_for_path(path).copy(Gio.File.new_for_path(destination), Gio.FileCopyFlags.NONE, null, null);
                    this.status(`Saved · ${destination}`);
                } catch (error) {this.status(String(error));}
            }
        }
    }
    close() {
        if (this.previewTimer) GLib.source_remove(this.previewTimer); this.previewTimer = 0;
        if (this.stopTimer) GLib.source_remove(this.stopTimer); this.stopTimer = 0;
        if (this.bus) {if (this.busSignal) this.bus.disconnect(this.busSignal); this.bus.remove_signal_watch();}
        this.bus = undefined; this.busSignal = 0;
        this.pipeline?.set_state(Gst.State.NULL); this.pipeline = undefined;
        // Aborted streams must not leave a misleading, unfinished WAV behind.
        if (this.recording) GLib.unlink(this.recording);
        if (this.folder) {
            const dir = Gio.File.new_for_path(this.folder), entries = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let entry; while ((entry = entries.next_file(null))) dir.get_child(entry.get_name()).delete(null);
            entries.close(null); dir.delete(null); this.folder = undefined;
        }
        this.photograph = undefined; this.recording = undefined; this.stopping = false; this.level(0);
    }
}

/** Device and stream ownership never leaves the data service. */
export class MediaData {
    private list: CaptureDevice[] = [];
    private capture: Capture;
    constructor(private kind: CaptureKind, status: (message: string) => void, level: (value: number) => void,
        ended: () => void, preview: (jpeg: string) => void) {
        let framePending = false, levelPending = false;
        this.capture = new Capture(kind, status, value => {
            if (levelPending) return; levelPending = true;
            void Promise.resolve(level(value)).catch(() => {}).finally(() => {levelPending = false;});
        }, ended, jpeg => {
            // At most one preview is in flight, even if the UI is stopped or busy animating.
            if (framePending) return; framePending = true;
            void Promise.resolve(preview(jpeg)).catch(() => {}).finally(() => {framePending = false;});
        });
    }
    async folder() {return Gio.File.new_for_path(GLib.path_get_dirname(capturePath(this.kind))).get_uri();}
    async devices() {this.list = devices(this.kind); return this.list.map((item, id) => ({id, title: item.title}));}
    async start(id: number, record: boolean, test = false) {this.capture.start(this.list[id], record, test);}
    photo() {this.capture.photo();}
    stop() {this.capture.stop();}
    destroy() {this.capture.close();}
}
