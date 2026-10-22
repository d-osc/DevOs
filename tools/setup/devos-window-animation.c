/* SPDX-License-Identifier: GPL-2.0-only */
#define _POSIX_C_SOURCE 200809L
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include <wlr/types/wlr_scene.h>
#include <wlr/types/wlr_compositor.h>
#include "labwc.h"
#include "view.h"
#include "session-lock.h"
#include "node.h"

bool devos_scene_copy(struct wlr_scene_node *source, struct wlr_scene_tree *parent);
void devos_window_open(struct view *view);
void devos_window_close(struct view *view);
void devos_window_animations_finish(struct server *server);
void devos_window_watch(struct view *view, struct wlr_surface *surface);
void devos_window_forget(struct view *view);
struct window_watch {struct wl_list link; struct view *view; struct wl_listener unmap, commit, cache_destroy; struct wlr_scene_tree *cache; int64_t cached_at; bool closing;};
static void refresh_cache(struct window_watch *watch, bool force);
static struct wl_list watches = {&watches, &watches};
static struct window_watch *find_watch(struct view *view) {
    struct window_watch *watch;
    wl_list_for_each(watch, &watches, link) if (watch->view == view) return watch;
    return NULL;
}
static void early_unmap(struct wl_listener *listener, void *data) {
    (void)data;
    struct window_watch *watch = wl_container_of(listener, watch, unmap);
    devos_window_close(watch->view);
}
static void committed(struct wl_listener *listener, void *data) {
    (void)data;
    struct window_watch *watch = wl_container_of(listener, watch, commit);
    refresh_cache(watch, false);
}
static void cache_destroy(struct wl_listener *listener, void *data) {
    (void)data;
    struct window_watch *watch = wl_container_of(listener, watch, cache_destroy);
    watch->cache = NULL; wl_list_remove(&watch->cache_destroy.link);
}
void devos_window_forget(struct view *view) {
    struct window_watch *watch = find_watch(view);
    if (!watch) return;
    wl_list_remove(&watch->unmap.link); wl_list_remove(&watch->commit.link); wl_list_remove(&watch->link);
    if (watch->cache) wlr_scene_node_destroy(&watch->cache->node);
    free(watch);
}
void devos_window_watch(struct view *view, struct wlr_surface *surface) {
    devos_window_forget(view);
    struct window_watch *watch = calloc(1, sizeof(*watch));
    if (!watch) return;
    watch->view = view; watch->unmap.notify = early_unmap;
    // Capture before scene-surface listeners drop their last client buffers.
    wl_list_insert(&surface->events.unmap.listener_list, &watch->unmap.link);
    watch->commit.notify = committed; wl_signal_add(&surface->events.commit, &watch->commit);
    wl_list_insert(watches.prev, &watch->link);
}
struct animated_paint {
    struct wl_list link;
    struct wl_listener destroy;
    struct wlr_scene_node *node;
    float base[4], last[4];
};
struct window_animation {
    struct wl_list link, paints;
    struct server *server;
    struct wlr_scene_tree *wrapper;
    struct wlr_scene_node *root;
    struct wl_listener root_destroy, wrapper_destroy;
    struct wl_event_source *timer;
    int64_t started;
    int base_y;
    bool opening;
    float opacity;
    float initial_opacity;
};
static struct wl_list animations = {&animations, &animations};
static int64_t milliseconds(void) {
    struct timespec now; clock_gettime(CLOCK_MONOTONIC, &now);
    return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}
