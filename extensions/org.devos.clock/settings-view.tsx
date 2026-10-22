import {React, GLib, Gtk, Box, Grid, Label, Button, Entry, Switch, Image, ScrolledWindow, useState, useEffect, type SettingsHost} from '@dev-os/core';
import {clockDisplayFormat} from '@dev-os/extensions';

const id = 'org.devos.clock';
export const clockPresets = [
    {id: '24-hour', title: '24-hour', description: 'Clean and familiar', format: '%H:%M', icon: 'preferences-system-time-symbolic'},
    {id: '12-hour', title: '12-hour', description: 'With AM or PM', format: '%I:%M %p', icon: 'weather-clear-symbolic'},
    {id: 'date-time', title: 'Date & time', description: 'Keep the day in view', format: '%a %d %b  ·  %H:%M', icon: 'x-office-calendar-symbolic'},
    {id: 'compact', title: 'Compact date', description: 'A little more context', format: '%d/%m  ·  %H:%M', icon: 'view-list-symbolic'},
] as const;
export interface ClockSettingsServices {preferences: SettingsHost; fallback: string; applied(): void;}
export function ClockSettings({preferences, fallback, applied}: ClockSettingsServices) {
    const info = preferences.get(id);
    const initial = {enabled: info.state.enabled, format: String(info.state.values.format), seconds: info.state.values.showSeconds === true};
    const [saved, setSaved] = useState(initial);
    const [draft, setDraft] = useState(initial);
    const [now, setNow] = useState(() => GLib.DateTime.new_now_local());
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    useEffect(() => {
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => { setNow(GLib.DateTime.new_now_local()); return GLib.SOURCE_CONTINUE; });
        return () => { GLib.source_remove(timer); };
    }, []);
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    const format = clockDisplayFormat(draft.format, draft.seconds);
    let example: string | null = null;
    try { if (draft.format.trim()) example = now.format(format); } catch { /* Invalid custom format stays a draft. */ }
    const edit = (next: Partial<typeof draft>) => { setDraft(current => ({...current, ...next})); setError(''); setStatus(''); };
    const twelve = /%[IlpPr]/.test(draft.format);
    const hero = now.format(`${twelve ? '%I' : '%H'}:%M${draft.seconds ? ':%S' : ''}`) ?? '';
    const selected = clockPresets.find(preset => preset.format === draft.format);
    const save = () => {
        if (!example) { setError('Enter a valid clock format before applying.'); return; }
        try {
            preferences.update(id, draft.enabled, {format: draft.format, showSeconds: draft.seconds});
            applied(); setSaved({...draft}); setStatus(draft.enabled ? 'Clock updated on all displays.' : 'Using the Desktop clock format.');
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    return <Box className="settings-content clock-settings-page" orientation="vertical" expand fill>
        <Box className="settings-page-header" orientation="vertical" spacing={6}>
            <Label className="settings-eyebrow" xalign={0}>PERSONALIZATION / TIME</Label>
            <Label className="heading" xalign={0}>Clock</Label>
            <Label className="settings-description" xalign={0}>A little detail that keeps your day in rhythm.</Label>
        </Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={18}>
                <Box className="clock-preview-card" orientation="vertical" spacing={12}>
                    <Box spacing={8}><Box className="clock-live-dot" widthRequest={7} heightRequest={7} valign="center" /><Label className="clock-preview-eyebrow" xalign={0} expand>LIVE PREVIEW</Label><Label className="clock-zone">{now.format('%Z · UTC%:z')}</Label></Box>
                    <Box spacing={12} valign="center">
                        <Label id="clock-live-time" className="clock-preview-time" xalign={0}>{hero}</Label>
                        {twelve && <Label className="clock-period" valign="center">{now.format('%p')}</Label>}
                    </Box>
                    <Label className="clock-preview-date" xalign={0}>{now.format('%A, %d %B %Y')}</Label>
                    <Box className="clock-panel-preview" spacing={10}>
                        <Image iconName="preferences-system-time-symbolic" pixelSize={15} valign="center" />
                        <Label className="settings-description" xalign={0}>Panel preview</Label>
                        <Label id="clock-panel-example" className="clock-panel-example" xalign={1} expand wrap>{example || 'Choose a valid format'}</Label>
                    </Box>
                </Box>
                <Box className="settings-card clock-settings-card" orientation="vertical" spacing={12}>
                    <Box spacing={14}>
                        <Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>Customize the panel clock</Label><Label className="settings-description" wrap xalign={0}>Use your clock style on every display.</Label></Box>
                        <Switch id="settings-enable-extension" active={draft.enabled} valign="center" onActiveChanged={widget => edit({enabled: widget.active})} />
                    </Box>
                    {!draft.enabled && <Label id="clock-disabled-notice" className="clock-notice" xalign={0} wrap>{`Preview your style below. Turn this on to replace the Desktop clock (${now.format(fallback) ?? fallback}).`}</Label>}
                </Box>
                <Box orientation="vertical" spacing={10}>
                    <Box spacing={8}><Label className="section-heading" xalign={0} expand>Choose your style</Label><Label className="settings-description">{selected?.title ?? 'Custom'}</Label></Box>
                    <Grid columnSpacing={12} rowSpacing={12}>
                        {clockPresets.map((preset, index) => <Button key={preset.id} id={`clock-preset-${preset.id}`} gridLeft={index % 2} gridTop={Math.floor(index / 2)} hexpand fill className={`clock-preset ${preset.format === draft.format ? 'clock-preset-selected' : ''}`} onClicked={() => edit({format: preset.format})}>
                            <Box orientation="vertical" spacing={9}>
                                <Box spacing={8}><Image iconName={preset.icon} pixelSize={16} /><Label className="clock-preset-title" xalign={0} expand>{preset.title}</Label><Image iconName={preset.format === draft.format ? 'emblem-ok-symbolic' : 'radio-symbolic'} pixelSize={14} /></Box>
                                <Label className="clock-preset-time" xalign={0} wrap>{now.format(clockDisplayFormat(preset.format, draft.seconds))}</Label>
                                <Label className="settings-description" xalign={0}>{preset.description}</Label>
                            </Box>
                        </Button>)}
                    </Grid>
                </Box>
                <Box className="settings-card clock-settings-card" orientation="vertical" spacing={14}>
                    <Box spacing={14}><Box orientation="vertical" spacing={5} expand><Label className="settings-field-title" xalign={0}>Show seconds</Label><Label className="settings-description" xalign={0} wrap>Add seconds to your selected time format.</Label></Box><Switch id="settings-field-showSeconds" active={draft.seconds} onActiveChanged={widget => edit({seconds: widget.active})} /></Box>
                    <Box className="clock-custom-section" orientation="vertical" spacing={8}>
                        <Label className="settings-field-title" xalign={0}>Custom format</Label>
                        <Entry id="settings-field-format" className="settings-code-input" text={draft.format} onChanged={widget => edit({format: widget.get_text()})} />
                        <Label className="settings-description" xalign={0} wrap>%H  24-hour  ·  %I  12-hour  ·  %M  minutes  ·  %S  seconds  ·  %p  AM/PM  ·  %a  weekday</Label>
                    </Box>
                </Box>
                <Box spacing={8}><Image iconName="dialog-information-symbolic" pixelSize={15} valign="start" /><Label className="settings-description" xalign={0} wrap>Time and timezone follow your system. These settings only change how the panel clock is displayed.</Label></Box>
                {(error || info.error || !example) && <Label id="clock-settings-error" className="error" xalign={0} wrap>{error || info.error || 'Enter a valid clock format.'}</Label>}
            </Box>
        </ScrolledWindow>
        <Box className="settings-action-bar" spacing={12}>
            <Image iconName={dirty ? 'document-edit-symbolic' : 'emblem-ok-symbolic'} pixelSize={15} />
            <Label id="clock-settings-status" className="settings-description" xalign={0} expand wrap>{status || (dirty ? 'Unsaved changes · Preview only' : 'Your clock, your way.')}</Label>
            <Button id="settings-reset" sensitive={dirty} onClicked={() => { setDraft({...saved}); setError(''); setStatus(''); }}>Reset</Button>
            <Button id="clock-settings-apply" className="settings-primary" sensitive={dirty && Boolean(example) && !info.error} onClicked={save}>Apply</Button>
        </Box>
    </Box>;
}
