/* GTK/layer-shell lifecycle and event transport. Rendering and state are DevLang. */
#include <gtk/gtk.h>
#include <glib-unix.h>
#include <gio/gunixinputstream.h>
#include <stdint.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
int64_t ds_length(const unsigned char *text) { return (int64_t)strlen((const char *)text); }
extern gboolean gtk_layer_is_supported(void);
extern void gtk_layer_init_for_window(GtkWindow *);
extern void gtk_layer_set_monitor(GtkWindow *,GdkMonitor *);
extern void gtk_layer_set_namespace(GtkWindow *,const char *);
extern void gtk_layer_set_layer(GtkWindow *,int);
extern void gtk_layer_set_anchor(GtkWindow *,int,gboolean);
extern void gtk_layer_set_exclusive_zone(GtkWindow *,int);
extern void gtk_layer_set_keyboard_mode(GtkWindow *,int);
typedef int32_t (*DsEvent)(int32_t,int32_t,const unsigned char *,int64_t,void *);
typedef void (*DsDraw)(int32_t,int32_t,void *,int32_t,int32_t,void *);
typedef struct DsHost DsHost;
typedef struct { DsHost *host; GdkMonitor *monitor; GtkWidget *dim,*saver; int index; guint saver_timer; } DsSurface;
struct DsHost { GdkDisplay *display; GtkWidget *anchor; GPtrArray *surfaces; DsEvent event; DsDraw draw; void *event_data,*draw_data;
    GCancellable *cancel; GFileMonitor *settings,*idle; guint poll,events,rebuild,signal_term,signal_int; gboolean closed,gamma_waiting; GSubprocess *gamma; guint retry; };
