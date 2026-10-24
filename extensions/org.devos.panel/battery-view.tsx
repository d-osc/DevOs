import {React, Box, Image, Label} from '@dev-os/core';
import {batteryPresentation, type BatteryContext, type BatteryStatus} from './battery.js';
export function PanelBattery({percent, status, found, acOnline, acFound}: {percent: number | null; status?: BatteryStatus} & BatteryContext) {
    // Desktops and VMs have no power supplies at all; a laptop with a missing battery still has an AC supply.
    if (found === false && !acFound && !acOnline) return null;
    const battery = batteryPresentation(percent, status, {found: found ?? (percent !== null || (status ?? 'Unknown') !== 'Unknown'), acOnline});
    return <Box id="panel-battery" className={`panel-battery ${battery.className}`} spacing={5} valign="center" tooltip={battery.tooltip}>
        <Image iconName={battery.icon} pixelSize={17} /><Label className="panel-battery-label">{battery.text}</Label>
    </Box>;
}
