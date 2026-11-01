/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef DEVOS_TAB_DRAG_H
#define DEVOS_TAB_DRAG_H
#include <string.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <wlr/types/wlr_data_device.h>
#include <wlr/types/wlr_seat.h>

/* Wait for GTK to consume the cancellation marker before ending its data source.
 * The pipe closes only after the source's data-get handler has run. */
struct devos_tab_cancel {
    struct wlr_data_source *source;
    struct wl_event_source *event;
    struct wl_listener destroyed;
    int fd;
};
static void devos_tab_cancel_free(struct devos_tab_cancel *cancel) {
    wl_list_remove(&cancel->destroyed.link);
    wl_event_source_remove(cancel->event);
    close(cancel->fd);
    free(cancel);
}
static void devos_tab_cancel_destroyed(struct wl_listener *listener, void *data) {
    (void)data;
    struct devos_tab_cancel *cancel=wl_container_of(listener,cancel,destroyed);
    devos_tab_cancel_free(cancel);
}
static int devos_tab_cancel_ready(int fd,uint32_t mask,void *data) {
    struct devos_tab_cancel *cancel=data;char bytes[64];ssize_t n;
    do {n=read(fd,bytes,sizeof bytes);} while(n>0);
    if(n!=0 && !(mask & (WL_EVENT_HANGUP|WL_EVENT_ERROR)))return 0;
    struct wlr_data_source *source=cancel->source;
    devos_tab_cancel_free(cancel);wlr_data_source_destroy(source);return 0;
}
static bool devos_tab_cancel_request(struct server *server,struct wlr_data_source *source,const char *mime) {
    int fds[2];if(pipe(fds)!=0)return false;
    fcntl(fds[0],F_SETFD,FD_CLOEXEC);fcntl(fds[1],F_SETFD,FD_CLOEXEC);
    struct devos_tab_cancel *cancel=calloc(1,sizeof *cancel);
    if(!cancel){close(fds[0]);close(fds[1]);return false;}
    cancel->source=source;cancel->fd=fds[0];fcntl(fds[0],F_SETFL,O_NONBLOCK);
    cancel->event=wl_event_loop_add_fd(server->wl_event_loop,fds[0],WL_EVENT_READABLE,devos_tab_cancel_ready,cancel);
    if(!cancel->event){close(fds[0]);close(fds[1]);free(cancel);return false;}
    cancel->destroyed.notify=devos_tab_cancel_destroyed;wl_signal_add(&source->events.destroy,&cancel->destroyed);
    wlr_data_source_send(source,mime,fds[1]);return true;
}

/* Unaccepted drops and server-side cancellation both look like ERROR to GTK3.
 * Forward Escape for our tabs so GTK can record the user's cancellation first.
 * Other drag sources retain the compositor's ordinary cancellation behavior. */
static bool
devos_tab_drag_key(struct server *server, struct wlr_keyboard *keyboard,
        struct wlr_keyboard_key_event *event,
        const xkb_keysym_t *symbols, int count)
{
    struct wlr_seat *seat = server->seat.seat;
    if (!server->seat.drag.active || !seat->drag || !seat->drag->source) return false;
    for (int i = 0; i < count; i++) {
        if (symbols[i] != XKB_KEY_Escape) continue;
        key_state_store_pressed_key_as_bound(event->keycode);
        char **mime;
        /* Send an ordered cancellation marker before wl_data_source.cancelled.
         * This also works with virtual keyboards and preserves GTK's ERROR vs
         * unaccepted-drop distinction without relying on keyboard focus. */
        wl_array_for_each(mime, &seat->drag->source->mime_types) {
            if (strcmp(*mime, "application/x-dev-os-window-tab-cancel")) continue;
            if(devos_tab_cancel_request(server,seat->drag->source,*mime))return true;
            break;
        }
        wl_array_for_each(mime, &seat->drag->source->mime_types) {
            if (strcmp(*mime, "application/x-dev-os-window-tab")) continue;
            /* Virtual keyboards must supply their keymap before forwarding Escape. */
            wlr_seat_set_keyboard(seat, keyboard);
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
