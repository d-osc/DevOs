import {Gtk, Gdk, GLib, GtkLayerShell, activePalette, rgbOf, type UIContext} from '@dev-os/core';
import Cairo from 'cairo';
import {layerWindow} from '@dev-os/services/layers';
import {snapDividers, type SnapDivider} from '@dev-os/services/snap-geometry';
import type {SnapGroup, WindowGeometry} from '@dev-os/services/windows';

interface Grip extends SnapDivider {x: number; y: number; width: number; height: number;}
/** A stationary transparent surface; only the small grips accept pointer input. */
export class SnapSashes {
    readonly window: Gtk.ApplicationWindow;
    private canvas = new Gtk.DrawingArea({hexpand: true, vexpand: true});
    private grips: Grip[] = [];
    private group?: SnapGroup;
    private area?: WindowGeometry['area'];
    private monitor?: Gdk.Monitor;
    private drag?: {group: number; grip: Grip; pending?: number};
    private timer = 0;
    private gesture: Gtk.GestureDrag;
    private unsubscribe?: () => void;
    private disposed = false;
    constructor(private context: UIContext) {
        this.window = layerWindow(context.application, 'dev-os-snap-sashes', GtkLayerShell.Layer.TOP, null,
            [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT], GtkLayerShell.KeyboardMode.NONE);
        this.window.name = 'snap-sashes'; this.window.set_app_paintable(true); this.window.set_resizable(true);
        GtkLayerShell.set_exclusive_zone(this.window, -1); this.window.add(this.canvas);
        const css = new Gtk.CssProvider(); css.load_from_data('window {background: transparent; border: none; box-shadow: none;}');
        this.window.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 2);
        this.canvas.add_events(Gdk.EventMask.POINTER_MOTION_MASK | Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK);
        this.canvas.connect('draw', (_widget, cr) => {
            cr.setOperator(Cairo.Operator.SOURCE); cr.setSourceRGBA(0, 0, 0, 0); cr.paint(); cr.setOperator(Cairo.Operator.OVER);
            for (const grip of this.grips) {
                const vertical = grip.axis === 'x', cx = grip.x + grip.width / 2, cy = grip.y + grip.height / 2;
                cr.setSourceRGBA(...rgbOf(activePalette().s3), 0.98);
                const x = cx - (vertical ? 4 : 23), y = cy - (vertical ? 23 : 4), width = vertical ? 8 : 46, height = vertical ? 46 : 8, radius = 4;
                cr.newPath(); cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0); cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
                cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI); cr.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5); cr.closePath(); cr.fill();
                cr.setSourceRGBA(...rgbOf(activePalette().accentFg), 1);
                for (let dot = -1; dot <= 1; dot++) {cr.arc(cx + (vertical ? 0 : dot * 6), cy + (vertical ? dot * 6 : 0), 1.3, 0, Math.PI * 2); cr.fill();}
            }
            return false;
        });
        this.window.connect('realize', () => this.inputShape());
        this.window.connect('size-allocate', () => this.inputShape());
        this.canvas.connect('motion-notify-event', (_widget, event) => {
            const [, x, y] = (event as unknown as Gdk.Event).get_coords();
            const grip = this.grips.find(grip => this.contains(grip, x, y));
            this.window.get_window()?.set_cursor(Gdk.Cursor.new_from_name(context.display, grip?.axis === 'y' ? 'row-resize' : 'col-resize'));
            return false;
        });
        this.gesture = new Gtk.GestureDrag({widget: this.canvas, button: 1, propagation_phase: Gtk.PropagationPhase.CAPTURE});
        this.gesture.connect('drag-begin', (_gesture, x, y) => {
            const grip = this.grips.find(grip => this.contains(grip, x, y));
            if (!grip || !this.group) {this.gesture.set_state(Gtk.EventSequenceState.DENIED); return;}
            this.drag = {group: this.group.id, grip: {...grip}}; this.gesture.set_state(Gtk.EventSequenceState.CLAIMED);
        });
        this.gesture.connect('drag-update', (_gesture, x, y) => this.move(x, y));
        this.gesture.connect('drag-end', (_gesture, x, y) => {this.move(x, y); this.flush(); this.drag = undefined; this.update();});
        this.gesture.connect('cancel', () => {this.flush(); this.drag = undefined; this.update();});
        this.unsubscribe = context.windows?.subscribe(() => this.update()); this.canvas.show(); this.update();
    }
    private contains(grip: Grip, x: number, y: number) {return x >= grip.x && y >= grip.y && x < grip.x + grip.width && y < grip.y + grip.height;}
    private inputShape() {
        const region = new Cairo.Region();
        for (const grip of this.grips) region.unionRectangle({x: Math.round(grip.x), y: Math.round(grip.y), width: grip.width, height: grip.height});
        this.window.get_window()?.input_shape_combine_region(region, 0, 0);
    }
    private move(x: number, y: number) {
        if (!this.drag || !this.area) return;
        const vertical = this.drag.grip.axis === 'x';
        this.drag.pending = this.drag.grip.position + (vertical ? x / this.area.width : y / this.area.height) * 10000;
        if (!this.timer) this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 24, () => {this.timer = 0; this.flush(); return GLib.SOURCE_REMOVE;});
    }
    private flush() {
        if (this.timer) GLib.source_remove(this.timer); this.timer = 0;
        if (this.drag?.pending === undefined) return;
        const {group, grip, pending} = this.drag; this.drag.pending = undefined;
        this.context.windows?.resizeSnapGroup?.(group, grip.axis, grip.index, pending);
    }
    private update() {
        if (this.disposed) return;
        const controls = this.context.windows, active = controls?.state.find(window => window.active);
        const group = controls?.canResizeSnap ? controls.snapGroups?.find(group => group.members.some(member => member.id === (this.drag ? undefined : active?.id)) || group.id === this.drag?.group) : undefined;
        const expected = group?.layout === 'quarters' ? 4 : group?.layout === 'thirds' ? 3 : 2;
        const members = group?.members.map(member => controls?.state.find(window => window.id === member.id)) ?? [];
        const geometry = members[0]?.geometry;
        if (!group || group.members.length !== expected || !geometry || members.some((window, index) => !window?.geometry || window.minimized || window.maximized || window.fullscreen || window.geometry.output !== geometry.output || window.geometry.region !== group.members[index].region || window.desktop !== members[0]?.desktop)) {
            this.grips = []; this.drag = undefined; this.group = undefined; this.window.hide(); this.inputShape(); return;
        }
        const area = geometry.area;
        const monitor = this.context.monitors().find(monitor => {const box = monitor.get_geometry(); return area.x + area.width / 2 >= box.x && area.y + area.height / 2 >= box.y && area.x + area.width / 2 < box.x + box.width && area.y + area.height / 2 < box.y + box.height;});
        if (!monitor) {this.grips = []; this.window.hide(); return;}
        if (monitor !== this.monitor) {this.monitor = monitor; GtkLayerShell.set_monitor(this.window, monitor);}
        const origin = monitor.get_geometry(); this.group = group; this.area = area;
        this.grips = snapDividers(group).map(divider => {
            const vertical = divider.axis === 'x';
            return {...divider, x: Math.round(area.x - origin.x + area.width * (vertical ? divider.position / 10000 : 0.5) - (vertical ? 6 : 26)),
                y: Math.round(area.y - origin.y + area.height * (vertical ? 0.5 : divider.position / 10000) - (vertical ? 26 : 6)), width: vertical ? 12 : 52, height: vertical ? 52 : 12};
        });
        // Keep horizontal/vertical handles apart at the four-quarter crossing.
        if (group.layout === 'quarters') {const vertical = this.grips.find(grip => grip.axis === 'x'); if (vertical) vertical.y = Math.round(area.y - origin.y + area.height * (group.row ?? 5000) / 20000 - 26);}
        this.window.show(); this.inputShape(); this.canvas.queue_draw();
    }
    destroy() {this.disposed = true; this.unsubscribe?.(); if (this.timer) GLib.source_remove(this.timer); this.gesture.run_dispose(); this.window.destroy();}
}
