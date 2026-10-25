import {React, Box, Label, Switch} from '@dev-os/core';
/** A switch with its state text next to it. `onToggled` only fires when the user changes the switch, not when `active` is updated. */
export function SwitchRow({id, stateId, active, sensitive, label, onToggled}: {id: string; stateId: string; active: boolean; sensitive: boolean; label: string; onToggled: (active: boolean) => void}) {
    return <Box spacing={12}><Switch id={id} active={active} sensitive={sensitive} onActiveChanged={w => {if (w.active !== active) onToggled(w.active);}} /><Label id={stateId} className="settings-description">{label}</Label></Box>;
}
