import {MediaData} from '../src/apps/org.devos.camera/capture.js';
import {Gio, GLib} from '@dev-os/core/base';
import {appService, closeAppService} from '@dev-os/runtime/app-service';
import {FileBrowser} from '../src/apps/org.devos.files/model.js';
import {EditorDocument} from '../src/apps/org.devos.editor/document.js';
import {AppPreferences} from '../src/app-data.js';

function assert(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
const wait = (milliseconds: number) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const signal = (pid: number, name: string) => Gio.Subprocess.new(['kill', `-${name}`, String(pid)], Gio.SubprocessFlags.NONE);
const loop = new GLib.MainLoop(null, false);
let failed: unknown;
async function run() {
    const directory = GLib.dir_make_tmp('devos-client-test-XXXXXX');
    GLib.setenv('HOME', directory, true);
    GLib.setenv('XDG_CONFIG_HOME', `${directory}/config`, true);
    GLib.setenv('XDG_DATA_HOME', `${directory}/data`, true);
    GLib.setenv('DEV_OS_APP', 'files', true);
    const service = appService(), identity = await service.request('ping');
    assert(identity.pid !== new Gio.Credentials().get_unix_pid(), 'UI and data must have distinct PIDs');
    let ticks = 0;
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {ticks++; return GLib.SOURCE_CONTINUE;});
    const path = `${directory}/example.ts`;
    GLib.file_set_contents(path, 'initial');
    const document = new EditorDocument();
    let opened = '';
    const files = new FileBrowser(async (uri, cancel) => {
        assert(cancel instanceof Gio.Cancellable, 'IPC callback restores a cancellable'); opened = uri;
    });
    const preferences = new AppPreferences();
    try {
        await preferences.initialize();
        assert(preferences.list().some(info => info.manifest.id === 'org.devos.files'), 'Preferences arrive as a view snapshot');
        assert(await document.load(path), 'File load completes across IPC');
        document.edit('edited');
        assert(document.dirty && document.content === 'edited', 'Typing updates the view immediately');
        assert(await document.save(), 'Saving runs in the data service');
        assert(new TextDecoder().decode(GLib.file_get_contents(path)[1]) === 'edited', 'Saved bytes match the edit');
        assert(await files.navigate(directory), 'File model receives directory state');
        assert(files.state.entries.some(entry => entry.name === 'example.ts' && entry.icon), 'File metadata/icons survive IPC');
        assert(await files.openPath(path), 'UI launch callback round-trips to the worker');
        assert(opened.endsWith('/example.ts'), 'UI launch receives a URI');
        // Exercise real GStreamer streams in the worker without opening physical hardware.
        const until = async (ready: () => boolean) => {for (let attempt = 0; attempt < 100; attempt++) {if (ready()) return; await wait(50);} throw new Error('Media service did not respond');};
        let frames = 0, photo = '', recording = '', peaks = 0;
        const camera = new MediaData('camera', message => {if (message.startsWith('Saved · ')) photo = message.slice(8);}, () => {}, () => {}, jpeg => {assert(jpeg.startsWith('/9j/'), 'Preview is JPEG data'); frames++;});
        const microphone = new MediaData('microphone', message => {if (message.startsWith('Saved · ')) recording = message.slice(8);}, level => {if (level > 0) peaks++;}, () => {}, () => {});
        try {
            await camera.start(-1, false, true); await until(() => frames > 0);
            camera.photo(); await until(() => !!photo);
            assert(photo.startsWith(directory + '/'), 'Camera writes only inside the disposable home');
            assert(GLib.file_get_contents(photo)[1][0] === 255, 'Worker produced a photo');
            await microphone.start(-1, true, true); await until(() => peaks > 0);
            microphone.stop(); await until(() => !!recording);
            assert(recording.startsWith(directory + '/'), 'Microphone writes only inside the disposable home');
            assert(new TextDecoder().decode(GLib.file_get_contents(recording)[1].slice(0, 4)) === 'RIFF', 'Worker finalized WAV audio');
        } finally {camera.destroy(); microphone.destroy();}
        signal(identity.pid, 'STOP');
        await wait(80);
        const before = ticks;
        const pending = files.refresh();
        await wait(150);
        assert(ticks > before + 5, 'A stopped data worker cannot freeze the UI event loop');
        signal(identity.pid, 'CONT');
        assert(await pending, 'Pending request resumes when the worker resumes');
        signal(identity.pid, 'KILL');
        let rejected = false;
        try {await service.request('ping');} catch {rejected = true;}
        assert(rejected, 'Service death rejects pending requests');
        const after = ticks; await wait(80);
        assert(ticks > after, 'UI remains responsive after service death');
        print('PASS: separate data PID, real snapshots/callbacks, editor save, remote camera/audio streams, frozen-service responsiveness and crash errors');
    } finally {
        if (GLib.file_test(`/proc/${identity.pid}`, GLib.FileTest.IS_DIR)) signal(identity.pid, 'CONT');
        files.dispose(); document.dispose(); preferences.dispose(); GLib.source_remove(timer); closeAppService();
        const {removeTree} = await import('@dev-os/core/base'); removeTree(directory);
    }
}
void run().catch(error => {failed = error;}).finally(() => loop.quit());
loop.run();
if (failed) throw failed;