static void paint_destroy(struct wl_listener *listener, void *data) {
    (void)data;
    struct animated_paint *paint = wl_container_of(listener, paint, destroy);
    wl_list_remove(&paint->destroy.link); wl_list_remove(&paint->link); free(paint);
}
static void read_paint(struct animated_paint *paint, float value[4]) {
    memset(value, 0, 4 * sizeof(float));
    if (paint->node->type == WLR_SCENE_NODE_BUFFER) value[0] = wlr_scene_buffer_from_node(paint->node)->opacity;
    else memcpy(value, wlr_scene_rect_from_node(paint->node)->color, 4 * sizeof(float));
}
static void write_paint(struct animated_paint *paint, const float value[4]) {
    if (paint->node->type == WLR_SCENE_NODE_BUFFER) wlr_scene_buffer_set_opacity(wlr_scene_buffer_from_node(paint->node), value[0]);
    else wlr_scene_rect_set_color(wlr_scene_rect_from_node(paint->node), value);
}
static void finish(struct window_animation *animation) {
    if (animation->timer) wl_event_source_remove(animation->timer);
    struct animated_paint *paint, *tmp;
    wl_list_for_each_safe(paint, tmp, &animation->paints, link) {
        float current[4]; read_paint(paint, current);
        if (!memcmp(current, paint->last, sizeof(current))) write_paint(paint, paint->base);
        wl_list_remove(&paint->destroy.link); wl_list_remove(&paint->link); free(paint);
    }
    if (animation->root) {
        wl_list_remove(&animation->root_destroy.link);
        if (animation->wrapper && animation->root->parent == animation->wrapper) {
            wlr_scene_node_reparent(animation->root, animation->wrapper->node.parent);
            wlr_scene_node_place_below(animation->root, &animation->wrapper->node);
        }
    }
    if (animation->wrapper) {
        wl_list_remove(&animation->wrapper_destroy.link);
        wlr_scene_node_destroy(&animation->wrapper->node);
    }
    wl_list_remove(&animation->link);
    if (animation->opening && animation->root) {
        struct window_watch *watch;
        wl_list_for_each(watch, &watches, link) if (watch->view->scene_tree && &watch->view->scene_tree->node == animation->root) {refresh_cache(watch, true); break;}
    }
    free(animation);
}
static void finish_idle(void *data) {
    struct window_animation *animation = data; animation->timer = NULL; finish(animation);
}
static void root_destroy(struct wl_listener *listener, void *data) {
    (void)data;
    struct window_animation *animation = wl_container_of(listener, animation, root_destroy);
    animation->root = NULL; wl_list_remove(&animation->root_destroy.link);
    if (animation->wrapper) animation->wrapper->node.data = NULL;
    if (animation->timer) wl_event_source_remove(animation->timer);
    // The root is still being destroyed; remove its empty wrapper afterwards.
    animation->timer = wl_event_loop_add_idle(animation->server->wl_event_loop, finish_idle, animation);
}
static void wrapper_destroy(struct wl_listener *listener, void *data) {
    (void)data;
    struct window_animation *animation = wl_container_of(listener, animation, wrapper_destroy);
    animation->wrapper = NULL; wl_list_remove(&animation->wrapper_destroy.link); finish(animation);
}
static bool apply(struct window_animation *animation, struct wlr_scene_node *node, float opacity) {
    if (node->type == WLR_SCENE_NODE_TREE) {
        struct wlr_scene_tree *tree = wl_container_of(node, tree, node);
        struct wlr_scene_node *child;
        wl_list_for_each(child, &tree->children, link) if (!apply(animation, child, opacity)) return false;
        return true;
    }
    struct animated_paint *paint, *found = NULL;
    wl_list_for_each(paint, &animation->paints, link) if (paint->node == node) {found = paint; break;}
    if (!found) {
        found = calloc(1, sizeof(*found)); if (!found) return false;
        found->node = node; found->destroy.notify = paint_destroy;
        read_paint(found, found->base); memcpy(found->last, found->base, sizeof(found->base));
        wl_signal_add(&node->events.destroy, &found->destroy);
        wl_list_insert(animation->paints.prev, &found->link);
    }
    float current[4]; read_paint(found, current);
    if (memcmp(current, found->last, sizeof(current))) memcpy(found->base, current, sizeof(current));
    memcpy(found->last, found->base, sizeof(found->last));
    found->last[node->type == WLR_SCENE_NODE_BUFFER ? 0 : 3] *= opacity;
    write_paint(found, found->last); return true;
}
static void refresh_cache(struct window_watch *watch, bool force) {
    // Chromium/Electron may wait for wl_buffer.release before submitting the
    // next frame. Retaining their last buffer for a future close animation
    // prevents release and freezes the visible page even though networking runs.
    const char *app_id = view_get_string_prop(watch->view, "app_id");
    if (app_id && (strstr(app_id, "chrome") || strstr(app_id, "Chrome")
        || strstr(app_id, "chromium") || strstr(app_id, "Chromium")
        || !strcmp(app_id, "code") || !strcmp(app_id, "Code"))) return;
    const char *setting = getenv("DEV_OS_WINDOW_ANIMATIONS");
    if (!setting || strcmp(setting, "1") || watch->closing || !watch->view->scene_tree
        || (!force && milliseconds() - watch->cached_at < 33)) return;
    struct wlr_scene_node *root = &watch->view->scene_tree->node;
    int x, y; if (!wlr_scene_node_coords(root, &x, &y)) return;
    struct window_animation *opening = NULL, *animation;
    wl_list_for_each(animation, &animations, link) if (animation->root == root) {opening = animation; break;}
    if (opening) {y -= opening->wrapper->node.y; apply(opening, root, 1);}
    struct wlr_scene_tree *cache = wlr_scene_tree_create(&watch->view->server->scene->tree);
    bool copied = false;
    if (cache) {wlr_scene_node_set_enabled(&cache->node, false); copied = devos_scene_copy(root, cache);}
    if (opening) apply(opening, root, opening->opacity);
    if (!copied || wl_list_empty(&cache->children)) {if (cache) wlr_scene_node_destroy(&cache->node); return;}
    struct wlr_scene_node *child = wl_container_of(cache->children.next, child, link);
    wlr_scene_node_set_position(child, x, y);
    if (watch->cache) wlr_scene_node_destroy(&watch->cache->node);
    watch->cache = cache; watch->cached_at = milliseconds();
    watch->cache_destroy.notify = cache_destroy;
    wl_signal_add(&cache->node.events.destroy, &watch->cache_destroy);
}
static int frame(void *data) {
    struct window_animation *animation = data;
    if (DEVOS_WINDOW_LOCKED || (animation->root && animation->root->parent != animation->wrapper)) {finish(animation); return 0;}
    double elapsed = (milliseconds() - animation->started) / (animation->opening ? 220.0 : 150.0);
    if (elapsed >= 1) {finish(animation); return 0;}
    double eased = 1 - pow(1 - elapsed, 3);
    float opacity = (animation->opening ? 0.01 + 0.99 * eased : 1 - eased) * animation->initial_opacity;
    animation->opacity = opacity;
    int offset = (int)lround(20 * (animation->opening ? 1 - eased : eased));
    wlr_scene_node_set_position(&animation->wrapper->node, 0, animation->base_y + offset);
    if (!apply(animation, &animation->wrapper->node, opacity)) {finish(animation); return 0;}
    wl_event_source_timer_update(animation->timer, 8); return 0;
}
static bool enabled(struct view *view) {
    const char *setting = getenv("DEV_OS_WINDOW_ANIMATIONS");
    return setting && !strcmp(setting, "1") && !DEVOS_VIEW_LOCKED && view->scene_tree;
}
static struct window_animation *create(struct view *view, bool opening) {
    struct window_animation *animation = calloc(1, sizeof(*animation));
    if (!animation) return NULL;
    animation->server = view->server; animation->opening = opening; animation->initial_opacity = 1;
    wl_list_init(&animation->paints);
    animation->wrapper = wlr_scene_tree_create(view->scene_tree->node.parent);
    if (!animation->wrapper) {free(animation); return NULL;}
    wlr_scene_node_place_above(&animation->wrapper->node, &view->scene_tree->node);
    animation->wrapper_destroy.notify = wrapper_destroy;
    wl_signal_add(&animation->wrapper->node.events.destroy, &animation->wrapper_destroy);
    wl_list_insert(animations.prev, &animation->link);
    return animation;
}
static void start(struct window_animation *animation) {
    animation->timer = wl_event_loop_add_timer(animation->server->wl_event_loop, frame, animation);
    if (!animation->timer) {finish(animation); return;}
    animation->started = milliseconds(); frame(animation);
}
void devos_window_animations_finish(struct server *server) {
    struct window_animation *animation, *tmp;
    wl_list_for_each_safe(animation, tmp, &animations, link) if (animation->server == server) finish(animation);
}
void devos_window_open(struct view *view) {
    if (!find_watch(view) && view->surface) devos_window_watch(view, view->surface);
    struct window_watch *watch = find_watch(view); if (watch) watch->closing = false;
    if (!enabled(view)) return;
    struct window_animation *animation = create(view, true);
    if (!animation) return;
    animation->root = &view->scene_tree->node;
    DEVOS_WINDOW_DESCRIPTOR;
    animation->root_destroy.notify = root_destroy;
    wl_signal_add(&animation->root->events.destroy, &animation->root_destroy);
    wlr_scene_node_reparent(animation->root, animation->wrapper);
    start(animation);
}
void devos_window_close(struct view *view) {
    struct window_watch *watch = find_watch(view);
    if (watch && watch->closing) return;
    if (watch) watch->closing = true;
    if (!enabled(view)) return;
    struct wlr_scene_node *root = &view->scene_tree->node;
    struct window_animation *opening = NULL, *item;
    wl_list_for_each(item, &animations, link) if (item->root == root) {opening = item; break;}
    bool was_enabled = root->enabled;
    wlr_scene_node_set_enabled(root, true);
    int x, y;
    bool visible = wlr_scene_node_coords(root, &x, &y);
    struct window_animation *closing = visible ? create(view, false) : NULL;
    bool copied = false;
    if (closing && watch && watch->cache) {
        struct wlr_scene_tree *cache = watch->cache;
        wlr_scene_node_reparent(&cache->node, closing->wrapper);
        wlr_scene_node_set_enabled(&cache->node, true);
        wl_list_remove(&watch->cache_destroy.link); watch->cache = NULL; copied = true;
        if (opening) closing->initial_opacity = opening->opacity;
    } else copied = closing && devos_scene_copy(root, closing->wrapper);
    if (closing && opening) {
        wlr_scene_node_reparent(&closing->wrapper->node, opening->wrapper->node.parent);
        closing->base_y = opening->wrapper->node.y;
    }
    if (closing) {
        // Refocusing another app raises it immediately. Keep the retiring image
        // above app trees, while panel, menus and lock surfaces remain above it.
        wlr_scene_node_reparent(&closing->wrapper->node, &view->server->scene->tree);
        wlr_scene_node_place_above(&closing->wrapper->node, &view->server->xdg_popup_tree->node);
    }
    wlr_scene_node_set_enabled(root, was_enabled);
    if (opening) finish(opening);
    if (!closing) return;
    if (!copied) {finish(closing); return;}
    start(closing);
}
