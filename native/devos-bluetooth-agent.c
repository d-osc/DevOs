/*
 * devos-bluetooth-agent <device-object-path> <state-directory>
 *
 * Pairs one Bluetooth device. It exports an org.bluez.Agent1 object, registers it with BlueZ, calls Device1.Pair and answers BlueZ's
 * questions (PIN, passkey, confirmation, authorization) with what the user typed in Settings. The two sides talk through two files in the
 * state directory, so the Settings worker needs no D-Bus server of its own:
 *   state     (written by this program, replaced atomically)
 *               pairing                       registered, waiting for BlueZ
 *               prompt <TAB> kind <TAB> code  BlueZ needs an answer; kind is pin, passkey, confirm or authorize
 *               display <TAB> code            BlueZ shows a code to type on the device
 *               done | error <TAB> message    the end
 *   response  (written by Settings, removed once read)
 *               accept <TAB> value | decline | cancel
 * Only requests for the device named on the command line are answered; anything else is rejected, like the JS agent did.
 * DEVOS_BT_BUS=session selects the session bus (tests with a stand-in BlueZ); the system bus is the default.
 */
#include <gio/gio.h>
#include <glib-unix.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const char *agent_xml =
    "<node><interface name='org.bluez.Agent1'>"
    "<method name='Release'/>"
    "<method name='RequestPinCode'><arg type='o' direction='in'/><arg type='s' direction='out'/></method>"
    "<method name='DisplayPinCode'><arg type='o' direction='in'/><arg type='s' direction='in'/></method>"
    "<method name='RequestPasskey'><arg type='o' direction='in'/><arg type='u' direction='out'/></method>"
    "<method name='DisplayPasskey'><arg type='o' direction='in'/><arg type='u' direction='in'/><arg type='q' direction='in'/></method>"
    "<method name='RequestConfirmation'><arg type='o' direction='in'/><arg type='u' direction='in'/></method>"
    "<method name='RequestAuthorization'><arg type='o' direction='in'/></method>"
    "<method name='AuthorizeService'><arg type='o' direction='in'/><arg type='s' direction='in'/></method>"
    "<method name='Cancel'/>"
    "</interface></node>";

typedef struct {
    GDBusConnection *bus;
    GMainLoop *loop;
    char *device, *directory, *agent_path;
    GDBusMethodInvocation *pending;
    char *pending_kind;
    guint exported, poll;
    gboolean registered, finished;
} Agent;

static Agent agent;

