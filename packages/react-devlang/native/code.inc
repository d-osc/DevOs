/* The code view: the editor widget of the native Editor (included by gtk.c). A GtkTextView in a scrolled window with a line-number gutter, an undo stack,
 * tab/enter handling and tags the DevLang side fills in (syntax colors, find marks). The text and the colors are set from DevLang through the rd_code_* calls;
 * what happens in the view comes back as kind-6 events on the widget: "change", "cursor:LINE:COL", and the shortcuts "save", "find", "replace", "new", "open",
 * "escape". Offsets crossing the boundary are UTF-8 byte offsets, as DevLang texts are bytes. */
typedef struct { gint offset, chars; char *text; gboolean insert; gint64 time; guint group; } RdUndo;
typedef struct {
    RdRoot *root; GtkWidget *scroll, *view; GtkTextBuffer *buffer; GPtrArray *undo, *redo; gboolean quiet, replaying; int tab; guint group;
    GdkRGBA gutter_bg, gutter_fg, gutter_current; GtkCssProvider *css; GtkTextTag *line_tag; gint line_count; gint last_line, last_col;
} RdCode;
static void rd_undo_free(gpointer item) { RdUndo *u = item; g_free(u->text); g_free(u); }
static RdCode *rd_code_of(void *widget) { return g_object_get_data(G_OBJECT(widget), "rd-code"); }
static void rd_code_signal(RdCode *c, const char *text) { rd_emit(c->root, 6, c->scroll, text); }

static void rd_code_record(RdCode *c, gboolean insert, gint offset, const char *text) {
    if (c->quiet || c->replaying) return;
    gint chars = (gint)g_utf8_strlen(text, -1); gint64 now = g_get_monotonic_time();
    RdUndo *last = c->undo->len ? g_ptr_array_index(c->undo, c->undo->len - 1) : NULL;
    g_ptr_array_set_size(c->redo, 0);
    if (last && last->group == 0 && c->group == 0 && last->insert == insert && chars == 1 && last->chars < 80 && now - last->time < 1000000 && text[0] != '\n') {
        if (insert && offset == last->offset + last->chars) { char *joined = g_strconcat(last->text, text, NULL); g_free(last->text); last->text = joined; last->chars += chars; last->time = now; return; }
        if (!insert && offset + chars == last->offset) { char *joined = g_strconcat(text, last->text, NULL); g_free(last->text); last->text = joined; last->offset = offset; last->chars += chars; last->time = now; return; }
        if (!insert && offset == last->offset) { char *joined = g_strconcat(last->text, text, NULL); g_free(last->text); last->text = joined; last->chars += chars; last->time = now; return; }
    }
    RdUndo *u = g_new0(RdUndo, 1); u->insert = insert; u->offset = offset; u->chars = chars; u->text = g_strdup(text); u->time = now; u->group = c->group;
    g_ptr_array_add(c->undo, u);
}
static void rd_code_insert_before(GtkTextBuffer *buffer, GtkTextIter *at, gchar *text, gint length, gpointer data) {
    (void)buffer; char *copy = g_strndup(text, length); rd_code_record(data, TRUE, gtk_text_iter_get_offset(at), copy); g_free(copy);
}
static void rd_code_delete_before(GtkTextBuffer *buffer, GtkTextIter *start, GtkTextIter *end, gpointer data) {
    RdCode *c = data; if (c->quiet || c->replaying) return;
    char *text = gtk_text_buffer_get_text(buffer, start, end, TRUE); rd_code_record(c, FALSE, gtk_text_iter_get_offset(start), text); g_free(text);
}
static void rd_code_step(RdCode *c, gboolean undo) {
    GPtrArray *from = undo ? c->undo : c->redo, *to = undo ? c->redo : c->undo;
    if (!from->len) return;
    guint group = ((RdUndo *)g_ptr_array_index(from, from->len - 1))->group; GtkTextIter a, b; gint place = 0;
    c->replaying = TRUE;
    do {
        RdUndo *u = g_ptr_array_steal_index(from, from->len - 1);
        gboolean remove = undo ? u->insert : !u->insert;   /* undoing an insert deletes it; redoing a delete deletes it again */
        if (remove) { gtk_text_buffer_get_iter_at_offset(c->buffer, &a, u->offset); gtk_text_buffer_get_iter_at_offset(c->buffer, &b, u->offset + u->chars); gtk_text_buffer_delete(c->buffer, &a, &b); place = u->offset; }
        else { gtk_text_buffer_get_iter_at_offset(c->buffer, &a, u->offset); gtk_text_buffer_insert(c->buffer, &a, u->text, -1); place = u->offset + u->chars; }
        g_ptr_array_add(to, u);
    } while (group != 0 && from->len && ((RdUndo *)g_ptr_array_index(from, from->len - 1))->group == group);
    c->replaying = FALSE;
    gtk_text_buffer_get_iter_at_offset(c->buffer, &a, place); gtk_text_buffer_place_cursor(c->buffer, &a);
    gtk_text_view_scroll_mark_onscreen(GTK_TEXT_VIEW(c->view), gtk_text_buffer_get_insert(c->buffer));
}
void rd_code_undo(void *widget) { RdCode *c = rd_code_of(widget); if (c) rd_code_step(c, TRUE); }
void rd_code_redo(void *widget) { RdCode *c = rd_code_of(widget); if (c) rd_code_step(c, FALSE); }
/* Edits made between begin and end undo as one step (replace all). */
void rd_code_group(void *widget, int32_t begin) { RdCode *c = rd_code_of(widget); static guint next = 0; if (c) c->group = begin ? ++next : 0; }

