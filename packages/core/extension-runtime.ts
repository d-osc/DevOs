import {GLib, type Gtk, type Gdk} from './native.js';
import type {Config, Command} from '../config/index.js';
import type {SettingsHost} from '../extensions/types.js';
import type {WindowControls} from '../services/windows.js';
import type {SettingsPages} from './settings-pages.js';
import type {ComponentType} from 'react';

export type Cleanup = () => void;
export type UICommand = (monitor?: Gdk.Monitor, directory?: string) => void;
export interface UIContext {
    application: Gtk.Application;
    display: Gdk.Display;
    preferences: SettingsHost;
    packageRoot?: string;
    windows?: WindowControls;
    settingsPages?: SettingsPages;
    registerSettingsPage?(id: string, page: ComponentType): Cleanup;
    config(): Config;
    saveCore(value: unknown): void;
    monitors(): Gdk.Monitor[];
    runCommand(command: Command, directory?: string): boolean;
    reload(): boolean;
    quit(): void;
    useInstalledVersion?(root: string): Promise<void>;
    invoke(command: string, monitor?: Gdk.Monitor): void;
    openEditor?(path: string): boolean;
    registerCommand(command: string, handler: UICommand): Cleanup;
    onMessage(handler: (message: string) => void): Cleanup;
    onMonitors(handler: () => void): Cleanup;
    onReload(handler: () => void): Cleanup;
}
export interface UIExtension {
    id: string;
    activate(context: UIContext): Cleanup;
}

// System UI packages have the same lifecycle contract. The base owns services,
// while each package owns its native windows, React roots and cleanup.
export class UIRuntime {
    private cleanups: Cleanup[] = [];
    start(definitions: UIExtension[], host: UIContext): void {
        if (this.cleanups.length) throw new Error('UI runtime already started');
        const ids = new Set<string>();
        const trace = GLib.getenv('DEV_OS_STARTUP_TRACE') === '1';
        try {
            for (const definition of definitions) {
                if (ids.has(definition.id)) throw new Error(`Duplicate UI extension ${definition.id}`);
                ids.add(definition.id);
                const owned: Cleanup[] = [];
                const track = (cleanup: Cleanup) => { owned.push(cleanup); return cleanup; };
                const context: UIContext = {...host,
                    registerSettingsPage: host.registerSettingsPage ? (id, page) => track(host.registerSettingsPage!(id, page)) : undefined,
                    registerCommand: (name, handler) => track(host.registerCommand(name, handler)),
                    onMessage: handler => track(host.onMessage(handler)),
                    onMonitors: handler => track(host.onMonitors(handler)),
                    onReload: handler => track(host.onReload(handler)),
                };
                const dispose = () => { for (const cleanup of owned.reverse()) this.safe(cleanup); };
                this.cleanups.push(dispose);
                const start = GLib.get_monotonic_time();
                if (trace) print(`Dev OS startup: ${definition.id}`);
                owned.push(definition.activate(context));
                if (trace) print(`Dev OS startup: ${definition.id} ready in ${((GLib.get_monotonic_time() - start) / 1000).toFixed(0)} ms`);
            }
        } catch (error) { this.stop(); throw error; }
    }
    stop(): void {
        for (const cleanup of this.cleanups.reverse()) this.safe(cleanup);
        this.cleanups = [];
    }
    private safe(cleanup: Cleanup): void {
        try { cleanup(); } catch (error) { printerr(`UI extension cleanup: ${String(error)}`); }
    }
}
