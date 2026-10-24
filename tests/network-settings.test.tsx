import {React, Gtk, Gio, GLib, createRoot} from '@dev-os/core';
import {NetworkSettings, networkPages} from '../extensions/org.devos.settings/network-view.js';
import {NativeNetworkSettings} from '../extensions/org.devos.settings/network-pages.js';
import {ProxySettings} from '../extensions/org.devos.settings/proxy-view.js';
import {SystemProxy, validateProxy, type ProxyValues, type NetworkSnapshot} from '../extensions/org.devos.settings/network-settings.js';
import type {InputControls} from '../extensions/org.devos.settings/input-view.js';
GLib.setenv('GSETTINGS_BACKEND','memory',true); GLib.setenv('GIO_USE_PROXY_RESOLVER','gnome',true);
// The host module is upstream; the DevOs image patch also accepts DevOS alone.
GLib.setenv('XDG_CURRENT_DESKTOP','DevOS:GNOME',true); Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT,120,() => {resolve(); return GLib.SOURCE_REMOVE;}));
function assert(value: unknown, message: string) {if (!value) throw new Error(message);}
function widgets(w: Gtk.Widget): Gtk.Widget[] {return [w,...(w instanceof Gtk.Container ? w.get_children().flatMap(widgets) : [])];}
async function verify() {
    const window = new Gtk.OffscreenWindow(), root = createRoot(window); window.set_size_request(900,800);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(w => w.name === id) as T;
    let routed = '', last: Record<string,unknown> = {}, failure = false;
    const state: NetworkSnapshot = {available:true, connectivity:4, airplane:false, radios:[{id:1,type:'wlan',device:'phy0',soft:'unblocked',hard:'unblocked'}], profiles:[{id:'test',path:'/profile',name:'Work VPN',type:'wireguard',activePath:'',active:false,hotspot:false,ownHotspot:false}],adapters:[{path:'/adapter',name:'test0',type:2,state:100,managed:true,mtu:1500,mac:'00:11:22:33:44:55',driver:'test',ap:true,ipv4:{addresses:['192.0.2.10/24'],dns:['192.0.2.1'],gateway:'192.0.2.1'},ipv6:{addresses:[],dns:[],gateway:''}}]};
    const controls: InputControls = {async request<T>(request: Record<string,unknown>) {last=request; if (failure) throw new Error('Test authorization denied'); return {...state, airplane:request.enabled ?? false} as T;},destroy() {}};
    const show = async (page: 'vpn'|'hotspot'|'airplane'|'advanced') => {root.render(<NativeNetworkSettings key={page} page={page} controls={controls} back={() => {routed='network';}}/>); window.show_all(); await wait();};
    try {
        root.render(<NetworkSettings page="network" navigate={id => {routed=id;}}/>); await wait();
        for (const page of networkPages) {const button=find<Gtk.Button>(`network-category-${page.id}`); assert(button.get_sensitive(), 'Every native category is enabled'); button.emit('clicked'); assert(routed === page.id,'Network category routes internally');}
        await show('vpn'); assert(last.action === 'list','VPN opens without modifying profiles'); find<Gtk.Button>('vpn-toggle-test').emit('clicked'); await wait(); assert(!find<Gtk.Entry>('vpn-password').get_visibility(),'VPN password is masked'); find<Gtk.Entry>('vpn-password').set_text('secret'); await wait(); find<Gtk.Button>('vpn-connect-confirm').emit('clicked'); await wait(); assert(last.action === 'vpn-connect' && last.password === 'secret' && !find('vpn-password'),'Connect forwards credentials and clears the form on success');
        find<Gtk.Button>('vpn-remove-test').emit('clicked'); await wait(); assert(last.action !== 'vpn-remove','Removing a profile needs confirmation'); find<Gtk.Button>('vpn-remove-confirm').emit('clicked'); await wait(); assert(last.action === 'vpn-remove','Confirmed removal uses the selected profile');
        await show('hotspot'); const suggested=find<Gtk.Entry>('hotspot-password').get_text(); assert(/^[A-Za-z0-9]{12}$/.test(suggested) && find<Gtk.Button>('hotspot-start').get_sensitive(),'Hotspot suggests a random 12-character password'); assert(!find<Gtk.Entry>('hotspot-password').get_visibility(),'Hotspot password is masked'); find<Gtk.Entry>('hotspot-password').set_text(''); await wait(); assert(!find<Gtk.Button>('hotspot-start').get_sensitive(),'Hotspot requires a password'); find<Gtk.Entry>('hotspot-password').set_text('good password'); await wait(); find<Gtk.Button>('hotspot-start').emit('clicked'); await wait(); assert(last.action === 'hotspot-start' && last.device === '/adapter','Hotspot uses the chosen AP-capable adapter');
        state.adapters[0].ap=false; await show('vpn'); await show('hotspot'); assert(find<Gtk.Label>('hotspot-unsupported').get_text().includes('(driver test) does not report access point mode') && !find('hotspot-start'),'Adapter without AP mode explains why the hotspot is unavailable'); state.adapters[0].ap=true; await show('airplane'); find<Gtk.Switch>('airplane-enabled').active=true; await wait(); assert(last.action === 'airplane' && last.enabled === true,'Airplane switch requests a real radio change');
        await show('advanced'); assert(find<Gtk.Label>('network-connectivity').get_text() === 'Internet connected','Advanced page shows connectivity'); find<Gtk.Button>('adapter-action-test0').emit('clicked'); await wait(); assert(last.action === 'list','Adapter disconnect waits for confirmation'); find<Gtk.Button>('adapter-action-confirm').emit('clicked'); await wait(); assert(last.action === 'adapter-disconnect','Confirmed adapter disconnect reaches backend');
        failure=true; find<Gtk.Button>('network-check').emit('clicked'); await wait(); assert(find<Gtk.Label>('native-network-error').get_text().includes('authorization denied'),'Backend failure remains visible'); failure=false;
        const original = {...state,adapters:[],radios:[]}; const noHardware: InputControls = {async request<T>() {return original as T;},destroy() {}};
        root.render(<NativeNetworkSettings key="no-radio" page="airplane" controls={noHardware} back={() => {}}/>); await wait(); assert(!find<Gtk.Switch>('airplane-enabled').get_sensitive(),'Missing radios do not create a functional-looking fake switch');
        let proxy: ProxyValues={mode:'none',pac:'',http:'',httpPort:8080,https:'',httpsPort:8080,socks:'',socksPort:1080,bypass:['localhost']}, saves=0;
        root.render(<ProxySettings back={() => {}} controls={{load() {return proxy;},save(value) {validateProxy(value); proxy=value; saves++;}}}/>); await wait();
        find<Gtk.ComboBoxText>('proxy-mode').set_active_id('auto'); await wait(); find<Gtk.Entry>('proxy-pac').set_text('bad-url'); await wait(); find<Gtk.Button>('proxy-apply').emit('clicked'); await wait(); assert(saves === 0 && find<Gtk.Label>('proxy-error'),'Invalid PAC URL does not save');
        find<Gtk.Entry>('proxy-pac').set_text('https://example.org/proxy.pac'); find<Gtk.Entry>('proxy-bypass').set_text('localhost, '); await wait(); assert(find<Gtk.Entry>('proxy-bypass').get_text() === 'localhost, ','Bypass input preserves the comma while typing'); find<Gtk.Entry>('proxy-bypass').set_text('localhost, *.local'); await wait(); find<Gtk.Button>('proxy-apply').emit('clicked'); await wait(); assert(saves === 1 && proxy.bypass[1] === '*.local','Valid proxy applies user preferences');
        // A memory GSettings backend keeps this integration check off host preferences.
        const system = new SystemProxy(); const initial=system.load();
        try {system.save({...initial,mode:'manual',http:'127.0.0.1',httpPort:3128,https:'',socks:'',bypass:['localhost']}); assert(system.load().httpPort === 3128,'System proxy values round-trip through GSettings'); const resolved=Gio.ProxyResolver.get_default().lookup('http://example.org',null); assert(resolved[0] === 'http://127.0.0.1:3128','GIO actually uses the configured proxy');} finally {system.save(initial);}
        print('PASS: Five native network pages, actions, confirmations, secrets, empty hardware, proxy validation and real GIO proxy resolution');
    } finally {root.unmount(); window.destroy();}
}
const loop=new GLib.MainLoop(null,false); let failed: unknown; void verify().catch(error => {failed=error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
