// Compile-only checks: each expected error must stay rejected by TypeScript.
import type Gtk from '@girs/gtk-3.0';
import {React, Box, Label, Button, Entry, Image, createRoot} from '@dev-os/react-gtk';

const label = React.createRef<Gtk.Label>();
const valid = <Box orientation="vertical" spacing={12}>
    <Label ref={label}>Count: {1}</Label>
    <Entry onChanged={entry => entry.get_text()} />
    <Button onClicked={button => button.get_label()}>Add</Button>
</Box>;
void valid;

// @ts-expect-error GTK spacing is numeric.
const invalidSpacing = <Box spacing="wide" />;
// @ts-expect-error GTK events use onClicked rather than DOM onClick.
const invalidEvent = <Button onClick={() => {}} />;
// @ts-expect-error Entry callbacks expose Gtk.Entry, not DOM events.
const invalidHandler = <Entry onChanged={entry => entry.target.value} />;
// @ts-expect-error A label ref cannot target a Gtk.Button.
const invalidRef = <Button ref={label} />;
// @ts-expect-error Image icon names are strings.
const invalidIcon = <Image iconName={123} />;
// @ts-expect-error Root containers must be native GTK containers.
createRoot({});
void [invalidSpacing, invalidEvent, invalidHandler, invalidRef, invalidIcon];
