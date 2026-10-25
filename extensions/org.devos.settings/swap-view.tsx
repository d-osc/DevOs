import {React, Box, Label, Image, Button, Scale, Entry, ComboBoxText, ProgressBar, GLib, useEffect, useRef, useState} from '@dev-os/core';
import {Swap, emptySwap, draftArguments, draftOf, draftProblem, formatSize, gigabytesToMiB, mibOf, swapPresets, swapTypes, type SwapAction, type SwapAlgorithm, type SwapControls, type SwapDraft, type SwapState, type SwapType} from './swap.js';

/** Memory & swap: compressed RAM swap (default, as large as RAM), a swap file on installed systems, or off. */
export function SwapSettings({controls}: {controls?: SwapControls}) {
    const [backend] = useState(() => controls ?? new Swap());
    const [state, setState] = useState<SwapState>(emptySwap), [draft, setDraft] = useState<SwapDraft>(draftOf(emptySwap)), [ready, setReady] = useState(false), [busy, setBusy] = useState(true), [error, setError] = useState(''), [done, setDone] = useState('');
    const [custom, setCustom] = useState(false), [gigabytes, setGigabytes] = useState('');
    const alive = useRef(true), editing = useRef(false), working = useRef(false);
    const request = async (action: SwapAction, ...args: string[]) => {
        working.current = true; setBusy(true); setError('');
        try {
            const next = await backend.request(action, ...args);
            if (!alive.current) return;
            setState(next); setReady(true);
            // The periodic refresh only updates the numbers; it never overwrites what is being edited.
            if (action === 'set' || !editing.current) {const fresh = draftOf(next); setDraft(fresh); setCustom(fresh.percent === null); setGigabytes(fresh.percent === null ? String(Math.round(fresh.mib / 1024 * 100) / 100) : ''); editing.current = false;}
            if (action === 'set') setDone('Swap updated.');
        } catch (reason) {if (alive.current) {setError(reason instanceof Error ? reason.message : String(reason)); setDone('');}}
        finally {working.current = false; if (alive.current) setBusy(false);}
    };
    useEffect(() => {
        alive.current = true; void request('get');
        // Usage numbers only; nothing runs while a change is being applied.
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {if (alive.current && !working.current) void request('get'); return GLib.SOURCE_CONTINUE;});
        return () => {alive.current = false; GLib.source_remove(timer); backend.destroy();};
    }, [backend]);
    const edit = (patch: Partial<SwapDraft>) => {editing.current = true; setDone(''); setDraft(current => ({...current, ...patch}));};
    const problem = ready ? draftProblem(state, draft) : '';
    const dirty = ready && JSON.stringify(draft) !== JSON.stringify(draftOf(state));
    const active = state.active, zram = active.type === 'zram';
    const usage = active.type === 'none' ? 'No swap is active.' : active.type === 'other' ? 'Swap from another source is active.' : `${formatSize(active.usedBytes)} used of ${formatSize(active.sizeBytes)} (${zram ? 'compressed RAM' : 'disk file'})`;
    const ratio = zram && active.dataBytes > 0 && active.compressedBytes > 0 ? `Compressed ${(active.dataBytes / active.compressedBytes).toFixed(1)}:1, taking ${formatSize(active.memoryBytes || active.compressedBytes)} of RAM` : '';
    const size = mibOf(state, draft);
    const fits = (percent: number) => state.memTotalMiB * percent / 100 <= (draft.type === 'file' ? Math.min(state.maxMiB, state.maxFileMiB) : state.maxMiB);
    return <Box id="swap-card" className="settings-card system-card swap-settings" spacing={28}>
        <Box orientation="vertical" spacing={8} widthRequest={260}>
            <Box spacing={10}><Image iconName="drive-harddisk-symbolic" pixelSize={23} /><Label className="section-heading" xalign={0}>Memory &amp; swap</Label></Box>
            <Label className="settings-description" xalign={0} wrap>Swap gives programs more room when memory is full. By default it is as large as your RAM, kept compressed in RAM.</Label>
            {ready && <Label id="swap-memory" className="settings-description" xalign={0}>{`Installed memory: ${formatSize(state.memTotalMiB * 1048576)}`}</Label>}
        </Box>
        <Box orientation="vertical" spacing={14} expand>
            <Box orientation="vertical" spacing={6}>
                <Label id="swap-usage" className="settings-field-title" xalign={0}>{ready ? usage : 'Reading swap…'}</Label>
                {ready && active.sizeBytes > 0 && <ProgressBar id="swap-usage-bar" className="power-charge-bar" fraction={Math.min(1, active.usedBytes / active.sizeBytes)} />}
                {ratio && <Label id="swap-ratio" className="settings-description" xalign={0}>{ratio}</Label>}
            </Box>
            <Box orientation="vertical" spacing={9}>
                {(Object.keys(swapTypes) as SwapType[]).map(id => {
                    const blocked = id === 'file' && ready && !state.fileAllowed;
                    return <Button key={id} id={`swap-type-${id}`} className={`power-mode ${draft.type === id ? 'power-mode-selected' : ''}`} sensitive={ready && !busy && !blocked} onClicked={() => edit({type: id})}>
                        <Box spacing={14}><Image iconName={draft.type === id ? 'radio-checked-symbolic' : 'radio-symbolic'} pixelSize={18} /><Box orientation="vertical" spacing={3} expand><Label className="settings-field-title" xalign={0}>{swapTypes[id].title}</Label><Label className="settings-description" xalign={0} wrap>{swapTypes[id].description}</Label></Box></Box>
                    </Button>;
                })}
            </Box>
            {ready && !state.fileAllowed && <Label id="swap-file-unavailable" className="settings-description" xalign={0} wrap>{state.fileReason}</Label>}
            {draft.type !== 'off' && <Box orientation="vertical" spacing={8}>
                <Label className="settings-field-title" xalign={0}>Size</Label>
                <Box spacing={8}>
                    {swapPresets.map(percent => <Button key={percent} id={`swap-size-${percent}`} className={`power-mode ${!custom && draft.percent === percent ? 'power-mode-selected' : ''}`} sensitive={ready && !busy && fits(percent)} onClicked={() => {setCustom(false); edit({percent});}}>{`${percent}%`}</Button>)}
                    <Button id="swap-size-custom" className={`power-mode ${custom ? 'power-mode-selected' : ''}`} sensitive={ready && !busy} onClicked={() => {setCustom(true); setGigabytes(String(Math.round(size / 1024 * 100) / 100)); edit({percent: null, mib: size});}}>Custom</Button>
                </Box>
                {custom && <Box spacing={8}><Label className="settings-description" xalign={0}>Size in GB</Label><Entry id="swap-custom-gb" widthChars={7} sensitive={!busy} text={gigabytes} onChanged={widget => {
                    const text = widget.get_text(); setGigabytes(text); const mib = gigabytesToMiB(text); edit({percent: null, mib: Number.isNaN(mib) ? 0 : mib});
                }} /></Box>}
                <Label id="swap-size-summary" className="settings-description" xalign={0}>{`${formatSize(size * 1048576)}${draft.percent !== null ? ` (${draft.percent}% of RAM)` : ''}`}</Label>
            </Box>}
            {draft.type === 'zram' && <Box spacing={12}><Box orientation="vertical" spacing={3} expand><Label className="settings-field-title" xalign={0}>Compression</Label><Label className="settings-description" xalign={0} wrap>zstd stores more in less RAM; lz4 is lighter on the processor.</Label></Box>
                <ComboBoxText id="swap-algorithm" sensitive={ready && !busy} activeId={draft.algorithm} items={[{id: 'zstd', text: 'zstd (recommended)'}, {id: 'lz4', text: 'lz4 (fastest)'}]} onChanged={widget => {const id = widget.get_active_id() as SwapAlgorithm | null; if (id && id !== draft.algorithm) edit({algorithm: id});}} /></Box>}
            {draft.type !== 'off' && <Box orientation="vertical" spacing={4}>
                <Label className="settings-field-title" xalign={0}>Swappiness</Label>
                <Label className="settings-description" xalign={0} wrap>Higher values move idle memory to swap sooner and keep more file cache. 100 suits compressed RAM; use a lower value for a disk file.</Label>
                <Scale id="swap-swappiness" expand value={draft.swappiness} lower={1} upper={200} sensitive={ready && !busy} drawValue onValueChanged={widget => {const next = Math.round(widget.get_value()); if (next !== draft.swappiness) edit({swappiness: next});}} />
            </Box>}
            {problem && <Label id="swap-problem" className="settings-description" xalign={0} wrap>{problem}</Label>}
            <Box spacing={12}><Label id="swap-note" className="settings-description" expand xalign={0} wrap>{done || (dirty ? 'Apply to use the new swap setting.' : '')}</Label>
                <Button id="swap-apply" className="settings-primary" sensitive={ready && !busy && dirty && !problem} onClicked={() => void request('set', ...draftArguments(draft))}>{busy && ready ? 'Applying…' : 'Apply'}</Button></Box>
            {error && <Label id="swap-error" className="settings-error-banner" xalign={0} wrap>{error}</Label>}
        </Box>
    </Box>;
}
