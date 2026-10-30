import {React, Gtk, Box, Label, Button, Image, Switch, SpinButton, ScrolledWindow, useState, type SettingsHost, type SettingsValues} from '@dev-os/core';
import {panelOptions} from './options.js';
import {PanelContextSettings} from './context-settings.js';
import {parseCustomMenu} from '../../../src/apps/org.devos.files/custom-menu.js';

const id = 'org.devos.panel';
export function PanelSettings({preferences, getConfig, applied}: {preferences: SettingsHost; getConfig(): {panel_height: number}; applied(): void}) {
    const info = preferences.get(id);
    const [saved, setSaved] = useState<SettingsValues>(() => ({...info.state.values, ...panelOptions(info.state.values), height: Number(info.state.values.height) || 0}));
    const [draft, setDraft] = useState(saved);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const options = panelOptions(draft, getConfig().panel_height);
    const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
    const edit = (next: SettingsValues) => {setDraft(current => ({...current, ...next})); setError(''); setStatus('');};
    const bar = <Box id="panel-preview-bar" className="panel-preview-bar" spacing={options.spacing} heightRequest={options.height}>
        <Box spacing={options.itemSpacing} valign="center"><Image iconName="view-app-grid-symbolic" pixelSize={options.iconSize} /><Image iconName="view-grid-symbolic" pixelSize={options.iconSize} />{options.showPinned && <Box id="panel-preview-pins" spacing={options.itemSpacing + 8}><Image iconName="dev-os-terminal-symbolic" pixelSize={options.iconSize} /><Image iconName="dev-os-files-symbolic" pixelSize={options.iconSize} /></Box>}</Box>
        <Box expand /><Box spacing={8} valign="center"><Image iconName="network-wireless-signal-excellent-symbolic" pixelSize={14} /><Image iconName="audio-volume-high-symbolic" pixelSize={14} /><Box orientation="vertical" valign="center"><Label className="panel-preview-time">10:24</Label>{options.showDate && <Label id="panel-preview-date" className="panel-preview-date">Sat, 17 Oct</Label>}</Box><Image iconName="preferences-system-notifications-symbolic" pixelSize={14} /></Box>
    </Box>;
    return <Box className="settings-content panel-settings-page" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}><Label className="settings-eyebrow" xalign={0}>PERSONALIZATION / DESKTOP</Label><Label className="heading" xalign={0}>Panel</Label><Label className="settings-description" xalign={0}>Your apps, clock and controls. Give everything the right amount of space.</Label></Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={18}>
                <Box className="panel-settings-stage" orientation="vertical" spacing={12}>
                    <Box><Label className="settings-eyebrow" xalign={0} expand>LAYOUT PREVIEW</Label><Label className="settings-description">{`${options.position === 'top' ? 'Top' : 'Bottom'} · ${options.height} px`}</Label></Box>
                    <Box className="panel-preview-desktop" orientation="vertical" heightRequest={180}>
                        {options.position === 'top' && bar}<Box orientation="vertical" expand spacing={8} valign="center"><Image iconName="view-grid-symbolic" pixelSize={28} /><Label className="settings-description">Your workspace</Label></Box>{options.position === 'bottom' && bar}
                    </Box><Label className="settings-description" xalign={0}>Example layout · Changes appear on every display after Apply.</Label>
                </Box>
                <Box orientation="vertical" spacing={10}><Label className="section-heading" xalign={0}>Position on screen</Label><Box spacing={12} homogeneous>{(['top', 'bottom'] as const).map(position => <Button key={position} id={`panel-position-${position}`} className={`panel-position ${options.position === position ? 'panel-position-selected' : ''}`} expand fill onClicked={() => edit({position})}><Box spacing={12}><Image iconName={position === 'top' ? 'go-up-symbolic' : 'go-down-symbolic'} pixelSize={20} /><Label className="settings-field-title">{position === 'top' ? 'Top edge' : 'Bottom edge'}</Label></Box></Button>)}</Box></Box>
                <Box className="settings-card panel-settings-card" orientation="vertical" spacing={16}>
                    <Label className="section-heading" xalign={0}>Size & spacing</Label>
                    <Box spacing={8} homogeneous>{[{title: 'Compact', height: 36, iconSize: 16, itemSpacing: 2}, {title: 'Comfortable', height: 44, iconSize: 20, itemSpacing: 4}, {title: 'Spacious', height: 56, iconSize: 24, itemSpacing: 8}].map(preset => <Button key={preset.title} id={`panel-preset-${preset.height}`} onClicked={() => edit({height: preset.height, iconSize: preset.iconSize, itemSpacing: preset.itemSpacing})}>{preset.title}</Button>)}</Box>
                    <Box spacing={12}><Box orientation="vertical" spacing={4} expand><Label className="settings-field-title" xalign={0}>Use Desktop panel height</Label><Label className="settings-description" xalign={0}>Follow the height set in Desktop settings.</Label></Box><Switch id="panel-follow-height" active={draft.height === 0} valign="center" onActiveChanged={widget => edit({height: widget.active ? 0 : options.height})} /></Box>
                    {[{key: 'height', title: 'Panel height', min: 32, max: 96}, {key: 'iconSize', title: 'App icon size', min: 14, max: 28}, {key: 'itemSpacing', title: 'Space between buttons', min: 0, max: 16}, {key: 'spacing', title: 'Space between sections', min: 0, max: 32}].map(item => <Box key={item.key} spacing={12}><Label className="settings-field-title" xalign={0} expand>{item.title}</Label><SpinButton id={`panel-${item.key}`} sensitive={item.key !== 'height' || draft.height !== 0} value={options[item.key as keyof typeof options] as number} lower={item.min} upper={item.max} step={1} digits={0} numeric widthChars={4} onValueChanged={widget => edit({[item.key]: widget.get_value_as_int()})} /><Label className="settings-description">px</Label></Box>)}
                </Box>
                <Box className="settings-card panel-settings-card" orientation="vertical" spacing={18}>
                    {[{key: 'showPinned', title: 'Terminal & Files shortcuts', detail: 'Keep your everyday apps beside the menu.', icon: 'dev-os-files-symbolic'}, {key: 'showDate', title: 'Date below the clock', detail: 'Show the day and date at a glance.', icon: 'x-office-calendar-symbolic'}].map(item => <Box key={item.key} spacing={12}><Image iconName={item.icon} pixelSize={18} /><Box orientation="vertical" spacing={4} expand><Label className="settings-field-title" xalign={0}>{item.title}</Label><Label className="settings-description" xalign={0}>{item.detail}</Label></Box><Switch id={`panel-${item.key}`} active={options[item.key as 'showPinned' | 'showDate']} valign="center" onActiveChanged={widget => edit({[item.key]: widget.active})} /></Box>)}
                </Box>
                <PanelContextSettings values={draft} changed={edit} />
                {(error || info.error) && <Label className="error" wrap xalign={0}>{error || info.error}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}><Label className="settings-description" wrap xalign={0} expand>{status || (dirty ? 'Unsaved changes · Preview only' : 'Everything you need, within reach.')}</Label><Button id="panel-settings-reset" sensitive={dirty} onClicked={() => {setDraft({...saved}); setError(''); setStatus('');}}>Reset</Button><Button id="panel-settings-apply" className="settings-primary" sensitive={dirty && !info.error} onClicked={() => {try {parseCustomMenu(draft.contextCustomItems); preferences.update(id, true, {...draft}); applied(); setSaved({...draft}); setStatus('Panel updated on all displays.');} catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}}}>Apply</Button></Box>
    </Box>;
}
