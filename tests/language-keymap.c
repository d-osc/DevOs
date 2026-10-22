#include <assert.h>
#include <string.h>
#include <stdio.h>
#include <xkbcommon/xkbcommon.h>
static void key(struct xkb_state *state, xkb_keycode_t code, enum xkb_key_direction direction) {
    xkb_state_update_key(state, code, direction);
}
int main(void) {
    const char *options[] = {"grp:alt_shift_toggle", "grp:ctrl_shift_toggle", "grp:win_space_toggle", "grp:caps_toggle"};
    const unsigned modifiers[] = {64, 37, 133, 0};
    const unsigned triggers[] = {50, 50, 65, 66};
    struct xkb_context *context = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
    for (unsigned i = 0; i < 4; ++i) {
        struct xkb_rule_names names = {.layout = "us,th", .variant = "basic,basic", .options = options[i]};
        struct xkb_keymap *map = xkb_keymap_new_from_names(context, &names, XKB_KEYMAP_COMPILE_NO_FLAGS);
        assert(map && xkb_keymap_num_layouts(map) == 2);
        struct xkb_state *state = xkb_state_new(map);
        char text[32];
        xkb_state_key_get_utf8(state, 38, text, sizeof(text)); assert(!strcmp(text, "a"));
        for (unsigned n = 0; n < 2; ++n) {
            if (modifiers[i]) key(state, modifiers[i], XKB_KEY_DOWN);
            key(state, triggers[i], XKB_KEY_DOWN); key(state, triggers[i], XKB_KEY_UP);
            if (modifiers[i]) key(state, modifiers[i], XKB_KEY_UP);
            assert(xkb_state_serialize_layout(state, XKB_STATE_LAYOUT_EFFECTIVE) == (n == 0 ? 1 : 0));
            xkb_state_key_get_utf8(state, 38, text, sizeof(text));
            assert(!strcmp(text, n == 0 ? "ฟ" : "a"));
        }
        xkb_state_unref(state); xkb_keymap_unref(map);
        printf("PASS: %s switches English/Thai text in both directions\n", options[i]);
    }
    xkb_context_unref(context);
}
