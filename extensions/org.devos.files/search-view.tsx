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
    return <Box className="quick-open" orientation="vertical" spacing={16} borderWidth={22} expand>
        <Box className="quick-search-heading" spacing={14}>
            <Box className="quick-search-emblem" widthRequest={44} heightRequest={44} valign="center"><Image iconName="system-search-symbolic" pixelSize={23} expand /></Box>
            <Box orientation="vertical" spacing={5} expand><Label className="quick-search-title" xalign={0}>Find a file</Label>
                <Box spacing={6}><Image iconName="folder-symbolic" pixelSize={12} /><Label className="subtle" xalign={0} expand ellipsize={Pango.EllipsizeMode.MIDDLE} tooltip={state.root}>{compactPath(state.root)}</Label></Box></Box>
            <Button className="files-icon-button quick-search-close" valign="center" onClicked={close} tooltip="Close search · Esc"><Image iconName="window-close-symbolic" pixelSize={16} /></Button>
        </Box>
        <SearchEntry id="files-quick-search" ref={entry} text={state.query} placeholder="Search by file name or path…"
            onChanged={widget => search.setQuery(widget.get_text())} onActivate={() => open()} />
        <Box spacing={12}><Label className="quick-search-caption" xalign={0} expand>{state.pending ? 'Finding matches…' : state.scanning ? 'Indexing workspace…' : state.query ? 'Search results' : 'Files in this workspace'}</Label>
            <Label className="quick-search-count">{state.results.length < state.matches ? `${state.results.length} of ${state.matches.toLocaleString()}` : `${state.matches.toLocaleString()} files`}</Label></Box>
        {state.error && <Label className="error" xalign={0} wrap>{state.error}</Label>}
        <ScrolledWindow className="quick-search-results" expand minContentHeight={160} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            {!state.results.length ? <Box className="quick-search-empty" orientation="vertical" spacing={10} valign="center" expand><Image iconName="system-search-symbolic" pixelSize={30} /><Label className="section-heading">{state.pending || state.scanning ? 'Searching your workspace…' : state.error ? 'Search is unavailable' : 'No matching files'}</Label><Label className="subtle" wrap>{state.pending || state.scanning ? 'Results will appear here.' : 'Try another name or part of a folder path.'}</Label></Box> :
            <ListBox id="files-quick-results" ref={list} selectionMode={Gtk.SelectionMode.SINGLE} activateOnSingleClick={false}
                sensitive={!state.pending} onRowSelected={(_list, row) => { if (row) select(row.get_index()); }}
                onRowActivated={(_list, row) => { const file = state.results[row.get_index()]; if (file && !search.state.pending) accept(file, false); }}>
                {state.results.map(file => <ListBoxRow key={file.path} tooltip={file.path}>
                    <Box spacing={12} borderWidth={10}>
                        <Box className="quick-result-icon" widthRequest={36} heightRequest={36} valign="center"><Image iconName={materialIcon(file.path) ?? 'text-x-generic-symbolic'} pixelSize={23} expand /></Box>
                        <Box orientation="vertical" spacing={4} expand valign="center">
                            <Label className="quick-result-name" xalign={0} ellipsize={Pango.EllipsizeMode.MIDDLE}>{file.name}</Label>
                            <Label className="quick-result-path" xalign={0} ellipsize={Pango.EllipsizeMode.MIDDLE}>{file.relative.includes('/') ? file.relative.slice(0, file.relative.lastIndexOf('/')) : 'Workspace root'}</Label>
                        </Box>
                    </Box>
                </ListBoxRow>)}
            </ListBox>}
        </ScrolledWindow>
        {(state.limited || state.skipped > 0) && <Label className="quick-search-notice" xalign={0} wrap>
            {state.limited ? 'Index limit reached. Open a smaller folder to search further. ' : ''}{state.skipped > 0 ? `${state.skipped} unreadable folders skipped.` : ''}
        </Label>}
        <Box className="quick-search-footer" orientation="vertical" spacing={12}>
        <Box spacing={8}>
            <Label className="subtle" xalign={0} expand>{state.indexed.toLocaleString()} files indexed</Label>
            <Button sensitive={!!state.results[selection] && !state.pending} onClicked={() => open(true)}>Show in folder</Button>
            <Button className="primary-action" sensitive={!!state.results[selection] && !state.pending} onClicked={() => open()}>Open file</Button>
        </Box>
        <Label className="quick-search-shortcuts" xalign={0} wrap>↑ ↓ Navigate   ·   Enter Open   ·   Shift + Enter Show in folder   ·   Esc Close</Label>
        </Box>
    </Box>;
}
