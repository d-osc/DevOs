import {Gio, GLib, removeTree} from '@dev-os/core';
import System from 'system';
import {ROOT} from '@dev-os/config';
import {Updates, type UpdateTransport} from '@dev-os/updates';
import {buildSystemBundle} from '@dev-os/updates/system-bundle';
import {parseSystemMeta, systemList} from '@dev-os/updates/system';
import {releaseExtras} from '@dev-os/updates/manifest';
import {assert, run, write, read, hashText, target, REPO, sums} from './update-fixtures.js';

const CORE = `${ROOT}/native/devos-system-update`;
interface Result {code: number; json: Record<string, unknown>}
let environment: Record<string, string> = {};
function helper(args: string[], extra: Record<string, string> = {}): Result {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
    for (const [key, value] of Object.entries({...environment, ...extra})) launcher.setenv(key, value, true);
    const child = launcher.spawnv(['sh', CORE, ...args]), [, out, err] = child.communicate_utf8(null, null);
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(out ?? ''); } catch { throw new Error(`Helper printed no JSON: ${out} ${err}`); }
    return {code: child.get_exit_status(), json};
}
const sha = (path: string) => run(['sha256sum', '--', path]).split(/\s+/)[0];
const snapshot = (directory: string) => run(['sh', '-c', `cd "${directory}" && find . -type f | sort | xargs -r sha256sum`]);
function expectFail(result: Result, text: string, label: string) {
    assert(result.code === 1 && result.json.ok === false && String(result.json.error).includes(text), `${label}: expected "${text}", got ${JSON.stringify(result.json)}`);
}

