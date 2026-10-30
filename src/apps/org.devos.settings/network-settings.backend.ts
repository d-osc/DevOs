import {Gio, GLib} from '@dev-os/core/base';
export interface NetworkProfile {id: string; path: string; name: string; type: string; activePath: string; active: boolean; hotspot: boolean; ownHotspot: boolean;}
export interface NetworkAddresses {addresses: string[]; dns: string[]; gateway: string;}
export interface NetworkAdapter {path: string; name: string; type: number; state: number; managed: boolean; mtu: number; mac: string; driver: string; ap: boolean; ipv4: NetworkAddresses; ipv6: NetworkAddresses;}
const passphraseAlphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Random WPA2 passphrase (12 characters, no look-alike symbols) from the kernel entropy pool. */
export function generatePassphrase(length = 12): string {
    let bytes: Uint8Array | null = null;
    try {const stream = Gio.File.new_for_path('/dev/urandom').read(null); bytes = stream.read_bytes(length * 4, null).toArray(); stream.close(null);} catch {bytes = null;}
    let value = '';
    for (let i = 0; value.length < length; i++) {
        const byte = bytes && i < bytes.length ? bytes[i] : GLib.random_int_range(0, 256);
        if (byte < 256 - (256 % passphraseAlphabet.length)) value += passphraseAlphabet[byte % passphraseAlphabet.length];
    }
    return value;
}
export interface Radio {id: number; type: string; device: string; soft: string; hard: string;}
export interface NetworkSnapshot {radioError?: string; available: boolean; adapters: NetworkAdapter[]; profiles: NetworkProfile[]; radios: Radio[]; airplane: boolean; connectivity: number;}
export const emptyNetwork: NetworkSnapshot = {available:false, adapters:[], profiles:[], radios:[], airplane:false, connectivity:0};
export interface ProxyValues {mode: 'none' | 'auto' | 'manual'; pac: string; http: string; httpPort: number; https: string; httpsPort: number; socks: string; socksPort: number; bypass: string[]; same?: boolean; authentication?: boolean; username?: string; password?: string;}
export interface ProxyControls {load(): ProxyValues | Promise<ProxyValues>; save(value: ProxyValues): void | Promise<void>;}
export function validateProxy(value: ProxyValues) {
    if (!['none','auto','manual'].includes(value.mode)) throw new Error('Choose a proxy mode.');
    if (value.mode === 'auto' && !/^https?:\/\/[^\s@]+$/i.test(value.pac)) throw new Error('Enter an HTTP or HTTPS address for the PAC file.');
    if (value.mode === 'manual') {
        if (value.same && !value.http) throw new Error('Enter the HTTP proxy used for all protocols.');
        if (![value.http, value.https, value.socks].some(Boolean)) throw new Error('Enter at least one proxy server.');
        for (const [host, port] of [[value.http, value.httpPort], [value.https, value.httpsPort], [value.socks, value.socksPort]] as [string, number][]) {
            if (host && (!/^[a-zA-Z0-9.:[\]_-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Use a host name or IP address and a port from 1 to 65535.');
        }
    }
    if (value.bypass.length > 100 || value.bypass.some(host => !host || /[\s\r\n]/.test(host))) throw new Error('Enter comma-separated hosts to bypass.');
}
export class SystemProxy implements ProxyControls {
    private settings(schema: string) {
        const found = Gio.SettingsSchemaSource.get_default()?.lookup(schema, true);
        if (!found) throw new Error('System proxy support is not installed. Install the current DevOs runtime.');
        return new Gio.Settings({settings_schema: found});
    }
    async load(): Promise<ProxyValues> {
        const root = this.settings('org.gnome.system.proxy'), http = this.settings('org.gnome.system.proxy.http'), https = this.settings('org.gnome.system.proxy.https'), socks = this.settings('org.gnome.system.proxy.socks');
        return {mode: root.get_string('mode') as ProxyValues['mode'], pac:root.get_string('autoconfig-url'), http:http.get_string('host'), httpPort:http.get_int('port'), https:https.get_string('host'), httpsPort:https.get_int('port'), socks:socks.get_string('host'), socksPort:socks.get_int('port'), bypass:root.get_strv('ignore-hosts'), same:root.get_boolean('use-same-proxy'), authentication:http.get_boolean('use-authentication'), username:http.get_string('authentication-user'), password:http.get_string('authentication-password')};
    }
    async save(value: ProxyValues) {
        validateProxy(value); const original = await this.load();
        const changes = (v: ProxyValues): [Gio.Settings, string, GLib.Variant][] => {
            const root = this.settings('org.gnome.system.proxy');
            const fields: [Gio.Settings,string,GLib.Variant][] = [[root, 'autoconfig-url', new GLib.Variant('s', v.pac)], [root,'ignore-hosts',new GLib.Variant('as',v.bypass)]];
            fields.push([root,'use-same-proxy',new GLib.Variant('b',Boolean(v.same))]);
            for (const key of ['http','https','socks'] as const) {const setting = this.settings(`org.gnome.system.proxy.${key}`); fields.push([setting,'host',new GLib.Variant('s',v[key])], [setting,'port',new GLib.Variant('i',v[`${key}Port`])]);}
            const http = this.settings('org.gnome.system.proxy.http');
            fields.push([http,'authentication-user',new GLib.Variant('s',v.username ?? '')], [http,'authentication-password',new GLib.Variant('s',v.password ?? '')], [http,'use-authentication',new GLib.Variant('b',Boolean(v.authentication))]);
            fields.push([root,'mode',new GLib.Variant('s',v.mode)]); return fields;
        };
        const fields = changes(value);
        for (const [settings,key] of fields) if (!settings.is_writable(key)) throw new Error('Your administrator has locked this proxy setting.');
        try {for (const [settings,key,variant] of fields) if (!settings.set_value(key,variant)) throw new Error('Could not save proxy settings.'); Gio.Settings.sync();}
        catch (error) {for (const [settings,key,variant] of changes(original)) settings.set_value(key,variant); Gio.Settings.sync(); throw error;}
    }
}
