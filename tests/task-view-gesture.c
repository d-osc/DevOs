#include <assert.h>
#include "../tools/setup/devos-task-view.h"
static enum devos_swipe_action swipe(unsigned fingers, double x, double y, unsigned duration, bool cancel, bool allowed) {
    struct devos_task_view_swipe s;
    devos_task_view_begin(&s, fingers, 100, true); devos_task_view_update(&s, x, y);
    return devos_task_view_end(&s, 100 + duration, cancel, allowed);
}
int main(void) {
    assert(swipe(3, -100, 10, 300, false, true) == DEVOS_SWIPE_NEXT_WINDOW);
    assert(swipe(3, 100, -10, 300, false, true) == DEVOS_SWIPE_PREVIOUS_WINDOW);
    assert(swipe(3, -70, 0, 1200, false, true) == DEVOS_SWIPE_NEXT_WINDOW);
    assert(swipe(4, -100, 0, 300, false, true) == DEVOS_SWIPE_NEXT_DESKTOP);
    assert(swipe(4, 100, 0, 300, false, true) == DEVOS_SWIPE_PREVIOUS_DESKTOP);
    assert(swipe(4, 0, -100, 300, false, true) == DEVOS_SWIPE_TASK_VIEW);
    assert(!swipe(4, 0, -100, 300, true, true));
    assert(!swipe(4, 0, -100, 300, false, false));
    assert(!swipe(5, 0, -100, 300, false, true));
    assert(!swipe(3, -69, 0, 300, false, true));
    assert(!swipe(3, -100, 80, 300, false, true));
    assert(!swipe(2, -100, 0, 300, false, true));
    assert(!swipe(3, -100, 0, 1201, false, true));
    assert(!swipe(3, 100, 0, 300, true, true));
    assert(!swipe(3, -100, 0, 300, false, false));
    assert(!swipe(3, NAN, 0, 300, false, true));
    assert(!swipe(3, 100, INFINITY, 300, false, true));
    assert(swipe(3, 10, -100, 300, false, true) == DEVOS_SWIPE_RESTORE);
    assert(!swipe(2, 0, -100, 300, false, true));
    assert(!swipe(3, 100, -80, 300, false, true));
    assert(swipe(3, 0, 100, 300, false, true) == DEVOS_SWIPE_MINIMIZE);
    assert(swipe(3, -10, 100, 300, false, true) == DEVOS_SWIPE_MINIMIZE);
    assert(swipe(3, 40, 100, 300, false, true) == DEVOS_SWIPE_MINIMIZE);
    assert(!swipe(3, 0, 69, 300, false, true));
    assert(!swipe(3, 80, 100, 300, false, true));
    assert(!swipe(3, 0, 100, 1201, false, true));
    assert(!swipe(3, 0, 100, 300, true, true));
    assert(!swipe(3, 0, 100, 300, false, false));
    assert(!swipe(2, 0, 100, 300, false, true));
    assert(!swipe(4, 0, 100, 300, false, true));
    assert(!swipe(3, 0, -30, 300, false, true));
    assert(!swipe(3, 0, -100, 1500, false, true));
    assert(!swipe(3, 0, -100, 300, true, true));
    assert(!swipe(3, 0, -100, 300, false, false));
    struct devos_task_view_swipe s;
    devos_task_view_begin(&s, 3, 0, false); devos_task_view_update(&s, 0, -100);
    assert(!devos_task_view_end(&s, 200, false, true));
    devos_task_view_begin(&s, 3, 0, true); devos_task_view_update(&s, 0, -100);
    assert(devos_task_view_end(&s, 200, false, true));
    assert(!devos_task_view_end(&s, 201, false, true));
    devos_task_view_begin(&s, 3, UINT32_MAX - 100, true);
    devos_task_view_update(&s, -40, 5);
    devos_task_view_update(&s, -40, -5);
    assert(devos_task_view_end(&s, 100, false, true) == DEVOS_SWIPE_NEXT_WINDOW);
    assert(devos_task_view_end(&s, 101, false, true) == DEVOS_SWIPE_NONE);
    return 0;
}
