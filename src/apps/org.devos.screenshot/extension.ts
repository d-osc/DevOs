import {GLib, type UIExtension} from '@dev-os/core';
import {captureDesktop, copySnip, grimAvailable, saveSnip} from './capture.js';
import {desktopBounds, type SnipMode} from './geometry.js';
import type {SnipEditor} from './editor.js';
import type {SnipOverlay, Snip} from './overlay.js';
import type {SnipToast} from './toast.js';

/** Time for the compositor to repaint without the launcher or the Screenshot window before the frame is captured. */
const SETTLE_MS = 250;
const pause = (milliseconds: number) => new Promise<void>(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => { resolve(); return GLib.SOURCE_REMOVE; }));

export default {id: 'org.devos.screenshot', activate(context) {
    let overlay: SnipOverlay | undefined, editor: SnipEditor | undefined, toast: SnipToast | undefined;
    let busy = false, timer = 0, stopped = false;

    const openEditor = async (): Promise<SnipEditor> => {
        if (editor) return editor;
        const {SnipEditor} = await import('./editor.js');
        const created: SnipEditor = new SnipEditor(context, {newSnip: (mode, delay) => void begin(mode, delay), closed: () => { if (editor === created) editor = undefined; }});
        editor = created;
        return created;
    };
    const fail = async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        printerr(`Screenshot failed: ${message}`);
        const window = await openEditor(); window.setStatus(message); window.show();
    };
    const completed = async (snip: Snip) => {
        if (stopped) return;
        let path: string | null = null, note = 'Copied to the clipboard.';
        try { path = await saveSnip(snip.pixbuf); note = `Saved to ${path} and copied to the clipboard.`; } catch (error) { note = `Copied to the clipboard, but it could not be saved: ${String(error)}`; }
        if (stopped) return;
        try { copySnip(snip.pixbuf); } catch (error) { note = `Saved${path ? ` to ${path}` : ''}, but it could not be copied: ${String(error)}`; }
        if (editor) { editor.setSnip(snip.pixbuf, path); return; }
        const {SnipToast} = await import('./toast.js');
        toast?.destroy();
        toast = new SnipToast(context, snip.pixbuf, note, () => { void openEditor().then(window => window.setSnip(snip.pixbuf, path)); }, () => { toast = undefined; });
    };
    const capture = async (mode: SnipMode) => {
        try {
            if (!grimAvailable()) throw new Error('Screen capture needs grim, which is not installed on this system.');
            context.invoke('launcher.hide'); editor?.hide(); toast?.destroy();
            await pause(SETTLE_MS);
            const frame = await captureDesktop(desktopBounds(context.monitors().map(monitor => monitor.get_geometry())));
            if (stopped) return;
            const {SnipOverlay} = await import('./overlay.js');
            overlay = new SnipOverlay(context, frame, mode, snip => {
                overlay = undefined; busy = false;
                if (snip) void completed(snip).catch(fail); else if (editor) editor.show();
            });
        } catch (error) { busy = false; editor?.show(); await fail(error); }
    };
    const begin = async (mode: SnipMode = 'rectangle', delay = 0) => {
        if (busy || stopped) return;
        busy = true;
        if (delay > 0) { editor?.hide(); timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => { timer = 0; void capture(mode); return GLib.SOURCE_REMOVE; }); }
        else await capture(mode);
    };

    const cleanups = [
        context.registerCommand('screenshot', () => { void begin('rectangle'); }),
        context.registerCommand('screenshot-app', () => { void openEditor().then(window => window.show()).catch(fail); }),
    ];
    return () => {
        stopped = true; if (timer) GLib.source_remove(timer);
        for (const cleanup of cleanups) cleanup();
        overlay?.destroy(); toast?.destroy(); editor?.destroy();
    };
}} satisfies UIExtension;
