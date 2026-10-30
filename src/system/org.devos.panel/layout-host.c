/* Generic layer-shell positioning and GTK lifecycle only. Layout policy is DevLang. */
#include <gtk/gtk.h>
#include <glib-unix.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
void panel_flush(void){fflush(stdout);}
extern void *rd_window(void *root);
extern void *rd_find_name(void *root,const char *name);
void panel_battery_trace(void *root){if(g_strcmp0(g_getenv("DEVOS_PANEL_LAYOUT_TRACE"),"1")==0){GtkWidget *label=rd_find_name(root,"panel-battery-label");if(GTK_IS_LABEL(label)){g_print("PANEL BATTERY %s\n",gtk_label_get_text(GTK_LABEL(label)));fflush(stdout);}}}
extern void rd_popover_direction(void *root,int32_t above);
typedef struct {GDBusConnection *bus;guint subscription;void (*call)(const unsigned char *,int64_t,void *);void *data;} PanelMessages;
static void panel_message(GDBusConnection *bus,const char *sender,const char *path,const char *interface,const char *signal,GVariant *parameters,void *data){(void)bus;(void)sender;(void)path;(void)interface;(void)signal;PanelMessages *messages=data;const char *text;g_variant_get(parameters,"(&s)",&text);messages->call((const unsigned char *)text,(int64_t)strlen(text),messages->data);}
void *panel_messages(void (*call)(const unsigned char *,int64_t,void *),void *data){GError *error=NULL;GDBusConnection *bus=g_bus_get_sync(G_BUS_TYPE_SESSION,NULL,&error);if(!bus){g_clear_error(&error);return NULL;}PanelMessages *messages=g_new0(PanelMessages,1);messages->bus=bus;messages->call=call;messages->data=data;messages->subscription=g_dbus_connection_signal_subscribe(bus,NULL,"org.devos.Panel","Message","/org/devos/Panel",NULL,G_DBUS_SIGNAL_FLAGS_NONE,panel_message,messages,NULL);return messages;}
void panel_messages_free(void *data,void *keep){(void)keep;PanelMessages *messages=data;if(messages){g_dbus_connection_signal_unsubscribe(messages->bus,messages->subscription);g_object_unref(messages->bus);g_free(messages);}}
typedef struct {void (*call)(void *);void *data;} PanelTick;
static gboolean panel_tick(void *data){PanelTick *tick=data;tick->call(tick->data);return G_SOURCE_CONTINUE;}
uint32_t panel_timer(int32_t interval,void (*call)(void *),void *data){PanelTick *tick=g_new(PanelTick,1);tick->call=call;tick->data=data;return g_timeout_add_full(G_PRIORITY_DEFAULT_IDLE,MAX(16,interval),panel_tick,tick,g_free);}
void panel_untimer(uint32_t timer,void *keep){(void)keep;if(timer)g_source_remove(timer);}
int64_t panel_now(void){return g_get_monotonic_time()/1000;}
void panel_widget_trace(void *root,const char *name);
void panel_tray_trace(void *root){if(g_strcmp0(g_getenv("DEVOS_PANEL_LAYOUT_TRACE"),"1")==0 && GTK_IS_IMAGE(rd_find_name(root,"panel-network-icon")) && GTK_IS_IMAGE(rd_find_name(root,"panel-audio-icon"))){g_print("PANEL TRAY READY\n");panel_widget_trace(root,"panel-devices");GtkWidget *popup=rd_find_name(root,"panel-quick-settings");g_print("PANEL QUICK SETTINGS %d\n",popup && gtk_widget_get_visible(popup));fflush(stdout);}}
void panel_image(void *root,const char *id,const char *serialized,const char *fallback){
    GtkWidget *image=rd_find_name(root,id);if(!GTK_IS_IMAGE(image))return;const char *previous=g_object_get_data(G_OBJECT(image),"panel-gicon");
    if(g_strcmp0(previous,serialized)==0 || (!previous && !*serialized))return;
    GError *error=NULL;GIcon *icon=*serialized ? g_icon_new_for_string(serialized,&error) : NULL;
    if(icon){gtk_image_set_from_gicon(GTK_IMAGE(image),icon,GTK_ICON_SIZE_BUTTON);g_object_unref(icon);}else gtk_image_set_from_icon_name(GTK_IMAGE(image),fallback,GTK_ICON_SIZE_BUTTON);
    g_clear_error(&error);g_object_set_data_full(G_OBJECT(image),"panel-gicon",g_strdup(serialized),g_free);
}
void panel_tooltip(void *root,const char *id,const char *text){GtkWidget *widget=rd_find_name(root,id);if(widget)gtk_widget_set_tooltip_text(widget,text);}
void panel_avatar(void *root,const char *id,const char *file,int32_t size){
    GtkWidget *widget=rd_find_name(root,id);if(!GTK_IS_IMAGE(widget))return;
    char *key=g_strdup_printf("%d:%s",size,file);if(g_strcmp0(g_object_get_data(G_OBJECT(widget),"panel-avatar"),key)==0){g_free(key);return;}
    GError *error=NULL;GdkPixbuf *image=*file ? gdk_pixbuf_new_from_file_at_scale(file,size,size,TRUE,&error) : NULL;
    if(image){gtk_image_set_from_pixbuf(GTK_IMAGE(widget),image);g_object_unref(image);}else gtk_image_set_from_icon_name(GTK_IMAGE(widget),"avatar-default-symbolic",GTK_ICON_SIZE_DIALOG);
    gtk_image_set_pixel_size(GTK_IMAGE(widget),size);g_clear_error(&error);g_object_set_data_full(G_OBJECT(widget),"panel-avatar",key,g_free);
}
void panel_task_trace(void *root,const char *id,const char *group){if(g_strcmp0(g_getenv("DEVOS_PANEL_LAYOUT_TRACE"),"1")!=0)return;GtkWidget *widget=rd_find_name(root,id);if(widget){GtkStyleContext *style=gtk_widget_get_style_context(widget);g_print("PANEL TASK %s %s %d %d\n",group,id,gtk_style_context_has_class(style,"task-active"),gtk_style_context_has_class(style,"task-minimized"));fflush(stdout);}}
void panel_tasks_trace(void *root){if(g_strcmp0(g_getenv("DEVOS_PANEL_LAYOUT_TRACE"),"1")!=0)return;GtkWidget *widget=rd_find_name(root,"native-panel-tasks");if(GTK_IS_CONTAINER(widget)){GList *children=gtk_container_get_children(GTK_CONTAINER(widget));g_print("PANEL TASK COUNT %u\n",g_list_length(children));g_list_free(children);fflush(stdout);}}
void panel_clock_trace(void *root){if(g_strcmp0(g_getenv("DEVOS_PANEL_LAYOUT_TRACE"),"1")==0){GtkWidget *label=rd_find_name(root,"panel-clock-time");if(GTK_IS_LABEL(label)){const char *text=gtk_label_get_text(GTK_LABEL(label));g_print("PANEL CLOCK %s\n",text);if(*text && g_strcmp0(text,"…")!=0)g_print("PANEL FRAME %ld\n",(long)getpid());fflush(stdout);}}}
extern gboolean gtk_layer_is_supported(void);
extern void gtk_layer_init_for_window(GtkWindow *);
extern void gtk_layer_set_namespace(GtkWindow *,const char *);
extern void gtk_layer_set_monitor(GtkWindow *,GdkMonitor *);
extern void gtk_layer_set_layer(GtkWindow *,int);
extern void gtk_layer_set_keyboard_mode(GtkWindow *,int);
extern void gtk_layer_set_anchor(GtkWindow *,int,gboolean);
extern gboolean gtk_layer_get_anchor(GtkWindow *,int);
extern void gtk_layer_auto_exclusive_zone_enable(GtkWindow *);
extern void gtk_layer_set_exclusive_zone(GtkWindow *,int);
enum {GTK_LAYER_SHELL_EDGE_LEFT=0,GTK_LAYER_SHELL_EDGE_RIGHT=1,GTK_LAYER_SHELL_EDGE_TOP=2,GTK_LAYER_SHELL_EDGE_BOTTOM=3,GTK_LAYER_SHELL_LAYER_TOP=2,GTK_LAYER_SHELL_KEYBOARD_MODE_NONE=0};
typedef struct {GtkWidget *window,*edge;GdkDisplay *display;GdkMonitor *monitor;gulong removed;guint term,interrupt,hide_timer;GDBusConnection *bus;char *lease;gboolean auto_hide,inside,destroyed;guint hide_delay;} PanelHost;
static gboolean panel_popup_visible(GtkWidget *widget){
    if(GTK_IS_POPOVER(widget) && gtk_widget_get_visible(widget))return TRUE;
    if(!GTK_IS_CONTAINER(widget))return FALSE;
    GList *children=gtk_container_get_children(GTK_CONTAINER(widget));gboolean visible=FALSE;
    for(GList *child=children;child && !visible;child=child->next)visible=panel_popup_visible(child->data);
    g_list_free(children);return visible;
}
static void panel_hide_cancel(PanelHost *host){if(host->hide_timer)g_source_remove(host->hide_timer);host->hide_timer=0;}
static gboolean panel_hide_tick(void *data){
    PanelHost *host=data;if(host->destroyed || !host->auto_hide){host->hide_timer=0;return G_SOURCE_REMOVE;}
    if(host->inside || panel_popup_visible(host->window) || gtk_grab_get_current())return G_SOURCE_CONTINUE;
    host->hide_timer=0;gtk_widget_hide(host->window);if(host->edge)gtk_widget_show(host->edge);if(g_strcmp0(g_getenv("DEVOS_PANEL_LAYOUT_TRACE"),"1")==0){g_print("PANEL CARE HIDDEN\n");fflush(stdout);}return G_SOURCE_REMOVE;
}
static void panel_hide_schedule(PanelHost *host){panel_hide_cancel(host);if(host->auto_hide && !host->destroyed)host->hide_timer=g_timeout_add(host->hide_delay,panel_hide_tick,host);}
static gboolean panel_edge_enter(GtkWidget *widget,GdkEventCrossing *event,void *data){(void)widget;if(event->detail==GDK_NOTIFY_INFERIOR)return FALSE;PanelHost *host=data;gtk_widget_hide(host->edge);gtk_widget_show(host->window);panel_hide_schedule(host);if(g_strcmp0(g_getenv("DEVOS_PANEL_LAYOUT_TRACE"),"1")==0){g_print("PANEL CARE REVEALED\n");fflush(stdout);}return FALSE;}
static gboolean panel_enter(GtkWidget *widget,GdkEventCrossing *event,void *data){(void)widget;if(event->detail!=GDK_NOTIFY_INFERIOR){PanelHost *host=data;host->inside=TRUE;panel_hide_cancel(host);}return FALSE;}
static gboolean panel_leave(GtkWidget *widget,GdkEventCrossing *event,void *data){(void)widget;if(event->detail!=GDK_NOTIFY_INFERIOR){PanelHost *host=data;host->inside=FALSE;panel_hide_schedule(host);}return FALSE;}
static gboolean panel_edge_draw(GtkWidget *widget,cairo_t *cr,void *data){(void)widget;(void)cr;(void)data;return TRUE;}
static void panel_edge_prepare(PanelHost *host){
    if(host->edge)return;
    host->edge=gtk_window_new(GTK_WINDOW_TOPLEVEL);gtk_widget_set_name(host->edge,"panel-hot-edge");gtk_widget_set_app_paintable(host->edge,TRUE);
    GdkVisual *visual=gdk_screen_get_rgba_visual(gtk_widget_get_screen(host->edge));if(visual)gtk_widget_set_visual(host->edge,visual);
    gtk_layer_init_for_window(GTK_WINDOW(host->edge));gtk_layer_set_namespace(GTK_WINDOW(host->edge),"dev-os-panel-edge");gtk_layer_set_monitor(GTK_WINDOW(host->edge),host->monitor);gtk_layer_set_layer(GTK_WINDOW(host->edge),GTK_LAYER_SHELL_LAYER_TOP);gtk_layer_set_keyboard_mode(GTK_WINDOW(host->edge),GTK_LAYER_SHELL_KEYBOARD_MODE_NONE);
    gtk_layer_set_anchor(GTK_WINDOW(host->edge),GTK_LAYER_SHELL_EDGE_LEFT,TRUE);gtk_layer_set_anchor(GTK_WINDOW(host->edge),GTK_LAYER_SHELL_EDGE_RIGHT,TRUE);gtk_layer_set_exclusive_zone(GTK_WINDOW(host->edge),0);gtk_widget_set_size_request(host->edge,-1,2);
    gtk_layer_set_anchor(GTK_WINDOW(host->edge),GTK_LAYER_SHELL_EDGE_TOP,gtk_layer_get_anchor(GTK_WINDOW(host->window),GTK_LAYER_SHELL_EDGE_TOP));gtk_layer_set_anchor(GTK_WINDOW(host->edge),GTK_LAYER_SHELL_EDGE_BOTTOM,gtk_layer_get_anchor(GTK_WINDOW(host->window),GTK_LAYER_SHELL_EDGE_BOTTOM));
    gtk_widget_add_events(host->edge,GDK_ENTER_NOTIFY_MASK);g_signal_connect(host->edge,"enter-notify-event",G_CALLBACK(panel_edge_enter),host);g_signal_connect(host->edge,"draw",G_CALLBACK(panel_edge_draw),NULL);
}
void panel_care(void *root,int32_t translucent,int32_t auto_hide,int32_t left,int32_t right,int32_t top,int32_t bottom,int32_t delay){
    GtkWidget *window=rd_window(root);PanelHost *host=g_object_get_data(G_OBJECT(window),"devos-panel-host");if(!host || host->destroyed)return;
    GtkStyleContext *style=gtk_widget_get_style_context(window);gtk_style_context_remove_class(style,translucent ? "panel-opaque" : "panel-translucent");gtk_style_context_add_class(style,translucent ? "panel-translucent" : "panel-opaque");
    GtkWidget *content=rd_find_name(root,"panel-content");if(content){gtk_widget_set_margin_start(content,left);gtk_widget_set_margin_end(content,right);gtk_widget_set_margin_top(content,top);gtk_widget_set_margin_bottom(content,bottom);}
    gboolean changed=host->auto_hide!=(auto_hide!=0);host->auto_hide=auto_hide!=0;host->hide_delay=MAX(100,delay);
    if(g_strcmp0(g_getenv("DEVOS_PANEL_LAYOUT_TRACE"),"1")==0){char *state=g_strdup_printf("PANEL CARE %d %d %d %d %d %d",translucent,auto_hide,left,right,top,bottom);if(g_strcmp0(g_object_get_data(G_OBJECT(window),"panel-care-trace"),state)!=0){g_print("%s\n",state);fflush(stdout);g_object_set_data_full(G_OBJECT(window),"panel-care-trace",state,g_free);}else g_free(state);}
    if(host->auto_hide){panel_edge_prepare(host);if(changed)panel_hide_schedule(host);}else {panel_hide_cancel(host);if(host->edge)gtk_widget_hide(host->edge);gtk_widget_show(window);}
}
static void panel_release(PanelHost *host){if(host->bus && host->lease){GError *error=NULL;GVariant *reply=g_dbus_connection_call_sync(host->bus,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","ReleaseName",g_variant_new("(s)",host->lease),G_VARIANT_TYPE("(u)"),G_DBUS_CALL_FLAGS_NONE,1000,NULL,&error);if(reply)g_variant_unref(reply);g_clear_error(&error);}g_clear_object(&host->bus);g_clear_pointer(&host->lease,g_free);}
static gboolean panel_claim(PanelHost *host,int32_t index){
    GError *error=NULL;host->bus=g_bus_get_sync(G_BUS_TYPE_SESSION,NULL,&error);if(!host->bus){g_printerr("Could not check panel ownership: %s\n",error->message);g_clear_error(&error);return FALSE;}
    const char *runtime=g_getenv("XDG_RUNTIME_DIR"),*display=g_getenv("WAYLAND_DISPLAY");char *identity=g_strdup_printf("%s/%s",runtime ? runtime : "",display ? display : "");char *digest=g_compute_checksum_for_string(G_CHECKSUM_SHA256,identity,-1);char *legacy=g_strdup_printf("org.devos.Panel.Legacy.s%.16s",digest);g_free(identity);
    GVariant *reply=g_dbus_connection_call_sync(host->bus,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","NameHasOwner",g_variant_new("(s)",legacy),G_VARIANT_TYPE("(b)"),G_DBUS_CALL_FLAGS_NONE,1000,NULL,&error);g_free(legacy);
    gboolean occupied=FALSE;if(reply){g_variant_get(reply,"(b)",&occupied);g_variant_unref(reply);}if(!reply || occupied){g_printerr("A system panel is already running, or its ownership could not be checked. Start a session with DEVOS_PANEL_RENDERER=native-preview to use this preview.\n");g_clear_error(&error);g_free(digest);return FALSE;}
    host->lease=g_strdup_printf("org.devos.Panel.Preview.s%.16s.m%d",digest,index);g_free(digest);
    reply=g_dbus_connection_call_sync(host->bus,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","RequestName",g_variant_new("(su)",host->lease,4u),G_VARIANT_TYPE("(u)"),G_DBUS_CALL_FLAGS_NONE,1000,NULL,&error);
    guint status=0;if(reply){g_variant_get(reply,"(u)",&status);g_variant_unref(reply);}g_clear_error(&error);if(status!=1){g_printerr("A native panel is already running on monitor %d.\n",index);g_clear_pointer(&host->lease,g_free);return FALSE;}return TRUE;
}
static gboolean panel_stop(void *data){gtk_widget_destroy(data);return G_SOURCE_CONTINUE;}
static void panel_removed(GdkDisplay *display,GdkMonitor *monitor,void *data){(void)display;PanelHost *host=data;if(host->monitor==monitor)gtk_widget_destroy(host->window);}
static void panel_destroyed(GtkWidget *window,void *data){(void)window;PanelHost *host=data;host->destroyed=TRUE;panel_hide_cancel(host);if(host->edge){gtk_widget_destroy(host->edge);host->edge=NULL;}if(host->term)g_source_remove(host->term);if(host->interrupt)g_source_remove(host->interrupt);host->term=host->interrupt=0;if(host->removed)g_signal_handler_disconnect(host->display,host->removed);host->removed=0;panel_release(host);}
static void panel_free(void *data){PanelHost *host=data;panel_release(host);g_clear_object(&host->monitor);g_clear_object(&host->display);g_free(host);}
static void panel_allocated(GtkWidget *window,GtkAllocation *allocation,void *data){if(g_strcmp0(g_getenv("DEVOS_PANEL_LAYOUT_TRACE"),"1")==0){g_print("PANEL ALLOCATION %d %d %d\n",allocation->width,allocation->height,gtk_layer_get_anchor(GTK_WINDOW(window),GTK_LAYER_SHELL_EDGE_TOP));panel_tray_trace(data);fflush(stdout);}}
static gboolean panel_paint(GtkWidget *window,cairo_t *cr,void *data){(void)data;if(!gtk_cairo_should_draw_window(cr,gtk_widget_get_window(window)))return FALSE;cairo_save(cr);cairo_set_operator(cr,CAIRO_OPERATOR_SOURCE);cairo_set_source_rgba(cr,0,0,0,0);cairo_paint(cr);cairo_restore(cr);GtkStyleContext *style=gtk_widget_get_style_context(window);gtk_render_background(style,cr,0,0,gtk_widget_get_allocated_width(window),gtk_widget_get_allocated_height(window));gtk_render_frame(style,cr,0,0,gtk_widget_get_allocated_width(window),gtk_widget_get_allocated_height(window));return FALSE;}
int32_t panel_prepare(void *root,int32_t index){
    GtkWidget *window=rd_window(root);GdkDisplay *display=gtk_widget_get_display(window);
    if(!gtk_layer_is_supported() || index<0 || index>=gdk_display_get_n_monitors(display))return 0;
    PanelHost *host=g_new0(PanelHost,1);host->window=window;host->display=g_object_ref(display);host->monitor=g_object_ref(gdk_display_get_monitor(display,index));
    if(!panel_claim(host,index)){panel_free(host);return 0;}
    gtk_widget_set_name(window,"panel");gtk_style_context_add_class(gtk_widget_get_style_context(window),"panel-translucent");gtk_widget_set_app_paintable(window,TRUE);GdkVisual *visual=gdk_screen_get_rgba_visual(gtk_widget_get_screen(window));if(visual)gtk_widget_set_visual(window,visual);
    gtk_window_set_decorated(GTK_WINDOW(window),FALSE);gtk_layer_init_for_window(GTK_WINDOW(window));gtk_layer_set_namespace(GTK_WINDOW(window),"dev-os-panel-native-preview");gtk_layer_set_monitor(GTK_WINDOW(window),host->monitor);gtk_layer_set_layer(GTK_WINDOW(window),GTK_LAYER_SHELL_LAYER_TOP);gtk_layer_set_keyboard_mode(GTK_WINDOW(window),GTK_LAYER_SHELL_KEYBOARD_MODE_NONE);
    gtk_layer_set_anchor(GTK_WINDOW(window),GTK_LAYER_SHELL_EDGE_LEFT,TRUE);gtk_layer_set_anchor(GTK_WINDOW(window),GTK_LAYER_SHELL_EDGE_RIGHT,TRUE);gtk_layer_auto_exclusive_zone_enable(GTK_WINDOW(window));
    host->removed=g_signal_connect(display,"monitor-removed",G_CALLBACK(panel_removed),host);host->term=g_unix_signal_add(SIGTERM,panel_stop,window);host->interrupt=g_unix_signal_add(SIGINT,panel_stop,window);
    gtk_widget_add_events(window,GDK_ENTER_NOTIFY_MASK|GDK_LEAVE_NOTIFY_MASK);g_signal_connect(window,"enter-notify-event",G_CALLBACK(panel_enter),host);g_signal_connect(window,"leave-notify-event",G_CALLBACK(panel_leave),host);
    g_signal_connect(window,"destroy",G_CALLBACK(panel_destroyed),host);g_signal_connect(window,"draw",G_CALLBACK(panel_paint),NULL);g_signal_connect(window,"size-allocate",G_CALLBACK(panel_allocated),root);g_object_set_data_full(G_OBJECT(window),"devos-panel-host",host,panel_free);return 1;
}
void panel_layout(void *root,int32_t top,int32_t height){
    rd_popover_direction(root,top==0);
    GtkWindow *window=rd_window(root);gtk_layer_set_anchor(window,GTK_LAYER_SHELL_EDGE_TOP,top!=0);gtk_layer_set_anchor(window,GTK_LAYER_SHELL_EDGE_BOTTOM,top==0);gtk_widget_set_size_request(GTK_WIDGET(window),-1,height);gtk_window_set_default_size(window,-1,height);
    PanelHost *host=g_object_get_data(G_OBJECT(window),"devos-panel-host");if(host && host->edge){gtk_layer_set_anchor(GTK_WINDOW(host->edge),GTK_LAYER_SHELL_EDGE_TOP,top!=0);gtk_layer_set_anchor(GTK_WINDOW(host->edge),GTK_LAYER_SHELL_EDGE_BOTTOM,top==0);}
    GtkStyleContext *style=gtk_widget_get_style_context(GTK_WIDGET(window));if(top)gtk_style_context_add_class(style,"panel-top");else gtk_style_context_remove_class(style,"panel-top");
}
static gboolean panel_target_enter(GtkWidget *widget,GdkEventCrossing *event,void *data){(void)data;if(event->detail!=GDK_NOTIFY_INFERIOR){g_print("PANEL POINTER %s\n",gtk_widget_get_name(widget));fflush(stdout);}return FALSE;}
void panel_widget_trace(void *root,const char *name){
    GtkWidget *window=rd_window(root),*widget=rd_find_name(root,name);PanelHost *host=g_object_get_data(G_OBJECT(window),"devos-panel-host");if(!host || !widget || gtk_widget_get_allocated_width(widget)<=1)return;
    gint x=0,y=0;GdkRectangle geometry;gdk_monitor_get_geometry(host->monitor,&geometry);if(!gtk_widget_translate_coordinates(widget,window,0,0,&x,&y))return;
    x+=geometry.x+gtk_widget_get_allocated_width(widget)/2;y+=geometry.y+gtk_widget_get_allocated_height(widget)/2;
    if(!gtk_layer_get_anchor(GTK_WINDOW(window),GTK_LAYER_SHELL_EDGE_TOP))y+=geometry.height-gtk_widget_get_allocated_height(window);
    if(!g_object_get_data(G_OBJECT(widget),"panel-target-observed")){gtk_widget_add_events(widget,GDK_ENTER_NOTIFY_MASK);g_signal_connect(widget,"enter-notify-event",G_CALLBACK(panel_target_enter),NULL);g_object_set_data(G_OBJECT(widget),"panel-target-observed",GINT_TO_POINTER(1));}
    g_print("PANEL TARGET %s %d %d\n",name,x,y);
}

/* Loading surfaces only; the DevLang service owns authorization and execution. */
typedef struct {GPtrArray *windows;guint ready_timer,expiry;gboolean ready;} PanelLoading;
static void panel_loading_free(void *data){PanelLoading *loading=data;if(loading->ready_timer)g_source_remove(loading->ready_timer);if(loading->expiry)g_source_remove(loading->expiry);for(guint i=0;i<loading->windows->len;i++)gtk_widget_destroy(g_ptr_array_index(loading->windows,i));g_ptr_array_free(loading->windows,TRUE);g_free(loading);}
static gboolean panel_loading_draw(GtkWidget *widget,cairo_t *cr,void *data){(void)widget;(void)cr;((PanelLoading *)data)->ready=TRUE;return FALSE;}
static gboolean panel_loading_ready_timeout(void *data){PanelLoading *loading=data;loading->ready_timer=0;loading->ready=TRUE;return G_SOURCE_REMOVE;}
static gboolean panel_loading_expire(void *data){GtkWidget *window=data;PanelLoading *loading=g_object_get_data(G_OBJECT(window),"panel-loading");if(loading)loading->expiry=0;g_object_set_data(G_OBJECT(window),"panel-loading",NULL);return G_SOURCE_REMOVE;}
void panel_loading_clear(void *root){g_object_set_data(G_OBJECT(rd_window(root)),"panel-loading",NULL);}
int32_t panel_loading_ready(void *root){PanelLoading *loading=g_object_get_data(G_OBJECT(rd_window(root)),"panel-loading");return loading && loading->ready;}
int32_t panel_loading_show(void *root,const char *message){
    GtkWidget *owner=rd_window(root);if(!gtk_layer_is_supported())return 0;
    panel_loading_clear(root);PanelLoading *loading=g_new0(PanelLoading,1);loading->windows=g_ptr_array_new();GdkDisplay *display=gtk_widget_get_display(owner);
    GtkCssProvider *css=gtk_css_provider_new();gtk_css_provider_load_from_data(css,"#panel-power-loading {background:#242424;color:#bfbfbf;} #panel-power-loading label {font-size:20px;} #panel-power-loading spinner {color:#3994bc;}",-1,NULL);
    for(int i=0;i<gdk_display_get_n_monitors(display);i++){
        GtkWidget *window=gtk_window_new(GTK_WINDOW_TOPLEVEL);g_ptr_array_add(loading->windows,window);gtk_widget_set_name(window,"panel-power-loading");gtk_window_set_decorated(GTK_WINDOW(window),FALSE);gtk_style_context_add_provider(gtk_widget_get_style_context(window),GTK_STYLE_PROVIDER(css),GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
        gtk_layer_init_for_window(GTK_WINDOW(window));gtk_layer_set_namespace(GTK_WINDOW(window),"dev-os-power-loading");gtk_layer_set_monitor(GTK_WINDOW(window),gdk_display_get_monitor(display,i));gtk_layer_set_layer(GTK_WINDOW(window),3);gtk_layer_set_keyboard_mode(GTK_WINDOW(window),1);for(int edge=0;edge<4;edge++)gtk_layer_set_anchor(GTK_WINDOW(window),edge,TRUE);gtk_layer_set_exclusive_zone(GTK_WINDOW(window),-1);
        GtkWidget *box=gtk_box_new(GTK_ORIENTATION_VERTICAL,24);gtk_widget_set_halign(box,GTK_ALIGN_CENTER);gtk_widget_set_valign(box,GTK_ALIGN_CENTER);GtkWidget *spinner=gtk_spinner_new();gtk_widget_set_size_request(spinner,48,48);gtk_widget_set_halign(spinner,GTK_ALIGN_CENTER);gtk_style_context_add_provider(gtk_widget_get_style_context(spinner),GTK_STYLE_PROVIDER(css),GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);gtk_spinner_start(GTK_SPINNER(spinner));gtk_box_pack_start(GTK_BOX(box),spinner,FALSE,FALSE,0);GtkWidget *label=gtk_label_new(message);gtk_style_context_add_provider(gtk_widget_get_style_context(label),GTK_STYLE_PROVIDER(css),GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);gtk_box_pack_start(GTK_BOX(box),label,FALSE,FALSE,0);gtk_container_add(GTK_CONTAINER(window),box);
        g_signal_connect_after(window,"draw",G_CALLBACK(panel_loading_draw),loading);gtk_widget_show_all(window);
    }
    g_object_unref(css);if(loading->windows->len==0){panel_loading_free(loading);return 0;}
    loading->ready_timer=g_timeout_add(1000,panel_loading_ready_timeout,loading);loading->expiry=g_timeout_add_seconds(90,panel_loading_expire,owner);g_object_set_data_full(G_OBJECT(owner),"panel-loading",loading,panel_loading_free);return 1;
}

typedef struct {GtkWidget *window,*menu;GtkGesture *gesture;void (*selected)(const unsigned char *,int64_t,void *);void *data;gboolean closed;} PanelMenu;
static gboolean panel_task_at(GtkWidget *widget,GtkWidget *window,double x,double y){
    if(gtk_style_context_has_class(gtk_widget_get_style_context(widget),"panel-task")){int left=0,top=0;if(gtk_widget_translate_coordinates(widget,window,0,0,&left,&top) && x>=left && y>=top && x<left+gtk_widget_get_allocated_width(widget) && y<top+gtk_widget_get_allocated_height(widget))return TRUE;}
    if(!GTK_IS_CONTAINER(widget))return FALSE;
    GList *children=gtk_container_get_children(GTK_CONTAINER(widget));gboolean found=FALSE;for(GList *child=children;child && !found;child=child->next)found=panel_task_at(child->data,window,x,y);g_list_free(children);return found;
}
static void panel_menu_popup(GtkGestureMultiPress *gesture,int count,double x,double y,void *data){
    (void)count;PanelMenu *menu=data;if(menu->closed || !menu->menu || panel_task_at(menu->window,menu->window,x,y))return;
    GList *children=gtk_container_get_children(GTK_CONTAINER(menu->menu));gboolean empty=children==NULL;g_list_free(children);if(empty)return;
    gtk_gesture_set_state(GTK_GESTURE(gesture),GTK_EVENT_SEQUENCE_CLAIMED);gtk_widget_show_all(menu->menu);GdkEvent *event=gtk_get_current_event();gtk_menu_popup_at_pointer(GTK_MENU(menu->menu),event);if(event)gdk_event_free(event);
}
static void panel_menu_selected(GtkMenuItem *item,void *data){PanelMenu *menu=data;const char *key=g_object_get_data(G_OBJECT(item),"panel-key");if(!menu->closed && key)menu->selected((const unsigned char *)key,(int64_t)strlen(key),menu->data);}
static void panel_menu_mapped(GtkWidget *widget,void *data){(void)data;if(g_strcmp0(g_getenv("DEVOS_PANEL_LAYOUT_TRACE"),"1")==0){g_print("PANEL CONTEXT %d\n",gtk_widget_get_mapped(widget));fflush(stdout);}}
void *panel_menu_new(void *root,void (*selected)(const unsigned char *,int64_t,void *),void *data){
    PanelMenu *menu=g_new0(PanelMenu,1);menu->window=g_object_ref(rd_window(root));menu->selected=selected;menu->data=data;gtk_widget_add_events(menu->window,GDK_BUTTON_PRESS_MASK|GDK_BUTTON_RELEASE_MASK);menu->gesture=gtk_gesture_multi_press_new(menu->window);gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(menu->gesture),3);gtk_event_controller_set_propagation_phase(GTK_EVENT_CONTROLLER(menu->gesture),GTK_PHASE_CAPTURE);g_signal_connect(menu->gesture,"pressed",G_CALLBACK(panel_menu_popup),menu);return menu;
}
void panel_menu_reset(void *data){PanelMenu *menu=data;if(menu->menu){gtk_widget_destroy(menu->menu);g_object_unref(menu->menu);}menu->menu=gtk_menu_new();g_object_ref_sink(menu->menu);gtk_widget_set_name(menu->menu,"panel-context-menu");gtk_style_context_add_class(gtk_widget_get_style_context(menu->menu),"desktop-context-menu");gtk_menu_attach_to_widget(GTK_MENU(menu->menu),menu->window,NULL);g_signal_connect(menu->menu,"map",G_CALLBACK(panel_menu_mapped),NULL);g_signal_connect(menu->menu,"unmap",G_CALLBACK(panel_menu_mapped),NULL);}
void panel_menu_separator(void *data){PanelMenu *menu=data;gtk_menu_shell_append(GTK_MENU_SHELL(menu->menu),gtk_separator_menu_item_new());}
void panel_menu_add(void *data,const char *key,const char *title,const char *icon){
    PanelMenu *menu=data;GtkWidget *row=gtk_menu_item_new(),*box=gtk_box_new(GTK_ORIENTATION_HORIZONTAL,10),*label=gtk_label_new(title);gtk_label_set_xalign(GTK_LABEL(label),0);if(*icon)gtk_box_pack_start(GTK_BOX(box),gtk_image_new_from_icon_name(icon,GTK_ICON_SIZE_MENU),FALSE,FALSE,0);gtk_box_pack_start(GTK_BOX(box),label,TRUE,TRUE,0);gtk_container_add(GTK_CONTAINER(row),box);
    char *name=g_strconcat("panel-menu-",key,NULL);gtk_widget_set_name(row,name);g_free(name);g_object_set_data_full(G_OBJECT(row),"panel-key",g_strdup(key),g_free);g_signal_connect(row,"activate",G_CALLBACK(panel_menu_selected),menu);gtk_menu_shell_append(GTK_MENU_SHELL(menu->menu),row);
}
void *panel_menu_widget(void *data){return ((PanelMenu *)data)->menu;}
void panel_menu_free(void *data,void *keep){(void)keep;PanelMenu *menu=data;menu->closed=TRUE;g_signal_handlers_disconnect_by_data(menu->gesture,menu);g_object_run_dispose(G_OBJECT(menu->gesture));g_object_unref(menu->gesture);if(menu->menu){gtk_widget_destroy(menu->menu);g_object_unref(menu->menu);}g_object_unref(menu->window);g_free(menu);}
