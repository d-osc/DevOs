import {
    Gtk, GLib, Gio, React, createRoot,
    mountWindowHeader, Box, Button, Label, Entry,
    useState, useEffect, type Root
} from '@dev-os/core';

function Counter() {
    const [count, setCount] = useState(0);
    const [name, setName] = useState('Wayland');
    const [time, setTime] = useState('');
    useEffect(() => {
        const tick = () => setTime(GLib.DateTime.new_now_local().format('%H:%M:%S') ?? '');
        tick();
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            tick(); return GLib.SOURCE_CONTINUE;
        });
        return () => { GLib.source_remove(id); };
    }, []);
    return <Box orientation="vertical" spacing={16} borderWidth={24}>
        <Label>{`Hello ${name} · React → native GTK`}</Label>
        <Entry text={name} onChanged={entry => setName(entry.get_text())} placeholder="Your name" />
        <Label>{`Count: ${count}`}</Label>
        <Box spacing={8} halign="center">
            <Button onClicked={() => setCount(value => value - 1)}>−</Button>
            <Button onClicked={() => setCount(0)}>Reset</Button>
            <Button onClicked={() => setCount(value => value + 1)}>+</Button>
        </Box>
        {count >= 5 && <Label>You reached five!</Label>}
        <Label>{time}</Label>
    </Box>;
}

const application = new Gtk.Application({application_id: 'org.devos.ReactDemo', flags: Gio.ApplicationFlags.NON_UNIQUE});
let root: Root | undefined;
let header: ReturnType<typeof mountWindowHeader> | undefined;
application.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({application, title: 'React + GTK', default_width: 440});
    root = createRoot(window);
    root.render(<Counter />);
    header = mountWindowHeader(window, {title: 'React + GTK', iconName: 'applications-development-symbolic',
        windowIconName: 'applications-development', iconId: 'demo-window-icon'});
    window.connect('delete-event', () => { root?.unmount(); header?.destroy(); return false; });
    window.show();
});
application.connect('shutdown', () => { root?.unmount(); header?.destroy(); });
await application.runAsync(['dev-os-react-demo']);
