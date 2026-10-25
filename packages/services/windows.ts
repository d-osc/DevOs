import {
    Listeners, Gio, GLib
} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {desktopApps, findDesktopApp} from './apps.js';
import {snapCells, resizeSnap, fitSnapGroup} from './snap-geometry.js';
import {rankExternalApps} from './memory-policy.js';

export interface WindowGeometry {x: number; y: number; width: number; height: number; output: string; area: {x: number; y: number; width: number; height: number}; region: string; minWidth: number; minHeight: number;}
export interface DesktopWindow {maximized?: boolean; fullscreen?: boolean; geometry?: WindowGeometry;id: number; title: string; appId: string; active: boolean; minimized: boolean; desktop?: number; sticky?: boolean;}
export function gestureWindowTarget(windows: readonly DesktopWindow[], desktop: number | undefined, action: 'next' | 'previous' | 'restore', minimizedOrder: readonly number[] = []): DesktopWindow | undefined {
    const candidates = windows.filter(window => desktop === undefined || window.sticky || window.desktop === undefined || window.desktop === desktop).sort((a, b) => a.id - b.id);
    if (action === 'restore') {const minimized = candidates.filter(window => window.minimized); return [...minimizedOrder].reverse().map(id => minimized.find(window => window.id === id)).find(Boolean) ?? minimized[minimized.length - 1];}
    if (!candidates.length) return undefined;
    const active = candidates.findIndex(window => window.active);
    return candidates[(active < 0 ? action === 'next' ? 0 : candidates.length - 1 : active + (action === 'next' ? 1 : candidates.length - 1)) % candidates.length];
}
export interface DesktopWorkspace {id: number; name: string; active: boolean;}
export interface KeyboardLayout {index: number; name: string; active: boolean;}
export const snapLayouts = [
    {id: 'halves', name: 'Two columns', regions: ['half-left', 'half-right'], widths: [1, 1]},
    {id: 'wide-left', name: 'Wide left', regions: ['wide-left', 'third-right'], widths: [2, 1]},
    {id: 'wide-right', name: 'Wide right', regions: ['third-left', 'wide-right'], widths: [1, 2]},
    {id: 'thirds', name: 'Three columns', regions: ['third-left', 'third-center', 'third-right'], widths: [1, 1, 1]},
    {id: 'quarters', name: 'Four quarters', regions: ['quarter-top-left', 'quarter-top-right', 'quarter-bottom-left', 'quarter-bottom-right'], widths: [1, 1, 1, 1]},
] as const;
export interface SnapGroup {cuts?: readonly number[]; row?: number; id: number; layout: string; members: {id: number; region: string}[];}
export function validSnapMembers(layout: string, ids: readonly number[], windows: readonly DesktopWindow[]) {
    const preset = snapLayouts.find(item => item.id === layout);
    if (!preset || ids.length !== preset.regions.length || new Set(ids).size !== ids.length) return undefined;
    const selected = ids.map(id => windows.find(window => window.id === id));
    if (selected.some(window => !window || window.sticky) || selected.some(window => window!.desktop !== selected[0]!.desktop)) return undefined;
    return preset.regions.map((region, index) => ({id: ids[index], region: `devos-${region}`}));
}
export interface WindowControls {
    readonly canResizeSnap?: boolean;
    resizeSnapGroup?(id: number, axis: 'x' | 'y', index: number, position: number): void;
    readonly canSnap?: boolean;
    readonly snapGroups?: readonly SnapGroup[];
    arrange?(layout: string, ids: readonly number[]): void;
    restoreSnapGroup?(id: number): void;
    removeSnapGroup?(id: number): void;
    readonly state: readonly DesktopWindow[];
    subscribe(listener: () => void): () => void;
    activate(id: number): void;
    toggle(id: number): void;
    close?(id: number): void;
    readonly desktops?: readonly DesktopWorkspace[];
    readonly keyboardLayouts?: readonly KeyboardLayout[];
    setKeyboardLayout?(index: number): void;
    readonly canCreateDesktop?: boolean;
    readonly canRemoveDesktop?: boolean;
    removeDesktop?(id: number): void;
    createDesktop?(): void;
    switchDesktop?(id: number): void;
    moveToDesktop?(id: number, desktop: number): void;
}

