#define _DEFAULT_SOURCE
#include <linux/input-event-codes.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <wayland-client.h>
#include "virtual-pointer.h"

static struct zwlr_virtual_pointer_manager_v1 *manager;
static struct wl_seat *seat;
static void caps(void *data, struct wl_seat *s, uint32_t value) { (void)data; (void)s; (void)value; }
static const struct wl_seat_listener seat_listener = {.capabilities = caps};
static void global(void *data, struct wl_registry *registry, uint32_t name, const char *interface, uint32_t version) {
    (void)data; (void)version;
    if (!strcmp(interface, zwlr_virtual_pointer_manager_v1_interface.name))
        manager = wl_registry_bind(registry, name, &zwlr_virtual_pointer_manager_v1_interface, 1);
    else if (!seat && !strcmp(interface, wl_seat_interface.name)) {
        seat = wl_registry_bind(registry, name, &wl_seat_interface, 1); wl_seat_add_listener(seat, &seat_listener, NULL);
    }
}
static void removed(void *data, struct wl_registry *registry, uint32_t name) { (void)data; (void)registry; (void)name; }
static const struct wl_registry_listener registry_listener = {.global = global, .global_remove = removed};
static uint32_t timestamp(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (uint32_t)(t.tv_sec * 1000 + t.tv_nsec / 1000000); }
int main(void) {
    struct wl_display *display = wl_display_connect(NULL); if (!display) return 1;
    struct wl_registry *registry = wl_display_get_registry(display); wl_registry_add_listener(registry, &registry_listener, NULL);
    if (wl_display_roundtrip(display) < 0 || !manager) return 1;
    struct zwlr_virtual_pointer_v1 *pointer = zwlr_virtual_pointer_manager_v1_create_virtual_pointer(manager, seat);
    wl_display_roundtrip(display); usleep(300000);
    char line[128], action[16], button[16]; double x, y;
    while (fgets(line, sizeof(line), stdin)) {
        strcpy(button, "left");
        if (sscanf(line, "%15s %lf %lf", action, &x, &y) == 3 && !strcmp(action, "move")) {
            zwlr_virtual_pointer_v1_motion(pointer, timestamp(), wl_fixed_from_double(x), wl_fixed_from_double(y));
            zwlr_virtual_pointer_v1_frame(pointer);
        } else if (sscanf(line, "%15s %15s", action, button) >= 1 && (!strcmp(action, "down") || !strcmp(action, "up"))) {
            uint32_t code = !strcmp(button, "right") ? BTN_RIGHT : BTN_LEFT;
            zwlr_virtual_pointer_v1_button(pointer, timestamp(), code,
                !strcmp(action, "down") ? WL_POINTER_BUTTON_STATE_PRESSED : WL_POINTER_BUTTON_STATE_RELEASED);
            zwlr_virtual_pointer_v1_frame(pointer);
        } else if (sscanf(line, "%15s %15s", action, button) >= 1 && !strcmp(action, "click")) {
            uint32_t code = !strcmp(button, "right") ? BTN_RIGHT : BTN_LEFT;
            zwlr_virtual_pointer_v1_button(pointer, timestamp(), code, WL_POINTER_BUTTON_STATE_PRESSED);
            zwlr_virtual_pointer_v1_frame(pointer); wl_display_roundtrip(display); usleep(150000);
            zwlr_virtual_pointer_v1_button(pointer, timestamp(), code, WL_POINTER_BUTTON_STATE_RELEASED);
            zwlr_virtual_pointer_v1_frame(pointer);
        } else return 1;
        if (wl_display_roundtrip(display) < 0) break;
        usleep(150000); puts("ok"); fflush(stdout);
    }
    zwlr_virtual_pointer_v1_destroy(pointer); zwlr_virtual_pointer_manager_v1_destroy(manager);
    if (seat) wl_seat_destroy(seat);
    wl_registry_destroy(registry); wl_display_disconnect(display); return 0;
}
