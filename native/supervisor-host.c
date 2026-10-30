/* GLib/Unix ABI glue only. Restart, configuration and shutdown policies are DevLang. */
#include <gio/gio.h>
#include <glib-unix.h>
#include <signal.h>
#include <stdlib.h>
#include <dlfcn.h>
#include <sys/prctl.h>
#include <unistd.h>
typedef struct { GSubprocess *process; gint64 pid; gboolean done; int code; } SpChild;
static gboolean stopping;
static guint signals[2];
static gboolean stop_requested(gpointer unused) { (void)unused; stopping=TRUE; return G_SOURCE_CONTINUE; }
void sp_init(void) { stopping=FALSE; signals[0]=g_unix_signal_add(SIGTERM,stop_requested,NULL); signals[1]=g_unix_signal_add(SIGINT,stop_requested,NULL); }
void sp_finish(void) { for(int i=0;i<2;i++) if(signals[i]) {g_source_remove(signals[i]);signals[i]=0;} }
int sp_stopping(void) { return stopping; }
void sp_step(void) { while(g_main_context_pending(NULL)) g_main_context_iteration(NULL,FALSE); }
static gboolean wake(gpointer data) {*(gboolean *)data=TRUE;return G_SOURCE_REMOVE;}
void sp_wait(int milliseconds) {
    gboolean fired=FALSE;guint timer=g_timeout_add(MAX(1,milliseconds),wake,&fired);
    g_main_context_iteration(NULL,TRUE);if(!fired) g_source_remove(timer);
}
void *sp_builder(void) { return g_ptr_array_new_with_free_func(g_free); }
void sp_arg(void *builder,const char *value) { g_ptr_array_add(builder,g_strdup(value)); }
static void waited(GObject *object,GAsyncResult *result,gpointer data) {
    SpChild *child=data; GError *error=NULL;
    if(!g_subprocess_wait_finish(G_SUBPROCESS(object),result,&error)) {child->code=1;g_clear_error(&error);}
    else child->code=g_subprocess_get_if_exited(child->process)?g_subprocess_get_exit_status(child->process):1;
    child->done=TRUE;
}
static void parent_death(void *data){pid_t parent=(pid_t)GPOINTER_TO_INT(data);if(prctl(PR_SET_PDEATHSIG,SIGTERM)!=0 || getppid()!=parent)_exit(127);}
static void *spawn_child(void *builder,gboolean owned) {
    GPtrArray *args=builder; g_ptr_array_add(args,NULL); GError *error=NULL;
    GSubprocessLauncher *launcher=g_subprocess_launcher_new(G_SUBPROCESS_FLAGS_NONE);
    if(owned)g_subprocess_launcher_set_child_setup(launcher,parent_death,GINT_TO_POINTER((gint)getpid()),NULL);
    GSubprocess *process=g_subprocess_launcher_spawnv(launcher,(const gchar *const *)args->pdata,&error);g_object_unref(launcher);g_ptr_array_unref(args);
    if(!process) {g_printerr("Dev OS supervisor: %s\n",error->message);g_clear_error(&error);return NULL;}
    SpChild *child=g_new0(SpChild,1); child->process=process;
    const char *identifier=g_subprocess_get_identifier(process);
    child->pid=identifier?g_ascii_strtoll(identifier,NULL,10):0;
    g_subprocess_wait_async(process,NULL,waited,child); return child;
}
void *sp_spawn(void *builder){return spawn_child(builder,FALSE);}
void *sp_spawn_owned(void *builder){return spawn_child(builder,TRUE);}
int sp_detach(void *builder) {
    GPtrArray *args=builder;g_ptr_array_add(args,NULL);GError *error=NULL;
    gboolean ok=g_spawn_async(NULL,(char **)args->pdata,NULL,G_SPAWN_SEARCH_PATH,NULL,NULL,NULL,&error);
    if(error) {g_printerr("Dev OS supervisor: %s\n",error->message);g_clear_error(&error);}
    g_ptr_array_unref(args);return ok;
}
int sp_detach_at(void *builder,const char *cwd){
    GPtrArray *args=builder;g_ptr_array_add(args,NULL);GError *error=NULL;GSubprocessLauncher *launcher=g_subprocess_launcher_new(G_SUBPROCESS_FLAGS_STDOUT_SILENCE|G_SUBPROCESS_FLAGS_STDERR_SILENCE);g_subprocess_launcher_set_cwd(launcher,cwd);
    GSubprocess *process=g_subprocess_launcher_spawnv(launcher,(const char *const *)args->pdata,&error);g_object_unref(launcher);g_ptr_array_unref(args);
    if(!process){g_printerr("Dev OS action: %s\n",error->message);g_clear_error(&error);return 0;}g_object_unref(process);return 1;
}
long long sp_pid(void *child) {return ((SpChild *)child)->pid;}
int sp_done(void *child) {return ((SpChild *)child)->done;}
int sp_code(void *child) {return ((SpChild *)child)->code;}
void sp_free(void *data) {SpChild *child=data;if(child && child->done) {g_object_unref(child->process);g_free(child);}}
/* Generic Execute(ass)->(is) transport. Command policy/identity remain DevLang. */
int sr_remote(const char *name,const char *path,const char *interface_name,const char *method,void *arguments,const char *cwd) {
    GPtrArray *args=arguments;g_ptr_array_add(args,NULL);GError *error=NULL;
    GDBusConnection *bus=g_bus_get_sync(G_BUS_TYPE_SESSION,NULL,&error);
    GVariant *reply=NULL;
    if(bus) {
        GVariant *parameters=g_variant_ref_sink(g_variant_new("(^ass)",(char **)args->pdata,cwd));
        reply=g_dbus_connection_call_sync(bus,name,path,interface_name,method,parameters,G_VARIANT_TYPE("(is)"),G_DBUS_CALL_FLAGS_NO_AUTO_START,10000,NULL,&error);
        g_variant_unref(parameters);g_object_unref(bus);
    }
    g_ptr_array_unref(args);
    if(!reply) {
        int unavailable=error && (g_error_matches(error,G_DBUS_ERROR,G_DBUS_ERROR_SERVICE_UNKNOWN) ||
            g_error_matches(error,G_DBUS_ERROR,G_DBUS_ERROR_NAME_HAS_NO_OWNER) ||
            g_error_matches(error,G_DBUS_ERROR,G_DBUS_ERROR_UNKNOWN_METHOD) ||
            g_error_matches(error,G_DBUS_ERROR,G_DBUS_ERROR_UNKNOWN_INTERFACE) ||
            g_error_matches(error,G_DBUS_ERROR,G_DBUS_ERROR_UNKNOWN_OBJECT));
        if(!unavailable && error) g_printerr("Dev OS command: %s\n",error->message);
        g_clear_error(&error);return unavailable?-1:-2;
    }
    gint status=1;const char *message=NULL;g_variant_get(reply,"(i&s)",&status,&message);
    if(message && *message) g_printerr("Dev OS command: %s\n",message);
    g_variant_unref(reply);return status;
}
static int has_library(const char *name) {void *library=dlopen(name,RTLD_LAZY|RTLD_LOCAL);if(!library)return 0;dlclose(library);return 1;}
int sr_runtime_features(void) {
    int flags=(glib_major_version>2 || (glib_major_version==2 && glib_minor_version>=80))?1:0;
    void *gtk=dlopen("libgtk-3.so.0",RTLD_LAZY|RTLD_LOCAL);
    if(gtk) {unsigned (*major)(void)=(unsigned (*)(void))dlsym(gtk,"gtk_get_major_version");if(major && major()==3)flags|=2;dlclose(gtk);}
    void *layer=dlopen("libgtk-layer-shell.so.0",RTLD_LAZY|RTLD_LOCAL);
    if(layer) {
        unsigned (*major)(void)=(unsigned (*)(void))dlsym(layer,"gtk_layer_get_major_version");
        unsigned (*minor)(void)=(unsigned (*)(void))dlsym(layer,"gtk_layer_get_minor_version");
        if(major && minor && (major()>0 || minor()>=6)) flags|=4;
        dlclose(layer);
    }
    if(has_library("libcairo.so.2"))flags|=8;
    if(has_library("libwebkit2gtk-4.1.so.0") && has_library("libsoup-3.0.so.0"))flags|=16;
    return flags;
}
