import React from 'react';
import {Gtk} from './native.js';
import {Image} from './view.js';
import {createRoot} from './renderer.js';

export interface WindowHeaderOptions {
    title: string;
    iconName: string;
    windowIconName?: string;
    iconId?: string;
}

// Attach after createRoot(window), before the window is first shown.
export function mountWindowHeader(window: Gtk.ApplicationWindow, options: WindowHeaderOptions) {
    const titlebar = new Gtk.HeaderBar({title: options.title, show_close_button: true,
        has_subtitle: false, decoration_layout: ':minimize,maximize,close'});
    titlebar.get_style_context().add_class('app-titlebar');
    const iconHost = new Gtk.Box(), iconRoot = createRoot(iconHost);
    iconRoot.render(React.createElement(Image, {id: options.iconId,
        iconName: options.iconName, pixelSize: 18, tooltip: options.title}));
    titlebar.pack_start(iconHost);
    window.set_icon_name(options.windowIconName ?? options.iconName);
    // HeaderBar has no event window; this host keeps right-click gestures working
    // on the title text and empty space, including maximized windows.
    const eventHost = new Gtk.EventBox();
    eventHost.add(titlebar);
    window.set_titlebar(eventHost);
    titlebar.set_title(window.get_title() || options.title);
    const titleSignal = window.connect('notify::title', () => titlebar.set_title(window.get_title() || options.title));
    const gesture = new Gtk.GestureMultiPress({widget: eventHost, button: 3});
    gesture.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    const signal = gesture.connect('pressed', () => {
        const event = gesture.get_last_event(gesture.get_current_sequence());
        if (event && window.get_window()?.show_window_menu(event))
            gesture.set_state(Gtk.EventSequenceState.CLAIMED);
    });
    // Theme extensions can override this fallback at APPLICATION priority.
    const style = new Gtk.CssProvider();
    style.load_from_data(`
        .app-titlebar { background: #192a35; color: #e8f0f4;
          border-bottom: 1px solid #426b67; border-radius: 8px 8px 0 0;
          padding: 5px 8px; box-shadow: none; min-height: 24px; }
        .app-titlebar button { background: transparent; border-color: transparent; padding: 4px 6px; }
        .app-titlebar button:hover { background: #304650; }
        .app-titlebar image { color: #80cbc4; }
    `);
    const screen = window.get_screen();
    Gtk.StyleContext.add_provider_for_screen(screen, style, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION - 1);
    // Keep native controls identical in every app, including non-tabbed headers.
    // App body styles and GTK themes can otherwise turn the close button circular.
    const controls = new Gtk.CssProvider();
    controls.load_from_data(`
        .app-titlebar button.titlebutton {
          background: transparent; background-image: none; color: #a6b7c8;
          border: 1px solid transparent; border-radius: 6px;
          box-shadow: none; text-shadow: none;
          min-height: 16px; min-width: 16px; padding: 3px 4px; margin: 0; }
        .app-titlebar button.titlebutton image { color: #a6b7c8; }
        .app-titlebar button.titlebutton:hover { background: #303b49; }
        .app-titlebar button.titlebutton.close:hover { background: #ba4f5c; }
        .app-titlebar button.titlebutton.close:hover image { color: #ffffff; }
    `);
    Gtk.StyleContext.add_provider_for_screen(screen, controls, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1);
    eventHost.show_all();
    let destroyed = false;
    return {titlebar, destroy: () => {
        if (destroyed) return;
        destroyed = true;
        window.disconnect(titleSignal);
        gesture.disconnect(signal);
        gesture.reset();
        iconRoot.unmount();
        Gtk.StyleContext.remove_provider_for_screen(screen, style);
        Gtk.StyleContext.remove_provider_for_screen(screen, controls);
    }};
}
