/* GDK monitor identity and environment ABI only. Lifecycle policy is DevLang. */
#include <gtk/gtk.h>
#include <stdint.h>
#include <stdio.h>
extern gboolean gtk_layer_is_supported(void);
int32_t bm_init(void){return gtk_init_check(NULL,NULL) && gtk_layer_is_supported();}
int32_t bm_count(void){return gdk_display_get_n_monitors(gdk_display_get_default());}
int64_t bm_key(int32_t index){static int next;GdkMonitor *monitor=gdk_display_get_monitor(gdk_display_get_default(),index);int id=GPOINTER_TO_INT(g_object_get_data(G_OBJECT(monitor),"devos-background-id"));if(!id){id=++next;g_object_set_data(G_OBJECT(monitor),"devos-background-id",GINT_TO_POINTER(id));}return id;}
const char *bm_env(const char *name){const char *value=g_getenv(name);return value?value:"";}
int64_t bm_now(void){return g_get_monotonic_time();}
int32_t bm_exists(const char *path){return g_file_test(path,G_FILE_TEST_IS_EXECUTABLE);}
void bm_flush(void){fflush(stdout);}
