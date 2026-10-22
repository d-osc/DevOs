import {React, Gtk, Box, Label, Button, Image, ComboBoxText, Entry, ScrolledWindow, useState, useEffect} from '@dev-os/core';
import {LinuxLanguage, type LanguageControls, type LanguageCatalog, type LanguagePreferences} from './language.js';

export function LanguageSettings({controls}: {controls?: LanguageControls}) {
    const [backend] = useState(() => controls ?? new LinuxLanguage());
    const [catalog, setCatalog] = useState<LanguageCatalog | null>(null);
    const [saved, setSaved] = useState<LanguagePreferences | null>(null);
    const [draft, setDraft] = useState<LanguagePreferences>({layouts: ['us', 'th'], shortcut: 'alt-shift'});
    const [adding, setAdding] = useState('');
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    useEffect(() => {
        let alive = true;
        void backend.load().then(value => {if (alive) {setCatalog(value); setSaved(value.warning ? null : value.settings); setDraft(value.settings); setError(value.warning ?? ''); setBusy(false);}}).catch(reason => {if (alive) {setError(String(reason)); setBusy(false);}});
        return () => {alive = false; backend.destroy();};
    }, [backend]);
    const edit = (value: Partial<LanguagePreferences>) => {setDraft(previous => ({...previous, ...value})); setStatus(''); setError('');};
    const available = catalog?.layouts.filter(layout => !draft.layouts.includes(layout.id)) ?? [];
    const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
    const apply = async () => {
        setBusy(true); setError(''); setStatus('');
        try {const result = await backend.save(draft); setSaved(result.settings); setDraft(result.settings); setStatus(result.applied ? 'Keyboard languages and shortcut applied to this session.' : 'Saved. Start a new DevOs session to apply these settings.');}
        catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}
        finally {setBusy(false);}
    };
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={8}><Label className="settings-eyebrow" xalign={0}>LANGUAGE &amp; INPUT</Label><Label className="heading" xalign={0}>Language</Label><Label className="settings-description" xalign={0}>Choose your keyboard languages and how you switch between them.</Label></Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                <Box className="settings-card language-card" orientation="vertical" spacing={14} borderWidth={0}>
                    <Box spacing={12}><Image iconName="input-keyboard-symbolic" pixelSize={26} /><Box orientation="vertical" spacing={4} expand><Label className="section-heading" xalign={0}>Keyboard languages</Label><Label className="settings-description" xalign={0} wrap>Add up to four languages. The first language is used when a session starts.</Label></Box></Box>
                    {catalog && draft.layouts.map((id, index) => <Box key={id} spacing={10}>
                        <Box orientation="vertical" spacing={3} expand><Label className="settings-field-title" xalign={0}>{catalog.layouts.find(layout => layout.id === id)?.name ?? id}</Label><Label className="settings-description" xalign={0}>{index === 0 ? 'Default keyboard' : catalog.layouts.find(layout => layout.id === id)?.sample ?? ''}</Label></Box>
                        <Button id={`language-up-${id}`} tooltip="Make this language earlier in the list" sensitive={!busy && index > 0} onClicked={() => {const next = [...draft.layouts]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; edit({layouts: next});}}><Image iconName="go-up-symbolic" pixelSize={16} /></Button>
                        <Button id={`language-remove-${id}`} tooltip="Remove keyboard language" sensitive={!busy && draft.layouts.length > 1} onClicked={() => edit({layouts: draft.layouts.filter(item => item !== id)})}><Image iconName="list-remove-symbolic" pixelSize={16} /></Button>
                    </Box>)}
                    <Box spacing={10}><ComboBoxText id="language-add-choice" expand sensitive={!busy && draft.layouts.length < 4} activeId={adding} items={[{id: '', text: 'Choose a language…'}, ...available.map(layout => ({id: layout.id, text: layout.name}))]} onChanged={widget => setAdding(widget.get_active_id() ?? '')} /><Button id="language-add" sensitive={!busy && draft.layouts.length < 4 && available.some(layout => layout.id === adding)} onClicked={() => {edit({layouts: [...draft.layouts, adding]}); setAdding('');}}><Label>Add language</Label></Button></Box>
                </Box>
                <Box className="settings-card language-card" orientation="vertical" spacing={12} borderWidth={0}>
                    <Label className="section-heading" xalign={0}>Switch language shortcut</Label>
                    <ComboBoxText id="language-shortcut" sensitive={!busy} activeId={draft.shortcut} items={catalog?.shortcuts.map(shortcut => ({id: shortcut.id, text: shortcut.name})) ?? []} onChanged={widget => {const id = widget.get_active_id(); if (id) edit({shortcut: id});}} />
                    <Label className="settings-description" xalign={0} wrap>{draft.layouts.length < 2 ? 'Add a second keyboard language to switch languages.' : draft.shortcut === 'super-space' ? 'Super + Space switches languages. Open Applications with Super or the panel button.' : draft.shortcut === 'caps-lock' ? 'Caps Lock switches languages instead of toggling uppercase.' : 'Press the shortcut to cycle through your keyboard languages.'}</Label>
                </Box>
                <Box className="settings-card language-card" orientation="vertical" spacing={10} borderWidth={0}><Label className="section-heading" xalign={0}>Try typing</Label><Entry id="language-test-input" placeholder="Test your keyboard language here…" /><Label className="settings-description" xalign={0} wrap>Apply your changes, then type here to test switching languages. These settings change keyboard input; the desktop interface remains in English.</Label></Box>
                {error && <Label id="language-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
                {status && <Label id="language-status" className="settings-description" xalign={0} wrap>{status}</Label>}
            </Box>
        </ScrolledWindow>
        <Box spacing={10} borderWidth={18}><Label className="settings-description" xalign={0} expand>{busy ? 'Loading / applying…' : dirty ? 'Unsaved changes' : 'Keyboard preferences'}</Label><Button id="language-reset" sensitive={!busy && saved !== null && dirty} onClicked={() => {if (saved) setDraft(saved); setError(''); setStatus('');}}><Label>Discard</Label></Button><Button id="language-apply" className="suggested-action" sensitive={!busy && catalog !== null && dirty} onClicked={() => {void apply();}}><Label>Apply</Label></Button></Box>
    </Box>;
}
