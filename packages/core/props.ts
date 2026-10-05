import type {GtkTypes as Gtk, PangoTypes as Pango, GioTypes as Gio,
    GObjectTypes as GObject, GdkTypes as Gdk, Cairo} from './gir-types.js';
import type {ReactNode, Ref} from 'react';

export type Alignment = 'start' | 'end' | 'center' | 'fill' | 'baseline' | Gtk.Align;
export type Orientation = 'horizontal' | 'vertical';
export type TextChildren = string | number | boolean | null | undefined | readonly TextChildren[];

export interface WidgetProps<W extends Gtk.Widget = Gtk.Widget> {
    ref?: Ref<W>;
    className?: string;
    id?: string;
    tooltip?: string;
    visible?: boolean;
    sensitive?: boolean;
    hexpand?: boolean;
    vexpand?: boolean;
    halign?: Alignment;
    valign?: Alignment;
    widthRequest?: number;
    heightRequest?: number;
    marginTop?: number;
    marginBottom?: number;
    marginStart?: number;
    marginEnd?: number;
    pack?: 'start' | 'end' | 'center';
    expand?: boolean;
    fill?: boolean;
    padding?: number;
    gridLeft?: number;
    gridTop?: number;
    gridWidth?: number;
    gridHeight?: number;
    pageName?: string;
    pageTitle?: string;
    tabLabel?: string;
    overlay?: boolean;
    resize?: boolean;
    shrink?: boolean;
}
export interface BoxProps extends WidgetProps<Gtk.Box> {
    children?: ReactNode;
    orientation?: Orientation;
    spacing?: number;
    homogeneous?: boolean;
    borderWidth?: number;
}
export interface LabelProps extends WidgetProps<Gtk.Label> {
    children?: TextChildren;
    text?: string;
    wrap?: boolean;
    selectable?: boolean;
    xalign?: number;
    yalign?: number;
    maxWidthChars?: number;
    widthChars?: number;
    ellipsize?: Pango.EllipsizeMode;
}
export interface ButtonProps<W extends Gtk.Button = Gtk.Button> extends WidgetProps<W> {
    children?: ReactNode;
    borderWidth?: number;
    onClicked?: (widget: W) => void;
}
export interface EntryProps<W extends Gtk.Entry = Gtk.Entry> extends WidgetProps<W> {
    text?: string;
    placeholder?: string;
    editable?: boolean;
    maxLength?: number;
    password?: boolean;
    activatesDefault?: boolean;
    widthChars?: number;
    maxWidthChars?: number;
    onChanged?: (widget: W) => void;
    onActivate?: (widget: W) => void;
}
export interface SwitchProps extends WidgetProps<Gtk.Switch> {
    active?: boolean;
    onActiveChanged?: (widget: Gtk.Switch, property: GObject.ParamSpec) => void;
}
export interface CheckButtonProps extends ButtonProps<Gtk.CheckButton> {
    active?: boolean;
    onToggled?: (widget: Gtk.CheckButton) => void;
}
export interface ImageProps extends WidgetProps<Gtk.Image> {
    iconName?: string;
    iconSize?: Gtk.IconSize;
    gicon?: Gio.Icon | null;
    pixelSize?: number;
}
export interface SeparatorProps extends WidgetProps<Gtk.Separator> {
    orientation?: Orientation;
}
export interface ScrolledWindowProps extends WidgetProps<Gtk.ScrolledWindow> {
    children?: ReactNode;
    borderWidth?: number;
    hscrollbarPolicy?: Gtk.PolicyType;
    vscrollbarPolicy?: Gtk.PolicyType;
    minContentHeight?: number;
    minContentWidth?: number;
    maxContentHeight?: number;
    maxContentWidth?: number;
}
export interface ListBoxProps extends WidgetProps<Gtk.ListBox> {
    children?: ReactNode;
    selectionMode?: Gtk.SelectionMode;
    onRowActivated?: (list: Gtk.ListBox, row: Gtk.ListBoxRow) => void;
    onRowSelected?: (list: Gtk.ListBox, row: Gtk.ListBoxRow | null) => void;
    activateOnSingleClick?: boolean;
}
export interface ListBoxRowProps extends WidgetProps<Gtk.ListBoxRow> {children?: ReactNode;}
export interface FlowBoxProps extends WidgetProps<Gtk.FlowBox> {
    children?: ReactNode;
    selectionMode?: Gtk.SelectionMode;
    activateOnSingleClick?: boolean;
    minChildrenPerLine?: number;
    maxChildrenPerLine?: number;
    rowSpacing?: number;
    columnSpacing?: number;
    onChildActivated?: (box: Gtk.FlowBox, child: Gtk.FlowBoxChild) => void;
    onSelectedChildrenChanged?: (box: Gtk.FlowBox) => void;
}
export interface FlowBoxChildProps extends WidgetProps<Gtk.FlowBoxChild> {children?: ReactNode;}
export interface DrawingAreaProps extends WidgetProps<Gtk.DrawingArea> {
    onDraw?: (widget: Gtk.DrawingArea, context: Cairo.Context) => boolean;
}


export interface ScaleProps extends WidgetProps<Gtk.Scale> {
    value: number;
    lower?: number;
    upper?: number;
    orientation?: Orientation;
    drawValue?: boolean;
    onValueChanged?: (widget: Gtk.Scale) => void;
}

