import {testTheme} from './theme-helper.js';
import {React, Gtk, Gdk, GLib, createRoot} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {AccountsSettings} from '../src/apps/org.devos.settings/accounts-view.js';
import type {AccountControls} from '../src/apps/org.devos.settings/accounts.js';
import type {GreeterControls} from '../src/apps/org.devos.settings/os-login.js';
Gtk.init(null);
const loop = new GLib.MainLoop(null, false);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 70, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
async function test() {
    const actions: string[] = []; let continued = 0, released = 0, created: object | undefined;
    const githubId = GLib.getenv('DEV_OS_TEST_AVATAR') ? 25478539 : undefined;
    const controls: AccountControls = {async request(action, clientId) {actions.push(action); return {identity: {provider: 'guest', name: 'Guest'}, clientId: clientId ?? 'configured', system: {available: true, currentUser: 'alice', users: [{username: 'alice', name: 'Alice', uid: 1001, home: '/home/alice', githubId}, ...(created ? [{username: 'bob', name: 'Bob', uid: 1002, home: '/home/bob'}] : [])], firstSetup: false}};}, destroy() {released++;}};
    const enrollment: GreeterControls = {async request(action, data) {if (action === 'enroll-create') {created = data; return {created: true, username: 'bob'};} return {};}, destroy() {}};
    const window = new Gtk.OffscreenWindow(); window.name = 'settings'; window.set_size_request(1280, 720); const root = createRoot(window);
    const css = new Gtk.CssProvider(); css.load_from_data(new TextEncoder().encode(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/src/apps/org.devos.theme/style.css`)[1]).replace(/^/, testTheme())));
    Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    try {
        root.render(<AccountsSettings controls={controls} createEnrollmentControls={() => enrollment} onContinue={() => continued++} />); window.show_all(); await wait();
        if (!find('login-profile-alice') || !find<Gtk.Button>('accounts-guest').get_sensitive()) throw new Error('Saved OS profiles and current-user continuation must be available');
        await wait(); await wait(); await wait();
        if (githubId) {
            const deadline = GLib.get_monotonic_time() + 15_000_000;
            const loaded = () => widgets(window).some(widget => widget instanceof Gtk.Image && widget.get_style_context().has_class('account-avatar') && widget.get_storage_type() === Gtk.ImageType.PIXBUF);
            while (!loaded() && GLib.get_monotonic_time() < deadline) await wait();
            if (!loaded()) throw new Error('Real GitHub avatar must download and decode into a GTK pixbuf');
        }
        const screenshot = GLib.getenv('DEV_OS_TEST_SCREENSHOT'); if (screenshot) window.get_pixbuf()!.savev(screenshot, 'png', [], []);
        find<Gtk.Button>('login-new-user').emit('clicked'); await wait();
        find<Gtk.Button>('new-user-guest').emit('clicked'); await wait();
        if (!find('accounts-new-username')) throw new Error('New user must open creation directly from the WSL login screen');
        find<Gtk.Entry>('accounts-new-username').set_text('bob');
        find<Gtk.Entry>('accounts-new-password').set_text('offline-password');
        find<Gtk.Entry>('accounts-new-confirm').set_text('offline-password'); await wait();
        find<Gtk.Button>('accounts-create-user').emit('clicked'); await wait();
        if (!created || !find('login-notice') || find('accounts-new-username')) throw new Error('Creating user must submit, return to login and display completion');
        if (!find('login-profile-bob') || find<Gtk.Button>('accounts-guest').get_sensitive()) throw new Error('New OS user must appear without pretending the WSL UID has switched');
        find<Gtk.Button>('login-profile-alice').emit('clicked'); await wait();
        find<Gtk.Button>('accounts-guest').emit('clicked'); await wait();
        if (continued !== 1 || !actions.includes('guest')) throw new Error('Guest must complete chooser');
        let switched = '';
        root.render(<AccountsSettings controls={controls} switchUser={username => {switched = username ?? '';}} />); await wait();
        if (!find('accounts-name') || !find('accounts-refresh')) throw new Error('Accounts profile and refresh controls must render');
        find<Gtk.Button>('accounts-switch-bob').emit('clicked');
        if (switched !== 'bob') throw new Error('Redesigned user row must preserve OS switch action');
        const accountScreenshot = GLib.getenv('DEV_OS_TEST_ACCOUNTS_SCREENSHOT');
        if (accountScreenshot) {window.set_size_request(800, 950); await wait(); await wait(); window.get_pixbuf()!.savev(accountScreenshot, 'png', [], []);}

    } finally {root.unmount(); window.destroy(); Gtk.StyleContext.remove_provider_for_screen(Gdk.Screen.get_default()!, css);}
    if (released !== 1) throw new Error('Backend not released');
    print('PASS: Accounts sign-in, Guest login and cleanup');
}
let failure: unknown; void test().catch(error => {failure = error;}).finally(() => loop.quit()); loop.run(); if (failure) throw failure;
