/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef DEVOS_TAB_DRAG_H
#define DEVOS_TAB_DRAG_H
#include <string.h>
#include <wlr/types/wlr_data_device.h>

/* Unaccepted drops and server-side cancellation both look like ERROR to GTK3.
 * Forward Escape for our tabs so GTK can record the user's cancellation first.
 * Other drag sources retain the compositor's ordinary cancellation behavior. */
static bool
devos_tab_drag_key(struct server *server, struct wlr_keyboard_key_event *event,
        const xkb_keysym_t *symbols, int count)
{
    struct wlr_seat *seat = server->seat.seat;
    if (!server->seat.drag.active || !seat->drag || !seat->drag->source) return false;
    for (int i = 0; i < count; i++) {
        if (symbols[i] != XKB_KEY_Escape) continue;
        key_state_store_pressed_key_as_bound(event->keycode);
        char **mime;
        wl_array_for_each(mime, &seat->drag->source->mime_types) {
            if (strcmp(*mime, "application/x-dev-os-window-tab")) continue;
            wlr_seat_keyboard_send_key(seat, event->time_msec, event->keycode,
                WL_KEYBOARD_KEY_STATE_PRESSED);
            wlr_seat_keyboard_send_key(seat, event->time_msec, event->keycode,
                WL_KEYBOARD_KEY_STATE_RELEASED);
            return true;
        }
        wlr_data_source_destroy(seat->drag->source);
        return true;
    }
    return false;
}
#endif
