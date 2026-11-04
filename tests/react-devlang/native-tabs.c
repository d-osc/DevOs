#include <gtk/gtk.h>
#include <stdlib.h>
#include <string.h>
#include <dlfcn.h>
#include <gdk/gdkx.h>
extern void *rd_find_name(void *,const char *);
extern char *rd_code_get(void *);
extern void rd_code_replace_all(void *,const char *);
extern void rd_code_undo(void *);
extern void rd_code_redo(void *);
static void *root;static int step,ticks;
static GtkWidget *find(const char *id){return rd_find_name(root,id);}
static void check(int value,const char *why){if(!value){g_printerr("FAIL tabs step %d: %s\n",step,why);exit(1);}}
static void click(const char *id){GtkWidget *w=find(id);check(w && GTK_IS_BUTTON(w),id);gtk_button_clicked(GTK_BUTTON(w));}
static void entry(const char *id,const char *text){GtkWidget *w=find(id);check(w && GTK_IS_ENTRY(w),id);gtk_entry_set_text(GTK_ENTRY(w),text);}
static void text(const char *id,const char *expected){char *actual=rd_code_get(find(id));check(actual && !strcmp(actual,expected),"tab lost its text or undo history");g_free(actual);}
static void *widget_root(GtkWidget *w){void *r=g_object_get_data(G_OBJECT(w),"rd-root");if(!r && GTK_IS_CONTAINER(w)){GList *children=gtk_container_get_children(GTK_CONTAINER(w));for(GList *p=children;p && !r;p=p->next)r=widget_root(p->data);g_list_free(children);}return r;}
static int from_x,from_y,to_x,to_y;
static void mouse(int x,int y,int button,int down){
    void *lib=dlopen("libXtst.so.6",RTLD_NOW);check(lib!=NULL,"XTest unavailable");
    int (*motion)(void *,int,int,int,unsigned long)=dlsym(lib,"XTestFakeMotionEvent");
    int (*press)(void *,unsigned int,int,unsigned long)=dlsym(lib,"XTestFakeButtonEvent");
    check(motion && press,"XTest symbols unavailable");void *display=gdk_x11_display_get_xdisplay(gdk_display_get_default());
    motion(display,-1,x,y,0);if(button)press(display,button,down,0);gdk_display_flush(gdk_display_get_default());dlclose(lib);
}
static void point(GtkWidget *w,int *x,int *y){GtkWidget *top=gtk_widget_get_toplevel(w);gint tx=0,ty=0,wx=0,wy=0;gdk_window_get_origin(gtk_widget_get_window(top),&tx,&ty);check(gtk_widget_translate_coordinates(w,top,0,0,&wx,&wy),"tab coordinates unavailable");*x=tx+wx+gtk_widget_get_allocated_width(w)/2;*y=ty+wy+gtk_widget_get_allocated_height(w)/2;}
static void drag(const char *from,const char *to){
    GtkWidget *source=find(from),*target=find(to);check(source && target,"drag tabs missing");
    GtkWidget *ancestor=source;while(ancestor && !GTK_IS_HEADER_BAR(ancestor))ancestor=gtk_widget_get_parent(ancestor);check(ancestor!=NULL,"tabs are below content instead of inside title bar");
    point(source,&from_x,&from_y);point(target,&to_x,&to_y);mouse(from_x,from_y,1,1);
}
static void reordered(const char *from,const char *to){int sx=0,sy=0,tx=0,ty=0;point(find(from),&sx,&sy);point(find(to),&tx,&ty);check(sx>tx,"drag did not reorder native tabs");}
static void capture(const char *name){const char *path=g_getenv("DEVOS_TABS_CAPTURE");if(!path)return;GtkWidget *top=gtk_widget_get_toplevel(find(name));GdkPixbuf *p=gdk_pixbuf_get_from_window(gtk_widget_get_window(top),0,0,gtk_widget_get_allocated_width(top),gtk_widget_get_allocated_height(top));check(p!=NULL,"screenshot failed");check(gdk_pixbuf_save(p,path,"png",NULL,NULL),"screenshot write failed");g_object_unref(p);}
static int opened(void){GtkWidget *s=find("editor-status");return s && g_str_has_prefix(gtk_label_get_text(GTK_LABEL(s)),"Opened");}
static void editor(void){
    if(step==0){if(!opened())return;text("editor-code","alpha\n");rd_code_replace_all(find("editor-code"),"changed\n");click("editor-tab-new");}
    else if(step==1){text("editor-code-1","");entry("editor-path",g_getenv("DEVOS_TABS_SECOND"));click("editor-open");}
    else if(step==2){if(!opened())return;text("editor-code-1","beta\n");capture("editor-tab-1");click("editor-tab-0");}
    else if(step==3){text("editor-code","changed\n");rd_code_undo(find("editor-code"));text("editor-code","alpha\n");rd_code_redo(find("editor-code"));text("editor-code","changed\n");click("editor-tab-close-0");}
    else if(step==4){check(find("editor-tab-save-close")!=NULL,"dirty tab closed without confirmation");click("editor-tab-cancel");}
    else if(step==5){check(find("editor-tab-0")!=NULL,"cancel removed tab");click("editor-tab-close-0");}
    else if(step==6){click("editor-tab-save-close");}
    else if(step==7){if(find("editor-tab-0"))return;char *saved=NULL;check(g_file_get_contents(g_getenv("DEVOS_EDITOR_FILE"),&saved,NULL,NULL) && !strcmp(saved,"changed\n"),"save-and-close did not save the right file");g_free(saved);text("editor-code-1","beta\n");entry("editor-path",g_getenv("DEVOS_TABS_SECOND"));click("editor-open");}
    else if(step==8){check(!find("editor-tab-2"),"opening existing file duplicated tab");click("editor-tab-new");}
    else if(step==9){text("editor-code-2","");rd_code_replace_all(find("editor-code-2"),"discard this");click("editor-tab-close-2");}
    else if(step==10){click("editor-tab-discard");}
    else if(step==11){check(!find("editor-tab-2"),"discard did not close tab");text("editor-code-1","beta\n");click("editor-tab-new");}
    else if(step==12){drag("editor-tab-1","editor-tab-3");}
    else if(step==13){mouse(from_x+30,from_y,0,0);}
    else if(step==14){mouse(to_x,to_y,0,0);}
    else if(step==15){mouse(to_x,to_y,1,0);}
    else if(step==16){reordered("editor-tab-1","editor-tab-3");text("editor-code-1","beta\n");int x=0,y=0;point(find("editor-tab-3"),&x,&y);mouse(x,y,2,1);mouse(x,y,2,0);}
    else if(step==17){check(!find("editor-tab-3"),"middle click did not close tab");text("editor-code-1","beta\n");g_print("PASS Editor tabs preserve text, undo, duplicate identity, save, cancel and discard; Chrome titlebar drag and middle close\n");exit(0);}
    step++;
}
static int folder(const char *suffix){GtkWidget *w=find("files-path");return w && g_str_has_suffix(gtk_entry_get_text(GTK_ENTRY(w)),suffix);}
static int ready(void){GtkWidget *w=find("files-tab-new");return w && gtk_widget_is_sensitive(w);}
static void files(void){
    if(!ready())return;
    if(step==0){click("files-tab-new");}
    else if(step==1){check(find("files-tab-1")!=NULL,"new folder tab missing");click("files-open-0");}
    else if(step==2){if(!folder("/home/Docs"))return;capture("files-tab-1");click("files-tab-0");}
    else if(step==3){if(!folder("/home"))return;click("files-tab-1");}
    else if(step==4){if(!folder("/home/Docs"))return;click("files-back");}
    else if(step==5){if(!folder("/home"))return;click("files-forward");}
    else if(step==6){if(!folder("/home/Docs"))return;click("files-tab-close-1");}
    else if(step==7){check(!find("files-tab-1") && folder("/home"),"close lost the remaining folder");check(!gtk_widget_is_sensitive(find("files-tab-close-0")),"last folder tab could close");click("files-tab-new");}
    else if(step==8){drag("files-tab-0","files-tab-2");}
    else if(step==9){mouse(from_x+30,from_y,0,0);}
    else if(step==10){mouse(to_x,to_y,0,0);}
    else if(step==11){mouse(to_x,to_y,1,0);}
    else if(step==12){reordered("files-tab-0","files-tab-2");int x=0,y=0;point(find("files-tab-2"),&x,&y);mouse(x,y,2,1);mouse(x,y,2,0);}
    else if(step==13){check(!find("files-tab-2"),"middle click did not close folder tab");g_print("PASS Files tabs preserve independent folders and Back/Forward history; Chrome titlebar drag and middle close\n");exit(0);}
    step++;
}
extern void *rd_host_child(void *);
static void *first_view,*second_view;
static void *web(const char *id){return rd_host_child(find(id));}
static int page_is(const char *id,const char *expected){void *w=web(id);const char *(*title)(void *)=dlsym(RTLD_DEFAULT,"webkit_web_view_get_title");return w && title && g_strcmp0(title(w),expected)==0;}
static GAction *inspect_action;
static gboolean inspect_menu(void *view,void *menu,void *event,void *hit,void *unused){
    (void)view;(void)event;(void)hit;(void)unused;
    GList *(*items)(void *)=dlsym(RTLD_DEFAULT,"webkit_context_menu_get_items");
    int (*stock)(void *)=dlsym(RTLD_DEFAULT,"webkit_context_menu_item_get_stock_action");
    GAction *(*action)(void *)=dlsym(RTLD_DEFAULT,"webkit_context_menu_item_get_gaction");
    GType (*type)(void)=dlsym(RTLD_DEFAULT,"webkit_context_menu_action_get_type");
    check(items && stock && action && type,"context menu API unavailable");
    GEnumClass *values=g_type_class_ref(type());
    GEnumValue *inspect=g_enum_get_value_by_name(values,"WEBKIT_CONTEXT_MENU_ACTION_INSPECT_ELEMENT");
    check(inspect!=NULL,"Inspect action enum unavailable");
    for(GList *p=items(menu);p;p=p->next)if(stock(p->data)==inspect->value)inspect_action=g_object_ref(action(p->data));
    g_type_class_unref(values);
    check(inspect_action!=NULL,"right click menu is missing Inspect Element");
    return FALSE;
}
static GtkWidget *inspect_item(GtkWidget *w){
    if(GTK_IS_MENU_ITEM(w) && g_strrstr(gtk_menu_item_get_label(GTK_MENU_ITEM(w)),"Inspect"))return w;
    if(GTK_IS_CONTAINER(w)){GList *children=gtk_container_get_children(GTK_CONTAINER(w));GtkWidget *found=NULL;for(GList *p=children;p && !found;p=p->next)found=inspect_item(p->data);g_list_free(children);return found;}
    return NULL;
}
static void browser(void){
    if(step==0){
        if(!page_is("browser-host","First page"))return;
        GtkWidget *view=web("browser-host");
        check(gtk_widget_get_allocated_height(view)>300 && gtk_widget_get_allocated_width(view)>600,"web page has no usable content area");
        int x=0,y=0;point(view,&x,&y);mouse(x,y,1,1);mouse(x,y,1,0);
    }
    else if(step==1){if(!page_is("browser-host","Interactive page"))return;first_view=web("browser-host");click("browser-tab-new");}
    else if(step==2){if(!page_is("browser-host-1","New tab"))return;entry("browser-url",g_getenv("DEVOS_TABS_SECOND"));g_signal_emit_by_name(find("browser-url"),"activate");}
    else if(step==3){if(!page_is("browser-host-1","Second page"))return;second_view=web("browser-host-1");capture("browser-tab-1");click("browser-tab-0");}
    else if(step==4){check(web("browser-host")==first_view && page_is("browser-host","Interactive page"),"switch reloaded or replaced original web view");entry("browser-url",g_getenv("DEVOS_TABS_SECOND"));g_signal_emit_by_name(find("browser-url"),"activate");}
    else if(step==5){if(!page_is("browser-host","Second page"))return;if(!gtk_widget_is_sensitive(find("browser-back")))return;click("browser-back");}
    else if(step==6){if(!page_is("browser-host","Interactive page"))return;click("browser-tab-1");}
    else if(step==7){check(web("browser-host-1")==second_view && page_is("browser-host-1","Second page"),"tabs shared navigation state");drag("browser-tab-0","browser-tab-1");}
    else if(step==8){mouse(from_x+30,from_y,0,0);}
    else if(step==9){mouse(to_x,to_y,0,0);}
    else if(step==10){mouse(to_x,to_y,1,0);}
    else if(step==11){reordered("browser-tab-0","browser-tab-1");int x=0,y=0;point(find("browser-tab-0"),&x,&y);mouse(x,y,2,1);mouse(x,y,2,0);}
    else if(step==12){check(!find("browser-tab-0") && web("browser-host-1")==second_view && page_is("browser-host-1","Second page"),"closing one page damaged other page");g_signal_connect(second_view,"context-menu",G_CALLBACK(inspect_menu),NULL);int x=0,y=0;point(second_view,&x,&y);mouse(x,y,3,1);mouse(x,y,3,0);}
    else if(step==13){
        if(!inspect_action)return;
        GList *windows=gtk_window_list_toplevels();GtkWidget *item=NULL;
        for(GList *p=windows;p && !item;p=p->next)item=inspect_item(p->data);
        g_list_free(windows);if(!item)return;
        GtkWidget *menu=gtk_widget_get_parent(item);gtk_menu_shell_activate_item(GTK_MENU_SHELL(menu),item,TRUE);g_clear_object(&inspect_action);
    }
    else if(step==14){
        void *(*inspector_for)(void *)=dlsym(RTLD_DEFAULT,"webkit_web_view_get_inspector");
        void *(*inspector_view)(void *)=dlsym(RTLD_DEFAULT,"webkit_web_inspector_get_web_view");
        void (*close_inspector)(void *)=dlsym(RTLD_DEFAULT,"webkit_web_inspector_close");
        check(inspector_for && inspector_view && close_inspector,"inspector API unavailable");
        void *inspector=inspector_for(second_view);if(!inspector_view(inspector))return;
        close_inspector(inspector);
        g_print("PASS Browser tabs render an interactive page, follow Enter, preserve history and open Inspect Element from the right click menu\n");click("browser-tab-close-1");
    }
    step++;
}
static void send_terminal(const char *id,const char *command){void (*feed)(void *,const char *,gssize)=dlsym(RTLD_DEFAULT,"vte_terminal_feed_child");check(feed && web(id),"terminal unavailable");feed(web(id),command,-1);}
static int marker(const char *name,const char *expected){char *file=g_build_filename(g_getenv("DEVOS_TABS_FIXTURE"),name,NULL),*value=NULL;gboolean read=g_file_get_contents(file,&value,NULL,NULL);g_free(file);if(!read)return 0;int same=!strcmp(g_strstrip(value),expected);g_free(value);return same;}
static gint pid(const char *id){void *w=web(id);return w ? GPOINTER_TO_INT(g_object_get_data(w,"rd-child-pid")) : 0;}
static void terminal(void){
    const char *base=g_getenv("DEVOS_TABS_FIXTURE");
    if(step==0){if(pid("terminal-host")<=0)return;check(!find("terminal-tab-1"),"Terminal started with more than one tab");char *argvfile=g_strdup_printf("/proc/%d/cmdline",pid("terminal-host")),*shellargv=NULL;gsize shellsize=0;check(g_file_get_contents(argvfile,&shellargv,&shellsize,NULL),"Cannot read shell argv");check(g_str_has_suffix(shellargv,"/bash") && shellsize>strlen(shellargv)+1 && !strcmp(shellargv+strlen(shellargv)+1,"--login"),"Terminal must start login Bash");g_free(shellargv);g_free(argvfile);first_view=web("terminal-host");char *folder=g_build_filename(base,"home","Docs",NULL),*q=g_shell_quote(folder),*out=g_shell_quote(base);char *cmd=g_strdup_printf("export TAB_VALUE=one; cd %s; printf 'one' > %s/one\n",q,out);send_terminal("terminal-host",cmd);g_free(cmd);g_free(folder);g_free(q);g_free(out);}
    else if(step==1){if(!marker("one","one"))return;click("terminal-tab-new");}
    else if(step==2){if(pid("terminal-host-1")<=0)return;second_view=web("terminal-host-1");check(first_view!=second_view && pid("terminal-host")!=pid("terminal-host-1"),"tabs shared shell process");char *q=g_shell_quote(base);char *cmd=g_strdup_printf("printf '%%s' \"${TAB_VALUE-unset}\" > %s/two; pwd > %s/cwd; export TAB_VALUE=two\n",q,q);send_terminal("terminal-host-1",cmd);g_free(cmd);g_free(q);}
    else if(step==3){if(!marker("two","unset"))return;char *folder=g_build_filename(base,"home","Docs",NULL);check(marker("cwd",folder),"new terminal did not inherit active shell cwd");g_free(folder);capture("terminal-tab-1");click("terminal-tab-0");char *q=g_shell_quote(base);char *cmd=g_strdup_printf("printf '%%s' \"$TAB_VALUE\" > %s/three\n",q);send_terminal("terminal-host",cmd);g_free(cmd);g_free(q);}
    else if(step==4){if(!marker("three","one"))return;drag("terminal-tab-0","terminal-tab-1");}
    else if(step==5){mouse(from_x+30,from_y,0,0);}
    else if(step==6){mouse(to_x,to_y,0,0);}
    else if(step==7){mouse(to_x,to_y,1,0);}
    else if(step==8){reordered("terminal-tab-0","terminal-tab-1");int x=0,y=0;point(find("terminal-tab-0"),&x,&y);mouse(x,y,2,1);mouse(x,y,2,0);}
    else if(step==9){check(!find("terminal-tab-0") && web("terminal-host-1")==second_view,"close damaged other terminal");char *q=g_shell_quote(base);char *cmd=g_strdup_printf("printf '%%s' \"$TAB_VALUE\" > %s/four\n",q);send_terminal("terminal-host-1",cmd);g_free(cmd);g_free(q);}
    else if(step==10){if(!marker("four","two"))return;g_print("PASS Terminal tabs keep independent live shells, environment and cwd; Chrome drag and close; last shell exit\n");send_terminal("terminal-host-1","exit\n");}
    step++;
}
static gboolean drive(void *unused){(void)unused;check(++ticks<200,"timed out");if(!root){GList *windows=gtk_window_list_toplevels();for(GList *p=windows;p && !root;p=p->next)root=widget_root(p->data);g_list_free(windows);if(!root)return G_SOURCE_CONTINUE;}if(!strcmp(g_getenv("DEVOS_TABS_TEST"),"editor"))editor();else if(!strcmp(g_getenv("DEVOS_TABS_TEST"),"files"))files();else if(!strcmp(g_getenv("DEVOS_TABS_TEST"),"browser"))browser();else terminal();return G_SOURCE_CONTINUE;}
__attribute__((constructor))static void start(void){if(g_getenv("DEVOS_TABS_TEST"))g_timeout_add(250,drive,NULL);}
