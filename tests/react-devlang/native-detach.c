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

extern void *rd_host_child(void *);
static void *original,*main_root,*child_root;static gint original_pid;
static const char *role;static char tab0[64],tab1[64],host0[64];
static int is(const char *s){return !strcmp(role,s);}
static void *root_for(const char *name){void *found=NULL;GList *windows=gtk_window_list_toplevels();for(GList *p=windows;p && !found;p=p->next){void *candidate=widget_root(p->data);if(candidate && rd_find_name(candidate,name))found=candidate;}g_list_free(windows);return found;}
static void *live(void){return is("files") ? NULL : is("editor") ? find(host0) : rd_host_child(find(host0));}
static const char *web_title(void){const char *(*title)(void *)=dlsym(RTLD_DEFAULT,"webkit_web_view_get_title");return title && live() ? title(live()) : NULL;}
static int page(const char *title){return g_strcmp0(web_title(),title)==0;}
static int folder(const char *end){GtkWidget *w=find("files-path");return w && g_str_has_suffix(gtk_entry_get_text(GTK_ENTRY(w)),end);}
static void send(const char *cmd){void (*feed)(void *,const char *,gssize)=dlsym(RTLD_DEFAULT,"vte_terminal_feed_child");check(feed && live(),"shell missing");feed(live(),cmd,-1);}
static int marked(const char *name,const char *expected){char *file=g_build_filename(g_getenv("DEVOS_TABS_FIXTURE"),name,NULL),*value=NULL;int ok=g_file_get_contents(file,&value,NULL,NULL) && !strcmp(g_strstrip(value),expected);g_free(file);g_free(value);return ok;}
static void shell_marker(const char *name,int initialise){char *q=g_shell_quote(g_getenv("DEVOS_TABS_FIXTURE"));char *cmd=g_strdup_printf("%sprintf '%%s' \"$DETACHED_SESSION\" > %s/%s\n",initialise ? "export DETACHED_SESSION=original; " : "",q,name);send(cmd);g_free(cmd);g_free(q);}
static void validate(void){
    if(!is("files"))check(live()==original,"live widget was recreated while moving a tab");
    if(is("editor")){text(host0,"unsaved text\n");rd_code_undo(live());text(host0,"alpha\n");rd_code_redo(live());text(host0,"unsaved text\n");GtkWidget *status=find("editor-status");check(status && strstr(gtk_label_get_text(GTK_LABEL(status)),"modified"),"unsaved flag lost");}
    if(is("terminal"))check(GPOINTER_TO_INT(g_object_get_data(live(),"rd-child-pid"))==original_pid,"detach restarted the shell");
}
static gboolean drive(void *unused){
    (void)unused;check(++ticks<300,"detach/merge timed out");
    if(!root){root=root_for(tab0);if(!root)return G_SOURCE_CONTINUE;main_root=root;}
    if(step==30){drag(tab0,tab0);step++;return G_SOURCE_CONTINUE;}
    if(step==31){mouse(from_x+30,from_y,0,0);step++;return G_SOURCE_CONTINUE;}
    if(step==32){mouse(1150,1050,0,0);step++;return G_SOURCE_CONTINUE;}
    if(step==33){mouse(1150,1050,1,0);step++;return G_SOURCE_CONTINUE;}
    if(step==34){void *fresh=root_for(tab0);if(!fresh || fresh==main_root)return G_SOURCE_CONTINUE;root=fresh;if(is("files") && !gtk_widget_is_sensitive(find("files-tab-new")))return G_SOURCE_CONTINUE;validate();g_print("PASS %s detach, merge: sole primary tab retained its live state\n",role);gtk_widget_destroy(gtk_widget_get_toplevel(find(tab0)));step++;return G_SOURCE_CONTINUE;}
    if(step==0){
        if(is("editor")){GtkWidget *s=find("editor-status");if(!s || !g_str_has_prefix(gtk_label_get_text(GTK_LABEL(s)),"Opened"))return G_SOURCE_CONTINUE;text(host0,"alpha\n");rd_code_replace_all(live(),"unsaved text\n");}
        if(is("browser")){if(!page("First page"))return G_SOURCE_CONTINUE;entry("browser-url",g_getenv("DEVOS_TABS_SECOND"));click("browser-go");}
        if(is("terminal")){if(!live() || !g_object_get_data(live(),"rd-child-pid"))return G_SOURCE_CONTINUE;original_pid=GPOINTER_TO_INT(g_object_get_data(live(),"rd-child-pid"));shell_marker("ready",1);}
        if(is("files")){GtkWidget *b=find("files-tab-new");if(!b || !gtk_widget_is_sensitive(b))return G_SOURCE_CONTINUE;click("files-open-0");}
    }else if(step==1){
        if(is("browser") && !page("Second page"))return G_SOURCE_CONTINUE;
        if(is("terminal") && !marked("ready","original"))return G_SOURCE_CONTINUE;
        if(is("files") && (!folder("/Docs") || !gtk_widget_is_sensitive(find("files-tab-new"))))return G_SOURCE_CONTINUE;
        original=live();if(g_getenv("DEVOS_DETACH_SINGLE") && *g_getenv("DEVOS_DETACH_SINGLE")){gtk_window_move(GTK_WINDOW(gtk_widget_get_toplevel(find(tab0))),20,20);step=30;return G_SOURCE_CONTINUE;}char *id=g_strdup_printf("%s-tab-new",role);click(id);g_free(id);
    }else if(step==2){
        if(!find(tab1) || !gtk_widget_is_sensitive(find(tab0)))return G_SOURCE_CONTINUE;
        gtk_window_move(GTK_WINDOW(gtk_widget_get_toplevel(find(tab1))),20,20);
    }else if(step==3){drag(tab0,tab0);}
    else if(step==4){mouse(from_x+30,from_y,0,0);}
    else if(step==5){mouse(1150,1050,0,0);}
    else if(step==6){mouse(1150,1050,1,0);}
    else if(step==7){
        child_root=root_for(tab0);if(!child_root || child_root==main_root)return G_SOURCE_CONTINUE;root=child_root;
        if(is("editor") && !find("editor-status"))return G_SOURCE_CONTINUE;
        if(is("files") && (!folder("/Docs") || !gtk_widget_is_sensitive(find("files-tab-new"))))return G_SOURCE_CONTINUE;
        validate();gtk_window_move(GTK_WINDOW(gtk_widget_get_toplevel(find(tab0))),1220,20);capture(tab0);
        if(is("browser")){check(page("Second page"),"browser lost history position");click("browser-back");}
        if(is("terminal"))shell_marker("detached",0);
        if(is("files"))click("files-back");
    }else if(step==8){
        if(is("browser") && !page("First page"))return G_SOURCE_CONTINUE;
        if(is("terminal") && !marked("detached","original"))return G_SOURCE_CONTINUE;
        if(is("files") && (!folder("/home") || !gtk_widget_is_sensitive(find("files-tab-new"))))return G_SOURCE_CONTINUE;
        point(find(tab0),&from_x,&from_y);GtkWidget *target=rd_find_name(main_root,tab1);check(target!=NULL,"original window lost its other tab");point(target,&to_x,&to_y);mouse(from_x,from_y,1,1);
    }else if(step==9){mouse(from_x+30,from_y,0,0);}
    else if(step==10){mouse(to_x,to_y,0,0);}
    else if(step==11){mouse(to_x,to_y,1,0);}
    else if(step==12){
        root=root_for(tab0);if(root!=main_root)return G_SOURCE_CONTINUE;
        if(is("files") && !gtk_widget_is_sensitive(find("files-tab-new")))return G_SOURCE_CONTINUE;
        validate();reordered(tab0,tab1);
        if(is("browser"))click("browser-forward");
        if(is("terminal"))shell_marker("merged",0);
        if(is("files"))click("files-forward");
    }else if(step==13){
        if(is("browser") && !page("Second page"))return G_SOURCE_CONTINUE;
        if(is("terminal") && !marked("merged","original"))return G_SOURCE_CONTINUE;
        if(is("files") && (!folder("/Docs") || !gtk_widget_is_sensitive(find("files-tab-new"))))return G_SOURCE_CONTINUE;
        drag(tab0,tab0);
    }else if(step==14){mouse(from_x+30,from_y,0,0);}
    else if(step==15){mouse(1150,1050,0,0);}
    else if(step==16){mouse(1150,1050,1,0);}
    else if(step==17){
        child_root=root_for(tab0);if(!child_root || child_root==main_root)return G_SOURCE_CONTINUE;root=child_root;
        if(is("files") && !gtk_widget_is_sensitive(find("files-tab-new")))return G_SOURCE_CONTINUE;
        validate();GtkWidget *source=rd_find_name(main_root,tab1);check(source!=NULL,"source window missing");gtk_widget_destroy(gtk_widget_get_toplevel(source));
    }else if(step==18){
        check(root_for(tab0)==child_root && !root_for(tab1),"closing original window closed detached window");validate();
        if(is("terminal"))shell_marker("survived",0);
    }else if(step==19){
        if(is("terminal") && !marked("survived","original"))return G_SOURCE_CONTINUE;
        gtk_window_move(GTK_WINDOW(gtk_widget_get_toplevel(find(tab0))),1220,20);
    }else if(step==20){drag(tab0,tab0);}
    else if(step==21){mouse(from_x+30,from_y,0,0);}
    else if(step==22){mouse(1150,1050,0,0);}
    else if(step==23){mouse(1150,1050,1,0);}
    else if(step==24){
        void *fresh=root_for(tab0);if(!fresh || fresh==child_root)return G_SOURCE_CONTINUE;root=fresh;
        if(is("files") && !gtk_widget_is_sensitive(find("files-tab-new")))return G_SOURCE_CONTINUE;
        validate();g_print("PASS %s detach, merge, live state, last-tab move and independent window lifetime\n",role);gtk_widget_destroy(gtk_widget_get_toplevel(find(tab0)));
    }
    step++;return G_SOURCE_CONTINUE;
}
__attribute__((constructor))static void start(void){role=g_getenv("DEVOS_DETACH_TEST");if(!role)return;g_snprintf(tab0,sizeof tab0,"%s-tab-0",role);g_snprintf(tab1,sizeof tab1,"%s-tab-1",role);g_snprintf(host0,sizeof host0,"%s-%s",role,is("editor") ? "code" : "host");g_timeout_add(250,drive,NULL);}

extern int64_t rd_widget_live_count(void);
__attribute__((destructor))static void no_leaks(void){if(role && step>=24 && rd_widget_live_count()!=0){g_printerr("FAIL detached windows leaked native widgets\n");_Exit(1);}}
