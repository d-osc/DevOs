import {
    Gdk, Gio, GLib, Gtk, GtkLayerShell,
    GObject, UIRuntime, type UIContext, type UICommand, type UIExtension
} from '@dev-os/core';
import {addUnixSignal} from '@dev-os/services/signals';
import type {Config, Command} from '@dev-os/config';
import {loadConfig, saveConfig, expandHome} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions';
import {Windows} from '@dev-os/services/windows';
import {SettingsPages} from '@dev-os/core';
import {requestSessionVersion} from '@dev-os/runtime/session-version';
import {shellApplicationId, controlInterface} from '@dev-os/runtime/remote';
import {appForCommand, processApplicationId, sendCommand, type BaseApp} from '@dev-os/runtime/processes';
import {nativeLauncher, nativeTaskView, nativeSnap} from '@dev-os/runtime/native-launcher';
import {AppProcesses} from './app-processes.js';

/** Report a boot milestone to devos-splash without waiting for it or failing when it is not installed. */
function splashStep(step: string): void {
    try { GLib.spawn_command_line_async(`devos-splash --step ${step}`); } catch { /* no boot animation here */ }
}

interface ShellOptions {appConfig?: {get(): Config; save(value: unknown): void | Promise<void>}; config: Config; uiDefinitions: UIExtension[]; userDefinitions?: UIExtension[]; preferences?: ExtensionManager; app?: BaseApp; initializeSettings?(context: UIContext): () => void;}

