import './runtime.js';
import React from 'react';
import Reconciler from 'react-reconciler';
import {ConcurrentRoot, DefaultEventPriority, DiscreteEventPriority} from 'react-reconciler/constants.js';
import Gtk from 'gi://Gtk?version=3.0';
import type {} from '@girs/gtk-3.0';

export type * from './props.js';
import type {Alignment, BoxProps, LabelProps, ButtonProps, EntryProps, SwitchProps,
    CheckButtonProps, ImageProps, SeparatorProps, ScrolledWindowProps,
    ListBoxProps, ListBoxRowProps, FlowBoxProps, FlowBoxChildProps, DrawingAreaProps, ScaleProps} from './props.js';
import type Gio from '@girs/gio-2.0';

export {default as React} from 'react';
export {useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback,
    useReducer, useContext, createContext, Fragment, memo, forwardRef, useImperativeHandle} from 'react';

// Host components are native widgets. Refs expose the actual Gtk.Widget.
function component<P extends object>(name: string): React.FC<P> {
    return props => React.createElement(name, props);
}
export const Box = component<BoxProps>('box'), Label = component<LabelProps>('label');
export const Button = component<ButtonProps>('button'), Entry = component<EntryProps>('entry');
export const SearchEntry = component<EntryProps<Gtk.SearchEntry>>('search-entry');
export const Switch = component<SwitchProps>('switch'), CheckButton = component<CheckButtonProps>('check-button');
export const Image = component<ImageProps>('image'), Separator = component<SeparatorProps>('separator');
export const ScrolledWindow = component<ScrolledWindowProps>('scrolled-window');
export const ListBox = component<ListBoxProps>('list-box'), ListBoxRow = component<ListBoxRowProps>('list-box-row');
export const FlowBox = component<FlowBoxProps>('flow-box'), FlowBoxChild = component<FlowBoxChildProps>('flow-box-child');
export const DrawingArea = component<DrawingAreaProps>('drawing-area');
export const Scale = component<ScaleProps>('scale');
const constructors = {box: Gtk.Box, label: Gtk.Label, button: Gtk.Button, entry: Gtk.Entry,
    'search-entry': Gtk.SearchEntry, switch: Gtk.Switch, 'check-button': Gtk.CheckButton,
    scale: Gtk.Scale, image: Gtk.Image, separator: Gtk.Separator, 'scrolled-window': Gtk.ScrolledWindow,
    'list-box': Gtk.ListBox, 'list-box-row': Gtk.ListBoxRow, 'flow-box': Gtk.FlowBox,
    'flow-box-child': Gtk.FlowBoxChild, 'drawing-area': Gtk.DrawingArea};
const signals: Record<string, string> = {onClicked: 'clicked', onChanged: 'changed', onActivate: 'activate',
    onValueChanged: 'value-changed', onToggled: 'toggled', onActiveChanged: 'notify::active', onRowActivated: 'row-activated',
    onRowSelected: 'row-selected', onChildActivated: 'child-activated',
    onSelectedChildrenChanged: 'selected-children-changed', onDraw: 'draw'};
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
    hscrollbarPolicy: 'hscrollbar_policy', vscrollbarPolicy: 'vscrollbar_policy', minContentHeight: 'min_content_height'};
const special = new Set(['children', 'ref', 'key', 'className', 'id', 'tooltip',
    'orientation', 'halign', 'valign', 'visible', 'iconName', 'iconSize', 'gicon',
    'value', 'lower', 'upper', 'widthRequest', 'heightRequest', 'pack', 'expand', 'fill', 'padding']);
