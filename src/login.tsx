import {Gtk, Gdk, Gio, GLib, React, createRoot, resolveTheme, themeStyle, setActiveTheme} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import {AccountsSettings} from '../extensions/org.devos.settings/accounts-view.js';
import {OSLogin} from '../extensions/org.devos.settings/os-login.js';
import System from 'system';

// An identity chooser before the desktop starts, not a replacement for PAM/greetd.
Gtk.init(null);
const css = new Gtk.CssProvider();
// Nobody has signed in yet, so there are no saved Theme settings: follow the default Auto schedule.
const loginTheme = resolveTheme('auto', new Date());
setActiveTheme(loginTheme);
css.load_from_data(new TextEncoder().encode(themeStyle(new TextDecoder().decode(GLib.file_get_contents(`${ROOT}/extensions/org.devos.theme/style.css`)[1]), loginTheme)));
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default()!, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
const window = new Gtk.Window({title: 'DevOs · Sign in', default_width: 900, default_height: 720});
window.name = 'settings';
window.fullscreen();
const loop = new GLib.MainLoop(null, false);
let accepted = false;
window.connect('delete-event', () => true);
const root = createRoot(window);
const complete = () => {accepted = true; loop.quit();};
root.render(GLib.getenv('GREETD_SOCK') ? <OSLogin onContinue={complete} /> : <AccountsSettings onContinue={complete} />);
// The WSL welcome screen appears before the supervisor's polkit agent starts.
// User creation still needs an administrator prompt at this stage.
let agent: Gio.Subprocess | undefined;
if (!GLib.getenv('GREETD_SOCK') && !GLib.getenv('WSL_DISTRO_NAME') && !GLib.getenv('WSL_INTEROP')) {
    const path = ['/usr/lib/policykit-1-gnome/polkit-gnome-authentication-agent-1', '/usr/libexec/polkit-gnome-authentication-agent-1', 'polkit-gnome-authentication-agent-1'].find(path => GLib.find_program_in_path(path));
    if (path) agent = Gio.Subprocess.new([path], Gio.SubprocessFlags.NONE);
}
window.show_all();
loop.run();
agent?.force_exit();
root.unmount(); window.destroy();
System.exit(accepted ? 0 : 1);
