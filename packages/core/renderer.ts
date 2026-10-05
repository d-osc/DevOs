import './runtime.js';
import React from 'react';
import Reconciler from 'react-reconciler';
import {ConcurrentRoot, DefaultEventPriority, DiscreteEventPriority} from 'react-reconciler/constants.js';
import {Gtk} from './native.js';
import {widgetFactories} from './widgets.js';

import type {Alignment} from './props.js';
import type {GioTypes as Gio} from './gir-types.js';

const signals: Record<string, string> = {onClicked: 'clicked', onChanged: 'changed', onActivate: 'activate',
    onValueChanged: 'value-changed', onToggled: 'toggled', onActiveChanged: 'notify::active', onRowActivated: 'row-activated',
    onRowSelected: 'row-selected', onChildActivated: 'child-activated',
    onSelectedChildrenChanged: 'selected-children-changed', onDraw: 'draw',
    onVisibleChildChanged: 'notify::visible-child', onSwitchPage: 'switch-page',
    onPositionChanged: 'notify::position', onExpandedChanged: 'notify::expanded',
    onActivateLink: 'activate-link', onButtonPress: 'button-press-event', onButtonRelease: 'button-release-event'};
const properties: Record<string, string> = {spacing: 'spacing', homogeneous: 'homogeneous', text: 'text',
    active: 'active', activateOnSingleClick: 'activate_on_single_click',
    minChildrenPerLine: 'min_children_per_line', maxChildrenPerLine: 'max_children_per_line',
    rowSpacing: 'row_spacing', columnSpacing: 'column_spacing', placeholder: 'placeholder_text', editable: 'editable',
    maxLength: 'max_length', wrap: 'wrap', selectable: 'selectable',
    xalign: 'xalign', yalign: 'yalign', maxWidthChars: 'max_width_chars',
    widthChars: 'width_chars', ellipsize: 'ellipsize', hexpand: 'hexpand', vexpand: 'vexpand',
    sensitive: 'sensitive', marginTop: 'margin_top', marginBottom: 'margin_bottom',
    marginStart: 'margin_start', marginEnd: 'margin_end', borderWidth: 'border_width',
    drawValue: 'draw_value', pixelSize: 'pixel_size', selectionMode: 'selection_mode',
    hscrollbarPolicy: 'hscrollbar_policy', vscrollbarPolicy: 'vscrollbar_policy', minContentHeight: 'min_content_height',
    rowHomogeneous: 'row_homogeneous', columnHomogeneous: 'column_homogeneous', transitionType: 'transition_type',
    transitionDuration: 'transition_duration', showTabs: 'show_tabs', showBorder: 'show_border',
    scrollable: 'scrollable', tabPosition: 'tab_pos', position: 'position',
    wideHandle: 'wide_handle', label: 'label', labelXalign: 'label_xalign',
    labelYalign: 'label_yalign', shadowType: 'shadow_type', expanded: 'expanded',
    revealChild: 'reveal_child', visibleWindow: 'visible_window', aboveChild: 'above_child',
    layoutStyle: 'layout_style', title: 'title', subtitle: 'subtitle',
    showCloseButton: 'show_close_button', hasSubtitle: 'has_subtitle', decorationLayout: 'decoration_layout',
    uri: 'uri', visited: 'visited', popup: 'popup',
    popover: 'popover', direction: 'direction', fraction: 'fraction',
    showText: 'show_text', inverted: 'inverted', minValue: 'min_value',
    maxValue: 'max_value', mode: 'mode', digits: 'digits',
    numeric: 'numeric', cursorVisible: 'cursor_visible', monospace: 'monospace',
    wrapMode: 'wrap_mode', acceptsTab: 'accepts_tab', leftMargin: 'left_margin',
    rightMargin: 'right_margin', topMargin: 'top_margin', bottomMargin: 'bottom_margin',
    activatesDefault: 'activates_default', minContentWidth: 'min_content_width', maxContentHeight: 'max_content_height',
    maxContentWidth: 'max_content_width'};
