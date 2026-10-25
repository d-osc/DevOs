import {
    GLib
} from '@dev-os/core/base';
import System from 'system';
import {ROOT, VERSION, loadConfig} from '@dev-os/config';
import {remoteCommand} from '@dev-os/runtime/remote';

const commands = ['shell', 'browser', 'camera', 'microphone', 'screenshot', 'screenshot-app', 'window-next', 'window-previous', 'window-restore', 'launcher', 'overlays-hide', 'snap-layouts', 'task-view', 'task-view-show', 'task-view-hide', 'task-manager', 'disk-manager', 'installer', 'app-store', 'package-install', 'terminal', 'files', 'editor', 'lock', 'logout', 'reload', 'settings', 'language', 'time', 'system', 'display', 'sound', 'power', 'storage', 'about', 'network', 'wifi', 'touchpad', 'mouse', 'keyboard', 'bluetooth-add', 'printers', 'vpn', 'hotspot', 'airplane', 'proxy', 'advanced', 'doctor'];

async function main(args: string[]): Promise<number> {
    if (args.includes('--version')) { print(VERSION); return 0; }
    if (args.includes('--help') || args.includes('-h')) {
        print(`Usage: dev-os-shell [${commands.join(' | ')}] [--json]\n       dev-os-shell editor [file ...]
       dev-os-shell package-install <file.dpk|.deb|.rpm|.tar.gz ...>\n       dev-os-shell drivers [--json] [--fix] (Python 3; no build required)`);
        return 0;
    }
    const command = args[0] ?? 'shell';
    if (!commands.includes(command) || (!['editor', 'package-install'].includes(command) && args.slice(1).some(arg => arg !== '--json')) ||
        (args.includes('--json') && command !== 'doctor')) {
        printerr('Invalid command. Use dev-os-shell --help.');
        return 2;
    }
    if (command === 'doctor') {
        const {doctor} = await import('@dev-os/runtime/doctor');
        const checks = await doctor();
        if (args.includes('--json')) print(JSON.stringify(checks, null, 2));
        else for (const [name, ok] of Object.entries(checks)) print(`${ok ? 'OK' : 'MISSING'}: ${name}`);
        return Object.values(checks).every(Boolean) ? 0 : 1;
    }
    const remoteStatus = remoteCommand([command, ...args.slice(1)]);
    if (remoteStatus !== undefined) return remoteStatus;
    // Hiding an absent overview must not start a new desktop process.
    if (['task-view-hide', 'overlays-hide', 'window-next', 'window-previous', 'window-restore'].includes(command)) return 0;
    GLib.setenv('GDK_BACKEND', 'wayland', true);
    if (!['core', 'extensions', 'updates', 'runtime', 'services', 'compat', 'config', 'shell', 'supervisor-lib', 'react-gtk', 'panel-view', 'launcher-view', 'background-view'].every(name =>
        GLib.file_test(`${ROOT}/dist/${name}.js`, GLib.FileTest.IS_REGULAR)))
        throw new Error('React bundle missing. Run npm ci and npm run build in the source tree.');
    const {DesktopShell} = await import('@dev-os/shell');
    const {loadSystemExtensions, ExtensionManager, loadUserExtensions} = await import('@dev-os/extensions');
    const preferences = new ExtensionManager();
    const [userDefinitions, uiDefinitions] = await Promise.all([loadUserExtensions(preferences), loadSystemExtensions()]);
    return await new DesktopShell({config: loadConfig(), uiDefinitions, userDefinitions, preferences}).runAsync(['dev-os-shell', command, ...args.slice(1)]);
}

try { System.exit(await main(ARGV)); }
catch (error) { printerr(`Dev OS: ${(error instanceof Error ? error.message : String(error))}\nRun bin/dev-os-shell doctor to check dependencies.`); System.exit(1); }
