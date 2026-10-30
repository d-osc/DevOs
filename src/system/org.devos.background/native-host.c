/* Generic GTK clock and window hooks; background rendering lives in DevLang. */
#include <gtk/gtk.h>
#include <stdint.h>
#include <glib-unix.h>
#include <signal.h>
#include <string.h>
#include <stdio.h>
void bg_flush_stdout(void){fflush(stdout);}
extern void *rd_window(void *root);
extern gboolean gtk_layer_is_supported(void);
extern void gtk_layer_init_for_window(GtkWindow *);
extern void gtk_layer_set_namespace(GtkWindow *,const char *);
extern void gtk_layer_set_monitor(GtkWindow *,GdkMonitor *);
extern void gtk_layer_set_layer(GtkWindow *,int);
extern void gtk_layer_set_anchor(GtkWindow *,int,gboolean);
extern void gtk_layer_set_exclusive_zone(GtkWindow *,int);
extern void gtk_layer_set_keyboard_mode(GtkWindow *,int);
extern GdkMonitor *gtk_layer_get_monitor(GtkWindow *);
typedef struct {void (*call)(void *);void *data;} BgTick;
static gboolean bg_tick(void *data) {BgTick *tick=data;tick->call(tick->data);return G_SOURCE_CONTINUE;}
uint32_t bg_timer(int32_t interval,void (*call)(void *),void *data) {BgTick *tick=g_new(BgTick,1);tick->call=call;tick->data=data;return g_timeout_add_full(G_PRIORITY_DEFAULT_IDLE,MAX(16,interval),bg_tick,tick,g_free);}
void bg_untimer(uint32_t timer,void *keep) {(void)keep;if(timer)g_source_remove(timer);}

typedef struct {guint term,interrupt;} BgSignals;
typedef struct {GtkWidget *window;GdkDisplay *display;GdkMonitor *monitor;gulong removed;} BgOutput;
static void bg_output_removed(GdkDisplay *display,GdkMonitor *monitor,void *data){(void)display;BgOutput *output=data;if(monitor==output->monitor)gtk_widget_destroy(output->window);}
static void bg_output_stop(GtkWidget *window,void *data){(void)window;BgOutput *output=data;if(output->removed){g_signal_handler_disconnect(output->display,output->removed);output->removed=0;}g_clear_object(&output->monitor);g_clear_object(&output->display);}
static void bg_output_free(void *data){BgOutput *output=data;bg_output_stop(NULL,output);g_free(output);}
static gboolean bg_stop(void *window) {gtk_widget_destroy(window);return G_SOURCE_CONTINUE;}
static void bg_unwatch(GtkWidget *window,void *data) {(void)window;BgSignals *watch=data;if(watch->term)g_source_remove(watch->term);if(watch->interrupt)g_source_remove(watch->interrupt);watch->term=watch->interrupt=0;}
int32_t bg_prepare(void *root,int32_t desktop,int32_t monitor_index) {
    GtkWidget *window=rd_window(root);
    if(desktop){
        GdkDisplay *display=gtk_widget_get_display(window);
        if(!gtk_layer_is_supported() || monitor_index<0 || monitor_index>=gdk_display_get_n_monitors(display))return 0;
        gtk_layer_init_for_window(GTK_WINDOW(window));gtk_layer_set_namespace(GTK_WINDOW(window),"dev-os-background-native");
        gtk_layer_set_monitor(GTK_WINDOW(window),gdk_display_get_monitor(display,monitor_index));gtk_layer_set_layer(GTK_WINDOW(window),0);
        for(int edge=0;edge<4;edge++)gtk_layer_set_anchor(GTK_WINDOW(window),edge,TRUE);
        gtk_layer_set_exclusive_zone(GTK_WINDOW(window),-1);gtk_layer_set_keyboard_mode(GTK_WINDOW(window),0);
        gtk_window_set_decorated(GTK_WINDOW(window),FALSE);
        BgOutput *output=g_new0(BgOutput,1);output->window=window;output->display=g_object_ref(display);output->monitor=g_object_ref(gdk_display_get_monitor(display,monitor_index));
        output->removed=g_signal_connect(display,"monitor-removed",G_CALLBACK(bg_output_removed),output);g_signal_connect(window,"destroy",G_CALLBACK(bg_output_stop),output);g_object_set_data_full(G_OBJECT(window),"bg-output",output,bg_output_free);
    }
    BgSignals *watch=g_new0(BgSignals,1);watch->term=g_unix_signal_add(SIGTERM,bg_stop,window);watch->interrupt=g_unix_signal_add(SIGINT,bg_stop,window);
    g_signal_connect(window,"destroy",G_CALLBACK(bg_unwatch),watch);g_object_set_data_full(G_OBJECT(window),"bg-signals",watch,g_free);return 1;
}
int32_t bg_monitor_index(void *root){GtkWidget *window=rd_window(root);GdkDisplay *display=gtk_widget_get_display(window);GdkMonitor *monitor=gtk_layer_get_monitor(GTK_WINDOW(window));for(int i=0;i<gdk_display_get_n_monitors(display);i++)if(gdk_display_get_monitor(display,i)==monitor)return i;return -1;}

