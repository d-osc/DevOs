import {Gtk, Gio, Gdk, GLib, type UIContext} from '@dev-os/core';
import {DEFAULTS, ROOT} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {EditorAssets} from '../src/apps/org.devos.editor/assets.js';
import {EditorWindow} from '../src/apps/org.devos.editor/extension.js';
Gtk.init(null);
const application = new Gtk.Application({application_id: 'org.devos.LiveEditorTest', flags: Gio.ApplicationFlags.NON_UNIQUE});
application.register(null);
const loop = new GLib.MainLoop(null, false);
let failed: unknown;
let expired = false;
// TCG on ARM64 can take much longer than native execution to start the TS worker.
const timeScale = GLib.getenv('DEV_OS_EDITOR_TEST_SLOW') === '1' ? 6 : 1;
async function run() {
    const fixture = GLib.dir_make_tmp('devos-live-editor-XXXXXX');
    const path = `${fixture}/example.ts`;
    GLib.file_set_contents(path, 'const answer: number = 42;\n');
    const preferences = new ExtensionManager({system: `${ROOT}/src/apps`, components: `${ROOT}/src/system`, bundled: `${ROOT}/src/extensions`, user: `${fixture}/packages`, preferences: `${fixture}/preferences`});
    const display = Gdk.Display.get_default()!;
    const context: UIContext = {application, display, preferences, config: () => DEFAULTS, saveCore() {},
        monitors: () => [display.get_monitor(0)!], runCommand: () => true, reload: () => true, quit() {}, invoke() {},
        registerCommand: () => () => {}, onMessage: () => () => {}, onMonitors: () => () => {}, onReload: () => () => {}};
    const assets = EditorAssets.create();
    const editor = new EditorWindow(context, assets, () => {});
    const started = GLib.get_monotonic_time();
    let ticks = 0;
    const heartbeat = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {ticks++; return GLib.SOURCE_CONTINUE;});
    try {
        editor.show();
        if (!await editor.openFile(path)) throw new Error('Editor could not open the test file');
        for (let i=0; i<300 * timeScale && !editor.surface?.ready; i++) {
            if (editor.surface?.error) throw new Error(editor.surface.error);
            await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {resolve(); return GLib.SOURCE_REMOVE;}));
        }
        if (!editor.surface?.ready) throw new Error('Monaco did not load');
        if (!ticks) throw new Error('GTK did not process events during Editor startup');
        print(`Editor ready in ${Math.round((GLib.get_monotonic_time() - started) / 1000)} ms; GTK heartbeat ${ticks}`);
        if (await editor.surface.evaluate('window.devOsEditor.getValue()') !== editor.document?.content) throw new Error('Monaco contents do not match the file');
        // A module worker must load its split dependencies and still report errors.
        await editor.surface.evaluate('window.devOsEditor.replace("const answer: number = \\\"wrong\\\";\\n")');
        let diagnostics = '';
        for (let i=0; i<200 * timeScale; i++) {
            diagnostics = await editor.surface.evaluate('JSON.stringify(window.devOsEditor.diagnostics())');
            if (diagnostics.includes('not assignable')) break;
            await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {resolve(); return GLib.SOURCE_REMOVE;}));
        }
        if (!diagnostics.includes('not assignable')) throw new Error(`TypeScript module worker did not validate the file: ${diagnostics}`);
        await editor.surface.evaluate('window.devOsEditor.replace("const answer = 43;\\n")');
        for (let i=0;i<40 && !editor.document?.dirty;i++) await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 25, () => {resolve(); return GLib.SOURCE_REMOVE;}));
        if (!editor.document?.dirty || !await editor.document.save()) throw new Error('Editor did not save the edit');
        const value = new TextDecoder().decode(GLib.file_get_contents(path)[1]);
        if (value !== 'const answer = 43;\n') throw new Error('Saved contents are incorrect');
        print('PASS: native Monaco loads async assets, edits and saves a real file');
    } finally { GLib.source_remove(heartbeat); editor.destroy(); (await assets).dispose(); preferences.dispose(); }
}
const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 45 * timeScale, () => {expired = true;failed = new Error('Editor test timed out');loop.quit();return GLib.SOURCE_REMOVE;});
void run().catch(error => {failed=error;}).finally(() => loop.quit());
loop.run(); if (!expired) GLib.source_remove(timeout);
if (failed) throw failed;
