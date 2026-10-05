import {Gtk} from './native.js';

// Shared host names and factories for JSX components and the reconciler.
export const widgets = {
    Box: {type: 'box', create: () => new Gtk.Box()},
    Label: {type: 'label', create: () => new Gtk.Label()},
    Button: {type: 'button', create: () => new Gtk.Button()},
    Entry: {type: 'entry', create: () => new Gtk.Entry()},
    SearchEntry: {type: 'search-entry', create: () => new Gtk.SearchEntry()},
    Switch: {type: 'switch', create: () => new Gtk.Switch()},
    CheckButton: {type: 'check-button', create: () => new Gtk.CheckButton()},
    Scale: {type: 'scale', create: () => Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 1)},
    Image: {type: 'image', create: () => new Gtk.Image()},
    Separator: {type: 'separator', create: () => new Gtk.Separator()},
    ScrolledWindow: {type: 'scrolled-window', create: () => new Gtk.ScrolledWindow()},
    ListBox: {type: 'list-box', create: () => new Gtk.ListBox()},
    ListBoxRow: {type: 'list-box-row', create: () => new Gtk.ListBoxRow()},
    FlowBox: {type: 'flow-box', create: () => new Gtk.FlowBox()},
    FlowBoxChild: {type: 'flow-box-child', create: () => new Gtk.FlowBoxChild()},
    DrawingArea: {type: 'drawing-area', create: () => new Gtk.DrawingArea()},
    Grid: {type: 'grid', create: () => new Gtk.Grid()},
    Overlay: {type: 'overlay', create: () => new Gtk.Overlay()},
    Stack: {type: 'stack', create: () => new Gtk.Stack()},
    Notebook: {type: 'notebook', create: () => new Gtk.Notebook()},
    Paned: {type: 'paned', create: () => new Gtk.Paned()},
    Frame: {type: 'frame', create: () => new Gtk.Frame()},
    Expander: {type: 'expander', create: () => new Gtk.Expander()},
    Revealer: {type: 'revealer', create: () => new Gtk.Revealer()},
    EventBox: {type: 'event-box', create: () => new Gtk.EventBox()},
    Viewport: {type: 'viewport', create: () => new Gtk.Viewport()},
    ButtonBox: {type: 'button-box', create: () => new Gtk.ButtonBox()},
    HeaderBar: {type: 'header-bar', create: () => new Gtk.HeaderBar()},
    ActionBar: {type: 'action-bar', create: () => new Gtk.ActionBar()},
    ToggleButton: {type: 'toggle-button', create: () => new Gtk.ToggleButton()},
    LinkButton: {type: 'link-button', create: () => new Gtk.LinkButton()},
    MenuButton: {type: 'menu-button', create: () => new Gtk.MenuButton()},
    Spinner: {type: 'spinner', create: () => new Gtk.Spinner()},
    ProgressBar: {type: 'progress-bar', create: () => new Gtk.ProgressBar()},
    LevelBar: {type: 'level-bar', create: () => new Gtk.LevelBar()},
    SpinButton: {type: 'spin-button', create: () => Gtk.SpinButton.new_with_range(0, 100, 1)},
    TextView: {type: 'text-view', create: () => new Gtk.TextView()},
    ComboBoxText: {type: 'combo-box-text', create: () => new Gtk.ComboBoxText()},
} as const;

export type WidgetName = keyof typeof widgets;
export const widgetFactories: Readonly<Record<string, () => Gtk.Widget>> = Object.fromEntries(
    Object.values(widgets).map(widget => [widget.type, widget.create]));
