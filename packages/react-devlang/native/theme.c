#include <gtk/gtk.h>
#include <stdint.h>
#include <string.h>
extern void *rd_window(void *root);
extern int32_t rd_css(void *root,const char *css);
const char *rd_default_theme(void) { GDateTime *now=g_date_time_new_now_local(); int hour=g_date_time_get_hour(now); g_date_time_unref(now); return hour>=7 && hour<19 ? "light" : "dark"; }
int32_t rd_theme_is_dark(void){gboolean dark=FALSE;g_object_get(gtk_settings_get_default(),"gtk-application-prefer-dark-theme",&dark,NULL);return dark;}
typedef struct { void *root; GFileMonitor *monitor; char *snapshot; } RdTheme;
static void rd_theme_load(RdTheme *theme,const char *path) {
    char *css=NULL;
    if (theme->root && g_file_get_contents(path,&css,NULL,NULL)) {
        gboolean dark=g_str_has_prefix(css,"/* devos-theme:dark */");
        char *styled=g_strconcat(css,
            "\n#task-manager .app-titlebar button.titlebutton { background: transparent; background-image: none; color: @dv_fg_muted; border: 1px solid transparent; border-radius: 6px; box-shadow: none; text-shadow: none; min-height: 16px; min-width: 16px; padding: 3px 4px; margin: 0; }"
            "#task-manager .app-titlebar button.titlebutton image { color: @dv_fg_muted; }"
            "#task-manager .app-titlebar button.titlebutton:hover { background: @dv_hover; }"
            "#task-manager .app-titlebar button.titlebutton.close:hover { background: @dv_red; }"
            "#task-manager .app-titlebar button.titlebutton.close:hover image { color: @dv_on_accent; }",NULL);
        if(rd_css(theme->root,styled))g_object_set(gtk_settings_get_default(),"gtk-application-prefer-dark-theme",dark,NULL);
        g_free(styled); g_free(css);
    }
}
static void rd_theme_changed(GFileMonitor *monitor,GFile *file,GFile *other,GFileMonitorEvent event,void *data) {
    (void)monitor; (void)file; (void)other; (void)event;
    RdTheme *theme=data; rd_theme_load(theme,theme->snapshot);
}
static void rd_theme_stop(GtkWidget *window,void *data) {
    (void)window; RdTheme *theme=data; theme->root=NULL;
    if (theme->monitor) { g_signal_handlers_disconnect_by_data(theme->monitor,theme); g_file_monitor_cancel(theme->monitor); g_clear_object(&theme->monitor); }
}
static void rd_theme_free(void *data) { RdTheme *theme=data; rd_theme_stop(NULL,theme); g_free(theme->snapshot); g_free(theme); }
void rd_theme_follow(void *root,const char *snapshot,const char *fallback) {
    GtkWidget *window=rd_window(root); RdTheme *theme=g_new0(RdTheme,1); theme->root=root; theme->snapshot=g_strdup(snapshot);
    rd_theme_load(theme,fallback); rd_theme_load(theme,snapshot);
    GFile *file=g_file_new_for_path(snapshot); theme->monitor=g_file_monitor_file(file,G_FILE_MONITOR_WATCH_MOVES,NULL,NULL); g_object_unref(file);
    if (theme->monitor) g_signal_connect(theme->monitor,"changed",G_CALLBACK(rd_theme_changed),theme);
    g_signal_connect(window,"destroy",G_CALLBACK(rd_theme_stop),theme);
    g_object_set_data_full(G_OBJECT(window),"rd-theme",theme,rd_theme_free);
}
static void rd_snap(GtkButton *button,void *data) {
    (void)button; (void)data; const char *id=g_getenv("DEV_OS_SHELL_ID"); if (!id || !*id) return;
    GDBusConnection *bus=g_bus_get_sync(G_BUS_TYPE_SESSION,NULL,NULL); if (!bus) return;
    char *path=g_strdup_printf("/%s/control",id); for (char *p=path;*p;p++) if (*p=='.') *p='/';
    const char *args[]={"snap-layouts",NULL};
    g_dbus_connection_call(bus,id,path,"org.devos.Shell.Control","Execute",g_variant_new("(^ass)",args,""),NULL,G_DBUS_CALL_FLAGS_NO_AUTO_START,10000,NULL,NULL,NULL);
    g_free(path); g_object_unref(bus);
}
void rd_app_header_for(void *root,const char *title,const char *icons,const char *name,const char *icon) {
    GtkWidget *window=rd_window(root); gtk_widget_set_name(window,name);
    if(g_object_get_data(G_OBJECT(window),"rd-layer")) {gtk_icon_theme_append_search_path(gtk_icon_theme_get_default(),icons); return;} /* a full-screen overlay has no title bar */
    gtk_style_context_add_class(gtk_widget_get_style_context(window),"devos-rounded-window");
    gtk_icon_theme_append_search_path(gtk_icon_theme_get_default(),icons);
    gtk_window_set_icon_name(GTK_WINDOW(window),icon);
    GtkWidget *header=gtk_header_bar_new(); gtk_header_bar_set_title(GTK_HEADER_BAR(header),title);
    gtk_header_bar_set_has_subtitle(GTK_HEADER_BAR(header),FALSE);
    gtk_header_bar_set_show_close_button(GTK_HEADER_BAR(header),TRUE); gtk_header_bar_set_decoration_layout(GTK_HEADER_BAR(header),":minimize,maximize,close");
    gtk_style_context_add_class(gtk_widget_get_style_context(header),"app-titlebar");
    char *symbolic=g_strconcat(icon,"-symbolic",NULL); GtkWidget *glyph=gtk_image_new_from_icon_name(symbolic,GTK_ICON_SIZE_MENU); g_free(symbolic); gtk_header_bar_pack_start(GTK_HEADER_BAR(header),glyph);
    GtkWidget *snap=gtk_button_new_from_icon_name("view-grid-symbolic",GTK_ICON_SIZE_MENU); gtk_widget_set_tooltip_text(snap,"Snap Layouts - Super+Z");
    gtk_style_context_add_class(gtk_widget_get_style_context(snap),"titlebutton"); gtk_header_bar_pack_end(GTK_HEADER_BAR(header),snap); g_signal_connect(snap,"clicked",G_CALLBACK(rd_snap),NULL);
    gtk_window_set_titlebar(GTK_WINDOW(window),header); gtk_widget_show_all(header);
}
void rd_app_header(void *root,const char *title,const char *icons) { rd_app_header_for(root,title,icons,"task-manager","dev-os-task-manager"); }
static gboolean rd_close_blocked=FALSE;
static gboolean rd_delete_event(GtkWidget *widget,GdkEvent *event,gpointer data) { (void)widget; (void)event; (void)data; return rd_close_blocked; }
/* While blocked, the window manager's close request is ignored (used while a disk is being written). */
void rd_block_close(void *root,int blocked) {
    static gboolean connected=FALSE;
    if (!connected) { g_signal_connect(rd_window(root),"delete-event",G_CALLBACK(rd_delete_event),NULL); connected=TRUE; }
    rd_close_blocked=blocked!=0;
}
