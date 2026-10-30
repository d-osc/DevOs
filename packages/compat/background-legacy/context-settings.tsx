import {React, Box, Label, Image, Switch, type SettingsValues} from '@dev-os/core';
import {backgroundMenuItems} from './context-menu.js';
import {CustomMenuSettings} from '../../../src/apps/org.devos.files/custom-menu-settings.js';
import {parseCustomMenu, customMenuMatches} from '../../../src/apps/org.devos.files/custom-menu.js';
export function BackgroundContextSettings({values, changed}: {values: SettingsValues; changed(values: SettingsValues): void}) {
    const enabled = values.contextEnabled !== false;
    let custom: ReturnType<typeof parseCustomMenu> = [];
    try {custom = parseCustomMenu(values.contextCustomItems).filter(item => customMenuMatches(item, 'background'));} catch { /* Editor below displays the error. */ }
    const defaults = backgroundMenuItems.filter(item => values[item.key] !== false);
    return <Box orientation="vertical" spacing={16}>
        <Box className="settings-card background-settings-card" orientation="vertical" spacing={16}>
            <Box spacing={12}><Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>Desktop right-click menu</Label><Label className="settings-description" wrap xalign={0}>Right-click empty desktop space on any display.</Label></Box><Switch id="background-context-enabled" active={enabled} valign="center" onActiveChanged={widget => changed({contextEnabled: widget.active})} /></Box>
            <Label className="settings-eyebrow" xalign={0}>MENU PREVIEW</Label>
            <Box className="files-menu-preview" orientation="vertical" spacing={2}>
                {enabled && (defaults.length + custom.length) > 0 ? <Box orientation="vertical">{defaults.map(item => <Box key={item.key} id={`background-preview-${item.key}`} className="files-preview-menu-row" spacing={10}><Image iconName={item.icon} pixelSize={15} /><Label xalign={0}>{item.title}</Label></Box>)}{custom.map(item => <Box key={item.id} id={`background-preview-${item.id}`} className="files-preview-menu-row" spacing={10}><Image iconName="system-run-symbolic" pixelSize={15} /><Label xalign={0}>{item.title}</Label></Box>)}</Box> : <Label className="settings-description" xalign={0}>{enabled ? 'No actions selected' : 'Desktop context menu is off'}</Label>}
            </Box>
            <Label className="settings-description" wrap xalign={0}>Default actions can be turned on or off. They cannot be edited or removed.</Label>
            {backgroundMenuItems.map(item => <Box key={item.key} spacing={12} sensitive={enabled}><Image iconName={item.icon} pixelSize={17} /><Label className="settings-field-title" xalign={0} expand>{item.title}</Label><Label className="settings-eyebrow">DEFAULT</Label><Switch id={`background-option-${item.key}`} active={values[item.key] !== false} valign="center" onActiveChanged={widget => changed({[item.key]: widget.active})} /></Box>)}
        </Box>
        <CustomMenuSettings value={values.contextCustomItems} changed={value => changed({contextCustomItems: value})} applyTarget="Background" backgroundOnly />
    </Box>;
}
