import {React, Gtk, Pango, Box, Label, Button, Entry, SpinButton, Switch, Image, DrawingArea, ScrolledWindow, useState, type SettingsHost} from '@dev-os/core';
import {terminalOptions, currentTerminalScheme, validTerminalFont} from './options.js';
const id = 'org.devos.terminal';
export function TerminalSettings({preferences}: {preferences: SettingsHost}) {
    const info = preferences.get(id);
    const [saved, setSaved] = useState(() => terminalOptions(info.state.values));
    const [draft, setDraft] = useState(saved);
    const [error, setError] = useState(''); const [status, setStatus] = useState('');
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved), valid = validTerminalFont(draft.font);
    const edit = (next: Partial<typeof draft>) => {setDraft(current => ({...current, ...next})); setError(''); setStatus('');};
    const scheme = currentTerminalScheme();
    const toggles = [
        {key: 'suggestions', title: 'Command suggestions', detail: 'Suggest installed commands, history, arguments and paths while typing in Bash.', icon: 'system-search-symbolic'},
        {key: 'allowHyperlinks', title: 'Clickable terminal links', detail: 'Allow applications to create clickable hyperlinks.', icon: 'insert-link-symbolic'},
        {key: 'rightClickCopy', title: 'Right-click copies', detail: 'Copy selected text on right-click, or paste when nothing is selected. Off shows a Copy/Paste menu. Hold Shift to override programs that use the mouse.', icon: 'edit-copy-symbolic'},
        {key: 'audibleBell', title: 'Audible bell', detail: 'Play a sound when a terminal application rings the bell.', icon: 'audio-volume-high-symbolic'},
        {key: 'scrollOnOutput', title: 'Follow new output', detail: 'Jump to the bottom when new output arrives.', icon: 'go-bottom-symbolic'},
        {key: 'scrollOnKeystroke', title: 'Follow typing', detail: 'Return to the prompt when you type.', icon: 'input-keyboard-symbolic'},
    ] as const;
    return <Box className="settings-content terminal-settings-page" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}><Label className="settings-eyebrow" xalign={0}>WORKSPACE / COMMAND LINE</Label><Label className="heading" xalign={0}>Terminal</Label><Label className="settings-description" wrap xalign={0}>A clear view of your command line. Tune the look and feel of every tab.</Label></Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={18}>
                <Box className="terminal-settings-stage" orientation="vertical" spacing={12}>
                    <Box><Label className="settings-eyebrow" xalign={0} expand>TERMINAL PREVIEW</Label><Label className="settings-description">{scheme.title}</Label></Box>
                    <Box className="terminal-preview-title" spacing={8}><Image iconName="utilities-terminal-symbolic" pixelSize={15} /><Label xalign={0} expand>Terminal · ~/workspace</Label><Image iconName="list-add-symbolic" pixelSize={12} /></Box>
                    <DrawingArea key={`${scheme.background}/${draft.font}`} id="terminal-settings-preview" heightRequest={valid ? Math.max(170, Math.ceil(Pango.FontDescription.from_string(draft.font).get_size() / Pango.SCALE * 96 / 72 + 8) * 4 + 20) : 170} onDraw={(_widget, cr) => {
                        const color = (hex: string) => cr.setSourceRGB(...[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number]);
                        color(scheme.background); cr.paint();
                        const font = Pango.FontDescription.from_string(valid ? draft.font : 'Monospace 11');
                        cr.selectFontFace(font.get_family() || 'Monospace', 0, 0); cr.setFontSize(font.get_size() / Pango.SCALE * 96 / 72);
                        const size = font.get_size() / Pango.SCALE * 96 / 72;
                        ['dev@devos:~/workspace $ ls', 'Documents  Projects  Downloads', '', 'dev@devos:~/workspace $ _'].forEach((line, index) => {color(index === 1 ? scheme.foreground : scheme.accent); cr.moveTo(16, 25 + index * (size + 8)); cr.showText(line);});
                        return false;
                    }} />
                    <Label className="settings-description" wrap xalign={0}>Sample output · Apply updates open tabs without restarting their shells.</Label>
                </Box>
                <Label className="settings-description" wrap xalign={0}>Colors follow the Theme page: Dark or Light, including Auto.</Label>
                <Box className="settings-card terminal-settings-card" orientation="vertical" spacing={16}>
                    <Box orientation="vertical" spacing={8}><Label className="settings-field-title" xalign={0}>Terminal font</Label><Entry id="terminal-font" text={draft.font} onChanged={widget => edit({font: widget.get_text()})} /><Label className={valid ? 'settings-description' : 'error'} wrap xalign={0}>{valid ? 'Font family and size, for example Monospace 11. Size: 6–48.' : 'Enter a font family and a size between 6 and 48.'}</Label><Box spacing={8}>{[10, 11, 14].map(size => <Button key={size} id={`terminal-font-${size}`} expand fill onClicked={() => edit({font: `Monospace ${size}`})}>{`Monospace ${size}`}</Button>)}</Box></Box>
                    <Box spacing={12}><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>Scrollback history</Label><Label className="settings-description" wrap xalign={0}>Lines retained per tab, from 100 to 100,000.</Label></Box><SpinButton id="terminal-scrollback" value={draft.scrollback} lower={100} upper={100000} step={100} digits={0} numeric widthChars={6} onValueChanged={widget => edit({scrollback: widget.get_value_as_int()})} /></Box>
                </Box>
                <Box className="settings-card terminal-settings-card" orientation="vertical" spacing={18}>{toggles.map(item => <Box key={item.key} spacing={12}><Image iconName={item.icon} pixelSize={18} /><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>{item.title}</Label><Label className="settings-description" wrap xalign={0}>{item.detail}</Label></Box><Switch id={`terminal-${item.key}`} active={draft[item.key]} valign="center" onActiveChanged={widget => edit({[item.key]: widget.active})} /></Box>)}</Box>
                <Label className="settings-description" wrap xalign={0}>Ctrl + Shift + T  New tab · Ctrl + Tab  Switch tabs · Ctrl + Shift + C / V  Copy / Paste</Label>
                {(error || info.error) && <Label className="error" wrap xalign={0}>{error || info.error}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}><Label className="settings-description" wrap expand xalign={0}>{status || (dirty ? 'Unsaved changes · Preview only' : 'Ready for your next command.')}</Label><Button id="terminal-settings-reset" sensitive={dirty} onClicked={() => {setDraft({...saved}); setError(''); setStatus('');}}>Reset</Button><Button id="terminal-settings-apply" className="settings-primary" sensitive={dirty && valid && !info.error} onClicked={() => {try {preferences.update(id, true, {...draft}); setSaved({...draft}); setStatus('Terminal updated. Your shells are still running.');} catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}}}>Apply</Button></Box>
    </Box>;
}
