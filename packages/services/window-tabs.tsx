import {
    React, Box, Button, Label, Image,
    ScrolledWindow, createRoot, mountWindowHeader, useRef, useLayoutEffect,
    Gtk, Gdk, GLib, Pango, GObject
} from '@dev-os/core';

export interface TabDragHost {
    readonly tabGroup: string;
    moveTab(id: number, destination: TabDragHost, before?: number): void;
    detachTab(id: number): void;
}
interface TabDragSource {host: TabDragHost; id: number;}
const sources = new Map<Gtk.Widget, TabDragSource>();
const activeDrags = new Map<Gtk.Window, Gdk.DragContext>();
const dragListeners = new Set<(active: boolean) => void>();
export function onTabDrag(listener: (active: boolean) => void) { dragListeners.add(listener); return () => { dragListeners.delete(listener); }; }
function dragSource(context: Gdk.DragContext) {
    const widget = Gtk.drag_get_source_widget(context); return widget ? sources.get(widget) : undefined;
}
const target = () => Gtk.TargetEntry.new('application/x-dev-os-window-tab', Gtk.TargetFlags.SAME_APP, 0);
// Finish native DnD before changing parents or destroying the source titlebar.
const afterDrag = (callback: () => void) => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { callback(); return GLib.SOURCE_REMOVE; });

// Explicit drop regions avoid GTK3/Wayland's ambiguous ERROR on an unaccepted
// drop. A drop on window content or the desktop detaches; Escape never does.
export function tabDetachTarget(widget: Gtk.Widget, dropped?: (source: TabDragSource, x: number, y: number) => void, preserveTargets = false) {
    const atom = Gdk.Atom.intern('application/x-dev-os-window-tab', false);
    const original = preserveTargets ? widget.drag_dest_get_target_list() : null;
    if (original) {
        original.add(atom, Gtk.TargetFlags.SAME_APP, 0);
        widget.drag_dest_set_target_list(original);
    } else widget.drag_dest_set(Gtk.DestDefaults.MOTION | Gtk.DestDefaults.HIGHLIGHT, [target()], Gdk.DragAction.MOVE);
    const signals = [widget.connect('drag-motion', (_widget, context, _x, _y, time) => {
        if (!dragSource(context)) return false;
        Gdk.drag_status(context, Gdk.DragAction.MOVE, time); return true;
    }), widget.connect('drag-drop', (_widget, context, _x, _y, time) => {
        if (!dragSource(context)) return false;
        widget.drag_get_data(context, atom, time); return true;
    }), widget.connect('drag-data-received', (_widget, context, x, y, data, _info, time) => {
        const source = dragSource(context);
        if (!source) return;
        // WebKit has its own drop handler; consume only our native tab payload.
        if (preserveTargets) GObject.signal_stop_emission_by_name(widget, 'drag-data-received');
        const accepted = data.get_length() > 0;
        Gtk.drag_finish(context, accepted, false, time);
        if (source && accepted) afterDrag(() => dropped ? dropped(source, x, y) : source.host.detachTab(source.id));
    })];
    return () => {
        signals.forEach(signal => widget.disconnect(signal));
        if (original) { original.remove(atom); widget.drag_dest_set_target_list(original); }
        else widget.drag_dest_unset();
    };
}

function DraggableTab({tab, active, selected, select, drag}: {
    tab: WindowTab; active: boolean; selected: React.RefObject<Gtk.Button | null>;
    select(id: number): void; drag?: TabDragHost;
}) {
    const button = useRef<Gtk.Button>(null);
    useLayoutEffect(() => {
        const widget = button.current!;
        if (!drag) return;
        sources.set(widget, {host: drag, id: tab.id});
        widget.drag_source_set(Gdk.ModifierType.BUTTON1_MASK, [target()], Gdk.DragAction.MOVE);
        let dragging = false;
        const signals = [
            widget.connect('drag-begin', (_widget, context) => {
                // Keep the preview away from the pointer so compositors can
                // hit-test the actual destination underneath the drag icon.
                Gtk.drag_set_icon_name(context, tab.iconName, -12, -12);
                widget.get_style_context().add_class('tab-dragging');
                dragging = true;
                const window = widget.get_toplevel();
                if (window instanceof Gtk.Window) activeDrags.set(window, context);
                dragListeners.forEach(listener => listener(true));
            }),
            widget.connect('drag-data-get', (_widget, _context, data) => data.set(data.get_target(), 8, new TextEncoder().encode(String(tab.id)))),
            widget.connect('drag-failed', (_widget, _context, result) => {
                if (result !== Gtk.DragResult.NO_TARGET) return false;
                afterDrag(() => drag.detachTab(tab.id)); return true;
            }),
            widget.connect('drag-end', () => { const window = widget.get_toplevel(); if (window instanceof Gtk.Window) activeDrags.delete(window); dragging = false; widget.get_style_context().remove_class('tab-dragging'); dragListeners.forEach(listener => listener(false)); }),
        ];
        return () => { if (dragging) dragListeners.forEach(listener => listener(false)); sources.delete(widget); signals.forEach(signal => widget.disconnect(signal)); widget.drag_source_unset(); };
    }, [drag, tab.id]);
    return <Button id={`window-tab-${tab.id}`} ref={widget => { button.current = widget; if (active) selected.current = widget; }}
        className="tab-select" tooltip={`${tab.tooltip ?? tab.label}\nDrag to detach or move to another window`} onClicked={() => select(tab.id)}>
        <Box spacing={6}><Image iconName={tab.iconName} pixelSize={14} /><Label xalign={0} ellipsize={Pango.EllipsizeMode.END} widthChars={tab.widthChars ?? 13} maxWidthChars={tab.widthChars ?? 13}>{tab.label}</Label></Box>
    </Button>;
}

