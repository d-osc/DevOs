import {React, Gtk, Gdk, GLib, GtkLayerShell, Pango, Box, Label, Image, Button, ComboBoxText, ScrolledWindow, DrawingArea, createRoot, useState, useEffect, activePalette, rgbOf, type UIContext} from '@dev-os/core';
import {layerWindow} from '@dev-os/services/layers';
import {snapLayouts, validSnapMembers, type WindowControls} from '@dev-os/services/windows';
import {OverlayMotion} from './overlay-motion.js';

type Preset = typeof snapLayouts[number];
const positionNames: Record<string, string> = {'half-left': 'Left', 'half-right': 'Right', 'wide-left': 'Wide left', 'wide-right': 'Wide right', 'third-left': 'Left', 'third-center': 'Center', 'third-right': 'Right', 'quarter-top-left': 'Top left', 'quarter-top-right': 'Top right', 'quarter-bottom-left': 'Bottom left', 'quarter-bottom-right': 'Bottom right'};
export function SnapPreview({preset, large = false, filled = [], compact = false, cuts, row}: {preset: Preset; large?: boolean; filled?: readonly number[]; compact?: boolean; cuts?: readonly number[]; row?: number}) {
    return <DrawingArea hexpand={!compact} widthRequest={compact ? 120 : undefined} heightRequest={large ? 148 : 42} onDraw={(widget, cr) => {
        const w = widget.get_allocated_width(), h = widget.get_allocated_height(), gap = large ? 8 : 4;
        const columns = cuts ? [0, ...cuts, 10000].slice(1).map((value, index) => value - [0, ...cuts][index]) : [...preset.widths];
        const total = columns.reduce((sum: number, width) => sum + width, 0);
        let left = 0;
        preset.widths.forEach((original, index) => {
            const width = columns[index] ?? original;
            const quarters = preset.id === 'quarters';
            const split = (cuts?.[0] ?? 5000) / 10000, horizontal = (row ?? 5000) / 10000;
            const x = quarters ? index % 2 ? w * split : 0 : left;
            const y = quarters ? index >= 2 ? h * horizontal : 0 : 0;
            const rw = (quarters ? w * (index % 2 ? 1 - split : split) : w * width / total) - gap, rh = (quarters ? h * (index >= 2 ? 1 - horizontal : horizontal) : h) - gap;
            const assigned = !!filled[index];
            cr.setSourceRGBA(...rgbOf(activePalette().accent), large ? assigned ? 0.32 : 0.09 : 0.65);
            cr.rectangle(x + gap / 2, y + gap / 2, rw, rh); cr.fillPreserve();
            cr.setSourceRGBA(...rgbOf(activePalette().accentFg), assigned ? 0.85 : 0.35); cr.setLineWidth(1); cr.stroke();
            if (large) {cr.setSourceRGBA(...rgbOf(activePalette().fgStrong), 1); cr.setFontSize(22); cr.moveTo(x + rw / 2 - 5, y + rh / 2 + 8); cr.showText(String(index + 1));}
            left += w * width / total;
        });
        return false;
    }} />;
}
export function SnapLayouts({controls, dismiss}: {controls?: WindowControls; dismiss(): void}) {
    const [, refresh] = useState(0);
    useEffect(() => controls?.subscribe(() => refresh(value => value + 1)), [controls]);
    const [tab, setTab] = useState<'layouts' | 'groups'>('layouts');
    const [layout, setLayout] = useState('halves');
    const [ids, setIds] = useState<number[]>([]);
    const preset = snapLayouts.find(item => item.id === layout)!;
    const desktop = controls?.desktops?.find(item => item.active);
    const windows = (controls?.state ?? []).filter(window => !window.sticky && (!desktop || window.desktop === desktop.id));
    const ready = validSnapMembers(layout, ids, windows) !== undefined;
    const groups = controls?.snapGroups ?? [];
    const chosen = preset.regions.filter((_, index) => windows.some(window => window.id === ids[index])).length;
    return <Box id="snap-panel" orientation="vertical" spacing={0} expand>
        <Box className="snap-header" spacing={16}>
            <Box className="snap-emblem" valign="center"><Image iconName="view-grid-symbolic" pixelSize={24} /></Box>
            <Box orientation="vertical" spacing={5} expand><Label className="snap-eyebrow" xalign={0}>YOUR WORKSPACE, ARRANGED</Label><Label className="snap-heading" xalign={0}>Snap</Label><Label className="snap-muted" xalign={0}>A place for every window. A group for every task.</Label></Box>
            <Label className="snap-keycap" valign="center">Super + Z</Label>
            <Button id="snap-dismiss" className="snap-close" valign="center" tooltip="Close - Esc" onClicked={dismiss}><Image iconName="window-close-symbolic" pixelSize={18} /></Button>
        </Box>
        <Box className="snap-tabs" spacing={6}><Button id="snap-tab-layouts" className={`snap-tab ${tab === 'layouts' ? 'snap-tab-active' : ''}`} onClicked={() => setTab('layouts')}>Snap Layouts</Button><Button id="snap-tab-groups" className={`snap-tab ${tab === 'groups' ? 'snap-tab-active' : ''}`} onClicked={() => setTab('groups')}><Box spacing={8}><Label>Snap Groups</Label><Label className="snap-count">{String(groups.length)}</Label></Box></Button><Label className="snap-muted" expand xalign={1}>{desktop?.name && !/^(?:Workspace\s*)?\d+$/i.test(desktop.name) ? desktop.name : `Desktop ${desktop?.id ?? 1}`}</Label></Box>
        <ScrolledWindow expand hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            {tab === 'layouts' ? <Box className="snap-body" orientation="vertical" spacing={14}>
                <Box spacing={10}><Label className="snap-section-title" expand xalign={0}>Choose your layout</Label><Label className="snap-muted">5 ways to make room</Label></Box>
                <Box spacing={10} homogeneous>{snapLayouts.map(item => <Button key={item.id} id={`snap-layout-${item.id}`} className={`snap-layout-card ${layout === item.id ? 'snap-selected' : ''}`} tooltip={item.name} onClicked={() => {setLayout(item.id); setIds([]);}}><Box orientation="vertical" spacing={10}><SnapPreview preset={item} /><Label className="snap-layout-name">{item.name}</Label></Box></Button>)}</Box>
                <Box className="snap-editor" spacing={24}>
                    <Box className="snap-monitor" orientation="vertical" spacing={14} expand><Box spacing={8}><Image iconName="video-display-symbolic" pixelSize={16} /><Label className="snap-section-title" expand xalign={0}>{preset.name}</Label><Label className="snap-muted">Preview</Label></Box><SnapPreview preset={preset} large filled={ids.map(id => windows.some(window => window.id === id) ? id : 0)} /><Label className="snap-muted" wrap>Each number matches a window on the right.</Label></Box>
                    <Box orientation="vertical" spacing={12} widthRequest={300}><Label className="snap-section-title" xalign={0}>Place your windows</Label>{preset.regions.map((region, index) => <Box key={`${layout}-${region}`} spacing={10}><Label className={`snap-slot ${ids[index] ? 'snap-slot-filled' : ''}`} valign="center">{String(index + 1).padStart(2, '0')}</Label><Box orientation="vertical" spacing={4} expand><Label className="snap-muted" xalign={0}>{positionNames[region]}</Label><ComboBoxText id={`snap-window-${index}`} ref={widget => {widget?.get_cells().forEach(cell => {if (cell instanceof Gtk.CellRendererText) {cell.set_property('ellipsize', Pango.EllipsizeMode.END); cell.set_property('width-chars', 24);}});}} sensitive={controls?.canSnap === true} activeId={String(ids[index] ?? '')} items={[{id: '', text: 'Choose a window'}, ...windows.filter(window => window.id === ids[index] || !ids.includes(window.id)).map(window => ({id: String(window.id), text: window.title || window.appId}))]} onChanged={widget => {const next = [...ids]; next[index] = Number(widget.get_active_id()); setIds(next);}} /></Box></Box>)}</Box>
                </Box>
                {!controls?.canSnap && <Label id="snap-unavailable" className="snap-muted" wrap xalign={0}>Snap Layouts requires the updated Dev OS compositor.</Label>}
                {controls?.canSnap && windows.length < preset.regions.length && <Label id="snap-insufficient" className="snap-muted" wrap xalign={0}>{`Open ${preset.regions.length} windows on this desktop to fill this layout.`}</Label>}
            </Box> : <Box className="snap-body" orientation="vertical" spacing={14}>
                <Box orientation="vertical" spacing={5}><Label className="snap-section-title" xalign={0}>Pick up where you left off</Label><Label className="snap-muted" wrap xalign={0}>Restore a whole set of windows, with their places remembered.</Label></Box>
                {groups.length ? groups.map(group => <Box key={group.id} className="snap-group-card" spacing={14}><Box widthRequest={120} valign="center"><SnapPreview preset={snapLayouts.find(item => item.id === group.layout) ?? snapLayouts[0]} compact cuts={group.cuts} row={group.row} /></Box><Box orientation="vertical" spacing={6} expand><Label className="snap-section-title" xalign={0}>{snapLayouts.find(item => item.id === group.layout)?.name ?? 'Snap group'}</Label><Label className="snap-muted" xalign={0} maxWidthChars={48} ellipsize={Pango.EllipsizeMode.END}>{group.members.map(member => controls?.state.find(window => window.id === member.id)?.title).join(' + ')}</Label><Label className="snap-muted" xalign={0}>{`${group.members.length} windows`}</Label></Box><Button id={`snap-group-${group.id}`} className="snap-secondary" valign="center" onClicked={() => {dismiss(); controls?.restoreSnapGroup?.(group.id);}}>Restore group</Button><Button id={`snap-remove-${group.id}`} className="snap-close" valign="center" tooltip="Forget this group" onClicked={() => controls?.removeSnapGroup?.(group.id)}><Image iconName="window-close-symbolic" pixelSize={14} /></Button></Box>) : <Box id="snap-groups-empty" className="snap-empty" orientation="vertical" spacing={14}><Image iconName="view-grid-symbolic" pixelSize={40} /><Label className="snap-section-title">Your next workspace starts here</Label><Label className="snap-muted" wrap>Arrange a layout to save your first Snap Group.</Label><Button id="snap-create-first" className="snap-secondary" halign="center" onClicked={() => setTab('layouts')}>Choose a layout</Button></Box>}
            </Box>}
        </ScrolledWindow>
        <Box className="snap-footer" spacing={12}><Label className="snap-muted" expand xalign={0}>{tab === 'layouts' ? `${chosen} of ${preset.regions.length} windows selected` : 'Groups stay available until you sign out.'}</Label>{tab === 'layouts' ? <Button id="snap-apply" className="snap-primary" sensitive={ready && controls?.canSnap === true} onClicked={() => {dismiss(); controls?.arrange?.(layout, ids);}}>Arrange &amp; save group</Button> : <Label className="snap-keycap">Esc to close</Label>}</Box>
    </Box>;
}
export class SnapPanel {
    readonly window: Gtk.ApplicationWindow;
    private root: ReturnType<typeof createRoot>;
    private motion: OverlayMotion;
    private focusSource = 0;
    constructor(private context: UIContext) {
        this.window = layerWindow(context.application, 'dev-os-snap', GtkLayerShell.Layer.OVERLAY, null, [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT], GtkLayerShell.KeyboardMode.EXCLUSIVE);
        this.window.name = 'snap'; GtkLayerShell.set_exclusive_zone(this.window, -1);
        this.window.set_resizable(true);
        this.motion = new OverlayMotion(this.window); this.root = createRoot(this.motion.content);
        this.window.connect('key-press-event', (_window, event) => {
            if ((event as unknown as Gdk.Event).get_keyval()[1] === Gdk.KEY_Escape) {this.hide(); return true;}
            return false;
        });
    }
    show(monitor?: Gdk.Monitor) {
        const target = monitor ?? this.context.display.get_primary_monitor() ?? this.context.monitors()[0];
        if (target) GtkLayerShell.set_monitor(this.window, target);
        this.root.render(<SnapLayouts controls={this.context.windows} dismiss={() => this.hide()} />); this.motion.show();
        if (this.focusSource) GLib.source_remove(this.focusSource);
        this.focusSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.focusSource = 0;
            const focus = (widget: Gtk.Widget): Gtk.Widget | undefined => {
                if (widget.name === 'snap-layout-halves') return widget;
                if (widget instanceof Gtk.Container) for (const child of widget.get_children()) {const found = focus(child); if (found) return found;}
                return undefined;
            };
            if (this.motion.isOpen) focus(this.window)?.grab_focus(); return GLib.SOURCE_REMOVE;
        });
    }
    hide() {if (this.focusSource) GLib.source_remove(this.focusSource); this.focusSource = 0; this.motion.hide(() => this.root.render(null));}
    toggle(monitor?: Gdk.Monitor) {if (this.motion.isOpen) this.hide(); else this.show(monitor);}
    destroy() {if (this.focusSource) GLib.source_remove(this.focusSource); this.motion.dispose(); this.root.unmount(); this.window.destroy();}
}
