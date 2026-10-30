import {serviceClass} from '@dev-os/runtime/app-service';
const TerminalData = serviceClass<typeof import('./data.backend.js').TerminalData>('terminal/data.TerminalData', {});
import {Gtk, Gdk, Gio, GLib, Pango, removeTree, setImageIcon, activePalette, type SettingsValues, type VteTypes as Vte} from '@dev-os/core';
import {terminalOptions, currentTerminalScheme} from './options.js';
import {bashIntegration, QUERY_KEY, ACCEPT_KEY} from './shell-integration.js';
import {byteLength, commandSuggestions, pathPrefix, splitInput, type CommandInput, type Suggestion} from './suggestions.js';

export class TerminalCompletion {
    directory = '';
    get script() {return `${this.directory}/init.bash`;}
    private data = new TerminalData(fields => this.read(fields));
    async initialize() {this.directory = await this.data.initialize();}
    enabled = true;
    private ready = false;
    private suspended = false;
    private awaiting = false;
    private inFlight = false;
    private retry = false;
    private refreshing = false;
    private acceptWhenReady = false;
    private disposed = false;
    private timer = 0;
    private version = 0;

    readonly widget = new Gtk.Overlay({hexpand: true, vexpand: true});
    private popup: Gtk.Box;
    private list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2});
    private items: Suggestion[] = [];
    private buttons: Gtk.Button[] = [];
    private names: Gtk.Label[] = [];
    private icons: Gtk.Image[] = [];
    private details: Gtk.Label[] = [];
    private keys: Gtk.Label[] = [];
    private count = new Gtk.Label();
    private description = new Gtk.Label({xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END, max_width_chars: 32});
    private appearance = new Gtk.CssProvider();
    private appearanceClass = `completion-${GLib.uuid_string_random()}`;
    private accent = activePalette().accentFg;
    private selected = 0;
    private input?: CommandInput;
    private lastSnapshot = '';
    private commandsStamp = 0;
    private commandNames: string[] = [];
    private cancel?: Gio.Cancellable;
    private signals: number[] = [];
    private anchor?: {prefix: string; row: number; width: number; x: number};
    constructor(private terminal: Vte.Terminal) {

        this.widget.add(terminal);
        this.popup = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, halign: Gtk.Align.START, valign: Gtk.Align.START});
        this.widget.add_overlay(this.popup);
        this.popup.name = 'terminal-completions';
        this.popup.get_style_context().add_class(this.appearanceClass);
        Gtk.StyleContext.add_provider_for_screen(terminal.get_screen(), this.appearance, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 10);
        const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, margin: 6});
        const panel = new Gtk.Frame({shadow_type: Gtk.ShadowType.NONE});
        panel.get_style_context().add_class('completion-panel');
        panel.add(body);
        const header = new Gtk.Box({spacing: 8}); header.get_style_context().add_class('completion-header');
        const heading = new Gtk.Label({label: 'Suggestions', xalign: 0, hexpand: true}); heading.get_style_context().add_class('completion-heading');
        this.count.get_style_context().add_class('completion-count');
        header.pack_start(heading, true, true, 0); header.pack_start(this.count, false, false, 0);
        const footer = new Gtk.Box({spacing: 10}); footer.get_style_context().add_class('completion-footer');
        this.description.get_style_context().add_class('completion-hint');
        const hint = new Gtk.Label({label: '↑↓  Select    Esc  Close'}); hint.get_style_context().add_class('completion-hint');
        footer.pack_start(this.description, true, true, 0); footer.pack_start(hint, false, false, 0);
        body.pack_start(header, false, false, 0); body.pack_start(this.list, false, false, 0); body.pack_start(footer, false, false, 0);
        this.popup.add(panel);
        panel.show_all();
        this.configure({});
        this.signals.push(terminal.connect('focus-out-event', () => {this.dismiss(); return false;}));
        this.signals.push(terminal.connect('scroll-event', () => {this.dismiss(); return false;}));
        let lastWidth = 0, lastHeight = 0;
        this.signals.push(terminal.connect('size-allocate', () => {
            const width = terminal.get_allocated_width(), height = terminal.get_allocated_height();
            if (width !== lastWidth || height !== lastHeight) {lastWidth = width; lastHeight = height; if (this.visible) this.place();}
        }));
        this.signals.push(terminal.connect('cursor-moved', () => {if (this.items.length) this.place();}));
    }
    get visible() {return this.popup.get_visible() && this.items.length > 0;}
    configure(values: SettingsValues) {
        const options = terminalOptions(values), scheme = currentTerminalScheme();
        this.accent = scheme.accent;
        const mix = (a: string, b: string, amount: number) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount).toString(16).padStart(2, '0')).join('');
        const panel = mix(scheme.background, scheme.foreground, .035), border = mix(panel, scheme.foreground, .18);
        const muted = mix(panel, scheme.foreground, .56), selected = mix(panel, scheme.accent, .14);
        const font = this.terminal.get_font() ?? Pango.FontDescription.from_string(options.font);
        const selector = `#terminal-completions.${this.appearanceClass}`;
        this.appearance.load_from_data(new TextEncoder().encode(`
            ${selector} .completion-panel {background:${panel};color:${scheme.foreground};border-color:${border};}
            ${selector} button {color:${scheme.foreground};}
            ${selector} button.completion-selected, ${selector} button:hover {background:${selected};border-color:${selected};}
            ${selector} .completion-name {font-family:${JSON.stringify(font.get_family() ?? 'Monospace')};font-size:${font.get_size() / Pango.SCALE}${font.get_size_is_absolute() ? 'px' : 'pt'};}
            ${selector} .completion-heading {color:${scheme.foreground};}
            ${selector} .completion-count, ${selector} .completion-detail, ${selector} .completion-hint {color:${muted};}
            ${selector} image {color:${muted};}
            ${selector} .completion-selected image {color:${scheme.accent};}
            ${selector} .completion-key {color:${scheme.accent};background:${mix(panel, scheme.accent, .09)};border-color:${mix(panel, scheme.accent, .24)};}
            ${selector} .completion-footer {border-color:${border};}
        `));
    }
    private read(fields: string[]) {
        if (this.disposed) return;
        if (fields[0] === 'catalog') {this.request(); return;}
        if (fields[0] === 'busy') {this.inFlight = false; this.ready = false; this.dismiss(); return;}
        if (fields[0] === 'ready') {this.inFlight = false; this.ready = fields[2] === 'emacs'; this.suspended = false; this.dismiss(); return;}
        if (fields[0] === 'input' && this.inFlight) {
            this.inFlight = false;
            if (!this.awaiting) {if (this.retry) {this.retry = false; this.request();} return;}
        }
        if (fields[0] !== 'input' || fields.length < 6 || !this.ready || !this.enabled || this.suspended || !this.awaiting) return;
        this.awaiting = false;
        const version = ++this.version;
        this.cancel?.cancel(); this.cancel = new Gio.Cancellable();

        const commit = (next: Suggestion[]) => {
            if (this.disposed || !this.ready || version !== this.version) return;
            this.refreshing = false;
            this.show(next);
            if (this.acceptWhenReady) {this.acceptWhenReady = false; this.accept();}
        };
        void this.data.suggest(fields).then(({input, items}) => {this.input = input; commit(items); if (this.retry && !this.inFlight) {this.retry = false; this.request();}}).catch(error => {printerr(`Terminal suggestions: ${String(error)}`); commit([]);});
    }
    // Written in the background by the Bash prompt hook; never read on the keystroke path of Bash.
    private show(items: Suggestion[]) {
        const selectedLine = this.items[this.selected]?.line;
        this.items = items; this.selected = Math.max(0, items.findIndex(item => item.line === selectedLine));
        if (!items.length || !this.enabled || !this.terminal.has_focus) {this.popup.hide(); return;}
        this.count.set_text(`${items.length} matches`);
        items.forEach((item, index) => {
            if (!this.buttons[index]) {
            const button = new Gtk.Button({can_focus: false, relief: Gtk.ReliefStyle.NONE});
            const row = new Gtk.Box({spacing: 9});
            const icon = new Gtk.Image({pixel_size: 14}); this.icons.push(icon); row.pack_start(icon, false, false, 0);
            const text = new Gtk.Label({xalign: 0, ellipsize: Pango.EllipsizeMode.END, hexpand: true, max_width_chars: 38});
            text.get_style_context().add_class('completion-name');
            this.names.push(text); row.pack_start(text, true, true, 0);
            const detail = new Gtk.Label({xalign: 1}); detail.get_style_context().add_class('completion-detail');
            this.details.push(detail); row.pack_start(detail, false, false, 0);
            const key = new Gtk.Label({label: 'Tab'}); key.get_style_context().add_class('completion-key');
            this.keys.push(key); row.pack_start(key, false, false, 0); button.add(row);
            button.connect('clicked', () => this.accept(index)); this.list.pack_start(button, false, false, 0);
            this.buttons.push(button); button.show_all();
            }
            const text = this.names[index];
            const before = this.input ? splitInput(this.input)[0] : '';
            const prefix = item.kind === 'history' ? before : before.match(/[^\s]*$/)?.[0] ?? '';
            const escape = (value: string) => GLib.markup_escape_text(value, -1);
            if (prefix && item.label.startsWith(prefix)) text.set_markup(`<span foreground="${this.accent}" weight="bold">${escape(prefix)}</span>${escape(item.label.slice(prefix.length))}`);
            else text.set_text(item.label);
            setImageIcon(this.icons[index], item.kind === 'history' ? 'document-open-recent-symbolic' : item.kind === 'folder' ? 'folder-symbolic' : 'utilities-terminal-symbolic', Gtk.IconSize.MENU);
            this.details[index].set_text({command: 'cmd', history: 'recent', argument: 'arg', folder: 'dir', file: 'file'}[item.kind]);
            this.buttons[index].tooltip_text = item.detail;
        });
        this.buttons.forEach((button, index) => button.set_visible(index < items.length));
        this.highlight();
        this.place();
    }
    private place() {
        if (this.refreshing && this.visible) return;
        const [column, row] = this.terminal.get_cursor_position(), adjustment = this.terminal.get_vadjustment();
        const rectangle = new Gdk.Rectangle();
        const width = Math.max(260, Math.min(400, this.terminal.get_allocated_width() - 32));
        const before = this.input ? splitInput(this.input)[0] : '';
        const token = before.match(/[^\s]*$/)?.[0] ?? '';
        const tokenWidth = [...token].reduce((cells, char) => cells + (GLib.unichar_iswide(char) ? 2 : 1), 0);
        rectangle.x = Math.max(0, Math.min(this.terminal.get_allocated_width() - width, (column - tokenWidth) * this.terminal.get_char_width()));
        const prefix = before.slice(0, before.length - token.length), terminalWidth = this.terminal.get_allocated_width();
        // Readline briefly moves its cursor to column zero while repainting.
        // Locate the rendered word before committing an anchor, so a transient
        // cursor position cannot pin the panel to the left edge.
        if (token) {
            const rendered = (this.terminal.get_text_range_format(1, row, 0, row, this.terminal.get_column_count())[0] ?? '').replace(/\n$/, '');
            const atEnd = rendered.trimEnd(), atCursor = rendered.slice(0, column).trimEnd();
            const visibleBefore = atEnd.endsWith(token) ? atEnd : atCursor;
            if (visibleBefore.endsWith(token)) {
                const cells = [...visibleBefore.slice(0, -token.length)].reduce((sum, char) => sum + (GLib.unichar_iswide(char) ? 2 : 1), 0);
                rectangle.x = Math.max(0, Math.min(terminalWidth - width, cells * this.terminal.get_char_width()));
                this.anchor = {prefix, row, width: terminalWidth, x: rectangle.x};
            } else if (this.anchor?.prefix === prefix && this.anchor.width === terminalWidth) rectangle.x = this.anchor.x;
            else return;
        } else this.anchor = {prefix, row, width: terminalWidth, x: rectangle.x};
        rectangle.y = Math.max(0, (row - adjustment.get_value()) * this.terminal.get_char_height());
        rectangle.width = width; rectangle.height = this.terminal.get_char_height();
        this.popup.set_size_request(width, -1);
        this.popup.show();
        const height = this.popup.get_preferred_height()[1] - this.popup.get_margin_top() - this.popup.get_margin_bottom();
        const available = this.terminal.get_allocated_height();
        const below = rectangle.y + rectangle.height + 4;
        this.popup.set_margin_start(rectangle.x);
        this.popup.set_margin_top(Math.max(0, below + height <= available ? below : rectangle.y - height - 4));
    }
    private highlight() {
        this.buttons.forEach((button, i) => {button.get_style_context()[i === this.selected ? 'add_class' : 'remove_class']('completion-selected'); this.keys[i].set_opacity(i === this.selected ? 1 : 0);});
        const item = this.items[this.selected];
        this.description.set_text(item?.kind === 'command' ? 'Installed command' : item?.detail ?? '');
    }
    accept(index = this.selected) {
        const item = this.items[index], input = this.input;
        if (!item || !input || !this.ready || !this.enabled) return;
        if (this.refreshing) {this.acceptWhenReady = true; return;}
        this.dismiss();
        void this.data.accept(input, item).then(() => {if (!this.disposed) {this.terminal.feed_child(ACCEPT_KEY); this.terminal.grab_focus();}}).catch(() => {});
    }
    dismiss() {
        this.invalidate(); this.refreshing = false; this.acceptWhenReady = false; this.anchor = undefined;
        this.items = []; this.popup.hide();
    }
    private invalidate() {
        this.version++; this.awaiting = false; this.retry = false; this.cancel?.cancel();
        if (this.timer) {GLib.source_remove(this.timer); this.timer = 0;}
    }
    request() {
        if (!this.enabled || !this.ready || this.disposed || this.suspended) return;
        if (this.inFlight) {this.retry = true; return;}
        this.lastSnapshot = '';
        if (this.timer) GLib.source_remove(this.timer);
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 110, () => {
            this.timer = 0;
            if (this.ready && this.enabled && !this.suspended && this.terminal.has_focus) {this.inFlight = true; this.awaiting = true; void this.data.beginQuery().then(() => {if (!this.disposed && this.ready && this.terminal.has_focus) this.terminal.feed_child(QUERY_KEY); else {this.inFlight = false; this.awaiting = false;}}).catch(() => {this.inFlight = false; this.awaiting = false;});}
            return GLib.SOURCE_REMOVE;
        });
    }
    key(event: Gdk.Event): boolean {
        const key = event.get_keyval()[1], modifiers = event.get_state()[1];
        if ([Gdk.KEY_Shift_L, Gdk.KEY_Shift_R, Gdk.KEY_Control_L, Gdk.KEY_Control_R, Gdk.KEY_Alt_L, Gdk.KEY_Alt_R, Gdk.KEY_Super_L, Gdk.KEY_Super_R].includes(key)) return false;
        const control = modifiers & Gdk.ModifierType.CONTROL_MASK, alt = modifiers & Gdk.ModifierType.MOD1_MASK;
        if (control && key === Gdk.KEY_space) {this.suspended = false; this.request(); return this.enabled && this.ready;}
        if (this.visible && !control && !alt) {
            if ([Gdk.KEY_Up, Gdk.KEY_Down].includes(key)) {this.selected = (this.selected + (key === Gdk.KEY_Down ? 1 : this.items.length - 1)) % this.items.length; this.highlight(); return true;}
            if (key === Gdk.KEY_Tab && !(modifiers & Gdk.ModifierType.SHIFT_MASK)) {this.accept(); return true;}
            if (key === Gdk.KEY_Escape) {this.dismiss(); return true;}
        }
        if ([Gdk.KEY_Return, Gdk.KEY_KP_Enter].includes(key)) {this.ready = false; this.dismiss(); return false;}
        const editing = !control && !alt && (Gdk.keyval_to_unicode(key) >= 32 || [Gdk.KEY_BackSpace, Gdk.KEY_Delete, Gdk.KEY_Left, Gdk.KEY_Right, Gdk.KEY_Home, Gdk.KEY_End].includes(key));
        if (editing) {this.invalidate(); this.refreshing = true; this.request(); return false;}
        this.dismiss();
        if (control && [Gdk.KEY_r, Gdk.KEY_s, Gdk.KEY_x].includes(key) && !(modifiers & Gdk.ModifierType.SHIFT_MASK)) this.suspended = true;
        if (alt) this.suspended = true;
        if (key === Gdk.KEY_Escape) this.suspended = false;
        if (!control && !alt && (Gdk.keyval_to_unicode(key) >= 32 || [Gdk.KEY_BackSpace, Gdk.KEY_Delete, Gdk.KEY_Left, Gdk.KEY_Right, Gdk.KEY_Home, Gdk.KEY_End, Gdk.KEY_Up, Gdk.KEY_Down].includes(key))) this.request();
        return false;
    }
    destroy() {
        this.disposed = true; this.dismiss(); this.data.destroy();
        for (const signal of this.signals) this.terminal.disconnect(signal);
        this.popup.destroy();
        Gtk.StyleContext.remove_provider_for_screen(this.terminal.get_screen(), this.appearance);
        this.widget.remove(this.terminal); this.widget.destroy();
    }
}
