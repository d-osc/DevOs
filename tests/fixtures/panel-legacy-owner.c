/* Holds the previous renderer's bus lease to verify safe session upgrades. */
#include <gio/gio.h>
int main(int argc,char **argv){
    if(argc!=2)return 1;
    GError *error=NULL;GDBusConnection *bus=g_bus_get_sync(G_BUS_TYPE_SESSION,NULL,&error);if(!bus)return 2;
    char *identity=g_strdup_printf("%s/%s",g_getenv("XDG_RUNTIME_DIR"),g_getenv("WAYLAND_DISPLAY"));char *digest=g_compute_checksum_for_string(G_CHECKSUM_SHA256,identity,-1);char *name=g_strdup_printf("org.devos.Panel.Legacy.s%.16s",digest);g_free(identity);g_free(digest);
    GVariant *reply=g_dbus_connection_call_sync(bus,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","RequestName",g_variant_new("(su)",name,4u),G_VARIANT_TYPE("(u)"),G_DBUS_CALL_FLAGS_NONE,1000,NULL,&error);g_free(name);if(!reply)return 3;guint code=0;g_variant_get(reply,"(u)",&code);g_variant_unref(reply);if(code!=1)return 4;
    if(!g_file_set_contents(argv[1],"ready",-1,&error))return 5;
    GMainLoop *loop=g_main_loop_new(NULL,FALSE);g_main_loop_run(loop);return 0;
}
