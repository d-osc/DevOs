import {
    type GtkTypes as Gtk, React, Box, Label, Button,
    Entry, Image, createRoot, Grid, Stack,
    Notebook, TextView, ComboBoxText, SpinButton, ProgressBar
} from '@dev-os/core';
// Compile-only checks: each expected error must stay rejected by TypeScript.

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

const extended = <Grid rowSpacing={6}>
    <Stack visibleChildName="details" gridWidth={2}><Label pageName="details">Details</Label></Stack>
    <Notebook currentPage={0}><Label tabLabel="First">Content</Label></Notebook>
    <TextView onChanged={view => view.get_buffer().get_text(view.get_buffer().get_start_iter(), view.get_buffer().get_end_iter(), true)} />
    <ComboBoxText items={[{id: 'a', text: 'Alpha'}]} activeId="a" onChanged={combo => combo.get_active_id()} />
    <SpinButton value={1} step={0.5} onValueChanged={spin => spin.get_value()} />
    <ProgressBar fraction={0.5} />
</Grid>;
// @ts-expect-error Grid coordinates are numeric.
const invalidGrid = <Label gridLeft="left" />;
// @ts-expect-error TextView refs expose Gtk.TextView.
const invalidTextRef = <TextView ref={label} />;
// @ts-expect-error Combo items require stable IDs.
const invalidItems = <ComboBoxText items={[{text: 'Alpha'}]} />;
void [extended, invalidGrid, invalidTextRef, invalidItems];
