import {Gio, GLib} from '@dev-os/core/base';

/**
 * Package-file recognition and read-only inspection for .dpk, .deb, .rpm and .tar.gz.
 * Nothing here extracts or executes anything: files are only listed and their metadata is read so the
 * install page can show what `dev install` will do. The real extraction, path/size validation and
 * registry bookkeeping stay in `dev` (DevOsPM), which refuses traversal, links and oversized archives.
 */
export type PackageKind = 'dpk' | 'deb' | 'rpm' | 'tar.gz';
export const PACKAGE_EXTENSIONS: readonly {suffix: string; kind: PackageKind}[] = [
    {suffix: '.dpk', kind: 'dpk'}, {suffix: '.dpkx', kind: 'dpk'}, {suffix: '.deb', kind: 'deb'}, {suffix: '.rpm', kind: 'rpm'}, {suffix: '.tar.gz', kind: 'tar.gz'},
];
/** MIME types claimed by dev-os-package-install.desktop. .tar.gz is deliberately absent: see docs/package-install.md. */
export const PACKAGE_MIME_TYPES = ['application/x-devos-package', 'application/vnd.debian.binary-package', 'application/x-deb', 'application/x-rpm', 'application/x-redhat-package-manager'] as const;
/** dev limits (src/manager.rs) mirrored so the page can warn before it hands the file over. */
export const LIMITS = {maxFiles: 100_000, maxBytes: 2 * 1024 * 1024 * 1024, maxManifest: 1024 * 1024} as const;
const MANIFESTS = ['package.json', 'dev-package.json'];

export function packageKind(path: string): PackageKind | null {
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    return PACKAGE_EXTENSIONS.find(item => name.length > item.suffix.length && name.endsWith(item.suffix))?.kind ?? null;
}
export const isPackageFile = (path: string) => packageKind(path) !== null;
/** Matches DevOsPM native::package_name for identity joins and replacement. */
export const nativePackageName = (name: string) => Array.from(name.trim()).map(char => /^[A-Za-z0-9_]$/.test(char) ? char.toLowerCase() : '-').slice(0, 64).join('');

/** Same rule dev uses (manager::safe_path), so a "safe" verdict here never contradicts the installer. */
export function unsafeArchivePath(name: string): string | null {
    if (!name) return 'empty path';
    if (name.includes('\0')) return 'NUL byte in path';
    if (name.includes('\\')) return 'backslash in path';
    if (name.startsWith('/')) return 'absolute path';
    if (name.includes(':')) return 'colon in path';
    if (name.length > 1024) return 'path longer than 1024 bytes';
    if (/[\u0001-\u001f\u007f]/.test(name)) return 'control character in path';
    if (name.split('/').some(part => part === '..')) return 'parent-directory (..) segment';
    return null;
}
export const normalizeArchivePath = (name: string) => name.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');

export interface TarEntry {name: string; size: number; type: string; link?: string;}
export interface TarListing {
    entries: TarEntry[]; manifest?: {name: string; text: string}; truncated: boolean; error?: string; totalBytes: number;
}
export interface TarLimits {maxEntries: number; maxOutput: number; stopWhenInstallable?: boolean;}
/** Returns up to `n` bytes; an empty array is end-of-stream. */
export type ByteSource = (n: number) => Uint8Array;

const decoder = new TextDecoder('utf-8');
const cString = (bytes: Uint8Array) => { const end = bytes.indexOf(0); return decoder.decode(end < 0 ? bytes : bytes.subarray(0, end)); };
function octal(bytes: Uint8Array): number {
    if (bytes[0] & 0x80) { // GNU base-256 for sizes above 8 GiB
        let value = bytes[0] & 0x7f; for (let i = 1; i < bytes.length; i++) value = value * 256 + bytes[i]; return value;
    }
    const text = cString(bytes).trim(); return text ? parseInt(text, 8) : 0;
}
function readExact(source: ByteSource, n: number): Uint8Array | null {
    const out = new Uint8Array(n); let have = 0;
    while (have < n) { const chunk = source(n - have); if (!chunk.length) return have ? null : new Uint8Array(0); out.set(chunk, have); have += chunk.length; }
    return out;
}

