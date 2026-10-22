import {React, Gtk, GLib, createRoot} from '@dev-os/core';
import {OSLogin, type GreeterControls} from '../extensions/org.devos.settings/os-login.js';
import {UsersSettings} from '../extensions/org.devos.settings/users-view.js';
import {NewUserWizard} from '../extensions/org.devos.settings/new-user.js';
import {SwitchUserView} from '../extensions/org.devos.settings/switch-user.js';
Gtk.init(null);
const wait = () => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 70, () => {resolve(); return GLib.SOURCE_REMOVE;}));
function widgets(widget: Gtk.Widget): Gtk.Widget[] {return [widget, ...(widget instanceof Gtk.Container ? widget.get_children().flatMap(widgets) : [])];}
async function verify() {
    const window = new Gtk.OffscreenWindow(); const root = createRoot(window);
    const find = <T extends Gtk.Widget>(id: string) => widgets(window).find(widget => widget.name === id) as T;
    let selected = '', credential = '', completed = 0, released = 0, created: Record<string, unknown> = {};
    const users = [{username: 'alice', name: 'Alice', uid: 1001, home: '/home/alice'}];
    const controls: GreeterControls = {async request(action, data) {if (action === 'get') return {users}; const request = data as {username: string; password: string}; selected = request.username; credential = request.password; return {started: true};}, destroy() {released++;}};
    const enrollment: GreeterControls = {async request(action, data) {created = {action, ...data}; return {created: true, username: 'bob'};}, destroy() {}};
    try {
        root.render(<OSLogin controls={controls} createEnrollmentControls={() => enrollment} onContinue={() => completed++} />); window.show_all(); await wait();
        if (find<Gtk.ComboBoxText>('os-login-user').get_active_id() !== 'alice') throw new Error('Personal user selection must load');
        find<Gtk.Button>('os-login-new-user').emit('clicked'); await wait();
        if (!find('new-user-github') || !find('new-user-guest')) throw new Error('New user must offer GitHub and Guest after first setup');
        find<Gtk.Button>('os-login-new-user').emit('clicked'); await wait();
        if (find<Gtk.Button>('os-login-local').get_sensitive()) throw new Error('Empty local password must not submit');
        find<Gtk.Entry>('os-login-password').set_text('private-password'); await wait();
        if (find<Gtk.Entry>('os-login-password').get_visibility()) throw new Error('Password must stay hidden');
        find<Gtk.Button>('os-login-local').emit('clicked'); await wait();
        if (completed !== 1 || selected !== 'alice' || credential !== 'private-password') throw new Error('OS sign-in must use selected username and credential');
        root.render(<UsersSettings createEnrollmentControls={() => enrollment} system={{available: true, currentUser: 'alice', users, firstSetup: false}} busy={false} perform={async () => {}} />); await wait();
        find<Gtk.Button>('accounts-add-user').emit('clicked'); await wait();
        find<Gtk.Button>('new-user-guest').emit('clicked'); await wait();
        find<Gtk.Entry>('accounts-new-username').set_text('bob');
        find<Gtk.Entry>('accounts-new-name').set_text('Bob');
        find<Gtk.Entry>('accounts-new-password').set_text('2468');
        find<Gtk.Entry>('accounts-new-confirm').set_text('mismatch'); await wait();
        if (find<Gtk.Button>('accounts-create-user').get_sensitive()) throw new Error('Password confirmation must match');
        find<Gtk.Entry>('accounts-new-confirm').set_text('2468'); await wait();
        find<Gtk.Button>('accounts-create-user').emit('clicked'); await wait();
        if (created.action !== 'enroll-create' || created.provider !== 'guest' || created.username !== 'bob' || created.password !== '2468') throw new Error('Create user must accept four-character OS passwords');
        if (find('accounts-new-password')) throw new Error('Successful creation closes the password form');
        let githubCreated = '', browserOpened = 0;
        const githubEnrollment: GreeterControls = {async request(action, data) {
            if (action === 'enroll-begin') return {code: '1234-5678', interval: 5};
            if (action === 'enroll-poll') return {verified: true, github: 'n-devs', username: 'n-devs'};
            created = {action, ...data}; return {created: true, username: 'n-devs'};
        }, destroy() {}};
        root.render(<NewUserWizard createControls={() => githubEnrollment} openAuthorization={() => browserOpened++} onCreated={username => {githubCreated = username;}} />); await wait();
        find<Gtk.Button>('new-user-github').emit('clicked'); await wait();
        if (!find('new-user-code') || find('accounts-new-password') || browserOpened !== 1) throw new Error('GitHub authorization must precede OS password setup');
        const deadline = GLib.get_monotonic_time() + 9_000_000;
        while (!find('new-user-verified') && GLib.get_monotonic_time() < deadline) await wait();
        if (!find<Gtk.Label>('new-user-os-name')?.get_text().includes('n-devs') || find('accounts-new-username')) throw new Error('Verified GitHub username must set the OS username');
        find<Gtk.Entry>('accounts-new-password').set_text('github-local-password');
        find<Gtk.Entry>('accounts-new-confirm').set_text('github-local-password'); await wait();
        find<Gtk.Button>('accounts-create-user').emit('clicked'); await wait();
        if (githubCreated !== 'n-devs' || String(created.provider) !== 'github' || String(created.username) !== 'n-devs') throw new Error('GitHub enrollment must create the verified OS profile');
        let switched = '';
        root.render(<SwitchUserView controls={{async request() {return {system: {available: true, currentUser: 'alice', users: [...users, {username: 'bob', name: 'Bob', uid: 1002, home: '/home/bob'}], firstSetup: false}};}, destroy() {}}} initialUser="bob" wsl switchUser={async username => {switched = username;}} cancel={() => {}} />); await wait();
        if (find<Gtk.ComboBoxText>('switch-user-choice').get_active_id() !== 'bob') throw new Error('Switch user dialog must preserve the selected OS user');
        find<Gtk.Button>('switch-user-confirm').emit('clicked'); await wait();
        if (switched !== 'bob') throw new Error('Switch confirmation must request the selected OS user');
    } finally {root.unmount(); window.destroy();}
    if (released !== 1) throw new Error('Greeter backend cleanup');
    print('PASS: OS login user selection, local authentication, password privacy and user creation UI');
}
const loop = new GLib.MainLoop(null, false); let failed: unknown;
void verify().catch(error => {failed = error;}).finally(() => loop.quit()); loop.run(); if (failed) throw failed;
