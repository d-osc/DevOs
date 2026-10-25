import {Gtk, GLib, readText} from '@dev-os/core';
import {ROOT} from '@dev-os/config';

Gtk.init(null);
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
let count = 0;
function test(name: string, body: () => void) { body(); count++; print(`PASS: ${name}`); }
const read = (path: string) => readText(`${ROOT}/${path}`);

test('the master mark keeps the official shapes', () => {
    const master = read('data/icons/devos/devos-mark.svg');
    for (const part of ['viewBox="0 0 100 100"', '<rect width="100" height="100" fill="#242424" />', '<rect x="22" y="32" width="40" height="32" rx="2" fill="#EAEAEA" />', '<circle cx="81" cy="67" r="5" fill="#EAEAEA" />'])
        assert(master.includes(part), `master SVG lost ${part}`);
});
test('the icon theme carries the app icon and a monochrome symbolic variant', () => {
    assert(read('data/icons/hicolor/scalable/apps/dev-os.svg') === read('data/icons/devos/devos-mark.svg'), 'dev-os.svg is the master');
    const symbolic = read('data/icons/hicolor/scalable/apps/dev-os-symbolic.svg');
    assert(!symbolic.includes('#242424') && !symbolic.includes('<rect width="100"'), 'symbolic mark has no background');
    assert(!symbolic.includes('#EAEAEA') && symbolic.includes('#2e3436'), 'symbolic mark uses the symbolic colour');
    const themed = read('data/icons/devos/devos-mark-currentcolor.svg');
    assert(themed.includes('fill="currentColor"') && !themed.includes('#242424'), 'theme-aware mark follows the foreground colour');
});
test('the greeter mark has a transparent background', () => {
    const mark = read('data/icons/devos/devos-mark-transparent.svg');
    assert(!mark.includes('#242424') && mark.includes('#EAEAEA'), 'transparent mark keeps the light shapes only');
    assert(read('extensions/org.devos.settings/login-view.tsx').includes('devos-mark-transparent.svg'), 'greeter uses it');
});
test('PNG sizes exist for the app icon', () => {
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) assert(GLib.file_test(`${ROOT}/data/icons/hicolor/${size}x${size}/apps/dev-os.png`, GLib.FileTest.EXISTS), `${size}px PNG`);
});
test('the shell shows the mark where it used to show placeholders', () => {
    for (const file of ['extensions/org.devos.settings/login-view.tsx', 'extensions/org.devos.settings/os-login.tsx']) assert(read(file).includes('brandIcon') && !read(file).includes('login-brand">D<'), `${file} greeter mark`);
    assert(read('extensions/org.devos.installer/extension.tsx').includes('iconName="dev-os"'), 'installer sidebar mark');
    assert(read('extensions/org.devos.launcher/view.tsx').includes('dev-os-symbolic'), 'launcher header mark');
    assert(read('extensions/org.devos.panel/view.tsx').includes('iconName="dev-os-symbolic"'), 'panel menu button mark');
    assert(read('extensions/org.devos.settings/about-view.tsx').includes('iconName="dev-os"'), 'About mark');
    assert(read('distro/oe/meta-devos/recipes-devos/splash/files/devos-splash.c').includes('static void mark('), 'boot splash mark');
});
print(`devos-icon test: ${count} checks passed`);
