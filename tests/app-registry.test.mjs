import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const result = await build({entryPoints: ['src/apps/org.devos.appstore/registry.ts'], bundle: true, write: false, platform: 'node', format: 'esm'});
const {registryApps, matchesApp, safeWebsite} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('bundled registry contains six genuine catalog previews without installation identities', () => {
    const apps = registryApps();
    assert.equal(apps.length, 6);
    for (const app of apps) {
        assert.ok(app.id.startsWith('registry:'));
        assert.equal(app.registry.compatibility, 'untested');
        assert.ok(app.registry.readme.length > 0);
        assert.equal(app.package, undefined);
        assert.equal(app.desktopId, undefined);
    }
});
test('search covers exact aliases, publisher, tags, categories and case folding', () => {
    const apps = registryApps(), vscode = apps.find(app => app.registry.id === 'vscode');
    for (const query of [' CODE ', 'Microsoft', 'editor', 'developer tools']) assert.ok(matchesApp(vscode, query));
    assert.equal(apps.filter(app => matchesApp(app, 'unmatched-string-123')).length, 0);
    assert.ok(apps.some(app => matchesApp(app, 'claude')));
});
test('unsupported schema and malformed or duplicate identities fail closed', () => {
    assert.throws(() => registryApps({schema_version: 1, apps: []}));
    const manifest = {schema_version: 2, id: 'test', name: 'Test', compatibility: {}, publisher: {}, links: {}};
    const entry = {manifest};
    assert.throws(() => registryApps({schema_version: 2, apps: [entry, entry]}));
    assert.throws(() => registryApps({schema_version: 2, apps: [{manifest: {...manifest, id: '../test'}}]}));
});
test('website actions accept HTTPS and reject credentials and unsafe schemes', () => {
    assert.equal(safeWebsite('https://example.com/app'), 'https://example.com/app');
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user@example.com/', 'https:///bad', 'https://example.com/\n']) assert.equal(safeWebsite(url), undefined);
});
