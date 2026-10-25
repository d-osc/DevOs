// File-level update patch between two update packages:
//   gjs -m dist/make-patch.js --from build/old/dev-os-linux-x64.tar.gz --to build/release/dev-os-linux-x64.tar.gz --output build/release
// writes <output>/dev-os-patch-<from>-to-<to>-<platform>.tar.gz. Both packages need a manifest.json (tools/build/release.ts writes it).
import System from 'system';
import {GLib, Gio} from '@dev-os/core/base';
import {createPatch, archiveManifestPath} from './package.js';
import {patchAssetName} from './manifest.js';

function option(name: string): string {
    const args = System.programArgs, at = args.indexOf(`--${name}`);
    if (at < 0 || !args[at + 1]) throw new Error(`Missing --${name}`);
    return args[at + 1];
}
async function main() {
    const from = option('from'), to = option('to'), output = option('output');
    const cancel = new Gio.Cancellable();
    const old = await archiveManifestPath(from, cancel), next = await archiveManifestPath(to, cancel);
    if (!old || !next) throw new Error('Both packages need a manifest.json');
    GLib.mkdir_with_parents(output, 0o755);
    const target = `${output}/${patchAssetName(old.version, next.version, next.platform)}`;
    const meta = await createPatch(from, to, target, cancel);
    const size = Gio.File.new_for_path(target).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
    print(`${target}: ${meta.add.length} added, ${meta.replace.length} replaced, ${meta.remove.length} removed, ${(size / 1048576).toFixed(2)} MB`);
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void main().catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) { printerr(String(failed)); System.exit(1); }
