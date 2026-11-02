#include <gtk/gtk.h>
#include <stdint.h>
#include <string.h>
extern void *rd_window(void *root);
extern void rd_schedule(void *root);
extern int32_t rd_css(void *root,const char *css);
const char *rd_default_theme(void) { GDateTime *now=g_date_time_new_now_local(); int hour=g_date_time_get_hour(now); g_date_time_unref(now); return hour>=7 && hour<19 ? "light" : "dark"; }
int32_t rd_theme_is_dark(void){gboolean dark=FALSE;g_object_get(gtk_settings_get_default(),"gtk-application-prefer-dark-theme",&dark,NULL);return dark;}
/* Applied after the live theme snapshot so existing sessions receive tab styles too. */
static const char *rd_tabs_css =
"\n"
"/* Browser-style document/folder tabs share the window title bar. */\n"
"headerbar.chrome-titlebar { background: @dv_s1; padding: 4px 6px 0; min-height: 38px; border-bottom: 1px solid @dv_border_soft; }\n"
".chrome-tabstrip { padding: 0; background: transparent; }\n"
"headerbar.chrome-titlebar .chrome-tab, headerbar.chrome-titlebar .chrome-tab * { -GtkWidget-window-dragging: false; }\n"
".chrome-tabstrip scrolledwindow, .chrome-tabstrip viewport { background: transparent; border: 0; }\n"
".chrome-tab { background: transparent; border-radius: 10px 10px 0 0; margin: 2px 1px 0; padding: 0 4px; border: 0; }\n"
".chrome-tab:hover { background: alpha(@dv_fg, 0.06); }\n"
".chrome-tab.chrome-tab-active { background: @dv_s0; box-shadow: 0 -1px 0 alpha(@dv_fg, 0.08); }\n"
".chrome-tab button.chrome-tab-select { background: transparent; background-image: none; border: 0; border-radius: 8px 8px 0 0; box-shadow: none; color: @dv_fg_muted; padding: 6px 8px; min-height: 24px; }\n"
".chrome-tab-active button.chrome-tab-select { color: @dv_fg_strong; }\n"
".chrome-tab button.chrome-tab-close, button.chrome-tab-add { background: transparent; background-image: none; border: 0; border-radius: 50%; box-shadow: none; color: @dv_fg_muted; padding: 4px; min-width: 18px; min-height: 18px; margin: 4px 0; }\n"
".chrome-tab button.chrome-tab-close:hover, button.chrome-tab-add:hover { background: alpha(@dv_fg, 0.12); color: @dv_fg_strong; }\n"
".chrome-tab button.chrome-tab-close:disabled { opacity: 0; }\n"
"button.chrome-tab-add { margin: 4px 8px; }\n"
"\n"
".chrome-tab label { color: @dv_fg_muted; font-size: 12px; }\n"
".chrome-tab-active label { color: @dv_fg_strong; }\n"
".chrome-tab image { color: @dv_fg_muted; }\n"
"#browser .browser-toolbar { background: @dv_s0; padding: 10px 12px; border-bottom: 1px solid @dv_border_soft; }\n"
"#browser button.browser-nav { background: transparent; background-image: none; border: 1px solid transparent; box-shadow: none; border-radius: 10px; min-width: 22px; min-height: 22px; padding: 7px; color: @dv_fg_muted; }\n"
"#browser button.browser-nav:hover { background: alpha(@dv_fg, 0.07); color: @dv_fg_strong; }\n"
"#browser button.browser-nav:disabled { opacity: 0.3; }\n"
"#browser .browser-location { background: @dv_s1; border: 1px solid @dv_border; border-radius: 13px; padding: 0 5px 0 14px; margin: 0 6px; }\n"
"#browser .browser-toolbar entry.browser-url { background: transparent; background-image: none; border: 0; box-shadow: none; padding: 8px 0; min-height: 22px; font-size: 13px; color: @dv_fg; }\n"
"#browser .browser-toolbar entry.browser-url:focus { box-shadow: none; border: 0; }\n"
"#browser .browser-toolbar entry.browser-url:focus { color: @dv_fg_strong; }\n"
"#browser .browser-location-icon { color: @dv_fg_muted; }\n"
;
static const char *rd_settings_css =
"#settings .settings-native { background: @dv_s0; }\n"
"#settings .settings-native .settings-sidebar { background: @dv_s1; padding: 20px 14px 16px; border-right: 1px solid @dv_border_soft; }\n"
"#settings .settings-native .settings-brand { background: transparent; border: 0; border-radius: 0; padding: 4px 8px 22px; }\n"
"#settings .settings-native .settings-brand-icon { background: @dv_accent_t2; color: @dv_accent_fg; border-radius: 13px; padding: 11px; }\n"
"#settings .settings-native .settings-brand-title { font-size: 20px; font-weight: bold; color: @dv_fg_strong; }\n"
"#settings .settings-native .settings-brand-detail { font-size: 11px; color: @dv_fg_muted; }\n"
"#settings .settings-native entry.settings-search { background: @dv_s0; border: 1px solid @dv_border; border-radius: 10px; padding: 10px 12px; margin: 0 3px 12px; font-size: 12px; }\n"
"#settings .settings-native entry.settings-search:focus { border-color: @dv_accent; }\n"
"#settings .settings-native .settings-navigation-scroll, #settings .settings-native .settings-navigation-scroll viewport { background: transparent; border: 0; }\n"
"#settings .settings-native .settings-navigation-list { padding: 0 3px 12px; }\n"
"#settings .settings-native .settings-nav-group { font-size: 10px; font-weight: bold; letter-spacing: 1px; color: @dv_fg_dim; padding: 20px 11px 8px; }\n"
"#settings .settings-native button.settings-nav { background: transparent; border: 1px solid transparent; border-radius: 10px; padding: 10px 12px; min-height: 17px; }\n"
"#settings .settings-native button.settings-nav:hover { background: alpha(@dv_fg, 0.05); border-color: transparent; }\n"
"#settings .settings-native button.settings-nav label { font-size: 12px; color: @dv_fg_muted; }\n"
"#settings .settings-native button.settings-nav image { color: @dv_fg_muted; }\n"
"#settings .settings-native button.settings-nav-active { background: @dv_accent_t2; border-color: @dv_accent_t3; box-shadow: inset 3px 0 @dv_accent; }\n"
"#settings .settings-native button.settings-nav-active:hover { background: @dv_accent_t3; }\n"
"#settings .settings-native button.settings-nav-active label, #settings .settings-native button.settings-nav-active image { color: @dv_accent_fg; }\n"
"#settings .settings-native .settings-search-empty { padding: 20px 10px; color: @dv_fg_muted; font-size: 12px; }\n"
"#settings .settings-native .settings-sidebar-footer { margin-top: 10px; padding: 16px 10px 0; border-top: 1px solid @dv_border_soft; }\n"
"#settings .settings-native .settings-content { background: @dv_s0; }\n"
"#settings .settings-native .settings-page-header { background: @dv_s0; border-bottom: 1px solid @dv_border_soft; padding: 30px 32px 26px; }\n"
"#settings .settings-native .settings-header-icon { background: @dv_accent_t2; color: @dv_accent_fg; border: 1px solid @dv_accent_t3; border-radius: 16px; padding: 16px; }\n"
"#settings .settings-native .settings-eyebrow { font-size: 10px; letter-spacing: 1.3px; color: @dv_accent_fg; }\n"
"#settings .settings-native .heading { font-size: 28px; color: @dv_fg_strong; }\n"
"#settings .settings-native .settings-description { font-size: 12px; color: @dv_fg_muted; }\n"
"#settings .settings-native .settings-form { padding: 26px 32px 32px; }\n"
"#settings .settings-native .settings-card { background: @dv_s1; border: 1px solid @dv_border_soft; border-radius: 15px; }\n"
"#settings .settings-native .system-card { padding: 22px; }\n"
"#settings .settings-native .settings-card-header { background: alpha(@dv_fg, 0.025); border-bottom: 1px solid @dv_border_soft; border-radius: 15px 15px 0 0; padding: 18px 20px; }\n"
"#settings .settings-native .section-heading { font-size: 15px; color: @dv_fg_strong; }\n"
"#settings .settings-native .settings-field { padding: 16px 20px; }\n"
"#settings .settings-native .settings-field-title { font-size: 13px; }\n"
"#settings .settings-native .power-mode { border-radius: 11px; padding: 14px; }\n"
;

