/* Raw GIO application metadata and monitor lifecycle. No task grouping or GTK. */
#include <gio/gdesktopappinfo.h>
#include <stdint.h>
#include <string.h>
typedef struct {GAppInfoMonitor *monitor;gulong signal;GPtrArray *apps;int64_t revision;} PanelCatalog;
int32_t pa_network(void){for(int i=0;i<64 && g_main_context_pending(NULL);i++)g_main_context_iteration(NULL,FALSE);return g_network_monitor_get_network_available(g_network_monitor_get_default());}
static void changed(GAppInfoMonitor *monitor,void *data){(void)monitor;PanelCatalog *catalog=data;catalog->revision++;}
void *pa_open(void){PanelCatalog *catalog=g_new0(PanelCatalog,1);catalog->revision=1;catalog->monitor=g_app_info_monitor_get();catalog->signal=g_signal_connect(catalog->monitor,"changed",G_CALLBACK(changed),catalog);return catalog;}
int64_t pa_poll(void *data){PanelCatalog *catalog=data;for(int i=0;i<64 && g_main_context_pending(NULL);i++)g_main_context_iteration(NULL,FALSE);return catalog->revision;}
int64_t pa_scan(void *data){PanelCatalog *catalog=data;if(catalog->apps)g_ptr_array_unref(catalog->apps);catalog->apps=g_ptr_array_new_with_free_func(g_object_unref);GList *apps=g_app_info_get_all();for(GList *item=apps;item;item=item->next)g_ptr_array_add(catalog->apps,item->data);g_list_free(apps);return catalog->apps->len;}
unsigned char *pa_text(void *data,int64_t index,int32_t field){
    PanelCatalog *catalog=data;if(!catalog->apps || index<0 || index>=catalog->apps->len)return NULL;GAppInfo *app=g_ptr_array_index(catalog->apps,(guint)index);
    if(field==0)return (unsigned char *)g_strdup(g_app_info_get_id(app));
    if(field==1)return (unsigned char *)g_strdup(g_app_info_get_display_name(app));
    if(field==2)return (unsigned char *)g_strdup(G_IS_DESKTOP_APP_INFO(app) ? g_desktop_app_info_get_startup_wm_class(G_DESKTOP_APP_INFO(app)) : NULL);
    if(field==3){GIcon *icon=g_app_info_get_icon(app);return (unsigned char *)(icon ? g_icon_to_string(icon) : NULL);}
    return NULL;
}
int64_t pa_length(const unsigned char *text){return text ? (int64_t)strlen((const char *)text) : 0;}
void pa_free(void *text){g_free(text);}
void pa_close(void *data){PanelCatalog *catalog=data;if(!catalog)return;g_signal_handler_disconnect(catalog->monitor,catalog->signal);g_object_unref(catalog->monitor);if(catalog->apps)g_ptr_array_unref(catalog->apps);g_free(catalog);}
