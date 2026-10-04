import {Gtk} from '../../src/gtk.js';
import {ROOT, readText} from '../../src/config.js';
import type {UIExtension} from '../../src/extensions/runtime.js';

export default {id: 'org.devos.theme', activate(context) {
    let provider: Gtk.CssProvider | undefined;
    const screen = context.display.get_default_screen();
    const load = () => {
        const next = new Gtk.CssProvider();
        const style = readText(`${ROOT}/extensions/org.devos.theme/style.css`).replaceAll('@ACCENT@', context.config().accent);
        next.load_from_data(new TextEncoder().encode(style));
        if (provider) Gtk.StyleContext.remove_provider_for_screen(screen, provider);
        Gtk.StyleContext.add_provider_for_screen(screen, next, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        provider = next;
    };
    load(); context.onReload(load);
    return () => { if (provider) Gtk.StyleContext.remove_provider_for_screen(screen, provider); };
}} satisfies UIExtension;
