import {Gio, GLib, Listeners} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';

export interface WifiNetwork {
    ssid: string; profile: string; adapter: string; interfaceId: string;
    signal: number; secure: boolean; connected: boolean; connectable: boolean;
    security?: string;
}
export interface WifiState {networks: WifiNetwork[]; busy: boolean; error: string; message: string; accessDenied: boolean; wirelessEnabled?: boolean;}
export interface WifiControls {
    state: WifiState;
    subscribe(listener: () => void): () => void;
    refresh(): Promise<void>;
    connect(network: WifiNetwork, password?: string): Promise<void>;
    setEnabled?(enabled: boolean): Promise<void>;
    disconnect?(network: WifiNetwork): Promise<void>;
    openWindowsSettings(): Promise<void>;
}
export function normalizeWifiNetworks(value: unknown): WifiNetwork[] {
    if (!Array.isArray(value)) throw new Error('Invalid Wi-Fi network list.');
    const result = new Map<string, WifiNetwork>();
    for (const item of value) {
        if (!item || typeof item !== 'object') throw new Error('Invalid Wi-Fi network.');
        const n = item as Record<string, unknown>;
        if (typeof n.ssid !== 'string' || typeof n.profile !== 'string' || typeof n.adapter !== 'string' ||
            typeof n.interfaceId !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(n.interfaceId) ||
            typeof n.signal !== 'number' || !Number.isFinite(n.signal) ||
            ['secure', 'connected', 'connectable'].some(key => typeof n[key] !== 'boolean')) throw new Error('Invalid Wi-Fi network data.');
        if (!n.ssid) continue; // Hidden networks are configured in Windows.
        const next = {...n, signal: Math.max(0, Math.min(100, n.signal))} as unknown as WifiNetwork;
        const key = JSON.stringify([next.interfaceId, next.ssid, next.secure]);
        const previous = result.get(key);
        if (!previous || next.connected || (!previous.connected && !previous.profile && !!next.profile)) result.set(key, next);
        else previous.signal = Math.max(previous.signal, next.signal);
    }
    return [...result.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || b.signal - a.signal || a.ssid.localeCompare(b.ssid));
}
export function isWsl(): boolean {
    try { return /microsoft/i.test(new TextDecoder().decode(GLib.file_get_contents('/proc/sys/kernel/osrelease')[1])); }
    catch { return false; }
}
export function nativeWifiHelper(root = ROOT): string {
    const source = `${root}/bin/dev-os-network-linux`;
    const helper = GLib.file_test(source, GLib.FileTest.IS_REGULAR) ? source : GLib.find_program_in_path('dev-os-network-linux');
    if (!helper) throw new Error('The Linux Wi-Fi helper is missing. Reinstall the DevOs desktop package.');
    return helper;
}
export function parseNativeWifiResponse(stdout: string | null, stderr: string | null, successful: boolean, timedOut = false): Record<string, unknown> {
    if (timedOut) throw new Error('The Linux Wi-Fi request timed out. Check NetworkManager and the Wi-Fi driver.');
    const detail = stderr?.trim().slice(0, 500);
    let response: unknown;
    try { response = JSON.parse((stdout ?? '').replace(/^\uFEFF/, '').trim()); }
    catch { throw new Error(detail ? `Linux Wi-Fi helper failed: ${detail}` : 'The Linux Wi-Fi helper returned no valid data. Check NetworkManager and the installed desktop package.'); }
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Invalid Linux Wi-Fi response.');
    const result = response as Record<string, unknown>;
    if (!successful || result.ok !== true) throw new Error(typeof result.error === 'string' && result.error ? result.error : detail || 'Linux NetworkManager request failed.');
    return result;
}
export class WindowsWifi implements WifiControls {
    state: WifiState = {networks: [], busy: false, error: '', message: '', accessDenied: false};
    private listeners = new Listeners();
    private process: Gio.Subprocess | null = null;
    private disposed = false;
    subscribe(listener: () => void) { return this.listeners.subscribe(listener); }
    private update(next: Partial<WifiState>) {
        if (this.disposed) return;
        this.state = {...this.state, ...next}; this.listeners.emit();
    }
    private request(request: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (!isWsl()) return this.nativeRequest(request);
        return new Promise((resolve, reject) => {
            const powershell = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
            if (!GLib.file_test(powershell, GLib.FileTest.IS_EXECUTABLE)) { reject(new Error('Windows interop is unavailable. Enable WSL interop to read Wi-Fi.')); return; }
            try {
                const script = new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/bin/dev-os-wifi.ps1`)[1]);
                const payload = GLib.base64_encode(new TextEncoder().encode(JSON.stringify(request)));
                const command = `& {\n${script}\n} -RequestBase64 '${payload}'`;
                const bytes = new Uint8Array(command.length * 2);
                for (let i = 0; i < command.length; i++) { const code = command.charCodeAt(i); bytes[i * 2] = code & 255; bytes[i * 2 + 1] = code >> 8; }
                const process = Gio.Subprocess.new([powershell, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', GLib.base64_encode(bytes)],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                this.process = process;
                let timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => { timeout = 0; process.force_exit(); return GLib.SOURCE_REMOVE; });
                process.communicate_utf8_async(null, null, (_source, result) => {
                    if (timeout) GLib.source_remove(timeout);
                    this.process = null;
                    try {
                        const [, stdout] = process.communicate_utf8_finish(result);
                        const response = JSON.parse((stdout ?? '').replace(/^\uFEFF/, '').trim()) as Record<string, unknown>;
                        if (!process.get_successful() || response.ok !== true) {
                            this.update({accessDenied: response.accessDenied === true});
                            throw new Error(String(response.error ?? 'Windows Wi-Fi request failed.'));
                        }
                        resolve(response);
                    } catch (error) { reject(error); }
                });
            } catch (error) { reject(error); }
        });
    }
    private nativeRequest(request: Record<string, unknown>): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            try {
                const process = Gio.Subprocess.new(['d', nativeWifiHelper()],
                    Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                this.process = process;
                let timedOut = false;
                let timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, request.action === 'connect' ? 50 : 20, () => { timeout = 0; timedOut = true; process.force_exit(); return GLib.SOURCE_REMOVE; });
                process.communicate_utf8_async(JSON.stringify(request), null, (_source, result) => {
                    if (timeout) GLib.source_remove(timeout);
                    this.process = null;
                    try {
                        const [, stdout, stderr] = process.communicate_utf8_finish(result);
                        resolve(parseNativeWifiResponse(stdout, stderr, process.get_successful(), timedOut));
                    } catch (error) { reject(error); }
                });
            } catch (error) { reject(error); }
        });
    }
    async refresh() {
        if (this.state.busy || this.disposed) return;
        this.update({busy: true, error: '', message: '', accessDenied: false});
        try { const response = await this.request({action: 'scan'}); this.update({networks: normalizeWifiNetworks(response.networks), wirelessEnabled: typeof response.wirelessEnabled === 'boolean' ? response.wirelessEnabled : undefined}); }
        catch (error) { this.update({error: String(error)}); }
        finally { this.update({busy: false}); }
    }
    async connect(network: WifiNetwork, password = '') {
        if (this.state.busy || this.disposed) return;
        if (isWsl() && !network.profile) { await this.openWindowsSettings(); return; }
        this.update({busy: true, error: '', message: ''});
        try {
            await this.request({action: 'connect', interfaceId: network.interfaceId, profile: network.profile, ...(!isWsl() ? {ssid: network.ssid, security: network.security, secure: network.secure, password} : {})});
            this.update({busy: false}); await this.refresh();
            this.update({message: `Connected to ${network.ssid}.`});
        } catch (error) { this.update({error: String(error)}); }
        finally { this.update({busy: false}); }
    }
    async setEnabled(enabled: boolean) {
        if (isWsl() || this.state.busy || this.disposed) return;
        this.update({busy: true, error: ''});
        try { await this.request({action: 'radio', enabled}); this.update({busy: false}); await this.refresh(); }
        catch (error) { this.update({error: String(error)}); }
        finally { this.update({busy: false}); }
    }
    async disconnect(network: WifiNetwork) {
        if (isWsl() || this.state.busy || this.disposed) return;
        this.update({busy: true, error: ''});
        try { await this.request({action: 'disconnect', interfaceId: network.interfaceId}); this.update({busy: false}); await this.refresh(); }
        catch (error) { this.update({error: String(error)}); }
        finally { this.update({busy: false}); }
    }
    async openWindowsSettings(page: 'wifi' | 'vpn' | 'hotspot' | 'airplane' | 'proxy' | 'advanced' = 'wifi') {
        if (this.state.busy || this.disposed) return;
        this.update({busy: true, error: ''});
        try { await this.request({action: 'settings', page}); }
        catch (error) { this.update({error: String(error)}); }
        finally { this.update({busy: false}); }
    }
    destroy() { this.disposed = true; this.process?.force_exit(); this.listeners.clear(); }
}
