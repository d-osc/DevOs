import {Gtk, GLib} from '@dev-os/core';
import {subscribePanelMenu, type PanelMenuRow} from '../packages/compat/panel-menu.js';
import {NativeAction} from '../packages/compat/native-action.js';
import {createPreparedPanelMenu} from '../packages/compat/panel-legacy/context-menu.js';
Gtk.init(null);
function assert(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
const wait = (ms: number) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve(); return GLib.SOURCE_REMOVE;}));
async function verify() {
    let rows: PanelMenuRow[] | undefined, invoked = '';
    const values = {menuTerminal: false, contextCustomItems: JSON.stringify([{id: 'custom-test', title: 'Echo', command: `echo '{directory}' 'literal;$(no)'`, enabled: true, target: 'background'}])};
    const data = subscribePanelMenu(values, next => {rows = next;});
    const plans = new NativeAction('src/services/panel-menu-plan.dev');
    try {
        for (let i = 0; i < 200 && !rows; i++) await wait(50);
        assert(rows, 'Native menu data did not arrive');
        const menu = createPreparedPanelMenu(rows, key => {invoked = key;});
        assert(menu.name === 'panel-context-menu' && menu.get_style_context().has_class('desktop-context-menu'), 'Native menu changed styling');
        assert(!menu.get_children().some(row => row.name === 'panel-menu-menuTerminal'), 'Disabled default was rendered');
        (menu.get_children().find(row => row.name === 'panel-menu-custom-test') as Gtk.MenuItem).activate();
        assert(invoked === 'custom-test', 'Prepared custom action did not activate'); menu.destroy();
        const result = await plans.request<{ok: boolean; plan: {kind: string; argv: string[]}}>({values, key: invoked});
        assert(result.plan.kind === 'process' && result.plan.argv[1] === GLib.get_home_dir() && result.plan.argv[2] === 'literal;$(no)', 'Native action plan changed literal arguments');
        let denied = false;try {await plans.run({values: {...values, contextEnabled: false}, key: invoked});} catch {denied = true;}
        assert(denied, 'Stale menu activation ignored latest disable');
        rows = undefined; data.update(values); assert(Boolean(rows), 'Unchanged preference notification lost cached menu');
        data.update({...values, contextEnabled: false});
        const count = () => (rows as PanelMenuRow[] | undefined)?.length;
        for (let i = 0; i < 200 && count() !== 0; i++) await wait(50);
        assert(count() === 0, 'Disabled menu did not receive empty presentation');
        print('PASS DevLang panel menu data, GTK styling/activation, literal action planning, stale-action rejection and cache refresh');
    } finally {data.destroy(); plans.destroy();}
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
