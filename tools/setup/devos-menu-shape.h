/* SPDX-License-Identifier: GPL-2.0-only */
/* Cached compositor menu surfaces. Text and hit regions remain native labwc. */
#ifndef DEVOS_MENU_SHAPE_H
#define DEVOS_MENU_SHAPE_H
#include <cairo.h>
#include <math.h>
#include <wlr/types/wlr_scene.h>
#include "buffer.h"

#define DEVOS_MENU_PADDING 8

static void
devos_menu_path(cairo_t *cr, double x, double y, double w, double h, double r)
{
    const double pi = 3.141592653589793;
    r = fmax(0, fmin(r, fmin(w, h) / 2));
    cairo_new_sub_path(cr);
    cairo_arc(cr, x + w - r, y + r, r, -pi / 2, 0);
    cairo_arc(cr, x + w - r, y + h - r, r, 0, pi / 2);
    cairo_arc(cr, x + r, y + h - r, r, pi / 2, pi);
    cairo_arc(cr, x + r, y + r, r, pi, pi * 1.5);
    cairo_close_path(cr);
}

static struct wlr_scene_node *
devos_menu_surface(struct wlr_scene_tree *parent, int width, int height,
        const float fill[4], const float *border, int thickness, int radius)
{
    if (width <= 0 || height <= 0) return NULL;
#ifdef DEVOS_MENU_LEGACY
    struct lab_data_buffer *buffer = buffer_create_cairo(width, height, 1, true);
    if (!buffer) return NULL;
    cairo_t *cr = buffer->cairo;
#else
    struct lab_data_buffer *buffer = buffer_create_cairo(width, height, 1);
    if (!buffer) return NULL;
    cairo_t *cr = cairo_create(buffer->surface);
#endif
    cairo_set_operator(cr, CAIRO_OPERATOR_SOURCE);
    cairo_set_source_rgba(cr, 0, 0, 0, 0); cairo_paint(cr);
    cairo_set_operator(cr, CAIRO_OPERATOR_OVER);
    double inset = thickness / 2.0;
    devos_menu_path(cr, inset, inset, width - thickness, height - thickness, radius);
    cairo_set_source_rgba(cr, fill[0], fill[1], fill[2], fill[3]);
    cairo_fill_preserve(cr);
    if (border && thickness > 0) {
        cairo_set_source_rgba(cr, border[0], border[1], border[2], border[3]);
        cairo_set_line_width(cr, thickness); cairo_stroke(cr);
    } else cairo_new_path(cr);
    cairo_surface_flush(cairo_get_target(cr));
#ifndef DEVOS_MENU_LEGACY
    cairo_destroy(cr);
#endif
    struct wlr_scene_buffer *scene = wlr_scene_buffer_create(parent, &buffer->base);
    wlr_scene_buffer_set_dest_size(scene, width, height);
    wlr_buffer_drop(&buffer->base);
    return &scene->node;
}

#ifdef DEVOS_MENU_LEGACY
static void
devos_menu_finish_scene(struct menu *menu)
{
    struct theme *theme = menu->server->theme;
    const float transparent[4] = {0};
    if (menu->devos_background) wlr_scene_node_destroy(menu->devos_background);
    menu->devos_background = devos_menu_surface(menu->scene_tree,
        menu->size.width, menu->size.height, theme->menu_items_bg_color,
        theme->menu_border_color, theme->menu_border_width, rc.corner_radius);
    if (menu->devos_background) wlr_scene_node_lower_to_bottom(menu->devos_background);
    struct menuitem *item;
    wl_list_for_each(item, &menu->menuitems, link) {
        /* Transparent rectangles preserve the complete row's pointer hit region. */
        wlr_scene_rect_set_color(wlr_scene_rect_from_node(item->normal.background), transparent);
        if (!item->selected.background) continue;
        wlr_scene_rect_set_color(wlr_scene_rect_from_node(item->selected.background), transparent);
        if (item->devos_selected_background) wlr_scene_node_destroy(item->devos_selected_background);
        item->devos_selected_background = devos_menu_surface(item->selected.tree,
            menu->size.width - 8, item->height, theme->menu_items_active_bg_color,
            NULL, 0, rc.corner_radius > 2 ? rc.corner_radius - 2 : 0);
        if (item->devos_selected_background) {
            wlr_scene_node_set_position(item->devos_selected_background, 4, 0);
            wlr_scene_node_lower_to_bottom(item->devos_selected_background);
        }
    }
}
#else
static void
devos_menu_item_background(struct wlr_scene_tree *tree, int width, int height,
        float *color, struct theme *theme)
{
    wlr_scene_rect_create(tree, width, height, (float[4]) {0});
    if (color == theme->menu_items_bg_color) return;
    struct wlr_scene_node *node = devos_menu_surface(tree, width - 8, height,
        color, NULL, 0, rc.corner_radius > 2 ? rc.corner_radius - 2 : 0);
    if (node) wlr_scene_node_set_position(node, 4, 0);
}

static void
devos_menu_finish_scene(struct menu *menu)
{
    struct theme *theme = menu->server->theme;
    struct wlr_scene_node *node = devos_menu_surface(menu->scene_tree,
        menu->size.width, menu->size.height, theme->menu_items_bg_color,
        theme->menu_border_color, theme->menu_border_width, rc.corner_radius);
    if (node) wlr_scene_node_lower_to_bottom(node);
}
#endif
#endif