static int32_t ds_emit(DsHost *host,int kind,int index,const char *text,gsize length) { return !host->closed && host->event ? host->event(kind,index,(const unsigned char *)text,(int64_t)length,host->event_data) : 0; }
static void ds_realize(GtkWidget *widget,void *data) { (void)data; cairo_region_t *region=cairo_region_create(); gdk_window_input_shape_combine_region(gtk_widget_get_window(widget),region,0,0); cairo_region_destroy(region); }
static gboolean ds_draw(GtkWidget *widget,cairo_t *cr,void *data) {
    DsSurface *surface=data; if (surface->host->draw && !surface->host->closed) surface->host->draw(surface->index,widget==surface->saver ? 1 : 0,cr,gtk_widget_get_allocated_width(widget),gtk_widget_get_allocated_height(widget),surface->host->draw_data); return TRUE;
}
static gboolean ds_input(GtkWidget *widget,GdkEvent *event,void *data) { (void)widget; DsSurface *surface=data; if (event->type==GDK_MOTION_NOTIFY && event->motion.is_hint) gdk_event_request_motions(&event->motion); return ds_emit(surface->host,2,surface->index,"",0)!=0; }
static GtkWidget *ds_window(DsSurface *surface,int saver) {
    GtkWidget *window=gtk_window_new(GTK_WINDOW_TOPLEVEL); gtk_window_set_decorated(GTK_WINDOW(window),FALSE); gtk_window_set_resizable(GTK_WINDOW(window),TRUE);
    GdkVisual *visual=gdk_screen_get_rgba_visual(gtk_widget_get_screen(window)); if (visual) gtk_widget_set_visual(window,visual); gtk_widget_set_app_paintable(window,TRUE);
    gtk_layer_init_for_window(GTK_WINDOW(window)); gtk_layer_set_namespace(GTK_WINDOW(window),saver ? "dev-os-pixel-refresh" : "dev-os-care-dim");
    gtk_layer_set_monitor(GTK_WINDOW(window),surface->monitor); gtk_layer_set_layer(GTK_WINDOW(window),saver ? 3 : 2);
    for (int edge=0;edge<4;edge++) gtk_layer_set_anchor(GTK_WINDOW(window),edge,TRUE);
    gtk_layer_set_exclusive_zone(GTK_WINDOW(window),saver ? -1 : 0); gtk_layer_set_keyboard_mode(GTK_WINDOW(window),saver ? 1 : 0);
    g_signal_connect(window,"draw",G_CALLBACK(ds_draw),surface);
    if (saver) {
        gtk_widget_set_can_focus(window,TRUE); gtk_widget_add_events(window,GDK_KEY_PRESS_MASK|GDK_BUTTON_PRESS_MASK|GDK_POINTER_MOTION_MASK);
        g_signal_connect(window,"key-press-event",G_CALLBACK(ds_input),surface); g_signal_connect(window,"button-press-event",G_CALLBACK(ds_input),surface); g_signal_connect(window,"motion-notify-event",G_CALLBACK(ds_input),surface);
    } else g_signal_connect(window,"realize",G_CALLBACK(ds_realize),NULL);
    return window;
}
static void ds_surface_free(void *data) { DsSurface *surface=data; if (surface->saver_timer) g_source_remove(surface->saver_timer); g_signal_handlers_disconnect_by_data(surface->monitor,surface->host); gtk_widget_destroy(surface->dim); gtk_widget_destroy(surface->saver); g_object_unref(surface->monitor); g_free(surface); }
static void ds_rebuild(DsHost *host);
static gboolean ds_rebuild_idle(void *data) { DsHost *host=data; host->rebuild=0; ds_rebuild(host); return G_SOURCE_REMOVE; }
static void ds_schedule(DsHost *host) { if (!host->closed && !host->rebuild) host->rebuild=g_idle_add(ds_rebuild_idle,host); }
static void ds_geometry(GObject *object,GParamSpec *property,void *data) { (void)object; (void)property; ds_schedule(data); }
static void ds_rebuild(DsHost *host) {
    if (host->closed) return;
    g_ptr_array_set_size(host->surfaces,0);
    for (int i=0;i<gdk_display_get_n_monitors(host->display);i++) {
        DsSurface *surface=g_new0(DsSurface,1); surface->host=host; surface->index=i; surface->monitor=g_object_ref(gdk_display_get_monitor(host->display,i));
        surface->dim=ds_window(surface,0); surface->saver=ds_window(surface,1); g_ptr_array_add(host->surfaces,surface);
        g_signal_connect(surface->monitor,"notify::geometry",G_CALLBACK(ds_geometry),host);
    }
    ds_emit(host,1,0,"",0);
}
static void ds_monitor(GdkDisplay *display,GdkMonitor *monitor,void *data) { (void)display; (void)monitor; ds_schedule(data); }
static gboolean ds_poll(void *data) { ds_emit(data,0,0,"",0); return G_SOURCE_CONTINUE; }
static gboolean ds_animation(void *data) { DsSurface *surface=data; gtk_widget_queue_draw(surface->saver); return G_SOURCE_CONTINUE; }
static void ds_changed(GFileMonitor *monitor,GFile *file,GFile *other,GFileMonitorEvent event,void *data) { (void)monitor; (void)file; (void)other; (void)event; ds_emit(data,0,0,"",0); }
static void ds_watch(DsHost *host,GFileMonitor **monitor,const char *path) { GFile *file=g_file_new_for_path(path); *monitor=g_file_monitor_file(file,G_FILE_MONITOR_WATCH_MOVES,NULL,NULL); g_object_unref(file); if (*monitor) g_signal_connect(*monitor,"changed",G_CALLBACK(ds_changed),host); }
static gboolean ds_quit(void *data) {
    DsHost *host=data; host->closed=TRUE;
    /* Release overlays and exclusive keyboard focus before waiting for I/O. */
    for (guint i=0;i<host->surfaces->len;i++) {
        DsSurface *surface=g_ptr_array_index(host->surfaces,i);
        if (surface->saver_timer) { g_source_remove(surface->saver_timer); surface->saver_timer=0; }
        gtk_widget_hide(surface->dim); gtk_widget_hide(surface->saver);
    }
    gdk_display_flush(host->display);
    if (gtk_main_level()) gtk_main_quit();
    return G_SOURCE_CONTINUE;
}
static gboolean ds_events(void *data) {DsHost *host=data;ds_emit(host,4,0,"",0);return G_SOURCE_CONTINUE;}
static void ds_gamma_start(DsHost *host);
static gboolean ds_gamma_retry(void *data) { DsHost *host=data; host->retry=0; ds_gamma_start(host); return G_SOURCE_REMOVE; }
static void ds_gamma_done(GObject *child,GAsyncResult *result,void *data) { DsHost *host=data; GError *error=NULL; gboolean ok=g_subprocess_wait_check_finish(G_SUBPROCESS(child),result,&error); host->gamma_waiting=FALSE; g_clear_error(&error); if (!host->closed && !ok) host->retry=g_timeout_add_seconds(10,ds_gamma_retry,host); }
static void ds_gamma_start(DsHost *host) {
    g_clear_object(&host->gamma); const char *root=g_getenv("DEV_OS_ROOT"); if (!root) return;
    char *script=g_build_filename(root,"bin/dev-os-display-care",NULL); host->gamma=g_subprocess_new(G_SUBPROCESS_FLAGS_STDOUT_SILENCE,NULL,"sh",script,"serve",NULL); g_free(script);
    if (host->gamma) { host->gamma_waiting=TRUE; g_subprocess_wait_check_async(host->gamma,host->cancel,ds_gamma_done,host); }
}
void *ds_new(void) {
    setvbuf(stdout,NULL,_IOLBF,0);
    if (!gtk_init_check(NULL,NULL) || !gtk_layer_is_supported()) return NULL;
    DsHost *host=g_new0(DsHost,1); host->display=g_object_ref(gdk_display_get_default()); host->anchor=gtk_window_new(GTK_WINDOW_TOPLEVEL); host->cancel=g_cancellable_new(); host->surfaces=g_ptr_array_new_with_free_func(ds_surface_free);
    ds_rebuild(host); g_signal_connect(host->display,"monitor-added",G_CALLBACK(ds_monitor),host); g_signal_connect(host->display,"monitor-removed",G_CALLBACK(ds_monitor),host); return host;
}
void *ds_anchor(void *data) { return ((DsHost *)data)->anchor; }
void ds_callbacks(void *data,DsEvent event,void *event_data,DsDraw draw,void *draw_data) { DsHost *host=data; host->event=event; host->event_data=event_data; host->draw=draw; host->draw_data=draw_data; }
char *ds_monitors(void *data) {
    DsHost *host=data; static guint serial=0; GString *text=g_string_new("["); for (guint i=0;i<host->surfaces->len;i++) { DsSurface *surface=g_ptr_array_index(host->surfaces,i); guint id=GPOINTER_TO_UINT(g_object_get_data(G_OBJECT(surface->monitor),"devos-native-monitor-id")); if (!id) { id=++serial; g_object_set_data(G_OBJECT(surface->monitor),"devos-native-monitor-id",GUINT_TO_POINTER(id)); } GdkRectangle r; gdk_monitor_get_geometry(surface->monitor,&r); g_string_append_printf(text,"%s{\"id\":%u,\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d}",i ? "," : "",id,r.x,r.y,r.width,r.height); } g_string_append(text,"]"); return g_string_free(text,FALSE);
}
void ds_show(void *data,int32_t index,int32_t kind,int32_t visible) { DsHost *host=data; if (index<0 || (guint)index>=host->surfaces->len) return; DsSurface *surface=g_ptr_array_index(host->surfaces,(guint)index); GtkWidget *window=kind ? surface->saver : surface->dim; if (kind) { if (visible && !surface->saver_timer) surface->saver_timer=g_timeout_add(1500,ds_animation,surface); if (!visible && surface->saver_timer) { g_source_remove(surface->saver_timer); surface->saver_timer=0; } } gtk_widget_set_visible(window,visible!=0); if (visible) gtk_widget_queue_draw(window); }
void ds_run(void *data) {
    DsHost *host=data; if (host->closed) return; char *settings=g_build_filename(g_get_user_config_dir(),"devos/display-care.json",NULL); char *idle=g_build_filename(g_get_user_runtime_dir(),"devos-pixel-refresh",NULL);
    ds_watch(host,&host->settings,settings); ds_watch(host,&host->idle,idle); g_free(settings); g_free(idle);
    host->events=g_timeout_add(50,ds_events,host);
    host->poll=g_timeout_add_seconds(2,ds_poll,host); host->signal_term=g_unix_signal_add(SIGTERM,ds_quit,host); host->signal_int=g_unix_signal_add(SIGINT,ds_quit,host);
    ds_gamma_start(host); ds_emit(host,1,0,"",0); g_print("DevOs native display care ready\n"); gtk_main();
}
void ds_stop(void *data) { ds_quit(data); }
void ds_free(void *data) {
    DsHost *host=data; host->closed=TRUE; g_cancellable_cancel(host->cancel);
    if (host->poll) g_source_remove(host->poll);
    if (host->events) g_source_remove(host->events);
    if (host->rebuild) g_source_remove(host->rebuild);
    if (host->retry) g_source_remove(host->retry);
    if (host->signal_term) g_source_remove(host->signal_term);
    if (host->signal_int) g_source_remove(host->signal_int);
    g_signal_handlers_disconnect_by_data(host->display,host);
    if (host->settings) { g_file_monitor_cancel(host->settings); g_clear_object(&host->settings); } if (host->idle) { g_file_monitor_cancel(host->idle); g_clear_object(&host->idle); }
    if (host->gamma) g_subprocess_force_exit(host->gamma);
    /* Drain cancelled callbacks before releasing their owner and managed bindings. */
    while (host->gamma_waiting) g_main_context_iteration(NULL,TRUE);
    if (host->gamma) { g_subprocess_wait(host->gamma,NULL,NULL); while (g_main_context_pending(NULL)) g_main_context_iteration(NULL,FALSE); }
    g_ptr_array_unref(host->surfaces); gtk_widget_destroy(host->anchor); g_clear_object(&host->gamma); g_clear_object(&host->cancel); g_clear_object(&host->display); g_free(host);
}
