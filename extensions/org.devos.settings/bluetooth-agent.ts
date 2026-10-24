import {Gio, GLib} from '@dev-os/core';
export interface PairPrompt {kind: 'pin' | 'passkey' | 'confirm' | 'authorize' | 'display'; device: string; code: string;}
export const agentXml = `<node><interface name="org.bluez.Agent1">
<method name="Release"/><method name="RequestPinCode"><arg type="o" direction="in"/><arg type="s" direction="out"/></method>
<method name="DisplayPinCode"><arg type="o" direction="in"/><arg type="s" direction="in"/></method>
<method name="RequestPasskey"><arg type="o" direction="in"/><arg type="u" direction="out"/></method>
<method name="DisplayPasskey"><arg type="o" direction="in"/><arg type="u" direction="in"/><arg type="q" direction="in"/></method>
<method name="RequestConfirmation"><arg type="o" direction="in"/><arg type="u" direction="in"/></method>
<method name="RequestAuthorization"><arg type="o" direction="in"/></method>
<method name="AuthorizeService"><arg type="o" direction="in"/><arg type="s" direction="in"/></method><method name="Cancel"/>
</interface></node>`;
export class BluetoothAgent {
    private exported: Gio.DBusExportedObject | null = null;
    private pending: Gio.DBusMethodInvocation | null = null;
    private prompt: PairPrompt | null = null; private device = ''; private cancelled = false;
    private path = `/org/devos/Settings/Agent${GLib.get_monotonic_time()}`;
    constructor(private changed: (prompt: PairPrompt | null) => void, private bus: Gio.DBusConnection = Gio.DBus.system) {}
    private call(path: string, iface: string, method: string, parameters: GLib.Variant | null, timeout = 10000): Promise<GLib.Variant> {
        return new Promise((resolve, reject) => this.bus.call('org.bluez', path, iface, method, parameters, null, Gio.DBusCallFlags.NONE, timeout, null, (bus, result) => {try {resolve(bus!.call_finish(result));} catch (error) {reject(error);}}));
    }
    private ask(kind: PairPrompt['kind'], device: string, code: string, invocation: Gio.DBusMethodInvocation) {
        if (device !== this.device || this.cancelled || this.pending) {invocation.return_dbus_error('org.bluez.Error.Rejected', 'Unexpected pairing request.'); return;}
        this.pending = invocation; this.prompt = {kind, device, code}; this.changed(this.prompt);
    }
    respond(accept: boolean, value = '') {
        const pending = this.pending, prompt = this.prompt; if (!pending || !prompt) return;
        if (accept && prompt.kind === 'pin' && (!value.length || value.length > 16)) throw new Error('Enter a PIN of 1–16 characters.');
        if (accept && prompt.kind === 'passkey' && !/^\d{1,6}$/.test(value)) throw new Error('Enter a passkey of up to six digits.');
        this.pending = null; this.prompt = null; this.changed(null);
        if (!accept) pending.return_dbus_error('org.bluez.Error.Rejected', 'Pairing declined.');
        else pending.return_value(prompt.kind === 'pin' ? new GLib.Variant('(s)', [value]) : prompt.kind === 'passkey' ? new GLib.Variant('(u)', [Number(value)]) : null);
    }
    async pair(device: string) {
        if (this.device) throw new Error('Another pairing request is in progress.');
        this.device = device; this.cancelled = false;
        const show = (path: string, code: string) => {if (path === this.device && !this.cancelled) {this.prompt = {kind: 'display', device: path, code}; this.changed(this.prompt);}};
        this.exported = Gio.DBusExportedObject.wrapJSObject(agentXml, {
            Release: () => this.cancel(), Cancel: () => {this.respond(false); this.changed(null);},
            RequestPinCodeAsync: ([path]: [string], inv: Gio.DBusMethodInvocation) => this.ask('pin', path, '', inv),
            RequestPasskeyAsync: ([path]: [string], inv: Gio.DBusMethodInvocation) => this.ask('passkey', path, '', inv),
            RequestConfirmationAsync: ([path, code]: [string, number], inv: Gio.DBusMethodInvocation) => this.ask('confirm', path, String(code).padStart(6, '0'), inv),
            RequestAuthorizationAsync: ([path]: [string], inv: Gio.DBusMethodInvocation) => this.ask('authorize', path, '', inv),
            AuthorizeServiceAsync: ([path, uuid]: [string, string], inv: Gio.DBusMethodInvocation) => this.ask('authorize', path, uuid, inv),
            DisplayPinCode: (path: string, code: string) => show(path, code),
            DisplayPasskey: (path: string, code: number, entered: number) => show(path, `${String(code).padStart(6, '0')} · ${entered} digits entered`),
        });
        this.exported.export(this.bus, this.path);
        let registered = false;
        try {
            await this.call('/org/bluez', 'org.bluez.AgentManager1', 'RegisterAgent', new GLib.Variant('(os)', [this.path, 'KeyboardDisplay'])); registered = true;
            if (this.cancelled) throw new Error('Pairing cancelled.');
            await this.call(device, 'org.bluez.Device1', 'Pair', null, 90000);
        } finally {
            this.respond(false); this.changed(null);
            if (registered) {try {await this.call('/org/bluez', 'org.bluez.AgentManager1', 'UnregisterAgent', new GLib.Variant('(o)', [this.path]));} catch { /* BlueZ may have restarted. */ }}
            this.exported?.unexport(); this.exported = null; this.device = ''; this.prompt = null;
        }
    }
    cancel() {this.cancelled = true; this.respond(false); this.changed(null); if (this.device) void this.call(this.device, 'org.bluez.Device1', 'CancelPairing', null).catch(() => {});}
}
