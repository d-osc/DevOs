import {
    type Gtk, type Gio, type AtkTypes, type CairoGITypes, type Freetype2Types,
    type GdkTypes, type GdkPixbufTypes, type GioTypes, type GjsTypes, type GLibTypes,
    type GLibUnixTypes, type GModuleTypes, type GObjectTypes, type GtkTypes, type GtkLayerShellTypes,
    type HarfBuzzTypes, type JavaScriptCoreTypes, type PangoTypes, type SoupTypes, type VteTypes,
    type WebKit2Types, type XlibTypes, type Cairo, type SystemTypes, type GettextTypes,
    type GiTypes
} from '@dev-os/core';
// Compile-only coverage for the public GIR namespaces and GJS drawing types.

type Namespaces = [typeof AtkTypes, typeof CairoGITypes, typeof Freetype2Types,
    typeof GdkTypes, typeof GdkPixbufTypes, typeof GioTypes, typeof GjsTypes,
    typeof GLibTypes, typeof GLibUnixTypes, typeof GModuleTypes, typeof GObjectTypes,
    typeof GtkTypes, typeof GtkLayerShellTypes, typeof HarfBuzzTypes,
    typeof JavaScriptCoreTypes, typeof PangoTypes, typeof SoupTypes,
    typeof VteTypes, typeof WebKit2Types, typeof XlibTypes,
    typeof SystemTypes, typeof GettextTypes, typeof GiTypes];
type Assert<T extends true> = T;
type SameWidget = Assert<GtkTypes.Button extends Gtk.Button ? true : false>;
type SameFile = Assert<GioTypes.File extends Gio.File ? true : false>;
type Drawing = (context: Cairo.Context, icon: GdkPixbufTypes.Pixbuf, event: GdkTypes.EventButton) => void;
export type {Namespaces, SameWidget, SameFile, Drawing};

// @ts-expect-error Type-only namespaces must not introduce runtime constructors.
new GtkTypes.Button();
