/** Compatibility transport for remaining JS Panel/Settings consumers. All parsing is DevLang. */
import {Gio, GLib} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
export type Splendid = 'normal' | 'vivid' | 'manual' | 'eyecare';
export interface CareSettings {
    splendid: Splendid; temperature: number; eyeCare: number; gamut: 'native'; dimming: number;
    pixelRefresh: boolean; autoHidePanel: boolean; panelTransparency: boolean; targetMode: boolean; edgeBrightness: number;
}
function project(request: object): CareSettings {
    const child = Gio.Subprocess.new([GLib.getenv('DEVLANG_RUN') || 'd', `${ROOT}/src/services/display-care-compat.dev`],
        Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, out, err] = child.communicate_utf8(`${JSON.stringify(request)}\n`, null);
    const value = JSON.parse(out || '{}') as {settings?: CareSettings; error?: string};
    if (!child.get_successful() || !value.settings) throw new Error(value.error || err || 'Display care data service failed.');
    return value.settings;
}
/** Initial UI DTO only. Effective defaults and every saved value come from DevLang. */
export const defaultCare: CareSettings = {splendid: 'normal', temperature: 0, eyeCare: 3, gamut: 'native', dimming: 100,
    pixelRefresh: true, autoHidePanel: false, panelTransparency: true, targetMode: false, edgeBrightness: 0};
export const parseCare = (text: string): CareSettings => project({op: 'parse', text});
export const carePath = () => `${GLib.get_user_config_dir()}/devos/display-care.json`;
export const pixelRefreshPath = () => `${GLib.getenv('XDG_RUNTIME_DIR') || '/tmp'}/devos-pixel-refresh`;
export const readCare = (path = carePath()): CareSettings => project({op: 'read', path});
/** Watch raw file changes; no setting interpretation occurs in this adapter. */
export function watchFile(path: string, listener: () => void): () => void {
    const directory = GLib.path_get_dirname(path), name = GLib.path_get_basename(path);
    GLib.mkdir_with_parents(directory, 0o700);
    let monitor: Gio.FileMonitor;
    try {monitor = Gio.File.new_for_path(directory).monitor_directory(Gio.FileMonitorFlags.NONE, null);} catch {return () => {};}
    const id = monitor.connect('changed', (_monitor, file) => {if (file.get_basename() === name) listener();});
    return () => {monitor.disconnect(id); monitor.cancel();};
}
export const watchCare = (listener: (settings: CareSettings) => void) => watchFile(carePath(), () => listener(readCare()));