typedef struct { void *root; GFileMonitor *monitor; char *snapshot; } RdTheme;
static void rd_theme_load(RdTheme *theme,const char *path) {
    char *css=NULL;
    if (theme->root && g_file_get_contents(path,&css,NULL,NULL)) {
        gboolean dark=g_str_has_prefix(css,"/* devos-theme:dark */");
        char *styled=g_strconcat(css,rd_tabs_css,rd_settings_css,
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
void rd_app_header_for(void *root,const char *title,const char *icons,const char *name,const char *icon) {if(g_getenv("DEVOS_TAB_DEBUG"))g_printerr("header ready %s\n",title);
    GtkWidget *window=rd_window(root); gtk_widget_set_name(window,name);
    if(!strcmp(name,"camera")||!strcmp(name,"microphone")) gtk_style_context_add_class(gtk_widget_get_style_context(window),"media-window"); /* the theme styles Camera and Microphone as .media-window */
    if(g_object_get_data(G_OBJECT(window),"rd-layer")) {gtk_icon_theme_append_search_path(gtk_icon_theme_get_default(),icons); return;} /* a full-screen overlay has no title bar */
    gtk_style_context_add_class(gtk_widget_get_style_context(window),"devos-rounded-window");
    gtk_icon_theme_append_search_path(gtk_icon_theme_get_default(),icons);
    gtk_window_set_icon_name(GTK_WINDOW(window),icon);
    GtkWidget *header=gtk_header_bar_new(); gtk_header_bar_set_title(GTK_HEADER_BAR(header),title);
    gtk_header_bar_set_has_subtitle(GTK_HEADER_BAR(header),FALSE);
    gtk_header_bar_set_show_close_button(GTK_HEADER_BAR(header),TRUE); gtk_header_bar_set_decoration_layout(GTK_HEADER_BAR(header),":minimize,maximize,close");
    gtk_style_context_add_class(gtk_widget_get_style_context(header),"app-titlebar");
    if(!strcmp(name,"editor") || !strcmp(name,"files") || !strcmp(name,"browser") || !strcmp(name,"terminal"))gtk_style_context_add_class(gtk_widget_get_style_context(header),"chrome-titlebar");
    else {char *symbolic=g_strconcat(icon,"-symbolic",NULL); GtkWidget *glyph=gtk_image_new_from_icon_name(symbolic,GTK_ICON_SIZE_MENU); g_free(symbolic); gtk_header_bar_pack_start(GTK_HEADER_BAR(header),glyph);}
    GtkWidget *snap=gtk_button_new_from_icon_name("view-grid-symbolic",GTK_ICON_SIZE_MENU); gtk_widget_set_tooltip_text(snap,"Snap Layouts - Super+Z");
    gtk_style_context_add_class(gtk_widget_get_style_context(snap),"titlebutton"); gtk_header_bar_pack_end(GTK_HEADER_BAR(header),snap); g_signal_connect(snap,"clicked",G_CALLBACK(rd_snap),NULL);
    gtk_window_set_titlebar(GTK_WINDOW(window),header); gtk_widget_show_all(header); rd_schedule(root);
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
