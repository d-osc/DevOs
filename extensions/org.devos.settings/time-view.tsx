import {React, Gtk, GLib, Box, Label, Button, Image, Switch, Entry, SearchEntry, ListBox, ListBoxRow, ScrolledWindow, useState, useEffect} from '@dev-os/core';
import {LinuxTime, type TimeControls, type TimeState, type TimeAction} from './time.js';

function localNow(zone: string) {return GLib.DateTime.new_now(GLib.TimeZone.new_identifier(zone) ?? GLib.TimeZone.new_utc());}
export function TimeSettings({controls, showClock}: {controls?: TimeControls; showClock?(): void}) {
    const [backend] = useState(() => controls ?? new LinuxTime());
    const [state, setState] = useState<TimeState | null>(null);
    const [zone, setZone] = useState('UTC'), [query, setQuery] = useState('');
    const [automatic, setAutomatic] = useState(false);
    const [date, setDate] = useState(''), [time, setTime] = useState('');
    const [now, setNow] = useState(() => GLib.DateTime.new_now_local());
    const [busy, setBusy] = useState(true), [error, setError] = useState(''), [status, setStatus] = useState('');
    const accept = (next: TimeState) => {setState(next); setZone(next.timezone); setAutomatic(next.ntp); const local = localNow(next.timezone); setDate(local.format('%Y-%m-%d') ?? ''); setTime(local.format('%H:%M') ?? '');};
    useEffect(() => {
        let alive = true;
        void backend.load().then(next => {if (alive) {accept(next); setBusy(false);}}).catch(reason => {if (alive) {setError(String(reason)); setBusy(false);}});
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {setNow(GLib.DateTime.new_now_local()); return GLib.SOURCE_CONTINUE;});
        return () => {alive = false; GLib.source_remove(timer); backend.destroy();};
    }, [backend]);
    const perform = async (action: TimeAction) => {
        setBusy(true); setError(''); setStatus('');
        try {accept(await backend.update(action)); setStatus(action.action === 'set-timezone' ? 'Time zone updated.' : action.action === 'set-ntp' ? 'Automatic time updated.' : 'Date and time updated.');}
        catch (reason) {setAutomatic(state?.ntp ?? false); setError(reason instanceof Error ? reason.message : String(reason));}
        finally {setBusy(false);}
    };
    const refresh = async () => {setBusy(true); setError(''); setStatus(''); try {accept(await backend.load());} catch (reason) {setError(String(reason));} finally {setBusy(false);}};
    const local = (state?.available ? now.to_timezone(GLib.TimeZone.new_identifier(state.timezone) ?? GLib.TimeZone.new_utc()) : now) ?? now;
    const managed = state?.hostManaged === true;
    const editable = !!state?.available && !busy;
    const zones = (state?.zones ?? []).filter(item => item.replaceAll('_', ' ').toLowerCase().includes(query.toLowerCase().trim()));
    return <Box className="settings-content" orientation="vertical" expand fill>
        <Box className="settings-page-header" spacing={14}><Box orientation="vertical" spacing={8} expand><Label className="settings-eyebrow" xalign={0}>DATE &amp; TIME</Label><Label className="heading" xalign={0}>Time</Label><Label className="settings-description" xalign={0}>Keep your system clock and time zone in sync.</Label></Box><Button id="time-refresh" valign="center" tooltip="Refresh time service status" sensitive={!busy} onClicked={() => {void refresh();}}><Image iconName="view-refresh-symbolic" pixelSize={18} /></Button></Box>
        <ScrolledWindow expand fill minContentHeight={240} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
            <Box className="settings-form" orientation="vertical" spacing={16}>
                <Box className="clock-preview-card" orientation="vertical" spacing={10}><Box spacing={10}><Image iconName="preferences-system-time-symbolic" pixelSize={20} /><Label className="settings-description" xalign={0} expand>{state?.timezone ?? 'System time'}</Label><Label id="time-sync-state" className="settings-badge">{managed ? 'WINDOWS CLOCK' : state?.synchronized ? 'SYNCHRONIZED' : 'NOT SYNCHRONIZED'}</Label></Box><Label id="time-live-clock" className="clock-preview-time" xalign={0}>{local.format('%H:%M:%S')}</Label><Label className="settings-description" xalign={0}>{local.format('%A, %d %B %Y · UTC%:z')}</Label></Box>
                {managed && <Box className="settings-card time-card" orientation="vertical" spacing={10}><Label className="section-heading" xalign={0}>Windows manages this clock</Label><Label className="settings-description" xalign={0} wrap>DevOs is running in WSL. Change the system date and automatic time in Windows; the Linux time zone can still be changed when its time service is available.</Label><Button id="time-host-settings" sensitive={!busy} onClicked={() => {setBusy(true); setError(''); void backend.openHostSettings().catch(reason => setError(String(reason))).finally(() => setBusy(false));}}><Label>Open Windows time settings</Label></Button></Box>}
                <Box className="settings-card time-card" orientation="vertical" spacing={12}><Label className="section-heading" xalign={0}>Time zone</Label><Label className="settings-description" xalign={0} wrap>Choose the region used to display the local date and time.</Label><SearchEntry id="time-zone-search" placeholder="Search time zones…" sensitive={editable} text={query} onChanged={widget => setQuery(widget.get_text())} /><Label id="time-zone-selected" className="settings-description" xalign={0} wrap>{zone === state?.timezone ? `Current time zone: ${zone.replaceAll('_', ' ')}` : `Selected: ${zone.replaceAll('_', ' ')} — click Apply time zone to use it.`}</Label><ScrolledWindow className="time-zone-list" minContentHeight={200} maxContentHeight={260} hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>{zones.length ? <ListBox id="time-zone" selectionMode={Gtk.SelectionMode.NONE} activateOnSingleClick sensitive={editable} onRowActivated={(_list, row) => {const id = zones[row.get_index()]; if (id) {setZone(id); setStatus('');}}}>{zones.map(id => <ListBoxRow key={id} id={`time-zone-${id}`}><Box spacing={10} borderWidth={8}><Label xalign={0} expand>{id.replaceAll('_', ' ')}</Label>{id === zone && <Image iconName="object-select-symbolic" pixelSize={16} />}</Box></ListBoxRow>)}</ListBox> : <Box borderWidth={12}><Label id="time-zone-empty" className="settings-description" xalign={0}>No time zones match your search.</Label></Box>}</ScrolledWindow><Button id="time-apply-zone" sensitive={editable && zone !== state?.timezone} onClicked={() => {void perform({action: 'set-timezone', timezone: zone});}}><Label>Apply time zone</Label></Button></Box>
                <Box className="settings-card time-card" orientation="vertical" spacing={10}><Box spacing={16}><Box orientation="vertical" spacing={5} expand><Label className="section-heading" xalign={0}>Set time automatically</Label><Label className="settings-description" xalign={0} wrap>Synchronize the system clock with network time servers.</Label></Box><Switch id="time-automatic" active={automatic} sensitive={editable && !managed && state?.canNtp === true} onActiveChanged={widget => {if (!busy && !managed && widget.active !== automatic) {setAutomatic(widget.active); void perform({action: 'set-ntp', enabled: widget.active});}}} /></Box>{state?.available && !state.canNtp && !managed && <Label className="settings-description" xalign={0} wrap>No network time synchronization service is installed.</Label>}</Box>
                <Box className="settings-card time-card" orientation="vertical" spacing={12}><Label className="section-heading" xalign={0}>Set date and time</Label><Label className="settings-description" xalign={0} wrap>{managed ? 'The system date and time are controlled by Windows.' : state?.ntp ? 'Turn off automatic time before setting the clock manually.' : `Enter the local date and time for ${state?.timezone ?? 'your time zone'}.`}</Label><Box spacing={12}><Box orientation="vertical" spacing={6} expand><Label className="settings-description" xalign={0}>Date · YYYY-MM-DD</Label><Entry id="time-date" text={date} sensitive={editable && !managed && !state?.ntp} onChanged={widget => setDate(widget.get_text())} /></Box><Box orientation="vertical" spacing={6} expand><Label className="settings-description" xalign={0}>Time · HH:MM (24-hour)</Label><Entry id="time-value" text={time} sensitive={editable && !managed && !state?.ntp} onChanged={widget => setTime(widget.get_text())} /></Box></Box><Button id="time-set-manual" sensitive={editable && !managed && !state?.ntp && !!date && !!time} onClicked={() => {void perform({action: 'set-time', date, time});}}><Label>Set date &amp; time</Label></Button></Box>
                {showClock && <Button id="time-clock-settings" onClicked={showClock}><Box spacing={10}><Image iconName="preferences-system-time-symbolic" pixelSize={18} /><Label xalign={0} expand>Panel clock appearance</Label><Image iconName="go-next-symbolic" pixelSize={14} /></Box></Button>}
                {state?.error && <Label id="time-service-error" className="settings-error-banner" xalign={0} wrap>{state.error}</Label>}
                {error && <Label id="time-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
                {status && <Label id="time-status" className="settings-description" xalign={0} wrap>{status}</Label>}
                <Label className="settings-description" xalign={0} wrap>{busy ? 'Loading / updating time settings…' : 'Changing system time settings may require authentication.'}</Label>
            </Box>
        </ScrolledWindow>
    </Box>;
}
