/* SPDX-License-Identifier: GPL-2.0-only */
#include <stdbool.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <wayland-server-core.h>
#include <wlr/types/wlr_foreign_toplevel_management_v1.h>
#include <wlr/types/wlr_keyboard.h>
#include <wlr/interfaces/wlr_keyboard.h>
#include <wlr/types/wlr_keyboard_group.h>
#include "labwc.h"
#include "view.h"
#include "regions.h"
#include "output.h"
#include "ssd.h"
#include "common/border.h"
#include "workspaces.h"
#include "session-lock.h"
#include "devos-workspaces-v1-protocol.h"
void devos_workspaces_init(struct server *server);
void devos_workspace_add(struct server *server, const char *name);
void devos_workspace_destroy(struct workspace *workspace);
void devos_workspace_swipe(struct workspace *target, bool update_focus, int direction);
void devos_workspaces_changed(struct server *server);
struct devos_workspace_client {struct wl_list link; struct wl_resource *resource; struct server *server;};
static struct wl_list devos_workspace_clients = {&devos_workspace_clients, &devos_workspace_clients};
static void release_client(struct wl_resource *resource) {
    struct devos_workspace_client *entry, *tmp;
    wl_list_for_each_safe(entry, tmp, &devos_workspace_clients, link) {
        if (entry->resource == resource) {wl_list_remove(&entry->link); free(entry); break;}
    }
}