// The base owns the Wayland connection; extensions consume snapshots and actions.
export class Windows implements WindowControls {
    canResizeSnap = false;
    resizeSnapGroup(id: number, axis: 'x' | 'y', index: number, position: number) {
        if (!this.canResizeSnap || this.disposed || !this.input) return;
        const group = this.snapGroups.find(group => group.id === id);
        if (!group) return;
        const next = resizeSnap(group, this.state, axis, index, position);
        if (!next) return;
        this.snapGroups = this.snapGroups.map(group => group.id === id ? next : group);
        this.sendSnapGeometry(next); this.publish();
    }
    private sendSnapGeometry(group: SnapGroup) {
        if (!this.canResizeSnap || !this.input || this.disposed) return;
        const expected = group.layout === 'quarters' ? 4 : group.layout === 'thirds' ? 3 : 2;
        if (group.members.length !== expected) return;
        this.queue = this.queue.filter(command => !command.startsWith('sash '));
        this.queue.push(`sash ${snapCells(group).map(cell => `${cell.id},${cell.x},${cell.y},${cell.width},${cell.height}`).join(' ')}\n`); this.write();
    }
    canSnap = false;
    snapGroups: readonly SnapGroup[] = [];
    private nextSnapGroup = 1;
    arrange(layout: string, ids: readonly number[]) {
        const members = validSnapMembers(layout, ids, this.state);
        if (!this.canSnap || !members || !this.input || this.disposed) return;
        const fresh: SnapGroup = {id: this.nextSnapGroup++, layout, members};
        const fitted = this.canResizeSnap ? fitSnapGroup(fresh, this.state) : fresh;
        this.snapGroups = [...this.snapGroups.filter(group => !group.members.some(member => ids.includes(member.id))), fitted];
        for (const member of members) {this.queue.push(`snap ${member.id} ${member.region}\n`); this.send('activate', member.id);}
        this.sendSnapGeometry(this.snapGroups[this.snapGroups.length - 1]);
        this.write(); this.publish();
    }
    restoreSnapGroup(id: number) {
        let group = this.snapGroups.find(group => group.id === id);
        if (!group || !this.canSnap || !this.input || this.disposed) return;
        if (this.canResizeSnap) {group = fitSnapGroup(group, this.state); const fitted = group; this.snapGroups = this.snapGroups.map(item => item.id === id ? fitted : item); this.publish();}
        const desktop = this.state.find(window => window.id === group!.members[0].id)?.desktop;
        if (desktop) this.switchDesktop(desktop);
        for (const member of group.members) {this.queue.push(`snap ${member.id} ${member.region}\n`); this.send('activate', member.id);}
        this.sendSnapGeometry(group); this.write();
    }
    removeSnapGroup(id: number) {this.snapGroups = this.snapGroups.filter(group => group.id !== id); this.publish();}
    state: readonly DesktopWindow[] = [];
    desktops: readonly DesktopWorkspace[] = [];
    keyboardLayouts: readonly KeyboardLayout[] = [];
    private keyboardDraft: KeyboardLayout[] = [];
    canCreateDesktop = false;
    canRemoveDesktop = false;
    private desktopCapabilityChanged = false;
    private desktopDraft: DesktopWorkspace[] = [];
    private entries = new Map<number, DesktopWindow>();
    private listeners = new Listeners();
    private cancel = new Gio.Cancellable();
    private process?: Gio.Subprocess;
    private input?: Gio.OutputStream;
    private output?: Gio.DataInputStream;
    private pending = 0;
    private disposed = false;
    private queue: string[] = [];
    private writing = false;
    private recentApps: string[] = [];
    private memoryTimer = 0;
    private memoryWriting = false;
    private minimizedOrder: number[] = [];
    constructor() {
        this.memoryTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {this.publishMemory(); return GLib.SOURCE_CONTINUE;});
        const helper = [`${ROOT}/build/native/dev-os-window-tracker`, `${ROOT}/native/dev-os-window-tracker`]
            .find(path => GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE)) ?? GLib.find_program_in_path('dev-os-window-tracker');
        if (!helper) { printerr('Dev OS: build the window tracker with tools/setup/bootstrap-window-tracker.sh'); return; }
        try {
            this.process = Gio.Subprocess.new([helper], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
            this.input = this.process.get_stdin_pipe()!;
            this.output = new Gio.DataInputStream({base_stream: this.process.get_stdout_pipe()!});
            this.read();
        } catch (error) { printerr(`Dev OS window tracker: ${String(error)}`); }
    }
    subscribe(listener: () => void) { return this.listeners.subscribe(listener); }
    private publish() {
        if (this.disposed || this.pending) return;
        this.pending = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.pending = 0;
            const next = [...this.entries.values()];
            this.minimizedOrder = this.minimizedOrder.filter(id => next.some(window => window.id === id && window.minimized));
            for (const window of next) if (window.minimized && !this.state.find(previous => previous.id === window.id)?.minimized) this.minimizedOrder.push(window.id);
            this.state = next;
            this.snapGroups = this.snapGroups.map(group => ({...group, members: group.members.filter(member => next.some(window => window.id === member.id))}))
                .filter(group => group.members.length >= 2 && group.members.every(member => next.find(window => window.id === member.id)?.desktop === next.find(window => window.id === group.members[0].id)?.desktop));
            this.publishMemory();
            this.listeners.emit();
            return GLib.SOURCE_REMOVE;
        });
    }
    private publishMemory() {
        const apps = desktopApps();
        const key = (window: DesktopWindow) => findDesktopApp(apps, window.appId)?.get_id()?.toLowerCase();
        const open = new Set(this.state.map(key).filter((value): value is string => !!value));
        const active = this.state.find(window => window.active);
        const focused = active && key(active);
        this.recentApps = rankExternalApps(this.recentApps, [...open], focused || undefined);
        if (this.memoryWriting || this.disposed) return;
        const runtime = GLib.get_user_runtime_dir();
        if (!runtime) return;
        this.memoryWriting = true;
        Gio.File.new_for_path(`${runtime}/devos-memory-policy.json`).replace_contents_async(
            new TextEncoder().encode(JSON.stringify(this.recentApps.slice(0, 128))), null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, this.cancel, (file, result) => {
                this.memoryWriting = false;
                try {(file as Gio.File).replace_contents_finish(result);} catch { /* Optional memory service. */ }
            });
    }
    private read() {
        this.output!.read_line_async(GLib.PRIORITY_DEFAULT, this.cancel, (_source, result) => {
            if (this.disposed) return;
            try {
                const [line] = this.output!.read_line_finish_utf8(result);
                if (line === null) { this.entries.clear(); this.snapGroups = []; this.canSnap = false; this.canResizeSnap = false; this.desktops = []; this.keyboardLayouts = []; this.canCreateDesktop = false; this.canRemoveDesktop = false; this.publish(); this.input = undefined; return; }
                const event = JSON.parse(line) as Record<string, unknown>;
                if (event.type === 'snap-capability') {this.canSnap = event.supported === true; this.canResizeSnap = event.canResize === true; this.publish();}
                else if (event.type === 'geometry' && typeof event.id === 'number' && this.entries.has(event.id) && event.geometry && typeof event.geometry === 'object') {
                    const geometry = event.geometry as WindowGeometry;
                    if (geometry.area && typeof geometry.output === 'string' && typeof geometry.region === 'string' && [geometry.x, geometry.y, geometry.width, geometry.height, geometry.minWidth, geometry.minHeight, ...Object.values(geometry.area)].every(value => typeof value === 'number' && Number.isFinite(value))) {
                        const previous = this.entries.get(event.id)!;
                        if (JSON.stringify(previous.geometry) !== JSON.stringify(geometry)) {this.entries.set(event.id, {...previous, geometry}); this.publish();}
                    }
                }
                else if (event.type === 'window' && typeof event.id === 'number' && Number.isSafeInteger(event.id) && event.id > 0 &&
                    typeof event.title === 'string' && typeof event.appId === 'string' && typeof event.active === 'boolean' && typeof event.minimized === 'boolean') {
                    const previous = this.entries.get(event.id);
                    const next = {maximized: event.maximized === true, fullscreen: event.fullscreen === true, geometry: previous?.geometry, id: event.id, title: event.title, appId: event.appId, active: event.active, minimized: event.minimized,
                        desktop: typeof event.desktop === 'number' && event.desktop > 0 ? event.desktop : undefined, sticky: event.sticky === true};
                    if (JSON.stringify(previous) !== JSON.stringify(next)) {
                        this.entries.set(event.id, next); this.publish();
                        if ((previous?.maximized || previous?.fullscreen) && !next.maximized && !next.fullscreen) {
                            const group = this.snapGroups.find(group => group.members.some(member => member.id === next.id));
                            if (group) this.sendSnapGeometry(group);
                        }
                    }
                } else if (event.type === 'closed' && typeof event.id === 'number') { this.entries.delete(event.id); this.publish(); }
                else if (event.type === 'desktop-begin') {this.desktopDraft = []; this.keyboardDraft = []; this.desktopCapabilityChanged = this.canCreateDesktop !== (event.canCreate === true) || this.canRemoveDesktop !== (event.canRemove === true); this.canCreateDesktop = event.canCreate === true; this.canRemoveDesktop = event.canRemove === true;}
                else if (event.type === 'desktop' && typeof event.id === 'number' && Number.isInteger(event.id) && event.id > 0 && typeof event.name === 'string' && typeof event.active === 'boolean')
                    this.desktopDraft.push({id: event.id, name: event.name, active: event.active});
                else if (event.type === 'keyboard-layout' && typeof event.index === 'number' && Number.isInteger(event.index) && event.index >= 0 && typeof event.name === 'string' && typeof event.active === 'boolean')
                    this.keyboardDraft.push({index: event.index, name: event.name, active: event.active});
                else if (event.type === 'desktop-done' && (this.desktopCapabilityChanged || JSON.stringify(this.desktops) !== JSON.stringify(this.desktopDraft) || JSON.stringify(this.keyboardLayouts) !== JSON.stringify(this.keyboardDraft))) {this.desktops = this.desktopDraft; this.keyboardLayouts = this.keyboardDraft; this.publish();}
                else if (event.type === 'ready') print('Dev OS window tracker ready');
                this.read();
            } catch (error) {
                if (!this.disposed) { this.entries.clear(); this.publish(); this.input = undefined; printerr(`Dev OS window tracker: ${String(error)}`); }
            }
        });
    }
    private send(action: 'activate' | 'minimize' | 'close', id: number) {
        if (this.disposed || !this.input || !this.entries.has(id)) return;
        this.queue.push(`${action} ${id}\n`); this.write();
    }
    private write() {
        if (this.disposed || this.writing || !this.input || !this.queue.length) return;
        this.writing = true;
        this.input.write_all_async(new TextEncoder().encode(this.queue.shift()!), GLib.PRIORITY_DEFAULT, this.cancel, (stream, result) => {
            this.writing = false;
            if (this.disposed) return;
            try { (stream as Gio.OutputStream).write_all_finish(result); this.write(); }
            catch (error) { this.queue = []; printerr(`Dev OS window action: ${String(error)}`); }
        });
    }
    activate(id: number) { this.send('activate', id); }
    gesture(action: 'next' | 'previous' | 'restore') {const target = gestureWindowTarget(this.state, this.desktops.find(desktop => desktop.active)?.id, action, this.minimizedOrder); if (target) this.activate(target.id);}
    setKeyboardLayout(index: number) {if (this.disposed || !this.input || !this.keyboardLayouts.some(layout => layout.index === index)) return; this.queue.push(`layout ${index}\n`); this.write();}
    close(id: number) {this.send('close', id);}
    switchDesktop(id: number) {if (this.disposed || !this.input || !this.desktops.some(desktop => desktop.id === id)) return; this.queue.push(`desktop ${id}\n`); this.write();}
    createDesktop() {if (this.disposed || !this.input || !this.canCreateDesktop) return; this.queue.push('create-desktop\n'); this.write();}
    removeDesktop(id: number) {if (this.disposed || !this.input || !this.canRemoveDesktop || this.desktops.length <= 1 || !this.desktops.some(desktop => desktop.id === id)) return; this.queue.push(`remove-desktop ${id}\n`); this.write();}
    moveToDesktop(id: number, desktop: number) {if (this.disposed || !this.input || !this.entries.has(id) || !this.desktops.some(item => item.id === desktop)) return; this.queue.push(`move ${id} ${desktop}\n`); this.write();}
    toggle(id: number) {
        const window = this.entries.get(id);
        if (window) this.send(window.active && !window.minimized ? 'minimize' : 'activate', id);
    }
    destroy() {
        if (this.disposed) return; this.disposed = true;
        if (this.memoryTimer) GLib.source_remove(this.memoryTimer);
        this.cancel.cancel(); if (this.pending) GLib.source_remove(this.pending);
        this.canResizeSnap = false; this.canSnap = false; this.snapGroups = [];
        this.process?.force_exit(); this.listeners.clear(); this.entries.clear(); this.queue = []; this.state = []; this.desktops = []; this.desktopDraft = []; this.keyboardLayouts = []; this.keyboardDraft = []; this.canCreateDesktop = false; this.canRemoveDesktop = false;
    }
}

