import {
    Gio, GLib
} from '@dev-os/core';

export function shellApplicationId(): string {
    const display = GLib.getenv('WAYLAND_DISPLAY') ?? 'default';
    const runtime = GLib.getenv('XDG_RUNTIME_DIR') ?? '';
    const instance = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256,
        `${runtime}/${display}`, -1)!.slice(0, 16);
    return `org.devos.Shell.s${instance}`;
}

export const controlInterface = `<node><interface name="org.devos.Shell.Control">
    <method name="Execute">
        <arg name="arguments" type="as" direction="in"/>
        <arg name="cwd" type="s" direction="in"/>
        <arg name="status" type="i" direction="out"/>
        <arg name="error" type="s" direction="out"/>
    </method>
</interface></node>`;

// A shortcut process needs only Gio/GLib. Avoid loading GTK, React, manifests
// and every UI extension merely to forward a command to the running desktop.
export function remoteCommand(args: string[]): number | undefined {
    const id = shellApplicationId();
    try {
        const reply = Gio.DBus.session.call_sync(id, `/${id.replaceAll('.', '/')}/control`,
            'org.devos.Shell.Control', 'Execute', new GLib.Variant('(ass)', [args, GLib.get_current_dir()]),
            new GLib.VariantType('(is)'), Gio.DBusCallFlags.NO_AUTO_START, 10000, null);
        const [status, error] = reply.deepUnpack() as [number, string];
        if (error) printerr(`Dev OS command: ${error}`);
        return status;
    } catch (error) {
        // Older running shells still accept the original GApplication path.
        if (error instanceof GLib.Error && [Gio.DBusError.SERVICE_UNKNOWN, Gio.DBusError.NAME_HAS_NO_OWNER,
            Gio.DBusError.UNKNOWN_METHOD, Gio.DBusError.UNKNOWN_INTERFACE, Gio.DBusError.UNKNOWN_OBJECT]
            .some(code => error.matches(Gio.DBusError, code))) return undefined;
        throw error;
    }
}