const context = {};
let priority = 0;
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
    signals: Map<string, number>; hidden: boolean; applying: boolean;
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
    return ['label', 'button', 'check-button'].includes(type) &&
        props.children !== undefined && plainText(props.children) !== null;
}
function show(node: HostNode): void {
    node.children.forEach(show);
    if (!node.hidden && node.props.visible !== false) node.widget.show();
    else node.widget.hide();
}
function apply(node: HostNode, next: HostProps): void {
    const previous = node.props;
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
                if (node.signals.has(key)) node.widget.disconnect(node.signals.get(key)!);
                node.signals.delete(key);
                if (next[key]) node.signals.set(key, connect.call(node.widget, signals[key], (...args: unknown[]) => {
                    if (node.applying) return;
                    const saved = priority; priority = DiscreteEventPriority;
                    try {
                        const handler = node.props[key] as (...args: unknown[]) => unknown;
                        return renderer.flushSyncFromReconciler(() => handler(...args));
                    }
                    finally { priority = saved; }
                }));
            } else if (key in properties) {
                const prop = key === 'text' && node.type === 'label' ? 'label' : properties[key];
                if (!(prop in node.widget)) throw new Error(`${node.type} does not support ${key}`);
                if (!node.defaults.has(key)) node.defaults.set(key, native[prop]);
                native[prop] = next[key] ?? node.defaults.get(key);
            } else if (!special.has(key)) {
                throw new Error(`Unknown GTK prop '${key}' on ${node.type}`);
            }
        }
        for (const name of (previous.className ?? '').split(/\s+/).filter(Boolean))
            node.widget.get_style_context().remove_class(name);
        for (const name of (next.className ?? '').split(/\s+/).filter(Boolean))
            node.widget.get_style_context().add_class(name);
        node.widget.name = next.id ?? node.type;
        node.widget.set_tooltip_text(next.tooltip ?? null);
        if ('orientation' in node.widget) node.widget.orientation = next.orientation === 'vertical'
            ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL;
        for (const key of ['halign', 'valign'] as const) {
            if (!node.defaults.has(key)) node.defaults.set(key, node.widget[key]);
            const alignment = next[key];
            node.widget[key] = alignment === undefined ? node.defaults.get(key) as Gtk.Align
                : typeof alignment === 'number' ? alignment : Gtk.Align[alignment.toUpperCase() as 'START' | 'END' | 'CENTER' | 'FILL' | 'BASELINE'];
        }
        node.widget.set_size_request(next.widthRequest ?? -1, next.heightRequest ?? -1);
        if (node.type === 'scale') {
            const scale = node.widget as Gtk.Scale;
            scale.set_range(Number(next.lower ?? 0), Number(next.upper ?? 100));
            scale.set_value(Number(next.value ?? 0));
        }
        if (node.type === 'image') {
            const image = node.widget as Gtk.Image;
            if (next.gicon) image.set_from_gicon(next.gicon, next.iconSize ?? Gtk.IconSize.BUTTON);
            else if (next.iconName) image.set_from_icon_name(next.iconName, next.iconSize ?? Gtk.IconSize.BUTTON);
            else image.clear();
        }
        if (textContent(node.type, next)) (node.widget as Gtk.Label | Gtk.Button).set_label(plainText(next.children)!);
        node.props = next;
        if (node.parent?.type === 'box') syncBox(node.parent);
        show(node);
    } finally { node.applying = false; }
}
function make(type: string, props: HostProps): HostNode {
    const Constructor = constructors[type as keyof typeof constructors];
    if (!Constructor) throw new Error(`Unsupported GTK element '${type}'. Use native components such as Box or Button.`);
    const node: HostNode = {type, widget: type === 'scale' ? Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 1) : new Constructor(), props: {}, children: [], parent: null,
        defaults: new Map(), signals: new Map(), hidden: false, applying: false};
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
    if (parent.widget instanceof Gtk.Bin && parent.children.length)
        throw new Error(`${parent.type} accepts one child. Wrap siblings in a Box.`);
    const index = before ? parent.children.indexOf(before) : parent.children.length;
    parent.children.splice(index, 0, child); child.parent = parent;
    if (parent.type === 'box') {
        (parent.widget as Gtk.Box).pack_start(child.widget, false, true, 0); syncBox(parent);
    } else if (parent.widget instanceof Gtk.ListBox || parent.widget instanceof Gtk.FlowBox) parent.widget.insert(child.widget, index);
    else parent.widget.add(child.widget);
    show(child);
}
function dispose(node: HostNode): void {
    node.children.forEach(dispose);
    for (const id of node.signals.values()) node.widget.disconnect(id);
    node.signals.clear();
}
function remove(parent: ParentNode, child: HostNode): void {
    parent.children.splice(parent.children.indexOf(child), 1);
    detachWidget(parent, child); child.parent = null;
    dispose(child); child.widget.destroy();
    if (parent.type === 'box') syncBox(parent);
}
const noop = () => {};
const hostConfig: HostConfig = {
    extraDevToolsConfig: null,
    getInstanceFromNode: () => null, getInstanceFromScope: () => null,
    beforeActiveInstanceBlur: noop, afterActiveInstanceBlur: noop, prepareScopeUpdate: noop,
    requestPostPaintCallback: callback => { setTimeout(() => callback(performance.now()), 1); },
    suspendOnActiveViewTransition: noop,
    rendererVersion: '0.1.0', rendererPackageName: 'dev-os-react-gtk',
    getPublicInstance: node => node.widget,
    getRootHostContext: () => context, getChildHostContext: () => context,
    prepareForCommit: () => null, resetAfterCommit: container => container.children.forEach(show),
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
    }};
}
