import {Gio} from '@dev-os/core';
import {desktopApps} from '@dev-os/services/apps';
import type {DesktopWindow, WindowControls} from '@dev-os/services/windows';
import {NativeModel} from './native-model.js';
export interface TaskbarRow {group: string; id: string; windows: DesktopWindow[]; title: string; icon: string; gicon: string | null; launch: 'terminal' | 'files' | null; pinned: boolean; running: boolean; active: boolean; minimized: boolean; tooltip: string;}
export interface TaskbarControls {state: TaskbarRow[]; subscribe(changed: () => void): () => void;}
function catalog() {return desktopApps().map(app => ({id: app.get_id(), title: app.get_display_name(), wmclass: (app as Gio.AppInfo & {get_startup_wm_class?: () => string | null}).get_startup_wm_class?.() ?? null, icon: app.get_icon()?.to_string() ?? null}));}
const shared = new Map<WindowControls | undefined, Map<boolean, Shared>>();
class Shared {
    state: TaskbarRow[] = [];
    refs = 0;
    listeners = new Set<() => void>();
    private model: NativeModel;
    private apps = catalog();
    private appMonitor = Gio.AppInfoMonitor.get();
    private appSignal: number;
    private stopWindows?: () => void;
    constructor(private windows: WindowControls | undefined, private pinned: boolean) {
        this.model = new NativeModel('src/services/panel-taskbar.dev', frame => {if (frame.rows) {this.state = frame.rows as TaskbarRow[]; for (const listener of this.listeners) listener();}});
        this.stopWindows = windows?.subscribe(() => this.submit());
        this.appSignal = this.appMonitor.connect('changed', () => {this.apps = catalog(); this.submit();});
        this.submit();
    }
    private submit() {this.model.submit({windows: this.windows?.state ?? [], catalog: this.apps, showPinned: this.pinned});}
    destroy() {this.stopWindows?.(); this.appMonitor.disconnect(this.appSignal); this.model.destroy(); this.listeners.clear();}
}
/** Shared read-only projection. GIO objects are reduced to facts, never interpreted here. */
export class PanelTaskbar implements TaskbarControls {
    private source: Shared;
    private disposed = false;
    constructor(private windows: WindowControls | undefined, private pinned: boolean) {
        let variants = shared.get(windows); if (!variants) {variants = new Map(); shared.set(windows, variants);}
        let source = variants.get(pinned); if (!source) {source = new Shared(windows, pinned); variants.set(pinned, source);}
        this.source = source; source.refs++;
    }
    get state() {return this.source.state;}
    subscribe(changed: () => void) {this.source.listeners.add(changed); return () => {this.source.listeners.delete(changed);};}
    destroy() {if (this.disposed) return; this.disposed = true; if (--this.source.refs === 0) {this.source.destroy(); const variants = shared.get(this.windows)!; variants.delete(this.pinned); if (!variants.size) shared.delete(this.windows);}}
}