const builtinApps = [
    {group: 'terminal', title: 'Terminal', icon: 'dev-os-terminal-symbolic', id: 'dev-os-terminal'},
    {group: 'files', title: 'Files', icon: 'dev-os-files-symbolic', id: 'dev-os-files'},
    {group: 'settings', title: 'Settings', icon: 'dev-os-settings-symbolic', id: 'dev-os-settings'},
    {group: 'dev-os-editor', title: 'Editor', icon: 'dev-os-editor-symbolic', id: 'dev-os-editor'},
    {group: 'dev-os-browser', title: 'Browser', icon: 'dev-os-browser-symbolic', id: 'dev-os-browser'},
    {group: 'dev-os-camera', title: 'Camera', icon: 'dev-os-camera-symbolic', id: 'dev-os-camera'},
    {group: 'dev-os-microphone', title: 'Microphone', icon: 'dev-os-microphone-symbolic', id: 'dev-os-microphone'},
    {group: 'dev-os-task-manager', title: 'Task Manager', icon: 'dev-os-task-manager-symbolic', id: 'dev-os-task-manager'},
    {group: 'dev-os-disk-manager', title: 'Disk Manager', icon: 'dev-os-disk-manager-symbolic', id: 'dev-os-disk-manager'},
    {group: 'dev-os-app-store', title: 'App Store', icon: 'dev-os-app-store-symbolic', id: 'dev-os-app-store'},
    {group: 'dev-os-package-install', title: 'Install Package', icon: 'dev-os-app-store-symbolic', id: 'dev-os-package-install'},
    {group: 'dev-os-installer', title: 'Install Dev OS', icon: 'dev-os-installer-symbolic', id: 'dev-os-installer'},
    {group: 'dev-os-browser-inspector', title: 'Developer Tools', icon: 'dev-os-editor-symbolic', id: 'dev-os-browser-inspector'},
] as const;