static void rd_code_resize_gutter(RdCode *c) {
    gint lines = gtk_text_buffer_get_line_count(c->buffer), digits = 2, n = lines;
    while (n >= 100) { digits++; n /= 10; }
    PangoLayout *layout = gtk_widget_create_pango_layout(c->view, "0"); gint w = 0, h = 0; pango_layout_get_pixel_size(layout, &w, &h); g_object_unref(layout);
    gtk_text_view_set_border_window_size(GTK_TEXT_VIEW(c->view), GTK_TEXT_WINDOW_LEFT, digits * w + 26);
    c->line_count = lines;
}
static gboolean rd_code_gutter(GtkWidget *view, cairo_t *cr, gpointer data) {
    RdCode *c = data; GtkTextView *text = GTK_TEXT_VIEW(view); GdkWindow *window = gtk_text_view_get_window(text, GTK_TEXT_WINDOW_LEFT);
    if (!window || !gtk_cairo_should_draw_window(cr, window)) return FALSE;
    gint width = gdk_window_get_width(window), height = gdk_window_get_height(window), x0 = 0, y0 = 0; GtkTextIter cursor, iter;
    gdk_cairo_set_source_rgba(cr, &c->gutter_bg); cairo_rectangle(cr, 0, 0, width, height); cairo_fill(cr);
    gtk_text_buffer_get_iter_at_mark(c->buffer, &cursor, gtk_text_buffer_get_insert(c->buffer)); gint current = gtk_text_iter_get_line(&cursor);
    gtk_text_view_window_to_buffer_coords(text, GTK_TEXT_WINDOW_LEFT, 0, 0, &x0, &y0);
    gtk_text_view_get_line_at_y(text, &iter, y0, NULL);
    PangoLayout *layout = gtk_widget_create_pango_layout(view, ""); pango_layout_set_alignment(layout, PANGO_ALIGN_RIGHT); pango_layout_set_width(layout, (width - 14) * PANGO_SCALE);
    for (;;) {
        gint y = 0, h = 0, line = gtk_text_iter_get_line(&iter), wx = 0, wy = 0; char number[16];
        gtk_text_view_get_line_yrange(text, &iter, &y, &h);
        gtk_text_view_buffer_to_window_coords(text, GTK_TEXT_WINDOW_LEFT, 0, y, &wx, &wy);
        if (wy > height) break;
        g_snprintf(number, sizeof number, "%d", line + 1); pango_layout_set_text(layout, number, -1);
        gdk_cairo_set_source_rgba(cr, line == current ? &c->gutter_current : &c->gutter_fg);
        cairo_move_to(cr, 0, wy); pango_cairo_show_layout(cr, layout);
        if (!gtk_text_iter_forward_line(&iter)) break;
    }
    g_object_unref(layout);
    return FALSE;
}
static void rd_code_cursor_moved(RdCode *c) {
    GtkTextIter at, from, to; gtk_text_buffer_get_iter_at_mark(c->buffer, &at, gtk_text_buffer_get_insert(c->buffer));
    gint line = gtk_text_iter_get_line(&at), col = gtk_text_iter_get_line_offset(&at);
    if (c->line_tag) {
        gtk_text_buffer_get_bounds(c->buffer, &from, &to); gtk_text_buffer_remove_tag(c->buffer, c->line_tag, &from, &to);
        if (!gtk_text_buffer_get_has_selection(c->buffer)) { from = at; gtk_text_iter_set_line_offset(&from, 0); to = from; if (!gtk_text_iter_ends_line(&to)) gtk_text_iter_forward_to_line_end(&to); gtk_text_buffer_apply_tag(c->buffer, c->line_tag, &from, &to); }
    }
    gtk_widget_queue_draw(c->view);
    if (line != c->last_line || col != c->last_col) { char text[48]; c->last_line = line; c->last_col = col; g_snprintf(text, sizeof text, "cursor:%d:%d", line + 1, col + 1); rd_code_signal(c, text); }
}
static void rd_code_changed(GtkTextBuffer *buffer, gpointer data) {
    (void)buffer; RdCode *c = data; if (gtk_text_buffer_get_line_count(c->buffer) != c->line_count) rd_code_resize_gutter(c);
    if (!c->quiet) rd_code_signal(c, "change");
}
static void rd_code_mark(GtkTextBuffer *buffer, GtkTextIter *location, GtkTextMark *mark, gpointer data) { (void)buffer; (void)location; if (mark == gtk_text_buffer_get_insert(buffer)) rd_code_cursor_moved(data); }
static void rd_code_insert_spaces(RdCode *c, GtkTextIter *at) {
    gint col = gtk_text_iter_get_line_offset(at), count = c->tab - col % c->tab; char spaces[17] = "                "; gtk_text_buffer_insert(c->buffer, at, spaces, count > 16 ? 16 : count);
}
/* Indent or unindent the lines the selection touches (or the cursor's line). */
static void rd_code_shift_lines(RdCode *c, gboolean outdent) {
    GtkTextIter a, b; gtk_text_buffer_get_selection_bounds(c->buffer, &a, &b);
    gint first = gtk_text_iter_get_line(&a), last = gtk_text_iter_get_line(&b); if (last > first && gtk_text_iter_starts_line(&b)) last--;
    rd_code_group(c->scroll, 1);
    for (gint line = first; line <= last; line++) {
        GtkTextIter start, end; gtk_text_buffer_get_iter_at_line(c->buffer, &start, line);
        if (!outdent) { if (!gtk_text_iter_ends_line(&start)) { char spaces[17] = "                "; gtk_text_buffer_insert(c->buffer, &start, spaces, c->tab > 16 ? 16 : c->tab); } continue; }
        end = start; gint removed = 0;
        while (removed < c->tab && (gtk_text_iter_get_char(&end) == ' ' || (gtk_text_iter_get_char(&end) == '\t' && removed == 0))) { gboolean tab = gtk_text_iter_get_char(&end) == '\t'; gtk_text_iter_forward_char(&end); removed++; if (tab) break; }
        if (removed) gtk_text_buffer_delete(c->buffer, &start, &end);
    }
    rd_code_group(c->scroll, 0);
}
static gboolean rd_code_key(GtkWidget *view, GdkEventKey *event, gpointer data) {
    RdCode *c = data; (void)view; guint mods = event->state & gtk_accelerator_get_default_mod_mask(), key = gdk_keyval_to_lower(event->keyval);
    if (mods & GDK_CONTROL_MASK) {
        gboolean shift = (mods & GDK_SHIFT_MASK) != 0;
        if (key == GDK_KEY_z) { if (shift) rd_code_step(c, FALSE); else rd_code_step(c, TRUE); return TRUE; }
        if (key == GDK_KEY_y) { rd_code_step(c, FALSE); return TRUE; }
        if (key == GDK_KEY_s) { rd_code_signal(c, "save"); return TRUE; }
        if (key == GDK_KEY_f) { rd_code_signal(c, "find"); return TRUE; }
        if (key == GDK_KEY_h) { rd_code_signal(c, "replace"); return TRUE; }
        if (key == GDK_KEY_n) { rd_code_signal(c, "new"); return TRUE; }
        if (key == GDK_KEY_o) { rd_code_signal(c, "open"); return TRUE; }
        if (key == GDK_KEY_g) { rd_code_signal(c, "next"); return TRUE; }
        return FALSE;
    }
    if (mods & GDK_MOD1_MASK) return FALSE;
    if (key == GDK_KEY_Escape) { rd_code_signal(c, "escape"); return FALSE; }
    if (key == GDK_KEY_F3) { rd_code_signal(c, (mods & GDK_SHIFT_MASK) ? "previous" : "next"); return TRUE; }
    if (key == GDK_KEY_Tab || key == GDK_KEY_ISO_Left_Tab) {
        gboolean outdent = key == GDK_KEY_ISO_Left_Tab || (mods & GDK_SHIFT_MASK); GtkTextIter a, b;
        if (gtk_text_buffer_get_selection_bounds(c->buffer, &a, &b) && gtk_text_iter_get_line(&a) != gtk_text_iter_get_line(&b)) { rd_code_shift_lines(c, outdent); return TRUE; }
        if (outdent) { rd_code_shift_lines(c, TRUE); return TRUE; }
        gtk_text_buffer_delete_selection(c->buffer, TRUE, TRUE); gtk_text_buffer_get_iter_at_mark(c->buffer, &a, gtk_text_buffer_get_insert(c->buffer)); rd_code_insert_spaces(c, &a);
        return TRUE;
    }
    if (key == GDK_KEY_Return || key == GDK_KEY_KP_Enter) {
        GtkTextIter at, start, probe; gtk_text_buffer_delete_selection(c->buffer, TRUE, TRUE);
        gtk_text_buffer_get_iter_at_mark(c->buffer, &at, gtk_text_buffer_get_insert(c->buffer)); start = at; gtk_text_iter_set_line_offset(&start, 0);
        GString *indent = g_string_new("\n"); probe = start;
        while (gtk_text_iter_compare(&probe, &at) < 0 && (gtk_text_iter_get_char(&probe) == ' ' || gtk_text_iter_get_char(&probe) == '\t')) { g_string_append_unichar(indent, gtk_text_iter_get_char(&probe)); gtk_text_iter_forward_char(&probe); }
        probe = at; gboolean opens = FALSE;
        if (gtk_text_iter_backward_char(&probe)) { gunichar ch = gtk_text_iter_get_char(&probe); opens = ch == '{' || ch == '(' || ch == '['; }
        if (opens) for (int i = 0; i < c->tab; i++) g_string_append_c(indent, ' ');
        rd_code_group(c->scroll, 1); gtk_text_buffer_insert(c->buffer, &at, indent->str, -1); rd_code_group(c->scroll, 0);
        g_string_free(indent, TRUE); gtk_text_view_scroll_mark_onscreen(GTK_TEXT_VIEW(c->view), gtk_text_buffer_get_insert(c->buffer));
        return TRUE;
    }
    return FALSE;
}
static void rd_code_destroyed(GtkWidget *widget, gpointer data) {
    (void)widget; RdCode *c = data; g_ptr_array_free(c->undo, TRUE); g_ptr_array_free(c->redo, TRUE); if (c->css) { gtk_style_context_remove_provider_for_screen(gdk_screen_get_default(), GTK_STYLE_PROVIDER(c->css)); g_clear_object(&c->css); } g_free(c);
}
void *rd_code_new(void *root) {
    RdCode *c = g_new0(RdCode, 1); c->root = root; c->tab = 4; c->last_line = -1;
    c->undo = g_ptr_array_new_with_free_func(rd_undo_free); c->redo = g_ptr_array_new_with_free_func(rd_undo_free);
    c->scroll = gtk_scrolled_window_new(NULL, NULL); gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(c->scroll), GTK_POLICY_AUTOMATIC, GTK_POLICY_AUTOMATIC);
    c->view = gtk_text_view_new(); c->buffer = gtk_text_view_get_buffer(GTK_TEXT_VIEW(c->view));
    gtk_text_view_set_wrap_mode(GTK_TEXT_VIEW(c->view), GTK_WRAP_NONE); gtk_text_view_set_monospace(GTK_TEXT_VIEW(c->view), TRUE);
    gtk_text_view_set_left_margin(GTK_TEXT_VIEW(c->view), 10); gtk_text_view_set_top_margin(GTK_TEXT_VIEW(c->view), 6); gtk_text_view_set_bottom_margin(GTK_TEXT_VIEW(c->view), 6);
    gtk_text_view_set_border_window_size(GTK_TEXT_VIEW(c->view), GTK_TEXT_WINDOW_LEFT, 40);
    gtk_container_add(GTK_CONTAINER(c->scroll), c->view);
    gdk_rgba_parse(&c->gutter_bg, "#00000000"); gdk_rgba_parse(&c->gutter_fg, "#888888"); gdk_rgba_parse(&c->gutter_current, "#cccccc");
    c->css = gtk_css_provider_new(); gtk_style_context_add_class(gtk_widget_get_style_context(c->view), "rd-code");
    gtk_style_context_add_provider_for_screen(gdk_screen_get_default(), GTK_STYLE_PROVIDER(c->css), GTK_STYLE_PROVIDER_PRIORITY_USER + 2);
    g_object_set_data(G_OBJECT(c->scroll), "rd-code", c); g_object_set_data(G_OBJECT(c->scroll), "rd-code-view", c->view);
    g_signal_connect(c->buffer, "insert-text", G_CALLBACK(rd_code_insert_before), c); g_signal_connect(c->buffer, "delete-range", G_CALLBACK(rd_code_delete_before), c);
    g_signal_connect(c->buffer, "changed", G_CALLBACK(rd_code_changed), c); g_signal_connect(c->buffer, "mark-set", G_CALLBACK(rd_code_mark), c);
    g_signal_connect(c->view, "key-press-event", G_CALLBACK(rd_code_key), c); g_signal_connect_after(c->view, "draw", G_CALLBACK(rd_code_gutter), c);
    g_signal_connect(c->scroll, "destroy", G_CALLBACK(rd_code_destroyed), c);
    gtk_widget_show_all(c->scroll);
    return c->scroll;
}
/* Replaces the whole text without a "change" event and forgets the undo history; `tab` is the tab width in spaces. */
void rd_code_set(void *widget, const char *text, int32_t tab) {
    RdCode *c = rd_code_of(widget); if (!c) return; GtkTextIter a, b;
    c->quiet = TRUE; c->tab = tab > 0 && tab <= 16 ? tab : 4; g_ptr_array_set_size(c->undo, 0); g_ptr_array_set_size(c->redo, 0);
    gtk_text_buffer_set_text(c->buffer, text, -1); gtk_text_buffer_get_start_iter(c->buffer, &a); gtk_text_buffer_place_cursor(c->buffer, &a); gtk_text_buffer_get_end_iter(c->buffer, &b);
    PangoLayout *layout = gtk_widget_create_pango_layout(c->view, " "); gint w = 0, h = 0; pango_layout_get_pixel_size(layout, &w, &h); g_object_unref(layout);
    PangoTabArray *tabs = pango_tab_array_new(1, TRUE); pango_tab_array_set_tab(tabs, 0, PANGO_TAB_LEFT, w * c->tab); gtk_text_view_set_tabs(GTK_TEXT_VIEW(c->view), tabs); pango_tab_array_free(tabs);
    c->quiet = FALSE; rd_code_resize_gutter(c); c->last_line = -1; rd_code_cursor_moved(c);
}
/* The whole text as a new string (free it with rd_buffer_free). */
char *rd_code_get(void *widget) {
    RdCode *c = rd_code_of(widget); GtkTextIter a, b; if (!c) return g_strdup("");
    gtk_text_buffer_get_bounds(c->buffer, &a, &b); return gtk_text_buffer_get_text(c->buffer, &a, &b, TRUE);
}
/* Replaces the whole text as one undoable step (replace all), keeping the cursor near where it was. */
void rd_code_replace_all(void *widget, const char *text) {
    RdCode *c = rd_code_of(widget); if (!c) return; GtkTextIter a, b; gint cursor;
    gtk_text_buffer_get_iter_at_mark(c->buffer, &a, gtk_text_buffer_get_insert(c->buffer)); cursor = gtk_text_iter_get_offset(&a);
    rd_code_group(widget, 1); gtk_text_buffer_get_bounds(c->buffer, &a, &b); gtk_text_buffer_delete(c->buffer, &a, &b);
    gtk_text_buffer_get_start_iter(c->buffer, &a); gtk_text_buffer_insert(c->buffer, &a, text, -1); rd_code_group(widget, 0);
    gtk_text_buffer_get_iter_at_offset(c->buffer, &a, MIN(cursor, gtk_text_buffer_get_char_count(c->buffer))); gtk_text_buffer_place_cursor(c->buffer, &a);
}
static void rd_code_tag_clear(GtkTextTag *tag, gpointer data) {
    gpointer *pair = data; gchar *name = NULL; g_object_get(tag, "name", &name, NULL);
    if (name && g_str_has_prefix(name, pair[1])) gtk_text_buffer_remove_tag(pair[0], tag, pair[2], pair[3]);
    g_free(name);
}
static GtkTextTag *rd_code_tag(RdCode *c, const char *name) {
    GtkTextTagTable *table = gtk_text_buffer_get_tag_table(c->buffer); GtkTextTag *tag = gtk_text_tag_table_lookup(table, name);
    return tag ? tag : gtk_text_buffer_create_tag(c->buffer, name, NULL);
}
/* "name #rrggbb flags" per line: flags are letters i (italic), b (bold), u (underline), s (strikethrough), g (background instead of foreground).
 * The names bg, fg, caret, selection, gutter, gutterfg, gutterfgcur, cursorline set the view's own colors. */