async function main() {
    const base = GLib.dir_make_tmp('dev-os-system-update-XXXXXX');
    try {
        const root = `${base}/root`, esp = `${base}/esp`, state = `${base}/state`, keys = `${base}/nokeys`, efi = `${base}/efi`;
        // A fake efibootmgr keeps its entries in files and logs every call.
        write(`${base}/efibootmgr`, `#!/bin/sh
dir="${efi}"; mkdir -p "$dir"; echo "$*" >> "$dir/log"
[ -f "$dir/order" ] || echo "0001,0000" > "$dir/order"
case "$1" in
    -c) echo 0003 > "$dir/entry"; echo "BootCurrent: 0001"; echo "BootOrder: 0003,$(cat "$dir/order")"; echo "Boot0003* Dev OS (update)	HD(1,GPT)/File(\\\\EFI\\\\DEVOS-NEXT\\\\DEVOS\\\\DEVOS.EFI)" ;;
    -o) echo "$2" > "$dir/order" ;;
    -n) echo "$2" > "$dir/next" ;;
    -N) rm -f "$dir/next" ;;
    -B) rm -f "$dir/entry" ;;
    *) echo "BootCurrent: 0001"; echo "BootOrder: $(cat "$dir/order")"; echo "Boot0001* Dev OS" ;;
esac
`, true);
        const reset = () => {
            for (const path of [root, esp, state, efi]) removeTree(path);
            write(`${root}/usr/bin/hello`, 'old hello\n', true); write(`${root}/usr/bin/gone`, 'will be removed\n', true);
            write(`${root}/usr/lib/firmware/a.bin`, 'old firmware\n'); write(`${root}/usr/lib/modules/6.17.0-old/kernel.ko`, 'old module\n');
            write(`${esp}/EFI/DEVOS/DEVOS.EFI`, 'OLD UKI'); write(`${esp}/EFI/BOOT/BOOTAA64.EFI`, 'OLD UKI');
            write(`${base}/os-release`, 'ID=devos\nVERSION_ID="0.3.0"\n');
            environment = {DEVOS_SYS_ROOT: root, DEVOS_SYS_ESP: esp, DEVOS_SYS_STATE: state, DEVOS_SYS_KEYS: keys, DEVOS_SYS_LIVE: '0', DEVOS_SYS_EFIBOOTMGR: `${base}/efibootmgr`,
                DEVOS_SYS_ESP_SOURCE: '/dev/test1', DEVOS_SYS_UNAME_R: '6.17.0-old', DEVOS_SYS_BOOT_ID: 'boot-1', DEVOS_SYS_MACHINE: 'aarch64', DEVOS_SYS_ALLOW_USER: '1',
                DEVOS_SYS_OSRELEASE: `${base}/os-release`, DEVOS_SYS_FREE_KB: '100000000'};
        };
        // Bundle 0.4.0: new boot image + modules, a firmware update, a changed and a new system file, one removal.
        write(`${base}/rootfs/usr/lib/modules/6.18.0-new/kernel.ko`, 'new module\n'); write(`${base}/rootfs/usr/lib/firmware/a.bin`, 'new firmware\n');
        write(`${base}/rootfs/usr/bin/hello`, 'new hello\n', true); write(`${base}/rootfs/usr/share/hello/readme`, 'readme\n');
        write(`${base}/uki-new.efi`, 'NEW UKI 6.18');
        const build = (version: string, extra: Partial<Parameters<typeof buildSystemBundle>[0]> = {}) => buildSystemBundle({version, platform: 'linux-arm64', kernel: '6.18.0-new', uki: `${base}/uki-new.efi`,
            rootfs: `${base}/rootfs`, rootPaths: ['usr/lib/modules/6.18.0-new', 'usr/lib/firmware', 'usr/bin/hello', 'usr/share/hello'], remove: ['usr/bin/gone'], output: `${base}/out-${version}`, ...extra});
        const meta = await build('0.4.0');
        assert(meta.components.join() === 'kernel,initramfs,bootloader,firmware,packages' && meta.esp.length === 1 && meta.root.length === 4 && meta.remove.join() === 'usr/bin/gone', `Bundle components: ${JSON.stringify(meta.components)}`);
        const bundle = `${base}/out-0.4.0/dev-os-system-linux-arm64.tar.gz`, name = 'dev-os-system-linux-arm64.tar.gz';
        parseSystemMeta(JSON.parse(read(`${base}/out-0.4.0/dev-os-system-linux-arm64.json`)));
        assert(systemList(meta).includes('F esp 644') && systemList(meta).includes('R usr/bin/gone'), 'The helper reads a plain list');
        const apply = (file = bundle, extra: Record<string, string> = {}, more: string[] = []) => helper(['apply', '--archive', file, '--name', name, '--sha256', sha(file), ...more], extra);

        // ---- Boot image installed next to the current one, started once, promoted after a good boot ---------------------
        reset();
        let status = helper(['status']).json;
        assert(status.version === '0.3.0' && status.pending === '' && status.efi === true && status.live === false && status.signed === false, `Status: ${JSON.stringify(status)}`);
        const before = snapshot(root);
        let result = apply();
        assert(result.code === 0 && result.json.reboot === true && result.json.safeBoot === true && result.json.version === '0.4.0', `Apply: ${JSON.stringify(result.json)}`);
        assert(read(`${root}/usr/bin/hello`) === 'new hello\n' && !GLib.file_test(`${root}/usr/bin/gone`, GLib.FileTest.EXISTS) && read(`${root}/usr/lib/firmware/a.bin`) === 'new firmware\n' &&
            read(`${root}/usr/lib/modules/6.18.0-new/kernel.ko`) === 'new module\n' && GLib.file_test(`${root}/usr/bin/hello`, GLib.FileTest.IS_EXECUTABLE), 'System files, modules and firmware are in place');
        assert(read(`${esp}/EFI/DEVOS/DEVOS.EFI`) === 'OLD UKI' && read(`${esp}/EFI/DEVOS-NEXT/DEVOS/DEVOS.EFI`) === 'NEW UKI 6.18', 'The current boot image is untouched; the new one sits beside it');
        const log = read(`${efi}/log`);
        assert(log.includes('-c -d') && log.includes('\\EFI\\DEVOS-NEXT\\DEVOS\\DEVOS.EFI') && log.includes('-o 0001,0000') && log.includes('-n 0003') && read(`${efi}/order`).trim() === '0001,0000', `Boot entry is BootNext only: ${log}`);
        status = helper(['status']).json; assert(status.pending === '0.4.0' && status.pendingKernel === '6.18.0-new', 'Status reports the pending update');
        expectFail(apply(), 'waiting for a restart', 'second apply');
        result = helper(['commit']); assert(result.json.committed === false, 'Nothing is committed before a restart');
        assert(read(`${esp}/EFI/DEVOS/DEVOS.EFI`) === 'OLD UKI', 'Still the old image');
        result = helper(['commit'], {DEVOS_SYS_BOOT_ID: 'boot-2', DEVOS_SYS_UNAME_R: '6.18.0-new'});
        assert(result.json.committed === true, `Commit: ${JSON.stringify(result.json)}`);
        assert(read(`${esp}/EFI/DEVOS/DEVOS.EFI`) === 'NEW UKI 6.18' && read(`${esp}/EFI/DEVOS/DEVOS.EFI.prev`) === 'OLD UKI' && read(`${esp}/EFI/BOOT/BOOTAA64.EFI`) === 'NEW UKI 6.18' &&
            !GLib.file_test(`${esp}/EFI/DEVOS-NEXT`, GLib.FileTest.EXISTS) && read(`${efi}/log`).includes('-B -b 0003'), 'The new boot image is promoted, the old one kept, the test entry removed');
        status = helper(['status'], {DEVOS_SYS_UNAME_R: '6.18.0-new'}).json; assert(status.version === '0.4.0' && status.pending === '' && status.canRollback === true, `After commit: ${JSON.stringify(status)}`);
        result = helper(['rollback']);
        assert(result.code === 0 && result.json.reboot === true && snapshot(root) === before && read(`${esp}/EFI/DEVOS/DEVOS.EFI`) === 'OLD UKI' && read(`${esp}/EFI/BOOT/BOOTAA64.EFI`) === 'OLD UKI', `Rollback restores files and boot image: ${JSON.stringify(result.json)}`);
        assert(helper(['status']).json.version === '0.3.0', 'Rollback returns to the previous system version');
        print('PASS: boot image beside the current one, BootNext only, promote after a good boot, rollback restores files and ESP');

        // ---- The new kernel does not start: firmware falls back, the helper undoes the files too ------------------------
        reset(); const pristine = snapshot(root);
        assert(apply().code === 0, 'Apply for the failed boot');
        result = helper(['commit'], {DEVOS_SYS_BOOT_ID: 'boot-3'});
        assert(result.json.rolledBack === true && snapshot(root) === pristine && read(`${esp}/EFI/DEVOS/DEVOS.EFI`) === 'OLD UKI' && !GLib.file_test(`${esp}/EFI/DEVOS-NEXT`, GLib.FileTest.EXISTS), `Failed boot is undone: ${JSON.stringify(result.json)}`);
        status = helper(['status']).json; assert(status.pending === '' && String(status.lastError).includes('did not start'), 'The failure is reported');
        // Cancel before restarting.
        assert(apply().code === 0 && helper(['cancel']).json.cancelled === true && snapshot(root) === pristine && !GLib.file_test(`${esp}/EFI/DEVOS-NEXT`, GLib.FileTest.EXISTS), 'Cancel withdraws a pending update');
        print('PASS: a kernel that does not boot is rolled back (files and boot entry); cancel before restart');

        // ---- No UEFI variables: in-place with a kept previous image ----------------------------------------------------
        reset();
        result = apply(bundle, {DEVOS_SYS_EFIBOOTMGR: 'none'});
        assert(result.json.safeBoot === false && read(`${esp}/EFI/DEVOS/DEVOS.EFI`) === 'NEW UKI 6.18' && read(`${esp}/EFI/DEVOS/DEVOS.EFI.prev`) === 'OLD UKI', `In-place mode: ${JSON.stringify(result.json)}`);
        print('PASS: without efibootmgr the image is replaced in place and the previous one is kept');

        // ---- Failure injection leaves the old system -----------------------------------------------------------------------
        for (const step of ['root', 'esp']) {
            reset(); const old = snapshot(root);
            expectFail(apply(bundle, {DEVOS_SYS_FAIL_AFTER: step}), step === 'root' ? 'interrupted' : 'boot image', `inject ${step}`);
            assert(snapshot(root) === old && read(`${esp}/EFI/DEVOS/DEVOS.EFI`) === 'OLD UKI' && !GLib.file_test(`${esp}/EFI/DEVOS-NEXT`, GLib.FileTest.EXISTS) && helper(['status']).json.pending === '', `Interrupted after ${step} leaves the old system`);
        }
        print('PASS: interrupted updates restore every system file and leave the old boot image');

        // ---- Refusals: nothing changes ---------------------------------------------------------------------------------------
        reset(); const untouched = snapshot(root);
        const unchanged = (label: string) => assert(snapshot(root) === untouched && read(`${esp}/EFI/DEVOS/DEVOS.EFI`) === 'OLD UKI' && !GLib.file_test(`${esp}/EFI/DEVOS-NEXT`, GLib.FileTest.EXISTS) && helper(['status']).json.pending === '', `${label} must change nothing`);
        expectFail(helper(['apply', '--archive', bundle, '--name', name, '--sha256', '0'.repeat(64)]), 'does not match', 'wrong hash'); unchanged('wrong hash');
        expectFail(apply(bundle, {DEVOS_SYS_LIVE: '1'}), 'Live USB', 'live'); unchanged('live');
        expectFail(apply(bundle, {DEVOS_SYS_MACHINE: 'x86_64'}), 'is for linux-arm64', 'platform'); unchanged('platform');
        write(`${base}/newer-release`, 'VERSION_ID=0.9.0\n');
        expectFail(apply(bundle, {DEVOS_SYS_OSRELEASE: `${base}/newer-release`}), 'not newer', 'downgrade'); unchanged('downgrade');
        expectFail(apply(bundle, {DEVOS_SYS_FREE_KB: '10'}), 'Not enough free', 'space'); unchanged('space');
        const damaged = `${base}/damaged.tar.gz`; write(damaged, 'not an archive');
        expectFail(helper(['apply', '--archive', damaged, '--name', name, '--sha256', sha(damaged)]), 'not a valid archive', 'garbage'); unchanged('garbage');
        // Hand-made bundles: extra file, wrong content, forbidden path, link.
        const raw = (label: string, files: Record<string, string>, list: string, links: [string, string][] = []) => {
            const directory = `${base}/raw-${label}`; removeTree(directory);
            for (const [path, text] of Object.entries(files)) write(`${directory}/dev-os-system/${path}`, text);
            write(`${directory}/dev-os-system/system.list`, list);
            for (const [link, to] of links) run(['ln', '-s', to, `${directory}/dev-os-system/${link}`]);
            const file = `${base}/raw-${label}.tar.gz`; run(['tar', '-czf', file, '-C', directory, 'dev-os-system']); return file;
        };
        const head = 'format 1\nversion 0.4.0\nplatform linux-arm64\nkernel \nmin 0.0.0\ncomponents packages\n';
        const entry = (path: string, text: string, area = 'root') => `F ${area} 755 ${hashText(text)} ${text.length} ${path}\n`;
        const good = raw('good', {'root/usr/bin/x': 'x'}, head + entry('usr/bin/x', 'x'));
        assert(helper(['apply', '--archive', good, '--name', 'raw-good.tar.gz', '--sha256', sha(good)]).code === 0, 'A minimal hand-made bundle installs'); reset();
        for (const [label, file, text] of [
            ['extra', raw('extra', {'root/usr/bin/x': 'x', 'root/usr/bin/evil': 'e'}, head + entry('usr/bin/x', 'x')), 'does not list'],
            ['content', raw('content', {'root/usr/bin/x': 'changed'}, head + entry('usr/bin/x', 'x')), 'does not match its checksum'],
            ['helper', raw('helper', {'root/usr/libexec/devos-system-update': 'x'}, head + entry('usr/libexec/devos-system-update', 'x')), 'not allowed'],
            ['polkit', raw('polkit', {'root/usr/share/polkit-1/actions/x.policy': 'x'}, head + entry('usr/share/polkit-1/actions/x.policy', 'x')), 'not allowed'],
            ['etc', raw('etc', {'root/etc/passwd': 'x'}, head + entry('etc/passwd', 'x')), 'not allowed'],
            ['dotdot', raw('dotdot', {'root/usr/bin/x': 'x'}, head + entry('usr/bin/../../etc/x', 'x')), 'not allowed'],
            ['esp', raw('esp', {'esp/EFI/Microsoft/boot.efi': 'x'}, head + entry('EFI/Microsoft/boot.efi', 'x', 'esp')), 'not allowed on the EFI'],
            ['mode', raw('mode', {'root/usr/bin/x': 'x'}, head + `F root 4755 ${hashText('x')} 1 usr/bin/x\n`), 'Invalid file mode'],
            ['link', raw('link', {'root/usr/bin/x': 'x'}, head + entry('usr/bin/x', 'x'), [['root/usr/bin/l', '/etc/shadow']]), 'links or special'],
            ['version', raw('version', {'root/usr/bin/x': 'x'}, head.replace('0.4.0', 'abc') + entry('usr/bin/x', 'x')), 'invalid version'],
        ] as [string, string, string][]) {
            expectFail(helper(['apply', '--archive', file, '--name', `raw-${label}.tar.gz`, '--sha256', sha(file)]), text, label); unchanged(label);
        }
        print('PASS: hash, Live USB, platform, downgrade, space, garbage, extra/changed files, forbidden paths, modes and links are refused without changes');

        // ---- Signatures --------------------------------------------------------------------------------------------------------
        reset();
        GLib.mkdir_with_parents(`${base}/keys`, 0o700); const priv = `${base}/priv.pem`, wrong = `${base}/wrong.pem`;
        run(['openssl', 'genpkey', '-algorithm', 'ed25519', '-out', priv]); run(['openssl', 'pkey', '-in', priv, '-pubout', '-out', `${base}/keys/release.pub`]); run(['openssl', 'genpkey', '-algorithm', 'ed25519', '-out', wrong]);
        const signed = sums(base, 'system-ok', [{name, path: bundle}], {key: priv}), forged = sums(base, 'system-forged', [{name, path: bundle}], {key: wrong});
        const withKeys = {DEVOS_SYS_KEYS: `${base}/keys`};
        expectFail(apply(bundle, withKeys), 'only installs signed', 'no signature'); unchanged('no signature');
        expectFail(apply(bundle, withKeys, ['--sums', forged[0].path, '--sig', forged[1].path]), 'signature is invalid', 'forged'); unchanged('forged');
        const other = sums(base, 'system-other', [{name: 'other.tar.gz', path: bundle}], {key: priv});
        expectFail(apply(bundle, withKeys, ['--sums', other[0].path, '--sig', other[1].path]), 'not in the signed', 'unlisted'); unchanged('unlisted');
        assert(status_signed(), 'status says signed');
        result = apply(bundle, withKeys, ['--sums', signed[0].path, '--sig', signed[1].path]); assert(result.code === 0, `Signed bundle installs: ${JSON.stringify(result.json)}`);
        function status_signed() { return helper(['status'], withKeys).json.signed === true; }
        print('PASS: with a key in the image only a correctly signed system update installs');

        // ---- The updater: check, download, helper, restart --------------------------------------------------------------
        reset();
        const metaPath = `${base}/out-0.4.0/dev-os-system-linux-arm64.json`;
        const assets = [{name, path: bundle}, {name: 'dev-os-system-linux-arm64.json', path: metaPath}];
        const urls = new Map<string, string>(), list = assets.map(asset => {
            const url = `https://github.com/${REPO}/releases/download/v0.4.0/${asset.name}`; urls.set(url, asset.path);
            return {name: asset.name, state: 'uploaded', size: Number(run(['stat', '-c', '%s', asset.path])), digest: `sha256:${sha(asset.path)}`, browser_download_url: url};
        });
        const body = {tag_name: 'v0.4.0', draft: false, prerelease: false, body: 'notes', assets: [...list, ...['dev-os-linux-arm64.tar.gz'].map(n => ({name: n, state: 'uploaded', size: 10, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `https://github.com/${REPO}/releases/download/v0.4.0/${n}`}))]};
        assert(releaseExtras(body, REPO, 'linux-arm64', null).system?.name === name, 'The release lists the system bundle');
        const transport: UpdateTransport = {
            async get(url) { return {status: 200, body: url.includes('/swaywm/') ? {tag_name: 'v1.8.6', html_url: 'https://github.com/swaywm/swaylock/releases/tag/v1.8.6'} : body}; },
            async download(item, path) { const source = urls.get(item.url); if (!source) throw new Error('unexpected ' + item.url); Gio.File.new_for_path(source).copy(Gio.File.new_for_path(path), Gio.FileCopyFlags.NONE, null, null); },
        };
        const saved = Object.entries(environment); for (const [key, value] of saved) GLib.setenv(key, value, true);
        let restarted = 0;
        const updater = new Updates({repository: () => REPO, root: `${base}/updates`, running: '0.4.0', transport, live: () => false, keyDir: '/nonexistent', systemCommand: ['sh', CORE], reboot: async () => { restarted++; }});
        try {
            await updater.check();
            assert(updater.state.system.supported && updater.state.system.offer?.version === '0.4.0' && updater.state.system.offer.components.includes('kernel') && updater.state.system.offer.kernel === '6.18.0-new', `Offer: ${JSON.stringify(updater.state.system)} ${updater.state.error}`);
            await updater.installSystem();
            assert(updater.state.error === '' && updater.state.system.pending === '0.4.0' && updater.state.system.offer === null && updater.state.message.includes('Restart the computer'), `Installed: ${updater.state.error} ${JSON.stringify(updater.state.system)}`);
            assert(read(`${esp}/EFI/DEVOS-NEXT/DEVOS/DEVOS.EFI`) === 'NEW UKI 6.18' && read(`${root}/usr/bin/hello`) === 'new hello\n', 'The helper applied the bundle');
            await updater.installSystem(); assert(updater.state.system.pending === '0.4.0', 'No second install while a restart is pending');
            await updater.restartComputer(); assert(restarted === 1, 'Restart goes through the reboot command');
            await updater.cancelSystem(); assert(updater.state.system.pending === '' && read(`${root}/usr/bin/hello`) === 'old hello\n', 'Cancel withdraws the pending system update');
            // A helper that refuses shows its text.
            GLib.setenv('DEVOS_SYS_LIVE', '1', true); await updater.refreshSystem();
            assert(!updater.state.system.supported && updater.state.system.reason.startsWith('Live USB'), 'Live USB: system updates are unavailable');
            GLib.setenv('DEVOS_SYS_LIVE', '0', true);
            const dead = new Updates({repository: () => REPO, root: `${base}/dead`, running: '0.4.0', transport, live: () => false, keyDir: '/nonexistent', systemCommand: ['/nonexistent-helper']});
            await dead.refreshSystem(); assert(!dead.state.system.supported && dead.state.system.reason !== '', 'A missing helper is reported, not fatal'); dead.dispose();
        } finally { updater.dispose(); }
        print('PASS: the updater offers, downloads and installs the system update, asks for a restart, cancels and handles Live USB or a missing helper');
        void meta;
    } finally { removeTree(base); }
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void main().catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) { printerr(failed instanceof Error ? `${failed.message}
${failed.stack}` : String(failed)); System.exit(1); }
print('System update tests passed');
void target; void write;