/* These macros are filled by the version-aware source installation script. */
#define DESKTOP_LIST(s) DEVOS_DESKTOP_LIST
#define CURRENT_DESKTOP(s) DEVOS_CURRENT_DESKTOP
#define LAST_DESKTOP(s) DEVOS_LAST_DESKTOP
#define LOCKED(s) DEVOS_DESKTOP_LOCKED
static struct workspace *desktop_at(struct server *server, unsigned id) {
    struct workspace *workspace; unsigned index = 0;
    wl_list_for_each(workspace, DESKTOP_LIST(server), link) if (++index == id) return workspace;
    return NULL;
}
static unsigned desktop_id(struct server *server, struct workspace *wanted) {
    struct workspace *workspace; unsigned index = 0;
    wl_list_for_each(workspace, DESKTOP_LIST(server), link) { ++index; if (workspace == wanted) return index; }
    return 0;
}
static void destroy(struct wl_client *client, struct wl_resource *resource) { (void)client; wl_resource_destroy(resource); }
static struct wlr_keyboard *layout_keyboard(struct server *server) {
    struct input *input;
    wl_list_for_each(input, &server->seat.inputs, link) {
        if (input->wlr_input_device->type != WLR_INPUT_DEVICE_KEYBOARD) continue;
        struct keyboard *keyboard = (struct keyboard *)input;
        if (!keyboard->is_virtual) return keyboard->wlr_keyboard;
    }
    return server->seat.keyboard_group ? &server->seat.keyboard_group->keyboard : NULL;
}
static void refresh(struct wl_client *client, struct wl_resource *resource) {
    struct server *server = wl_resource_get_user_data(resource);
    devos_workspace_manager_v1_send_begin(resource);
    struct workspace *workspace; unsigned index = 0;
    wl_list_for_each(workspace, DESKTOP_LIST(server), link)
        devos_workspace_manager_v1_send_desktop(resource, ++index, workspace->name ? workspace->name : "", workspace == CURRENT_DESKTOP(server));
    if (server->foreign_toplevel_manager) {
        struct wlr_foreign_toplevel_handle_v1 *handle;
        wl_list_for_each(handle, &server->foreign_toplevel_manager->toplevels, link) {
            struct view *view = handle->data;
            if (!view) continue;
            struct wl_resource *window;
            wl_resource_for_each(window, &handle->resources) if (wl_resource_get_client(window) == client) {
                devos_workspace_manager_v1_send_window(resource, wl_resource_get_id(window), desktop_id(server, view->workspace), view->visible_on_all_workspaces);
                if (wl_resource_get_version(resource) >= 6 && view->output) {
                    struct wlr_box area = output_usable_area_in_layout_coords(view->output);
                    struct border margin = ssd_get_margin(view->ssd);
                    struct view_size_hints hints = view_get_size_hints(view);
                    devos_workspace_manager_v1_send_geometry(resource, wl_resource_get_id(window), view->current.x - margin.left, view->current.y - margin.top,
                        view->current.width + margin.left + margin.right, view->current.height + margin.top + margin.bottom,
                        view->output->wlr_output->name, area.x, area.y, area.width, area.height,
                        view->tiled_region ? view->tiled_region->name : "", hints.min_width + margin.left + margin.right, hints.min_height + margin.top + margin.bottom);
                }
            }
        }
    }
    struct wlr_keyboard *keyboard = layout_keyboard(server);
    if (wl_resource_get_version(resource) >= 4 && keyboard && keyboard->keymap) {
        for (xkb_layout_index_t index = 0; index < xkb_keymap_num_layouts(keyboard->keymap); ++index) {
            const char *name = xkb_keymap_layout_get_name(keyboard->keymap, index);
            devos_workspace_manager_v1_send_keyboard_layout(resource, index, name ? name : "", keyboard->modifiers.group == index);
        }
    }
    devos_workspace_manager_v1_send_done(resource);
}
void devos_workspaces_changed(struct server *server) {
    struct devos_workspace_client *entry;
    wl_list_for_each(entry, &devos_workspace_clients, link) {
        if (entry->server == server) refresh(wl_resource_get_client(entry->resource), entry->resource);
    }
}
static void activate(struct wl_client *client, struct wl_resource *resource, uint32_t id) {
    struct server *server = wl_resource_get_user_data(resource);
    struct workspace *workspace = desktop_at(server, id);
    if (workspace && !LOCKED(server) && !server->seat.drag.active) {
        bool overview = server->seat.focused_layer != NULL;
        devos_workspace_swipe(workspace, !overview, id > desktop_id(server, CURRENT_DESKTOP(server)) ? 1 : -1);
        if (overview) workspaces_osd_hide(&server->seat);
    }
    refresh(client, resource);
}
static void move_window(struct wl_client *client, struct wl_resource *resource, uint32_t window_id, uint32_t id) {
    struct server *server = wl_resource_get_user_data(resource);
    struct wl_resource *window = wl_client_get_object(client, window_id);
    if (!window || LOCKED(server) || server->seat.drag.active || strcmp(wl_resource_get_class(window), "zwlr_foreign_toplevel_handle_v1")) return;
    struct workspace *workspace = desktop_at(server, id);
    struct wlr_foreign_toplevel_handle_v1 *handle = wl_resource_get_user_data(window);
    if (workspace && handle && handle->data) view_move_to_workspace(handle->data, workspace);
    refresh(client, resource);
}
static void create(struct wl_client *client, struct wl_resource *resource) {
    struct server *server = wl_resource_get_user_data(resource);
    if (LOCKED(server) || server->seat.drag.active) return;
    unsigned count = 0;
    struct workspace *workspace;
    wl_list_for_each(workspace, DESKTOP_LIST(server), link) ++count;
    char name[32];
    snprintf(name, sizeof(name), "%u", count + 1);
    devos_workspace_add(server, name);
    activate(client, resource, count + 1);
}
static void remove_desktop(struct wl_client *client, struct wl_resource *resource, uint32_t id) {
    struct server *server = wl_resource_get_user_data(resource);
    struct workspace *workspace = desktop_at(server, id);
    if (!workspace || LOCKED(server) || server->seat.drag.active || wl_list_length(DESKTOP_LIST(server)) <= 1) {
        refresh(client, resource); return;
    }
    struct workspace *target = desktop_at(server, id > 1 ? id - 1 : 2);
    struct view *view, *tmp;
    wl_list_for_each_safe(view, tmp, &server->views, link)
        if (view->workspace == workspace) view_move_to_workspace(view, target);
    if (CURRENT_DESKTOP(server) == workspace) {
        bool overview = server->seat.focused_layer != NULL;
        workspaces_switch_to(target, !overview);
        if (overview) workspaces_osd_hide(&server->seat);
    }
    if (LAST_DESKTOP(server) == workspace) LAST_DESKTOP(server) = target;
    devos_workspace_destroy(workspace);
    refresh(client, resource);
}
static void set_layout(struct wl_client *client, struct wl_resource *resource, uint32_t index) {
    struct server *server = wl_resource_get_user_data(resource);
    struct wlr_keyboard *keyboard = layout_keyboard(server);
    if (!LOCKED(server) && !server->seat.drag.active && keyboard && keyboard->keymap && index < xkb_keymap_num_layouts(keyboard->keymap))
        wlr_keyboard_notify_modifiers(keyboard, keyboard->modifiers.depressed, keyboard->modifiers.latched, keyboard->modifiers.locked, index);
    refresh(client, resource);
}
static void snap(struct wl_client *client, struct wl_resource *resource, uint32_t id, const char *name) {
    struct server *server = wl_resource_get_user_data(resource);
    struct wl_resource *window = wl_client_get_object(client, id);
    if (!window || LOCKED(server) || server->seat.drag.active || strcmp(wl_resource_get_class(window), "zwlr_foreign_toplevel_handle_v1")) return;
    struct wlr_foreign_toplevel_handle_v1 *handle = wl_resource_get_user_data(window);
    struct view *view = handle ? handle->data : NULL;
    if (!view || !view->output) return;
    struct region *region = regions_from_name(name, view->output);
    if (region) view_snap_to_region(view, region);
    refresh(client, resource);
}
static void resize_group(struct wl_client *client, struct wl_resource *resource, struct wl_array *cells) {
    struct server *server = wl_resource_get_user_data(resource);
    if (LOCKED(server) || server->seat.drag.active || cells->size < 40 || cells->size > 80 || cells->size % 20) return;
    struct view *views[4]; struct wlr_box boxes[4];
    uint32_t *values = cells->data; size_t count = cells->size / 20;
    for (size_t i = 0; i < count; ++i) {
        uint32_t *cell = values + i * 5;
        struct wl_resource *window = wl_client_get_object(client, cell[0]);
        if (!window || strcmp(wl_resource_get_class(window), "zwlr_foreign_toplevel_handle_v1")) return;
        struct wlr_foreign_toplevel_handle_v1 *handle = wl_resource_get_user_data(window);
        struct view *view = handle ? handle->data : NULL;
        if (!view || !view->output || !view->tiled_region || view->fullscreen || view->visible_on_all_workspaces) return;
        if (i && (view->output != views[0]->output || view->workspace != views[0]->workspace)) return;
        for (size_t j = 0; j < i; ++j) if (views[j] == view) return;
        if (!cell[3] || !cell[4] || cell[1] > 10000 || cell[2] > 10000 || cell[3] > 10000 - cell[1] || cell[4] > 10000 - cell[2]) return;
        struct wlr_box area = output_usable_area_in_layout_coords(view->output);
        struct region region = {.output = view->output, .geo = {
            .x = area.x + (int64_t)area.width * cell[1] / 10000,
            .y = area.y + (int64_t)area.height * cell[2] / 10000,
            .width = (int64_t)area.width * (cell[1] + cell[3]) / 10000 - (int64_t)area.width * cell[1] / 10000,
            .height = (int64_t)area.height * (cell[2] + cell[4]) / 10000 - (int64_t)area.height * cell[2] / 10000}};
        boxes[i] = view_get_region_snap_box(view, &region); views[i] = view;
        struct view_size_hints hints = view_get_size_hints(view);
        if (boxes[i].width < (hints.min_width > 160 ? hints.min_width : 160) || boxes[i].height < (hints.min_height > 100 ? hints.min_height : 100)) return;
        for (size_t j = 0; j < i; ++j) {
            uint32_t *other = values + j * 5;
            if (cell[1] < other[1] + other[3] && other[1] < cell[1] + cell[3] && cell[2] < other[2] + other[4] && other[2] < cell[2] + cell[4]) return;
        }
    }
    for (size_t i = 0; i < count; ++i) view_move_resize(views[i], boxes[i]);
    refresh(client, resource);
}
static const struct devos_workspace_manager_v1_interface implementation = {
    .destroy = destroy, .refresh = refresh, .activate = activate, .move_window = move_window, .create = create, .remove = remove_desktop, .set_layout = set_layout, .snap = snap, .resize_group = resize_group,
};
static void bind_manager(struct wl_client *client, void *data, uint32_t version, uint32_t id) {
    struct wl_resource *resource = wl_resource_create(client, &devos_workspace_manager_v1_interface, version < 6 ? version : 6, id);
    if (!resource) { wl_client_post_no_memory(client); return; }
    struct devos_workspace_client *entry = calloc(1, sizeof(*entry));
    if (!entry) {wl_resource_destroy(resource); wl_client_post_no_memory(client); return;}
    entry->resource = resource; entry->server = data;
    wl_list_insert(devos_workspace_clients.prev, &entry->link);
    wl_resource_set_implementation(resource, &implementation, data, release_client);
}
void devos_workspaces_init(struct server *server) {
    wl_global_create(server->wl_display, &devos_workspace_manager_v1_interface, 6, server, bind_manager);
}
