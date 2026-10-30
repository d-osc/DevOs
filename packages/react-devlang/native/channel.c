#include <gtk/gtk.h>
#include <stdint.h>
#include <string.h>
const char *rc_env(const char *name) { const char *value = g_getenv(name); return value ? value : ""; }

/* Async, bounded line channel. All callbacks run on the owning GTK thread. */
typedef void (*RcReceive)(const unsigned char *, int64_t, void *);
typedef struct {
    gint references;
    GSubprocess *child;
    GCancellable *cancel;
    GByteArray *buffer;
    GBytes *writing;
    GQueue *commands;
    GtkWidget *window;
    RcReceive receive;
    void *context;
    gchar *request;
    guint timer;
    gint64 last;
    gint64 interval;
    gboolean closed, pending, reading, writing_now, paused, changed, failed;
} RcChannel;

static void rc_release(RcChannel *channel) {
    if (--channel->references) return;
    g_clear_object(&channel->child);
    g_clear_object(&channel->cancel);
    g_clear_object(&channel->window);
    g_clear_pointer(&channel->buffer, g_byte_array_unref);
    g_clear_pointer(&channel->writing, g_bytes_unref);
    g_queue_free_full(channel->commands, g_free);
    g_free(channel->request);
    g_free(channel);
}
static void rc_emit(RcChannel *channel, const char *text, gsize length) {
    if (!channel->closed) channel->receive((const unsigned char *)text, (int64_t)length, channel->context);
}
static void rc_error(RcChannel *channel, const char *message) {
    if(channel->failed)g_printerr("react-devlang data transport: %s\n",message);
    gchar *text = g_strconcat("E\t", message, NULL);
    for (char *p = text + 2; *p; p++) if ((unsigned char)*p < 32) *p = ' ';
    rc_emit(channel, text, strlen(text));
    g_free(text);
}
static void rc_send(RcChannel *channel);
static void rc_read(RcChannel *channel);
static void rc_written(GObject *stream, GAsyncResult *result, void *data) {
    RcChannel *channel = data;
    GError *error = NULL;
    gsize written = 0;
    gboolean ok = g_output_stream_write_all_finish(G_OUTPUT_STREAM(stream), result, &written, &error);
    channel->writing_now = FALSE;
    g_clear_pointer(&channel->writing, g_bytes_unref);
    if (!ok) { channel->failed = TRUE; if (!channel->closed) rc_error(channel, error->message); channel->pending = FALSE; }
    g_clear_error(&error);
    if (!channel->closed && !channel->pending && (channel->changed || !g_queue_is_empty(channel->commands))) rc_send(channel);
    rc_release(channel);
}
static void rc_received(GObject *stream, GAsyncResult *result, void *data) {
    RcChannel *channel = data;
    GError *error = NULL;
    GBytes *bytes = g_input_stream_read_bytes_finish(G_INPUT_STREAM(stream), result, &error);
    channel->reading = FALSE;
    if (!channel->closed) {
        gsize size = 0;
        const guint8 *value = bytes ? g_bytes_get_data(bytes, &size) : NULL;
        if (size == 0) {
            channel->failed = TRUE;
            rc_error(channel, error ? error->message : "Data service disconnected. Reopen the application.");
            if (channel->timer) { g_source_remove(channel->timer); channel->timer = 0; }
        } else if (channel->buffer->len + size > 4 * 1024 * 1024) {
            channel->failed = TRUE;
            rc_error(channel, "Data service exceeded the 4 MiB frame limit.");
            g_cancellable_cancel(channel->cancel);
            g_subprocess_force_exit(channel->child);
        } else {
            g_byte_array_append(channel->buffer, value, (guint)size);
            guint begin = 0;
            for (guint i = 0; i < channel->buffer->len; i++) {
                if (channel->buffer->data[i] != '\n') continue;
                channel->pending = FALSE;
                rc_emit(channel, (const char *)channel->buffer->data + begin, i - begin);
                begin = i + 1;
            }
            if (begin) g_byte_array_remove_range(channel->buffer, 0, begin);
            rc_read(channel);
            if (channel->changed || !g_queue_is_empty(channel->commands)) rc_send(channel);
        }
    }
    g_clear_pointer(&bytes, g_bytes_unref);
    g_clear_error(&error);
    rc_release(channel);
}
static void rc_read(RcChannel *channel) {
    if (channel->closed || channel->reading) return;
    channel->reading = TRUE;
    channel->references++;
    g_input_stream_read_bytes_async(g_subprocess_get_stdout_pipe(channel->child), 8192, G_PRIORITY_DEFAULT,
                                   channel->cancel, rc_received, channel);
}
static void rc_exited(GObject *process,GAsyncResult *result,void *data) {
    RcChannel *channel=data;GError *error=NULL;
    g_subprocess_wait_finish(G_SUBPROCESS(process),result,&error);
    if(!channel->closed && !channel->failed) {
        channel->failed=TRUE;
        rc_error(channel,error ? error->message : "Data service disconnected. Reopen the application.");
        if(channel->timer){g_source_remove(channel->timer);channel->timer=0;}
    }
    g_clear_error(&error);rc_release(channel);
}
static void rc_send(RcChannel *channel) {
    if (channel->closed || channel->failed || channel->pending || channel->writing_now || (!channel->request && g_queue_is_empty(channel->commands))) return;
    channel->pending = TRUE;
    channel->writing_now = TRUE;
    channel->last = g_get_monotonic_time();
    char *command = g_queue_pop_head(channel->commands);
    if (!command) channel->changed = FALSE;
    const char *request = command ? command : channel->request;
    channel->writing = g_bytes_new(request, strlen(request));
    g_free(command);
    channel->references++;
    gsize length = 0;
    const void *data = g_bytes_get_data(channel->writing, &length);
    g_output_stream_write_all_async(g_subprocess_get_stdin_pipe(channel->child), data, length,
                                   G_PRIORITY_DEFAULT, channel->cancel, rc_written, channel);
}
static gboolean rc_tick(void *data) {
    RcChannel *channel = data;
    GdkWindow *window = gtk_widget_get_window(channel->window);
    if (!channel->paused && gtk_widget_get_visible(channel->window) && window &&
        !(gdk_window_get_state(window) & GDK_WINDOW_STATE_ICONIFIED)) {
        gint64 interval = channel->interval ? channel->interval : gtk_window_is_active(GTK_WINDOW(channel->window)) ? 2000000 : 8000000;
        if (g_get_monotonic_time() - channel->last >= interval) rc_send(channel);
    }
    return G_SOURCE_CONTINUE;
}
void *rc_open_ffi(void *window, const char *program, const char *script, const char *root,const char *library, RcReceive receive, void *context) {
    RcChannel *channel = g_new0(RcChannel, 1);
    channel->references = 1;
    channel->commands = g_queue_new();
    channel->window = g_object_ref(window);
    channel->receive = receive;
    channel->context = context;
    channel->buffer = g_byte_array_new();
    channel->cancel = g_cancellable_new();
    GError *error = NULL;
    if(library && *library)channel->child=g_subprocess_new(G_SUBPROCESS_FLAGS_STDIN_PIPE|G_SUBPROCESS_FLAGS_STDOUT_PIPE,&error,program,script,"--ffi-lib",library,"--",root,NULL);
    else channel->child = g_subprocess_new(G_SUBPROCESS_FLAGS_STDIN_PIPE | G_SUBPROCESS_FLAGS_STDOUT_PIPE,&error, program, script, "--", root, NULL);
    if (!channel->child) { rc_error(channel, error->message); g_clear_error(&error); return channel; }
    channel->timer = g_timeout_add(250, rc_tick, channel);
    /* A CLI driver may leave an interpreter child holding stdout after it exits. */
    channel->references++;
    g_subprocess_wait_async(channel->child,NULL,rc_exited,channel);
    rc_read(channel);
    return channel;
}
void *rc_open(void *window,const char *program,const char *script,const char *root,RcReceive receive,void *context){return rc_open_ffi(window,program,script,root,"",receive,context);}
int32_t rc_failed(void *data) {RcChannel *channel=data;return channel && channel->failed;}
void rc_request(void *data, const unsigned char *text, int64_t length) {
    RcChannel *channel = data;
    if (!channel || channel->closed || !channel->child) return;
    if (length <= 0 || length > 65536 || memchr(text, '\n', (size_t)length)) { rc_error(channel, "Requests must be nonempty lines up to 64 KiB."); return; }
    g_free(channel->request);
    channel->request = g_malloc((gsize)length + 2);
    memcpy(channel->request, text, (size_t)length);
    channel->request[length] = '\n'; channel->request[length + 1] = 0;
    channel->changed = TRUE;
    rc_send(channel);
}
void rc_pause(void *data, int32_t paused) { if (data) ((RcChannel *)data)->paused = paused != 0; }
void rc_interval(void *data,int32_t milliseconds) {if(data)((RcChannel *)data)->interval=milliseconds>0 ? (gint64)CLAMP(milliseconds,100,60000)*1000 : 0;}
void rc_command(void *data, const unsigned char *text, int64_t length) {
    RcChannel *channel = data;
    if (!channel || channel->closed || !channel->child) return;
    if (length <= 0 || length > 65536 || memchr(text, '\n', (size_t)length)) { rc_error(channel, "Commands must be nonempty lines up to 64 KiB."); return; }
    if (channel->commands->length >= 64) { rc_error(channel, "Command queue is full. Wait for the service to respond."); return; }
    char *command = g_malloc((gsize)length + 2);
    memcpy(command, text, (size_t)length); command[length] = '\n'; command[length + 1] = 0;
    g_queue_push_tail(channel->commands, command);
    rc_send(channel);
}
void rc_close(void *data, void *keep_callback_alive) {
    (void)keep_callback_alive;
    RcChannel *channel = data;
    if (!channel || channel->closed) return;
    channel->closed = TRUE;
    if (channel->timer) g_source_remove(channel->timer);
    g_cancellable_cancel(channel->cancel);
    if (channel->child) g_subprocess_force_exit(channel->child);
    rc_release(channel);
}