/** Walk tar headers from a (decompressed) byte source, bounded by entry and output budgets. */
export function listTar(source: ByteSource, limits: TarLimits): TarListing {
    const result: TarListing = {entries: [], truncated: false, totalBytes: 0};
    let consumed = 0, longName: string | undefined, paxName: string | undefined;
    const skip = (count: number) => { while (count > 0) { const chunk = source(Math.min(count, 65536)); if (!chunk.length) throw new Error('Archive ended inside a file'); count -= chunk.length; consumed += chunk.length; } };
    try {
        for (;;) {
            if (result.entries.length >= limits.maxEntries || consumed > limits.maxOutput) { result.truncated = true; break; }
            const header = readExact(source, 512); if (!header || !header.length) break; consumed += 512;
            if (header.every(byte => byte === 0)) break;
            const size = octal(header.subarray(124, 136)), type = String.fromCharCode(header[156] || 48);
            if (!Number.isFinite(size) || size < 0) throw new Error('Corrupt tar header');
            const padded = Math.ceil(size / 512) * 512;
            if (type === 'L' || type === 'x') {
                if (size > LIMITS.maxManifest) throw new Error('Oversized tar metadata');
                const data = readExact(source, padded) ?? new Uint8Array(0); consumed += padded;
                if (type === 'L') longName = cString(data.subarray(0, size));
                else for (const line of decoder.decode(data.subarray(0, size)).split('\n')) { const match = /^\d+ path=(.*)$/.exec(line); if (match) paxName = match[1]; }
                continue;
            }
            let name = paxName ?? longName; paxName = longName = undefined;
            if (name === undefined) { const prefix = cString(header.subarray(345, 500)), base = cString(header.subarray(0, 100)); name = prefix && /ustar/.test(cString(header.subarray(257, 263))) ? `${prefix}/${base}` : base; }
            const entry: TarEntry = {name, size, type}; if (type === '1' || type === '2') entry.link = cString(header.subarray(157, 257));
            result.entries.push(entry); result.totalBytes += size;
            const normal = normalizeArchivePath(name);
            if ((type === '0' || type === '\0') && MANIFESTS.includes(normal) && !result.manifest && size <= LIMITS.maxManifest) {
                const data = readExact(source, padded) ?? new Uint8Array(0); consumed += padded;
                result.manifest = {name: normal, text: decoder.decode(data.subarray(0, size))};
            } else skip(padded);
            if (limits.stopWhenInstallable && archiveLooksInstallable(result.entries)) break;
        }
    } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
    return result;
}

/** Installable .tar.gz rule: a Dev OS manifest at the archive root, or a launcher .desktop file inside it. */
export function archiveLooksInstallable(entries: readonly {name: string; type?: string}[]): boolean {
    return entries.some(entry => {
        const name = normalizeArchivePath(entry.name);
        if (entry.type === '5' || unsafeArchivePath(name)) return false;
        return MANIFESTS.includes(name) || (name.endsWith('.desktop') && name.split('/').length <= 5);
    });
}

// --- Gio-backed sources ----------------------------------------------------------------------------------

export function streamSource(stream: Gio.InputStream): ByteSource {
    return n => { const bytes = stream.read_bytes(n, null); return bytes.get_size() ? bytes.toArray() : new Uint8Array(0); };
}
export function gunzipSource(stream: Gio.InputStream): ByteSource {
    return streamSource(Gio.ConverterInputStream.new(stream, new Gio.ZlibDecompressor({format: Gio.ZlibCompressorFormat.GZIP})));
}
export const memoryStream = (bytes: Uint8Array) => Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(bytes));
export function fileStream(path: string): Gio.InputStream { return Gio.File.new_for_path(path).read(null); }
export function fileSize(path: string): number { return Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size(); }
function readBytes(path: string, offset: number, length: number): Uint8Array {
    const stream = fileStream(path) as Gio.FileInputStream;
    try { if (offset) stream.seek(offset, GLib.SeekType.SET, null); return readExact(streamSource(stream), length) ?? new Uint8Array(0); } finally { stream.close(null); }
}

