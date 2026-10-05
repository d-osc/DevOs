import React from 'react';
import {widgets, type WidgetName} from './widgets.js';
import type {GtkTypes as Gtk} from './gir-types.js';
import type {BoxProps, LabelProps, ButtonProps, EntryProps, SwitchProps,
    CheckButtonProps, ImageProps, SeparatorProps, ScrolledWindowProps,
    ListBoxProps, ListBoxRowProps, FlowBoxProps, FlowBoxChildProps, DrawingAreaProps, ScaleProps} from './props.js';

import type {GridProps, OverlayProps, StackProps, NotebookProps, PanedProps, FrameProps, ExpanderProps, RevealerProps, EventBoxProps, ViewportProps, ButtonBoxProps, HeaderBarProps, ActionBarProps, ToggleButtonProps, LinkButtonProps, MenuButtonProps, SpinnerProps, ProgressBarProps, LevelBarProps, SpinButtonProps, TextViewProps, ComboBoxTextProps} from './props.js';

export type * from './props.js';
export {default as React} from 'react';
export {useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback,
    useReducer, useContext, createContext, Fragment, memo, forwardRef, useImperativeHandle,
    useId, useTransition, useDeferredValue, useSyncExternalStore, useDebugValue} from 'react';

// Host components are native widgets. Refs expose the actual Gtk.Widget.
function component<P extends object>(name: WidgetName): React.FC<P> {
    return props => React.createElement(widgets[name].type, props);
}
export const Box = component<BoxProps>('Box'), Label = component<LabelProps>('Label');
export const Button = component<ButtonProps>('Button'), Entry = component<EntryProps>('Entry');
export const SearchEntry = component<EntryProps<Gtk.SearchEntry>>('SearchEntry');
export const Switch = component<SwitchProps>('Switch'), CheckButton = component<CheckButtonProps>('CheckButton');
export const Image = component<ImageProps>('Image'), Separator = component<SeparatorProps>('Separator');
export const ScrolledWindow = component<ScrolledWindowProps>('ScrolledWindow');
export const ListBox = component<ListBoxProps>('ListBox'), ListBoxRow = component<ListBoxRowProps>('ListBoxRow');
export const FlowBox = component<FlowBoxProps>('FlowBox'), FlowBoxChild = component<FlowBoxChildProps>('FlowBoxChild');
export const DrawingArea = component<DrawingAreaProps>('DrawingArea');
export const Scale = component<ScaleProps>('Scale');

export const Grid = component<GridProps>('Grid');
export const Overlay = component<OverlayProps>('Overlay');
export const Stack = component<StackProps>('Stack');
export const Notebook = component<NotebookProps>('Notebook');
export const Paned = component<PanedProps>('Paned');
export const Frame = component<FrameProps>('Frame');
export const Expander = component<ExpanderProps>('Expander');
export const Revealer = component<RevealerProps>('Revealer');
export const EventBox = component<EventBoxProps>('EventBox');
export const Viewport = component<ViewportProps>('Viewport');
export const ButtonBox = component<ButtonBoxProps>('ButtonBox');
export const HeaderBar = component<HeaderBarProps>('HeaderBar');
export const ActionBar = component<ActionBarProps>('ActionBar');
export const ToggleButton = component<ToggleButtonProps>('ToggleButton');
export const LinkButton = component<LinkButtonProps>('LinkButton');
export const MenuButton = component<MenuButtonProps>('MenuButton');
export const Spinner = component<SpinnerProps>('Spinner');
export const ProgressBar = component<ProgressBarProps>('ProgressBar');
export const LevelBar = component<LevelBarProps>('LevelBar');
export const SpinButton = component<SpinButtonProps>('SpinButton');
export const TextView = component<TextViewProps>('TextView');
export const ComboBoxText = component<ComboBoxTextProps>('ComboBoxText');

export type {ComponentType, ReactNode, Ref} from 'react';
