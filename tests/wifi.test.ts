import {Gio, GLib} from '@dev-os/core';
import System from 'system';
import {nativeWifiHelper, normalizeWifiNetworks, parseNativeWifiResponse, WindowsWifi} from '../src/apps/org.devos.settings/wifi.js';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
const network = {ssid: 'Cafe: "ไทย"', profile: '', adapter: 'Test Wi-Fi', interfaceId: '11111111-1111-1111-1111-111111111111',
    signal: 70, secure: true, connected: false, connectable: true};
const actual = normalizeWifiNetworks([network, {...network, signal: 100, connected: true, profile: 'Saved profile'},
    {...network, ssid: 'Other', signal: 120}, {...network, ssid: ''}]);
assert(actual.length === 2 && actual[0].connected && actual[0].profile === 'Saved profile', 'Merge Windows saved/unsaved duplicates and put connected first');
assert(actual[0].ssid === network.ssid && actual[1].signal === 100, 'Preserve Unicode/quotes and clamp signal');
assert(normalizeWifiNetworks([]).length === 0, 'Empty result is valid');
let rejected = false;
try { normalizeWifiNetworks([{...network, interfaceId: 'untrusted argument'}]); } catch { rejected = true; }
assert(rejected, 'Reject invalid interface IDs');
assert(normalizeWifiNetworks([network, {...network, secure: false}]).length === 2, 'Do not merge networks with different security');
print('PASS: Wi-Fi scan normalization, connected/saved profiles, hidden networks, Unicode and invalid data');
assert(parseNativeWifiResponse('\uFEFF{"ok":true,"networks":[]}', '', true).ok === true, 'Native response accepts a BOM');
for (const [stdout, stderr, success, timeout, expected] of [
    ['', 'python3: cannot open Wi-Fi helper', false, false, 'cannot open Wi-Fi helper'],
    ['', '', false, false, 'no valid data'],
    ['not json', '', true, false, 'no valid data'],
    ['null', '', true, false, 'Invalid Linux Wi-Fi response'],
    ['{"ok":false,"error":"No Linux Wi-Fi adapter detected"}', '', false, false, 'No Linux Wi-Fi adapter'],
    ['', '', false, true, 'timed out'],
] as const) {
    let error = '';
    try { parseNativeWifiResponse(stdout, stderr, success, timeout); } catch (reason) { error = String(reason); }
    assert(error.includes(expected) && !error.includes('JSON.parse'), `Native failure should explain ${expected}`);
}
const originalPath = GLib.getenv('PATH') ?? '', directory = GLib.dir_make_tmp('devos-wifi-path-XXXXXX');
const helper = Gio.File.new_for_path(`${directory}/dev-os-network-linux`);
try {
    GLib.file_set_contents(helper.get_path()!, '#!/usr/bin/env python3\n');
    helper.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null);
    GLib.setenv('PATH', directory, true);
    assert(nativeWifiHelper('/nonexistent-devos-runtime') === helper.get_path(), 'Installed runtime resolves the helper from PATH');
    GLib.setenv('PATH', '/nonexistent-devos-bin', true);
    let missing = false;
    try { nativeWifiHelper('/nonexistent-devos-runtime'); } catch (error) { missing = String(error).includes('helper is missing'); }
    assert(missing, 'Missing installed helper gives a readable error');
} finally {
    GLib.setenv('PATH', originalPath, true);
    helper.delete(null); Gio.File.new_for_path(directory).delete(null);
}
print('PASS: installed Wi-Fi helper path, empty/malformed responses, backend errors and timeout diagnostics');

if (GLib.getenv('DEV_OS_TEST_HOST_WIFI') === '1') {
    const loop = new GLib.MainLoop(null, false), wifi = new WindowsWifi();
    let failed = false;
    void wifi.refresh().then(() => {
        if (wifi.state.error) { printerr(wifi.state.error); failed = true; }
        else { print(`PASS: WSL Windows WLAN bridge returned ${wifi.state.networks.length} named networks`); }
    }).catch(error => { printerr(String(error)); failed = true; }).finally(() => { wifi.destroy(); loop.quit(); });
    loop.run();
    if (failed) System.exit(1);
}