export type Installable = 'yes' | 'no' | 'unknown';
const detectionCache = new Map<string, Installable>();
/** Bounded synchronous probe for the Files menu and double-click; `unknown` (budget exhausted) is treated as installable. */
export function tarGzInstallable(path: string, mtime = 0): Installable {
    const key = `${path}\0${mtime}`, cached = detectionCache.get(key); if (cached) return cached;
    let verdict: Installable;
    try {
        const stream = fileStream(path);
        try {
            const listing = listTar(gunzipSource(stream), {maxEntries: 400, maxOutput: 8 * 1024 * 1024, stopWhenInstallable: true});
            verdict = archiveLooksInstallable(listing.entries) ? 'yes' : listing.error ? 'no' : listing.truncated ? 'unknown' : 'no';
        } finally { stream.close(null); }
    } catch { verdict = 'no'; }
    if (detectionCache.size > 200) detectionCache.clear();
    detectionCache.set(key, verdict); return verdict;
}
/** Whether Files should offer / perform installation for this path. Folders never qualify. */
export function installableFile(path: string, directory = false, mtime = 0): boolean {
    if (directory) return false;
    const kind = packageKind(path);
    if (!kind) return false;
    return kind === 'tar.gz' ? tarGzInstallable(path, mtime) !== 'no' : true;
}

// --- Inspection ------------------------------------------------------------------------------------------

export interface PackageInfo {
    kind: PackageKind; path: string; fileName: string; size: number;
    id?: string; name?: string; version?: string; arch?: string; summary?: string; description?: string; license?: string; packageKind?: string;
    fileCount?: number; totalBytes?: number; dependencies: string[]; commands: string[]; launchers: string[];
    scripts: string[]; warnings: string[]; blockers: string[]; signature: string; details: string; icon?: string;
}
const blank = (kind: PackageKind, path: string, size: number): PackageInfo => ({kind, path, fileName: GLib.path_get_basename(path), size, dependencies: [], commands: [], launchers: [], scripts: [], warnings: [], blockers: [], signature: '', details: ''});

function auditEntries(info: PackageInfo, entries: readonly TarEntry[], strictLinks: boolean) {
    let links = 0, files = 0, bytes = 0;
    for (const entry of entries) {
        const name = normalizeArchivePath(entry.name), problem = unsafeArchivePath(name);
        if (problem) { info.blockers.push(`Unsafe path "${entry.name}" (${problem}); the package manager will refuse this archive.`); continue; }
        if (entry.type === '5') continue;
        if (entry.type !== '0' && entry.type !== '\0' && entry.type !== '7') { links++; continue; }
        files++; bytes += entry.size;
        if (name.endsWith('.desktop')) info.launchers.push(name);
    }
    if (links) (strictLinks ? info.blockers : info.warnings).push(strictLinks
        ? `${links} link/special file(s): .dpk and .tar.gz packages with links are refused by the package manager.`
        : `${links} link/special file(s) will be skipped, not recreated.`);
    info.fileCount = files; info.totalBytes = bytes;
    if (files > LIMITS.maxFiles) info.blockers.push(`More than ${LIMITS.maxFiles} files.`);
    if (bytes > LIMITS.maxBytes) info.blockers.push('Unpacked size is over 2 GiB.');
}
function applyManifest(info: PackageInfo, listing: TarListing) {
    if (!listing.manifest) { info.warnings.push('No package.json: name and version come from the file name (version 0.0.0).'); return; }
    try {
        const data = JSON.parse(listing.manifest.text) as Record<string, unknown>, text = (key: string) => typeof data[key] === 'string' ? data[key] as string : undefined;
        info.name = text('fullname') || text('shortname') || text('name'); info.version = text('version'); info.summary = text('description'); info.packageKind = text('kind') ?? 'app'; info.id = text('name');
        info.icon = text('icon');
        const bin = data.bin ?? data.commands;
        info.commands = typeof bin === 'string' ? [text('name') ?? ''] : bin && typeof bin === 'object' ? Object.keys(bin) : [];
    } catch { info.blockers.push('package.json is not valid JSON.'); }
}

export function inspectArchive(path: string, kind: 'dpk' | 'tar.gz'): PackageInfo {
    const info = blank(kind, path, fileSize(path));
    info.signature = 'Not signed. The format has no signature, so Dev OS cannot verify who published it. Only install files you trust.';
    const stream = fileStream(path);
    try {
        const listing = listTar(gunzipSource(stream), {maxEntries: LIMITS.maxFiles + 1, maxOutput: LIMITS.maxBytes + 64 * 1024 * 1024});
        if (listing.error) info.blockers.push(`Cannot read the archive: ${listing.error}. A file renamed to .${kind} must be a real tar + gzip archive.`);
        if (listing.truncated) info.blockers.push('Archive is too large or has too many entries.');
        auditEntries(info, listing.entries, true); applyManifest(info, listing);
        if (!info.name) info.name = GLib.path_get_basename(path).replace(/\.(dpkx?|tar\.gz)$/i, '');
        info.id ??= info.name;
        if (!listing.manifest && !archiveLooksInstallable(listing.entries) && kind === 'tar.gz') info.blockers.push('This archive has no package.json or .desktop launcher, so it does not look like an installable package.');
    } catch (error) { info.blockers.push(`Cannot read the archive: ${String(error)}`); } finally { stream.close(null); }
    if (!info.commands.length && !info.launchers.length && !info.blockers.length) info.warnings.push('The package exports no command, so it will not appear in the launcher.');
    return info;
}