/* Async image decoding with cancellation and generation checks. No background
 * preferences, crop policy or renderer decisions are implemented in this host. */
typedef void (*BgNotify)(int32_t,const unsigned char *,int64_t,void *);
static int bg_live_pictures,bg_live_loads;
typedef struct {gint refs;gboolean closed;guint64 generation;GCancellable *cancel;GdkPixbuf *pixels;BgNotify notify;void *data;} BgPicture;
typedef struct {BgPicture *owner;guint64 generation;GCancellable *cancel;GInputStream *stream;char *path;int width,height;} BgLoad;
static void bg_picture_unref(BgPicture *picture){if(--picture->refs)return;g_clear_object(&picture->pixels);g_clear_object(&picture->cancel);bg_live_pictures--;g_free(picture);}
static void bg_load_free(BgLoad *load){if(load->stream)g_input_stream_close_async(load->stream,G_PRIORITY_DEFAULT,NULL,NULL,NULL);g_clear_object(&load->stream);g_clear_object(&load->cancel);bg_picture_unref(load->owner);g_free(load->path);bg_live_loads--;g_free(load);}
static gboolean bg_current(BgLoad *load){return !load->owner->closed && load->generation==load->owner->generation && !g_cancellable_is_cancelled(load->cancel);}
static void bg_notify(BgPicture *picture,int32_t status,const char *message){if(!picture->closed && picture->notify)picture->notify(status,(const unsigned char *)message,(int64_t)strlen(message),picture->data);}
static void bg_failed(BgLoad *load,GError *error){if(bg_current(load))bg_notify(load->owner,-1,error ? error->message : "This file is not a supported picture.");g_clear_error(&error);bg_load_free(load);}
static void bg_decoded(GObject *stream,GAsyncResult *result,void *data){
    (void)stream;BgLoad *load=data;GError *error=NULL;GdkPixbuf *pixels=gdk_pixbuf_new_from_stream_finish(result,&error);
    if(!pixels){bg_failed(load,error);return;}
    if(bg_current(load)){GdkPixbuf *oriented=gdk_pixbuf_apply_embedded_orientation(pixels);g_set_object(&load->owner->pixels,(oriented ? oriented : pixels));g_clear_object(&oriented);bg_notify(load->owner,1,"");}
    g_object_unref(pixels);g_clear_error(&error);bg_load_free(load);
}
static void bg_read_picture(GObject *file,GAsyncResult *result,void *data){
    BgLoad *load=data;GError *error=NULL;GFileInputStream *stream=g_file_read_finish(G_FILE(file),result,&error);
    if(!stream){bg_failed(load,error);return;}load->stream=G_INPUT_STREAM(stream);
    if(!bg_current(load)){bg_load_free(load);return;}
    gdk_pixbuf_new_from_stream_at_scale_async(load->stream,load->width,load->height,TRUE,load->cancel,bg_decoded,load);
}
static void bg_picture_info(GObject *source,GAsyncResult *result,void *data){
    (void)source;BgLoad *load=data;GError *error=NULL;int width=0,height=0;
    GdkPixbufFormat *format=gdk_pixbuf_get_file_info_finish(result,&width,&height,&error);
    if(!format || width<1 || height<1){bg_failed(load,error);return;}
    if(!bg_current(load)){g_clear_error(&error);bg_load_free(load);return;}
    load->width=MIN(width,4096);load->height=MIN(height,4096);
    GFile *file=g_file_new_for_path(load->path);g_file_read_async(file,G_PRIORITY_DEFAULT,load->cancel,bg_read_picture,load);g_object_unref(file);g_clear_error(&error);
}
void *bg_picture_new(void){BgPicture *picture=g_new0(BgPicture,1);picture->refs=1;bg_live_pictures++;return picture;}
void bg_picture_watch(void *data,BgNotify notify,void *context){BgPicture *picture=data;picture->notify=notify;picture->data=context;}
void bg_picture_unwatch(void *data,void *keep){(void)keep;BgPicture *picture=data;picture->notify=NULL;picture->data=NULL;}
void bg_picture_load(void *data,const unsigned char *path,int64_t length){
    BgPicture *picture=data;if(picture->closed)return;picture->generation++;
    if(picture->cancel){g_cancellable_cancel(picture->cancel);}
    g_clear_object(&picture->cancel);g_clear_object(&picture->pixels);
    if(length==0){bg_notify(picture,1,"");return;}
    if(length<0 || length>1048576 || path[0]!='/' || memchr(path,0,(size_t)length)){bg_notify(picture,-1,"Choose an absolute local picture path.");return;}
    picture->cancel=g_cancellable_new();BgLoad *load=g_new0(BgLoad,1);bg_live_loads++;load->owner=picture;picture->refs++;load->generation=picture->generation;load->cancel=g_object_ref(picture->cancel);load->path=g_strndup((const char *)path,(gsize)length);
    bg_notify(picture,0,"");gdk_pixbuf_get_file_info_async(load->path,load->cancel,bg_picture_info,load);
}
int32_t bg_picture_width(void *data){BgPicture *picture=data;return picture->pixels ? gdk_pixbuf_get_width(picture->pixels) : 0;}
int32_t bg_picture_height(void *data){BgPicture *picture=data;return picture->pixels ? gdk_pixbuf_get_height(picture->pixels) : 0;}
void bg_picture_source(void *data,void *cr){BgPicture *picture=data;if(picture->pixels)gdk_cairo_set_source_pixbuf(cr,picture->pixels,0,0);}
void bg_picture_free(void *data){BgPicture *picture=data;if(!picture || picture->closed)return;picture->closed=TRUE;picture->notify=NULL;if(picture->cancel)g_cancellable_cancel(picture->cancel);bg_picture_unref(picture);}
int32_t bg_picture_live_count(void){return bg_live_pictures;}
int32_t bg_picture_load_count(void){return bg_live_loads;}

