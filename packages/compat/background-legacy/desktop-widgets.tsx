import {React, Box, EventBox, Label, Button, ComboBoxText, TextView, Gtk, GLib, useEffect, useLayoutEffect, useState, useRef, type SettingsValues} from '@dev-os/core';

export const desktopWidgets = [
    {key: 'widgetClock', title: 'Clock', description: 'Live local time'},
    {key: 'widgetDate', title: 'Date', description: 'Today’s day and date'},
    {key: 'widgetNote', title: 'Note', description: 'Keep a reminder on your desktop'},
] as const;

type WidgetKey = typeof desktopWidgets[number]['key'];
export function widgetLocations(value: unknown): Partial<Record<WidgetKey, {x: number; y: number}>> {
    const result: Partial<Record<WidgetKey, {x: number; y: number}>> = {};
    try {
        const parsed = JSON.parse(String(value ?? '{}'));
        for (const {key} of desktopWidgets) {
            const point = parsed?.[key];
            if (point && Number.isFinite(point.x) && Number.isFinite(point.y))
                result[key] = {x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y))};
        }
    } catch { /* Invalid positions fall back to the default arrangement. */ }
    return result;
}

function MovableWidget({kind, index, values, changed, children}: {kind: WidgetKey; index: number; values: SettingsValues; changed?(values: SettingsValues): void; children: React.ReactNode}) {
    const card = useRef<Gtk.Box | null>(null), handle = useRef<Gtk.EventBox | null>(null);
    const reposition = useRef<() => void>(() => {});
    const current = useRef({values, changed}); current.current = {values, changed};
    useLayoutEffect(() => {
        const widget = card.current!, parent = widget.get_parent() as Gtk.Overlay;
        let dragging = false, start = {x: 0, y: 0};
        const bounds = () => ({x: Math.max(0, parent.get_allocated_width() - widget.get_allocated_width()), y: Math.max(0, parent.get_allocated_height() - widget.get_allocated_height())});
        const place = (x: number, y: number) => {
            const limit = bounds(); widget.set_margin_start(Math.round(Math.max(0, Math.min(limit.x, x))));
            widget.set_margin_top(Math.round(Math.max(0, Math.min(limit.y, y))));
        };
        const layout = () => {
            if (dragging) return;
            const point = widgetLocations(current.current.values.widgetLocations)[kind], limit = bounds();
            place(point ? point.x * limit.x : current.current.values.widgetPosition === 'left' ? 24 : limit.x - 24,
                point ? point.y * limit.y : 80 + index * 145);
        };
        let pending = 0;
        const schedule = () => {
            if (!pending) pending = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { pending = 0; layout(); return GLib.SOURCE_REMOVE; });
        };
        const size = parent.connect('size-allocate', schedule);
        const cardSize = widget.connect('size-allocate', schedule);
        reposition.current = schedule;
        // Track against the stationary desktop, so moving the handle does not
        // change the coordinate origin midway through the drag.
        const drag = new Gtk.GestureDrag({widget: parent, button: 1, propagation_phase: Gtk.PropagationPhase.CAPTURE});
        drag.connect('drag-begin', (_gesture, x, y) => {
            const grip = handle.current!;
            const [valid, left, top] = grip.translate_coordinates(parent, 0, 0);
            if (!valid || x < left || y < top || x >= left + grip.get_allocated_width() || y >= top + grip.get_allocated_height()) {
                drag.set_state(Gtk.EventSequenceState.DENIED); return;
            }
            dragging = true; start = {x: widget.margin_start, y: widget.margin_top};
            drag.set_state(Gtk.EventSequenceState.CLAIMED);
        });
        drag.connect('drag-update', (_gesture, x, y) => { if (dragging) place(start.x + x, start.y + y); });
        drag.connect('drag-end', (_gesture, x, y) => {
            if (!dragging) return;
            place(start.x + x, start.y + y); dragging = false;
            const limit = bounds();
            const locations = widgetLocations(current.current.values.widgetLocations);
            locations[kind] = {x: limit.x ? widget.margin_start / limit.x : 0, y: limit.y ? widget.margin_top / limit.y : 0};
            current.current.changed?.({widgetLocations: JSON.stringify(locations)});
        });
        drag.connect('cancel', () => { dragging = false; layout(); });
        schedule();
        return () => { reposition.current = () => {}; if (pending) GLib.source_remove(pending); parent.disconnect(size); widget.disconnect(cardSize); drag.run_dispose(); };
    }, []);
    useLayoutEffect(() => reposition.current(), [values.widgetLocations, values.widgetPosition]);
    return <Box ref={card} overlay id={`desktop-widget-${kind.slice(6).toLowerCase()}`} className="desktop-widget" orientation="vertical" spacing={8} halign="start" valign="start" widthRequest={250}>
        <Box spacing={8}><EventBox ref={handle} id={`desktop-drag-${kind}`} expand fill tooltip="Drag to move widget"><Label className="settings-eyebrow" xalign={0}>{kind === 'widgetClock' ? 'LOCAL TIME' : kind === 'widgetDate' ? 'DATE' : 'NOTE'}</Label></EventBox>
            <Button id={`desktop-remove-${kind}`} className="desktop-widget-remove" tooltip="Remove widget" onClicked={() => changed?.({[kind]: false})}>×</Button></Box>
        {children}
    </Box>;
}

