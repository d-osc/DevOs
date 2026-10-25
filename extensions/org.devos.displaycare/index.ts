import {Gtk, Gdk, Gio, GLib, GtkLayerShell, type UIContext} from '@dev-os/core';
import {ROOT} from '@dev-os/config';
import Cairo from 'cairo';
import {layerWindow} from '@dev-os/services/layers';
import type {DesktopWindow} from '@dev-os/services/windows';
import {readCare, watchCare, watchFile, pixelRefreshPath, type CareSettings} from './care.js';
import {TARGET_DIM, REFRESH_FRAME_MS, refreshColors, contains, edgeActive, edgeAlpha, edgeBand, localRect, type Rect} from './dim.js';

const read = (path: string) => {try {const [ok, bytes] = GLib.file_get_contents(path); return ok ? new TextDecoder().decode(bytes).trim() : '';} catch {return '';}};
/** Battery present and whether it is discharging, from the kernel (the same rule as `dev-os-display-care get`). */
function battery() {
    let present = false, mains: boolean | null = null;
    const base = '/sys/class/power_supply';
    let directory: GLib.Dir;
    try {directory = GLib.Dir.open(base, 0);} catch {return {present, onBattery: false};}
    for (let name = directory.read_name(); name; name = directory.read_name()) {
        const type = read(`${base}/${name}/type`);
        if (type === 'Battery') present = true; else if (type === 'Mains') mains = read(`${base}/${name}/online`) === '1' || mains === true;
    }
    return {present, onBattery: present && mains === false};
}
/** Settings, power source, idle flag and window list, watched once for every monitor. */
export class CareShared {
    settings: CareSettings = readCare(); battery = battery(); idle = read(pixelRefreshPath());
    private listeners = new Set<() => void>(); private cleanup: (() => void)[] = []; private timer: number;
    private child?: Gio.Subprocess; private retry = 0; private disposed = false;
    constructor(private context: UIContext) {
        const changed = () => this.listeners.forEach(listener => listener());
        this.cleanup.push(watchCare(settings => {this.settings = settings; changed();}));
        this.cleanup.push(watchFile(pixelRefreshPath(), () => {this.idle = read(pixelRefreshPath()); changed();}));
        const windows = context.windows?.subscribe(changed); if (windows) this.cleanup.push(windows);
        this.supervise();
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
            const next = battery(); if (next.present !== this.battery.present || next.onBattery !== this.battery.onBattery) {this.battery = next; changed();}
            return GLib.SOURCE_CONTINUE;
        });
    }
    /**
     * Runs `dev-os-display-care serve` (gamma colour, dimming, idle detection) as a child of the shell, which is the one
     * process that knows the compositor socket. A copy that finds the lock held exits with 0; a crash is restarted.
     */
    private supervise() {
        const local = `${ROOT}/bin/dev-os-display-care`, helper = GLib.file_test(local, GLib.FileTest.IS_REGULAR) ? local : GLib.find_program_in_path('dev-os-display-care');
        if (!helper) return;
        const start = () => {
            if (this.disposed) return;
            try {
                const child = Gio.Subprocess.new(['python3', helper, 'serve'], Gio.SubprocessFlags.STDOUT_SILENCE);
                this.child = child;
                child.wait_check_async(null, (_source, result) => {
                    this.child = undefined;
                    let failed = false; try {child.wait_check_finish(result);} catch {failed = !this.disposed;}
                    if (failed) this.retry = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {this.retry = 0; start(); return GLib.SOURCE_REMOVE;});
                });
            } catch (error) {printerr(`Display care helper did not start: ${error}`);}
        };
        start();
    }
    get windows(): readonly DesktopWindow[] {return this.context.windows?.state ?? [];}
    subscribe(listener: () => void) {this.listeners.add(listener); return () => {this.listeners.delete(listener);};}
    destroy() {this.disposed = true; if (this.retry) GLib.source_remove(this.retry); this.child?.force_exit(); GLib.source_remove(this.timer); this.cleanup.forEach(stop => stop()); this.cleanup = []; this.listeners.clear();}
}
const allEdges = [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT];
/** Per monitor: the dimming layer for Target Mode and Adaptive Edge Brightness, and the Pixel refresh screen saver. */
export class CareOverlay {
    private dim?: Gtk.ApplicationWindow; private saver?: Gtk.ApplicationWindow;
    private hole: Rect | null = null; private strength = 0; private target = false;
    private frame = 0; private frameTimer = 0; private shownAt = 0; private dismissed = ''; private stop: () => void;
    constructor(private context: UIContext, private monitor: Gdk.Monitor, private shared: CareShared) {
        this.stop = shared.subscribe(() => this.update()); this.update();
    }
    private activeWindow(): {rect: Rect; fullscreen: boolean} | null {
        const bounds = this.monitor.get_geometry();
        const window = this.shared.windows.find(item => item.active && !item.minimized && item.geometry && contains(bounds, item.geometry.area.x + 1, item.geometry.area.y + 1));
        return window?.geometry ? {rect: localRect(window.geometry, window.geometry.area), fullscreen: window.fullscreen === true} : null;
    }
    private update() {
        const s = this.shared.settings, active = this.activeWindow();
        this.target = s.targetMode && !!active && !active.fullscreen; this.hole = this.target ? active!.rect : null;
        this.strength = edgeActive(s.edgeBrightness, this.shared.battery) ? edgeAlpha(s.edgeBrightness) : 0;
        if (this.target || this.strength) {this.ensureDim().queue_draw(); this.dim!.show();} else this.dim?.hide();
        const token = this.shared.idle;
        if (!token) this.dismissed = '';
        if (s.pixelRefresh && token && token !== this.dismissed) this.showSaver(token); else this.hideSaver();
    }
    private ensureDim() {
        if (this.dim) return this.dim;
        const window = this.dim = layerWindow(this.context.application, 'dev-os-care-dim', GtkLayerShell.Layer.TOP, this.monitor, allEdges);
        // Zero keeps the layer inside the work area, so the panel is never dimmed; -1 would cover it.
        GtkLayerShell.set_exclusive_zone(window, 0); window.set_resizable(true); window.set_app_paintable(true);
        window.connect('realize', () => window.get_window()?.input_shape_combine_region(new Cairo.Region(), 0, 0));
        window.connect('draw', (_widget, cr) => {
            const width = window.get_allocated_width(), height = window.get_allocated_height();
            cr.setOperator(Cairo.Operator.SOURCE); cr.setSourceRGBA(0, 0, 0, 0); cr.paint(); cr.setOperator(Cairo.Operator.OVER);
            if (this.target) {
                cr.setSourceRGBA(0, 0, 0, TARGET_DIM); cr.rectangle(0, 0, width, height);
                if (this.hole) cr.rectangle(this.hole.x, this.hole.y, this.hole.width, this.hole.height);
                cr.setFillRule(Cairo.FillRule.EVEN_ODD); cr.fill();
            }
            if (this.strength) {
                const band = edgeBand(width, height), fade = (x0: number, y0: number, x1: number, y1: number, x: number, y: number, w: number, h: number) => {
                    const gradient = new Cairo.LinearGradient(x0, y0, x1, y1); gradient.addColorStopRGBA(0, 0, 0, 0, this.strength); gradient.addColorStopRGBA(1, 0, 0, 0, 0);
                    cr.setSource(gradient); cr.rectangle(x, y, w, h); cr.fill();
                };
                fade(0, 0, 0, band, 0, 0, width, band); fade(0, height, 0, height - band, 0, height - band, width, band);
                fade(0, 0, band, 0, 0, 0, band, height); fade(width, 0, width - band, 0, width - band, 0, band, height);
            }
            return true;
        });
        return window;
    }
    private showSaver(token: string) {
        if (this.saver) return;
        const window = this.saver = layerWindow(this.context.application, 'dev-os-pixel-refresh', GtkLayerShell.Layer.OVERLAY, this.monitor, allEdges, GtkLayerShell.KeyboardMode.EXCLUSIVE);
        GtkLayerShell.set_exclusive_zone(window, -1); window.set_resizable(true); window.set_app_paintable(true); window.set_can_focus(true);
        window.add_events(Gdk.EventMask.KEY_PRESS_MASK | Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.POINTER_MOTION_MASK);
        // Any input ends it; the first moments are ignored because the surface appears under a resting pointer.
        const leave = () => {if (GLib.get_monotonic_time() - this.shownAt < 800000) return false; this.dismissed = token; this.hideSaver(); return true;};
        window.connect('key-press-event', leave); window.connect('button-press-event', leave); window.connect('motion-notify-event', leave);
        window.connect('draw', (_widget, cr) => {
            const [red, green, blue] = refreshColors[this.frame % refreshColors.length];
            cr.setSourceRGBA(red, green, blue, 1); cr.paint(); return true;
        });
        this.frame = 0; this.shownAt = GLib.get_monotonic_time();
        this.frameTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_FRAME_MS, () => {this.frame++; this.saver?.queue_draw(); return GLib.SOURCE_CONTINUE;});
        window.show();
    }
    private hideSaver() {
        if (this.frameTimer) {GLib.source_remove(this.frameTimer); this.frameTimer = 0;}
        this.saver?.destroy(); this.saver = undefined;
    }
    destroy() {this.stop(); this.hideSaver(); this.dim?.destroy(); this.dim = undefined;}
}
