import {Gtk, GLib, baseImage} from '@dev-os/core';

/**
 * Which launcher entries may offer "Uninstall": only apps that `devospm` installed for this user.
 * Those have a regular `dev-<command>.desktop` in the user's applications directory whose Exec is
 * `<dev> --root <store> run <command>`. Base apps (dev-os-*.desktop, system and image packages,
 * anything outside the user directory) never qualify, so they can never be removed from here.
 */
export const userApplicationsDirectory = () => GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);

export function userPackageCommand(appId: string | null | undefined, directory = userApplicationsDirectory()): string | null {
    const match = appId ? /^dev-([a-z0-9][a-z0-9_-]{0,63})\.desktop$/.exec(appId) : null;
    if (!match || appId!.startsWith('dev-os-')) return null; // dev-os-* are the base apps
    const path = GLib.build_filenamev([directory, appId!]);
    try {
        if (!GLib.file_test(path, GLib.FileTest.IS_REGULAR) || GLib.file_test(path, GLib.FileTest.IS_SYMLINK)) return null;
        const keys = new GLib.KeyFile(); keys.load_from_file(path, GLib.KeyFileFlags.NONE);
        const exec = keys.get_string('Desktop Entry', 'Exec');
        return / --root \S+ run (\S+)/.exec(exec)?.[1] === match[1] ? match[1] : null;
    } catch { return null; }
}

/** Right-click menu of an app in the Applications list. `uninstall` is only passed for user-installed packages. */
export function createAppContextMenu(actions: {info?(): void; uninstall?(): void}, busy = false) {
    const menu = new Gtk.Menu(); menu.name = 'launcher-context-menu'; menu.get_style_context().add_class('launcher-context-menu');
    const add = (name: string, label: string, icon: string, action: () => void, sensitive: boolean) => {
        const row = new Gtk.MenuItem(), content = new Gtk.Box({spacing: 10});
        content.add(baseImage(icon, 16)); content.add(new Gtk.Label({label, xalign: 0}));
        row.add(content); row.name = name; row.sensitive = sensitive; row.connect('activate', action); menu.append(row);
    };
    if (actions.info) add('launcher-menu-info', 'Info', 'dialog-information-symbolic', actions.info, true);
    if (actions.uninstall) {
        const row = new Gtk.MenuItem(), content = new Gtk.Box({spacing: 10});
        content.add(baseImage('user-trash-symbolic', 16)); content.add(new Gtk.Label({label: 'Uninstall', xalign: 0}));
        row.add(content); row.name = 'launcher-menu-uninstall'; row.sensitive = !busy;
        row.connect('activate', () => actions.uninstall!()); menu.append(row);
    }
    return menu;
}

/** Lines shown by the Info menu item: what the app is, where it comes from and how it starts. */
export function appInfoLines(app: {get_display_name(): string; get_id(): string | null; get_description(): string | null; get_commandline(): string | null; get_filename?(): string | null}, packageCommand: string | null): string[] {
    return [
        app.get_display_name(),
        app.get_description() || 'No description provided.',
        `ID: ${app.get_id() ?? 'unknown'}`,
        `Source: ${packageCommand ? `Installed for your user from a package (command ${packageCommand}); can be uninstalled` : 'Base system app; cannot be uninstalled here'}`,
        `Launcher file: ${app.get_filename?.() ?? 'unknown'}`,
        `Command: ${app.get_commandline() ?? 'unknown'}`,
    ];
}
