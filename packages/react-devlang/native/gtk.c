#include <gtk/gtk.h>
#include <stdint.h>
#include <string.h>
#include <dlfcn.h>
void *rd_find_name(void *data,const char *name);
static void rd_tab_drag(GtkWidget *widget);

typedef void (*RdDispatch)(int32_t, void *, const unsigned char *, int64_t, void *);
typedef struct { GtkWidget *window, *host; RdDispatch dispatch; void *data; guint idle; gboolean closed, applying; GtkCssProvider *css; GdkScreen *screen; GDBusConnection *bus; guint bus_name, bus_object; char *command; int64_t css_revision; GPtrArray *popovers; gboolean popup_above; char *prefixes; gboolean layer, closing; gint pointer_x, pointer_y; GMainLoop *loop; guint tick; guint close_idle; gboolean asynchronous; void *ui_context; guint64 serial; char *initial; GHashTable *adoptions; GQueue *incoming; GtkWidget *drag_tab; GdkDragContext *drag_context; gboolean drag_cancelled; gint64 fade_start; double fade_from; } RdRoot;
static GPtrArray *rd_roots;
static guint64 rd_root_sequence;
static int64_t rd_tab_sequence=1;
int64_t rd_tab_id(void){return rd_tab_sequence++;}
static gboolean rd_event_handler_installed;
static void rd_event_handler(GdkEvent *event,void *unused){
    (void)unused;
    if(event->type==GDK_KEY_PRESS && event->key.keyval==GDK_KEY_Escape && rd_roots){
        for(guint i=0;i<rd_roots->len;i++){RdRoot *root=g_ptr_array_index(rd_roots,i);if(!root->closed && root->drag_context){root->drag_cancelled=TRUE;GdkDragContext *context=g_object_ref(root->drag_context);gtk_drag_cancel(context);g_object_unref(context);return;}}
    }
    gtk_main_do_event(event);
}
static int64_t rd_live_widgets = 0;
static void rd_widget_destroyed(GtkWidget *widget, void *data) { (void)widget; (void)data; rd_live_widgets--; }
int64_t rd_widget_live_count(void) { return rd_live_widgets; }
static void rd_emit(RdRoot *root, int kind, GtkWidget *widget, const char *text) {
    if (!root->closed && !root->applying && root->dispatch)
        root->dispatch(kind, widget, (const unsigned char *)(text ? text : ""), text ? (int64_t)strlen(text) : 0, root->data);
}
static gboolean rd_idle(void *data) { RdRoot *root = data; root->idle = 0; rd_emit(root, 0, NULL, NULL); return G_SOURCE_REMOVE; }
static void rd_clicked(GtkWidget *widget, void *data) { rd_emit(data, 1, widget, NULL); }
static gboolean rd_crossing(GtkWidget *widget,GdkEventCrossing *event,void *data){
    if(g_object_get_data(G_OBJECT(widget),"rd-pointer-enabled") && event->detail!=GDK_NOTIFY_INFERIOR)rd_emit(data,6,widget,event->type==GDK_ENTER_NOTIFY ? "enter" : "leave");
    return FALSE;
}
static gboolean rd_pressed(GtkWidget *widget,GdkEventButton *event,void *data){
    if(event->type==GDK_BUTTON_PRESS && event->button==2 && gtk_style_context_has_class(gtk_widget_get_style_context(widget),"chrome-tab-select")){rd_emit(data,6,widget,"close");return TRUE;}
    if(!g_object_get_data(G_OBJECT(widget),"rd-pointer-enabled") || (event->type!=GDK_BUTTON_PRESS && !(event->type==GDK_2BUTTON_PRESS && event->button==1)) || (event->button!=1 && event->button!=3))return FALSE;
    RdRoot *root=data;
    if(event->button==3){
        gint wx=0,wy=0,tx=0,ty=0,hx=0,hy=0;
        gdk_window_get_origin(event->window,&wx,&wy);
        gdk_window_get_origin(gtk_widget_get_window(root->window),&tx,&ty);
        gtk_widget_translate_coordinates(root->host,root->window,0,0,&hx,&hy);
        root->pointer_x=wx+(gint)event->x-tx-hx;root->pointer_y=wy+(gint)event->y-ty-hy;
    }
    rd_emit(data,6,widget,event->button==3 ? "context" : event->type==GDK_2BUTTON_PRESS ? "double" : "primary");return event->button==3 || event->type==GDK_2BUTTON_PRESS;
}
void rd_pointer(void *widget,int32_t enabled){
    g_object_set_data(G_OBJECT(widget),"rd-pointer-enabled",GINT_TO_POINTER(enabled));
    if(enabled && !g_object_get_data(G_OBJECT(widget),"rd-pointer-connected")){
        RdRoot *root=g_object_get_data(G_OBJECT(widget),"rd-root");gtk_widget_add_events(widget,GDK_ENTER_NOTIFY_MASK|GDK_LEAVE_NOTIFY_MASK|GDK_BUTTON_PRESS_MASK);
        g_signal_connect(widget,"enter-notify-event",G_CALLBACK(rd_crossing),root);g_signal_connect(widget,"leave-notify-event",G_CALLBACK(rd_crossing),root);g_signal_connect(widget,"button-press-event",G_CALLBACK(rd_pressed),root);g_object_set_data(G_OBJECT(widget),"rd-pointer-connected",GINT_TO_POINTER(1));
    }
}
static gboolean rd_paint(GtkWidget *widget,cairo_t *cr,void *data) {RdRoot *root=data;if(!root->closed && !root->applying && root->dispatch)root->dispatch(5,widget,(const unsigned char *)cr,0,root->data);return FALSE;}
static void rd_changed(GtkEntry *widget, void *data) { rd_emit(data, 2, GTK_WIDGET(widget), gtk_entry_get_text(widget)); }
static void rd_textarea_changed(GtkTextBuffer *buffer,void *data){GtkTextIter start,end;gtk_text_buffer_get_bounds(buffer,&start,&end);char *text=gtk_text_buffer_get_text(buffer,&start,&end,FALSE);rd_emit(data,2,g_object_get_data(G_OBJECT(buffer),"rd-owner"),text);g_free(text);}
static void rd_combo_changed(GtkComboBox *widget, void *data) { char value[32]; g_snprintf(value,sizeof value,"%d",gtk_combo_box_get_active(widget)); rd_emit(data,2,GTK_WIDGET(widget),value); }
static void rd_toggled(GtkToggleButton *widget, void *data) { rd_emit(data, 4, GTK_WIDGET(widget), gtk_toggle_button_get_active(widget) ? "1" : "0"); }
static void rd_switched(GObject *widget,GParamSpec *property,void *data){(void)property;rd_emit(data,4,GTK_WIDGET(widget),gtk_switch_get_active(GTK_SWITCH(widget))?"1":"0");}
/* A drag reports once, 400 ms after the last movement, so a helper is not run for every pixel. */
static gboolean rd_scale_commit(void *data){
    GtkWidget *widget=data;char value[32];g_object_set_data(G_OBJECT(widget),"rd-scale-timer",NULL);
    g_snprintf(value,sizeof value,"%d",(int)(gtk_range_get_value(GTK_RANGE(widget))+0.5));
    rd_emit(g_object_get_data(G_OBJECT(widget),"rd-root"),2,widget,value);return G_SOURCE_REMOVE;
}
static void rd_scale_destroyed(GtkWidget *widget,void *data){(void)data;guint timer=GPOINTER_TO_UINT(g_object_get_data(G_OBJECT(widget),"rd-scale-timer"));if(timer){g_source_remove(timer);g_object_set_data(G_OBJECT(widget),"rd-scale-timer",NULL);}}
static void rd_scaled(GtkRange *widget,void *data){
    (void)data;guint timer=GPOINTER_TO_UINT(g_object_get_data(G_OBJECT(widget),"rd-scale-timer"));
    if(timer)g_source_remove(timer);
    g_object_set_data(G_OBJECT(widget),"rd-scale-timer",GUINT_TO_POINTER(g_timeout_add(400,rd_scale_commit,widget)));
}
static void rd_maybe_quit(void){
    if(!rd_roots)return;
    for(guint i=0;i<rd_roots->len;i++){RdRoot *root=g_ptr_array_index(rd_roots,i);if(!root->closed || root->close_idle)return;}
    for(guint i=0;i<rd_roots->len;i++){RdRoot *root=g_ptr_array_index(rd_roots,i);if(root->loop)g_main_loop_quit(root->loop);}
}
static gboolean rd_async_closed(void *data){RdRoot *root=data;root->close_idle=0;if(root->dispatch)root->dispatch(9,NULL,NULL,0,root->data);rd_maybe_quit();return G_SOURCE_REMOVE;}
void rd_track_context(void *data,void *context,int32_t asynchronous){RdRoot *root=data;root->ui_context=context;root->asynchronous=asynchronous!=0;}
void *rd_child_context(void){if(rd_roots)for(guint i=0;i<rd_roots->len;i++){RdRoot *root=g_ptr_array_index(rd_roots,i);if(root->asynchronous && root->ui_context)return root->ui_context;}return NULL;}
void rd_show(void *data){RdRoot *root=data;if(!root->closed){gtk_widget_show(root->window);gtk_widget_show(root->host);if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("shown %" G_GUINT64_FORMAT " visible=%d mapped=%d\n",root->serial,gtk_widget_get_visible(root->window),gtk_widget_get_mapped(root->window));}}
static void rd_closed(GtkWidget *widget, void *data) {
    (void)widget; RdRoot *root = data; root->closed = TRUE;
    if (root->idle) { g_source_remove(root->idle); root->idle = 0; }
    if(root->tick){g_source_remove(root->tick);root->tick=0;}
    if(!root->close_idle)root->close_idle=g_idle_add(rd_async_closed,root);
    rd_maybe_quit();
}
/* Puts text on the clipboard of the default display. */
void rd_clipboard(const char *text) { if (text) gtk_clipboard_set_text(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD), text, -1); }
int64_t rd_strlen(const char *text) { return (int64_t)strlen(text); }
void *rd_buffer_new(int64_t length) { return g_malloc0((gsize)length + 1); }
void rd_buffer_free(void *buffer) { g_free(buffer); }
#include "code.inc"
void rd_fail(const char *message) { g_error("react-devlang: %s", message); }
void rd_close(void *data);
/* RD_LAYER=1: a full-screen overlay (the Launcher, Task View and Snap). The layer-shell library is opened at run time, so apps need neither its headers nor
   a link to it; without it, or on a compositor without the protocol (X11, Xvfb), the window stays an ordinary toplevel. A translucent scrim covers the
   screen, the window takes the keyboard while it is open, and Escape closes it. */
