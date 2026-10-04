import type Gtk from '@girs/gtk-3.0';
import type Pango from '@girs/pango-1.0';
import type Gio from '@girs/gio-2.0';
import type Cairo from '@girs/gjs/cairo';
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
    widthChars?: number;
    maxWidthChars?: number;
    onChanged?: (widget: W) => void;
    onActivate?: (widget: W) => void;
}
export interface SwitchProps extends WidgetProps<Gtk.Switch> {
    active?: boolean;
    onActiveChanged?: (widget: Gtk.Switch, property: import('@girs/gobject-2.0').default.ParamSpec) => void;
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
