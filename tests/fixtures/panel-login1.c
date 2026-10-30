/* Isolated logind fixture. Never calls real power APIs. */
#include <gio/gio.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static const char xml[]="<node><interface name='org.freedesktop.login1.Manager'><method name='CanReboot'><arg type='s' direction='out'/></method><method name='CanPowerOff'><arg type='s' direction='out'/></method><method name='Reboot'><arg type='b' direction='in'/></method><method name='PowerOff'><arg type='b' direction='in'/></method></interface></node>";
static void call(GDBusConnection *bus,const char *sender,const char *path,const char *interface,const char *method,GVariant *args,GDBusMethodInvocation *invocation,void *data){
    (void)bus;(void)sender;(void)path;(void)interface;(void)data;
    FILE *log=fopen(g_getenv("PANEL_POWER_LOG"),"a");if(!log)exit(2);fprintf(log,"%s\n",method);fclose(log);
    if(g_str_has_prefix(method,"Can")){g_dbus_method_invocation_return_value(invocation,g_variant_new("(s)",strcmp(method,"CanReboot")==0 ? "yes" : "challenge"));return;}
    gboolean interactive=FALSE;g_variant_get(args,"(b)",&interactive);
    if(!interactive || g_strcmp0(g_getenv("PANEL_POWER_DENY"),"1")==0)g_dbus_method_invocation_return_dbus_error(invocation,"org.freedesktop.login1.Error.Denied","Denied by isolated fixture");
    else g_dbus_method_invocation_return_value(invocation,g_variant_new("()"));
}
static const GDBusInterfaceVTable vtable={.method_call=call};
int main(void){
    GError *error=NULL;GDBusConnection *bus=g_bus_get_sync(G_BUS_TYPE_SESSION,NULL,&error);if(!bus)return 2;
    GVariant *reply=g_dbus_connection_call_sync(bus,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","RequestName",g_variant_new("(su)","org.freedesktop.login1",4u),G_VARIANT_TYPE("(u)"),G_DBUS_CALL_FLAGS_NONE,1000,NULL,&error);if(!reply)return 3;g_variant_unref(reply);
    GDBusNodeInfo *node=g_dbus_node_info_new_for_xml(xml,&error);if(!node || !g_dbus_connection_register_object(bus,"/org/freedesktop/login1",node->interfaces[0],&vtable,NULL,NULL,&error))return 4;
    if(!g_file_set_contents(g_getenv("PANEL_POWER_READY"),"ready",-1,&error))return 5;
    GMainLoop *loop=g_main_loop_new(NULL,FALSE);g_main_loop_run(loop);return 0;
}
