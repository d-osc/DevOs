import {
    Gtk, Gdk, Pango, React, Box,
    Label, Button, Image, SearchEntry, ScrolledWindow,
    ListBox, ListBoxRow, useState, useLayoutEffect, useRef,
    useImperativeHandle
} from '@dev-os/core';
import type {FileSearch, SearchFile} from './search.js';
import {compactPath} from './presentation.js';
import {materialIcon} from '../org.devos.icons/material.js';

export interface QuickOpenHandle {key(key: number, shift: boolean): boolean; focus(): void;}
export function QuickOpen({search, handle, close, accept}: {
    search: FileSearch; handle: React.Ref<QuickOpenHandle>; close(): void; accept(file: SearchFile, reveal: boolean): void;
}) {
    const [state, update] = useState(search.state), [selection, select] = useState(0);
    const entry = useRef<Gtk.SearchEntry>(null), list = useRef<Gtk.ListBox>(null);
    useLayoutEffect(() => search.subscribe(() => update(search.state)), [search]);
    useLayoutEffect(() => { entry.current?.grab_focus(); }, []);
    useLayoutEffect(() => { select(0); }, [state.query]);
    useLayoutEffect(() => {
        const row = list.current?.get_row_at_index(Math.min(selection, state.results.length - 1));
        list.current?.select_row(row ?? null);
        if (row) {
            const scroll = list.current?.get_parent();
            if (scroll instanceof Gtk.Viewport) {
                const adjustment = scroll.get_vadjustment(), area = row.get_allocation();
                adjustment.clamp_page(area.y, area.y + area.height);
            }
        }
    }, [selection, state.results]);
    const open = (reveal = false) => {
        const index = list.current?.get_selected_row()?.get_index() ?? selection;
        const file = state.results[index];
        if (file && !search.state.pending) accept(file, reveal);
    };
    useImperativeHandle(handle, () => ({focus() { entry.current?.grab_focus(); entry.current?.select_region(0, -1); }, key(key, shift) {
        if (key === Gdk.KEY_Escape) { close(); return true; }
        if (key === Gdk.KEY_Down || key === Gdk.KEY_Up) {
            select(value => Math.max(0, Math.min(state.results.length - 1, value + (key === Gdk.KEY_Down ? 1 : -1)))); return true;
        }
        if ([Gdk.KEY_Return, Gdk.KEY_KP_Enter].includes(key)) { open(shift); return true; }
        return false;
    }}));
    return <Box className="quick-open" orientation="vertical" spacing={12} borderWidth={18} expand>
        <Box spacing={12}>
            <Box orientation="vertical" spacing={5} expand><Label className="folder-title" xalign={0}>Go to File</Label>
                <Label className="subtle mono" xalign={0} ellipsize={Pango.EllipsizeMode.MIDDLE} tooltip={state.root}>{compactPath(state.root)}</Label></Box>
            <Button onClicked={close} tooltip="Close · Esc">Close</Button>
        </Box>
        <SearchEntry id="files-quick-search" className="mono" ref={entry} text={state.query} placeholder="Search files by name or path…"
            onChanged={widget => search.setQuery(widget.get_text())} onActivate={() => open()} />
        <Box spacing={12}><Label className="eyebrow" xalign={0} expand>{state.pending ? 'MATCHING…' : state.scanning ? 'INDEXING WORKSPACE…' : 'FILES IN WORKSPACE'}</Label>
            <Label className="subtle">{state.results.length} / {state.matches} matches</Label></Box>
        {state.error && <Label className="error" xalign={0} wrap>{state.error}</Label>}
        <ScrolledWindow expand hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <ListBox id="files-quick-results" ref={list} selectionMode={Gtk.SelectionMode.SINGLE} activateOnSingleClick={false}
                sensitive={!state.pending} onRowSelected={(_list, row) => { if (row) select(row.get_index()); }}
                onRowActivated={(_list, row) => { const file = state.results[row.get_index()]; if (file && !search.state.pending) accept(file, false); }}>
                {state.results.map(file => <ListBoxRow key={file.path} tooltip={file.path}>
                    <Box spacing={12} borderWidth={10}>
                        <Image iconName={materialIcon(file.path) ?? 'text-x-generic-symbolic'} pixelSize={20} />
                        <Box orientation="vertical" spacing={4} expand>
                            <Label className="file-name mono" xalign={0} ellipsize={Pango.EllipsizeMode.MIDDLE}>{file.name}</Label>
                            <Label className="subtle mono" xalign={0} ellipsize={Pango.EllipsizeMode.MIDDLE}>{file.relative}</Label>
                        </Box>
                    </Box>
                </ListBoxRow>)}
            </ListBox>
        </ScrolledWindow>
        {!state.results.length && !state.pending && !state.scanning && !state.error && <Label className="empty-message">No matching files</Label>}
        {(state.limited || state.skipped > 0) && <Label className="subtle" xalign={0} wrap>
            {state.limited ? 'Index limit reached. Open a smaller folder to search further. ' : ''}{state.skipped > 0 ? `${state.skipped} unreadable folders skipped.` : ''}
        </Label>}
        <Box spacing={8}>
            <Label className="subtle mono" xalign={0} expand>↑ ↓ Select · Enter Open · Shift Enter Reveal · Esc Close</Label>
            <Button sensitive={!!state.results[selection] && !state.pending} onClicked={() => open(true)}>Show in folder</Button>
            <Button className="primary-action" sensitive={!!state.results[selection] && !state.pending} onClicked={() => open()}>Open file</Button>
        </Box>
        <Label className="subtle" xalign={0}>{state.indexed} files indexed · Excluded folders apply to this workspace</Label>
    </Box>;
}