typedef void (*BgPicked)(const unsigned char *,int64_t,void *);
typedef struct {GtkWidget *window,*dialog;BgPicked notify;void *data;gboolean closed;} BgPicker;
static void bg_picker_destroyed(GtkWidget *dialog,void *data){BgPicker *picker=data;if(picker->dialog==dialog)picker->dialog=NULL;g_signal_handlers_disconnect_by_data(dialog,picker);}
static void bg_picked(GtkDialog *dialog,int response,void *data){
    BgPicker *picker=data;picker->dialog=NULL;g_object_ref(dialog);g_signal_handlers_disconnect_by_data(dialog,picker);
    if(response==GTK_RESPONSE_ACCEPT && !picker->closed){char *path=gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));if(path){picker->notify((const unsigned char *)path,(int64_t)strlen(path),picker->data);g_free(path);}}
    gtk_widget_destroy(GTK_WIDGET(dialog));g_object_unref(dialog);
}
void *bg_picker_new(void *root,BgPicked notify,void *data){BgPicker *picker=g_new0(BgPicker,1);picker->window=rd_window(root);picker->notify=notify;picker->data=data;return picker;}
void bg_picker_show(void *data){
    BgPicker *picker=data;if(!picker || picker->closed)return;
    if(picker->dialog){gtk_window_present(GTK_WINDOW(picker->dialog));return;}
    picker->dialog=gtk_file_chooser_dialog_new("Choose background picture",GTK_WINDOW(picker->window),GTK_FILE_CHOOSER_ACTION_OPEN,"Cancel",GTK_RESPONSE_CANCEL,"Choose picture",GTK_RESPONSE_ACCEPT,NULL);
    gtk_window_set_modal(GTK_WINDOW(picker->dialog),TRUE);gtk_file_chooser_set_local_only(GTK_FILE_CHOOSER(picker->dialog),TRUE);
    gtk_window_set_destroy_with_parent(GTK_WINDOW(picker->dialog),TRUE);
    GtkFileFilter *filter=gtk_file_filter_new();gtk_file_filter_set_name(filter,"Pictures");gtk_file_filter_add_pixbuf_formats(filter);gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(picker->dialog),filter);
    g_signal_connect(picker->dialog,"response",G_CALLBACK(bg_picked),picker);g_signal_connect(picker->dialog,"destroy",G_CALLBACK(bg_picker_destroyed),picker);gtk_widget_show(picker->dialog);
}
void bg_picker_free(void *data,void *keep){(void)keep;BgPicker *picker=data;if(!picker)return;picker->closed=TRUE;if(picker->dialog){GtkWidget *dialog=picker->dialog;picker->dialog=NULL;g_signal_handlers_disconnect_by_data(dialog,picker);gtk_widget_destroy(dialog);}g_free(picker);}

