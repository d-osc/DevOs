#include <gtk/gtk.h>
extern void *rd_find_name(void *,const char *);
int panel_test_pointer(void *root,const char *name,int kind){
    GtkWidget *widget=rd_find_name(root,name);if(!widget)return -1;gboolean handled=FALSE;
    if(kind<3){GdkEventCrossing event={0};event.type=kind==0 ? GDK_ENTER_NOTIFY : GDK_LEAVE_NOTIFY;event.window=gtk_widget_get_window(widget);event.detail=kind==2 ? GDK_NOTIFY_INFERIOR : GDK_NOTIFY_NONLINEAR;event.mode=GDK_CROSSING_NORMAL;g_signal_emit_by_name(widget,kind==0 ? "enter-notify-event" : "leave-notify-event",&event,&handled);}
    else {GdkEventButton event={0};event.type=GDK_BUTTON_PRESS;event.window=gtk_widget_get_window(widget);event.button=kind==3 ? 3 : 1;g_signal_emit_by_name(widget,"button-press-event",&event,&handled);}
    return handled;
}
