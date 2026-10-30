/* GTK, files and timer ABI. Geometry, animation and lifecycle policy are DevLang. */
#include <gtk/gtk.h>
#include <glib-unix.h>
#include <stdio.h>
#include <math.h>
#include <signal.h>
typedef void (*BsEvent)(int,int,int,void *);
typedef void (*BsDraw)(cairo_t *,int,int,void *);
typedef struct {GtkWidget *window,*area;BsEvent event;BsDraw draw;void *events,*drawing;guint frame,poll,dump,escape,signals[2];gboolean closed;} BsHost;
const char *bs_env(const char *name) {const char *value=g_getenv(name);return value?value:"";}
double bs_env_number(const char *name,double fallback) {const char *text=g_getenv(name);char *end=NULL;if(!text || !*text)return fallback;double value=g_ascii_strtod(text,&end);return end && !*end && isfinite(value)?value:fallback;}
double bs_now(void) {return g_get_monotonic_time()/1e6;}
int bs_exists(const char *directory,const char *name,int is_directory) {char *path=*name?g_build_filename(directory,name,NULL):g_strdup(directory);int exists=g_file_test(path,is_directory?G_FILE_TEST_IS_DIR:G_FILE_TEST_EXISTS);g_free(path);return exists;}
void bs_touch(const char *directory,const char *name) {char *path=g_build_filename(directory,name,NULL);GError *error=NULL;GFile *file=g_file_new_for_path(path);GFileOutputStream *stream=g_file_create(file,G_FILE_CREATE_NONE,NULL,&error);if(stream) {g_output_stream_close(G_OUTPUT_STREAM(stream),NULL,NULL);g_object_unref(stream);}g_clear_error(&error);g_object_unref(file);g_free(path);}
void bs_log(const char *message) {const char *path=g_getenv("DEVOS_SPLASH_LOG");FILE *file=fopen(path&&*path?path:"/run/devos-splash.log","a");if(file) {fprintf(file,"window %s\n",message);fclose(file);}}
static gboolean draw(GtkWidget *widget,cairo_t *cr,gpointer data) {BsHost *host=data;if(host->draw)host->draw(cr,gtk_widget_get_allocated_width(widget),gtk_widget_get_allocated_height(widget),host->drawing);return TRUE;}
static gboolean event(BsHost *host,int kind) {if(host->closed)return G_SOURCE_REMOVE;if(host->event)host->event(kind,gtk_widget_get_allocated_width(host->area),gtk_widget_get_allocated_height(host->area),host->events);return !host->closed;}
static gboolean frame(gpointer data) {return event(data,0);}
static gboolean poll_steps(gpointer data) {return event(data,1);}
static gboolean key(GtkWidget *widget,GdkEventKey *event_data,gpointer data) {(void)widget;if(event_data->keyval==GDK_KEY_Escape)event(data,2);return FALSE;}
static gboolean close_request(GtkWidget *widget,GdkEvent *event_data,gpointer data) {(void)widget;(void)event_data;event(data,3);return TRUE;}
static gboolean interrupted(gpointer data) {event(data,3);return G_SOURCE_CONTINUE;}
static gboolean mapped(GtkWidget *widget,GdkEvent *event_data,gpointer data) {(void)event_data;(void)data;GdkCursor *cursor=gdk_cursor_new_for_display(gtk_widget_get_display(widget),GDK_BLANK_CURSOR);gdk_window_set_cursor(gtk_widget_get_window(widget),cursor);g_object_unref(cursor);return FALSE;}
static gboolean dump(gpointer data) {BsHost *host=data;host->dump=0;const char *path=g_getenv("DEVOS_SPLASH_DUMP");if(path && *path && !host->closed) {cairo_surface_t *surface=cairo_image_surface_create(CAIRO_FORMAT_ARGB32,1280,720);cairo_t *cr=cairo_create(surface);if(host->draw)host->draw(cr,1280,720,host->drawing);cairo_surface_write_to_png(surface,path);cairo_destroy(cr);cairo_surface_destroy(surface);}return G_SOURCE_REMOVE;}
/* Private integration-test input, delivered through the real GTK key handler. */
static gboolean test_escape(gpointer data) {BsHost *host=data;host->escape=0;if(!host->closed) {GdkEvent *input=gdk_event_new(GDK_KEY_PRESS);input->key.window=g_object_ref(gtk_widget_get_window(host->window));input->key.send_event=TRUE;input->key.keyval=GDK_KEY_Escape;gboolean handled=FALSE;g_signal_emit_by_name(host->window,"key-press-event",input,&handled);gdk_event_free(input);}return G_SOURCE_REMOVE;}
void *bs_new(void) {
    if(!gtk_init_check(NULL,NULL))return NULL;
    BsHost *host=g_new0(BsHost,1);host->window=gtk_window_new(GTK_WINDOW_TOPLEVEL);host->area=gtk_drawing_area_new();
    gtk_window_set_title(GTK_WINDOW(host->window),"Dev OS");gtk_window_set_decorated(GTK_WINDOW(host->window),FALSE);gtk_widget_set_app_paintable(host->window,TRUE);
    GdkVisual *visual=gdk_screen_get_rgba_visual(gtk_widget_get_screen(host->window));if(visual)gtk_widget_set_visual(host->window,visual);
    gtk_container_add(GTK_CONTAINER(host->window),host->area);gtk_window_fullscreen(GTK_WINDOW(host->window));gtk_window_set_keep_above(GTK_WINDOW(host->window),TRUE);gtk_window_set_skip_taskbar_hint(GTK_WINDOW(host->window),TRUE);
    g_signal_connect(host->area,"draw",G_CALLBACK(draw),host);g_signal_connect(host->window,"key-press-event",G_CALLBACK(key),host);g_signal_connect(host->window,"delete-event",G_CALLBACK(close_request),host);g_signal_connect(host->window,"map-event",G_CALLBACK(mapped),host);
    return host;
}
void bs_callbacks(void *data,BsEvent event_fn,void *events,BsDraw draw_fn,void *drawing) {BsHost *host=data;host->event=event_fn;host->events=events;host->draw=draw_fn;host->drawing=drawing;}
void bs_redraw(void *data,int x,int y,int width,int height,int full) {BsHost *host=data;if(full)gtk_widget_queue_draw(host->area);else gtk_widget_queue_draw_area(host->area,x,y,width,height);}
void bs_opacity(void *data,double opacity) {gtk_widget_set_opacity(((BsHost *)data)->window,opacity);}
void bs_stop(void *data) {BsHost *host=data;if(!host->closed) {host->closed=TRUE;gtk_widget_hide(host->window);gtk_main_quit();}}
void bs_run(void *data) {BsHost *host=data;host->frame=g_timeout_add(33,frame,host);host->poll=g_timeout_add(250,poll_steps,host);host->signals[0]=g_unix_signal_add(SIGTERM,interrupted,host);host->signals[1]=g_unix_signal_add(SIGINT,interrupted,host);if(*bs_env("DEVOS_SPLASH_DUMP"))host->dump=g_timeout_add(2000,dump,host);if(*bs_env("DEVOS_SPLASH_TEST_ESCAPE_MS"))host->escape=g_timeout_add(MAX(1,bs_env_number("DEVOS_SPLASH_TEST_ESCAPE_MS",500)),test_escape,host);gtk_widget_show_all(host->window);gtk_main();}
void bs_free(void *data) {BsHost *host=data;guint timers[]={host->frame,host->poll,host->dump,host->escape,host->signals[0],host->signals[1]};for(unsigned i=0;i<G_N_ELEMENTS(timers);i++)if(timers[i] && g_main_context_find_source_by_id(NULL,timers[i]))g_source_remove(timers[i]);gtk_widget_destroy(host->window);g_free(host);}