void rd_code_palette(void *widget, const char *spec) {
    RdCode *c = rd_code_of(widget); if (!c) return; gchar **lines = g_strsplit(spec, "\n", -1);
    GString *css = g_string_new(""); const char *bg = NULL, *fg = NULL, *caret = NULL, *selection = NULL; gchar *keep[8] = { 0 };
    for (gchar **line = lines; *line; line++) {
        /* "name color flags": the color is one word (#rrggbb) or a call with spaces inside, rgba(r, g, b, a), which ends at its closing parenthesis */
        gchar *space = strchr(*line, ' '); if (!space) continue;
        gchar *name_text = g_strndup(*line, (gsize)(space - *line)), *rest = space + 1, *close = strchr(rest, ')'), *stop = close ? close + 1 : strchr(rest, ' ');
        gchar *color_text = stop ? g_strndup(rest, (gsize)(stop - rest)) : g_strdup(rest), *flags_text = stop ? g_strstrip(g_strdup(stop)) : g_strdup("");
        const char *name = name_text, *color = color_text, *flags = flags_text; GdkRGBA rgba;
        if (!gdk_rgba_parse(&rgba, color)) { g_free(name_text); g_free(color_text); g_free(flags_text); continue; }
        if (!strcmp(name, "bg")) { g_free(keep[0]); keep[0] = g_strdup(color); bg = keep[0]; }
        else if (!strcmp(name, "fg")) { g_free(keep[1]); keep[1] = g_strdup(color); fg = keep[1]; }
        else if (!strcmp(name, "caret")) { g_free(keep[2]); keep[2] = g_strdup(color); caret = keep[2]; }
        else if (!strcmp(name, "selection")) { g_free(keep[3]); keep[3] = g_strdup(color); selection = keep[3]; }
        else if (!strcmp(name, "gutter")) c->gutter_bg = rgba;
        else if (!strcmp(name, "gutterfg")) c->gutter_fg = rgba;
        else if (!strcmp(name, "gutterfgcur")) c->gutter_current = rgba;
        else if (!strcmp(name, "cursorline")) { c->line_tag = rd_code_tag(c, "rd.cursorline"); g_object_set(c->line_tag, "paragraph-background-rgba", &rgba, NULL); }
        else {
            GtkTextTag *tag = rd_code_tag(c, name);
            if (strchr(flags, 'g')) g_object_set(tag, "background-rgba", &rgba, "foreground-set", FALSE, NULL); else g_object_set(tag, "foreground-rgba", &rgba, NULL);
            g_object_set(tag, "style", strchr(flags, 'i') ? PANGO_STYLE_ITALIC : PANGO_STYLE_NORMAL, "weight", strchr(flags, 'b') ? PANGO_WEIGHT_BOLD : PANGO_WEIGHT_NORMAL,
                "underline", strchr(flags, 'u') ? PANGO_UNDERLINE_SINGLE : PANGO_UNDERLINE_NONE, "strikethrough", strchr(flags, 's') ? TRUE : FALSE, NULL);
        }
        g_free(name_text); g_free(color_text); g_free(flags_text);
    }
    if (bg || fg || selection) {
        g_string_append(css, "textview.rd-code, textview.rd-code text { font-family: monospace; font-size: 13px;");
        if (bg) g_string_append_printf(css, " background-color: %s;", bg);
        if (fg) g_string_append_printf(css, " color: %s;", fg);
        g_string_append(css, " }");
        if (selection) g_string_append_printf(css, " textview.rd-code text selection, textview.rd-code selection { background-color: %s; }", selection);
        if (caret) g_string_append_printf(css, " textview.rd-code { caret-color: %s; }", caret);
        gtk_css_provider_load_from_data(c->css, css->str, -1, NULL);
    }
    for (int i = 0; i < 8; i++) g_free(keep[i]);
    g_string_free(css, TRUE); g_strfreev(lines); gtk_widget_queue_draw(c->view);
}
/* Clears every tag whose name starts with `prefix`, then applies the lines "tag startByte endByte" (ascending start). */
void rd_code_apply(void *widget, const char *prefix, const char *spec) {
    RdCode *c = rd_code_of(widget); if (!c) return; GtkTextIter a, b; gtk_text_buffer_get_bounds(c->buffer, &a, &b);
    gpointer pair[4] = { c->buffer, (gpointer)prefix, &a, &b }; gtk_text_tag_table_foreach(gtk_text_buffer_get_tag_table(c->buffer), rd_code_tag_clear, pair);
    char *text = gtk_text_buffer_get_text(c->buffer, &a, &b, TRUE); const char *scan = text; gint chars = 0; gsize at = 0; gsize length = strlen(text);
    const char *p = spec;
    while (*p) {
        const char *eol = strchr(p, '\n'); gsize span = eol ? (gsize)(eol - p) : strlen(p); char *line = g_strndup(p, span); p += span + (eol ? 1 : 0);
        char name[96]; unsigned long s = 0, e = 0;
        if (sscanf(line, "%95s %lu %lu", name, &s, &e) == 3 && e > s && e <= length) {
            if (s < at) { scan = text; chars = 0; at = 0; }
            chars += (gint)g_utf8_pointer_to_offset(scan, text + s); scan = text + s; at = s;
            gint len = (gint)g_utf8_pointer_to_offset(text + s, text + e); GtkTextIter from, to;
            gtk_text_buffer_get_iter_at_offset(c->buffer, &from, chars); gtk_text_buffer_get_iter_at_offset(c->buffer, &to, chars + len);
            GtkTextTag *tag = gtk_text_tag_table_lookup(gtk_text_buffer_get_tag_table(c->buffer), name); if (tag) gtk_text_buffer_apply_tag(c->buffer, tag, &from, &to);
        }
        g_free(line);
    }
    g_free(text);
}
static void rd_code_iter_at_byte(RdCode *c, GtkTextIter *iter, gint64 byte) {
    GtkTextIter a, b; gtk_text_buffer_get_bounds(c->buffer, &a, &b); char *text = gtk_text_buffer_get_text(c->buffer, &a, &b, TRUE);
    gsize length = strlen(text); if (byte < 0) byte = 0; if ((gsize)byte > length) byte = (gint64)length;
    gtk_text_buffer_get_iter_at_offset(c->buffer, iter, (gint)g_utf8_pointer_to_offset(text, text + byte)); g_free(text);
}
/* Selects [start, end) (byte offsets) and scrolls it into view; start == end just moves the cursor. */
void rd_code_select(void *widget, int64_t start, int64_t end) {
    RdCode *c = rd_code_of(widget); if (!c) return; GtkTextIter a, b; rd_code_iter_at_byte(c, &a, start); rd_code_iter_at_byte(c, &b, end);
    gtk_text_buffer_select_range(c->buffer, &b, &a); gtk_text_view_scroll_to_iter(GTK_TEXT_VIEW(c->view), &a, 0.1, TRUE, 0.0, 0.3);
}
/* The cursor as a byte offset; with `end` nonzero the other end of the selection. */
int64_t rd_code_cursor(void *widget, int32_t end) {
    RdCode *c = rd_code_of(widget); if (!c) return 0; GtkTextIter a, b, from; gtk_text_buffer_get_selection_bounds(c->buffer, &a, &b);
    gtk_text_buffer_get_start_iter(c->buffer, &from); char *text = gtk_text_buffer_get_text(c->buffer, &from, end ? &b : &a, TRUE); int64_t n = (int64_t)strlen(text); g_free(text); return n;
}
/* The selected text (free it with rd_buffer_free). */
char *rd_code_selection(void *widget) {
    RdCode *c = rd_code_of(widget); GtkTextIter a, b; if (!c || !gtk_text_buffer_get_selection_bounds(c->buffer, &a, &b)) return g_strdup("");
    return gtk_text_buffer_get_text(c->buffer, &a, &b, TRUE);
}
void rd_code_focus(void *widget) { RdCode *c = rd_code_of(widget); if (c) gtk_widget_grab_focus(c->view); }
void rd_code_editable(void *widget, int32_t editable) { RdCode *c = rd_code_of(widget); if (c) gtk_text_view_set_editable(GTK_TEXT_VIEW(c->view), editable != 0); }
