#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <poll.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <wayland-client.h>
#include "foreign-toplevel.h"
#include "devos-workspaces.h"

/* Protocol transport only. State, grouping and all UI live in TypeScript. */
struct window {
    struct window *next;
    struct zwlr_foreign_toplevel_handle_v1 *handle;
    unsigned id;
    char *title, *app_id;
    bool active, minimized, maximized, fullscreen;
    unsigned desktop;
    bool sticky;
};
static struct window *windows;
static struct wl_seat *seat;
static struct zwlr_foreign_toplevel_manager_v1 *manager;
static unsigned next_id = 1;
static bool running = true;
static struct devos_workspace_manager_v1 *workspaces;

static void string(const char *value) {
    putchar('"');
    for (const unsigned char *p = (const unsigned char *)(value ? value : ""); *p; p++) {
        if (*p == '"' || *p == '\\') printf("\\%c", *p);
        else if (*p < 32) printf("\\u%04x", *p);
        else putchar(*p);
    }
    putchar('"');
}
static void title(void *data, struct zwlr_foreign_toplevel_handle_v1 *handle, const char *value) {
    (void)handle; struct window *w = data; free(w->title); w->title = strdup(value);
}
static void app_id(void *data, struct zwlr_foreign_toplevel_handle_v1 *handle, const char *value) {
    (void)handle; struct window *w = data; free(w->app_id); w->app_id = strdup(value);
}
static void output(void *data, struct zwlr_foreign_toplevel_handle_v1 *handle, struct wl_output *value) {
    (void)data; (void)handle; (void)value;
}
static void parent(void *data, struct zwlr_foreign_toplevel_handle_v1 *handle, struct zwlr_foreign_toplevel_handle_v1 *value) {
    (void)data; (void)handle; (void)value;
}
static void state(void *data, struct zwlr_foreign_toplevel_handle_v1 *handle, struct wl_array *values) {
    (void)handle; struct window *w = data; w->active = w->minimized = w->maximized = w->fullscreen = false;
    uint32_t *value;
    wl_array_for_each(value, values) {
        if (*value == ZWLR_FOREIGN_TOPLEVEL_HANDLE_V1_STATE_ACTIVATED) w->active = true;
        if (*value == ZWLR_FOREIGN_TOPLEVEL_HANDLE_V1_STATE_MINIMIZED) w->minimized = true;
        if (*value == ZWLR_FOREIGN_TOPLEVEL_HANDLE_V1_STATE_MAXIMIZED) w->maximized = true;
        if (*value == ZWLR_FOREIGN_TOPLEVEL_HANDLE_V1_STATE_FULLSCREEN) w->fullscreen = true;
    }
}
static void done(void *data, struct zwlr_foreign_toplevel_handle_v1 *handle) {
    (void)handle; struct window *w = data;
    printf("{\"type\":\"window\",\"id\":%u,\"title\":", w->id); string(w->title);
    printf(",\"appId\":"); string(w->app_id);
    printf(",\"active\":%s,\"minimized\":%s,\"maximized\":%s,\"fullscreen\":%s,\"desktop\":%u,\"sticky\":%s}\n", w->active ? "true" : "false", w->minimized ? "true" : "false", w->maximized ? "true" : "false", w->fullscreen ? "true" : "false", w->desktop, w->sticky ? "true" : "false");
    fflush(stdout);
}
static void closed(void *data, struct zwlr_foreign_toplevel_handle_v1 *handle) {
    struct window *w = data, **link = &windows;
    while (*link && *link != w) link = &(*link)->next;
    if (*link) *link = w->next;
    printf("{\"type\":\"closed\",\"id\":%u}\n", w->id); fflush(stdout);
    zwlr_foreign_toplevel_handle_v1_destroy(handle); free(w->title); free(w->app_id); free(w);
}
static const struct zwlr_foreign_toplevel_handle_v1_listener window_listener = {
    .title = title, .app_id = app_id, .output_enter = output, .output_leave = output,
    .state = state, .done = done, .closed = closed, .parent = parent,
};
static void toplevel(void *data, struct zwlr_foreign_toplevel_manager_v1 *value, struct zwlr_foreign_toplevel_handle_v1 *handle) {
    (void)data; (void)value;
    struct window *w = calloc(1, sizeof(*w));
    if (!w) { running = false; return; }
    w->id = next_id++; w->handle = handle; w->next = windows; windows = w;
    zwlr_foreign_toplevel_handle_v1_add_listener(handle, &window_listener, w);
}
static void finished(void *data, struct zwlr_foreign_toplevel_manager_v1 *value) {
    (void)data; (void)value; running = false;
}
static const struct zwlr_foreign_toplevel_manager_v1_listener manager_listener = {.toplevel = toplevel, .finished = finished};
static void capabilities(void *data, struct wl_seat *value, uint32_t caps) { (void)data; (void)value; (void)caps; }
static const struct wl_seat_listener seat_listener = {.capabilities = capabilities};
static void desktop_begin(void *data, struct devos_workspace_manager_v1 *manager_) {
    (void)data; printf("{\"type\":\"desktop-begin\",\"canCreate\":%s,\"canRemove\":%s}\n", devos_workspace_manager_v1_get_version(manager_) >= 2 ? "true" : "false", devos_workspace_manager_v1_get_version(manager_) >= 3 ? "true" : "false");
}
static void desktop_item(void *data, struct devos_workspace_manager_v1 *manager_, uint32_t id, const char *name, uint32_t active) {
    (void)data; (void)manager_; printf("{\"type\":\"desktop\",\"id\":%u,\"name\":", id); string(name);
    printf(",\"active\":%s}\n", active ? "true" : "false");
}
static void desktop_window(void *data, struct devos_workspace_manager_v1 *manager_, uint32_t handle, uint32_t id, uint32_t sticky) {
    (void)data; (void)manager_;
    for (struct window *w = windows; w; w = w->next) if (wl_proxy_get_id((struct wl_proxy *)w->handle) == handle) {
        if (w->desktop != id || w->sticky != (sticky != 0)) {w->desktop = id; w->sticky = sticky != 0; done(w, w->handle);}
        return;
    }
}
static void desktop_done(void *data, struct devos_workspace_manager_v1 *manager_) {
    (void)data; (void)manager_; puts("{\"type\":\"desktop-done\"}"); fflush(stdout);
}
static void keyboard_layout(void *data, struct devos_workspace_manager_v1 *manager_, uint32_t index, const char *name, uint32_t active) {
    (void)data; (void)manager_;
    printf("{\"type\":\"keyboard-layout\",\"index\":%u,\"name\":", index); string(name);
    printf(",\"active\":%s}\n", active ? "true" : "false");
}
static void geometry(void *data, struct devos_workspace_manager_v1 *manager_, uint32_t handle, int32_t x, int32_t y, int32_t width, int32_t height,
    const char *output_name, int32_t ax, int32_t ay, int32_t aw, int32_t ah, const char *region, int32_t min_width, int32_t min_height) {
    (void)data; (void)manager_;
    for (struct window *w = windows; w; w = w->next) if (wl_proxy_get_id((struct wl_proxy *)w->handle) == handle) {
        printf("{\"type\":\"geometry\",\"id\":%u,\"geometry\":{\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d,\"output\":", w->id, x, y, width, height); string(output_name);
        printf(",\"area\":{\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d},\"region\":", ax, ay, aw, ah); string(region);
        printf(",\"minWidth\":%d,\"minHeight\":%d}}\n", min_width, min_height); fflush(stdout); return;
    }
}
static const struct devos_workspace_manager_v1_listener workspace_listener = {
    .begin = desktop_begin, .desktop = desktop_item, .window = desktop_window, .done = desktop_done, .keyboard_layout = keyboard_layout, .geometry = geometry,
};
static void global(void *data, struct wl_registry *registry, uint32_t name, const char *interface, uint32_t version) {
    (void)data;
    if (!strcmp(interface, zwlr_foreign_toplevel_manager_v1_interface.name)) {
        manager = wl_registry_bind(registry, name, &zwlr_foreign_toplevel_manager_v1_interface, version < 3 ? version : 3);
        zwlr_foreign_toplevel_manager_v1_add_listener(manager, &manager_listener, NULL);
    } else if (!strcmp(interface, devos_workspace_manager_v1_interface.name)) {
        workspaces = wl_registry_bind(registry, name, &devos_workspace_manager_v1_interface, version < 6 ? version : 6);
        devos_workspace_manager_v1_add_listener(workspaces, &workspace_listener, NULL);
        printf("{\"type\":\"snap-capability\",\"supported\":%s,\"canResize\":%s}\n", version >= 5 ? "true" : "false", version >= 6 ? "true" : "false"); fflush(stdout);
    } else if (!seat && !strcmp(interface, wl_seat_interface.name)) {
        seat = wl_registry_bind(registry, name, &wl_seat_interface, 1);
        wl_seat_add_listener(seat, &seat_listener, NULL);
    }
}
static void removed(void *data, struct wl_registry *registry, uint32_t name) { (void)data; (void)registry; (void)name; }
static const struct wl_registry_listener registry_listener = {.global = global, .global_remove = removed};
static void resize_cells(const char *line) {
    if (!workspaces || devos_workspace_manager_v1_get_version(workspaces) < 6 || strlen(line) >= 1024) return;
    char copy[1024], *save = NULL; strcpy(copy, line);
    struct wl_array cells; wl_array_init(&cells); unsigned count = 0;
    for (char *token = strtok_r(copy, " ", &save); token; token = strtok_r(NULL, " ", &save)) {
        unsigned id, x, y, width, height; char extra;
        if (++count > 4 || sscanf(token, "%u,%u,%u,%u,%u%c", &id, &x, &y, &width, &height, &extra) != 5) goto out;
        struct window *found = NULL;
        for (struct window *w = windows; w; w = w->next) if (w->id == id) {found = w; break;}
        if (!found) goto out;
        uint32_t *cell = wl_array_add(&cells, 5 * sizeof(uint32_t)); if (!cell) goto out;
        cell[0] = wl_proxy_get_id((struct wl_proxy *)found->handle); cell[1] = x; cell[2] = y; cell[3] = width; cell[4] = height;
    }
    if (count >= 2) devos_workspace_manager_v1_resize_group(workspaces, &cells);
 out: wl_array_release(&cells);
}
static void command(const char *line) {
    char action[16], region[80]; unsigned id, desktop;
    if (sscanf(line, "%15s", action) != 1) return;
    if (!strcmp(action, "sash") && !strncmp(line, "sash ", 5)) {resize_cells(line + 5); return;}
    if (!strcmp(action, "create-desktop")) {if (workspaces && devos_workspace_manager_v1_get_version(workspaces) >= 2) devos_workspace_manager_v1_create(workspaces); return;}
    if (sscanf(line, "%15s %u", action, &id) != 2) return;
    if (!strcmp(action, "layout")) {if (workspaces && devos_workspace_manager_v1_get_version(workspaces) >= 4) devos_workspace_manager_v1_set_layout(workspaces, id); return;}
    if (!strcmp(action, "remove-desktop")) {if (workspaces && devos_workspace_manager_v1_get_version(workspaces) >= 3) devos_workspace_manager_v1_remove(workspaces, id); return;}
    if (!strcmp(action, "desktop")) {if (workspaces) devos_workspace_manager_v1_activate(workspaces, id); return;}
    for (struct window *w = windows; w; w = w->next) if (w->id == id) {
        if (!strcmp(action, "snap") && workspaces && devos_workspace_manager_v1_get_version(workspaces) >= 5 && sscanf(line, "%15s %u %79s", action, &id, region) == 3)
            devos_workspace_manager_v1_snap(workspaces, wl_proxy_get_id((struct wl_proxy *)w->handle), region);
        else if (!strcmp(action, "activate") && seat) {
            zwlr_foreign_toplevel_handle_v1_unset_minimized(w->handle);
            zwlr_foreign_toplevel_handle_v1_activate(w->handle, seat);
        } else if (!strcmp(action, "minimize")) zwlr_foreign_toplevel_handle_v1_set_minimized(w->handle);
        else if (!strcmp(action, "close")) zwlr_foreign_toplevel_handle_v1_close(w->handle);
        else if (!strcmp(action, "move") && workspaces && sscanf(line, "%15s %u %u", action, &id, &desktop) == 3)
            devos_workspace_manager_v1_move_window(workspaces, wl_proxy_get_id((struct wl_proxy *)w->handle), desktop);
        return;
    }
}
int main(void) {
    struct wl_display *display = wl_display_connect(NULL);
    if (!display) { fputs("Window tracker: cannot connect to Wayland\n", stderr); return 1; }
    struct wl_registry *registry = wl_display_get_registry(display);
    wl_registry_add_listener(registry, &registry_listener, NULL);
    if (wl_display_roundtrip(display) < 0 || !manager || !seat || wl_display_roundtrip(display) < 0) {
        fputs("Window tracker: foreign-toplevel protocol or seat unavailable\n", stderr);
        wl_display_disconnect(display); return 1;
    }
    puts("{\"type\":\"ready\"}"); fflush(stdout);
    char input[1024]; size_t used = 0; int64_t next_desktop_refresh = 0;
    while (running) {
        while (wl_display_prepare_read(display) != 0) {
            if (wl_display_dispatch_pending(display) < 0) { running = false; break; }
        }
        if (!running) break;
        int timeout = -1;
        if (workspaces) {
            struct timespec now; clock_gettime(CLOCK_MONOTONIC, &now);
            int64_t milliseconds = (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
            if (milliseconds >= next_desktop_refresh) {devos_workspace_manager_v1_refresh(workspaces); next_desktop_refresh = milliseconds + 250;}
            timeout = (int)(next_desktop_refresh - milliseconds);
        }
        int flushed = wl_display_flush(display);
        if (flushed < 0 && errno != EAGAIN) { wl_display_cancel_read(display); break; }
        struct pollfd fds[] = {{.fd = wl_display_get_fd(display), .events = POLLIN | (flushed < 0 ? POLLOUT : 0)}, {.fd = STDIN_FILENO, .events = POLLIN}};
        if (poll(fds, 2, timeout) < 0) { wl_display_cancel_read(display); if (errno == EINTR) continue; break; }
        if (fds[0].revents & POLLIN) { if (wl_display_read_events(display) < 0) break; }
        else wl_display_cancel_read(display);
        if (wl_display_dispatch_pending(display) < 0 || fds[0].revents & (POLLERR | POLLHUP)) break;
        if (fds[1].revents & POLLIN) {
            char buffer[128]; ssize_t size = read(STDIN_FILENO, buffer, sizeof(buffer));
            if (size <= 0) break;
            for (ssize_t i = 0; i < size; i++) {
                if (buffer[i] == '\n') { input[used] = '\0'; command(input); used = 0; }
                else if (used < sizeof(input) - 1) input[used++] = buffer[i];
            }
        } else if (fds[1].revents & (POLLERR | POLLHUP)) break;
    }
    while (windows) { struct window *w = windows; windows = w->next; zwlr_foreign_toplevel_handle_v1_destroy(w->handle); free(w->title); free(w->app_id); free(w); }
    if (workspaces) devos_workspace_manager_v1_destroy(workspaces);
    zwlr_foreign_toplevel_manager_v1_destroy(manager); wl_seat_destroy(seat); wl_registry_destroy(registry); wl_display_disconnect(display);
    return 0;
}
