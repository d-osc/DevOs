import {GLib, removeTree} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
import {BASE_APPS, appForCommand, appExtension, processApplicationId, SHELL_EXTENSIONS, APP_FOUNDATIONS} from '@dev-os/runtime/processes';
import {shellApplicationId} from '@dev-os/runtime/remote';
import {ExtensionManager} from '@dev-os/extensions/manager';
import {loadSystemExtensions, systemManifests} from '@dev-os/extensions/system';
import {windowGroup} from '@dev-os/services/windows';
import {isSystemApp} from '../packages/services/memory-policy.js';
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    const manifests = new Set(systemManifests().map(manifest => manifest.id));
    const ids = BASE_APPS.map(processApplicationId);
    assert(new Set([...ids, shellApplicationId(), processApplicationId('services')]).size === BASE_APPS.length + 2, 'Every process role has a distinct session-scoped bus name');
    for (const app of BASE_APPS) assert(manifests.has(appExtension(app)) && !SHELL_EXTENSIONS.has(appExtension(app)), `${app} has an isolated manifest`);
    for (const command of ['settings', 'settings.wifi', 'session.switch-user', 'files', 'terminal.native', 'editor', 'camera', 'microphone', 'task-manager', 'browser', 'disk-manager', 'app-store', 'app-store-extensions', 'extension-store', 'settings.store', 'package-install', 'installer', 'screenshot', 'screenshot-app']) assert(appForCommand(command), `${command} has a process route`);
    assert(appForCommand('settings.store') === 'appstore', 'Legacy extension-store links route to App Store instead of Settings');
    assert(!appForCommand('launcher') && !appForCommand('lock'), 'Shell and service commands cannot activate base app code');
    const definitions = await loadSystemExtensions(ROOT, id => SHELL_EXTENSIONS.has(id));
    assert(definitions.length === SHELL_EXTENSIONS.size && definitions.every(item => !BASE_APPS.some(app => appExtension(app) === item.id)), 'Shell imports only desktop surfaces and foundations');
    assert(APP_FOUNDATIONS.size === 2, 'App hosts share only theme/icon foundations');
    assert(windowGroup({id: 1, title: 'Screenshot', appId: processApplicationId('screenshot'), active: false, minimized: false}) === 'dev-os-screenshot', 'Separate app IDs retain taskbar identity');
    assert(isSystemApp(processApplicationId('files')) && !isSystemApp('org.example.Editor'), 'Base and installed apps retain distinct memory policy identities');
    const temporary = GLib.dir_make_tmp('devos-preferences-ipc-XXXXXX');
    const paths = {system: `${ROOT}/src/apps`, components: `${ROOT}/src/system`, bundled: `${ROOT}/src/extensions`, user: `${temporary}/user`, preferences: `${temporary}/dev-os/extensions`};
    const writer = new ExtensionManager(paths), reader = new ExtensionManager(paths);
    let updates = 0; const stop = reader.watch(() => {updates++;});
    try {
        writer.update('org.devos.terminal', true, {...writer.get('org.devos.terminal').state.values, font: 'Monospace 17'});
        for (let attempt = 0; attempt < 20 && !updates; attempt++) await wait();
        assert(reader.get('org.devos.terminal').state.values.font === 'Monospace 17', 'Preferences written by one host propagate to another');
        stop(); const count = updates;
        writer.update('org.devos.terminal', true, {...writer.get('org.devos.terminal').state.values, font: 'Monospace 18'});
        await wait(); assert(updates === count, 'Stopped hosts no longer receive file events');
    } finally {stop(); writer.dispose(); reader.dispose(); removeTree(temporary);}
    print('PASS: process roles, command routing, filtered imports, taskbar identity and cross-process preferences');
}
const loop = new GLib.MainLoop(null, false); let failure: unknown;
void verify().catch(error => {failure = error;}).finally(() => loop.quit()); loop.run(); if (failure) throw failure;
