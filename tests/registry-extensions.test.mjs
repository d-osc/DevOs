import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import data from '../src/apps/org.devos.appstore/registry-data.ts';

const result = await build({entryPoints: ['src/apps/org.devos.appstore/registry-extensions.ts'], bundle: true, write: false, platform: 'node', format: 'esm'});
const {registryExtensions, matchesExtension, matchingExtensionRelease} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const {listing, manifest} = data.extensions[0];
const snapshot = (value = listing, runtime = manifest) => ({schema_version: 2, extensions: [{listing: value, manifest: runtime, readme: 'Example notes'}]});

test('bundled registry displays the local example without a fictitious release', () => {
    const entries = registryExtensions();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'org.example.workspace-notes');
    assert.equal(entries[0].repository, undefined);
    assert.ok(entries[0].iconBase64);
    assert.ok(entries[0].readme.includes('Workspace Notes'));
    assert.ok(matchesExtension(entries[0], 'settings'));
    assert.ok(matchesExtension(entries[0], 'DevOs Examples'));
    assert.equal(matchesExtension(entries[0], 'no-such-extension'), false);
});
test('only published GitHub sources expose availability checks', () => {
    const github = {...listing, delivery: {...listing.delivery, source: {type: 'github', repository: 'test-owner/workspace-notes'}}};
    assert.equal(registryExtensions(snapshot(github))[0].repository, undefined);
    assert.equal(registryExtensions(snapshot({...github, status: 'published'}))[0].repository, 'test-owner/workspace-notes');
    assert.throws(() => registryExtensions(snapshot({...listing, status: 'published'})));
    assert.throws(() => registryExtensions(snapshot({...github, status: 'published', delivery: {...github.delivery, source: {type: 'github', repository: '../escape'}}})));
});
test('mismatched IDs and protected extensions fail closed', () => {
    assert.throws(() => registryExtensions(snapshot(listing, {...manifest, id: 'org.other.extension'})));
    assert.throws(() => registryExtensions(snapshot({...listing, id: 'org.devos.launcher'}, {...manifest, id: 'org.devos.launcher'})));
    assert.throws(() => registryExtensions(snapshot(listing, {...manifest, system: true})));
    assert.throws(() => registryExtensions({schema_version: 1, extensions: []}));
    assert.equal(matchingExtensionRelease(listing.id, 'org.other.extension'), false);
    assert.equal(matchingExtensionRelease(listing.id, listing.id), true);
});
