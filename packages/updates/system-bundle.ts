// Builds dev-os-system-<platform>.tar.gz (+ .json) from the pieces of an OpenEmbedded build: the unified kernel image
// (kernel + initramfs + bootloader stub, built by distro/usb/prepare.dev as INSTALLED.EFI), directories of the root file system
// (kernel modules, firmware, system files). Release tooling only: gjs -m dist/make-system-bundle.js, see docs/updates.md.
import {Gio, GLib, removeTree} from '@dev-os/core/base';
import {run} from './installed.js';
import type {UpdatePlatform} from './protocol.js';
import type {ManifestFile} from './manifest.js';
import {deriveComponents, okRootPath, parseSystemMeta, systemList, systemMetaName, systemAssetName, type SystemMeta} from './system.js';
import {serialize} from './manifest.js';

export interface SystemBundleInput {
    version: string; platform: UpdatePlatform; kernel: string; minCompatible?: string;
    /** Unified kernel image to ship as EFI/DEVOS/DEVOS.EFI. */
    uki?: string;
    /** Root file system tree and the directories (or files) inside it to ship, e.g. usr/lib/modules/6.17.0-devos. */
    rootfs?: string; rootPaths?: string[];
    /** Files of the installed system to delete (same allow-list). */
    remove?: string[];
    /** Follow symbolic links instead of refusing them (linux-firmware ships many). */
    dereference?: boolean;
    output: string;
}
export async function buildSystemBundle(input: SystemBundleInput, cancel = new Gio.Cancellable()): Promise<SystemMeta> {
    if (!input.uki && !(input.rootPaths?.length) && !(input.remove?.length)) throw new Error('Nothing to ship: give --uki, --root-path or --remove');
    if (input.uki && !input.kernel) throw new Error('--kernel (the uname -r of the bundled kernel) is required with --uki');
    const temporary = GLib.dir_make_tmp('dev-os-system-bundle-XXXXXX'), stage = `${temporary}/dev-os-system`;
    try {
        GLib.mkdir_with_parents(`${stage}/esp/EFI/DEVOS`, 0o755); GLib.mkdir_with_parents(`${stage}/root`, 0o755);
        if (input.uki) await run(['cp', '--', input.uki, `${stage}/esp/EFI/DEVOS/DEVOS.EFI`], cancel, 300);
        for (const path of input.rootPaths ?? []) {
            if (!input.rootfs) throw new Error('--rootfs is required with --root-path');
            if (!okRootPath(`${path.replace(/\/$/, '')}/x`) && !okRootPath(path)) throw new Error(`Path ${path} is not allowed in a system update`);
            await run(['sh', '-c', `cd "$1" && tar -c${input.dereference ? 'h' : ''}f - "$2" | tar -xf - -C "$3" --no-same-owner`, 'sh', input.rootfs, path, `${stage}/root`], cancel, 1800);
        }
        if (!input.uki) removeTree(`${stage}/esp`);
        const odd = await run(['find', stage, '-mindepth', '1', '-not', '-type', 'f', '-not', '-type', 'd'], cancel);
        if (odd) throw new Error(`Links and special files are not allowed (use --dereference for links):\n${odd.split('\n').slice(0, 5).join('\n')}`);
        const listing = await run(['sh', '-c', 'cd "$1" && find esp root -type f -printf "%m\\t%s\\t%p\\n" | sort -t "\t" -k3', 'sh', stage], cancel, 600);
        const sums = new Map<string, string>();
        const hashes = await run(['sh', '-c', 'cd "$1" && find esp root -type f -print0 | xargs -0 -r sha256sum', 'sh', stage], cancel, 1800);
        for (const line of hashes.split('\n')) if (line) sums.set(line.slice(66), line.slice(0, 64));
        const esp: ManifestFile[] = [], root: ManifestFile[] = [];
        for (const line of listing.split('\n')) {
            if (!line) continue;
            const [mode, size, path] = line.split('\t'), area = path.startsWith('esp/') ? esp : root;
            area.push({path: path.slice(path.indexOf('/') + 1), size: Number(size), sha256: sums.get(path)!, mode: (parseInt(mode, 8) & 0o111) !== 0 ? '755' : '644'});
        }
        const meta = parseSystemMeta({format: 1, kind: 'system', version: input.version, platform: input.platform, kernel: input.uki ? input.kernel : '',
            minCompatible: input.minCompatible ?? '0.0.0', components: deriveComponents(esp, root), esp, root, remove: input.remove ?? []});
        GLib.file_set_contents(`${stage}/system.json`, serialize(meta));
        GLib.file_set_contents(`${stage}/system.list`, systemList(meta));
        GLib.mkdir_with_parents(input.output, 0o755);
        const archive = `${input.output}/${systemAssetName(input.platform)}`;
        await run(['tar', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', temporary, 'dev-os-system'], cancel, 1800);
        GLib.file_set_contents(`${input.output}/${systemMetaName(input.platform)}`, serialize(meta));
        return meta;
    } finally { removeTree(temporary); }
}
