// gjs -m dist/make-system-bundle.js --version 0.3.7 --platform linux-arm64 --kernel 6.17.0-devos --uki INSTALLED.EFI \
//     --rootfs /path/to/extracted/rootfs --root-path usr/lib/modules/6.17.0-devos --root-path usr/lib/firmware --dereference --output build/release
// Writes dev-os-system-<platform>.tar.gz and dev-os-system-<platform>.json (see docs/updates.md, "System updates").
import System from 'system';
import {GLib, Gio} from '@dev-os/core/base';
import {buildSystemBundle} from './system-bundle.js';
import type {UpdatePlatform} from './protocol.js';

const args = System.programArgs;
function values(name: string): string[] { return args.flatMap((value, index) => value === `--${name}` && args[index + 1] ? [args[index + 1]] : []); }
function one(name: string, fallback?: string): string {
    const found = values(name);
    if (found.length !== 1 && fallback === undefined) throw new Error(`Missing --${name}`);
    return found[0] ?? fallback!;
}
async function main() {
    const machine = Gio.Subprocess.new(['uname', '-m'], Gio.SubprocessFlags.STDOUT_PIPE).communicate_utf8(null, null)[1]!.trim();
    const platform = one('platform', machine === 'x86_64' ? 'linux-x64' : 'linux-arm64') as UpdatePlatform;
    const meta = await buildSystemBundle({version: one('version'), platform, kernel: one('kernel', ''), minCompatible: one('min', '0.0.0'),
        uki: values('uki')[0], rootfs: values('rootfs')[0], rootPaths: values('root-path'), remove: values('remove'),
        dereference: args.includes('--dereference'), output: one('output')});
    print(`System update ${meta.version} (${meta.platform}): ${meta.components.join(', ')}; ${meta.esp.length} boot image file(s), ${meta.root.length} system file(s), ${meta.remove.length} removal(s)`);
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void main().catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) { printerr(String(failed)); System.exit(1); }
