#include <gtk/gtk.h>
#include <stdlib.h>
#include <string.h>
extern void *rd_find_name(void *,const char *);
static void *root;
static int step,ticks,click_x,click_y;
static GtkWidget *find(const char *name){return rd_find_name(root,name);}
static void check(int yes,const char *message){if(!yes){g_printerr("FAIL Files pointer: %s (step %d)\n",message,step);exit(1);}}
static void click(const char *name){GtkWidget *w=find(name);check(w && GTK_IS_BUTTON(w),name);gtk_button_clicked(GTK_BUTTON(w));}
static void pointer(const char *name,int button,GdkEventType type){
    GtkWidget *w=find(name);check(w!=NULL,name);GdkEventButton event={0};gboolean handled=FALSE;
    event.type=type;event.button=button;event.window=gtk_widget_get_window(w);event.x=37;event.y=19;
    gint x=0,y=0;gdk_window_get_origin(event.window,&x,&y);
    if(button==3 && (step==1 || step==8)){
        GtkWidget *top=gtk_widget_get_toplevel(w);gint tx=0,ty=0;gdk_window_get_origin(gtk_widget_get_window(top),&tx,&ty);
        event.x=tx-x+(step==1 ? gtk_widget_get_allocated_width(top)-12 : 12);
        event.y=ty-y+(step==1 ? gtk_widget_get_allocated_height(top)-12 : 48);
    }
    click_x=x+(gint)event.x;click_y=y+(gint)event.y;
    g_signal_emit_by_name(w,"button-press-event",&event,&handled);check(handled,"mouse event was discarded");
}
static void check_position(void){
    GtkWidget *menu=find("files-context-menu");check(menu && GTK_IS_POPOVER(menu),"context menu missing");
    GdkRectangle rect;check(gtk_popover_get_pointing_to(GTK_POPOVER(menu),&rect),"menu has no pointing rectangle");
    GtkWidget *host=gtk_popover_get_relative_to(GTK_POPOVER(menu));GtkWidget *top=gtk_widget_get_toplevel(host);
    gint hx=0,hy=0,tx=0,ty=0;gtk_widget_translate_coordinates(host,top,0,0,&hx,&hy);gdk_window_get_origin(gtk_widget_get_window(top),&tx,&ty);
    gint mx=0,my=0;check(gtk_widget_translate_coordinates(menu,top,0,0,&mx,&my),"menu coordinate translation failed");
    check(mx>=0 && my>=0 && mx+gtk_widget_get_allocated_width(menu)<=gtk_widget_get_allocated_width(top) && my+gtk_widget_get_allocated_height(menu)<=gtk_widget_get_allocated_height(top),"menu extends beyond window edges");
    check(rect.width==1 && rect.height==1 && rect.x+hx+tx==click_x && rect.y+hy+ty==click_y,"menu does not point at right-click coordinates");
}
static void *widget_root(GtkWidget *w){
    void *r=g_object_get_data(G_OBJECT(w),"rd-root");
    if(!r && GTK_IS_CONTAINER(w)){GList *children=gtk_container_get_children(GTK_CONTAINER(w));for(GList *p=children;p && !r;p=p->next)r=widget_root(p->data);g_list_free(children);}return r;
}
static gboolean drive(void *unused){
    (void)unused;if(++ticks>250){g_printerr("FAIL Files pointer timeout step %d\n",step);exit(1);}
    if(!root){GList *windows=gtk_window_list_toplevels();for(GList *p=windows;p;p=p->next){root=widget_root(p->data);if(root)break;}g_list_free(windows);if(!root)return G_SOURCE_CONTINUE;}
    GtkWidget *path=find("files-path");if(!path || (step==0 && !find("files-row-0")))return G_SOURCE_CONTINUE;
    const char *home=g_getenv("DEVOS_FILES_HOME");const char *current=gtk_entry_get_text(GTK_ENTRY(path));
    if(step==0){click("files-row-0");step++;}
    else if(step==1){check(!strcmp(home,current),"single click opened folder");pointer("files-row-1",3,GDK_BUTTON_PRESS);step++;}
    else if(step==2){check_position();check(find("files-context-menu")!=NULL,"file context menu missing");click("files-rename");step++;}
    else if(step==3){GtkWidget *name=find("files-name");check(name && !strcmp(gtk_entry_get_text(GTK_ENTRY(name)),"file2.md"),"context acted on previously selected row");check(!find("files-context-menu"),"menu stayed open after action");click("files-name-cancel");pointer("files-row-0",1,GDK_2BUTTON_PRESS);step++;}
    else if(step==4){if(!g_str_has_suffix(current,"/Docs"))return G_SOURCE_CONTINUE;pointer("files-background",3,GDK_BUTTON_PRESS);step++;}
    else if(step==5){check_position();check(find("files-context-menu") && find("files-menu-new-folder"),"background menu missing");check(!find("files-rename"),"background retained file selection");click("files-copy");click("files-up");step++;}
    else if(step==6){if(strcmp(home,current))return G_SOURCE_CONTINUE;click("files-view-grid");step++;}
    else if(step==7){click("files-row-0");step++;}
    else if(step==8){check(!strcmp(home,current),"grid single click opened folder");pointer("files-row-1",3,GDK_BUTTON_PRESS);step++;}
    else if(step==9){check_position();check(find("files-context-menu")!=NULL,"grid context menu missing");click("files-copy");pointer("files-row-0",1,GDK_2BUTTON_PRESS);step++;}
    else if(step==10){if(!g_str_has_suffix(current,"/Docs"))return G_SOURCE_CONTINUE;click("files-up");step++;}
    else if(step==11){if(strcmp(home,current))return G_SOURCE_CONTINUE;pointer("files-row-1",1,GDK_2BUTTON_PRESS);step++;}
    else if(step==12){const char *log=g_getenv("DEVOS_FILES_LOG");char *contents=NULL;if(!g_file_get_contents(log,&contents,NULL,NULL))return G_SOURCE_CONTINUE;check(g_str_has_suffix(g_strstrip(contents),"/file2.md"),"double click opened wrong file");g_free(contents);g_print("PASS Files list/grid double-click, file/folder open, selection and context menus\n");exit(0);}
    return G_SOURCE_CONTINUE;
}
__attribute__((constructor)) static void start(void){if(g_getenv("DEVOS_FILES_POINTER_TEST"))g_timeout_add(200,drive,NULL);}
