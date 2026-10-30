import {React, GLib, Box, Label, Image, Button, Entry, Switch, ComboBoxText, useState} from '@dev-os/core';
import {parseCustomMenu, type CustomMenuItem} from './custom-menu.js';
export function CustomMenuSettings({value, changed, applyTarget = 'Files', backgroundOnly = false}: {value: unknown; changed(value: string): void; applyTarget?: string; backgroundOnly?: boolean}) {
    let entries: CustomMenuItem[] = [], parseError = '';
    try {entries = parseCustomMenu(value);} catch (error) {parseError = String(error);}
    const [editing, setEditing] = useState<string | null>(null);
    const [title, setTitle] = useState(''), [command, setCommand] = useState('');
    const [target, setTarget] = useState<CustomMenuItem['target']>(backgroundOnly ? 'background' : 'any');
    const [error, setError] = useState('');
    const clear = () => {setEditing(null); setTitle(''); setCommand(''); setTarget(backgroundOnly ? 'background' : 'any'); setError('');};
    const save = () => {
        try {
            const existing = entries.find(item => item.id === editing);
            const item: CustomMenuItem = {id: existing?.id ?? `custom-${GLib.uuid_string_random()}`, title, command, target: backgroundOnly ? 'background' : target, enabled: existing?.enabled ?? true};
            const next = existing ? entries.map(entry => entry.id === existing.id ? item : entry) : [...entries, item];
            const encoded = JSON.stringify(next); parseCustomMenu(encoded); changed(encoded); clear();
        } catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}
    };
    return <Box className="settings-card files-settings-card" orientation="vertical" spacing={16}>
        <Box spacing={10}><Image iconName="list-add-symbolic" pixelSize={20} /><Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>Custom actions</Label><Label className="settings-description" wrap xalign={0}>Add your own commands. Only custom actions can be edited or removed.</Label></Box><Label className="settings-description">{`${entries.length} / 50`}</Label></Box>
        {parseError ? <Box orientation="vertical" spacing={8}><Label className="error" wrap xalign={0}>{parseError}</Label><Button id="files-custom-clear-invalid" onClicked={() => {changed('[]'); clear();}}>Clear invalid custom actions</Button></Box> : <Box orientation="vertical" spacing={12}>
            {entries.map(item => <Box key={item.id} className="files-custom-item" orientation="vertical" spacing={8}>
                <Box spacing={10}><Box orientation="vertical" spacing={4} expand><Label className="settings-field-title" xalign={0}>{item.title}</Label><Label className="settings-description" wrap xalign={0}>{`${item.target} · ${item.command}`}</Label></Box><Switch id={`files-custom-toggle-${item.id}`} active={item.enabled} valign="center" onActiveChanged={widget => changed(JSON.stringify(entries.map(entry => entry.id === item.id ? {...entry, enabled: widget.active} : entry)))} /></Box>
                <Box spacing={8}><Box expand /><Button id={`files-custom-edit-${item.id}`} onClicked={() => {setEditing(item.id); setTitle(item.title); setCommand(item.command); setTarget(item.target); setError('');}}>Edit</Button><Button id={`files-custom-delete-${item.id}`} onClicked={() => {changed(JSON.stringify(entries.filter(entry => entry.id !== item.id))); if (editing === item.id) clear();}}>Remove</Button></Box>
            </Box>)}
            {!entries.length && <Label className="settings-description" xalign={0}>No custom actions yet. Add your first one below.</Label>}
            <Box className="files-custom-editor" orientation="vertical" spacing={10}>
                <Label className="settings-field-title" xalign={0}>{editing ? 'Edit custom action' : 'New custom action'}</Label>
                <Entry id="files-custom-title" text={title} placeholder="Menu name, e.g. Open in my editor" onChanged={widget => setTitle(widget.get_text())} />
                <Entry id="files-custom-command" text={command} placeholder={'Command, e.g. code "{path}"'} onChanged={widget => setCommand(widget.get_text())} />
                {!backgroundOnly && <Box spacing={12}><Label className="settings-description" expand xalign={0}>Show when clicking</Label><ComboBoxText id="files-custom-target" activeId={target} items={[{id: 'any', text: 'Any item or empty space'}, {id: 'file', text: 'Files only'}, {id: 'folder', text: 'Folders only'}, {id: 'background', text: 'Empty space only'}]} onChanged={widget => setTarget(widget.get_active_id() as CustomMenuItem['target'])} /></Box>}
                <Label className="settings-description" wrap xalign={0}>{backgroundOnly ? `${applyTarget} commands run in your home folder. {path} and {directory} both refer to your home folder. Commands run directly; shell operators and ~ are not expanded.` : '{path} = clicked path (current folder on empty space). {directory} = current folder. Quote arguments containing spaces. Commands run directly; shell operators and ~ are not expanded.'}</Label>
                {error && <Label id="files-custom-error" className="error" wrap xalign={0}>{error}</Label>}
                <Box spacing={8}><Label className="settings-description" expand wrap xalign={0}>{`Add or save the item, then Apply to update ${applyTarget}.`}</Label><Button id="files-custom-cancel" onClicked={clear}>Clear form</Button><Button id="files-custom-save" sensitive={Boolean(title.trim() && command.trim())} onClicked={save}>{editing ? 'Save item' : 'Add item'}</Button></Box>
            </Box>
        </Box>}
    </Box>;
}
