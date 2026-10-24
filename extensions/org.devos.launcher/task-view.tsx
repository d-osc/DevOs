import {React, Gtk, Gdk, GLib, GtkLayerShell, Pango, Box, Label, Image, Button, ComboBoxText, ScrolledWindow, FlowBox, FlowBoxChild, createRoot, useState, useEffect, type UIContext} from '@dev-os/core';
import {layerWindow} from '@dev-os/services/layers';
import {desktopApps, findDesktopApp} from '@dev-os/services/apps';
import {windowGroup, type WindowControls, type DesktopWindow, type DesktopWorkspace} from '@dev-os/services/windows';
import {OverlayMotion} from './overlay-motion.js';

const desktopName = (desktop: DesktopWorkspace) => !desktop.name || /^(?:Workspace\s*)?\d+$/i.test(desktop.name) ? `Desktop ${desktop.id}` : desktop.name;
export function TaskViewContent({windows, desktops = [], dismiss, activate, close, switchDesktop, moveToDesktop, createDesktop, removeDesktop}: {windows: readonly DesktopWindow[]; desktops?: readonly DesktopWorkspace[]; dismiss(): void; activate(id: number): void; close?(id: number): void; createDesktop?(): void; removeDesktop?(id: number): void; switchDesktop?(id: number): void; moveToDesktop?(id: number, desktop: number): void}) {
    const apps = desktopApps();
    const current = desktops.find(desktop => desktop.active);
    const visible = current ? windows.filter(window => window.desktop === current.id || window.sticky || window.desktop === undefined) : windows;
    const desktopCount = Math.max(1, desktops.length);
    const info = (window: DesktopWindow) => {
        const group = windowGroup(window), app = findDesktopApp(apps, group);
        return {app, title: app?.get_display_name() || ({terminal: 'Terminal', files: 'Files', settings: 'Settings', 'dev-os-editor': 'Editor'} as Record<string, string>)[group] || group,
            icon: group === 'terminal' ? 'utilities-terminal-symbolic' : group === 'files' ? 'folder-symbolic' : group === 'settings' ? 'preferences-system-symbolic' : group === 'dev-os-editor' ? 'dev-os-editor' : 'application-x-executable-symbolic'};
    };
    return <Box className="task-view-content" orientation="vertical" spacing={16} borderWidth={16} expand>
        <Box className="task-view-header" spacing={20}>
            <Box orientation="vertical" spacing={7} expand><Label className="task-view-eyebrow" xalign={0}>WORKSPACE OVERVIEW</Label><Label className="task-view-heading" xalign={0}>Task View</Label><Label id="task-view-desktop-title" className="task-view-description" xalign={0}>{`${current ? `${desktopName(current)}  ·  ` : ''}${visible.length} open window${visible.length === 1 ? '' : 's'}`}</Label></Box>
            <Box className="task-view-summary" spacing={10} valign="center"><Image iconName="view-grid-symbolic" pixelSize={16} /><Label>{`${desktopCount} desktop${desktopCount === 1 ? '' : 's'}  ·  ${windows.length} window${windows.length === 1 ? '' : 's'}`}</Label></Box>
            <Button id="task-view-dismiss" className="task-view-dismiss launcher-icon-button" valign="center" tooltip="Close Task View · Esc" onClicked={dismiss}><Image iconName="window-close-symbolic" pixelSize={16} /></Button>
        </Box>
        <Box spacing={10}><Label className="task-view-section-title" xalign={0}>Open windows</Label><Label className="task-view-count">{String(visible.length)}</Label><Label className="task-view-description" xalign={1} expand>Choose a window to continue</Label></Box>
        <ScrolledWindow expand hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            {visible.length ? <FlowBox id="task-view-windows" halign="fill" ref={widget => {widget?.set_homogeneous(true);}} valign="start" selectionMode={Gtk.SelectionMode.NONE} activateOnSingleClick={false} minChildrenPerLine={1} maxChildrenPerLine={Math.min(4, visible.length)} rowSpacing={18} columnSpacing={18}>
                {visible.map(window => {
                    const {app, icon, title} = info(window);
                    return <FlowBoxChild key={window.id} halign="center" valign="start"><Box className={`task-view-card ${window.active ? 'task-view-active' : ''}`} orientation="vertical" spacing={0} widthRequest={274}>
                        <Box className="task-view-card-header" spacing={9}><Image gicon={app?.get_icon()} iconName={icon} pixelSize={16} /><Label className="task-view-app" xalign={0} expand ellipsize={Pango.EllipsizeMode.END} maxWidthChars={20}>{title}</Label>{close && <Button id={`task-view-close-${window.id}`} className="task-view-close" tooltip={`Close ${window.title}`} onClicked={() => close(window.id)}><Image iconName="window-close-symbolic" pixelSize={12} /></Button>}</Box>
                        <Button id={`task-view-activate-${window.id}`} className="task-view-window" tooltip={window.title} onClicked={() => activate(window.id)}>
                            <Box className="task-view-card-body" orientation="vertical" spacing={14} heightRequest={120}><Box className="task-view-app-emblem" halign="center" widthRequest={48} heightRequest={48}><Image gicon={app?.get_icon()} iconName={icon} pixelSize={28} expand /></Box><Label className="task-view-window-title" wrap ref={widget => {widget?.set_lines(2);}} maxWidthChars={25} ellipsize={Pango.EllipsizeMode.END}>{window.title || app?.get_display_name() || 'Untitled window'}</Label><Box className={`task-view-window-state ${window.active ? 'task-view-state-active' : ''}`} spacing={6} halign="center"><Image iconName={window.minimized ? 'window-minimize-symbolic' : window.active ? 'media-record-symbolic' : 'window-symbolic'} pixelSize={10} /><Label>{window.minimized ? 'Minimized' : window.active ? 'Active now' : 'Open'}</Label></Box></Box>
                        </Button>
                        {moveToDesktop && desktops.length > 1 && <Box className="task-view-move" spacing={8}><Label className="task-view-description" xalign={0} expand>{window.sticky ? 'On every desktop' : 'Move to'}</Label><ComboBoxText id={`task-view-move-${window.id}`} sensitive={!window.sticky && window.desktop !== undefined} activeId={String(window.desktop ?? current?.id ?? '')} items={desktops.map(desktop => ({id: String(desktop.id), text: desktopName(desktop)}))} onChanged={widget => {const target = Number(widget.get_active_id()); if (target !== window.desktop && desktops.some(desktop => desktop.id === target)) moveToDesktop(window.id, target);}} /></Box>}
                    </Box></FlowBoxChild>;
                })}
            </FlowBox> : <Box id="task-view-empty" orientation="vertical" spacing={14} expand valign="center"><Box className="task-view-empty-emblem" widthRequest={80} heightRequest={80} halign="center"><Image iconName="view-grid-symbolic" pixelSize={32} expand /></Box><Label className="task-view-empty-title">A fresh workspace</Label><Label className="task-view-description">{current ? `No open windows on ${desktopName(current)}.` : 'Your open windows will appear here.'}</Label><Label className="task-view-description">Open an app or choose another desktop below.</Label></Box>}
        </ScrolledWindow>
        {desktops.length > 0 && switchDesktop && <Box className="task-view-desktops" orientation="vertical" spacing={10}>
            <Box spacing={10}><Box orientation="vertical" spacing={4} expand><Label className="task-view-section-title" xalign={0}>Your desktops</Label><Label className="task-view-description" xalign={0}>Separate your work, keep your place.</Label></Box>{createDesktop && <Button id="task-view-create-desktop" className="task-view-new-desktop" tooltip="Create and switch to a new desktop" onClicked={createDesktop}><Box spacing={7}><Image iconName="list-add-symbolic" pixelSize={16} /><Label>New desktop</Label></Box></Button>}{removeDesktop && current && <Button id="task-view-remove-desktop" className="task-view-remove-desktop" sensitive={desktops.length > 1} tooltip={`Remove ${desktopName(current)} · Windows move to the previous desktop, or the next if this is the first`} onClicked={() => removeDesktop(current.id)}><Box spacing={7}><Image iconName="list-remove-symbolic" pixelSize={16} /><Label>Remove</Label></Box></Button>}</Box>
            <ScrolledWindow hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC} vscrollbarPolicy={Gtk.PolicyType.NEVER}><Box spacing={12}>{desktops.map(desktop => {
                const members = windows.filter(window => window.desktop === desktop.id || window.sticky);
                return <Button key={desktop.id} id={`task-view-desktop-${desktop.id}`} className={`task-view-desktop ${desktop.active ? 'task-view-desktop-current' : ''}`} tooltip={`Switch to ${desktopName(desktop)}`} onClicked={() => switchDesktop(desktop.id)}><Box orientation="vertical" spacing={10} widthRequest={156}><Box className={`task-view-desktop-canvas task-view-canvas-${desktop.id % 3}`} spacing={8} heightRequest={30}><Label className="task-view-desktop-number" expand xalign={0}>{String(desktop.id).padStart(2, '0')}</Label>{members.slice(0, 3).map(window => {const {app, icon} = info(window); return <Box key={window.id} className="task-view-desktop-app" valign="center"><Image gicon={app?.get_icon()} iconName={icon} pixelSize={14} /></Box>;})}</Box><Box spacing={8}><Label className="task-view-desktop-name" xalign={0} expand>{desktopName(desktop)}</Label>{desktop.active && <Image iconName="emblem-ok-symbolic" pixelSize={13} />}</Box><Label className="task-view-description" xalign={0}>{`${members.length} window${members.length === 1 ? '' : 's'}${desktop.active ? '  ·  Current' : ''}`}</Label></Box></Button>;
            })}</Box></ScrolledWindow>
        </Box>}
        <Box className="task-view-footer" spacing={10}><Label className="task-view-keycap">Super + Tab</Label><Label className="task-view-description">Task View</Label><Label className="task-view-description" expand xalign={1} wrap>Tab / arrows to navigate   ·   Enter to open   ·   Esc to close</Label></Box>
    </Box>;
}
export function TaskViewLive({controls, dismiss, changed}: {controls?: WindowControls; dismiss(): void; changed?(): void}) {
    const snapshot = () => ({windows: controls?.state ?? [], desktops: controls?.desktops ?? [], canCreate: controls?.canCreateDesktop === true, canRemove: controls?.canRemoveDesktop === true});
    const [state, update] = useState(snapshot);
    useEffect(() => {update(snapshot()); return controls?.subscribe(() => update(snapshot()));}, [controls]);
    useEffect(() => {changed?.();}, [state, changed]);
    return <TaskViewContent windows={state.windows} desktops={state.desktops} dismiss={dismiss} activate={id => {dismiss(); controls?.activate(id);}} close={controls?.close ? id => controls.close!(id) : undefined}
        removeDesktop={state.canRemove && controls?.removeDesktop ? id => controls.removeDesktop!(id) : undefined} createDesktop={state.canCreate && controls?.createDesktop ? () => controls.createDesktop!() : undefined} switchDesktop={controls?.switchDesktop ? id => controls.switchDesktop!(id) : undefined} moveToDesktop={controls?.moveToDesktop ? (id, desktop) => controls.moveToDesktop!(id, desktop) : undefined} />;
}
export class TaskView {
    window: Gtk.ApplicationWindow;
    private root: ReturnType<typeof createRoot>;
    private focusSource = 0;
    private needsFocus = true;
    private motion: OverlayMotion;
    constructor(private context: UIContext) {
        this.window = layerWindow(context.application, 'dev-os-task-view', GtkLayerShell.Layer.OVERLAY, null,
            [GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.RIGHT], GtkLayerShell.KeyboardMode.EXCLUSIVE);
        this.window.name = 'task-view'; GtkLayerShell.set_exclusive_zone(this.window, -1);
        this.window.set_resizable(true);
        this.motion = new OverlayMotion(this.window);
        this.root = createRoot(this.motion.content);
        this.window.connect('key-press-event', (_window, event) => {
            const key = (event as unknown as Gdk.Event).get_keyval()[1];
            if (key === Gdk.KEY_Escape) {this.hide(); return true;}
            if (key === Gdk.KEY_Tab || key === Gdk.KEY_ISO_Left_Tab) {
                const items: Gtk.Widget[] = [];
                const collect = (widget: Gtk.Widget) => {
                    if (widget instanceof Gtk.ComboBoxText || (widget instanceof Gtk.Button && widget.name.startsWith('task-view-'))) {if (widget.get_sensitive()) items.push(widget);}
                    else if (widget instanceof Gtk.Container) widget.get_children().forEach(collect);
                };
                collect(this.window); if (!items.length) return false;
                const focus = this.window.get_focus();
                const index = items.findIndex(item => item === focus || Boolean(focus?.is_ancestor(item)));
                const shift = key === Gdk.KEY_ISO_Left_Tab || Boolean((event as unknown as Gdk.Event).get_state()[1] & Gdk.ModifierType.SHIFT_MASK);
                const next = items[(index + (shift ? -1 : 1) + items.length) % items.length];
                if (next instanceof Gtk.ComboBoxText) next.child_focus(Gtk.DirectionType.TAB_FORWARD); else next.grab_focus();
                return true;
            }
            if ([Gdk.KEY_Return, Gdk.KEY_KP_Enter].includes(key)) {const focus = this.window.get_focus(); if (focus instanceof Gtk.Button) {focus.emit('clicked'); return true;}}
            if (![Gdk.KEY_Left, Gdk.KEY_Right, Gdk.KEY_Up, Gdk.KEY_Down, Gdk.KEY_Home, Gdk.KEY_End].includes(key)) return false;
            const buttons: Gtk.Widget[] = [];
            const prefix = this.window.get_focus()?.name.startsWith('task-view-desktop-') ? 'task-view-desktop-' : 'task-view-activate-';
            const collect = (widget: Gtk.Widget) => {if (widget.name.startsWith(prefix)) buttons.push(widget); else if (widget instanceof Gtk.Container) widget.get_children().forEach(collect);};
            collect(this.window); if (!buttons.length) return false;
            const current = buttons.indexOf(this.window.get_focus()!);
            const firstY = buttons[0].translate_coordinates(this.window, 0, 0)[2];
            const columns = buttons.filter(button => button.translate_coordinates(this.window, 0, 0)[2] === firstY).length || 1;
            const offset = key === Gdk.KEY_Up ? -columns : key === Gdk.KEY_Down ? columns : key === Gdk.KEY_Left ? -1 : 1;
            const index = key === Gdk.KEY_Home ? 0 : key === Gdk.KEY_End ? buttons.length - 1 : (Math.max(0, current) + offset + buttons.length) % buttons.length;
            buttons[index].grab_focus(); return true;
        });
    }
    show(monitor?: Gdk.Monitor) {
        this.context.invoke('launcher.hide');
        const target = monitor ?? this.context.display.get_primary_monitor() ?? this.context.monitors()[0];
        if (target) GtkLayerShell.set_monitor(this.window, target);
        this.needsFocus = true;
        this.root.render(<TaskViewLive controls={this.context.windows} dismiss={() => this.hide()} changed={() => this.focusFirst()} />);
        this.motion.show(); print(`Dev OS Task View ready: ${this.context.windows?.state.length ?? 0} windows`); this.focusFirst();
    }
    private focusFirst() {
        if (!this.needsFocus || this.focusSource) return;
        this.focusSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.focusSource = 0; if (!this.motion.isOpen) return GLib.SOURCE_REMOVE;
            const focus = (widget: Gtk.Widget): Gtk.Widget | undefined => {
                if (widget.name.startsWith('task-view-activate-')) return widget;
                if (widget instanceof Gtk.Container) for (const child of widget.get_children()) {const found = focus(child); if (found) return found;}
                return undefined;
            };
            const button = focus(this.window); if (button) {button.grab_focus(); this.needsFocus = false;}
            return GLib.SOURCE_REMOVE;
        });
    }
    hide() {const visible = this.motion.isOpen; if (this.focusSource) {GLib.source_remove(this.focusSource); this.focusSource = 0;} this.motion.hide(() => this.root.render(null)); if (visible) print('Dev OS Task View hidden');}
    toggle(monitor?: Gdk.Monitor) {if (this.motion.isOpen) this.hide(); else this.show(monitor);}
    destroy() {this.motion.dispose(); if (this.focusSource) GLib.source_remove(this.focusSource); this.root.unmount(); this.window.destroy();}
}