export function builtinWindowApp(group: string) {return builtinApps.find(app => app.group === group);}

export function windowGroup(window: DesktopWindow) {
    // Built-in app windows share the shell's Wayland application ID. Identify
    // their app-specific title prefix before looking up external desktop files.
    if (/^(?:gjs|org\.devos\.Shell(?:\..*)?)$/i.test(window.appId)) {
        const title = window.title.replace(/^Dev OS /, '');
        const app = builtinApps.find(app => title === app.title || title.startsWith(`${app.title} ·`));
        if (app) return app.group;
    }
    const ownId = window.appId.replace(/\.desktop$/i, '').toLowerCase();
    const builtin = builtinApps.find(app => ownId === app.id);
    if (builtin) return builtin.group;
    if (/^(?:Dev OS )?Terminal(?:$| ·)/.test(window.title) || /^(foot|org\.gnome\.Terminal|org\.wezfurlong\.wezterm)$/i.test(window.appId)) return 'terminal';
    if (/^Dev OS Files(?:$| ·)/.test(window.title) || /^(thunar|org\.gnome\.Nautilus)$/i.test(window.appId)) return 'files';
    if (/^Dev OS Settings(?:$| ·)/.test(window.title)) return 'settings';
    if (/^Dev OS Editor(?:$| ·)/.test(window.title)) return 'dev-os-editor';
    return window.appId || `window-${window.id}`;
}