export function DesktopWidgets({values, changed}: {values: SettingsValues; changed?(values: SettingsValues): void}) {
    const [now, setNow] = useState(() => GLib.DateTime.new_now_local());
    useEffect(() => {
        if (!values.widgetClock && !values.widgetDate) return;
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            setNow(GLib.DateTime.new_now_local()); return GLib.SOURCE_CONTINUE;
        });
        return () => { GLib.source_remove(timer); };
    }, [values.widgetClock, values.widgetDate]);
    return <>
        {values.widgetClock === true && <MovableWidget kind="widgetClock" index={0} values={values} changed={changed}>
            <Label className="desktop-widget-time" xalign={0}>{now?.format('%H:%M') ?? ''}</Label>
        </MovableWidget>}
        {values.widgetDate === true && <MovableWidget kind="widgetDate" index={1} values={values} changed={changed}>
            <Label className="section-heading" xalign={0}>{now?.format('%A, %d %B %Y') ?? ''}</Label>
        </MovableWidget>}
        {values.widgetNote === true && <MovableWidget kind="widgetNote" index={2} values={values} changed={changed}>
            <Label xalign={0} wrap maxWidthChars={28}>{String(values.widgetNoteText || 'Add your reminder in Background → Desktop widgets.').slice(0, 2000)}</Label>
        </MovableWidget>}
    </>;
}

export function DesktopWidgetSettings({values, changed}: {values: SettingsValues; changed(values: SettingsValues): void}) {
    return <Box className="settings-card background-settings-card" orientation="vertical" spacing={14}>
        <Label className="section-heading" xalign={0}>Desktop widgets</Label>
        <Label className="settings-description" xalign={0} wrap>Widgets belong to this desktop only. Drag a widget’s header to move it, or click × to remove it. Desktop changes save immediately.</Label>
        {desktopWidgets.map(item => <Box key={item.key} spacing={12}>
            <Box expand orientation="vertical" spacing={4}><Label xalign={0}>{item.title}</Label><Label className="settings-description" xalign={0}>{item.description}</Label></Box>
            <Button id={`desktop-toggle-${item.key}`} onClicked={() => changed({[item.key]: values[item.key] !== true})}>{values[item.key] === true ? 'Remove' : 'Add widget'}</Button>
        </Box>)}
        <Box spacing={12}><Label expand xalign={0}>Arrange widgets</Label><ComboBoxText id="desktop-widget-position" activeId={values.widgetPosition === 'left' ? 'left' : 'right'} items={[{id: 'left', text: 'Top left'}, {id: 'right', text: 'Top right'}]} onChanged={widget => changed({widgetPosition: widget.get_active_id() ?? 'right', widgetLocations: '{}'})} /><Button onClicked={() => changed({widgetLocations: '{}'})}>Reset positions</Button></Box>
        {values.widgetNote === true && <Box orientation="vertical" spacing={8}><Label xalign={0}>Note text</Label><TextView id="desktop-widget-note-text" heightRequest={100} text={String(values.widgetNoteText ?? '')} wrapMode={Gtk.WrapMode.WORD_CHAR} onChanged={widget => {
            const buffer = widget.get_buffer(); changed({widgetNoteText: buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false).slice(0, 2000)});
        }} /></Box>}
    </Box>;
}
