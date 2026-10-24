import {Gio, GLib} from '@dev-os/core';
import {SystemProxy} from '../extensions/org.devos.settings/network-settings.js';
async function verify() {
    const proxy = new SystemProxy(), original = proxy.load();
    try {
        proxy.save({...original, mode:'manual', http:'127.0.0.1', httpPort:3128, https:'', socks:'', same:true, authentication:false, username:'', password:'', bypass:['localhost']});
        await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT,200,() => {resolve(); return GLib.SOURCE_REMOVE;}));
        const result = Gio.ProxyResolver.get_default().lookup('http://example.org',null);
        if (result[0] !== 'http://127.0.0.1:3128') throw new Error('DevOs proxy resolver did not read system settings.');
        const direct = Gio.ProxyResolver.get_default().lookup('http://localhost',null);
        if (direct[0] !== 'direct://') throw new Error('Proxy bypass did not apply.');
        const pac = GLib.getenv('DEVOS_PROXY_PAC_URL');
        if (pac) {
            proxy.save({...original,mode:'auto',pac,bypass:[]});
            await new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT,200,() => {resolve(); return GLib.SOURCE_REMOVE;}));
            const automatic = Gio.ProxyResolver.get_default().lookup('http://example.org',null);
            if (automatic[0] !== 'http://127.0.0.1:3129') throw new Error('PAC script was not used.');
            print('PASS: automatic PAC download and JavaScript proxy selection');
        }
        print('PASS: persistent DevOs proxy settings, GIO resolution and bypass; original preferences restored');
    } finally {proxy.save(original);}
}
if (GLib.getenv('DEVOS_NETWORK_INTEGRATION') === '1') {const loop = new GLib.MainLoop(null,false); let failed:unknown; void verify().catch(error => {failed=error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;}
else print('SKIP: opt-in DevOs proxy integration');