export interface WindowTab { id: number; label: string; tooltip?: string; iconName: string; widthChars?: number; }
interface TabStripProps {
    tabs: readonly WindowTab[]; active: number;
    select(id: number): void; close(id: number): void; add(): void;
    drag?: TabDragHost;
}
function TabStrip({tabs, active, select, close, add, drag}: TabStripProps) {
    const scroll = useRef<Gtk.ScrolledWindow>(null), selected = useRef<Gtk.Button>(null);
    useLayoutEffect(() => {
        // GTK allocates the updated strip before this idle callback runs.
        let source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            source = 0;
            const viewport = scroll.current, button = selected.current;
            if (viewport && button) {
                const [translated, x] = button.translate_coordinates(viewport, 0, 0);
                const adjustment = viewport.get_hadjustment(), width = viewport.get_allocated_width();
                if (translated) {
                    const offset = x < 0 ? x : Math.max(0, x + button.get_allocated_width() + 28 - width);
                    adjustment.set_value(Math.max(adjustment.get_lower(), Math.min(adjustment.get_upper() - adjustment.get_page_size(), adjustment.get_value() + offset)));
                }
            }
            return GLib.SOURCE_REMOVE;
        });
        return () => { if (source) GLib.source_remove(source); };
    }, [active, tabs.length]);
    return <Box className="window-tabs" spacing={3} hexpand>
        <ScrolledWindow id="window-tab-scroll" ref={scroll} expand hexpand hscrollbarPolicy={Gtk.PolicyType.EXTERNAL} vscrollbarPolicy={Gtk.PolicyType.NEVER} minContentHeight={24}>
            <Box spacing={3}>{tabs.map(tab => <Box key={tab.id} className={`window-tab ${tab.id === active ? 'window-tab-active' : ''}`} spacing={0}>
                <DraggableTab {...{tab, selected, select, drag}} active={tab.id === active} />
                <Button id={`window-tab-close-${tab.id}`} className="tab-close" tooltip={`Close ${tab.label}`} onClicked={() => close(tab.id)}><Image iconName="window-close-symbolic" pixelSize={10} /></Button>
            </Box>)}
                <Button id="window-tab-add" className="tab-add" valign="center" tooltip="New tab" onClicked={add}><Image iconName="list-add-symbolic" pixelSize={14} /></Button>
            </Box>
        </ScrolledWindow>
    </Box>;
}
export function mountTabbedHeader(window: Gtk.ApplicationWindow, options: Parameters<typeof mountWindowHeader>[1]) {
    const header = mountWindowHeader(window, options);
    const cancelSignal = window.connect('key-press-event', (_window, event) => {
        const context = activeDrags.get(window);
        if (context && (event as unknown as Gdk.Event).get_keyval()[1] === Gdk.KEY_Escape) {
            Gtk.drag_cancel(context); return true;
        }
        return false;
    });
    header.titlebar.get_style_context().add_class('tabbed-titlebar');
    const host = new Gtk.Box({hexpand: true}), root = createRoot(host);
    header.titlebar.set_custom_title(host); host.show();
    let props: TabStripProps | undefined;
    // GTK's DnD hit testing on a CSD window reaches the ApplicationWindow even
    // over its titlebar. Route the header region using window-relative coordinates.
    const detachTarget = tabDetachTarget(window, (source, x, y) => {
            const destination = props?.drag;
            if (!props || !destination) return;
            const titlebar = window.get_titlebar()!;
            const [translated, , top] = titlebar.translate_coordinates(window, 0, 0);
            if (!translated || y < top || y >= top + titlebar.get_allocated_height() || source.host.tabGroup !== destination.tabGroup) {
                source.host.detachTab(source.id); return;
            }
            let before: number | undefined;
            // The pointer's horizontal position determines the insertion point.
            const find = (parent: Gtk.Widget): void => {
                if (before !== undefined) return;
                const tab = props?.tabs.find(tab => parent.name === `window-tab-${tab.id}`);
                if (tab) {
                    const [ok, left] = parent.translate_coordinates(window, 0, 0);
                    if (ok && x < left + parent.get_allocated_width() / 2) before = tab.id;
                } else if (parent instanceof Gtk.Container) parent.get_children().forEach(find);
            };
            find(host);
            source.host.moveTab(source.id, destination, before);
    });
    return {update: (next: TabStripProps) => { props = next; root.render(<TabStrip {...next} />); },
        destroy: () => { props = undefined; window.disconnect(cancelSignal); activeDrags.delete(window); detachTarget(); root.unmount(); header.destroy(); }};
}
