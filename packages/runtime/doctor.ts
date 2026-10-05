import System from 'system';
import {
    Gio, GLib
} from '@dev-os/core';
// Bootstrap diagnostics must work before core's native dependencies are available.
const ROOT = GLib.getenv('DEV_OS_ROOT') ?? Gio.File.new_for_uri(import.meta.url).get_parent()!.get_parent()!.get_path()!;

export async function doctor(): Promise<Record<string, boolean>> {
    const checks = {
        linux: GLib.file_test('/proc/self', GLib.FileTest.IS_DIR),
        gjs_1_74: System.version >= 17400,
        glib_2_80: GLib.MAJOR_VERSION > 2 || (GLib.MAJOR_VERSION === 2 && GLib.MINOR_VERSION >= 80),
        labwc: GLib.find_program_in_path('labwc') !== null,
        dbus_run_session: GLib.find_program_in_path('dbus-run-session') !== null,
        setsid: GLib.find_program_in_path('setsid') !== null,
        window_tracker: [`${ROOT}/build/native/dev-os-window-tracker`, `${ROOT}/native/dev-os-window-tracker`]
            .some(path => GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE)) || GLib.find_program_in_path('dev-os-window-tracker') !== null,
        gtk3_and_layer_shell: false, cairo: false, config: false, editor_webkit: false,
        editor_assets: ['index.html', 'app.js', 'app.css', 'editor.worker.js', 'ts.worker.js', 'json.worker.js', 'css.worker.js', 'html.worker.js']
            .every(name => GLib.file_test(`${ROOT}/dist/editor/${name}`, GLib.FileTest.IS_REGULAR)),
        react_bundle: ['main', 'supervisor', 'react-gtk', 'panel-view', 'launcher-view', 'background-view'].every(name =>
            GLib.file_test(`${ROOT}/dist/${name}.js`, GLib.FileTest.IS_REGULAR)),
    };
    if (!checks.react_bundle) printerr('React bundle missing: run npm ci and npm run build in the source tree.');
    if (!checks.window_tracker) printerr('Window tracker missing: run sh tools/setup/bootstrap-window-tracker.sh in the source tree.');
    try {
        const {default: Gtk} = await import('gi://Gtk?version=3.0');
        const {default: Layer} = await import('gi://GtkLayerShell?version=0.1');
        checks.gtk3_and_layer_shell = Gtk.get_major_version() === 3 &&
            (Layer.get_major_version() > 0 || Layer.get_minor_version() >= 6);
    } catch (error) { printerr(`Dependencies: ${(error instanceof Error ? error.message : String(error))}`); }
    try { await import('cairo'); checks.cairo = true; }
    catch (error) { printerr(`Cairo: ${(error instanceof Error ? error.message : String(error))}`); }
    try { await import('gi://WebKit2?version=4.1'); await import('gi://Soup?version=3.0'); checks.editor_webkit = true; }
    catch (error) { printerr(`Editor: install gir1.2-webkit2-4.1 and gir1.2-soup-3.0. ${String(error)}`); }
    try { const {loadConfig} = await import('@dev-os/config'); loadConfig(); checks.config = true; }
    catch (error) { printerr((error instanceof Error ? error.message : String(error))); }
    return checks;
}