// .deb: ar archive with debian-binary, control.tar.* and data.tar.*
export interface ArMember {name: string; offset: number; size: number;}
export function parseAr(header: Uint8Array, memberAt: (offset: number, length: number) => Uint8Array, total: number): ArMember[] {
    if (decoder.decode(header.subarray(0, 8)) !== '!<arch>\n') throw new Error('Not a Debian package (missing ar header)');
    const members: ArMember[] = []; let offset = 8;
    while (offset + 60 <= total && members.length < 16) {
        const head = memberAt(offset, 60), name = decoder.decode(head.subarray(0, 16)).trim().replace(/\/$/, ''), size = parseInt(decoder.decode(head.subarray(48, 58)).trim(), 10);
        if (!Number.isFinite(size) || size < 0) throw new Error('Corrupt ar member header');
        members.push({name, offset: offset + 60, size}); offset += 60 + size + (size % 2);
    }
    return members;
}
export function parseDebControl(text: string): Record<string, string> {
    const fields: Record<string, string> = {}; let last = '';
    for (const line of text.split('\n')) {
        if (/^\s/.test(line) && last) fields[last] += `\n${line.trim()}`;
        else { const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line); if (match) { last = match[1]; fields[last] = match[2]; } }
    }
    return fields;
}
export function inspectDeb(path: string): PackageInfo {
    const total = fileSize(path), info = blank('deb', path, total);
    info.signature = 'Debian packages carry no signature of their own (repositories sign indexes). Dev OS cannot verify this file.';
    info.warnings.push('Built for Debian/Ubuntu: it may not run here (different libc and libraries). Maintainer scripts are never run and dependencies are not installed.');
    try {
        const members = parseAr(readBytes(path, 0, 8), (offset, length) => readBytes(path, offset, length), total);
        const control = members.find(member => member.name.startsWith('control.tar')), data = members.find(member => member.name.startsWith('data.tar'));
        if (!control || !data) throw new Error('Missing control.tar or data.tar member');
        if (!/\.(gz|xz|zst)$/.test(control.name) || !/\.(gz|xz|zst)$/.test(data.name)) info.blockers.push(`Unsupported compression (${data.name}); the package manager reads gzip, xz and zstd.`);
        if (control.size < 4 * 1024 * 1024) {
            const listing = readDebControlArchive(control.name, readBytes(path, control.offset, control.size));
            const fields = parseDebControl(listing.control ?? '');
            if (!fields.Package || !fields.Version) throw new Error('The Debian control archive has no package name or version');
            info.name = fields.Package; info.version = fields.Version; info.arch = fields.Architecture; info.summary = fields.Description?.split('\n')[0]; info.description = fields.Description;
            if (fields['Installed-Size']) info.totalBytes = parseInt(fields['Installed-Size'], 10) * 1024;
            info.dependencies = (fields.Depends ?? '').split(',').map(item => item.trim()).filter(Boolean);
            info.scripts = listing.scripts;
        } else throw new Error('Debian control metadata exceeds the 4 MiB inspection limit');
        if (info.scripts.length) info.warnings.push(`Maintainer scripts (${info.scripts.join(', ')}) will NOT be executed.`);
        if (data.name.endsWith('.gz') && data.size < 256 * 1024 * 1024) {
            const stream = memoryStream(readBytes(path, data.offset, data.size));
            const listing = listTar(gunzipSource(stream), {maxEntries: LIMITS.maxFiles + 1, maxOutput: LIMITS.maxBytes});
            auditEntries(info, listing.entries, false);
            info.commands = listing.entries.filter(entry => entry.type === '0' || entry.type === '\0').map(entry => normalizeArchivePath(entry.name)).filter(name => /^(usr\/(local\/)?s?bin|s?bin)\/[^/]+$/.test(name)).map(name => name.slice(name.lastIndexOf('/') + 1));
        } else info.fileCount = undefined;
        if (!info.name) info.name = GLib.path_get_basename(path).replace(/_.*$|\.deb$/i, '');
        info.id = info.name ? nativePackageName(info.name) : undefined;
    } catch (error) { info.blockers.push(`Cannot read the package: ${String(error)}`); }
    return info;
}
function readDebControlArchive(name: string, bytes: Uint8Array): {control?: string; scripts: string[]} {
    if (name.endsWith('.gz')) return listTarMembersWithText(gunzipSource(memoryStream(bytes)));
    const program = name.endsWith('.xz') ? 'xz' : name.endsWith('.zst') ? 'zstd' : '';
    const binary = program && GLib.find_program_in_path(program);
    if (!binary) throw new Error(`Install ${program || 'a supported decompressor'} to inspect this Debian control archive`);
    const [fd, temporary] = GLib.file_open_tmp('devos-control-XXXXXX'); GLib.close(fd);
    let process: Gio.Subprocess | undefined;
    try {
        GLib.file_set_contents(temporary, bytes);
        const args = program === 'xz' ? ['--decompress', '--stdout', '--memlimit-decompress=512MiB'] : ['--decompress', '--stdout', '--memory=512MB'];
        process = Gio.Subprocess.new([binary, ...args, temporary], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        const stream = process.get_stdout_pipe()!;
        return listTarMembersWithText(length => stream.read_bytes(length, null).toArray());
    } finally {
        if (process) {process.force_exit(); process.wait(null);}
        Gio.File.new_for_path(temporary).delete(null);
    }
}
function listTarMembersWithText(source: ByteSource): {control?: string; scripts: string[]} {
    const scripts: string[] = []; let control: string | undefined, total = 0;
    for (let guard = 0; guard < 64; guard++) {
        const header = readExact(source, 512); if (!header || !header.length || header.every(byte => byte === 0)) break;
        const name = normalizeArchivePath(cString(header.subarray(0, 100))), size = octal(header.subarray(124, 136)), padded = Math.ceil(size / 512) * 512;
        total += 512 + padded;
        if (!Number.isSafeInteger(padded) || padded < 0 || total > 4 * 1024 * 1024) throw new Error('Debian control metadata exceeds the 4 MiB inspection limit');
        const data = readExact(source, padded) ?? new Uint8Array(0);
        if (name === 'control' && size < LIMITS.maxManifest) control = decoder.decode(data.subarray(0, size));
        if (['preinst', 'postinst', 'prerm', 'postrm'].includes(name) && size > 0) scripts.push(name);
    }
    return {control, scripts};
}

// .rpm: lead + signature header + metadata header (big-endian tag tables)
const RPM = {name: 1000, version: 1001, release: 1002, summary: 1004, description: 1005, size: 1009, license: 1014, arch: 1022, prein: 1023, postin: 1024, preun: 1025, postun: 1026,
    dirindexes: 1116, basenames: 1117, dirnames: 1118, requirename: 1049, sigPgp: 259, sigRsa: 268, sigGpg: 262} as const;
export interface RpmHeader {tags: Map<number, string | string[] | number[]>;}
function parseRpmHeader(bytes: Uint8Array, at: number): {header: RpmHeader; end: number} {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(at) >>> 8 !== 0x8eade8) throw new Error('Corrupt RPM header magic');
    const count = view.getUint32(at + 8), dataSize = view.getUint32(at + 12);
    if (count > 100_000 || dataSize > 64 * 1024 * 1024) throw new Error('Oversized RPM header');
    const storeStart = at + 16 + count * 16, tags = new Map<number, string | string[] | number[]>();
    if (storeStart + dataSize > bytes.length) throw new Error('Truncated RPM header');
    for (let i = 0; i < count; i++) {
        const base = at + 16 + i * 16, tag = view.getUint32(base), type = view.getUint32(base + 4), offset = view.getUint32(base + 8), n = view.getUint32(base + 12);
        if (offset > dataSize) continue;
        let position = storeStart + offset;
        const read = () => { const end = bytes.indexOf(0, position); const text = decoder.decode(bytes.subarray(position, end < 0 ? storeStart + dataSize : end)); position = (end < 0 ? storeStart + dataSize : end) + 1; return text; };
        if (type === 6 || type === 9) tags.set(tag, read());
        else if (type === 8) tags.set(tag, Array.from({length: Math.min(n, 100_000)}, read));
        else if (type === 4 && position + 4 * n <= bytes.length) tags.set(tag, Array.from({length: n}, (_, k) => view.getUint32(position + 4 * k)));
        else if (type === 3 && position + 2 * n <= bytes.length) tags.set(tag, Array.from({length: n}, (_, k) => view.getUint16(position + 2 * k)));
        else if (type === 7) tags.set(tag, [`${n} bytes`]);
    }
    return {header: {tags}, end: storeStart + dataSize};
}
export function parseRpm(bytes: Uint8Array): {signature: RpmHeader; header: RpmHeader} {
    if (bytes.length < 112 || bytes[0] !== 0xed || bytes[1] !== 0xab || bytes[2] !== 0xee || bytes[3] !== 0xdb) throw new Error('Not an RPM package (bad magic)');
    const signature = parseRpmHeader(bytes, 96), start = signature.end + ((8 - (signature.end % 8)) % 8);
    return {signature: signature.header, header: parseRpmHeader(bytes, start).header};
}
export function inspectRpm(path: string): PackageInfo {
    const size = fileSize(path), info = blank('rpm', path, size);
    info.warnings.push('Built for Fedora/RHEL/SUSE: it may not run here (different libc and libraries). Scriptlets are never run and dependencies are not installed.');
    try {
        const {signature, header} = parseRpm(readBytes(path, 0, Math.min(size, 8 * 1024 * 1024)));
        const text = (tag: number) => { const value = header.tags.get(tag); return typeof value === 'string' ? value : undefined; };
        info.name = text(RPM.name); info.version = [text(RPM.version), text(RPM.release)].filter(Boolean).join('-') || undefined; info.arch = text(RPM.arch); info.summary = text(RPM.summary);
        info.description = text(RPM.description); info.license = text(RPM.license);
        const total = header.tags.get(RPM.size); if (Array.isArray(total) && typeof total[0] === 'number') info.totalBytes = total[0];
        const dirs = header.tags.get(RPM.dirnames), bases = header.tags.get(RPM.basenames), index = header.tags.get(RPM.dirindexes);
        if (Array.isArray(bases) && Array.isArray(dirs) && Array.isArray(index)) {
            const paths = (bases as string[]).map((base, i) => `${(dirs as string[])[(index as number[])[i]] ?? ''}${base}`);
            info.fileCount = paths.length;
            for (const path of paths) { const problem = unsafeArchivePath(path.replace(/^\//, '')); if (problem) info.blockers.push(`Unsafe path "${path}" (${problem}).`); }
            info.commands = paths.filter(item => /^\/usr\/(local\/)?s?bin\/[^/]+$|^\/s?bin\/[^/]+$/.test(item)).map(item => item.slice(item.lastIndexOf('/') + 1));
            info.launchers = paths.filter(item => item.endsWith('.desktop'));
        }
        const requires = header.tags.get(RPM.requirename); if (Array.isArray(requires)) info.dependencies = (requires as string[]).filter(item => !item.startsWith('rpmlib('));
        info.scripts = [['preinstall', RPM.prein], ['postinstall', RPM.postin], ['preuninstall', RPM.preun], ['postuninstall', RPM.postun]].filter(([, tag]) => header.tags.has(tag as number)).map(([label]) => label as string);
        if (info.scripts.length) info.warnings.push(`Scriptlets (${info.scripts.join(', ')}) will NOT be executed.`);
        info.signature = [RPM.sigPgp, RPM.sigRsa, RPM.sigGpg].some(tag => signature.tags.has(tag))
            ? 'Contains an RPM signature, but Dev OS does not verify it. Only install files you trust.' : 'Not signed. Dev OS cannot verify who published it.';
        if (!info.name) info.name = GLib.path_get_basename(path).replace(/\.rpm$/i, '');
        info.id = info.name ? nativePackageName(info.name) : undefined;
    } catch (error) { info.blockers.push(`Cannot read the package: ${String(error)}`); }
    return info;
}

export function inspectPackage(path: string): PackageInfo {
    const kind = packageKind(path);
    if (!kind) throw new Error('Not a package file (.dpk, .deb, .rpm or .tar.gz expected).');
    return kind === 'deb' ? inspectDeb(path) : kind === 'rpm' ? inspectRpm(path) : inspectArchive(path, kind);
}