export const DesktopShell = GObject.registerClass(class ShellApplication extends Gtk.Application {
    // GObject calls _init inside super(). Emitting JS fields afterwards would
    // overwrite that state, so these declarations must stay type-only.
    declare config: Config;
    declare ui: UIRuntime;
    declare commands: Map<string, UICommand>;
    declare messages: Set<(message: string) => void>;
    declare monitorListeners: Set<() => void>;
    declare reloadListeners: Set<() => void>;
    declare displaySignals: number[];
    declare display: Gdk.Display;
    declare startupError: string | null;
    declare messageSource: number;
    declare signalSources: number[];
    declare quitting: boolean;
    declare extensions: ExtensionManager;
    declare uiDefinitions: UIExtension[];
    declare userDefinitions: UIExtension[];
    declare userRuntimes: UIRuntime[];
    declare windows: Windows | undefined;
    declare settingsPages: SettingsPages;
    declare control: Gio.DBusExportedObject | undefined;
    declare app: BaseApp | undefined;
    declare appConfig: ShellOptions['appConfig'];
    declare processes: AppProcesses;
    declare initializeSettings: ShellOptions['initializeSettings'];
    declare settingsCleanup: (() => void) | undefined;
    declare stopWatching: (() => void) | undefined;
    constructor(options: ShellOptions) {
        super(options as unknown as Gtk.Application.ConstructorProps);
    }

    _init({config, uiDefinitions, userDefinitions = [], preferences, app, appConfig, initializeSettings}: ShellOptions) {
        super._init({application_id: app ? processApplicationId(app) : shellApplicationId(),
            flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE});
        this.config = config;
        this.app = app; this.initializeSettings = initializeSettings;
        this.processes = new AppProcesses(message => this.showMessage(message));
        this.uiDefinitions = uiDefinitions;
        this.userDefinitions = userDefinitions; this.userRuntimes = [];
        this.ui = new UIRuntime();
        this.commands = new Map();
        this.messages = new Set();
        this.monitorListeners = new Set();
        this.reloadListeners = new Set();
        this.displaySignals = [];

        this.startupError = null;
        this.messageSource = 0;
        this.signalSources = [];
        this.quitting = false;
        this.appConfig = appConfig;
        this.extensions = preferences ?? new ExtensionManager();
        this.settingsPages = new SettingsPages();
        this.control = undefined;
    }

    vfunc_startup() {
        super.vfunc_startup();
        const display = Gdk.Display.get_default();
        if (display) this.display = display;
        if (!this.display || (!this.app && !GtkLayerShell.is_supported())) {
            this.startupError = 'This display does not support Wayland layer-shell. ' +
                'Run bin/dev-os-session --nested to start a labwc compositor.';
            return;
        }
        this.hold();
        if (!this.app || this.app === 'settings') this.windows = new Windows({memoryPolicy: !this.app});
        try { this.ui.start(this.uiDefinitions, this.uiContext()); }
        catch (error) { this.windows?.destroy(); this.startupError = `UI activation failed: ${String(error)}`; this.release(); return; }
        this.settingsCleanup = this.initializeSettings?.(this.uiContext());
        if (!this.app) {
            const switchUser = new Gio.SimpleAction({name: 'devos-switch-user', parameter_type: new GLib.VariantType('s')});
            switchUser.connect('activate', (_action, username) => this.processes.launch('settings', 'session.switch-user', username?.get_string()[0] || undefined));
            this.add_action(switchUser);
        }
        this.stopWatching = this.extensions.watch(() => {
            try {this.config = this.appConfig?.get() ?? loadConfig(); for (const listener of this.reloadListeners) listener();}
            catch (error) {this.showMessage(String(error));}
        });
        for (const definition of this.userDefinitions) {
            const runtime = new UIRuntime();
            try { runtime.start([definition], this.uiContext()); this.userRuntimes.push(runtime); }
            catch (error) { this.extensions.diagnostics.push(`${definition.id}: ${String(error)}`); printerr(`User extension activation failed: ${definition.id}: ${String(error)}`); }
        }
        for (const event of ['monitor-added', 'monitor-removed'] as const) {
            this.displaySignals.push(this.display.connect(event, () => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE,
                () => this.reconcileMonitors())));
        }
        for (const signal of [15, 2]) {
            this.signalSources.push(addUnixSignal(GLib.PRIORITY_DEFAULT, signal, () => {
                this.quit(); return GLib.SOURCE_CONTINUE;
            }));
        }
        this.control = Gio.DBusExportedObject.wrapJSObject(controlInterface, {
            Execute: (args: string[], cwd: string): [number, string] => {
                try { return [this.handleArguments(args, cwd), '']; }
                catch (error) { return [1, error instanceof Error ? error.message : String(error)]; }
            },
        });
        this.control.export(this.get_dbus_connection()!, `${this.get_dbus_object_path()!}/control`);
        if (this.app) {print(`Dev OS app ready: ${this.app} [process ${this.get_application_id()}]`); return;}
        print(`Dev OS shell ready on ${GLib.getenv('WAYLAND_DISPLAY')} (${this.display.get_n_monitors()} output(s)) [GJS]`);
        // Boot animation milestones (fire-and-forget; absent outside the Dev OS image): the shell runs, then its first frames are on screen.
        splashStep('shell');
        GLib.idle_add(GLib.PRIORITY_LOW, () => { GLib.timeout_add(GLib.PRIORITY_LOW, 700, () => { splashStep('ready'); return GLib.SOURCE_REMOVE; }); return GLib.SOURCE_REMOVE; });
    }

    vfunc_activate() {}

    vfunc_command_line(commandLine: Gio.ApplicationCommandLine): number {
        let status;
        try { status = this.handleCommandLine(commandLine); }
        catch (error) { printerr(`Dev OS command: ${(error instanceof Error ? error.message : String(error))}`); status = 1; }
        commandLine.set_exit_status(status);
        // GJS uses tracing GC. Complete the remote call explicitly instead of
        // making its caller wait for the command-line wrapper to be collected.
        commandLine.done();
        return status;
    }

    handleCommandLine(commandLine: Gio.ApplicationCommandLine): number {
        return this.handleArguments(commandLine.get_arguments().slice(1), commandLine.get_cwd() ?? GLib.get_current_dir());
    }

    handleArguments(args: string[], cwd: string): number {
        if (this.startupError) { printerr(this.startupError); return 1; }
        const command = args[0] ?? 'shell';
        if (this.app) {
            if (appForCommand(command) !== this.app) throw new Error(`Command ${command} does not belong to ${this.app}`);
            const local = command === 'terminal' ? 'terminal.native' : command;
            if (command === 'session.switch-user') {this.commands.get(command)?.(undefined, args[1]); return 0;}
            if (args.length > 1) for (const path of args.slice(1)) this.invokeWithPath(local, GLib.canonicalize_filename(path.startsWith('file:') ? Gio.File.new_for_uri(path).get_path()! : path, cwd));
            else this.invoke(local);
            return 0;
        }
        if (appForCommand(command) && !['terminal', 'files', 'editor', 'package-install'].includes(command)) {this.invoke(command); return 0;}
        switch (command) {
        case 'session.restart': case 'session.quit': this.quit(); break;
        case 'services.message': this.showMessage(args[1] ?? ''); break;
        case 'screenshot': case 'screenshot-app': this.invoke(command); break;
        case 'window-next': this.windows?.gesture('next'); break;
        case 'window-previous': this.windows?.gesture('previous'); break;
        case 'window-restore': this.windows?.gesture('restore'); break;
        case 'browser': case 'camera': case 'microphone': case 'app-store': case 'disk-manager': case 'installer': case 'task-manager': case 'settings': this.invoke(command); break;
        // The launcher, Task View and Snap are native DevLang windows (dist/native/{launcher,task-view,snap-panel}); opening one closes the others.
        case 'launcher': this.hideOverlays(['launcher']); nativeLauncher(['launcher'], true, message => this.showMessage(message)); break;
        case 'logout': this.hideOverlays(['launcher']); nativeLauncher(['launcher', 'logout'], true, message => this.showMessage(message)); break;
        case 'task-view': this.hideOverlays(['task-view']); nativeTaskView(['task-view'], true, message => this.showMessage(message)); break;
        case 'task-view-show': this.hideOverlays(['task-view']); nativeTaskView(['task-view', 'show'], true, message => this.showMessage(message)); break;
        case 'task-view-hide': nativeTaskView(['task-view', 'hide'], false, message => this.showMessage(message)); break;
        case 'snap-layouts': this.hideOverlays(['snap']); nativeSnap(['snap-layouts'], true, message => this.showMessage(message)); break;
        case 'overlays-hide': this.hideOverlays([]); break;
        case 'wifi': this.invoke('settings.wifi'); break;
        case 'network': this.invoke('settings.network'); break;
        case 'language': this.invoke('settings.language'); break;
        case 'time': this.invoke('settings.time'); break;
        case 'accounts': this.invoke('settings.accounts'); break;
        case 'switch-user': this.processes.launch('settings', 'session.switch-user', args[1]); break;
        case 'vpn': case 'hotspot': case 'airplane': case 'proxy': case 'advanced': case 'mouse': case 'keyboard': case 'bluetooth-add': case 'printers': case 'touchpad': case 'system': case 'display': case 'sound': case 'power': case 'storage': case 'about': this.invoke(`settings.${command}`); break;
        case 'reload': return this.reloadConfig() ? 0 : 1;
        case 'terminal': case 'files': case 'lock': return this.runCommand(command) ? 0 : 1;
        case 'package-install': {
            const files = args.slice(1);
            if (!files.length) { this.invoke('package-install'); break; }
            for (const file of files) {
                const local = file.startsWith('file:') ? Gio.File.new_for_uri(file).get_path() : file;
                if (!local) throw new Error('Package install supports local files.');
                this.invokeWithPath('package-install', GLib.canonicalize_filename(local, cwd));
            }
            break;
        }
        case 'editor': {
            const open: UICommand = (_monitor, path) => this.processes.launch('editor', 'editor', path);
            const paths = args.slice(1);
            if (!paths.length) open();
            for (const path of paths) {
                const local = path.startsWith('file:') ? Gio.File.new_for_uri(path).get_path() : path;
                if (!local) throw new Error('Editor supports local files.');
                open(undefined, GLib.canonicalize_filename(local, cwd));
            }
            break;
        }
        }
        return 0;
    }

    invokeWithPath(command: string, path: string): void {
        if (!this.app) {const app = appForCommand(command); if (app) {this.processes.launch(app, command, path); return;}}
        const handler = this.commands.get(command);
        if (!handler) throw new Error(`No extension handles command ${command}`);
        handler(undefined, path);
    }

    invoke(command: string, monitor?: Gdk.Monitor): void {
        if (!this.app) {const app = appForCommand(command); if (app) {this.processes.launch(app, command); return;}}
        const handler = this.commands.get(command);
        if (!handler) {
            if (this.app && appForCommand(command) !== this.app) {void sendCommand(shellApplicationId(), [command]).catch(error => this.showMessage(String(error))); return;}
            throw new Error(`No extension handles command ${command}`);
        }
        handler(monitor);
    }

    uiContext(): UIContext {
        const subscribe = <T>(listeners: Set<T>, handler: T) => {
            listeners.add(handler); return () => { listeners.delete(handler); };
        };
        return {
            application: this, display: this.display, preferences: this.extensions,
            windows: this.windows,
            settingsPages: this.settingsPages,
            registerSettingsPage: (id, page) => this.settingsPages.register(id, page),
            config: () => this.config,
            saveCore: value => {if (this.appConfig) return this.appConfig.save(value); saveConfig(value);},
            monitors: () => Array.from({length: this.display.get_n_monitors()}, (_, index) => this.display.get_monitor(index)!),
            runCommand: (command, directory) => this.runCommand(command, directory), reload: () => {
                if (this.app) void sendCommand(shellApplicationId(), ['reload']).catch(error => this.showMessage(String(error)));
                return this.reloadConfig();
            }, quit: () => {
                if (this.app) void sendCommand(shellApplicationId(), ['session.quit']).catch(error => this.showMessage(String(error)));
                else this.quit();
            },
            useInstalledVersion: async root => {
                await requestSessionVersion(root);
                if (this.app) {await sendCommand(shellApplicationId(), ['session.restart']); return;}
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { this.quit(); return GLib.SOURCE_REMOVE; });
            },
            invoke: (command, monitor) => this.invoke(command, monitor),
            openEditor: path => {
                if (!this.commands.has('editor')) {this.processes.launch('editor', 'editor', path); return true;}
                const handler = this.commands.get('editor');
                if (!handler) return false;
                handler(undefined, path); return true;
            },
            openPackage: path => {
                if (!this.commands.has('package-install')) {this.processes.launch('appstore', 'package-install', path); return true;}
                if (!this.commands.has('package-install')) return false;
                this.invokeWithPath('package-install', path); return true;
            },
            registerCommand: (command, handler) => {
                if (this.commands.has(command)) throw new Error(`Duplicate UI command ${command}`);
                this.commands.set(command, handler);
                return () => { this.commands.delete(command); };
            },
            onMessage: handler => subscribe(this.messages, handler),
            onMonitors: handler => subscribe(this.monitorListeners, handler),
            onReload: handler => subscribe(this.reloadListeners, handler),
        };
    }

    reconcileMonitors() {
        if (!this.quitting) for (const listener of this.monitorListeners) listener();
        return GLib.SOURCE_REMOVE;
    }

    reloadConfig() {
        let config;
        try { config = this.appConfig?.get() ?? loadConfig(); }
        catch (error) { this.showMessage((error instanceof Error ? error.message : String(error))); return false; }
        this.config = config; this.extensions.reload();
        for (const listener of this.reloadListeners) listener();
        this.showMessage('Configuration reloaded');
        return true;
    }

    runCommand(command: Command, directory?: string): boolean {
        if (command === 'lock') {
            const args = this.config.lock.map(expandHome), executable = args.length === 1 && args[0] === 'dev-os-lock' ? 'swaylock' : args[0];
            if (!GLib.find_program_in_path(executable)) {this.showMessage(`Install ${executable} or change 'lock' in config.json.`); return false;}
            this.processes.launch('services', 'lock'); return true;
        }
        if (command === 'files') {this.processes.launch('files', 'files'); return true;}
        const args = this.config[command].map(expandHome);
        if (command === 'terminal' && args.length === 1 && ['dev-os-terminal', 'foot'].includes(args[0])) {
            this.processes.launch('terminal', 'terminal.native', directory); return true;
        }
        if (!GLib.find_program_in_path(args[0])) {
            this.showMessage(`Install ${args[0]} or change '${command}' in config.json.`);
            return false;
        }
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
            if (directory) launcher.set_cwd(directory);
            const process = launcher.spawnv(args);
            process.wait_async(null, (_source, result) => {
                try {
                    process.wait_finish(result);
                    if (!process.get_successful() && !this.quitting)
                        this.showMessage(`${command} exited unsuccessfully; see terminal output.`);
                } catch (error) { if (!this.quitting) this.showMessage((error instanceof Error ? error.message : String(error))); }
            });
            return true;
        } catch (error) { this.showMessage(`Could not start ${args[0]}: ${(error instanceof Error ? error.message : String(error))}`); return false; }
    }

    /** Closes the native overlays except the ones named; a window that is not running is left alone. */
    hideOverlays(keep: ('launcher' | 'task-view' | 'snap')[]) {
        const report = (message: string) => this.showMessage(message);
        if (!keep.includes('launcher')) nativeLauncher(['launcher', 'hide'], false, report);
        if (!keep.includes('task-view')) nativeTaskView(['task-view', 'hide'], false, report);
        if (!keep.includes('snap')) nativeSnap(['snap-layouts', 'hide'], false, report);
    }
    showMessage(message: string) {
        try {Gio.DBus.session.emit_signal(null, '/org/devos/Panel', 'org.devos.Panel', 'Message', new GLib.Variant('(s)', [message]));} catch (error) {printerr(String(error));}
        printerr(`Dev OS: ${message}`);
        for (const listener of this.messages) listener(message);
        if (this.messageSource) GLib.source_remove(this.messageSource);
        this.messageSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            for (const listener of this.messages) listener('');
            this.messageSource = 0; return GLib.SOURCE_REMOVE;
        });
    }
    vfunc_shutdown() {
        this.quitting = true;
        this.control?.unexport(); this.control = undefined;
        if (this.messageSource) GLib.source_remove(this.messageSource);
        this.signalSources.forEach(source => GLib.source_remove(source));
        this.processes.destroy(); this.stopWatching?.(); this.settingsCleanup?.();
        this.displaySignals.forEach(id => this.display.disconnect(id));
        for (const runtime of this.userRuntimes.reverse()) runtime.stop();
        this.userRuntimes = [];
        this.ui.stop();
        this.windows?.destroy();
        this.extensions.dispose();
        super.vfunc_shutdown();
    }
});

export type DesktopShellInstance = InstanceType<typeof DesktopShell>;
