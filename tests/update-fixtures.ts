import {Gio, GLib, removeTree} from '@dev-os/core';
import {platform} from '@dev-os/updates/protocol';
import {buildManifest, serialize, type ManifestFile} from '@dev-os/updates/manifest';

export function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
export function fails(callback: () => unknown, text = '') { let failed = ''; try { callback(); } catch (error) { failed = String(error); } assert(failed && failed.includes(text), `Expected rejection containing "${text}", got "${failed}"`); }
export async function rejects(promise: Promise<unknown>, text: string) { let failed = ''; try { await promise; } catch (error) { failed = String(error); } assert(failed.includes(text), `Expected "${text}", got "${failed}"`); }
export function run(args: string[]): string {
    const child = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE}).spawnv(args), [, output, error] = child.communicate_utf8(null, null);
    assert(child.get_successful(), error || `${args[0]} failed`); return output?.trim() ?? '';
}
export function write(path: string, value: string, executable = false) {
    GLib.mkdir_with_parents(Gio.File.new_for_path(path).get_parent()!.get_path()!, 0o700);
    GLib.file_set_contents(path, value);
    if (executable) Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', 0o755, Gio.FileQueryInfoFlags.NONE, null);
}
export const read = (path: string) => new TextDecoder().decode(GLib.file_get_contents(path)[1]);
export const hashText = (text: string) => GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, new TextEncoder().encode(text)) ?? '';
export const target = platform(run(['uname', '-m']));
export const size = (path: string) => Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
export const REPO = 'd-osc/DevOs';

export interface Package {version: string; archive: string; directory: string}
/** A complete update package whose manifest is built from the real file contents. */
export function pack(base: string, version: string, extra: Record<string, string> = {}, options: {minCompatible?: string; omit?: string[]; manifest?: boolean} = {}): Package {
    const directory = `${base}/pkg-${version}`, tree = `${directory}/dev-os`;
    const content: Record<string, [string, boolean]> = {
        'dist/main.js': [`// ${version} main\n`, false], 'dist/supervisor.js': ['// supervisor\n', false], 'dist/react-gtk.js': ['// react\n', false],
        'bin/dev-os-session': [`#!/bin/sh\nprintf '%s\\n' '${version}'\n`, true], 'bin/dev-os-shell': [`#!/bin/sh\nprintf '%s\\n' '${version}'\n`, true],
        'bin/dev-os-start': ['#!/bin/sh\nexit 0\n', true], 'native/dev-os-window-tracker': ['#!/bin/sh\nexit 0\n', true],
        'data/same.txt': ['unchanged in every release\n', false], 'data/old-only.txt': [version < '0.4.0' ? 'removed by the next release\n' : '', false],
        'release.json': [JSON.stringify({format: 1, version, platform: target}), false],
    };
    for (const [path, text] of Object.entries(extra)) content[path] = [text, false];
    const files: ManifestFile[] = [];
    for (const [path, [text, executable]] of Object.entries(content)) {
        if (text === '' || options.omit?.includes(path)) continue;
        write(`${tree}/${path}`, text, executable);
        files.push({path, size: new TextEncoder().encode(text).length, sha256: hashText(text), mode: executable ? '755' : '644'});
    }
    if (options.manifest !== false) write(`${tree}/manifest.json`, serialize(buildManifest({version, platform: target, files, minCompatible: options.minCompatible})));
    const archive = `${base}/dev-os-${target}-${version}.tar.gz`;
    run(['tar', '-czf', archive, '-C', directory, 'dev-os']);
    return {version, archive, directory};
}
export function repack(archive: string, change: (directory: string) => void, name: string): string {
    const scratch = GLib.dir_make_tmp('dev-os-repack-XXXXXX'), out = `${archive}.${name}.tar.gz`;
    try { run(['tar', '-xzf', archive, '-C', scratch]); change(scratch); run(['sh', '-c', 'cd "$1" && tar -czf "$2" *', 'sh', scratch, out]); }
    finally { removeTree(scratch); }
    return out;
}

export interface Asset {name: string; path: string}
/** Fake GitHub: release JSON plus the files behind each asset URL. Nothing touches the network. */
export function github(version: string, assets: Asset[], overrides: Record<string, unknown> = {}) {
    const urls = new Map<string, string>();
    const list = assets.map(asset => {
        const url = `https://github.com/${REPO}/releases/download/v${version}/${asset.name}`;
        urls.set(url, asset.path);
        return {name: asset.name, state: 'uploaded', size: size(asset.path), digest: `sha256:${run(['sha256sum', '--', asset.path]).split(/\s+/)[0]}`, browser_download_url: url};
    });
    return {urls, release: {tag_name: `v${version}`, draft: false, prerelease: false, body: `Notes for ${version}`, assets: list, ...overrides}};
}
export function sums(base: string, version: string, files: Asset[], sign?: {key: string}, tamper = false): Asset[] {
    const text = files.map(file => `${run(['sha256sum', '--', file.path]).split(/\s+/)[0]}  ${file.name}\n`).join('');
    const path = `${base}/SHA256SUMS-${version}`;
    write(path, text);
    const result: Asset[] = [{name: 'SHA256SUMS', path}];
    if (sign) {
        const signature = `${base}/SHA256SUMS-${version}.sig`;
        run(['openssl', 'pkeyutl', '-sign', '-inkey', sign.key, '-rawin', '-in', path, '-out', signature]);
        result.push({name: 'SHA256SUMS.sig', path: signature});
        if (tamper) write(path, text.replace(/^./, character => character === 'a' ? 'b' : 'a'));
    }
    return result;
}
