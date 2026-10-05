import {
    Gtk, GLib, React, Box, Label,
    Image, Button, createRoot
} from '@dev-os/core';
import {searchApps} from '@dev-os/services/apps';

// Diagnostic benchmark, deliberately without machine-specific timing assertions.
Gtk.init(null);
const host = new Gtk.Box(), root = createRoot(host);
const rows = Array.from({length: 200}, (_, index) => index);
const tree = (selected: number) => <Box orientation="vertical">
    {rows.map(index => <Box key={index} spacing={8} className={selected === index ? 'selected' : ''}>
        <Image iconName="text-x-generic" pixelSize={20} />
        <Label expand>{`File ${index}.tsx`}</Label>
        <Button onClicked={() => {}}>Open</Button>
    </Box>)}
</Box>;
root.render(tree(-1));
const start = GLib.get_monotonic_time();
for (let index = 0; index < 30; index++) root.render(tree(index));
const renderMs = (GLib.get_monotonic_time() - start) / 1000;
root.unmount(); host.destroy();
const apps = Array.from({length: 1000}, (_, index) => ({
    get_display_name: () => `Developer Tool ${index}`,
    get_description: () => 'Editor terminal and developer tools',
    get_id: () => `org.devos.tool${index}.desktop`,
    get_keywords: () => ['development', 'code'],
}));
searchApps(apps, 'tool');
const searchStart = GLib.get_monotonic_time();
for (let index = 0; index < 200; index++) searchApps(apps, `tool ${index % 100}`);
print(JSON.stringify({render_200_rows_30_updates_ms: renderMs,
    search_1000_apps_200_queries_ms: (GLib.get_monotonic_time() - searchStart) / 1000}));
