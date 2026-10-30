import {Gio, GLib} from '@dev-os/core/base';
import {setActiveTheme, resolveTheme, themeSettings} from '@dev-os/core/theme';
import System from 'system';
import {loadConfig, expandHome} from '@dev-os/config';
import {ExtensionManager} from '@dev-os/extensions/manager';
import {Updates} from '@dev-os/updates';
import {LockScreen} from '@dev-os/runtime/lock';
import {SleepGuard} from '@dev-os/runtime/sleep';
import {LidStandby} from '@dev-os/runtime/lid';
import {shellApplicationId, controlInterface} from '@dev-os/runtime/remote';
import {processApplicationId, sendCommand} from '@dev-os/runtime/processes';
import {addUnixSignal} from '@dev-os/services/signals';

// A Gio application, with its own GLib main loop: lock readiness and sleep
// inhibitors continue working even when the GUI or a base app is busy/crashes.
const application = new Gio.Application({application_id: processApplicationId('services'), flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE});
const preferences = new ExtensionManager(), locker = new LockScreen();
let config = loadConfig(), guard: SleepGuard | undefined, lid: LidStandby | undefined, control: Gio.DBusExportedObject | undefined;
let stopWatching = () => {}, periodic = 0;
const signals: number[] = [];
const report = (message: string) => {printerr(`Dev OS services: ${message}`); void sendCommand(shellApplicationId(), ['services.message', message]).catch(() => {});};
const update = () => {
    // A malformed edit must not disable locking or replace the last valid config.
    try {config = loadConfig();} catch (error) {report(String(error));}
    const theme = themeSettings(preferences.get('org.devos.theme').state.values);
    setActiveTheme(resolveTheme(theme.mode, new Date(), theme), theme.family);
};
const lock = (ready?: (secured: boolean) => void) => {update(); return locker.start(config, report, ready);};
const execute = (args: string[]): [number, string] => {
    try {
        if (args[0] === 'reload' || !args.length) {preferences.reload(); update(); return [0, ''];}
        if (args[0] !== 'lock') throw new Error('Unknown service command');
        update();
        const command = config.lock.map(expandHome);
        if (command.length === 1 && command[0] === 'dev-os-lock') return lock() ? [0, ''] : [1, 'Could not lock the screen'];
        Gio.Subprocess.new(command, Gio.SubprocessFlags.NONE); return [0, ''];
    } catch (error) {return [1, String(error)];}
};
const updater = new Updates({repository: () => String(preferences.get('org.devos.updates').state.values.repository)});
application.connect('startup', () => {
    application.hold(); update(); stopWatching = preferences.watch(() => {try {update();} catch (error) {report(String(error));}});
    control = Gio.DBusExportedObject.wrapJSObject(controlInterface, {Execute: (args: string[]) => execute(args)});
    control.export(application.get_dbus_connection()!, `${application.get_dbus_object_path()!}/control`);
    if (GLib.getenv('DEV_OS_LOCK_ON_SLEEP') !== '0') {
        guard = new SleepGuard(ready => {if (!lock(ready)) ready();}); guard.start();
    }
    lid = new LidStandby(ready => lock(ready), report); lid.start();
    periodic = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 3600, () => {
        if (preferences.get('org.devos.updates').state.values.periodicCheck === true) void updater.checkIfDue(24);
        return GLib.SOURCE_CONTINUE;
    });
    for (const signal of [15, 2]) signals.push(addUnixSignal(GLib.PRIORITY_DEFAULT, signal, () => {application.quit(); return GLib.SOURCE_CONTINUE;}));
    print(`Dev OS services ready [process ${application.get_application_id()}]`);
});
application.connect('command-line', (_app, line) => {
    const [status, error] = execute(line.get_arguments().slice(1));
    if (error) line.printerr_literal(`${error}\n`);
    line.set_exit_status(status); line.done(); return status;
});
application.connect('shutdown', () => {
    control?.unexport(); guard?.destroy(); lid?.destroy(); stopWatching(); updater.dispose(); preferences.dispose();
    if (periodic) GLib.source_remove(periodic);
    for (const signal of signals) GLib.source_remove(signal);
});
System.exit(await application.runAsync(['dev-os-services', ...ARGV]));
