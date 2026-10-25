import {Gio, GLib, removeTree} from '@dev-os/core';
import System from 'system';
import {
    buildManifest, parseManifest, parsePatch, parseSums, diffManifests, patchAssetName, serialize, validatePatchArchive
} from '@dev-os/updates/manifest';
import {applyPatch, createPatch, verifyTree, checkSignature, trustedKeys} from '@dev-os/updates/package';
import {ROOT} from '@dev-os/config';
import {assert, fails, rejects, run, write, read, size, pack, repack, sums, target} from './update-fixtures.js';

const noKeys = '/nonexistent-dev-os-keys';
async function main() {
    const base = GLib.dir_make_tmp('dev-os-update-package-XXXXXX');
    try {
        // ---- Manifest format -------------------------------------------------------------------------------------
        const v1 = pack(base, '0.3.0'), v2 = pack(base, '0.4.0', {'data/new.txt': 'added in 0.4.0\n', 'dist/main.js': '// 0.4.0 main changed\n'}), v3 = pack(base, '0.5.0', {'data/new.txt': 'added in 0.4.0\n'});
        const m1 = parseManifest(JSON.parse(read(`${v1.directory}/dev-os/manifest.json`))), m2 = parseManifest(JSON.parse(read(`${v2.directory}/dev-os/manifest.json`)));
        assert(m1.files.length > 8 && m1.postInstall.join() === 'restart-shell' && m1.rollback.strategy === 'keep-previous' && m1.minCompatible === '0.0.0', 'Manifest records files, post-install action and rollback strategy');
        const diff = diffManifests(m1, m2);
        assert(diff.add.map(item => item.path).join() === 'data/new.txt' && diff.remove.join() === 'data/old-only.txt' && diff.replace.map(item => item.path).sort().join() === 'bin/dev-os-session,bin/dev-os-shell,dist/main.js,release.json', `Diff lists exactly the changes: ${JSON.stringify(diff)}`);
        const raw = JSON.parse(read(`${v1.directory}/dev-os/manifest.json`));
        fails(() => parseManifest({...raw, postInstall: ['rm -rf /']}), 'unknown post-install');
        fails(() => parseManifest({...raw, files: [{...raw.files[0], path: '../escape'}]}), 'Unsafe path');
        fails(() => parseManifest({...raw, files: [{...raw.files[0], path: '/etc/passwd'}]}), 'Unsafe path');
        fails(() => parseManifest({...raw, files: [raw.files[0], raw.files[0]]}), 'Duplicate');
        fails(() => parseManifest({...raw, files: [{...raw.files[0], sha256: 'xyz'}]}), 'checksum');
        fails(() => parseManifest({...raw, files: [{path: 'a', sha256: 'a'.repeat(64), size: 1, mode: '644'}, {path: 'a/b', sha256: 'a'.repeat(64), size: 1, mode: '644'}]}), 'share a path');
        fails(() => parseManifest({...raw, format: 2}), 'Unsupported');
        fails(() => parseManifest(raw, {version: '9.9.9'}), 'does not match');
        fails(() => parseSums(`${'a'.repeat(64)}  ../x\n`), 'invalid line');
        assert(parseSums(`${'a'.repeat(64)}  dev-os-linux-x64.tar.gz\n`).size === 1, 'SHA256SUMS parses');
        assert(patchAssetName('0.3.0', '0.4.0', 'linux-x64') === 'dev-os-patch-0.3.0-to-0.4.0-linux-x64.tar.gz', 'Patch asset name');
        print('PASS: manifest format, safe paths, closed post-install list, diff');

        // ---- Tree verification -----------------------------------------------------------------------------------
        const tree = `${base}/verify`; run(['cp', '-a', `${v1.directory}/dev-os`, tree]);
        await verifyTree(tree, m1, new Gio.Cancellable());
        write(`${tree}/dist/main.js`, '// tampered\n');
        await rejects(verifyTree(tree, m1, new Gio.Cancellable()), 'does not match its manifest checksum');
        write(`${tree}/dist/main.js`, '// 0.3.0 main\n'); write(`${tree}/dist/extra.js`, 'x');
        await rejects(verifyTree(tree, m1, new Gio.Cancellable()), 'Unexpected file dist/extra.js');
        removeTree(`${tree}/dist/extra.js`); removeTree(`${tree}/data/same.txt`);
        await rejects(verifyTree(tree, m1, new Gio.Cancellable()), 'missing files');
        print('PASS: unpacked tree must equal the manifest (content, file set, executable bits)');

        // ---- Patch creation and application ---------------------------------------------------------------------
        const patch = `${base}/${patchAssetName('0.3.0', '0.4.0', target)}`;
        const meta = await createPatch(v1.archive, v2.archive, patch);
        assert(meta.add.length === 1 && meta.replace.length === 4 && meta.remove.length === 1, 'Patch carries only the differences');
        assert(size(patch) < size(v2.archive) + 4096, 'Patch is not larger than the full package');
        const names = run(['tar', '-tzf', patch]), details = run(['tar', '-tvzf', patch, '--numeric-owner']);
        validatePatchArchive(names, details);
        assert(!names.includes('data/same.txt'), 'Unchanged files are not in the patch');
        parsePatch(JSON.parse(run(['tar', '-xzOf', patch, 'dev-os-patch/patch.json'])));
        const installed1 = `${base}/installed-0.3.0`; run(['tar', '-xzf', v1.archive, '-C', base, '--transform', `s,^dev-os,installed-0.3.0,`]);
        const before = run(['sh', '-c', `cd "${installed1}" && find . -type f | sort | xargs sha256sum`]);
        const applied = `${base}/applied-0.4.0`;
        const result = await applyPatch(patch, installed1, applied, new Gio.Cancellable());
        assert(result.manifest.version === '0.4.0' && read(`${applied}/dist/main.js`).includes('0.4.0 main changed') && !GLib.file_test(`${applied}/data/old-only.txt`, GLib.FileTest.EXISTS), 'Patch produces the 0.4.0 tree');
        assert(GLib.file_test(`${applied}/bin/dev-os-session`, GLib.FileTest.IS_EXECUTABLE), 'Executable bits survive the patch');
        assert(run(['sh', '-c', `cd "${installed1}" && find . -type f | sort | xargs sha256sum`]) === before, 'The installed base is never modified');
        // Patched tree is byte-identical to the full package.
        const full = `${base}/full-0.4.0`; run(['tar', '-xzf', v2.archive, '-C', base, '--transform', 's,^dev-os,full-0.4.0,']);
        assert(run(['diff', '-r', applied, full]) === '', 'Patched tree equals the full package');
        // Wrong base, damaged base and a tampered patch are refused without leaving anything behind.
        const other = `${base}/installed-other`; run(['cp', '-a', installed1, other]); write(`${other}/data/same.txt`, 'locally edited\n');
        await rejects(applyPatch(patch, other, `${base}/applied-other`, new Gio.Cancellable()), 'does not match its manifest checksum');
        const evil = repack(patch, scratch => write(`${scratch}/dev-os-patch/tree/dist/main.js`, '// evil\n'), 'evil');
        await rejects(applyPatch(evil, installed1, `${base}/applied-evil`, new Gio.Cancellable()), 'does not match its manifest checksum');
        assert(!GLib.file_test(`${base}/applied-evil`, GLib.FileTest.EXISTS), 'Failed patch leaves no half-built tree');
        const smuggled = repack(patch, scratch => write(`${scratch}/dev-os-patch/tree/bin/backdoor`, '#!/bin/sh\n'), 'smuggled');
        await rejects(applyPatch(smuggled, installed1, `${base}/applied-smuggled`, new Gio.Cancellable()), 'Unexpected file bin/backdoor');
        const wrongBase = `${base}/installed-wrong`; run(['tar', '-xzf', v3.archive, '-C', base, '--transform', 's,^dev-os,installed-wrong,']);
        await rejects(applyPatch(patch, wrongBase, `${base}/applied-wrong`, new Gio.Cancellable()), 'is for Dev OS 0.3.0');
        print('PASS: patch is minimal, reproduces the full package exactly and rejects tampering, extra files and the wrong base');

        // The release tool: same result through the command line the workflow uses.
        const cli = run(['gjs', '-m', `${ROOT}/dist/make-patch.js`, '--from', v1.archive, '--to', v2.archive, '--output', `${base}/cli`]);
        assert(cli.includes('1 added, 4 replaced, 1 removed') && size(`${base}/cli/${patchAssetName('0.3.0', '0.4.0', target)}`) === size(patch), `make-patch CLI: ${cli}`);
        print('PASS: make-patch command line writes the same patch');

        // ---- Signatures --------------------------------------------------------------------------------------------
        const keys = `${base}/keys`; GLib.mkdir_with_parents(keys, 0o700);
        const privateKey = `${base}/private.pem`, other2 = `${base}/other.pem`;
        run(['openssl', 'genpkey', '-algorithm', 'ed25519', '-out', privateKey]); run(['openssl', 'pkey', '-in', privateKey, '-pubout', '-out', `${keys}/release.pub`]);
        run(['openssl', 'genpkey', '-algorithm', 'ed25519', '-out', other2]);
        assert(trustedKeys(keys).length === 1 && trustedKeys(noKeys).length === 0, 'Keys are read from the directory shipped with the running version');
        const signed = sums(base, 'sig', [{name: 'a.tar.gz', path: v1.archive}], {key: privateKey});
        const cancel = new Gio.Cancellable();
        assert(await checkSignature(signed[0].path, signed[1].path, trustedKeys(keys), cancel) === 'verified', 'Valid signature verifies');
        assert(await checkSignature(signed[0].path, null, [], cancel) === 'unsigned', 'Without a key, releases are hash-only');
        await rejects(checkSignature(signed[0].path, null, trustedKeys(keys), cancel), 'not signed');
        const forged = sums(base, 'forged', [{name: 'a.tar.gz', path: v1.archive}], {key: other2});
        await rejects(checkSignature(forged[0].path, forged[1].path, trustedKeys(keys), cancel), 'signature is invalid');
        const tampered = sums(base, 'tampered', [{name: 'a.tar.gz', path: v1.archive}], {key: privateKey}, true);
        await rejects(checkSignature(tampered[0].path, tampered[1].path, trustedKeys(keys), cancel), 'signature is invalid');
        print('PASS: Ed25519 signature of SHA256SUMS: valid, missing, wrong key and modified sums');

    } finally { removeTree(base); }
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void main().catch(error => { failed = error; }).finally(() => loop.quit());
loop.run();
if (failed) { printerr(String(failed instanceof Error ? failed.stack ?? failed : failed)); System.exit(1); }
print('Update package tests passed');

