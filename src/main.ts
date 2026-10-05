import {
    GLib
} from '@dev-os/core';
import System from 'system';
import {ROOT, VERSION, loadConfig} from '@dev-os/config';
import {remoteCommand} from '@dev-os/runtime/remote';

const commands = ['shell', 'launcher', 'terminal', 'files', 'editor', 'lock', 'logout', 'reload', 'settings', 'doctor'];

async function main(args: string[]): Promise<number> {
    if (args.includes('--version')) { print(VERSION); return 0; }
    if (args.includes('--help') || args.includes('-h')) {
        print(`Usage: dev-os-shell [${commands.join(' | ')}] [--json]\n       dev-os-shell editor [file ...]`);
        return 0;
    }
    const command = args[0] ?? 'shell';
    if (!commands.includes(command) || (command !== 'editor' && args.slice(1).some(arg => arg !== '--json')) ||
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
