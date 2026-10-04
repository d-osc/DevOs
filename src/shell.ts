import {Gdk, Gio, GLib, Gtk, GtkLayerShell, GObject} from './gtk.js';
import {addUnixSignal} from './signals.js';
import type {Config, Command} from './config.js';
import {loadConfig, saveConfig, expandHome} from './config.js';
import {ExtensionManager} from './extensions/manager.js';
import {UIRuntime} from './extensions/runtime.js';
import type {UIContext, UICommand, UIExtension} from './extensions/runtime.js';
import {Windows} from './windows.js';
import {SettingsPages} from './extensions/settings-pages.js';

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
    declare windows: Windows | undefined;
    declare settingsPages: SettingsPages;
    constructor(options: {config: Config; uiDefinitions: UIExtension[]}) {
        super(options as unknown as Gtk.Application.ConstructorProps);
    }

    _init({config, uiDefinitions}: {config: Config; uiDefinitions: UIExtension[]}) {
        const display = GLib.getenv('WAYLAND_DISPLAY') ?? 'default';
        const runtime = GLib.getenv('XDG_RUNTIME_DIR') ?? '';
        const instance = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256,
            `${runtime}/${display}`, -1)!.slice(0, 16);
        super._init({application_id: `org.devos.Shell.s${instance}`,
            flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE});
        this.config = config;
        this.uiDefinitions = uiDefinitions;
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
        this.extensions = new ExtensionManager();
        this.settingsPages = new SettingsPages();
    }

    vfunc_startup() {
        super.vfunc_startup();
        const display = Gdk.Display.get_default();
        if (display) this.display = display;
        if (!this.display || !GtkLayerShell.is_supported()) {
            this.startupError = 'This display does not support Wayland layer-shell. ' +
                'Run bin/dev-os-session --nested to start a labwc compositor.';
            return;
        }
        this.hold();
        this.windows = new Windows();
        try { this.ui.start(this.uiDefinitions, this.uiContext()); }
        catch (error) { this.windows.destroy(); this.startupError = `UI activation failed: ${String(error)}`; this.release(); return; }
        for (const event of ['monitor-added', 'monitor-removed'] as const) {
            this.displaySignals.push(this.display.connect(event, () => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE,
                () => this.reconcileMonitors())));
        }
        for (const signal of [15, 2]) {
            this.signalSources.push(addUnixSignal(GLib.PRIORITY_DEFAULT, signal, () => {
                this.quit(); return GLib.SOURCE_CONTINUE;
            }));
        }
        print(`Dev OS shell ready on ${GLib.getenv('WAYLAND_DISPLAY')} (${this.display.get_n_monitors()} output(s)) [GJS]`);
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
        if (this.startupError) { printerr(this.startupError); return 1; }
        const command = commandLine.get_arguments()[1] ?? 'shell';
        switch (command) {
        case 'launcher': case 'logout': case 'settings': this.invoke(command); break;
        case 'reload': return this.reloadConfig() ? 0 : 1;
        case 'terminal': case 'files': case 'lock': return this.runCommand(command) ? 0 : 1;
        case 'editor': {
            const open = this.commands.get('editor');
            if (!open) throw new Error('Editor extension is unavailable');
            const paths = commandLine.get_arguments().slice(2);
            if (!paths.length) open();
            for (const path of paths) {
                const local = path.startsWith('file:') ? Gio.File.new_for_uri(path).get_path() : path;
                if (!local) throw new Error('Editor supports local files.');
                open(undefined, GLib.canonicalize_filename(local, commandLine.get_cwd()));
            }
            break;
        }
        }
        return 0;
    }

    invoke(command: string, monitor?: Gdk.Monitor): void {
        const handler = this.commands.get(command);
        if (!handler) throw new Error(`No extension handles command ${command}`);
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
            saveCore: value => { saveConfig(value); },
            monitors: () => Array.from({length: this.display.get_n_monitors()}, (_, index) => this.display.get_monitor(index)!),
            runCommand: (command, directory) => this.runCommand(command, directory), reload: () => this.reloadConfig(), quit: () => this.quit(),
            invoke: (command, monitor) => this.invoke(command, monitor),
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
        try { config = loadConfig(); }
        catch (error) { this.showMessage((error instanceof Error ? error.message : String(error))); return false; }
        this.config = config; this.extensions.reload();
        for (const listener of this.reloadListeners) listener();
        this.showMessage('Configuration reloaded');
        return true;
    }

    runCommand(command: Command, directory?: string): boolean {
        if (command === 'files' && this.commands.has('files')) {
            try { this.invoke('files'); return true; }
            catch (error) { this.showMessage(`Could not open Files: ${String(error)}`); return false; }
        }
        const args = this.config[command].map(expandHome);
        if (command === 'terminal' && args.length === 1 && ['dev-os-terminal', 'foot'].includes(args[0])) {
            try {
                const open = this.commands.get('terminal.native');
                if (!open) throw new Error('Terminal extension is unavailable');
                open(undefined, directory);
                return true;
            } catch (error) { this.showMessage(`Could not open Terminal: ${String(error)}`); return false; }
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

    showMessage(message: string) {
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
        if (this.messageSource) GLib.source_remove(this.messageSource);
        this.signalSources.forEach(source => GLib.source_remove(source));
        this.displaySignals.forEach(id => this.display.disconnect(id));
        this.ui.stop();
        this.windows?.destroy();
        this.extensions.dispose();
        super.vfunc_shutdown();
    }
});

export type DesktopShellInstance = InstanceType<typeof DesktopShell>;
