import {testTheme} from './theme-helper.js';
import {Gtk, Gdk, GLib, React, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {AppStoreView} from '../extensions/org.devos.appstore/view.js';
import {AppStoreSettings} from '../extensions/org.devos.appstore/settings.js';
import {AppStore, type StoreControls, type StoreState, type Action} from '../extensions/org.devos.appstore/backend.js';
Gtk.init(null);
const loop = new GLib.MainLoop(null, false);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT,100,()=>{resolve();return GLib.SOURCE_REMOVE;}));
const widgets = (widget: Gtk.Widget): Gtk.Widget[] => [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];
async function test() {
    const real = await new AppStore().request('get'); if (!Array.isArray(real.catalog) || !Array.isArray(real.installed)) throw new Error('Real backend bridge failed');
    const state: StoreState = {available:true,connected:true,installed:[],catalog:[{id:"org.devos.Example",package:"devos-example",name:"Example",description:"Native test app",category:"Creative"}]};
    const actions: Action[]=[];
    const controls: StoreControls = {busy:false, async request(action,id) {
        actions.push(action); const app = state.catalog.find(item=>item.id===id);
        if(action==='install') {if(!app)throw new Error('Unknown app');state.installed=[{...app,version:'1.0'}];}
        if(action==='remove')state.installed=[];
        if(action==='updates')return {...state,updates:[{...state.catalog[0],version:'2.0'}]};
        return {...state};
    }};
    const window=new Gtk.OffscreenWindow();window.name='app-store';window.set_size_request(1100,760);const root=createRoot(window);
    const css=new Gtk.CssProvider();css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!,css,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find=(id:string)=>widgets(window).find(widget=>widget.name===id) as Gtk.Button;
    const click=async(id:string)=>{const widget=find(id);if(!widget)throw new Error(`Missing ${id}`);widget.clicked();await wait();};
    try {
        root.render(<AppStoreView controls={controls}/>);window.show_all();await wait();await wait();
        const screenshot=GLib.getenv('DEV_OS_STORE_SCREENSHOT');if(screenshot)window.get_pixbuf()!.savev(screenshot,'png',[],[]);
        const id=state.catalog[0].id;
        await click(`app-store-app-${id}`);await click('app-store-install');
        if(actions.includes('install'))throw new Error('Install requires confirmation');
        await click('app-store-confirm');if(!find('app-store-open'))throw new Error('Installed state not reflected');
        await click('app-store-remove');await click('app-store-cancel');if(actions.includes('remove'))throw new Error('Cancel must preserve app');
        await click('app-store-remove');await click('app-store-confirm');if(!find('app-store-install'))throw new Error('Removal not reflected');
        await click('app-store-back');(find('app-store-search') as unknown as Gtk.SearchEntry).set_text('no-match-app-123');await wait();
        if(find(`app-store-app-${id}`))throw new Error('Search filter failed');
        (find('app-store-search') as unknown as Gtk.SearchEntry).set_text('');await wait();await click('app-store-tab-updates');await click('app-store-check-updates');
        if(!find(`app-store-app-${id}`))throw new Error('Updates not rendered');
        root.render(<AppStoreView key="native-preview" controls={{busy:false,async request(){return real;}}}/>);await wait();await wait();
        if (!real.catalog.length && widgets(window).some(widget => widget.get_style_context().has_class('app-store-app'))) throw new Error('Unpublished store must not advertise fixture apps');
        const emptyScreenshot=GLib.getenv('DEV_OS_STORE_EMPTY_SCREENSHOT');if(emptyScreenshot)window.get_pixbuf()!.savev(emptyScreenshot,'png',[],[]);
        window.name='settings'; let opened=0;
        root.render(<AppStoreSettings controls={{busy:false,async request(){return {...real,available:false,connected:false};}}} openStore={()=>opened++}/>);await wait();await wait();
        if(find('app-store-settings-updates').sensitive)throw new Error('Unconfigured store must disable update checking');
        await click('app-store-settings-open');if(opened!==1)throw new Error('Settings must open the actual App Store');
        await click('app-store-settings-refresh');if(!find('app-store-settings-status'))throw new Error('Settings status missing');
        const settingsScreenshot=GLib.getenv('DEV_OS_STORE_SETTINGS_SCREENSHOT');if(settingsScreenshot)window.get_pixbuf()!.savev(settingsScreenshot,'png',[],[]);
        root.render(<AppStoreSettings key="ready" controls={controls} openStore={()=>opened++}/>);await wait();await wait();
        if(!find('app-store-settings-updates').sensitive)throw new Error('Configured native store must support update checking');
        await click('app-store-settings-updates');if(actions[actions.length-1]!=='updates')throw new Error('Settings update action not connected');
    } finally {root.unmount();window.destroy();Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!,css);}
    print('PASS: native inventory bridge, browsing, search, install confirmation, remove cancellation and updates');
}
let failure:unknown;void test().catch(error=>{failure=error;}).finally(()=>loop.quit());loop.run();if(failure)throw failure;
