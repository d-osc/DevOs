import React from 'react';
import Cairo from 'cairo';
import {Gtk, Gio, Gdk} from './native.js';
import {Image} from './view.js';
import {createRoot} from './renderer.js';
import {baseImage, releaseImageIcons} from './base-icons.js';
import {activeFamily, activeTheme, onThemeChange, themeTokens} from './theme.js';
import {roundedOpaqueRegion} from './window-shape.js';

export interface WindowHeaderOptions {
    title: string;
    iconName: string;
    windowIconName?: string;
    iconId?: string;
}

// Attach after createRoot(window), before the window is first shown.
export function mountWindowHeader(window: Gtk.ApplicationWindow, options: WindowHeaderOptions) {
    // GTK removes theme corner rounding when a window becomes tiled. Clip the
    // whole client surface so the body and header keep the same rounded edge.
    const visual = window.get_screen().get_rgba_visual();
    if (visual && !window.get_realized()) window.set_visual(visual);
    window.get_style_context().add_class('devos-rounded-window');
    let opaqueSignature = '';
    const roundSignal = window.connect('draw', (_widget, cr) => {
        try {
            const state = window.get_window()?.get_state() ?? 0;
            if (state & (Gdk.WindowState.MAXIMIZED | Gdk.WindowState.FULLSCREEN)) return false;
            // Gtk.Window allocations include invisible CSD shadow margins. Round
            // the visible client rectangle, rather than those transparent margins.
            const body = window.get_child()?.get_allocation(), header = window.get_titlebar()?.get_allocation();
            if (!body || !header) return false;
            const x = Math.min(body.x, header.x), y = Math.min(body.y, header.y);
            const width = Math.max(body.x + body.width, header.x + header.width) - x;
            const height = Math.max(body.y + body.height, header.y + header.height) - y;
            const radius = Math.min(10, width / 2, height / 2);
            cr.setOperator(Cairo.Operator.SOURCE); cr.setSourceRGBA(0, 0, 0, 0); cr.paint(); cr.setOperator(Cairo.Operator.OVER);
            // Clip the native draw directly: a full-window intermediate group costs
            // an extra buffer and blend on every repaint, especially on CPU rendering.
            cr.save();
            cr.newPath();
            cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
            cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
            cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
            cr.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
            cr.closePath(); cr.clip();
            Gtk.ApplicationWindow.prototype.vfunc_draw.call(window, cr);
            cr.restore();
            // Keep the rounded corners transparent without making the *entire*
            // window translucent to the compositor. Transparent themes opt out.
            const opaque = window.get_opacity() === 1 && window.get_style_context().get_background_color(Gtk.StateFlags.NORMAL).alpha === 1
                && titlebar.get_style_context().get_background_color(Gtk.StateFlags.NORMAL).alpha === 1;
            const signature = `${x},${y},${width},${height},${radius},${opaque}`;
            if (signature !== opaqueSignature) {
                window.get_window()?.set_opaque_region(roundedOpaqueRegion(x, y, width, height, radius, opaque));
                opaqueSignature = signature;
            }
            return true;
        } finally {
            // The GJS wrapper holds the native target surface alive until GC.
            // Release it at the signal boundary, including early returns/errors.
            cr.$dispose();
        }
    });
    const roundStateSignal = window.connect('window-state-event', () => {opaqueSignature = ''; window.queue_draw(); return false;});
    const roundStyleSignal = window.connect('style-updated', () => {opaqueSignature = '';});
    const titlebar = new Gtk.HeaderBar({title: options.title, show_close_button: true,
        has_subtitle: false, decoration_layout: ':minimize,maximize,close'});
    titlebar.get_style_context().add_class('app-titlebar');
    const iconHost = new Gtk.Box(), iconRoot = createRoot(iconHost);
    iconRoot.render(React.createElement(Image, {id: options.iconId,
        iconName: options.iconName, pixelSize: 18, tooltip: options.title}));
    titlebar.pack_start(iconHost);
    const snapButton = new Gtk.Button({image: baseImage('view-grid-symbolic', 14), tooltip_text: 'Snap Layouts - Super+Z', focus_on_click: false});
    // Use the same compact, flat styling as Settings' window controls. Without
    // titlebutton, app body button rules and GTK defaults leak into this control.
    snapButton.get_style_context().add_class('titlebutton');
    snapButton.get_style_context().add_class('snap-layout-button');
    snapButton.connect('clicked', () => {try {Gio.Subprocess.new(['dev-os-shell', 'snap-layouts'], Gio.SubprocessFlags.NONE);} catch (error) {printerr(String(error));}});
    titlebar.pack_end(snapButton);
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
    const loadStyle = () => style.load_from_data(`${themeTokens(activeTheme(), activeFamily())}
        .app-titlebar { background: @dv_s1; color: @dv_fg;
          border-bottom: 1px solid @dv_line0; border-radius: 8px 8px 0 0;
          padding: 5px 8px; box-shadow: none; min-height: 24px; }
        .app-titlebar button { background: transparent; border-color: transparent; padding: 4px 6px; }
        .app-titlebar button:hover { background: @dv_hover; }
        .app-titlebar image { color: @dv_fg_muted; }
    `);
    loadStyle();
    const screen = window.get_screen();
    Gtk.StyleContext.add_provider_for_screen(screen, style, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION - 1);
    // Keep native controls identical in every app, including non-tabbed headers.
    // App body styles and GTK themes can otherwise turn the close button circular.
    const controls = new Gtk.CssProvider();
    const loadControls = () => controls.load_from_data(`${themeTokens(activeTheme(), activeFamily())}
        .app-titlebar button.titlebutton {
          background: transparent; background-image: none; color: @dv_fg_muted;
          border: 1px solid transparent; border-radius: 6px;
          box-shadow: none; text-shadow: none;
          min-height: 16px; min-width: 16px; padding: 3px 4px; margin: 0; }
        .app-titlebar button.titlebutton image { color: @dv_fg_muted; }
        .app-titlebar button.titlebutton:hover { background: @dv_hover; }
        .app-titlebar button.titlebutton.close:hover { background: @dv_red; }
        .app-titlebar button.titlebutton.close:hover image { color: @dv_on_accent; }
    `);
    loadControls();
    const unwatchTheme = onThemeChange(() => { loadStyle(); loadControls(); });
    Gtk.StyleContext.add_provider_for_screen(screen, controls, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1);
    eventHost.show_all();
    let destroyed = false;
    return {titlebar, destroy: () => {
        if (destroyed) return;
        destroyed = true;
        window.disconnect(titleSignal);
        window.disconnect(roundSignal);
        window.disconnect(roundStateSignal);
        window.disconnect(roundStyleSignal);
        gesture.disconnect(signal);
        gesture.reset();
        unwatchTheme();
        releaseImageIcons(snapButton);
        iconRoot.unmount();
        Gtk.StyleContext.remove_provider_for_screen(screen, style);
        Gtk.StyleContext.remove_provider_for_screen(screen, controls);
    }};
}
