#include <gtk/gtk.h>
#include <glib-unix.h>
#include <signal.h>
#include <stdint.h>
extern void *rd_window(void *root);
typedef struct { void (*call)(void *); void *data; } LoginTick;
static gboolean login_tick(void *data) {LoginTick *tick=data;tick->call(tick->data);return G_SOURCE_CONTINUE;}
uint32_t login_timer(void (*call)(void *),void *data) {LoginTick *tick=g_new(LoginTick,1);tick->call=call;tick->data=data;return g_timeout_add_full(G_PRIORITY_DEFAULT,1000,login_tick,tick,g_free);}
void login_untimer(uint32_t id,void *keep) {(void)keep;if(id)g_source_remove(id);}
static gboolean login_delete(GtkWidget *widget,GdkEvent *event,void *data) {(void)widget;(void)event;(void)data;return TRUE;}
typedef struct {guint term,interrupt;} LoginSignals;
static gboolean login_stop(void *window) {gtk_widget_destroy(window);return G_SOURCE_CONTINUE;}
static void login_unwatch(GtkWidget *window,void *data) {(void)window;LoginSignals *signals=data;if(signals->term){g_source_remove(signals->term);signals->term=0;}if(signals->interrupt){g_source_remove(signals->interrupt);signals->interrupt=0;}}
static gboolean login_ready(void *data) {(void)data;GSubprocess *child=g_subprocess_new(G_SUBPROCESS_FLAGS_STDOUT_SILENCE|G_SUBPROCESS_FLAGS_STDERR_SILENCE,NULL,"devos-splash","--step","ready",NULL);if(child)g_object_unref(child);return G_SOURCE_REMOVE;}
void login_prepare(void *root,int32_t preview) {GtkWidget *window=rd_window(root);gtk_widget_set_name(window,"settings");LoginSignals *signals=g_new0(LoginSignals,1);signals->term=g_unix_signal_add(SIGTERM,login_stop,window);signals->interrupt=g_unix_signal_add(SIGINT,login_stop,window);g_signal_connect(window,"destroy",G_CALLBACK(login_unwatch),signals);g_object_set_data_full(G_OBJECT(window),"login-signals",signals,g_free);if(!preview){gtk_window_fullscreen(GTK_WINDOW(window));g_signal_connect(window,"delete-event",G_CALLBACK(login_delete),NULL);g_timeout_add(400,login_ready,NULL);}}
void login_browser(void) {g_app_info_launch_default_for_uri_async("https://github.com/login/device",NULL,NULL,NULL,NULL);}