/* Generic overlay card and pointer transport. Placement and persistence are DSL. */
typedef void (*BgCardEvent)(int32_t,double,double,void *);
typedef struct {GtkWidget *parent,*card,*grip,*body,*remove;GtkGesture *gesture;BgCardEvent event;void *data;gboolean destroyed,dragging,closed;gulong parent_size;} BgCard;
static int bg_card_unmaps;
static void bg_card_unmapped(GtkWidget *widget,void *data){(void)widget;(void)data;bg_card_unmaps++;}
int32_t bg_card_unmap_count(void){return bg_card_unmaps;}
static void bg_card_emit(BgCard *card,int phase,double x,double y){if(!card->closed && !card->destroyed && card->event)card->event(phase,x,y,card->data);}
static void bg_card_begin(GtkGestureDrag *gesture,double x,double y,void *data){
    BgCard *card=data;int left=0,top=0;
    if(card->destroyed || !gtk_widget_translate_coordinates(card->grip,card->parent,0,0,&left,&top) || x<left || y<top || x>=left+gtk_widget_get_allocated_width(card->grip) || y>=top+gtk_widget_get_allocated_height(card->grip)){gtk_gesture_set_state(GTK_GESTURE(gesture),GTK_EVENT_SEQUENCE_DENIED);return;}
    card->dragging=TRUE;gtk_gesture_set_state(GTK_GESTURE(gesture),GTK_EVENT_SEQUENCE_CLAIMED);bg_card_emit(card,1,0,0);
}
static void bg_card_update(GtkGestureDrag *gesture,double x,double y,void *data){(void)gesture;BgCard *card=data;if(card->dragging)bg_card_emit(card,2,x,y);}
static void bg_card_end(GtkGestureDrag *gesture,double x,double y,void *data){(void)gesture;BgCard *card=data;if(card->dragging){card->dragging=FALSE;bg_card_emit(card,3,x,y);}}
static void bg_card_cancel(GtkGesture *gesture,GdkEventSequence *sequence,void *data){(void)gesture;(void)sequence;BgCard *card=data;if(card->dragging){card->dragging=FALSE;bg_card_emit(card,5,0,0);}}
static void bg_card_remove(GtkButton *button,void *data){(void)button;bg_card_emit(data,4,0,0);}
static void bg_card_size(GtkWidget *widget,GtkAllocation *allocation,void *data){(void)widget;(void)allocation;BgCard *card=data;if(!card->dragging)bg_card_emit(card,6,0,0);}
static void bg_card_destroyed(GtkWidget *widget,void *data){(void)widget;BgCard *card=data;card->destroyed=TRUE;g_signal_handlers_disconnect_by_data(card->remove,card);}
void *bg_card_new(void *parent,const char *name,const char *title,const char *text,const char *body_class){
    if(!GTK_IS_OVERLAY(parent))return NULL;
    BgCard *card=g_new0(BgCard,1);card->parent=g_object_ref(parent);card->card=gtk_box_new(GTK_ORIENTATION_VERTICAL,8);g_object_ref_sink(card->card);
    gtk_widget_set_name(card->card,name);gtk_widget_set_halign(card->card,GTK_ALIGN_START);gtk_widget_set_valign(card->card,GTK_ALIGN_START);gtk_widget_set_size_request(card->card,250,-1);gtk_style_context_add_class(gtk_widget_get_style_context(card->card),"desktop-widget");
    GtkWidget *row=gtk_box_new(GTK_ORIENTATION_HORIZONTAL,8),*label=gtk_label_new(title);gtk_label_set_xalign(GTK_LABEL(label),0);gtk_style_context_add_class(gtk_widget_get_style_context(label),"settings-eyebrow");
    card->grip=gtk_event_box_new();gtk_container_add(GTK_CONTAINER(card->grip),label);gtk_box_pack_start(GTK_BOX(row),card->grip,TRUE,TRUE,0);
    char *grip_name=g_strconcat(name,"-grip",NULL);gtk_widget_set_name(card->grip,grip_name);g_free(grip_name);
    card->remove=gtk_button_new_with_label("×");gtk_style_context_add_class(gtk_widget_get_style_context(card->remove),"desktop-widget-remove");gtk_box_pack_end(GTK_BOX(row),card->remove,FALSE,TRUE,0);gtk_box_pack_start(GTK_BOX(card->card),row,FALSE,TRUE,0);
    char *remove_name=g_strconcat(name,"-remove",NULL);gtk_widget_set_name(card->remove,remove_name);g_free(remove_name);
    card->body=gtk_label_new(text);gtk_label_set_xalign(GTK_LABEL(card->body),0);gtk_label_set_line_wrap(GTK_LABEL(card->body),TRUE);gtk_label_set_max_width_chars(GTK_LABEL(card->body),28);if(*body_class)gtk_style_context_add_class(gtk_widget_get_style_context(card->body),body_class);gtk_box_pack_start(GTK_BOX(card->card),card->body,FALSE,TRUE,0);
    gtk_overlay_add_overlay(GTK_OVERLAY(parent),card->card);g_signal_connect(card->card,"destroy",G_CALLBACK(bg_card_destroyed),card);g_signal_connect(card->card,"unmap",G_CALLBACK(bg_card_unmapped),card);g_signal_connect(card->remove,"clicked",G_CALLBACK(bg_card_remove),card);
    card->gesture=gtk_gesture_drag_new(parent);gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(card->gesture),1);gtk_event_controller_set_propagation_phase(GTK_EVENT_CONTROLLER(card->gesture),GTK_PHASE_CAPTURE);
    g_signal_connect(card->gesture,"drag-begin",G_CALLBACK(bg_card_begin),card);g_signal_connect(card->gesture,"drag-update",G_CALLBACK(bg_card_update),card);g_signal_connect(card->gesture,"drag-end",G_CALLBACK(bg_card_end),card);g_signal_connect(card->gesture,"cancel",G_CALLBACK(bg_card_cancel),card);
    card->parent_size=g_signal_connect(parent,"size-allocate",G_CALLBACK(bg_card_size),card);g_signal_connect(card->card,"size-allocate",G_CALLBACK(bg_card_size),card);gtk_widget_show_all(card->card);return card;
}
void bg_card_watch(void *data,BgCardEvent event,void *context){BgCard *card=data;card->event=event;card->data=context;}
void bg_card_text(void *data,const unsigned char *text,int64_t length){BgCard *card=data;if(card->destroyed)return;char *value=g_strndup((const char *)text,(gsize)length);if(strcmp(gtk_label_get_text(GTK_LABEL(card->body)),value))gtk_label_set_text(GTK_LABEL(card->body),value);g_free(value);}
int32_t bg_card_x(void *data){return gtk_widget_get_margin_start(((BgCard *)data)->card);}
int32_t bg_card_y(void *data){return gtk_widget_get_margin_top(((BgCard *)data)->card);}
int32_t bg_card_limit(void *data,int32_t axis){BgCard *card=data;return MAX(0,axis==0 ? gtk_widget_get_allocated_width(card->parent)-gtk_widget_get_allocated_width(card->card) : gtk_widget_get_allocated_height(card->parent)-gtk_widget_get_allocated_height(card->card));}
void bg_card_place(void *data,int32_t x,int32_t y){BgCard *card=data;if(!card->destroyed){gtk_widget_set_margin_start(card->card,x);gtk_widget_set_margin_top(card->card,y);}}
void *bg_card_widget(void *data){return ((BgCard *)data)->card;}
/* GTK popup transport. The DevLang worker owns item policy and action plans. */
typedef void (*BgMenuEvent)(const unsigned char *,int64_t,void *);
typedef struct {GtkWidget *parent,*menu;GtkGesture *gesture;BgMenuEvent event;void *data;gboolean closed;} BgMenu;
static int bg_menus_visible;
static void bg_menu_mapped(GtkWidget *widget,void *data){(void)widget;(void)data;bg_menus_visible++;}
static void bg_menu_unmapped(GtkWidget *widget,void *data){(void)widget;(void)data;bg_menus_visible--;}
int32_t bg_menu_visible_count(void){return bg_menus_visible;}
static void bg_menu_popup(GtkGestureMultiPress *gesture,int count,double x,double y,void *data){
    (void)count;(void)x;(void)y;BgMenu *menu=data;if(menu->closed || !menu->menu)return;
    GList *items=gtk_container_get_children(GTK_CONTAINER(menu->menu));gboolean empty=items==NULL;g_list_free(items);if(empty)return;
    gtk_gesture_set_state(GTK_GESTURE(gesture),GTK_EVENT_SEQUENCE_CLAIMED);gtk_widget_show_all(menu->menu);
    GdkEvent *event=gtk_get_current_event();gtk_menu_popup_at_pointer(GTK_MENU(menu->menu),event);if(event)gdk_event_free(event);
}
static void bg_menu_selected(GtkMenuItem *item,void *data){BgMenu *menu=data;const char *id=g_object_get_data(G_OBJECT(item),"bg-id");if(!menu->closed && id)menu->event((const unsigned char *)id,(int64_t)strlen(id),menu->data);}
void *bg_menu_new(void *parent,BgMenuEvent event,void *data){
    BgMenu *menu=g_new0(BgMenu,1);menu->parent=g_object_ref(parent);menu->event=event;menu->data=data;menu->gesture=gtk_gesture_multi_press_new(parent);
    gtk_widget_add_events(parent,GDK_BUTTON_PRESS_MASK|GDK_BUTTON_RELEASE_MASK);
    if(GTK_IS_BIN(parent)){GtkWidget *child=gtk_bin_get_child(GTK_BIN(parent));if(child)gtk_widget_add_events(child,GDK_BUTTON_PRESS_MASK|GDK_BUTTON_RELEASE_MASK);}
    gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(menu->gesture),3);gtk_event_controller_set_propagation_phase(GTK_EVENT_CONTROLLER(menu->gesture),GTK_PHASE_CAPTURE);
    g_signal_connect(menu->gesture,"pressed",G_CALLBACK(bg_menu_popup),menu);return menu;
}
void bg_menu_reset(void *data){BgMenu *menu=data;if(menu->menu){gtk_widget_destroy(menu->menu);g_object_unref(menu->menu);}menu->menu=gtk_menu_new();g_object_ref_sink(menu->menu);gtk_widget_set_name(menu->menu,"background-context-menu");gtk_style_context_add_class(gtk_widget_get_style_context(menu->menu),"desktop-context-menu");gtk_menu_attach_to_widget(GTK_MENU(menu->menu),menu->parent,NULL);g_signal_connect(menu->menu,"map",G_CALLBACK(bg_menu_mapped),NULL);g_signal_connect(menu->menu,"unmap",G_CALLBACK(bg_menu_unmapped),NULL);}
void bg_menu_add(void *data,const char *id,const char *title,const char *icon,int32_t separator){
    BgMenu *menu=data;if(separator)gtk_menu_shell_append(GTK_MENU_SHELL(menu->menu),gtk_separator_menu_item_new());
    GtkWidget *row=gtk_menu_item_new(),*box=gtk_box_new(GTK_ORIENTATION_HORIZONTAL,10),*label=gtk_label_new(title);gtk_label_set_xalign(GTK_LABEL(label),0);
    if(*icon){gtk_box_pack_start(GTK_BOX(box),gtk_image_new_from_icon_name(icon,GTK_ICON_SIZE_MENU),FALSE,FALSE,0);}gtk_box_pack_start(GTK_BOX(box),label,TRUE,TRUE,0);gtk_container_add(GTK_CONTAINER(row),box);
    char *name=g_strconcat("background-menu-",id,NULL);gtk_widget_set_name(row,name);g_free(name);g_object_set_data_full(G_OBJECT(row),"bg-id",g_strdup(id),g_free);g_signal_connect(row,"activate",G_CALLBACK(bg_menu_selected),menu);gtk_menu_shell_append(GTK_MENU_SHELL(menu->menu),row);
}
void bg_menu_free(void *data,void *keep){(void)keep;BgMenu *menu=data;menu->closed=TRUE;g_signal_handlers_disconnect_by_data(menu->gesture,menu);g_object_run_dispose(G_OBJECT(menu->gesture));g_object_unref(menu->gesture);if(menu->menu){gtk_widget_destroy(menu->menu);g_object_unref(menu->menu);}g_object_unref(menu->parent);g_free(menu);}

