/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef DEVOS_TOUCHPAD_H
#define DEVOS_TOUCHPAD_H
#include <libinput.h>
#include <linux/input-event-codes.h>
#include <stdlib.h>
#include <string.h>
#include "common/spawn.h"
#include "session-lock.h"

/* libinput's LRM mapping emits BTN_MIDDLE for the three-finger tap.
 * Restrict this binding to tapping-capable libinput touchpads, never mice.
 * A physical middle click on such a touchpad has the same binding. */
static bool devos_touchpad_button(struct seat *seat,
        struct wlr_pointer_button_event *event) {
    if (event->button != BTN_MIDDLE) return false;
    const char *enabled = getenv("DEV_OS_TASK_VIEW");
    bool allowed = enabled && !strcmp(enabled, "1") && DEVOS_TOUCHPAD_ALLOWED;
    if (event->state == WL_POINTER_BUTTON_STATE_RELEASED
            && seat->devos_tap_pointer == event->pointer) {
        seat->devos_tap_pointer = NULL;
        if (allowed) spawn_async_no_shell("dev-os-shell launcher");
        return true;
    }
    if (!allowed || event->state != WL_POINTER_BUTTON_STATE_PRESSED
            || !wlr_input_device_is_libinput(&event->pointer->base)) return false;
    struct libinput_device *device = wlr_libinput_get_device_handle(&event->pointer->base);
    if (libinput_device_config_tap_get_finger_count(device) < 3
            || libinput_device_config_tap_get_enabled(device) != LIBINPUT_CONFIG_TAP_ENABLED
            || libinput_device_config_tap_get_button_map(device) != LIBINPUT_CONFIG_TAP_MAP_LRM) return false;
    seat->devos_tap_pointer = event->pointer;
    return true;
}
#endif