static void write_state(const char *line) {
    char *final = g_build_filename(agent.directory, "state", NULL), *temporary = g_build_filename(agent.directory, "state.tmp", NULL);
    char *text = g_strconcat(line, "\n", NULL);
    if (g_file_set_contents(temporary, text, -1, NULL)) rename(temporary, final);
    g_free(text); g_free(temporary); g_free(final);
}
static void finish(const char *line) {
    if (agent.finished) return;
    agent.finished = TRUE; write_state(line);
    if (agent.pending) { g_dbus_method_invocation_return_dbus_error(agent.pending, "org.bluez.Error.Canceled", "Pairing ended."); agent.pending = NULL; }
    g_main_loop_quit(agent.loop);
}
static void unregister_and_finish(const char *line) {
    if (agent.registered) {
        GVariant *reply = g_dbus_connection_call_sync(agent.bus, "org.bluez", "/org/bluez", "org.bluez.AgentManager1", "UnregisterAgent",
            g_variant_new("(o)", agent.agent_path), NULL, G_DBUS_CALL_FLAGS_NONE, 3000, NULL, NULL);
        if (reply) g_variant_unref(reply);
        agent.registered = FALSE;
    }
    finish(line);
}
/* BlueZ talks about a device by object path; anything else is not ours. */
static gboolean ask(const char *kind, const char *device, const char *code, GDBusMethodInvocation *invocation) {
    if (g_strcmp0(device, agent.device) != 0 || agent.pending || agent.finished) {
        g_dbus_method_invocation_return_dbus_error(invocation, "org.bluez.Error.Rejected", "Unexpected pairing request."); return FALSE;
    }
    agent.pending = invocation; g_free(agent.pending_kind); agent.pending_kind = g_strdup(kind);
    char *line = g_strdup_printf("prompt\t%s\t%s", kind, code); write_state(line); g_free(line);
    return TRUE;
}
static void show(const char *device, const char *code) {
    if (g_strcmp0(device, agent.device) != 0 || agent.finished) return;
    char *line = g_strdup_printf("display\t%s", code); write_state(line); g_free(line);
}
static void cancel_pairing(void) {
    GVariant *reply = g_dbus_connection_call_sync(agent.bus, "org.bluez", agent.device, "org.bluez.Device1", "CancelPairing", NULL, NULL,
        G_DBUS_CALL_FLAGS_NONE, 3000, NULL, NULL);
    if (reply) g_variant_unref(reply);
}
static void method_call(GDBusConnection *connection, const char *sender, const char *path, const char *interface, const char *method,
                        GVariant *parameters, GDBusMethodInvocation *invocation, void *data) {
    (void)connection; (void)sender; (void)path; (void)interface; (void)data;
    const char *device = NULL;
    if (g_str_equal(method, "Release")) { g_dbus_method_invocation_return_value(invocation, NULL); unregister_and_finish("error\tBluetooth service released the pairing agent."); return; }
    if (g_str_equal(method, "Cancel")) {
        if (agent.pending) { g_dbus_method_invocation_return_dbus_error(agent.pending, "org.bluez.Error.Rejected", "Pairing declined."); agent.pending = NULL; }
        g_dbus_method_invocation_return_value(invocation, NULL); write_state("pairing"); return;
    }
    if (g_str_equal(method, "RequestPinCode")) { g_variant_get(parameters, "(&o)", &device); ask("pin", device, "", invocation); return; }
    if (g_str_equal(method, "RequestPasskey")) { g_variant_get(parameters, "(&o)", &device); ask("passkey", device, "", invocation); return; }
    if (g_str_equal(method, "RequestAuthorization")) { g_variant_get(parameters, "(&o)", &device); ask("authorize", device, "", invocation); return; }
    if (g_str_equal(method, "RequestConfirmation")) {
        guint32 passkey = 0; g_variant_get(parameters, "(&ou)", &device, &passkey);
        char code[16]; g_snprintf(code, sizeof code, "%06u", passkey); ask("confirm", device, code, invocation); return;
    }
    if (g_str_equal(method, "AuthorizeService")) { const char *uuid = ""; g_variant_get(parameters, "(&o&s)", &device, &uuid); ask("authorize", device, uuid, invocation); return; }
    if (g_str_equal(method, "DisplayPinCode")) { const char *pin = ""; g_variant_get(parameters, "(&o&s)", &device, &pin); show(device, pin); g_dbus_method_invocation_return_value(invocation, NULL); return; }
    if (g_str_equal(method, "DisplayPasskey")) {
        guint32 passkey = 0; guint16 entered = 0; g_variant_get(parameters, "(&ouq)", &device, &passkey, &entered);
        char code[64]; g_snprintf(code, sizeof code, "%06u · %u digits entered", passkey, entered); show(device, code);
        g_dbus_method_invocation_return_value(invocation, NULL); return;
    }
    g_dbus_method_invocation_return_dbus_error(invocation, "org.bluez.Error.Rejected", "Unsupported request.");
}
/* Looks for the user's answer every 100 ms. */
static gboolean poll_response(void *data) {
    (void)data;
    char *path = g_build_filename(agent.directory, "response", NULL), *content = NULL;
    if (!g_file_get_contents(path, &content, NULL, NULL)) { g_free(path); return G_SOURCE_CONTINUE; }
    unlink(path); g_free(path);
    g_strstrip(content);
    if (g_str_equal(content, "cancel")) {
        if (agent.pending) { g_dbus_method_invocation_return_dbus_error(agent.pending, "org.bluez.Error.Rejected", "Pairing declined."); agent.pending = NULL; }
        cancel_pairing(); write_state("pairing");
    } else if (agent.pending) {
        GDBusMethodInvocation *invocation = agent.pending; agent.pending = NULL;
        if (!g_str_has_prefix(content, "accept")) {
            g_dbus_method_invocation_return_dbus_error(invocation, "org.bluez.Error.Rejected", "Pairing declined.");
        } else {
            const char *value = content[6] == '\t' ? content + 7 : "";
            if (g_str_equal(agent.pending_kind, "pin")) g_dbus_method_invocation_return_value(invocation, g_variant_new("(s)", value));
            else if (g_str_equal(agent.pending_kind, "passkey")) g_dbus_method_invocation_return_value(invocation, g_variant_new("(u)", (guint32)strtoul(value, NULL, 10)));
            else g_dbus_method_invocation_return_value(invocation, NULL);
        }
        write_state("pairing");
    }
    g_free(content);
    return G_SOURCE_CONTINUE;
}
static void paired(GObject *source, GAsyncResult *result, void *data) {
    (void)data; GError *error = NULL;
    GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, &error);
    if (reply) { g_variant_unref(reply); unregister_and_finish("done"); return; }
    if (error) g_dbus_error_strip_remote_error(error);
    char *line = g_strdup_printf("error\t%s", error ? error->message : "Pairing failed.");
    for (char *p = line; *p; p++) if (*p == '\n' || *p == '\r') *p = ' ';
    unregister_and_finish(line); g_free(line); g_clear_error(&error);
}
static void registered(GObject *source, GAsyncResult *result, void *data) {
    (void)data; GError *error = NULL;
    GVariant *reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, &error);
    if (!reply) {
        if (error) g_dbus_error_strip_remote_error(error);
        char *line = g_strdup_printf("error\t%s", error ? error->message : "Could not register the pairing agent."); finish(line); g_free(line); g_clear_error(&error); return;
    }
    g_variant_unref(reply); agent.registered = TRUE; write_state("pairing");
    g_dbus_connection_call(agent.bus, "org.bluez", agent.device, "org.bluez.Device1", "Pair", NULL, NULL, G_DBUS_CALL_FLAGS_NONE, 90000, NULL, paired, NULL);
}
static gboolean on_signal(void *data) {
    (void)data; if (agent.pending) { g_dbus_method_invocation_return_dbus_error(agent.pending, "org.bluez.Error.Rejected", "Pairing declined."); agent.pending = NULL; }
    cancel_pairing(); unregister_and_finish("error\tPairing cancelled."); return G_SOURCE_REMOVE;
}
/* A BlueZ device path: /org/bluez/hciN/dev_XX_XX_XX_XX_XX_XX. */
static gboolean device_path_ok(const char *path) {
    if (!g_str_has_prefix(path, "/org/bluez/hci") || strlen(path) > 80) return FALSE;
    for (const char *p = path; *p; p++) if (!g_ascii_isalnum(*p) && *p != '/' && *p != '_') return FALSE;
    return strstr(path, "/dev_") != NULL;
}
int main(int argc, char **argv) {
    if (argc != 3 || !device_path_ok(argv[1])) { fprintf(stderr, "usage: devos-bluetooth-agent /org/bluez/hciN/dev_XX_XX_XX_XX_XX_XX state-directory\n"); return 2; }
    agent.device = argv[1]; agent.directory = argv[2];
    GError *error = NULL;
    const char *selected = getenv("DEVOS_BT_BUS");
    agent.bus = g_bus_get_sync(selected && g_str_equal(selected, "session") ? G_BUS_TYPE_SESSION : G_BUS_TYPE_SYSTEM, NULL, &error);
    if (!agent.bus) { char *line = g_strdup_printf("error\t%s", error ? error->message : "No D-Bus connection."); write_state(line); g_free(line); return 1; }
    GDBusNodeInfo *info = g_dbus_node_info_new_for_xml(agent_xml, &error);
    if (!info) { write_state("error\tInternal error."); return 1; }
    agent.agent_path = g_strdup_printf("/org/devos/Settings/Agent%d", (int)getpid());
    static const GDBusInterfaceVTable table = { .method_call = method_call };
    agent.exported = g_dbus_connection_register_object(agent.bus, agent.agent_path, info->interfaces[0], &table, NULL, NULL, &error);
    if (!agent.exported) { char *line = g_strdup_printf("error\t%s", error ? error->message : "Could not export the agent."); write_state(line); g_free(line); return 1; }
    agent.loop = g_main_loop_new(NULL, FALSE);
    g_unix_signal_add(SIGTERM, on_signal, NULL); g_unix_signal_add(SIGINT, on_signal, NULL);
    agent.poll = g_timeout_add(100, poll_response, NULL);
    g_dbus_connection_call(agent.bus, "org.bluez", "/org/bluez", "org.bluez.AgentManager1", "RegisterAgent", g_variant_new("(os)", agent.agent_path, "KeyboardDisplay"),
        NULL, G_DBUS_CALL_FLAGS_NONE, 10000, NULL, registered, NULL);
    g_main_loop_run(agent.loop);
    g_dbus_node_info_unref(info);
    return 0;
}
