import {
    Gtk, React, Box, Label, Button,
    Grid, Overlay, Stack, Notebook, Paned,
    Frame, Expander, Revealer, EventBox, Viewport,
    ButtonBox, HeaderBar, ActionBar, ToggleButton, LinkButton,
    MenuButton, Spinner, ProgressBar, LevelBar, SpinButton,
    TextView, ComboBoxText, createRoot
} from '@dev-os/core';

Gtk.init(null);
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
let passed = 0;
function test(name: string, callback: () => void): void { callback(); passed++; print(`PASS: view ${name}`); }
const host = new Gtk.Box();
const errors: Error[] = [];
const root = createRoot(host, {onError: error => errors.push(error)});

test('grid coordinates, spans and keyed reordering', () => {
    const grid = React.createRef<Gtk.Grid>(), a = React.createRef<Gtk.Label>();
    const tree = (reverse: boolean, left: number) => <Grid ref={grid} rowSpacing={4} columnSpacing={6}>
        {(reverse ? ['b', 'a'] : ['a', 'b']).map(key => <Label key={key} ref={key === 'a' ? a : undefined}
            gridLeft={key === 'a' ? left : 0} gridTop={key === 'a' ? 0 : 1} gridWidth={2}>{key}</Label>)}
    </Grid>;
    root.render(tree(false, 0));
    const original = a.current;
    root.render(tree(true, 3));
    assert(a.current === original, 'Grid reordering preserves widget identity');
    assert(grid.current!.get_child_at(3, 0) === a.current, 'Updated column attaches the same child');
    assert(grid.current!.get_child_at(4, 0) === a.current, 'Column span covers two cells');
});

test('stack and notebook select pages after initial mount', () => {
    const stack = React.createRef<Gtk.Stack>(), book = React.createRef<Gtk.Notebook>();
    let switches = 0, pageChanges = 0;
    root.render(<Box><Stack ref={stack} visibleChildName="second" onVisibleChildChanged={() => pageChanges++}>
        <Label pageName="first" pageTitle="First">One</Label><Label pageName="second">Two</Label>
    </Stack><Notebook ref={book} currentPage={1} onSwitchPage={() => switches++}>
        <Label tabLabel="First">One</Label><Label tabLabel="Second">Two</Label>
    </Notebook></Box>);
    assert(stack.current!.get_visible_child_name() === 'second', 'Initial stack page');
    assert(book.current!.get_current_page() === 1, 'Initial notebook page');
    assert(switches === 0 && pageChanges === 0, 'Mount and controlled selection suppress callbacks');
    stack.current!.set_visible_child_name('first');
    book.current!.set_current_page(0);
    assert(switches === 1 && pageChanges === 1, 'Native page changes dispatch callbacks');
    root.render(<Notebook ref={book} currentPage={0}><Label key="b" tabLabel="Renamed">Two</Label>
        <Label key="a" tabLabel="First">One</Label></Notebook>);
    assert(book.current!.get_tab_label_text(book.current!.get_nth_page(0)!) === 'Renamed', 'Notebook tab labels');
});

test('overlay, paned and titlebar child roles', () => {
    const overlay = React.createRef<Gtk.Overlay>(), paned = React.createRef<Gtk.Paned>();
    const header = React.createRef<Gtk.HeaderBar>(), action = React.createRef<Gtk.ActionBar>();
    const main = React.createRef<Gtk.Label>(), floating = React.createRef<Gtk.Label>();
    root.render(<Box><Overlay ref={overlay}><Label ref={main}>Main</Label><Label ref={floating} overlay>Over</Label></Overlay>
        <Paned ref={paned} orientation="horizontal" position={100}><Label>Left</Label><Label>Right</Label></Paned>
        <HeaderBar ref={header} title="App"><Button>Start</Button><Label pack="center">Title</Label><Button pack="end">End</Button></HeaderBar>
        <ActionBar ref={action}><Label pack="center">Status</Label></ActionBar></Box>);
    assert(overlay.current!.get_child() === main.current && floating.current!.get_parent() === overlay.current, 'Overlay child roles');
    assert(paned.current!.get_child1() instanceof Gtk.Label && paned.current!.get_child2() instanceof Gtk.Label, 'Paned has two slots');
    assert(header.current!.get_custom_title() instanceof Gtk.Label, 'HeaderBar custom title');
    assert(action.current!.get_center_widget() instanceof Gtk.Label, 'ActionBar center');
});

test('containers, toggles and progress widgets', () => {
    const toggle = React.createRef<Gtk.ToggleButton>(), progress = React.createRef<Gtk.ProgressBar>();
    let toggles = 0;
    root.render(<Box><Frame label="Group"><Expander label="Details" expanded><Revealer revealChild>
        <EventBox><Viewport><Label>Content</Label></Viewport></EventBox>
    </Revealer></Expander></Frame><ButtonBox><ToggleButton ref={toggle} active onToggled={() => toggles++}>Toggle</ToggleButton>
        <LinkButton uri="https://example.com">Link</LinkButton><MenuButton>Menu</MenuButton></ButtonBox>
        <Spinner active/><ProgressBar ref={progress} fraction={0.5} showText text="50%"/><LevelBar value={0.75}/></Box>);
    assert(toggle.current!.get_active() && toggles === 0, 'Controlled toggle avoids feedback');
    toggle.current!.set_active(false);
    assert(toggles === 1, 'Native toggle signal');
    assert(progress.current!.get_fraction() === 0.5, 'Progress value');
});

test('spin, combo and text buffer values, callbacks and cleanup', () => {
    const spin = React.createRef<Gtk.SpinButton>(), combo = React.createRef<Gtk.ComboBoxText>();
    const text = React.createRef<Gtk.TextView>();
    let edits = 0, selected = 0;
    const tree = (value: string, callbacks = true) => <Box>
        <SpinButton ref={spin} value={5} lower={0} upper={10} step={0.5} digits={1}/>
        <ComboBoxText ref={combo} items={[{id: 'a', text: 'Alpha'}, {id: 'b', text: 'Beta'}]} activeId="b"
            onChanged={callbacks ? () => selected++ : undefined}/>
        <TextView ref={text} text={value} monospace wrapMode={Gtk.WrapMode.WORD}
            onChanged={callbacks ? widget => { assert(widget instanceof Gtk.TextView, 'Callback exposes text view'); edits++; } : undefined}/>
    </Box>;
    root.render(tree('First'));
    assert(spin.current!.get_value() === 5 && spin.current!.get_adjustment().get_step_increment() === 0.5, 'Spin range and step');
    assert(combo.current!.get_active_id() === 'b' && selected === 0, 'Controlled combo');
    const buffer = text.current!.get_buffer();
    buffer.set_text('User', -1);
    assert(edits > 0, 'Text buffer changes dispatch callbacks');
    const before = edits;
    root.render(tree('Updated'));
    assert(buffer.text === 'Updated' && edits === before, 'Controlled text avoids feedback');
    combo.current!.set_active_id('a');
    assert(selected === 1, 'Native combo selection signal');
    root.render(tree('Updated', false));
    buffer.set_text('Detached', -1);
    assert(edits === before, 'Removed text callback disconnects from buffer');
});

root.unmount(); host.destroy();
assert(errors.length === 0, errors.map(error => error.message).join('\n'));
print(`${passed} view integration tests passed`);
