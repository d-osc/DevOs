import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ROOT, readText, saveConfig, loadConfig} from '../src/config.js';
import {ExtensionManager} from '../src/extensions/manager.js';
import {validateManifest, validateState, validateValues, validateExtensionId} from '../src/extensions/schema.js';
import {clockFormat} from '../src/extensions/clock.js';
import {UIRuntime} from '../src/extensions/runtime.js';
import type {UIContext, UICommand} from '../src/extensions/runtime.js';
import {systemManifests, loadSystemExtensions} from '../src/extensions/system.js';

let passed = 0;
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function fails(callback: () => unknown): void { let failed = false; try { callback(); } catch { failed = true; } assert(failed, 'Expected rejection'); }
function test(name: string, callback: () => void): void { callback(); passed++; print(`PASS: extensions ${name}`); }
const manifest = validateManifest(JSON.parse(readText(`${ROOT}/extensions/org.devos.clock/extension.json`)));
const temporary = GLib.dir_make_tmp('dev-os-extensions-XXXXXX');
const paths = {bundled: `${temporary}/bundled`, user: `${temporary}/user`, preferences: `${temporary}/preferences`};
function file(path: string, content: unknown): void {
    GLib.mkdir_with_parents(Gio.File.new_for_path(path).get_parent()!.get_path()!, 0o700);
    GLib.file_set_contents(path, JSON.stringify(content));
}
function cleanup(path: Gio.File): void {
    if (path.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
        const files = path.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        try { for (let item = files.next_file(null); item; item = files.next_file(null)) cleanup(path.get_child(item.get_name())); }
        finally { files.close(null); }
    }
    path.delete(null);
}
try {
    test('system JSON manifests define UI entries and activation order', () => {
        const catalog = systemManifests();
        assert(catalog.map(item => item.id).join(',') === 'org.devos.theme,org.devos.icons,org.devos.updates,org.devos.store,org.devos.launcher,org.devos.settings,org.devos.files,org.devos.terminal,org.devos.editor,org.devos.background,org.devos.panel', 'Manifest order drives activation');
        const panel = catalog.find(item => item.id === 'org.devos.panel')!;
        assert(validateValues(panel, {}).spacing === 12, 'Panel defaults come from JSON');
        for (const entry of ['../main.js', '/tmp/code.js', 'https://example.com/code.js', 'module.ts']) fails(() => validateManifest({...panel, entry}));
        fails(() => validateManifest({...panel, order: -1}));
        fails(() => validateManifest({...panel, enabledByDefault: false}));
        fails(() => validateState(panel, {version: 1, enabled: false, values: {}}));
    });
    const definitions = await loadSystemExtensions();
    test('system loader imports compiled entries declared in JSON', () => {
        assert(definitions.length === 11 && definitions.every(item => typeof item.activate === 'function'), 'Every JSON entry resolves to a UI extension');
    });
    test('system preferences persist while protecting base packages', () => {
        const panel = systemManifests().find(item => item.id === 'org.devos.panel')!;
        const ownPaths = {bundled: `${temporary}/system`, user: `${temporary}/system-user`, preferences: `${temporary}/system-preferences`};
        file(`${ownPaths.bundled}/${panel.id}/extension.json`, panel);
        const system = new ExtensionManager(ownPaths);
        system.update(panel.id, true, {spacing: 20}); system.reload();
        assert(system.get(panel.id).state.values.spacing === 20, 'System settings persist');
        fails(() => system.update(panel.id, false, {spacing: 20}));
        file(`${ownPaths.user}/${panel.id}/extension.json`, {...panel, system: false, name: 'Replacement'});
        system.reload(); assert(system.get(panel.id).manifest.name === 'Panel', 'Base manifest cannot be replaced by user package');
        file(`${ownPaths.preferences}/${panel.id}.json`, {version: 99, enabled: false, values: {spacing: 10}});
        system.reload(); assert(system.get(panel.id).state.enabled && system.get(panel.id).state.values.spacing === 12, 'Base UI remains active with safe defaults');
        fails(() => system.update(panel.id, true, {spacing: 8}));
        system.dispose();
    });
    test('UI lifecycle routes commands and disposes resources in reverse order', () => {
        const commands = new Map<string, UICommand>(), listeners = new Set<() => void>(), order: string[] = [];
        const host = {registerCommand: (name: string, handler: UICommand) => {
            if (commands.has(name)) throw new Error('Duplicate command');
            commands.set(name, handler); return () => { commands.delete(name); };
        }, onReload: (handler: () => void) => { listeners.add(handler); return () => { listeners.delete(handler); }; }} as UIContext;
        const runtime = new UIRuntime();
        runtime.start(['first', 'second'].map(id => ({id, activate(context: UIContext) {
            context.registerCommand(id, () => { order.push(id); });
            context.onReload(() => { order.push(`reload ${id}`); });
            return () => { order.push(`dispose ${id}`); };
        }})), host);
        commands.get('first')!(); for (const listener of listeners) listener(); runtime.stop(); runtime.stop();
        assert(order.join(',') === 'first,reload first,reload second,dispose second,dispose first', 'Lifecycle order');
        assert(commands.size === 0 && listeners.size === 0, 'All commands and subscriptions released');
    });
    test('UI activation failures roll back partial and earlier registrations', () => {
        const commands = new Map<string, UICommand>(); let disposed = 0;
        const host = {registerCommand: (name: string, handler: UICommand) => {
            if (commands.has(name)) throw new Error('Duplicate command');
            commands.set(name, handler); return () => { commands.delete(name); };
        }} as UIContext;
        const runtime = new UIRuntime();
        const first = {id: 'first', activate(context: UIContext) { context.registerCommand('first', () => {}); return () => { disposed++; }; }};
        fails(() => runtime.start([first, {id: 'broken', activate(context) {
            context.registerCommand('partial', () => {}); throw new Error('Activation failed');
        }}], host));
        assert(commands.size === 0 && disposed === 1, 'Rollback after failure');
        fails(() => runtime.start([first, first], host));
        assert(commands.size === 0 && disposed === 2, 'Duplicate ID rolls back');
        fails(() => runtime.start([first, {id: 'duplicate-command', activate(context) {
            context.registerCommand('first', () => {}); return () => {};
        }}], host));
        assert(commands.size === 0 && disposed === 3, 'Duplicate command rolls back');
    });
    test('manifest contract and namespaced IDs', () => {
        for (const id of ['../escape', '/tmp/test', '__proto__', 'UPPER.name', 'single']) fails(() => validateExtensionId(id));
        fails(() => validateManifest({...manifest, apiVersion: 2}));
        fails(() => validateManifest({...manifest, typo: true}));
        const copy = JSON.parse(JSON.stringify(manifest)); copy.settings[0].fields.push(copy.settings[0].fields[0]);
        fails(() => validateManifest(copy));
    });
    test('field validation, defaults and versioning', () => {
        assert(validateValues(manifest, {}).showSeconds === false, 'Missing values use defaults');
        fails(() => validateValues(manifest, {showSeconds: 'yes'}));
        fails(() => validateValues(manifest, {unknown: true}));
        fails(() => validateState(manifest, {version: 2, enabled: true, values: {}}));
        const numberManifest = validateManifest({...manifest, settings: [{id: 'test', title: 'Test', fields: [
            {key: 'size', title: 'Size', type: 'number', default: 40, min: 32, max: 96, integer: true},
            {key: 'color', title: 'Color', type: 'color', default: '#123456'}]}]});
        for (const size of [NaN, 30, 100, 50.5]) fails(() => validateValues(numberManifest, {size}));
        fails(() => validateValues(numberManifest, {color: 'red'}));
    });
    file(`${paths.bundled}/clock/extension.json`, manifest);
    file(`${paths.bundled}/broken/extension.json`, {id: 'bad'});
    const manager = new ExtensionManager(paths);
    test('discovery isolates malformed packages and returns snapshots', () => {
        assert(manager.list().length === 1 && manager.diagnostics.length === 1, 'Bad package is isolated');
        const copy = manager.get(manifest.id); copy.state.values.format = 'mutated';
        assert(manager.get(manifest.id).state.values.format !== 'mutated', 'Snapshot is detached');
        fails(() => manager.get('../escape'));
    });
    test('scoped persistence, live notifications and clock consumer', () => {
        let updates = 0; const unsubscribe = manager.subscribe(() => { updates++; });
        manager.update(manifest.id, true, {format: '%H:%M', showSeconds: true});
        assert(updates === 1 && clockFormat(manager, 'fallback') === '%H:%M:%S', 'Live extension values');
        const persisted = readText(`${paths.preferences}/${manifest.id}.json`);
        fails(() => manager.update(manifest.id, true, {showSeconds: 'wrong'}));
        assert(readText(`${paths.preferences}/${manifest.id}.json`) === persisted, 'Failed save leaves disk intact');
        manager.reload();
        assert(manager.get(manifest.id).state.enabled, 'Enabled state survives reload');
        unsubscribe(); const before = updates;
        manager.update(manifest.id, false, {});
        assert(updates === before && clockFormat(manager, 'fallback') === 'fallback', 'Unsubscribe and disable');
    });
    test('user packages override valid bundled definitions', () => {
        file(`${paths.user}/clock/extension.json`, {...manifest, name: 'User Clock'});
        manager.reload(); assert(manager.get(manifest.id).manifest.name === 'User Clock', 'User package wins');
        file(`${paths.user}/clock/extension.json`, {...manifest, apiVersion: 99});
        manager.reload(); assert(manager.get(manifest.id).manifest.name === 'Clock', 'Invalid override leaves bundled definition');
    });
    test('corrupt or future preferences stay preserved and inactive', () => {
        file(`${paths.preferences}/${manifest.id}.json`, {version: 99, enabled: true, values: {}});
        manager.reload();
        assert(!manager.get(manifest.id).state.enabled && !!manager.get(manifest.id).error, 'Unsupported version is inactive');
        const before = readText(`${paths.preferences}/${manifest.id}.json`);
        fails(() => manager.update(manifest.id, true, {}));
        assert(readText(`${paths.preferences}/${manifest.id}.json`) === before, 'Future data not overwritten');
    });
    test('core and extension settings remain separate', () => {
        const path = `${temporary}/config.json`;
        saveConfig({name: 'Extension test', panel_height: 64}, path);
        const before = readText(path);
        fails(() => saveConfig({panel_height: 10}, path));
        assert(readText(path) === before && loadConfig(path).name === 'Extension test', 'Core save validates before persistence');
        assert(!Object.hasOwn(loadConfig(path), 'extensions'), 'Core config schema unchanged');
    });
    manager.dispose();
} finally { cleanup(Gio.File.new_for_path(temporary)); }
print(`${passed} extension tests passed`);