const special = new Set(['children', 'ref', 'key', 'className', 'id', 'tooltip',
    'orientation', 'halign', 'valign', 'visible', 'iconName', 'iconSize', 'gicon',
    'value', 'lower', 'upper', 'step', 'items', 'activeId', 'password', 'visibleChildName', 'currentPage',
    'gridLeft', 'gridTop', 'gridWidth', 'gridHeight', 'pageName', 'pageTitle', 'tabLabel', 'overlay', 'resize', 'shrink', 'widthRequest', 'heightRequest', 'pack', 'expand', 'fill', 'padding']);
const context = {};
let priority = 0;
let committing = false;
type HostProps = Record<string, unknown> & {
    children?: React.ReactNode; className?: string; id?: string; tooltip?: string;
    orientation?: string; halign?: Alignment; valign?: Alignment; visible?: boolean;
    iconName?: string; iconSize?: Gtk.IconSize; widthRequest?: number; heightRequest?: number;
    gicon?: Gio.Icon | null;
    pack?: string; expand?: boolean; fill?: boolean; padding?: number;
};
interface ParentNode {type: string; widget: Gtk.Widget; children: HostNode[];}
interface HostNode extends ParentNode {
    props: HostProps; parent: ParentNode | null; defaults: Map<string, unknown>;
    signals: Map<string, {target: Gtk.Widget | Gtk.TextBuffer; id: number}>;
    hidden: boolean; applying: boolean; initialized: boolean; committed: boolean;
}
export interface Root {render(element: React.ReactNode): void; unmount(): void;}
export interface RootOptions {onError?: (error: Error) => void;}
type Renderer = Reconciler.Reconciler<ParentNode, HostNode, HostNode, never, never, Gtk.Widget>;
type HostConfig = Reconciler.HostConfig<string, HostProps, ParentNode, HostNode, HostNode,
    never, never, never, never, Gtk.Widget, object, never, number, -1, null, null, null, never, never, never>;
let renderer: Renderer;

