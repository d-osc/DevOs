/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef DEVOS_TASK_VIEW_H
#define DEVOS_TASK_VIEW_H
#include <stdbool.h>
#include <stdint.h>
#include <math.h>
struct devos_task_view_swipe { bool active; unsigned fingers; uint32_t started; double x, y; };
enum devos_swipe_action { DEVOS_SWIPE_NONE, DEVOS_SWIPE_TASK_VIEW, DEVOS_SWIPE_MINIMIZE, DEVOS_SWIPE_NEXT_DESKTOP, DEVOS_SWIPE_PREVIOUS_DESKTOP, DEVOS_SWIPE_RESTORE, DEVOS_SWIPE_NEXT_WINDOW, DEVOS_SWIPE_PREVIOUS_WINDOW };
static inline void devos_task_view_begin(struct devos_task_view_swipe *s, unsigned fingers, uint32_t time, bool allowed) {
    *s = (struct devos_task_view_swipe){.active = allowed && (fingers == 3 || fingers == 4), .fingers = fingers, .started = time};
}
static inline void devos_task_view_update(struct devos_task_view_swipe *s, double x, double y) {
    if (s->active) { s->x += x; s->y += y; }
}
static inline enum devos_swipe_action devos_task_view_end(struct devos_task_view_swipe *s, uint32_t time, bool cancelled, bool allowed) {
    enum devos_swipe_action result = DEVOS_SWIPE_NONE;
    if (s->active && allowed && !cancelled && (uint32_t)(time - s->started) <= 1200
        && isfinite(s->x) && isfinite(s->y)) {
        if (s->y <= -70 && fabs(s->x) <= -s->y * 0.65) {
            result = s->fingers == 4 ? DEVOS_SWIPE_TASK_VIEW : DEVOS_SWIPE_RESTORE;
        } else if (s->fingers == 3 && s->y >= 70 && fabs(s->x) <= s->y * 0.65) {
            result = DEVOS_SWIPE_MINIMIZE;
        } else if (fabs(s->x) >= 70 && fabs(s->y) <= fabs(s->x) * 0.65) {
            result = s->fingers == 4
                ? (s->x < 0 ? DEVOS_SWIPE_NEXT_DESKTOP : DEVOS_SWIPE_PREVIOUS_DESKTOP)
                : (s->x < 0 ? DEVOS_SWIPE_NEXT_WINDOW : DEVOS_SWIPE_PREVIOUS_WINDOW);
        }
    }
    s->active = false;
    return result;
}
#endif
