import Gtk from 'gi://Gtk?version=3.0';
import GLib from 'gi://GLib';
import {React, Scale, createRoot, Box, Label, Button, Entry, useState,
    useLayoutEffect, useEffect, createContext, useContext, Image, ScrolledWindow} from '@dev-os/react-gtk';

Gtk.init(null);
let passed = 0;
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function test(name: string, callback: () => void) { callback(); passed++; print(`PASS: React GTK ${name}`); }
const errors: Error[] = [];
const host = new Gtk.Box();
const root = createRoot(host, {onError: error => errors.push(error)});
const ref = React.createRef<Gtk.Label>(), button = React.createRef<Gtk.Button>();
let cleanup = 0;
function Counter() {
    const [count, setCount] = useState(0);
    useLayoutEffect(() => () => { cleanup++; }, []);
    return <Box><Label ref={ref}>{`Count ${count}`}</Label>
        <Button ref={button} onClicked={() => setCount(value => value + 1)}>Add</Button></Box>;
}
test('hooks, native refs and native click update', () => {
    root.render(<Counter />);
    assert(ref.current instanceof Gtk.Label, 'Ref must expose native GTK label');
    assert(ref.current!.get_text() === 'Count 0', 'Initial state');
    button.current!.emit('clicked');
    assert(ref.current!.get_text() === 'Count 1', 'Click must commit React state');
});
test('keyed reorder preserves widget identity', () => {
    const refs = new Map(['a', 'b', 'c'].map(key => [key, React.createRef<Gtk.Label>()]));
    const tree = (keys: string[]) => <Box>{keys.map(key => <Label key={key} ref={refs.get(key)!}>{key}</Label>)}</Box>;
    root.render(tree(['a', 'b', 'c']));
    const original = refs.get('b')!.current;
    root.render(tree(['c', 'a', 'b']));
    const box = host.get_children()[0] as Gtk.Box;
    assert(box.get_children().map(child => (child as Gtk.Label).get_text()).join('') === 'cab', 'Native child order');
    assert(refs.get('b')!.current === original, 'Stable keyed widget');
    assert(cleanup === 1, 'Removed component cleans up effect');
});
test('controlled entry, updated callbacks and property removal', () => {
    let calls = 0;
    const entry = React.createRef<Gtk.Entry>();
    root.render(<Entry ref={entry} text="first" sensitive={false} onChanged={() => calls++} />);
    root.render(<Entry ref={entry} text="second" onChanged={() => calls += 10} />);
    assert(entry.current!.sensitive, 'Removed prop restores GTK default');
    assert(calls === 0, 'Controlled commit must not emit application callbacks');
    entry.current!.set_text('user');
    assert(calls === 10, 'Only current signal callback runs');
    root.render(<Entry ref={entry} text="third" />);
    entry.current!.set_text('user again');
    assert(calls === 10, 'Removed handler disconnects');
});
test('context, fragments, conditional children and visibility', () => {
    const Context = createContext('default');
    const Read = () => <Label ref={ref}>{useContext(Context)}</Label>;
    root.render(<Context.Provider value="native"><><Read /><Button visible={false}>Hidden</Button></></Context.Provider>);
    assert(ref.current!.get_text() === 'native', 'Context value');
    assert(!host.get_children()[1].get_visible(), 'Hidden widget remains hidden');
    root.render(<Box><Label>Only</Label>{false && <Label>Absent</Label>}</Box>);
    assert((host.get_children()[0] as Gtk.Box).get_children().length === 1, 'Conditional child absent');
});
test('center and end packing with GTK CSS classes', () => {
    root.render(<Box><Label>start</Label><Label pack="center" ref={ref} className="accent">middle</Label>
        <Label pack="end">end</Label></Box>);
    const box = host.get_children()[0] as Gtk.Box;
    assert(box.get_center_widget() === ref.current, 'GTK center widget');
    assert(ref.current!.get_style_context().has_class('accent'), 'GTK style class');
    root.render(<Box><Label>start</Label><Label pack="start" ref={ref}>middle</Label>
        <Label pack="end">end</Label></Box>);
    assert(!box.get_center_widget() && ref.current!.get_parent() === box, 'Changed pack reparents native child');
    assert(!ref.current!.get_style_context().has_class('accent'), 'Removed style class');
});
test('mixed JSX text and button text to widget transitions', () => {
    root.render(<Button ref={button}>Count {3}</Button>);
    assert(button.current!.get_label() === 'Count 3', 'Mixed JSX text joins in GTK label');
    root.render(<Button ref={button}><Image iconName="folder-symbolic" /></Button>);
    assert(button.current!.get_child() instanceof Gtk.Image, 'Text becomes native icon');
    root.render(<Button ref={button}>Back</Button>);
    assert(button.current!.get_label() === 'Back', 'Icon becomes text');
});
test('scrolled window replaces and removes GTK viewport children', () => {
    root.render(<ScrolledWindow><Box><Label>First</Label></Box></ScrolledWindow>);
    root.render(<ScrolledWindow><Label>Replacement</Label></ScrolledWindow>);
    const scrolled = host.get_children()[0] as Gtk.ScrolledWindow;
    assert(((scrolled.get_child() as Gtk.Viewport).get_child() as Gtk.Label).get_text() === 'Replacement', 'Viewport child replacement');
    root.render(<ScrolledWindow />);
    assert(scrolled.get_child() === null, 'Viewport removed with virtual child');
});
test('passive effects and timer dispatch through GLib', () => {
    let dispose = 0;
    function Timer() {
        const [value, setValue] = useState('pending');
        useEffect(() => {
            const id = setTimeout(() => setValue('ready'), 5);
            return () => { clearTimeout(id); dispose++; };
        }, []);
        return <Label ref={ref}>{value}</Label>;
    }
    root.render(<Timer />);
    const loop = new GLib.MainLoop(null, false);
    const start = GLib.get_monotonic_time();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        if (ref.current!.get_text() === 'ready' || GLib.get_monotonic_time() - start > 2_000_000) {
            loop.quit(); return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
    loop.run();
    assert(ref.current!.get_text() === 'ready', 'Effect and scheduler update');
    root.unmount();
    assert(dispose === 1 && host.get_children().length === 0, 'Unmount cleans hooks and native widgets');
    let rejected = false;
    try { root.render(<Label>After unmount</Label>); } catch { rejected = true; }
    assert(rejected, 'Disposed root cannot render');
});
test('controlled native scale bounds and user changes', () => {
    const host = new Gtk.Box(), root = createRoot(host);
    const ref = React.createRef<Gtk.Scale>();
    let changes = 0;
    root.render(<Scale ref={ref} value={40} lower={0} upper={100} drawValue={false} onValueChanged={() => changes++} />);
    assert(ref.current!.get_value() === 40 && changes === 0, 'Controlled mount does not emit user changes');
    ref.current!.set_value(75);
    assert(changes === 1, 'Native slider emits user changes');
    root.render(<Scale ref={ref} value={20} lower={0} upper={50} drawValue={false} onValueChanged={() => changes++} />);
    assert(ref.current!.get_value() === 20 && changes === 1, 'Controlled update avoids feedback');
    assert(ref.current!.get_adjustment().get_upper() === 50, 'Scale range updates');
    root.unmount(); host.destroy();
});
assert(errors.length === 0, errors.map(error => error.message).join('\n'));
host.destroy();
print(`${passed} React GTK integration tests passed`);