function plainText(value: unknown): string | null {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value === null || value === undefined || typeof value === 'boolean') return '';
    if (Array.isArray(value)) {
        const parts = value.map(plainText);
        if (parts.every(part => part !== null)) return parts.join('');
    }
    return null;
}
function textContent(type: string, props: HostProps): boolean {
    return ['label', 'button', 'check-button', 'toggle-button', 'link-button', 'menu-button'].includes(type) &&
        props.children !== undefined && plainText(props.children) !== null;
}
function show(node: HostNode): void {
    node.children.forEach(show);
    if (!node.hidden && node.props.visible !== false) node.widget.show();
    else node.widget.hide();
}
function apply(node: HostNode, next: HostProps): void {
    const previous = node.props;
    const changed = (key: string) => !node.initialized || previous[key] !== next[key];
    // Runtime property/signal names come from the validated whitelist above.
    const native = node.widget as unknown as Record<string, unknown>;
    const connect = node.widget.connect as unknown as
        (signal: string, callback: (...args: unknown[]) => unknown) => number;
    node.applying = true;
    try {
        for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
            if (key in signals) {
                if (next[key] !== undefined && typeof next[key] !== 'function')
                    throw new Error(`${key} must be a function`);
                // The wrapper reads node.props at dispatch time, so replacing a
                // callback does not require disconnecting/reconnecting GTK.
                if (!next[key] && node.signals.has(key)) {
                    const connection = node.signals.get(key)!;
                    connection.target.disconnect(connection.id); node.signals.delete(key);
                }
                const target = key === 'onChanged' && node.widget instanceof Gtk.TextView
                    ? node.widget.get_buffer() : node.widget;
                if (next[key] && !node.signals.has(key)) node.signals.set(key, {target, id: connect.call(target, signals[key], (...args: unknown[]) => {
                    if (node.applying || committing || !node.committed) return;
                    const saved = priority; priority = DiscreteEventPriority;
                    try {
                        const handler = node.props[key] as (...args: unknown[]) => unknown;
                        return renderer.flushSyncFromReconciler(() => handler(
                            ...(target === node.widget ? args : [node.widget, ...args.slice(1)])));
                    }
                    finally { priority = saved; }
                })});
            } else if (key in properties) {
                if (key === 'text' && node.widget instanceof Gtk.TextView) continue;
                const controlled = key === 'active' || (key === 'text' && node.widget instanceof Gtk.Entry);
                if (!changed(key) && !controlled) continue;
                const prop = key === 'text' && node.type === 'label' ? 'label' : properties[key];
                if (!(prop in node.widget)) throw new Error(`${node.type} does not support ${key}`);
                if (!node.defaults.has(key)) node.defaults.set(key, native[prop]);
                const value = next[key] ?? node.defaults.get(key);
                if (native[prop] !== value) native[prop] = value;
            } else if (!special.has(key)) {
                throw new Error(`Unknown GTK prop '${key}' on ${node.type}`);
            }
        }
        if (changed('className')) {
            const before = new Set((previous.className ?? '').split(/\s+/).filter(Boolean));
            const after = new Set((next.className ?? '').split(/\s+/).filter(Boolean));
            const style = node.widget.get_style_context();
            for (const name of before) if (!after.has(name)) style.remove_class(name);
            for (const name of after) if (!before.has(name)) style.add_class(name);
        }
        if (changed('id')) node.widget.name = next.id ?? node.type;
        if (changed('tooltip')) node.widget.set_tooltip_text(next.tooltip ?? null);
        if (changed('orientation') && 'orientation' in node.widget) node.widget.orientation = next.orientation === 'vertical'
            ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        for (const key of ['halign', 'valign'] as const) {
            if (!changed(key)) continue;
            if (!node.defaults.has(key)) node.defaults.set(key, node.widget[key]);
            const alignment = next[key];
            node.widget[key] = alignment === undefined ? node.defaults.get(key) as Gtk.Align
                : typeof alignment === 'number' ? alignment : Gtk.Align[alignment.toUpperCase() as 'START' | 'END' | 'CENTER' | 'FILL' | 'BASELINE'];
        }
        if (changed('widthRequest') || changed('heightRequest'))
            node.widget.set_size_request(next.widthRequest ?? -1, next.heightRequest ?? -1);
        if (node.widget instanceof Gtk.Scale || node.widget instanceof Gtk.SpinButton) {
            const scale = node.widget;
            if (changed('lower') || changed('upper')) scale.set_range(Number(next.lower ?? 0), Number(next.upper ?? 100));
            if (scale instanceof Gtk.SpinButton && changed('step')) {
                const step = Number(next.step ?? 1);
                scale.set_increments(step, step * 10);
            }
            const value = Number(next.value ?? 0);
            if (scale.get_value() !== value) scale.set_value(value);
        }
        if (node.widget instanceof Gtk.LevelBar) {
            if (!node.defaults.has('value')) node.defaults.set('value', node.widget.value);
            node.widget.value = Number(next.value ?? node.defaults.get('value'));
        }
        if (node.widget instanceof Gtk.Entry && changed('password'))
            node.widget.set_visibility(next.password !== true);
        if (node.widget instanceof Gtk.TextView) {
            const buffer = node.widget.get_buffer();
            if (!node.defaults.has('text')) node.defaults.set('text', buffer.text);
            const text = String(next.text ?? node.defaults.get('text'));
            if (buffer.text !== text) buffer.set_text(text, -1);
        }
        if (node.widget instanceof Gtk.ComboBoxText) {
            if (changed('items')) {
                node.widget.remove_all();
                for (const item of (next.items ?? []) as {id: string; text: string}[])
                    node.widget.append(item.id, item.text);
            }
            if (node.widget.get_active_id() !== (next.activeId ?? null))
                node.widget.set_active_id((next.activeId ?? null) as string | null);
        }
        if (node.type === 'image' && (changed('gicon') || changed('iconName') || changed('iconSize'))) {
            const image = node.widget as Gtk.Image;
            if (next.gicon) image.set_from_gicon(next.gicon, next.iconSize ?? Gtk.IconSize.BUTTON);
            else if (next.iconName) image.set_from_icon_name(next.iconName, next.iconSize ?? Gtk.IconSize.BUTTON);
            else image.clear();
        }
        if (textContent(node.type, next) && (!textContent(node.type, previous) || plainText(previous.children) !== plainText(next.children)))
            (node.widget as Gtk.Label | Gtk.Button).set_label(plainText(next.children)!);
        const packingChanged = ['pack', 'expand', 'fill', 'padding', 'gridLeft', 'gridTop',
            'gridWidth', 'gridHeight', 'pageName', 'pageTitle', 'tabLabel', 'overlay', 'resize', 'shrink'].some(changed);
        node.props = next;
        if (packingChanged && node.parent) syncChildren(node.parent);
        if (changed('visible')) node.widget.set_visible(!node.hidden && next.visible !== false);
        node.initialized = true;
    } finally { node.applying = false; }
}
function make(type: string, props: HostProps): HostNode {
    const factory = widgetFactories[type];
    if (!factory) throw new Error(`Unsupported GTK element '${type}'. Use native components such as Box or Button.`);
    const widget = factory();
    const node: HostNode = {type, widget, props: {}, children: [], parent: null,
        defaults: new Map(), signals: new Map(), hidden: false, applying: false, initialized: false, committed: false};
    apply(node, props); return node;
}
function syncBox(parent: ParentNode): void {
    if (!(parent.widget instanceof Gtk.Box)) throw new Error('Box packing requires Gtk.Box');
    const box = parent.widget;
    const centered = parent.children.filter(child => child.props.pack === 'center');
    if (centered.length > 1) throw new Error('A Box accepts at most one pack="center" child');
    const desired = centered[0]?.widget ?? null;
    const current = box.get_center_widget();
    if (current !== desired) {
        if (current) box.remove(current);
        if (desired?.get_parent()) box.remove(desired);
        box.set_center_widget(desired);
    }
    parent.children.forEach((child, index) => {
        if (child.props.pack !== 'center') {
            if (!child.widget.get_parent()) box.pack_start(child.widget, false, true, 0);
            box.set_child_packing(child.widget, child.props.expand ?? false,
                child.props.fill ?? true, child.props.padding ?? 0,
                child.props.pack === 'end' ? Gtk.PackType.END : Gtk.PackType.START);
            box.reorder_child(child.widget, index);
        }
    });
}
function syncChildren(parent: ParentNode): void {
    const widget = parent.widget;
    if (widget instanceof Gtk.Box) { syncBox(parent); return; }
    const owned = 'applying' in parent ? parent as HostNode : null;
    const wasApplying = owned?.applying ?? false;
    if (owned) owned.applying = true;
    try {
        if (widget instanceof Gtk.Grid) {
            parent.children.forEach((child, index) => {
                const values = [child.props.gridLeft ?? 0, child.props.gridTop ?? index,
                    child.props.gridWidth ?? 1, child.props.gridHeight ?? 1];
                if (values.some((value, i) => !Number.isInteger(value) || (i >= 2 && Number(value) < 1)))
                    throw new Error('Grid positions must be integers and spans must be positive');
                ['left-attach', 'top-attach', 'width', 'height'].forEach((key, i) =>
                    widget.child_set_property(child.widget, key, values[i]));
            });
        } else if (widget instanceof Gtk.Stack) {
            const names = new Set<string>();
            parent.children.forEach((child, index) => {
                const name = String(child.props.pageName ?? `page-${index}`);
                if (names.has(name)) throw new Error(`Duplicate Stack page name '${name}'`);
                names.add(name);
                widget.child_set_property(child.widget, 'name', name);
                widget.child_set_property(child.widget, 'title', child.props.pageTitle ?? name);
                widget.child_set_property(child.widget, 'position', index);
            });
        } else if (widget instanceof Gtk.Notebook) {
            parent.children.forEach((child, index) => {
                widget.reorder_child(child.widget, index);
                widget.set_tab_label_text(child.widget, String(child.props.tabLabel ?? `Page ${index + 1}`));
            });
        } else if (widget instanceof Gtk.Paned || widget instanceof Gtk.Overlay ||
            widget instanceof Gtk.HeaderBar || widget instanceof Gtk.ActionBar) {
            if (widget instanceof Gtk.Paned && parent.children.length > 2)
                throw new Error('Paned accepts at most two children');
            if (widget instanceof Gtk.Overlay && parent.children.filter(child => !child.props.overlay).length > 1)
                throw new Error('Overlay accepts one main child; mark other children overlay={true}');
            if ((widget instanceof Gtk.HeaderBar || widget instanceof Gtk.ActionBar) &&
                parent.children.filter(child => child.props.pack === 'center').length > 1)
                throw new Error('HeaderBar and ActionBar accept one pack="center" child');
            for (const child of parent.children)
                if (child.widget.get_parent() === widget) widget.remove(child.widget);
            parent.children.forEach((child, index) => {
                if (widget instanceof Gtk.Paned) {
                    const pack = index === 0 ? widget.pack1 : widget.pack2;
                    pack.call(widget, child.widget, child.props.resize !== false, child.props.shrink !== false);
                } else if (widget instanceof Gtk.Overlay) {
                    if (child.props.overlay) widget.add_overlay(child.widget);
                    else widget.add(child.widget);
                } else if (widget instanceof Gtk.HeaderBar || widget instanceof Gtk.ActionBar) {
                    if (child.props.pack === 'center') {
                        if (widget instanceof Gtk.HeaderBar) widget.set_custom_title(child.widget);
                        else widget.set_center_widget(child.widget);
                    }
                    else if (child.props.pack === 'end') widget.pack_end(child.widget);
                    else widget.pack_start(child.widget);
                }
            });
        }
    } finally { if (owned) owned.applying = wasApplying; }
}
// Selection needs to run after the children exist, including the initial mount.
function syncSelection(parent: ParentNode): void {
    for (const child of parent.children) {
        child.applying = true;
        try {
            if (child.widget instanceof Gtk.Stack && child.props.visibleChildName !== undefined &&
                child.widget.get_visible_child_name() !== child.props.visibleChildName)
                child.widget.set_visible_child_name(String(child.props.visibleChildName));
            if (child.widget instanceof Gtk.Notebook && child.props.currentPage !== undefined &&
                child.widget.get_current_page() !== child.props.currentPage)
                child.widget.set_current_page(Number(child.props.currentPage));
            syncSelection(child);
            child.committed = true;
        } finally { child.applying = false; }
    }
}
function detachWidget(parent: ParentNode, child: HostNode): void {
    const owner = child.widget.get_parent();
    if (owner instanceof Gtk.Container) owner.remove(child.widget);
    // GTK inserts a viewport around non-scrollable children of ScrolledWindow.
    if (owner instanceof Gtk.Viewport && owner !== parent.widget && owner.get_parent() === parent.widget) {
        (parent.widget as Gtk.Container).remove(owner); owner.destroy();
    }
}
function attach(parent: ParentNode, child: HostNode, before: HostNode | null = null): void {
    if (!(parent.widget instanceof Gtk.Container)) throw new Error(`${parent.type} cannot contain widgets`);
    if (child === before) return;
    if (child.parent) {
        const old = child.parent;
        old.children.splice(old.children.indexOf(child), 1);
        detachWidget(old, child);
    }
    if (parent.widget instanceof Gtk.Bin && !(parent.widget instanceof Gtk.Overlay) && parent.children.length)
        throw new Error(`${parent.type} accepts one child. Wrap siblings in a Box.`);
    const index = before ? parent.children.indexOf(before) : parent.children.length;
    parent.children.splice(index, 0, child); child.parent = parent;
    if (parent.widget instanceof Gtk.Box) {
        (parent.widget as Gtk.Box).pack_start(child.widget, false, true, 0); syncBox(parent);
    } else if (parent.widget instanceof Gtk.ListBox || parent.widget instanceof Gtk.FlowBox) parent.widget.insert(child.widget, index);
    else if (parent.widget instanceof Gtk.Notebook) {
        parent.widget.insert_page(child.widget, null, index); syncChildren(parent);
    } else if (parent.widget instanceof Gtk.Paned || parent.widget instanceof Gtk.Overlay ||
        parent.widget instanceof Gtk.HeaderBar || parent.widget instanceof Gtk.ActionBar) syncChildren(parent);
    else { parent.widget.add(child.widget); syncChildren(parent); }
    show(child);
}
function dispose(node: HostNode): void {
    node.children.forEach(dispose);
    for (const {target, id} of node.signals.values()) target.disconnect(id);
    node.signals.clear();
}
function remove(parent: ParentNode, child: HostNode): void {
    parent.children.splice(parent.children.indexOf(child), 1);
    detachWidget(parent, child); child.parent = null;
    dispose(child); child.widget.destroy();
    syncChildren(parent);
}
const noop = () => {};
const hostConfig: HostConfig = {
    extraDevToolsConfig: null,
    getInstanceFromNode: () => null, getInstanceFromScope: () => null,
    beforeActiveInstanceBlur: noop, afterActiveInstanceBlur: noop, prepareScopeUpdate: noop,
    requestPostPaintCallback: callback => { setTimeout(() => callback(performance.now()), 1); },
    suspendOnActiveViewTransition: noop,
    rendererVersion: '0.1.0', rendererPackageName: '@dev-os/core',
    getPublicInstance: node => node.widget,
    getRootHostContext: () => context, getChildHostContext: () => context,
    prepareForCommit: () => { committing = true; return null; },
    resetAfterCommit: container => { try { syncSelection(container); } finally { committing = false; } },
    createInstance: make,
    createTextInstance: text => make('label', {text}),
    appendInitialChild: attach, finalizeInitialChildren: () => false,
    shouldSetTextContent: textContent,
    scheduleTimeout: globalThis.setTimeout, cancelTimeout: globalThis.clearTimeout, noTimeout: -1,
    isPrimaryRenderer: true, supportsMutation: true, supportsPersistence: false, supportsHydration: false,
    supportsMicrotasks: true, scheduleMicrotask: globalThis.queueMicrotask, supportsTestSelectors: false,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; },
    resolveUpdatePriority: () => priority || DefaultEventPriority,
    trackSchedulerEvent: noop, resolveEventType: () => null,
    resolveEventTimeStamp: () => performance.now(), shouldAttemptEagerTransition: () => false,
    detachDeletedInstance: noop, preparePortalMount: noop,
    maySuspendCommit: () => false, maySuspendCommitOnUpdate: () => false,
    maySuspendCommitInSyncRender: () => false, preloadInstance: () => true,
    startSuspendingCommit: () => null, suspendInstance: noop, waitForCommitToBeReady: () => null,
    getSuspendedCommitReason: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null) as unknown as HostConfig['HostTransitionContext'], resetFormInstance: noop,
    bindToConsole: (method, args) => {
        const methods = console as unknown as Record<string, (...values: unknown[]) => void>;
        return methods[method].bind(console, ...args);
    },
    appendChild: attach, appendChildToContainer: attach,
    insertBefore: attach, insertInContainerBefore: attach,
    removeChild: remove, removeChildFromContainer: remove,
    commitUpdate: (node, type, previous, next) => apply(node, next),
    commitTextUpdate: (node, previous, next) => apply(node, {text: next}),
    commitMount: noop,
    resetTextContent: node => {
        if (node.widget instanceof Gtk.Bin) {
            const child = node.widget.get_child();
            if (child) { node.widget.remove(child); child.destroy(); }
        } else (node.widget as Gtk.Label).set_label('');
    },
    hideInstance: node => { node.hidden = true; show(node); },
    hideTextInstance: node => { node.hidden = true; show(node); },
    unhideInstance: node => { node.hidden = false; show(node); },
    unhideTextInstance: node => { node.hidden = false; show(node); },
    clearContainer: container => { for (const child of [...container.children]) remove(container, child); },
};
renderer = Reconciler(hostConfig);

