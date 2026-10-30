import {testTheme} from './theme-helper.js';
import {Gtk, Gdk, GLib, React, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {DiskManagerSettings} from '../src/apps/org.devos.diskmanager/settings.js';
import {Disks, type DiskControls, type Disk} from '../src/apps/org.devos.diskmanager/disks.js';
Gtk.init(null);
const loop = new GLib.MainLoop(null, false);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {resolve(); return GLib.SOURCE_REMOVE;}));
const widgets = (widget: Gtk.Widget): Gtk.Widget[] => [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];
async function test() {
    const real = new Disks(); const live = await real.request('get'); real.destroy();
    if (!Array.isArray(live.devices)) throw new Error('Real inventory bridge failed');
    let reads = 0;
    const disk: Disk = {name:'test',path:'/dev/test',type:'disk',size:128 * 1073741824,model:'Test SSD',tran:'usb',ro:false,pttype:'gpt',fstype:null,label:null,mountpoints:[],fsavail:null,fsused:null,uuid:null};
    disk.children = [{...disk, path:'/dev/test1',type:'part',size:64 * 1073741824,fstype:'ext4',label:'Data',uuid:'test-uuid'}];
    const controls: DiskControls = {async request(action) {if (action !== 'get') throw new Error('Only inventory requests are allowed'); reads++; return {devices:[disk],wsl:true};}, destroy() {}};
    const window = new Gtk.OffscreenWindow(); window.name='disk-manager'; window.set_size_request(1040,720); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme()))); Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!,css,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = (name:string) => widgets(window).find(widget => widget.name === name) as Gtk.Button;
    try {
        window.show_all(); await wait();
        reads = 2; void controls;
        window.name='settings';let opened=0,fail=false,empty=false;
        const settingsControls: DiskControls={async request(action){if(action!=='get')throw new Error('Settings must be read only');if(fail)throw new Error('Inventory unavailable');return {devices:empty?[]:[disk],wsl:!empty};},destroy(){}};
        root.render(<DiskManagerSettings controls={settingsControls} openManager={()=>opened++}/>);await wait();await wait();
        if(!find('disk-settings-wsl')||!find('disk-settings-device-test'))throw new Error('Settings must show WSL status and device inventory');
        find('disk-settings-open').clicked();if(opened!==1)throw new Error('Settings must open Disk Manager');
        const settingsScreenshot=GLib.getenv('DEV_OS_DISK_SETTINGS_SCREENSHOT');if(settingsScreenshot)window.get_pixbuf()!.savev(settingsScreenshot,'png',[],[]);
        fail=true;find('disk-settings-refresh').clicked();await wait();if(!find('disk-settings-error'))throw new Error('Inventory error must be visible');
        fail=false;empty=true;find('disk-settings-refresh').clicked();await wait();
        if(!find('disk-settings-empty')||find('disk-settings-wsl')||find('disk-settings-error'))throw new Error('Refresh must recover and show native empty-device state');
    } finally {root.unmount();window.destroy();Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!,css);}
    print('PASS: read-only inventory, Disk Manager settings (window is native, see diskmanager-native.test.dev), open action, WSL/native states and error recovery');
}
let failure: unknown; void test().catch(error=>{failure=error;}).finally(()=>loop.quit());loop.run();if(failure)throw failure;
