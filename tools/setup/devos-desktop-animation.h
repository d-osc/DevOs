/* SPDX-License-Identifier: GPL-2.0-only */
/* Included by workspaces.c: transient buffer copies retain the outgoing desktop. */
#include <time.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "labwc.h"
#include <wlr/types/wlr_scene.h>
#include <wlr/types/wlr_output_layout.h>
#include <wlr-layer-shell-unstable-v1-protocol.h>

struct devos_slide_node {
    struct wl_list link;
    struct wl_listener destroy;
    struct wlr_scene_node *node;
    int x, y;
};
struct devos_slide {
    struct server *server;
    struct wlr_scene_tree *snapshot;
    struct wl_listener destroy;
    struct wl_event_source *timer;
    struct wl_list nodes;
    int width, direction;
    int64_t started;
};
static struct devos_slide *devos_slide_active;
void devos_workspace_swipe(struct workspace *target, bool update_focus, int direction);
void devos_workspaces_changed(struct server *server);
void devos_window_animations_finish(struct server *server);
bool devos_scene_copy(struct wlr_scene_node *source, struct wlr_scene_tree *parent);

static int64_t devos_slide_time(void) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}
static void devos_slide_node_destroy(struct wl_listener *listener, void *data) {
    (void)data;
    struct devos_slide_node *item = wl_container_of(listener, item, destroy);
    wl_list_remove(&item->destroy.link); wl_list_remove(&item->link); free(item);
}
static void devos_slide_finish(void) {
    struct devos_slide *slide = devos_slide_active;
    if (!slide) return;
    devos_slide_active = NULL;
    if (slide->timer) wl_event_source_remove(slide->timer);
    struct devos_slide_node *item, *tmp;
    wl_list_for_each_safe(item, tmp, &slide->nodes, link) {
        wlr_scene_node_set_position(item->node, item->x, item->y);
        wl_list_remove(&item->destroy.link); wl_list_remove(&item->link); free(item);
    }
    wl_list_remove(&slide->destroy.link);
    if (slide->snapshot) wlr_scene_node_destroy(&slide->snapshot->node);
    free(slide);
}
static void devos_slide_destroy(struct wl_listener *listener, void *data) {
    (void)data;
    struct devos_slide *slide = wl_container_of(listener, slide, destroy);
    slide->snapshot = NULL;
    devos_slide_finish();
}
bool devos_scene_copy(struct wlr_scene_node *source, struct wlr_scene_tree *parent) {
    if (!source->enabled) return true;
    struct wlr_scene_node *copy = NULL;
    if (source->type == WLR_SCENE_NODE_TREE) {
        struct wlr_scene_tree *tree = wlr_scene_tree_create(parent);
        if (!tree) return false;
        copy = &tree->node;
        struct wlr_scene_tree *original = wl_container_of(source, original, node);
        struct wlr_scene_node *child;
        wl_list_for_each(child, &original->children, link) {
            if (!devos_scene_copy(child, tree)) return false;
        }
    } else if (source->type == WLR_SCENE_NODE_RECT) {
        struct wlr_scene_rect *rect = wlr_scene_rect_from_node(source);
        struct wlr_scene_rect *clone = wlr_scene_rect_create(parent, rect->width, rect->height, rect->color);
        if (!clone) return false;
        copy = &clone->node;
    } else if (source->type == WLR_SCENE_NODE_BUFFER) {
        struct wlr_scene_buffer *buffer = wlr_scene_buffer_from_node(source);
        if (!buffer->buffer) return true;
        struct wlr_scene_buffer *clone = wlr_scene_buffer_create(parent, buffer->buffer);
        if (!clone) return false;
        wlr_scene_buffer_set_source_box(clone, &buffer->src_box);
        wlr_scene_buffer_set_dest_size(clone, buffer->dst_width, buffer->dst_height);
        wlr_scene_buffer_set_transform(clone, buffer->transform);
        wlr_scene_buffer_set_opacity(clone, buffer->opacity);
        copy = &clone->node;
    }
    if (copy) wlr_scene_node_set_position(copy, source->x, source->y);
    return true;
}
static bool devos_slide_selected(struct server *server, struct wlr_scene_node *node) {
    if (node == &server->view_tree->node || node == &server->view_tree_always_on_top->node
        || node == &server->view_tree_always_on_bottom->node || node == &server->xdg_popup_tree->node) return true;
    struct output *output;
    wl_list_for_each(output, &server->outputs, link) {
        if (node == &output->layer_tree[ZWLR_LAYER_SHELL_V1_LAYER_BACKGROUND]->node) return true;
    }
    return false;
}
static int devos_slide_frame(void *data) {
    struct devos_slide *slide = data;
    if (DEVOS_SLIDE_LOCKED || devos_slide_time() - slide->started >= 300) {
        devos_slide_finish(); return 0;
    }
    double progress = (devos_slide_time() - slide->started) / 300.0;
    double remaining = (1.0 - progress) * (1.0 - progress) * (1.0 - progress);
    int incoming = (int)lround(slide->direction * slide->width * remaining);
    struct devos_slide_node *item;
    wl_list_for_each(item, &slide->nodes, link) wlr_scene_node_set_position(item->node, item->x + incoming, item->y);
    wlr_scene_node_set_position(&slide->snapshot->node, incoming - slide->direction * slide->width, 0);
    wl_event_source_timer_update(slide->timer, 8);
    return 0;
}
void devos_workspace_swipe(struct workspace *target, bool update_focus, int direction) {
    devos_slide_finish();
    struct server *server = target->server;
    devos_window_animations_finish(server);
    const char *enabled = getenv("DEV_OS_TASK_VIEW");
    if (target == DEVOS_SLIDE_CURRENT || !enabled || strcmp(enabled, "1") || server->seat.focused_layer) {
        workspaces_switch_to(target, update_focus); return;
    }
    struct wlr_box box;
    wlr_output_layout_get_box(server->output_layout, NULL, &box);
    struct devos_slide *slide = calloc(1, sizeof(*slide));
    if (!slide || box.width <= 0) { free(slide); workspaces_switch_to(target, update_focus); return; }
    slide->server = server; slide->width = box.width; slide->direction = direction < 0 ? -1 : 1;
    wl_list_init(&slide->nodes);
    slide->snapshot = wlr_scene_tree_create(&server->scene->tree);
    if (!slide->snapshot) {free(slide); workspaces_switch_to(target, update_focus); return;}
    slide->destroy.notify = devos_slide_destroy;
    wl_signal_add(&slide->snapshot->node.events.destroy, &slide->destroy);
    devos_slide_active = slide;
    struct wlr_scene_node *node;
    wl_list_for_each(node, &server->scene->tree.children, link) {
        if (!devos_slide_selected(server, node)) continue;
        struct devos_slide_node *item = calloc(1, sizeof(*item));
        if (!item || !devos_scene_copy(node, slide->snapshot)) {
            free(item); devos_slide_finish(); workspaces_switch_to(target, update_focus); return;
        }
        item->node = node; item->x = node->x; item->y = node->y;
        item->destroy.notify = devos_slide_node_destroy;
        wl_signal_add(&node->events.destroy, &item->destroy);
        wl_list_insert(slide->nodes.prev, &item->link);
    }
    // Keep panel, menus, overview and lock surfaces above the animation.
    wlr_scene_node_place_above(&slide->snapshot->node, &server->xdg_popup_tree->node);
    // The ordinary switch cancels previous animations; keep this new one local.
    devos_slide_active = NULL;
    workspaces_switch_to(target, update_focus);
    workspaces_osd_hide(&server->seat);
    devos_slide_active = slide;
    slide->timer = wl_event_loop_add_timer(server->wl_event_loop, devos_slide_frame, slide);
    if (!slide->timer) {devos_slide_finish(); return;}
    slide->started = devos_slide_time();
    devos_slide_frame(slide);
}