/* File notifications only; preference decoding and merging stay in DevLang. */
typedef void (*BgChanged)(void *);
typedef struct {GFileMonitor *monitor;guint pending;BgChanged changed;void *data;} BgWatch;
static gboolean bg_watch_emit(void *data){BgWatch *watch=data;watch->pending=0;watch->changed(watch->data);return G_SOURCE_REMOVE;}
static void bg_watch_changed(GFileMonitor *monitor,GFile *file,GFile *other,GFileMonitorEvent event,void *data){(void)monitor;(void)file;(void)other;(void)event;BgWatch *watch=data;if(!watch->pending)watch->pending=g_timeout_add(80,bg_watch_emit,watch);}
void *bg_watch_new(const char *path,BgChanged changed,void *data){
    BgWatch *watch=g_new0(BgWatch,1);watch->changed=changed;watch->data=data;GFile *file=g_file_new_for_path(path);watch->monitor=g_file_monitor_file(file,G_FILE_MONITOR_WATCH_MOVES,NULL,NULL);g_object_unref(file);
    if(watch->monitor){g_signal_connect(watch->monitor,"changed",G_CALLBACK(bg_watch_changed),watch);}return watch;
}
void bg_watch_free(void *data,void *keep){(void)keep;BgWatch *watch=data;if(watch->pending)g_source_remove(watch->pending);if(watch->monitor){g_signal_handlers_disconnect_by_data(watch->monitor,watch);g_file_monitor_cancel(watch->monitor);g_object_unref(watch->monitor);}g_free(watch);}
void bg_card_free(void *data,void *keep){(void)keep;BgCard *card=data;if(!card)return;card->closed=TRUE;card->event=NULL;g_signal_handlers_disconnect_by_data(card->gesture,card);g_object_run_dispose(G_OBJECT(card->gesture));g_object_unref(card->gesture);if(card->parent_size && g_signal_handler_is_connected(card->parent,card->parent_size))g_signal_handler_disconnect(card->parent,card->parent_size);g_signal_handlers_disconnect_by_data(card->card,card);if(!card->destroyed)g_signal_handlers_disconnect_by_data(card->remove,card);gtk_widget_destroy(card->card);g_object_unref(card->card);g_object_unref(card->parent);g_free(card);}

