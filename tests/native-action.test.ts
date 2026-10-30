import {Gio, GLib} from '@dev-os/core/base';
import {NativeAction} from '../src/legacy/native-action.js';
function assert(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
const wait = (ms: number) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    const directory = GLib.dir_make_tmp('devos-native-action-XXXXXX'), program = `${directory}/runner`, calls = `${directory}/calls`;
    const previous = GLib.getenv('DEVLANG_RUN');
    GLib.file_set_contents(program, `#!/bin/sh\nIFS= read -r request\nprintf '%s\\n' "$request" >> '${calls}'\ncase "$request" in *deny*) printf '%s\\n' '{"error":"fixture denied"}'; exit 7;; esac\nprintf '%s\\n' '{"ok":true}'\n`);
    const chmod = Gio.Subprocess.new(['chmod', '755', program], Gio.SubprocessFlags.NONE); chmod.wait_check(null);
    GLib.setenv('DEVLANG_RUN', program, true);
    const action = new NativeAction('unused-fixture.dev');
    try {
        let denied = false;
        try {await action.run({action: 'deny'});} catch (error) {denied = String(error).includes('fixture denied');}
        assert(denied, 'Action error was hidden');
        await wait(1200);
        assert(new TextDecoder().decode(GLib.file_get_contents(calls)[1]).trim().split('\n').length === 1, 'Failed mutation was replayed');
        await action.run({action: 'volume', value: 31.5});
        const requests = new TextDecoder().decode(GLib.file_get_contents(calls)[1]).trim().split('\n').map(line => JSON.parse(line) as {action: string; value?: number});
        assert(requests.length === 2 && requests[1].action === 'volume' && requests[1].value === 31.5, 'Transport changed action data');
        action.destroy();
        let disposed = false;try {await action.run({action: 'mute'});} catch {disposed = true;}
        assert(disposed, 'Disposed client started another action');
        print('PASS one-shot native action IPC preserves requests/errors and never replays failed mutations');
    } finally {
        action.destroy();
        if (previous === null) GLib.unsetenv('DEVLANG_RUN'); else GLib.setenv('DEVLANG_RUN', previous, true);
        for (const path of [program, calls]) Gio.File.new_for_path(path).delete(null);
        Gio.File.new_for_path(directory).delete(null);
    }
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