export function flushSync<T>(callback: () => T): T { return renderer.flushSyncFromReconciler(callback); }
const roots = new WeakMap<Gtk.Container, Root>();
export function createRoot(widget: Gtk.Container, {onError = error => console.error(error)}: RootOptions = {}): Root {
    if (!(widget instanceof Gtk.Container)) throw new Error('createRoot requires a Gtk.Container');
    if (roots.has(widget) || widget.get_children().length) throw new Error('createRoot requires an empty, unused container');
    const container: ParentNode = {type: widget instanceof Gtk.Box ? 'box' : 'root', widget, children: []};
    let failure: Error | null = null;
    let mounted = true;
    const report = (error: Error) => { failure = error; onError(error); };
    const fiber = renderer.createContainer(container, ConcurrentRoot, null, false, null, '', report, report, report, noop, null);
    const update = (element: React.ReactNode) => {
        failure = null;
        renderer.updateContainerSync(element, fiber, null, null); renderer.flushSyncWork();
        if (failure) throw failure;
    };
    const root: Root = {
        render(element) { if (!mounted) throw new Error('Root has been unmounted'); update(element); },
        unmount() {
            if (!mounted) return;
            update(null); mounted = false; roots.delete(widget);
        },
    };
    roots.set(widget, root); return root;
}