export interface ContainerProps<W extends Gtk.Container> extends WidgetProps<W> {
    children?: ReactNode;
    borderWidth?: number;
}
export interface GridProps extends ContainerProps<Gtk.Grid> {
    rowSpacing?: number;
    columnSpacing?: number;
    rowHomogeneous?: boolean;
    columnHomogeneous?: boolean;
}
export interface OverlayProps extends ContainerProps<Gtk.Overlay> {}
export interface StackProps extends ContainerProps<Gtk.Stack> {
    visibleChildName?: string;
    transitionType?: Gtk.StackTransitionType;
    transitionDuration?: number;
    homogeneous?: boolean;
    onVisibleChildChanged?: (widget: Gtk.Stack) => void;
}
export interface NotebookProps extends ContainerProps<Gtk.Notebook> {
    currentPage?: number;
    showTabs?: boolean;
    showBorder?: boolean;
    scrollable?: boolean;
    tabPosition?: Gtk.PositionType;
    onSwitchPage?: (widget: Gtk.Notebook, page: Gtk.Widget, index: number) => void;
}
export interface PanedProps extends ContainerProps<Gtk.Paned> {
    orientation?: Orientation;
    position?: number;
    wideHandle?: boolean;
    onPositionChanged?: (widget: Gtk.Paned) => void;
}
export interface FrameProps extends ContainerProps<Gtk.Frame> {
    label?: string;
    labelXalign?: number;
    labelYalign?: number;
    shadowType?: Gtk.ShadowType;
}
export interface ExpanderProps extends ContainerProps<Gtk.Expander> {
    label?: string;
    expanded?: boolean;
    onExpandedChanged?: (widget: Gtk.Expander) => void;
}
export interface RevealerProps extends ContainerProps<Gtk.Revealer> {
    revealChild?: boolean;
    transitionType?: Gtk.RevealerTransitionType;
    transitionDuration?: number;
}
export interface EventBoxProps extends ContainerProps<Gtk.EventBox> {
    visibleWindow?: boolean;
    aboveChild?: boolean;
    onButtonPress?: (widget: Gtk.EventBox, event: Gdk.EventButton) => boolean;
    onButtonRelease?: (widget: Gtk.EventBox, event: Gdk.EventButton) => boolean;
}
export interface ViewportProps extends ContainerProps<Gtk.Viewport> {shadowType?: Gtk.ShadowType;}
export interface ButtonBoxProps extends ContainerProps<Gtk.ButtonBox> {
    orientation?: Orientation;
    spacing?: number;
    layoutStyle?: Gtk.ButtonBoxStyle;
}
export interface HeaderBarProps extends ContainerProps<Gtk.HeaderBar> {
    title?: string;
    subtitle?: string;
    showCloseButton?: boolean;
    hasSubtitle?: boolean;
    decorationLayout?: string;
}
export interface ActionBarProps extends ContainerProps<Gtk.ActionBar> {}
export interface ToggleButtonProps extends ButtonProps<Gtk.ToggleButton> {
    active?: boolean;
    onToggled?: (widget: Gtk.ToggleButton) => void;
}
export interface LinkButtonProps extends ButtonProps<Gtk.LinkButton> {
    uri: string;
    visited?: boolean;
    onActivateLink?: (widget: Gtk.LinkButton) => boolean;
}
export interface MenuButtonProps extends ButtonProps<Gtk.MenuButton> {
    popup?: Gtk.Menu | null;
    popover?: Gtk.Popover | null;
    direction?: Gtk.ArrowType;
}
export interface SpinnerProps extends WidgetProps<Gtk.Spinner> {active?: boolean;}
export interface ProgressBarProps extends WidgetProps<Gtk.ProgressBar> {
    fraction?: number;
    text?: string;
    showText?: boolean;
    inverted?: boolean;
    orientation?: Orientation;
    ellipsize?: Pango.EllipsizeMode;
}
export interface LevelBarProps extends WidgetProps<Gtk.LevelBar> {
    value?: number;
    minValue?: number;
    maxValue?: number;
    mode?: Gtk.LevelBarMode;
    inverted?: boolean;
    orientation?: Orientation;
}
export interface SpinButtonProps extends EntryProps<Gtk.SpinButton> {
    value?: number;
    lower?: number;
    upper?: number;
    step?: number;
    digits?: number;
    numeric?: boolean;
    wrap?: boolean;
    onValueChanged?: (widget: Gtk.SpinButton) => void;
}
export interface TextViewProps extends WidgetProps<Gtk.TextView> {
    text?: string;
    editable?: boolean;
    cursorVisible?: boolean;
    monospace?: boolean;
    wrapMode?: Gtk.WrapMode;
    acceptsTab?: boolean;
    leftMargin?: number;
    rightMargin?: number;
    topMargin?: number;
    bottomMargin?: number;
    onChanged?: (widget: Gtk.TextView) => void;
}
export interface ComboBoxTextProps extends WidgetProps<Gtk.ComboBoxText> {
    items?: readonly {id: string; text: string}[];
    activeId?: string | null;
    onChanged?: (widget: Gtk.ComboBoxText) => void;
}