static gboolean rd_layer_key(GtkWidget *widget, GdkEventKey *event, void *data) {
    (void)widget; if (event->keyval == GDK_KEY_Escape) { rd_close(data); return TRUE; } return FALSE;
}
/* Open: the overlay fades in while its content slides up 96 px over 320 ms (ease-out); close: it fades out while the content slides back down over 220 ms
   (ease-in) before the window is destroyed. The content is pushed down with a top margin, so the bottom edge clips it. */
#define RD_SLIDE 96
static gboolean rd_fade_in(GtkWidget *widget, GdkFrameClock *clock, void *data) {
    (void)widget; RdRoot *root = data; if (root->closed || root->closing) return G_SOURCE_REMOVE;
    gint64 now = gdk_frame_clock_get_frame_time(clock); if (!root->fade_start) root->fade_start = now;
    double t = (double)(now - root->fade_start) / 320000.0; if (t > 1) t = 1;
    double p = 1 - (1 - t) * (1 - t) * (1 - t);
    gtk_widget_set_opacity(root->window, p); gtk_widget_set_margin_top(root->host, (int)((1 - p) * RD_SLIDE));
    return t >= 1 ? G_SOURCE_REMOVE : G_SOURCE_CONTINUE;
}
static gboolean rd_fade_out(GtkWidget *widget, GdkFrameClock *clock, void *data) {
    (void)widget; RdRoot *root = data; if (root->closed) return G_SOURCE_REMOVE;
    gint64 now = gdk_frame_clock_get_frame_time(clock); if (!root->fade_start) root->fade_start = now;
    double t = (double)(now - root->fade_start) / 220000.0; if (t > 1) t = 1;
    gtk_widget_set_opacity(root->window, root->fade_from * (1 - t * t)); gtk_widget_set_margin_top(root->host, (int)(t * t * RD_SLIDE));
    if (t >= 1) { root->layer = FALSE; gtk_widget_destroy(root->window); return G_SOURCE_REMOVE; }
    return G_SOURCE_CONTINUE;
}
static void rd_layer_overlay(RdRoot *root) {
    const char *mode = g_getenv("RD_LAYER"); if (!mode || !*mode) return;
    void *library = dlopen("libgtk-layer-shell.so.0", RTLD_LAZY | RTLD_GLOBAL); if (!library) return;
    gboolean (*supported)(void) = (gboolean (*)(void))dlsym(library, "gtk_layer_is_supported");
    void (*init)(GtkWindow *) = (void (*)(GtkWindow *))dlsym(library, "gtk_layer_init_for_window");
    void (*name)(GtkWindow *, const char *) = (void (*)(GtkWindow *, const char *))dlsym(library, "gtk_layer_set_namespace");
    void (*layer)(GtkWindow *, int) = (void (*)(GtkWindow *, int))dlsym(library, "gtk_layer_set_layer");
    void (*anchor)(GtkWindow *, int, gboolean) = (void (*)(GtkWindow *, int, gboolean))dlsym(library, "gtk_layer_set_anchor");
    void (*keyboard)(GtkWindow *, int) = (void (*)(GtkWindow *, int))dlsym(library, "gtk_layer_set_keyboard_mode");
    void (*zone)(GtkWindow *, int) = (void (*)(GtkWindow *, int))dlsym(library, "gtk_layer_set_exclusive_zone");
    if (!supported || !init || !name || !layer || !anchor || !keyboard || !zone || !supported()) return;
    GtkWindow *window = GTK_WINDOW(root->window);
    GdkVisual *visual = gdk_screen_get_rgba_visual(root->screen); if (visual) gtk_widget_set_visual(root->window, visual);
    init(window); name(window, "devos-overlay"); layer(window, 3 /* overlay */); keyboard(window, 1 /* exclusive */); zone(window, -1);
    for (int edge = 0; edge < 4; edge++) anchor(window, edge, TRUE);
    gtk_window_set_decorated(window, FALSE);
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css, "window.background.rd-layer-scrim {background-color: #121314; background-color: @dv_s0; background-image: none;} .rd-layer-panel {background-color: transparent; padding: 36px 64px;} .rd-tile {padding: 20px 12px; border-radius: 18px; border: 1px solid transparent; background-color: #1b1c1e; background-color: @dv_s2; transition: background-color 140ms ease, border-color 140ms ease;} .rd-tile:hover {border-color: #297aa0; border-color: @dv_accent; background-color: #242526; background-color: @dv_s3;} .rd-tile:active {background-color: #121314; background-color: @dv_s0;} .rd-tile-name {font-weight: 600; color: #ededed; color: @dv_fg_strong;} .rd-tile-desc {font-size: 11px; color: #8c8c8c; color: @dv_fg_muted;} .rd-eyebrow {font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #48a0c7; color: @dv_accent_fg;} .rd-heading {font-size: 30px; font-weight: 700; color: #ededed; color: @dv_fg_strong;} .rd-heading-small {font-size: 18px; font-weight: 600; color: #ededed; color: @dv_fg_strong;} .rd-muted {font-size: 12px; color: #8c8c8c; color: @dv_fg_muted;} .rd-pill {padding: 7px 16px; border-radius: 999px; font-size: 12px; background-color: #202122; background-color: @dv_s2; color: #bfbfbf; color: @dv_fg;} .rd-badge {padding: 2px 9px; border-radius: 999px; font-size: 10px; font-weight: 700; background-color: #297aa0; background-color: @dv_accent; color: #ffffff;} .rd-badge-muted {padding: 2px 9px; border-radius: 999px; font-size: 10px; background-color: #242526; background-color: @dv_s3; color: #8c8c8c; color: @dv_fg_muted;} .rd-card-app {font-size: 12px; color: #8c8c8c; color: @dv_fg_muted;} .rd-card-title {font-weight: 600; color: #ededed; color: @dv_fg_strong;} .rd-window {padding: 10px; border-radius: 20px; border: 1px solid transparent; background-color: #191a1b; background-color: @dv_s1;} .rd-window-active {border-color: #297aa0; border-color: @dv_accent;} .rd-close {padding: 4px 11px; border-radius: 999px; font-size: 15px;} .rd-desk {padding: 16px 18px; border-radius: 22px; border: 1px solid #2a2b2c; border: 1px solid @dv_line0; background-color: #191a1b; background-image: linear-gradient(160deg, #202122, #141516); background-image: linear-gradient(160deg, @dv_s3, @dv_s1); box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32); transition: border-color 160ms ease, background-color 160ms ease;} .rd-desk:hover {border-color: #48a0c7; border-color: @dv_accent_fg;} .rd-desk-current {border-color: #297aa0; border-color: @dv_accent; background-image: linear-gradient(160deg, #1d4a60, #141516); background-image: linear-gradient(160deg, @dv_accent_t3, @dv_s1); box-shadow: 0 0 0 1px #297aa0, 0 14px 34px rgba(41, 122, 160, 0.34);} .rd-desk-add {border: 1px dashed #707070; border: 1px dashed @dv_line3; background-image: none; background-color: transparent; box-shadow: none;} .rd-desk-add:hover {border-color: #48a0c7; border-color: @dv_accent_fg; background-color: rgba(255, 255, 255, 0.04);} .rd-desk-number {min-width: 30px; min-height: 30px; border-radius: 999px; font-weight: 700; color: #48a0c7; color: @dv_accent_fg; background-color: #2b6f90; background-color: @dv_accent_t4;} .rd-tile-flat {padding: 6px 10px; border-radius: 12px; border: 1px solid transparent; background-color: transparent; background-image: none; box-shadow: none;} .rd-tile-flat:hover {background-color: rgba(255, 255, 255, 0.06); border-color: transparent;} .rd-plus {font-size: 30px; font-weight: 300; color: #48a0c7; color: @dv_accent_fg;}", -1, NULL);
    gtk_style_context_add_provider_for_screen(root->screen, GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_USER + 1);
    g_object_unref(css);
    gtk_style_context_add_class(gtk_widget_get_style_context(root->window), "rd-layer-scrim");
    g_object_set_data(G_OBJECT(root->window), "rd-layer", GINT_TO_POINTER(1));
    g_signal_connect(root->window, "key-press-event", G_CALLBACK(rd_layer_key), root);
    root->layer = TRUE; gtk_widget_set_opacity(root->window, 0); gtk_widget_add_tick_callback(root->window, rd_fade_in, root, NULL);
}
// Styles shared by the native apps that draw their own layout (Files). Each rule has a hex fallback before the theme variable.
static void rd_app_css(RdRoot *root) {
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css,
        /* one title bar for every window: the theme styles buttons per window (#settings button, #app-store button ...), which made some title bar buttons boxed and others flat */
        "headerbar.app-titlebar {min-height: 34px; padding: 0 6px;} "
        "headerbar.app-titlebar .title {font-size: 13px; font-weight: 600;} "
        "headerbar.app-titlebar button {background-image: none; background-color: transparent; background-color: alpha(@dv_s5, 0); border: 1px solid transparent; box-shadow: none; text-shadow: none; padding: 4px 7px; min-height: 0; min-width: 0; border-radius: 7px;} "
        "headerbar.app-titlebar button:hover {background-color: #2f3031; background-color: @dv_s5;} "
        "headerbar.app-titlebar button image, headerbar.app-titlebar image {color: #48a0c7; color: @dv_accent_fg;} "
        "headerbar.app-titlebar button.close:hover image {color: #f48771; color: @dv_error;} "
        ".fl-side {background-color: #121314; background-color: @dv_s0; border-right: 1px solid #2a2b2c; border-right: 1px solid @dv_line0; padding: 16px 12px;} "
        ".fl-brand-title {font-size: 19px; font-weight: 700; color: #ededed; color: @dv_fg_strong;} "
        ".fl-brand-icon {color: #48a0c7; color: @dv_accent_fg;} "
        ".fl-eyebrow {font-size: 10px; font-weight: 700; letter-spacing: 1px; color: #8c8c8c; color: @dv_fg_muted;} "
        ".fl-muted {font-size: 11px; color: #8c8c8c; color: @dv_fg_muted;} "
        ".fl-mono {font-family: monospace; font-size: 12px;} "
        ".fl-place {padding: 9px 10px; border-radius: 9px; border: 1px solid transparent; background-color: transparent; background-image: none; box-shadow: none; color: #bfbfbf; color: @dv_fg;} "
        ".fl-place:hover {background-color: #202122; background-color: @dv_s2;} "
        ".fl-place:disabled {color: #5c5c5c; color: @dv_fg_dim;} "
        ".fl-place-active {background-color: #1d4a60; background-color: @dv_accent_t2; border-color: #2b6f90; border-color: @dv_accent_t4;} "
        ".fl-place-active image, .fl-place-active label {color: #48a0c7; color: @dv_accent_fg;} "
        ".fl-folder {padding: 6px 10px; border-radius: 9px; border: 1px solid transparent; background-color: transparent; background-image: none; box-shadow: none; color: #8c8c8c; color: @dv_fg_muted;} "
        ".fl-folder:hover {background-color: #202122; background-color: @dv_s2;} "
        ".fl-main {padding: 18px 20px;} "
        ".fl-nav {padding: 8px 10px; border-radius: 9px; border: 1px solid #2a2b2c; border: 1px solid @dv_line0; background-color: #191a1b; background-color: @dv_s1; background-image: none; box-shadow: none; color: #bfbfbf; color: @dv_fg;} "
        ".fl-nav:hover {background-color: #242526; background-color: @dv_s3; border-color: #3a3b3c; border-color: @dv_line2;} "
        ".fl-nav:disabled {color: #5c5c5c; color: @dv_fg_dim; background-color: #191a1b; background-color: @dv_s1;} "
        ".fl-crumb {padding: 3px 7px; border-radius: 6px; border: 1px solid transparent; background-color: transparent; background-image: none; box-shadow: none; font-size: 11px; color: #8c8c8c; color: @dv_fg_muted;} "
        ".fl-crumb:hover {background-color: #242526; background-color: @dv_s3;} "
        ".fl-crumb-current {color: #48a0c7; color: @dv_accent_fg; background-color: #1d4a60; background-color: @dv_accent_t2;} "
        ".fl-emblem {padding: 12px; border-radius: 14px; background-color: #1d4a60; background-color: @dv_accent_t2; color: #48a0c7; color: @dv_accent_fg;} "
        ".fl-title {font-size: 25px; font-weight: 700; color: #ededed; color: @dv_fg_strong;} "
        ".fl-primary {padding: 8px 14px; border-radius: 9px; border: 1px solid #2b6f90; border: 1px solid @dv_accent_t4; background-color: #1d4a60; background-color: @dv_accent_t3; background-image: none; box-shadow: none; color: #48a0c7; color: @dv_accent_fg; font-weight: 600;} "
        ".fl-primary:hover {background-color: #2b6f90; background-color: @dv_accent_t4;} "
        ".fl-primary:disabled {color: #5c5c5c; color: @dv_fg_dim;} "
        ".fl-tool {padding: 6px 12px; border-radius: 8px; border: 1px solid #2a2b2c; border: 1px solid @dv_line0; background-color: #191a1b; background-color: @dv_s1; background-image: none; box-shadow: none; font-size: 12px; color: #bfbfbf; color: @dv_fg;} "
        ".fl-tool:hover {background-color: #242526; background-color: @dv_s3;} "
        ".fl-tool:disabled {color: #5c5c5c; color: @dv_fg_dim;} "
        ".fl-tool-active {background-color: #1d4a60; background-color: @dv_accent_t2; border-color: #2b6f90; border-color: @dv_accent_t4; color: #48a0c7; color: @dv_accent_fg;} "
        ".fl-strip {padding: 10px; border-radius: 10px; border: 1px solid #3a3b3c; border: 1px solid @dv_line2; background-color: #242526; background-color: @dv_s3;} "
        ".fl-head {font-size: 10px; font-weight: 700; letter-spacing: 1px; color: #8c8c8c; color: @dv_fg_muted;} "
        ".fl-row {padding: 8px 12px; border-radius: 8px; border: 1px solid transparent; background-color: transparent; background-image: none; box-shadow: none;} "
        ".fl-row:hover {background-color: #202122; background-color: @dv_s2;} "
        ".fl-selected {background-color: #1d4a60; background-color: @dv_accent_t2; border-color: #2b6f90; border-color: @dv_accent_t4;} "
        ".fl-name {color: #ededed; color: @dv_fg_strong;} "
        ".fl-card {padding: 14px; border-radius: 10px; border: 1px solid #2a2b2c; border: 1px solid @dv_line0; background-color: #191a1b; background-color: @dv_s1; background-image: none; box-shadow: none;} "
        ".fl-card:hover {background-color: #242526; background-color: @dv_s3; border-color: #3a3b3c; border-color: @dv_line2;} "
        ".fl-badge {padding: 3px 7px; border-radius: 5px; font-size: 9px; font-weight: 700; background-color: #121314; background-color: @dv_s0;} "
        ".fl-kind-mint {color: #48a0c7; color: @dv_accent_fg;} .fl-kind-blue {color: #4aa3ff; color: @dv_info;} .fl-kind-yellow {color: #d9a441; color: @dv_warning;} "
        ".fl-kind-purple {color: #b48ead; color: @dv_purple;} .fl-kind-orange {color: #d9a441; color: @dv_warning;} .fl-kind-neutral {color: #8c8c8c; color: @dv_fg_muted;} "
        ".fl-notice {padding: 8px 12px; border-radius: 8px; background-color: #191a1b; background-color: @dv_s1; font-size: 12px; color: #48a0c7; color: @dv_accent_fg;} "
        ".fl-error {padding: 8px 12px; border-radius: 8px; background-color: #191a1b; background-color: @dv_s1; font-size: 12px; color: #e5534b; color: @dv_error;} "
        ".fl-actions {padding: 8px 12px; border-radius: 10px; border: 1px solid #2a2b2c; border: 1px solid @dv_line0; background-color: #191a1b; background-color: @dv_s1;} "
        ".fl-status {padding: 0 16px; min-height: 32px; border-top: 1px solid #2a2b2c; border-top: 1px solid @dv_line0; background-color: #121314; background-color: @dv_s0;} "
        ".fl-empty-icon {padding: 24px; border-radius: 22px; background-color: #191a1b; background-color: @dv_s1; color: #48a0c7; color: @dv_accent_fg;} "
        ".fl-empty-title {font-size: 18px; font-weight: 600; color: #ededed; color: @dv_fg_strong;}", -1, NULL);
    gtk_style_context_add_provider_for_screen(root->screen, GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_USER);
    g_object_unref(css);
}
void *rd_new(const char *title, int32_t width, int32_t height) {
    if (!gtk_init_check(NULL, NULL)) return NULL;
    if(!rd_event_handler_installed){gdk_event_handler_set(rd_event_handler,NULL,NULL);rd_event_handler_installed=TRUE;}
    RdRoot *root = g_new0(RdRoot, 1);
    root->serial=++rd_root_sequence;if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("new window %" G_GUINT64_FORMAT " %s\n",root->serial,title);if(!rd_roots)rd_roots=g_ptr_array_new();g_ptr_array_add(rd_roots,root);
    root->window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    g_object_set_data(G_OBJECT(root->window),"rd-root",root);rd_tab_drag(root->window);
    root->screen = g_object_ref(gtk_widget_get_screen(root->window));
    gtk_window_set_title(GTK_WINDOW(root->window), title);
    gtk_window_set_default_size(GTK_WINDOW(root->window), width, height);
    rd_app_css(root);
    rd_layer_overlay(root);
    root->host = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_container_add(GTK_CONTAINER(root->window), root->host);
    g_signal_connect(root->window, "destroy", G_CALLBACK(rd_closed), root);
    return root;
}
void *rd_host(void *data) { return ((RdRoot *)data)->host; }
void *rd_window(void *data) { return ((RdRoot *)data)->window; }
void rd_identity(const char *id) { g_set_prgname(id); gdk_set_program_class(id); }
void rd_callback(void *data, RdDispatch dispatch, void *context) { RdRoot *root = data;if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("callback ready %" G_GUINT64_FORMAT "\n",root->serial); root->dispatch = dispatch; root->data = context; }
void rd_schedule(void *data) { RdRoot *root = data; if (!root->closed && !root->idle) root->idle = g_idle_add(rd_idle, root); }
void rd_applying(void *data, int32_t applying) { ((RdRoot *)data)->applying = applying != 0; }
/* RD_HIDDEN=1: a program with no window (the shell) that only answers the D-Bus control interface; its window is never shown. */
static gboolean rd_hidden(void) { const char *mode = g_getenv("RD_HIDDEN"); return mode && *mode; }
void rd_run(void *data) { RdRoot *root=data;if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("run window %" G_GUINT64_FORMAT " closed=%d\n",root->serial,root->closed);if(!root->closed){root->loop=g_main_loop_new(NULL,FALSE);if(!rd_hidden()){gtk_widget_show(root->window);gtk_widget_show(root->host);}g_main_loop_run(root->loop);g_main_loop_unref(root->loop);root->loop=NULL;} }
void rd_close(void *data) {
    RdRoot *root = data; if (root->closed) return;
    if (root->layer && !root->closing && gtk_widget_get_mapped(root->window)) { root->closing = TRUE; root->fade_start = 0; root->fade_from = gtk_widget_get_opacity(root->window); gtk_widget_add_tick_callback(root->window, rd_fade_out, root, NULL); return; }
    if (!root->closing) gtk_widget_destroy(root->window);
}
int32_t rd_css(void *data, const char *text) {
    RdRoot *root = data;
    GtkCssProvider *next=NULL;
    if (*text) {
        next=gtk_css_provider_new();GError *error=NULL;
        if (!gtk_css_provider_load_from_data(next,text,-1,&error)) {
            g_printerr("react-devlang CSS: %s\n",error->message);g_clear_error(&error);g_object_unref(next);return 0;
        }
    }
    if(root->css){gtk_style_context_remove_provider_for_screen(root->screen,GTK_STYLE_PROVIDER(root->css));g_clear_object(&root->css);}
    root->css=next;root->css_revision++;
    if(next)gtk_style_context_add_provider_for_screen(root->screen,GTK_STYLE_PROVIDER(next),GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    return 1;
}
int64_t rd_css_revision(void *data){return ((RdRoot *)data)->css_revision;}
double rd_named_color(void *data,const char *name,int32_t channel){RdRoot *root=data;GdkRGBA color;if(!gtk_style_context_lookup_color(gtk_widget_get_style_context(root->window),name,&color))return -1;return channel==0?color.red:channel==1?color.green:channel==2?color.blue:color.alpha;}
void rd_free(void *data) { RdRoot *root = data;if(root->close_idle){g_source_remove(root->close_idle);root->close_idle=0;} root->layer = FALSE; root->closing = FALSE; rd_close(root);if(root->close_idle){g_source_remove(root->close_idle);root->close_idle=0;} root->dispatch = NULL; rd_css(root, "");
    if(root->popovers){for(guint i=0;i<root->popovers->len;i++)gtk_widget_destroy(g_ptr_array_index(root->popovers,i));g_ptr_array_unref(root->popovers);}
    if (root->bus_object) g_dbus_connection_unregister_object(root->bus, root->bus_object);
    if (root->bus_name) g_bus_unown_name(root->bus_name);
    g_clear_object(&root->bus); g_free(root->command); g_free(root->prefixes); g_object_unref(root->screen);g_free(root->initial);g_clear_object(&root->drag_context);g_clear_object(&root->drag_tab);
    if(root->adoptions)g_hash_table_unref(root->adoptions);
    if(root->incoming)g_queue_free_full(root->incoming,g_free);
    if(rd_roots){g_ptr_array_remove(rd_roots,root);if(!rd_roots->len){g_ptr_array_unref(rd_roots);rd_roots=NULL;}}
    g_free(root); }
/* rd_accept lists extra command prefixes ("settings.,session.") the app also answers; its exact command is always accepted. */
static gboolean rd_prefixed(RdRoot *root, const char *name) {
    if (!root->prefixes) return FALSE;
    gchar **parts = g_strsplit(root->prefixes, ",", -1); gboolean found = FALSE;
    for (int i = 0; parts[i] && !found; i++) found = *parts[i] && g_str_has_prefix(name, parts[i]);
    g_strfreev(parts); return found;
}
void rd_accept(void *data, const char *prefixes) { RdRoot *root = data; g_free(root->prefixes); root->prefixes = g_strdup(prefixes); }
static void rd_execute(GDBusConnection *connection, const char *sender, const char *path, const char *interface,
                       const char *method, GVariant *parameters, GDBusMethodInvocation *invocation, void *data) {
    (void)connection; (void)sender; (void)path; (void)interface; (void)method;
    RdRoot *root = data; char **args = NULL; const char *cwd = NULL;
    g_variant_get(parameters, "(^as&s)", &args, &cwd); (void)cwd;
    if(root->closed && rd_roots)for(guint i=0;i<rd_roots->len;i++){RdRoot *other=g_ptr_array_index(rd_roots,i);if(!other->closed && g_strcmp0(other->command,root->command)==0){root=other;break;}}
    gboolean valid = args && args[0] && (g_str_equal(args[0], root->command) || rd_prefixed(root, args[0]));
    if (valid && !root->closed) {
        /* The whole command line reaches the app as event kind 7, arguments separated by ASCII 31 (a hidden program gets the caller's folder first). */
        char *joined = g_strjoinv("\037", args);
        if (rd_hidden()) { char *line = g_strdup_printf("%s\037%s", cwd, joined); rd_emit(root, 7, NULL, line); g_free(line); }
        else { gtk_window_present(GTK_WINDOW(root->window)); rd_emit(root, 7, NULL, joined); }
        g_free(joined);
    }
    g_dbus_method_invocation_return_value(invocation, g_variant_new("(is)", valid ? 0 : 1, valid ? "" : "Unsupported app command"));
    g_strfreev(args);
}
static void rd_name_lost(GDBusConnection *connection, const char *name, void *data) {
    (void)connection; (void)name; rd_close(data);
}
int32_t rd_control(void *data, const char *id, const char *command) {
    RdRoot *root = data;
    if (!*id) return 1;
    char window_id[512];if(root->serial>1){g_snprintf(window_id,sizeof window_id,"%s.w%" G_GUINT64_FORMAT,id,root->serial);id=window_id;}
    GError *error = NULL;
    root->bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
    if (!root->bus) { g_clear_error(&error); return 0; }
    GDBusNodeInfo *info = g_dbus_node_info_new_for_xml(
        "<node><interface name='org.devos.Shell.Control'><method name='Execute'>"
        "<arg type='as' direction='in'/><arg type='s' direction='in'/><arg type='i' direction='out'/><arg type='s' direction='out'/>"
        "</method></interface></node>", &error);
    if (!info) { g_clear_error(&error); return 0; }
    gchar *path = g_strdup_printf("/%s/control", id);
    for (char *p = path; *p; p++) if (*p == '.') *p = '/';
    static const GDBusInterfaceVTable table = { .method_call = rd_execute };
    root->command = g_strdup(command);
    root->bus_object = g_dbus_connection_register_object(root->bus, path, info->interfaces[0], &table, root, NULL, &error);
    g_free(path); g_dbus_node_info_unref(info);
    if (!root->bus_object) { g_clear_error(&error); return 0; }
    root->bus_name = g_bus_own_name_on_connection(root->bus, id, G_BUS_NAME_OWNER_FLAGS_DO_NOT_QUEUE, NULL, rd_name_lost, root, NULL);
    return 1;
}
void *rd_widget(void *data, int32_t kind) {
    RdRoot *root = data; GtkWidget *widget = NULL;
    switch (kind) {
    case 18:
        widget=gtk_popover_new(NULL);g_object_ref_sink(widget);
        gtk_popover_set_constrain_to(GTK_POPOVER(widget),GTK_POPOVER_CONSTRAINT_NONE);gtk_popover_set_position(GTK_POPOVER(widget),root->popup_above ? GTK_POS_TOP : GTK_POS_BOTTOM);
        if(!root->popovers)root->popovers=g_ptr_array_new_with_free_func(g_object_unref);
        g_ptr_array_add(root->popovers,widget);g_object_set_data(G_OBJECT(widget),"rd-root",root);
        g_signal_connect(widget,"closed",G_CALLBACK(rd_clicked),root);break;
    case 22: widget=gtk_box_new(GTK_ORIENTATION_HORIZONTAL,0);g_object_set_data(G_OBJECT(widget),"rd-titlebar-strip",GINT_TO_POINTER(1));break;
    case 0: case 9: widget = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0); break;
    case 1: widget = gtk_label_new(""); gtk_label_set_xalign(GTK_LABEL(widget), 0); break;
    case 2: widget = gtk_button_new(); g_signal_connect(widget, "clicked", G_CALLBACK(rd_clicked), root); break;
    case 3: widget = gtk_entry_new(); g_signal_connect(widget, "changed", G_CALLBACK(rd_changed), root); g_signal_connect(widget,"activate",G_CALLBACK(rd_clicked),root); break;
    case 4: widget = gtk_check_button_new(); g_signal_connect(widget, "toggled", G_CALLBACK(rd_toggled), root); break;
    case 5: widget = gtk_scrolled_window_new(NULL, NULL); gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(widget), GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC); break; /* content wraps to the window instead of scrolling sideways */
    case 20: widget = gtk_scrolled_window_new(NULL, NULL); gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(widget), GTK_POLICY_AUTOMATIC, GTK_POLICY_NEVER); gtk_scrolled_window_set_propagate_natural_height(GTK_SCROLLED_WINDOW(widget), TRUE); break; /* a strip that scrolls sideways and is as high as its content */
    case 6: widget = gtk_progress_bar_new(); break;
    case 7: widget = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL); break;
    case 8: widget = gtk_combo_box_text_new(); g_signal_connect(widget,"changed",G_CALLBACK(rd_combo_changed),root); break;
    case 10: widget = gtk_search_entry_new(); g_signal_connect(widget,"changed",G_CALLBACK(rd_changed),root); g_signal_connect(widget,"activate",G_CALLBACK(rd_clicked),root); break;
    case 11: widget=gtk_image_new();break;
    case 13: widget=gtk_drawing_area_new();g_signal_connect(widget,"draw",G_CALLBACK(rd_paint),root);break;
    case 14: widget=gtk_overlay_new();break;
    case 15: {
        widget=gtk_text_view_new();gtk_text_view_set_wrap_mode(GTK_TEXT_VIEW(widget),GTK_WRAP_WORD_CHAR);GtkTextBuffer *buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(widget));g_object_set_data(G_OBJECT(buffer),"rd-owner",widget);g_signal_connect(buffer,"changed",G_CALLBACK(rd_textarea_changed),root);break;
    }
    case 19: widget=gtk_stack_new();break;
    case 21: widget=rd_code_new(root);break; /* the editor's code view (code.inc), driven by the rd_code_* calls */
    case 17: widget=gtk_scale_new_with_range(GTK_ORIENTATION_HORIZONTAL,0,100,1);gtk_scale_set_draw_value(GTK_SCALE(widget),FALSE);g_object_set_data(G_OBJECT(widget),"rd-root",root);g_signal_connect(widget,"value-changed",G_CALLBACK(rd_scaled),root);g_signal_connect(widget,"destroy",G_CALLBACK(rd_scale_destroyed),NULL);break;
    case 16: widget=gtk_switch_new();g_signal_connect(widget,"notify::active",G_CALLBACK(rd_switched),root);break;
    case 12:
        widget=gtk_entry_new();gtk_entry_set_visibility(GTK_ENTRY(widget),FALSE);
        gtk_entry_set_input_purpose(GTK_ENTRY(widget),GTK_INPUT_PURPOSE_PASSWORD);
        gtk_entry_set_input_hints(GTK_ENTRY(widget),GTK_INPUT_HINT_NO_SPELLCHECK);
        g_signal_connect(widget,"changed",G_CALLBACK(rd_changed),root);g_signal_connect(widget,"activate",G_CALLBACK(rd_clicked),root);break;
    default: rd_fail("Unknown widget kind");
    }
    rd_live_widgets++;
    g_object_set_data(G_OBJECT(widget),"rd-root",root);
    g_signal_connect(widget, "destroy", G_CALLBACK(rd_widget_destroyed), NULL);
    return widget;
}
static char *rd_string(const unsigned char *bytes, int64_t length) { return length > 0 ? g_strndup((const char *)bytes, (gsize)length) : g_strdup(""); }
static void rd_image_svg(GtkImage *image,const char *svg){
    GInputStream *stream=g_memory_input_stream_new_from_data(g_strdup(svg),-1,g_free);GError *error=NULL;
    GdkPixbuf *pixbuf=gdk_pixbuf_new_from_stream_at_scale(stream,32,32,TRUE,NULL,&error);g_object_unref(stream);g_clear_error(&error);
    if(pixbuf){gtk_image_set_from_pixbuf(image,pixbuf);g_object_unref(pixbuf);}else gtk_image_set_from_icon_name(image,"image-missing",GTK_ICON_SIZE_DIALOG);
}
static void rd_image_themed(GtkImage *image,const char *spec){
    const char *split=strchr(spec,'\n');if(!split){gtk_image_set_from_icon_name(image,"image-missing",GTK_ICON_SIZE_DIALOG);return;}
    char *theme_name=g_strndup(spec,(gsize)(split-spec));const char *icon=split+1;
    GtkIconTheme *theme=gtk_icon_theme_new();gtk_icon_theme_set_custom_theme(theme,theme_name);
    gchar **path=NULL;gint count=0;gtk_icon_theme_get_search_path(gtk_icon_theme_get_default(),&path,&count);gtk_icon_theme_set_search_path(theme,(const gchar **)path,count);g_strfreev(path);
    GdkPixbuf *pixbuf=NULL;GtkIconInfo *info=gtk_icon_theme_lookup_icon(theme,icon,32,GTK_ICON_LOOKUP_FORCE_SIZE);
    if(info){pixbuf=gtk_icon_info_load_icon(info,NULL);g_object_unref(info);}
    if(pixbuf){gtk_image_set_from_pixbuf(image,pixbuf);g_object_unref(pixbuf);}else gtk_image_set_from_icon_name(image,"image-missing",GTK_ICON_SIZE_DIALOG);
    g_object_unref(theme);g_free(theme_name);
}
/* The icon theme the session started with, for the Icons page. */
const char *rd_session_icon_theme(void){
    static char *name=NULL;if(!name){gchar *value=NULL;g_object_get(gtk_settings_get_default(),"gtk-icon-theme-name",&value,NULL);name=value?value:g_strdup("");}
    return name;
}
void rd_text(void *data, int32_t kind, const unsigned char *bytes, int64_t length) {
    GtkWidget *widget = data; char *text = rd_string(bytes, length);
    switch (kind) {
    case 18:g_object_set_data_full(G_OBJECT(widget),"rd-anchor",g_strdup(text),g_free);break;
    case 1: if (strcmp(gtk_label_get_text(GTK_LABEL(widget)), text)) gtk_label_set_text(GTK_LABEL(widget), text); break;
    case 2: case 4: if (g_strcmp0(gtk_button_get_label(GTK_BUTTON(widget)), text)) gtk_button_set_label(GTK_BUTTON(widget), text); break;
    case 3: case 10: case 12: if (strcmp(gtk_entry_get_text(GTK_ENTRY(widget)), text)) gtk_entry_set_text(GTK_ENTRY(widget), text); break;
    case 15: {
        GtkTextBuffer *buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(widget));GtkTextIter start,end;gtk_text_buffer_get_bounds(buffer,&start,&end);char *previous=gtk_text_buffer_get_text(buffer,&start,&end,FALSE);if(strcmp(previous,text))gtk_text_buffer_set_text(buffer,text,-1);g_free(previous);break;
    }
    case 11:
        if(g_strcmp0(g_object_get_data(G_OBJECT(widget),"rd-icon"),text)) {
            /* "<svg…" is drawn at 32 px; "theme:NAME
ICON" looks ICON up in the icon theme NAME (Icons settings previews). */
            if(g_str_has_prefix(text,"<svg"))rd_image_svg(GTK_IMAGE(widget),text);
            else if(g_str_has_prefix(text,"theme:"))rd_image_themed(GTK_IMAGE(widget),text+6);
            else if(*text=='/'){ /* an icon file, as a desktop entry's Icon= names it (installed packages ship theirs this way) */
                GFile *file=g_file_new_for_path(text);GIcon *icon=g_file_icon_new(file);
                gtk_image_set_from_gicon(GTK_IMAGE(widget),icon,GTK_ICON_SIZE_BUTTON);g_object_unref(icon);g_object_unref(file);
            }
            else if(*text)gtk_image_set_from_icon_name(GTK_IMAGE(widget),text,GTK_ICON_SIZE_BUTTON);else gtk_image_clear(GTK_IMAGE(widget));
            g_object_set_data_full(G_OBJECT(widget),"rd-icon",g_strdup(text),g_free);
        }
        break;
    case 8:
        if (g_strcmp0(g_object_get_data(G_OBJECT(widget),"rd-options"),text)) {
            gtk_combo_box_text_remove_all(GTK_COMBO_BOX_TEXT(widget));
            char **items=g_strsplit(text,"\n",-1); for (char **item=items;*item;item++) gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(widget),*item);
            g_strfreev(items); g_object_set_data_full(G_OBJECT(widget),"rd-options",g_strdup(text),g_free);
        }
        break;
    default: break;
    }
    g_free(text);
}
void rd_name(void *data, const unsigned char *bytes, int64_t length) { char *text = rd_string(bytes, length); gtk_widget_set_name(data, text); g_free(text); }
typedef struct {guint64 source;GtkWidget *widget;guint64 target;} RdTabDrop;
static gboolean rd_tab_drop_idle(void *data){RdTabDrop *drop=data;char event[64];g_snprintf(event,sizeof event,"detach:%" G_GUINT64_FORMAT,drop->target);if(rd_roots)for(guint i=0;i<rd_roots->len;i++){RdRoot *root=g_ptr_array_index(rd_roots,i);if(root->serial==drop->source && !root->drag_cancelled){if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("drop dispatch %s widget=%s closed=%d applying=%d\n",event,gtk_widget_get_name(drop->widget),root->closed,root->applying);rd_emit(root,6,drop->widget,event);if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("drop dispatch returned\n");break;}}g_object_unref(drop->widget);g_free(drop);return G_SOURCE_REMOVE;}
static void rd_tab_drop(RdRoot *root,GtkWidget *widget,guint64 target){RdTabDrop *drop=g_new0(RdTabDrop,1);drop->source=root->serial;drop->widget=g_object_ref(widget);drop->target=target;g_idle_add(rd_tab_drop_idle,drop);}
static void rd_tab_drag_get(GtkWidget *widget,GdkDragContext *context,GtkSelectionData *selection,guint info,guint time,void *unused){
    (void)context;(void)time;(void)unused;RdRoot *root=g_object_get_data(G_OBJECT(widget),"rd-root");
    if(info==1){if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("tab cancellation marker received\n");root->drag_cancelled=TRUE;gtk_selection_data_set(selection,gtk_selection_data_get_target(selection),8,(const guchar *)"",0);return;}
    char *value=g_strdup_printf("%" G_GUINT64_FORMAT ":%s",root->serial,gtk_widget_get_name(widget));gtk_selection_data_set(selection,gtk_selection_data_get_target(selection),8,(const guchar *)value,(gint)strlen(value));g_free(value);
}
static void rd_tab_drag_received(GtkWidget *widget,GdkDragContext *context,gint x,gint y,GtkSelectionData *selection,guint info,guint time,void *unused){
    (void)x;(void)y;(void)info;(void)unused;gint length=gtk_selection_data_get_length(selection);const guchar *bytes=gtk_selection_data_get_data(selection);gboolean valid=length>0 && length<160 && gtk_widget_is_sensitive(widget);
    RdRoot *target=g_object_get_data(G_OBJECT(widget),"rd-root");
    if(valid){char *value=g_strndup((const char *)bytes,length),*end=NULL;guint64 serial=g_ascii_strtoull(value,&end,10);valid=end && *end==':';RdRoot *source=NULL;
        if(valid && rd_roots)for(guint i=0;i<rd_roots->len;i++){RdRoot *candidate=g_ptr_array_index(rd_roots,i);if(candidate->serial==serial && !candidate->closed){source=candidate;break;}}
        GtkWidget *tab=source ? rd_find_name(source,end+1) : NULL;valid=tab && gtk_style_context_has_class(gtk_widget_get_style_context(tab),"chrome-tab-select") && g_strcmp0(source->command,target->command)==0 && !source->drag_cancelled;
        if(valid && source!=target)rd_tab_drop(source,tab,target->serial);
        else if(valid){const char *name=gtk_widget_get_name(tab),*id=strrchr(name,'-');if(GTK_IS_BUTTON(widget) && id){char *event=g_strconcat("reorder:",id+1,NULL);rd_emit(target,6,widget,event);g_free(event);}else if(GTK_IS_WINDOW(widget)){rd_tab_drop(source,tab,0);} /* Leaving the tab strip also detaches from a maximized window. */}
        g_free(value);
    }
    gtk_drag_finish(context,valid,FALSE,time);
}
static gboolean rd_tab_drag_failed(GtkWidget *widget,GdkDragContext *context,GtkDragResult result,void *unused){
    (void)context;(void)unused;
    if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("tab drag failed: %d\n",result);
    RdRoot *root=g_object_get_data(G_OBJECT(widget),"rd-root");
    if(root->drag_cancelled || (result!=GTK_DRAG_RESULT_NO_TARGET && result!=GTK_DRAG_RESULT_ERROR))return FALSE;
    /* GTK Wayland reports unaccepted drops as ERROR; explicit Escape remains USER_CANCELLED. */
    rd_tab_drop(root,widget,0);return TRUE;
}
static void rd_tab_drag_begin_debug(GtkWidget *widget,GdkDragContext *context,void *unused){
    (void)unused;RdRoot *root=g_object_get_data(G_OBJECT(widget),"rd-root");root->drag_cancelled=FALSE;g_set_object(&root->drag_context,context);g_set_object(&root->drag_tab,widget);
    if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("tab drag begin: %s\n",gtk_widget_get_name(widget));
}
static void rd_tab_drag_end_debug(GtkWidget *widget,GdkDragContext *context,void *unused){
    (void)unused;RdRoot *root=g_object_get_data(G_OBJECT(widget),"rd-root");if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("tab drag end: %s action=%d cancelled=%d\n",gtk_widget_get_name(widget),gdk_drag_context_get_selected_action(context),root->drag_cancelled);
    g_clear_object(&root->drag_context);g_clear_object(&root->drag_tab);
}
static void rd_tab_drag(GtkWidget *widget){
    gboolean tab=GTK_IS_BUTTON(widget) && gtk_style_context_has_class(gtk_widget_get_style_context(widget),"chrome-tab-select");gboolean strip=g_object_get_data(G_OBJECT(widget),"rd-titlebar-strip")!=NULL;
    if((!tab && !strip && !GTK_IS_WINDOW(widget)) || g_object_get_data(G_OBJECT(widget),"rd-tab-drag"))return;
    GtkTargetEntry target={(gchar *)"application/x-dev-os-window-tab",GTK_TARGET_SAME_APP,0};
    if(tab){GtkTargetEntry sources[2]={target,{(gchar *)"application/x-dev-os-window-tab-cancel",GTK_TARGET_SAME_APP,1}};gtk_drag_source_set(widget,GDK_BUTTON1_MASK,sources,2,GDK_ACTION_MOVE);g_signal_connect(widget,"drag-data-get",G_CALLBACK(rd_tab_drag_get),NULL);g_signal_connect(widget,"drag-failed",G_CALLBACK(rd_tab_drag_failed),NULL);g_signal_connect(widget,"drag-begin",G_CALLBACK(rd_tab_drag_begin_debug),NULL);g_signal_connect(widget,"drag-end",G_CALLBACK(rd_tab_drag_end_debug),NULL);}
    gtk_drag_dest_set(widget,GTK_DEST_DEFAULT_ALL,&target,1,GDK_ACTION_MOVE);g_signal_connect(widget,"drag-data-received",G_CALLBACK(rd_tab_drag_received),NULL);g_object_set_data(G_OBJECT(widget),"rd-tab-drag",GINT_TO_POINTER(1));
}
void rd_class(void *data, const unsigned char *bytes, int64_t length) {
    GtkWidget *widget = data; char *text = rd_string(bytes, length);
    const char *previous = g_object_get_data(G_OBJECT(widget), "rd-classes");
    if (g_strcmp0(previous, text)) {
        GtkStyleContext *style = gtk_widget_get_style_context(widget);
        char **old = g_strsplit(previous ? previous : "", " ", -1), **next = g_strsplit(text, " ", -1);
        for (char **item = old; *item; item++) if (**item) gtk_style_context_remove_class(style, *item);
        for (char **item = next; *item; item++) if (**item) gtk_style_context_add_class(style, *item);
        g_strfreev(old); g_strfreev(next);
        g_object_set_data_full(G_OBJECT(widget), "rd-classes", g_strdup(text), g_free);
    }
    g_free(text);rd_tab_drag(widget);
}
void rd_layout(void *data, int32_t kind, int32_t vertical, int32_t spacing, int32_t expand, int32_t sensitive, int32_t visible, int32_t width, int32_t height) {
    GtkWidget *widget = data;
    if (kind == 0 || kind == 9) { gtk_orientable_set_orientation(GTK_ORIENTABLE(widget), vertical ? GTK_ORIENTATION_VERTICAL : GTK_ORIENTATION_HORIZONTAL); gtk_box_set_spacing(GTK_BOX(widget), spacing); gtk_box_set_homogeneous(GTK_BOX(widget), gtk_style_context_has_class(gtk_widget_get_style_context(widget), "homogeneous")); }
    gtk_widget_set_hexpand(widget, expand); gtk_widget_set_vexpand(widget, kind==22 ? FALSE : expand);
    gtk_widget_set_sensitive(widget, sensitive); gtk_widget_set_size_request(widget, width, height);
    if(kind==18)g_object_set_data(G_OBJECT(widget),"rd-popover-visible",GINT_TO_POINTER(visible));else gtk_widget_set_visible(widget, visible);
}
/* Range as "min max" text, then the value; the handler is blocked so a render never reports as user input. */
void rd_scale(void *widget,const char *range,double value){
    int low=0,high=100;if(range&&sscanf(range,"%d %d",&low,&high)!=2){low=0;high=100;}
    if(high<=low)high=low+1;
    g_signal_handlers_block_matched(widget,G_SIGNAL_MATCH_FUNC,0,0,NULL,G_CALLBACK(rd_scaled),NULL);
    gtk_range_set_range(GTK_RANGE(widget),low,high);gtk_range_set_value(GTK_RANGE(widget),value);
    g_signal_handlers_unblock_matched(widget,G_SIGNAL_MATCH_FUNC,0,0,NULL,G_CALLBACK(rd_scaled),NULL);
}
void rd_active(void *widget, int32_t active) {if(GTK_IS_POPOVER(widget))gtk_popover_set_modal(GTK_POPOVER(widget),active!=0);else if(GTK_IS_SWITCH(widget))gtk_switch_set_active(GTK_SWITCH(widget),active!=0);else gtk_toggle_button_set_active(widget, active != 0); }
void rd_alignment(void *data,int32_t horizontal,int32_t vertical,int32_t margin) {
    GtkWidget *widget=data;
    if(horizontal<0 || horizontal>4 || vertical<0 || vertical>4 || margin<0)rd_fail("Invalid widget alignment or margin");
    gtk_widget_set_halign(widget,horizontal);gtk_widget_set_valign(widget,vertical);
    gtk_widget_set_margin_start(widget,margin);gtk_widget_set_margin_end(widget,margin);gtk_widget_set_margin_top(widget,margin);gtk_widget_set_margin_bottom(widget,margin);
}
void rd_icon_size(void *widget,int32_t size) {if(size<1)rd_fail("Icon size must be positive");gtk_image_set_pixel_size(GTK_IMAGE(widget),size);}
/* A negative fraction means "busy, no known end": the bar pulses until a fraction of 0 or more arrives or the bar leaves its window. */
static gboolean rd_pulse_tick(gpointer data) {
    GtkWidget *bar = data;
    if (!g_object_get_data(G_OBJECT(bar), "rd-pulse") || !gtk_widget_get_parent(bar)) { g_object_set_data(G_OBJECT(bar), "rd-pulse-timer", NULL); return G_SOURCE_REMOVE; }
    gtk_progress_bar_pulse(GTK_PROGRESS_BAR(bar));
    return G_SOURCE_CONTINUE;
}
void rd_fraction(void *widget, double value) {
    if (value < 0) {
        g_object_set_data(G_OBJECT(widget), "rd-pulse", GINT_TO_POINTER(1));
        gtk_progress_bar_set_pulse_step(GTK_PROGRESS_BAR(widget), 0.12);
        if (!g_object_get_data(G_OBJECT(widget), "rd-pulse-timer")) {
            g_object_set_data(G_OBJECT(widget), "rd-pulse-timer", GINT_TO_POINTER(1));
            g_timeout_add_full(G_PRIORITY_DEFAULT, 80, rd_pulse_tick, g_object_ref(widget), g_object_unref);
        }
        return;
    }
    g_object_set_data(G_OBJECT(widget), "rd-pulse", NULL);
    gtk_progress_bar_set_fraction(GTK_PROGRESS_BAR(widget), CLAMP(value, 0, 1));
}
/* Position is separate from GTK page names so keyed removal cannot collide with an old page. */
void rd_stack_select(void *widget,int32_t index){
    GList *children=gtk_container_get_children(GTK_CONTAINER(widget));
    for(GList *p=children;p;p=p->next)if(GPOINTER_TO_INT(g_object_get_data(G_OBJECT(p->data),"rd-stack-index"))==index+1){gtk_stack_set_visible_child(GTK_STACK(widget),p->data);break;}
    g_list_free(children);
}
void rd_selected(void *widget,int32_t index) { gtk_combo_box_set_active(GTK_COMBO_BOX(widget),index); }
void rd_label_options(void *widget,double xalign,int32_t width,int32_t wrap,int32_t ellipsize) {
    gtk_label_set_xalign(GTK_LABEL(widget),(float)xalign); gtk_label_set_width_chars(GTK_LABEL(widget),width);
    gtk_label_set_line_wrap(GTK_LABEL(widget),wrap); if (wrap) gtk_label_set_max_width_chars(GTK_LABEL(widget),44); /* a wrapped label must not ask for the width of its whole text */
    gtk_label_set_ellipsize(GTK_LABEL(widget),ellipsize ? PANGO_ELLIPSIZE_END : PANGO_ELLIPSIZE_NONE);
}
void rd_placeholder(void *widget,const unsigned char *bytes,int64_t length) { char *value=rd_string(bytes,length); gtk_entry_set_placeholder_text(GTK_ENTRY(widget),value); g_free(value); }
int32_t rd_select_name(void *root,const char *name,int32_t index) { GtkWidget *widget=rd_find_name(root,name); if (!widget || !GTK_IS_COMBO_BOX(widget)) return 0; gtk_combo_box_set_active(GTK_COMBO_BOX(widget),index); return 1; }
int32_t rd_owns(void *data,void *widget){return g_object_get_data(G_OBJECT(widget),"rd-root")==data;}
void *rd_park(void *data,const char *name){
    if(!*name)return NULL;
    GtkWidget *widget=rd_find_name(data,name);if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("park %s found=%d\n",name,widget!=NULL);if(!widget)return NULL;
    g_object_ref(widget);GtkWidget *parent=gtk_widget_get_parent(widget);if(parent)gtk_container_remove(GTK_CONTAINER(parent),widget);
    g_object_set_data(G_OBJECT(widget),"rd-root",NULL);g_object_set_data(G_OBJECT(widget),"rd-park-ref",GINT_TO_POINTER(1));return widget;
}
void rd_initial(void *data,const char *value){RdRoot *root=data;if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("initial window %" G_GUINT64_FORMAT "\n",root->serial);g_free(root->initial);root->initial=g_strdup(value);}
const char *rd_initial_text(void *data){RdRoot *root=data;return root->initial ? root->initial : "";}
static void rd_offer(RdRoot *root,GtkWidget *widget){if(!widget)return;if(!root->adoptions)root->adoptions=g_hash_table_new_full(g_str_hash,g_str_equal,g_free,g_object_unref);g_object_set_data(G_OBJECT(widget),"rd-root",root);RdCode *code=rd_code_of(widget);if(code)code->root=root;g_hash_table_insert(root->adoptions,g_strdup(gtk_widget_get_name(widget)),widget);}
void rd_offer_widget(void *data,void *widget){if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("offer widget\n");rd_offer(data,widget);}
void *rd_take_widget(void *data,const char *name){RdRoot *root=data;if(!root->adoptions || !*name)return NULL;gpointer key=NULL,value=NULL;if(!g_hash_table_lookup_extended(root->adoptions,name,&key,&value))return NULL;g_hash_table_steal(root->adoptions,key);g_free(key);return value;}
char *rd_take_incoming(void *data){RdRoot *root=data;return root->incoming && !g_queue_is_empty(root->incoming) ? g_queue_pop_head(root->incoming) : g_strdup("");}
int32_t rd_deliver(int64_t target,const char *metadata,void *widget){
    if(rd_roots)for(guint i=0;i<rd_roots->len;i++){RdRoot *root=g_ptr_array_index(rd_roots,i);if(root->serial==(guint64)target && !root->closed){rd_offer(root,widget);if(!root->incoming)root->incoming=g_queue_new();g_queue_push_tail(root->incoming,g_strdup(metadata));rd_emit(root,7,NULL,"tabs:receive");return 1;}}
    return 0;
}
void rd_attach(void *parent, void *child, int32_t index) {
    if(g_object_get_data(G_OBJECT(child),"rd-titlebar-strip")){
        RdRoot *root=g_object_get_data(G_OBJECT(child),"rd-root");GtkWidget *header=gtk_window_get_titlebar(GTK_WINDOW(root->window));
        if(GTK_IS_HEADER_BAR(header)){
            if(gtk_header_bar_get_custom_title(GTK_HEADER_BAR(header))!=child){
                g_object_ref(child);GtkWidget *old=gtk_widget_get_parent(child);if(old)gtk_container_remove(GTK_CONTAINER(old),child);
                gtk_header_bar_set_custom_title(GTK_HEADER_BAR(header),child);g_object_unref(child);
            }
            return;
        }
    }
    if(GTK_IS_POPOVER(child)){
        RdRoot *root=g_object_get_data(G_OBJECT(child),"rd-root");const char *name=g_object_get_data(G_OBJECT(child),"rd-anchor");
        gboolean pointer=name && g_str_has_prefix(name,"@pointer:");
        /* Context menus must stay inside the app, including near screen edges. */
        if(pointer)gtk_popover_set_constrain_to(GTK_POPOVER(child),GTK_POPOVER_CONSTRAINT_WINDOW);
        GtkWidget *anchor=name ? rd_find_name(root,pointer ? name+9 : name) : NULL;
        if(anchor){
            /* The root host outlives reconciled anchors and their children. */
            if(gtk_popover_get_relative_to(GTK_POPOVER(child))!=root->host)gtk_popover_set_relative_to(GTK_POPOVER(child),root->host);
            gint x=0,y=0;if(gtk_widget_translate_coordinates(anchor,root->host,0,0,&x,&y)){GdkRectangle rect={x,y,gtk_widget_get_allocated_width(anchor),gtk_widget_get_allocated_height(anchor)};if(pointer){rect.x=root->pointer_x;rect.y=root->pointer_y;rect.width=1;rect.height=1;}gtk_popover_set_pointing_to(GTK_POPOVER(child),&rect);}
        }
        gboolean wanted=anchor && GPOINTER_TO_INT(g_object_get_data(G_OBJECT(child),"rd-popover-visible"));gboolean opened=GPOINTER_TO_INT(g_object_get_data(G_OBJECT(child),"rd-popover-opened"));
        if(wanted && !opened){g_object_set_data(G_OBJECT(child),"rd-popover-opened",GINT_TO_POINTER(1));gtk_popover_popup(GTK_POPOVER(child));}
        else if(!wanted && opened){g_object_set_data(G_OBJECT(child),"rd-popover-opened",NULL);gtk_popover_popdown(GTK_POPOVER(child));}
        return;
    }
    if (!gtk_widget_get_parent(child)) {
        if (GTK_IS_BOX(parent)) gtk_box_pack_start(parent, child, gtk_widget_get_vexpand(child), TRUE, 0);
        else if (GTK_IS_SCROLLED_WINDOW(parent)) {
            /* GTK may leave its automatic viewport after the old child dies. */
            GtkWidget *viewport = gtk_bin_get_child(GTK_BIN(parent));
            if (viewport) gtk_container_remove(parent, viewport);
            gtk_container_add(parent, child);
        }
        else if (GTK_IS_OVERLAY(parent)) {
            if(gtk_bin_get_child(GTK_BIN(parent)))rd_fail("Overlay already has a main child");
            gtk_container_add(parent,child);
        }
        else if (GTK_IS_BUTTON(parent)) {
            GtkWidget *old = gtk_bin_get_child(GTK_BIN(parent));
            if (old) gtk_container_remove(parent, old);
            gtk_container_add(parent, child);
        }
        else if(GTK_IS_STACK(parent))gtk_container_add(parent,child);
        else if(GTK_IS_POPOVER(parent))gtk_container_add(parent,child);
        else rd_fail("This widget cannot contain children");
    }
    if(g_object_get_data(G_OBJECT(child),"rd-park-ref") && gtk_widget_get_parent(child)){g_object_set_data(G_OBJECT(child),"rd-park-ref",NULL);g_object_unref(child);}
    if (GTK_IS_STACK(parent)) {
        g_object_set_data(G_OBJECT(child),"rd-stack-index",GINT_TO_POINTER(index+1));
    }
    if (GTK_IS_BOX(parent)) {
        gtk_box_set_child_packing(parent, child, gtk_widget_get_vexpand(child), TRUE, 0, GTK_PACK_START);
        gtk_box_reorder_child(parent, child, index);
    }
}
void rd_destroy(void *widget) { gboolean popup=GTK_IS_POPOVER(widget);RdRoot *root=popup ? g_object_get_data(G_OBJECT(widget),"rd-root") : NULL;gtk_widget_destroy(widget);if(root)g_ptr_array_remove(root->popovers,widget); }
void rd_popover_direction(void *data,int32_t above){RdRoot *root=data;root->popup_above=above!=0;if(root->popovers)for(guint i=0;i<root->popovers->len;i++)gtk_popover_set_position(GTK_POPOVER(g_ptr_array_index(root->popovers,i)),above ? GTK_POS_TOP : GTK_POS_BOTTOM);}
static GtkWidget *rd_find(GtkWidget *widget, const char *name) {
    if (!strcmp(gtk_widget_get_name(widget), name)) return widget;
    if (GTK_IS_CONTAINER(widget)) {
        GList *children = gtk_container_get_children(GTK_CONTAINER(widget));
        GtkWidget *found = NULL;
        for (GList *node = children; node && !found; node = node->next) found = rd_find(node->data, name);
        g_list_free(children); return found;
    }
    return NULL;
}
void *rd_find_name(void *data, const char *name) { RdRoot *root = data;if(root->closed)return NULL;GtkWidget *found=rd_find(root->window,name);if(!found && root->popovers)for(guint i=0;i<root->popovers->len && !found;i++)found=rd_find(g_ptr_array_index(root->popovers,i),name);return found; }
int32_t rd_click_name(void *data, const char *name) { GtkWidget *widget = rd_find_name(data, name); if (!widget || !GTK_IS_BUTTON(widget)) return 0; gtk_button_clicked(GTK_BUTTON(widget)); return 1; }
int32_t rd_change_name(void *data, const char *name, const char *text) { GtkWidget *widget = rd_find_name(data, name); if(!widget)return 0;if(GTK_IS_TEXT_VIEW(widget)){gtk_text_buffer_set_text(gtk_text_view_get_buffer(GTK_TEXT_VIEW(widget)),text,-1);return 1;}if(!GTK_IS_ENTRY(widget))return 0;gtk_entry_set_text(GTK_ENTRY(widget), text); return 1; }
int32_t rd_activate_name(void *data,const char *name) {GtkWidget *widget=rd_find_name(data,name);if(!widget || !GTK_IS_ENTRY(widget) || !gtk_widget_get_sensitive(widget))return 0;g_signal_emit_by_name(widget,"activate");return 1;}
const char *rd_text_name(void *data, const char *name) { GtkWidget *widget = rd_find_name(data, name); if (!widget) return ""; if (GTK_IS_LABEL(widget)) return gtk_label_get_text(GTK_LABEL(widget)); if (GTK_IS_ENTRY(widget)) return gtk_entry_get_text(GTK_ENTRY(widget));if(GTK_IS_TEXT_VIEW(widget)){GtkTextBuffer *buffer=gtk_text_view_get_buffer(GTK_TEXT_VIEW(widget));GtkTextIter start,end;gtk_text_buffer_get_bounds(buffer,&start,&end);char *text=gtk_text_buffer_get_text(buffer,&start,&end,FALSE);g_object_set_data_full(G_OBJECT(widget),"rd-read-text",text,g_free);return text;}return ""; }

