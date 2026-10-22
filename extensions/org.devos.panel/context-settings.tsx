import {React, Box, Label, Image, Switch, type SettingsValues} from '@dev-os/core';
import {panelMenuItems} from './context-menu.js';
import {CustomMenuSettings} from '../org.devos.files/custom-menu-settings.js';
import {parseCustomMenu, customMenuMatches} from '../org.devos.files/custom-menu.js';
export function PanelContextSettings({values, changed}: {values: SettingsValues; changed(values: SettingsValues): void}) {
    const enabled = values.contextEnabled !== false;
    let custom: ReturnType<typeof parseCustomMenu> = [];
    try {custom = parseCustomMenu(values.contextCustomItems).filter(item => customMenuMatches(item, 'background'));} catch { /* Editor below displays validation errors. */ }
    const defaults = panelMenuItems.filter(item => values[item.key] !== false);
    return <Box orientation="vertical" spacing={16}>
        <Box className="settings-card panel-settings-card" orientation="vertical" spacing={16}>
            <Box spacing={12}><Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>Panel right-click menu</Label><Label className="settings-description" wrap xalign={0}>Right-click the panel or its buttons on any display.</Label></Box><Switch id="panel-context-enabled" active={enabled} valign="center" onActiveChanged={widget => changed({contextEnabled: widget.active})} /></Box>
            <Label className="settings-eyebrow" xalign={0}>MENU PREVIEW</Label>
            <Box className="files-menu-preview" orientation="vertical" spacing={2}>
                {enabled && (defaults.length + custom.length) > 0 ? <Box orientation="vertical">{defaults.map(item => <Box key={item.key} id={`panel-preview-${item.key}`} className="files-preview-menu-row" spacing={10}><Image iconName={item.icon} pixelSize={15} /><Label xalign={0}>{item.title}</Label></Box>)}{custom.map(item => <Box key={item.id} id={`panel-preview-${item.id}`} className="files-preview-menu-row" spacing={10}><Image iconName="system-run-symbolic" pixelSize={15} /><Label xalign={0}>{item.title}</Label></Box>)}</Box> : <Label className="settings-description" xalign={0}>{enabled ? 'No actions selected' : 'Panel context menu is off'}</Label>}
            </Box>
            <Label className="settings-description" wrap xalign={0}>Default actions can be turned on or off. They cannot be edited or removed.</Label>
            {panelMenuItems.map(item => <Box key={item.key} spacing={12} sensitive={enabled}><Image iconName={item.icon} pixelSize={17} /><Label className="settings-field-title" xalign={0} expand>{item.title}</Label><Label className="settings-eyebrow">DEFAULT</Label><Switch id={`panel-option-${item.key}`} active={values[item.key] !== false} valign="center" onActiveChanged={widget => changed({[item.key]: widget.active})} /></Box>)}
        </Box>
        <CustomMenuSettings value={values.contextCustomItems} changed={value => changed({contextCustomItems: value})} applyTarget="Panel" backgroundOnly />
    </Box>;
}
