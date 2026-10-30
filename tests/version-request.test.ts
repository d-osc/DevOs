import {GLib, Gio, writeJson, readJson, removeTree} from '@dev-os/core';
import System from 'system';
import {requestSessionVersion} from '@dev-os/runtime/session-version';

async function fixture(base: string) {
    const key = '0.3.6-aaaaaaaaaaaa', root = `${GLib.get_user_data_dir()}/dev-os-updates/releases/${key}`;
    GLib.mkdir_with_parents(`${root}/bin`, 0o700); GLib.mkdir_with_parents(`${root}/dist`, 0o700);
    writeJson(`${root}/release.json`, {format: 1, version: '0.3.6', platform: 'linux-arm64'});
    writeJson(`${GLib.get_user_data_dir()}/dev-os-updates/history.json`, {current: {key, version: '0.3.6', repository: 'd-osc/DevOs', platform: 'linux-arm64'}, previous: null});
    const script = `${root}/bin/dev-os-shell`;
    GLib.file_set_contents(script, '#!/bin/sh\ncase "$1" in --version) echo 0.3.6;; doctor) exit 0;; *) exit 1;; esac\n');
    GLib.file_set_contents(`${root}/bin/dev-os-start`, '#!/bin/sh\nexit 0\n');
    GLib.file_set_contents(`${root}/dist/supervisor.js`, '// fixture\n');
    const chmod = Gio.Subprocess.new(['chmod', '700', script, `${root}/bin/dev-os-start`], Gio.SubprocessFlags.NONE); chmod.wait_check(null);
    const request = GLib.getenv('DEV_OS_VERSION_REQUEST')!;
    async function rejects(target: string) {
        let rejected = false; try { await requestSessionVersion(target); } catch { rejected = true; }
        if (!rejected || GLib.file_test(request, GLib.FileTest.EXISTS)) throw new Error('Invalid selection wrote a restart request');
    }
    await rejects(`${base}/unselected`);
    GLib.file_set_contents(script, '#!/bin/sh\necho 0.0.0\n'); await rejects(root);
    GLib.file_set_contents(script, '#!/bin/sh\ncase "$1" in --version) echo 0.3.6;; doctor) exit 1;; esac\n'); await rejects(root);
    GLib.file_set_contents(script, '#!/bin/sh\ncase "$1" in --version) echo 0.3.6;; doctor) exit 0;; esac\n');
    await requestSessionVersion(root);
    const result = readJson<{root: string; version: string}>(request);
    if (result.root !== root || result.version !== '0.3.6') throw new Error('Version request metadata mismatch');
    Gio.File.new_for_path(request).delete(null);
    Gio.File.new_for_path(`${root}/dist/supervisor.js`).delete(null);
    GLib.mkdir_with_parents(`${root}/src/system`, 0o700); GLib.mkdir_with_parents(`${root}/dist/native`, 0o700);
    for (const path of ['bin/dev-os-supervisor', 'src/system/supervisor.dev', 'dist/native/libsupervisor.so'])
        GLib.file_set_contents(`${root}/${path}`, 'native fixture\n');
    await requestSessionVersion(root);
    if (readJson<{root: string}>(request).root !== root) throw new Error('Native session version request failed');
}
async function main() {
    if (ARGV[0] === '--fixture') { await fixture(ARGV[1]); return; }
    if (ARGV.length) { await requestSessionVersion(ARGV[0]); return; }
    const base = GLib.dir_make_tmp('devos-version-request-XXXXXX');
    try {
        GLib.mkdir_with_parents(`${base}/runtime`, 0o700);
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
        launcher.setenv('XDG_DATA_HOME', `${base}/data`, true); launcher.setenv('XDG_RUNTIME_DIR', `${base}/runtime`, true);
        launcher.setenv('DEV_OS_VERSION_REQUEST', `${base}/runtime/dev-os-version-aaaaaaaa.json`, true);
        const child = launcher.spawnv(['gjs', '-m', Gio.File.new_for_uri(import.meta.url).get_path()!, '--fixture', base]);
        const [, stdout, stderr] = child.communicate_utf8(null, null);
        if (!child.get_successful()) throw new Error(stderr || stdout || 'Version fixture failed');
    } finally { removeTree(base); }
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void main().catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) { printerr(String(failed)); System.exit(1); }
print('PASS: version switch preflight and private session request');