/* A clock for the window: every `milliseconds` the app gets an event of kind 8 through the normal dispatch path (ui.onTick). Apps use it to read the
 * state of a widget that a C library owns (a web view's address, a terminal's title) without handing a callback to GLib. Stops when the window closes. */
static gboolean rd_tick_event(void *data) { RdRoot *root = data; if (root->closed) return G_SOURCE_REMOVE; rd_emit(root, 8, NULL, NULL); return G_SOURCE_CONTINUE; }
void rd_tick(void *data,int32_t milliseconds){RdRoot *root=data;if(root->tick)g_source_remove(root->tick);root->tick=g_timeout_add(milliseconds<50 ? 50 : (guint)milliseconds,rd_tick_event,data);}
/* Closes the window when `widget` emits `signal` (for example a terminal's "child-exited", whose handler takes an int status). The close runs from
 * an idle callback, after the signal has returned. The library that owns the widget needs no header here: the signal is connected by name. */
static gboolean rd_close_idle(void *data) { rd_close(data); return G_SOURCE_REMOVE; }
static void rd_signal_close(void *instance, int status, void *data) { (void)instance; (void)status; g_idle_add(rd_close_idle, data); }
void *rd_host_child(void *host){if(!host || !GTK_IS_CONTAINER(host))return NULL;GList *children=gtk_container_get_children(GTK_CONTAINER(host));void *child=children ? children->data : NULL;g_list_free(children);return child;}
static void rd_tab_child_exited(GtkWidget *widget,gint status,void *unused){(void)status;(void)unused;g_object_set_data(G_OBJECT(widget),"rd-child-exited",GINT_TO_POINTER(1));}
static void rd_terminal_spawned(void *widget,GPid pid,GError *error,void *unused){(void)unused;if(!widget)return;if(error)g_object_set_data(G_OBJECT(widget),"rd-child-exited",GINT_TO_POINTER(1));else g_object_set_data(G_OBJECT(widget),"rd-child-pid",GINT_TO_POINTER(pid));}
void *rd_terminal_spawn_callback(void){return rd_terminal_spawned;}
char *rd_terminal_cwd(void *widget){
    if(!widget)return NULL;
    gint pid=GPOINTER_TO_INT(g_object_get_data(G_OBJECT(widget),"rd-child-pid"));
    if(pid>0){char *name=g_strdup_printf("/proc/%d/cwd",pid);char *cwd=g_file_read_link(name,NULL);g_free(name);if(cwd)return cwd;}
    char *uri=NULL;g_object_get(widget,"current-directory-uri",&uri,NULL);char *cwd=uri ? g_filename_from_uri(uri,NULL,NULL) : NULL;g_free(uri);return cwd;
}
void rd_watch_child(void *widget){g_signal_connect(widget,"child-exited",G_CALLBACK(rd_tab_child_exited),NULL);}
int32_t rd_child_exited(void *widget){return widget && g_object_get_data(G_OBJECT(widget),"rd-child-exited") ? 1 : 0;}
void rd_close_on(void *widget, const char *signal, void *root) { g_signal_connect(widget, signal, G_CALLBACK(rd_signal_close), root); }
/* Ctrl+Shift+C and Ctrl+Shift+V on a VTE terminal run its "copy-clipboard" and "paste-clipboard" action signals (connected by name, no VTE header). */
static gboolean rd_terminal_key(GtkWidget *widget, GdkEventKey *event, void *data) {
    (void)data;
    if ((event->state & gtk_accelerator_get_default_mod_mask()) != (GDK_CONTROL_MASK | GDK_SHIFT_MASK)) return FALSE;
    if (event->keyval == GDK_KEY_C || event->keyval == GDK_KEY_c) { g_signal_emit_by_name(widget, "copy-clipboard"); return TRUE; }
    if (event->keyval == GDK_KEY_V || event->keyval == GDK_KEY_v) { g_signal_emit_by_name(widget, "paste-clipboard"); return TRUE; }
    return FALSE;
}
void rd_terminal_keys(void *widget) { g_signal_connect(widget, "key-press-event", G_CALLBACK(rd_terminal_key), NULL); }
/* The pointer stored in an object property (for example the "widget" of a GStreamer gtksink); g_object_get is variadic, which DevLang cannot call. */
void *rd_object_pointer(void *object, const char *property) { void *value = NULL; g_object_get(object, property, &value, NULL); return value; }
/* A NULL-terminated string array for C libraries that take char ** (for example VTE's spawn); the caller keeps it for the life of the process. */
void *rd_strv_new(int32_t count){ return g_new0(char *,(gsize)(count<0?0:count)+1); }
void rd_strv_set(void *vector,int32_t index,const char *text){ ((char **)vector)[index]=g_strdup(text); }

/* Runs `dev-os-shell <command>` for a Settings entry that lives in another native process; only `settings.<name>` is accepted. */
int32_t rd_launch_shell(const char *root,const char *command){
    if(!root||!*root||!command||strncmp(command,"settings.",9)||!command[9])return 0;
    for(const char *p=command+9;*p;p++)if(!g_ascii_islower(*p)&&*p!='-')return 0;
    char *script=g_build_filename(root,"bin","dev-os-shell",NULL);char *args[]={"sh",script,(char *)command,NULL};GError *error=NULL;
    gboolean ok=g_spawn_async(NULL,args,NULL,G_SPAWN_SEARCH_PATH,NULL,NULL,NULL,&error);
    g_clear_error(&error);g_free(script);return ok?1:0;
}

/* Opens the GitHub device-flow page in the default browser (Accounts page); no other address is accepted. */
int32_t rd_open_device_page(void){
    GError *error=NULL;gboolean ok=g_app_info_launch_default_for_uri("https://github.com/login/device",NULL,&error);
    g_clear_error(&error);return ok?1:0;
}
