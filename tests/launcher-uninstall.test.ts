import {Gtk, GLib, removeTree} from '@dev-os/core';
import {userPackageCommand, createAppContextMenu, appInfoLines} from '../src/system/org.devos.launcher/uninstall.js';
Gtk.init(null);
function assert(value: unknown, message: string): void {if (!value) throw new Error(message);}
const directory = GLib.dir_make_tmp('devos-launcher-uninstall-XXXXXX');
const entry = (name: string, exec: string) => GLib.file_set_contents(`${directory}/${name}`, `[Desktop Entry]\nType=Application\nName=X\nExec=${exec}\n`);
try {
    entry('dev-hello.desktop', '/usr/bin/devospm --root /home/u/.local/share/devos run hello');
    entry('dev-other.desktop', '/usr/bin/devospm --root /r run something-else');
    entry('dev-plain.desktop', 'foot');
    entry('dev-os-app-store.desktop', 'dev-os-shell app-store');
    entry('dev-os-terminal.desktop', '/usr/bin/devospm --root /r run os-terminal');
    entry('firefox.desktop', '/usr/bin/devospm --root /r run firefox');
    GLib.file_set_contents(`${directory}/real.desktop`, '[Desktop Entry]\nType=Application\nName=Y\nExec=/usr/bin/devospm --root /r run linked\n');
    GLib.spawn_command_line_sync(`ln -s ${directory}/real.desktop ${directory}/dev-linked.desktop`);
    assert(userPackageCommand('dev-hello.desktop', directory) === 'hello', 'user-installed package is uninstallable');
    assert(userPackageCommand('dev-other.desktop', directory) === null, 'Exec must run the same command as the file name');
    assert(userPackageCommand('dev-plain.desktop', directory) === null, 'plain launchers are not packages');
    assert(userPackageCommand('dev-os-app-store.desktop', directory) === null && userPackageCommand('dev-os-terminal.desktop', directory) === null, 'base Dev OS apps can never be uninstalled');
    assert(userPackageCommand('firefox.desktop', directory) === null && userPackageCommand('dev-missing.desktop', directory) === null && userPackageCommand(null, directory) === null, 'other or missing entries are not uninstallable');
    assert(userPackageCommand('dev-linked.desktop', directory) === null, 'symlinked launchers are refused');
    assert(userPackageCommand('dev-hello.desktop', `${directory}/nowhere`) === null, 'entries outside the user applications directory (system apps) never qualify');
    let removed = 0;
    const item = (menu: Gtk.Menu) => menu.get_children().find(child => child.name === 'launcher-menu-uninstall') as Gtk.MenuItem | undefined;
    assert(!item(createAppContextMenu({})), 'no Uninstall item without an action');
    const menu = createAppContextMenu({uninstall: () => {removed++;}});
    item(menu)!.activate(); assert(removed === 1 && item(menu)!.sensitive, 'Uninstall item triggers the confirmation action');
    assert(!item(createAppContextMenu({uninstall: () => {}}, true))!.sensitive, 'Uninstall is disabled while another removal runs');
    const menus = (actions: {info?(): void; uninstall?(): void}) => createAppContextMenu(actions).get_children().map(child => child.name).join();
    assert(menus({info: () => {}}) === 'launcher-menu-info' && menus({info: () => {}, uninstall: () => {}}) === 'launcher-menu-info,launcher-menu-uninstall', 'Info for every app, Uninstall only for user packages');
    let shown = 0; createAppContextMenu({info: () => {shown++;}}).get_children()[0].activate(); assert(shown === 1, 'Info item activates');
    const fake = {get_display_name: () => 'Hello', get_id: () => 'dev-hello.desktop', get_description: () => null, get_commandline: () => 'devospm run hello', get_filename: () => '/x/dev-hello.desktop'};
    assert(appInfoLines(fake, 'hello').some(l => l.includes('can be uninstalled')) && appInfoLines(fake, null).some(l => l.includes('cannot be uninstalled')) && appInfoLines(fake, null)[1] === 'No description provided.', 'info text distinguishes packages from base apps');
    print('PASS: Info for all apps; Uninstall is offered only for user-installed packages (never base apps, symlinks or system entries) and the menu item works');
} finally {removeTree(directory);}
