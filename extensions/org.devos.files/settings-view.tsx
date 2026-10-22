import {React, Gtk, Box, Label, Button, Image, Entry, Switch, ScrolledWindow, useState, type SettingsHost, type SettingsValues} from '@dev-os/core';
import {fileMenuItems, fileMenuOptions} from './context-menu.js';
import {CustomMenuSettings} from './custom-menu-settings.js';
import {parseCustomMenu} from './custom-menu.js';
const id = 'org.devos.files';
export function FilesSettings({preferences}: {preferences: SettingsHost}) {
    const info = preferences.get(id);
    const [saved, setSaved] = useState(() => ({...info.state.values}));
    const [draft, setDraft] = useState(saved);
    const [error, setError] = useState(''); const [status, setStatus] = useState('');
    const dirty = JSON.stringify(saved) !== JSON.stringify(draft), menu = fileMenuOptions(draft);
    const edit = (next: SettingsValues) => {setDraft(current => ({...current, ...next})); setError(''); setStatus('');};
    const items = [...fileMenuItems.filter(item => menu[item.key]), ...(menu.customItems ?? []).filter(item => item.enabled).map(item => ({key: item.id, title: item.title, icon: 'system-run-symbolic'}))];
    let customValid = true;
    try {parseCustomMenu(draft.contextCustomItems);} catch {customValid = false;}
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}><Label className="settings-eyebrow" xalign={0}>WORKSPACE / FILE BROWSER</Label><Label className="heading" xalign={0}>Files</Label><Label className="settings-description" wrap xalign={0}>Make browsing and right-click actions work the way you do.</Label></Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={18}>
                <Box className="files-settings-stage" orientation="vertical" spacing={12}>
                    <Label className="settings-eyebrow" xalign={0}>RIGHT-CLICK MENU PREVIEW</Label>
                    <Box spacing={24}><Box orientation="vertical" spacing={10} expand valign="center"><Image iconName="folder-symbolic" pixelSize={44} /><Label className="settings-field-title">Documents</Label><Label className="settings-description">Right-click a file or folder</Label></Box><Box className="files-menu-preview" orientation="vertical" spacing={2} widthRequest={230}>
                        {menu.contextEnabled && items.length ? items.map(item => <Box key={item.key} id={`files-preview-${item.key}`} className="files-preview-menu-row" spacing={10}><Image iconName={item.icon} pixelSize={15} /><Label xalign={0} expand>{item.title}</Label></Box>) : <Label className="settings-description" wrap>{menu.contextEnabled ? 'No actions selected' : 'Right-click menu is off'}</Label>}
                    </Box></Box><Label className="settings-description" wrap xalign={0}>Preview only · Open and Rename require an item. Folder actions also work on empty space.</Label>
                </Box>
                <Box className="settings-card files-settings-card" orientation="vertical" spacing={18}>
                    <Box spacing={12}><Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>Right-click context menu</Label><Label className="settings-description" wrap xalign={0}>Enable the menu in both list and grid views.</Label></Box><Switch id="files-option-contextEnabled" active={menu.contextEnabled} valign="center" onActiveChanged={widget => edit({contextEnabled: widget.active})} /></Box>
                    <Label className="settings-description" wrap xalign={0}>Default actions stay available here. They can be turned on or off, but cannot be edited or removed.</Label>
                    {fileMenuItems.map(item => <Box key={item.key} spacing={12} sensitive={menu.contextEnabled}><Image iconName={item.icon} pixelSize={17} /><Label className="settings-field-title" xalign={0} expand>{item.title}</Label><Label className="settings-eyebrow">DEFAULT</Label><Switch id={`files-option-${item.key}`} active={menu[item.key]} valign="center" onActiveChanged={widget => edit({[item.key]: widget.active})} /></Box>)}
                </Box>
                <CustomMenuSettings value={draft.contextCustomItems} changed={value => edit({contextCustomItems: value})} />
                <Box className="settings-card files-settings-card" orientation="vertical" spacing={16}>
                    <Label className="section-heading" xalign={0}>Browsing defaults</Label>
                    <Box orientation="vertical" spacing={8}><Label className="settings-field-title" xalign={0}>Start folder</Label><Entry id="files-settings-homeDirectory" text={String(draft.homeDirectory ?? '~')} onChanged={widget => edit({homeDirectory: widget.get_text()})} /></Box>
                    {[{key: 'gridView', title: 'Start with icon grid'}, {key: 'showHidden', title: 'Show hidden files by default'}].map(item => <Box key={item.key}><Label className="settings-field-title" expand xalign={0}>{item.title}</Label><Switch id={`files-option-${item.key}`} active={draft[item.key] === true} onActiveChanged={widget => edit({[item.key]: widget.active})} /></Box>)}
                    <Box orientation="vertical" spacing={8}><Label className="settings-field-title" xalign={0}>Quick Open: excluded folders</Label><Entry id="files-settings-searchExcludedDirectories" text={String(draft.searchExcludedDirectories ?? '')} onChanged={widget => edit({searchExcludedDirectories: widget.get_text()})} /><Label className="settings-description" wrap xalign={0}>Comma-separated names. Start folder applies to new Files windows; search exclusions apply to new searches.</Label></Box>
                </Box>
                {(error || info.error) && <Label className="error" wrap xalign={0}>{error || info.error}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}><Label className="settings-description" expand wrap xalign={0}>{status || (dirty ? 'Unsaved changes · Preview only' : 'Your files, your workflow.')}</Label><Button id="files-settings-reset" sensitive={dirty} onClicked={() => {setDraft({...saved}); setError(''); setStatus('');}}>Reset</Button><Button id="files-settings-apply" className="settings-primary" sensitive={dirty && customValid && Boolean(String(draft.homeDirectory ?? '').trim()) && !info.error} onClicked={() => {try {parseCustomMenu(draft.contextCustomItems); preferences.update(id, true, {...draft}); setSaved({...draft}); setStatus('Files preferences updated.');} catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}}}>Apply</Button></Box>
    </Box>;
}
