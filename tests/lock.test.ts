import {Gio, GLib} from '@dev-os/core';
import {DEFAULTS} from '@dev-os/config';
import {LockScreen, lockArguments} from '@dev-os/runtime/lock';
import {createLockBackground, removeLockBackground} from '../packages/runtime/lock-background.js';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
const image = createLockBackground(DEFAULTS);
assert(GLib.file_test(image, GLib.FileTest.IS_REGULAR), 'Wallpaper exists');
assert(Gio.File.new_for_path(image).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size() > 10000,
    'Wallpaper is rendered');
const args = lockArguments(DEFAULTS, image);
assert(args.includes(`:${image}`), 'Image path cannot be interpreted as an output name');
assert(args.includes('--ignore-empty-password'), 'Empty passwords are ignored');
assert(args.includes('--config') && args.includes('/dev/null'), 'User swaylock config cannot override lifecycle');
assert(!args.includes('--daemonize'), 'Locker stays tracked until unlock');
removeLockBackground(image);
assert(!GLib.file_test(GLib.path_get_dirname(image), GLib.FileTest.EXISTS), 'Temporary wallpaper removed');

const oldPath = GLib.getenv('PATH')!;
const directory = GLib.dir_make_tmp('dev-os-lock-test-XXXXXX');
try {
    GLib.setenv('PATH', directory, true);
    const locker = new LockScreen();
    const messages: string[] = [];
    assert(!locker.start(DEFAULTS, message => messages.push(message)), 'Missing locker fails explicitly');
    assert(messages[0].includes('sudo apt install swaylock'), 'Missing dependency has actionable message');
    const executable = GLib.build_filenamev([directory, 'swaylock']);
    const marker = GLib.build_filenamev([directory, 'started']);
    // Readiness is deliberately delayed. Never authenticate against the user's PAM account in a unit test.
    GLib.file_set_contents(executable, `#!/bin/sh\nif [ "$1" = --help ]; then echo --ready-fd; exit 0; fi\necho started >> '${marker}'\n/bin/sleep .2\nprintf '\\n'\n/bin/sleep .2\nexit 1\n`);
    Gio.File.new_for_path(executable).set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null);
    messages.length = 0;
    const loop = new GLib.MainLoop(null, false);
    const report = (message: string) => { messages.push(message); if (message.includes('failed.')) loop.quit(); };
    assert(locker.start(DEFAULTS, report), 'Starts available backend');
    assert(locker.start(DEFAULTS, report), 'Repeated requests reuse active locker');
    assert(messages.length === 0, 'Spawn does not claim a secured lock');
    const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => { loop.quit(); return GLib.SOURCE_REMOVE; });
    loop.run();
    GLib.source_remove(timeout);
    assert(messages[0] === 'Session locked', 'Only readiness confirms secure lock');
    assert(messages.some(message => message.includes('failed.')), 'Backend failure reported');
    const [, content] = GLib.file_get_contents(marker);
    assert(new TextDecoder().decode(content).trim() === 'started', 'Duplicate request spawned only one backend');
    GLib.unlink(marker); GLib.unlink(executable);
} finally { GLib.setenv('PATH', oldPath, true); GLib.rmdir(directory); }
print('Lock screen: wallpaper, configuration, readiness, duplicates, failure and cleanup passed');
