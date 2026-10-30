export type BatteryStatus = 'Charging' | 'Discharging' | 'Full' | 'Not charging' | 'Unknown';
export interface PowerReading {
    battery: number | null; batteryStatus: BatteryStatus;
    /** A battery supply exists in /sys/class/power_supply (it may still report no percentage). */
    batteryFound: boolean;
    /** An AC/USB charger supply reports online=1. */
    acOnline: boolean;
    /** Any non-battery supply exists, so this is a laptop-like machine even when the battery is missing. */
    acFound: boolean;
}
export interface PowerFs {list(path: string): string[]; read(path: string): string;}
const STATUSES = ['Charging', 'Discharging', 'Full', 'Not charging'];
const percent = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
export function batteryReading(capacity: string, status: string): {battery: number | null; batteryStatus: BatteryStatus} {
    return {battery: capacity.trim() ? percent(Number(capacity)) : null,
        batteryStatus: STATUSES.includes(status) ? status as BatteryStatus : 'Unknown'};
}
/**
 * Percentage for one supply. Some drivers (qcom_battmgr returns -ENODATA while the firmware has not reported a percentage)
 * expose status and energy/charge counters but no readable `capacity`, so fall back to now/full.
 */
function supplyPercent(read: (name: string) => string): number | null {
    const capacity = read('capacity').trim();
    const direct = capacity ? percent(Number(capacity)) : null;
    if (direct !== null) return direct;
    for (const [now, full] of [['energy_now', 'energy_full'], ['charge_now', 'charge_full'], ['energy_now', 'energy_full_design'], ['charge_now', 'charge_full_design']]) {
        const a = read(now).trim(), b = read(full).trim();
        if (!a || !b) continue;
        const total = Number(b);
        if (total > 0) { const value = percent(Number(a) / total * 100); if (value !== null) return value; }
    }
    return null;
}
export function readPower(fs: PowerFs, root = '/sys/class/power_supply'): PowerReading {
    const batteries: {percent: number | null; status: string}[] = [];
    let acOnline = false, acFound = false;
    for (const name of fs.list(root).sort()) {
        const read = (file: string) => fs.read(`${root}/${name}/${file}`);
        const type = read('type').trim();
        if (type === 'Battery') {
            // Peripheral batteries (mouse, headset) report scope=Device and must not be shown as the laptop battery.
            if (read('scope').trim() === 'Device' || read('present').trim() === '0') continue;
            batteries.push({percent: supplyPercent(read), status: read('status').trim()});
        } else if (type) {
            acFound = true;
            if (read('online').trim() === '1') acOnline = true;
        }
    }
    const chosen = batteries.find(item => item.percent !== null) ?? batteries[0];
    if (!chosen) return {battery: null, batteryStatus: 'Unknown', batteryFound: false, acOnline, acFound};
    let batteryStatus = batteryReading('', chosen.status).batteryStatus;
    // Firmware sometimes reports Unknown while the charger is connected.
    if (batteryStatus === 'Unknown' && acOnline) batteryStatus = 'Not charging';
    return {battery: chosen.percent, batteryStatus, batteryFound: true, acOnline, acFound};
}
export interface BatteryContext {found?: boolean; acOnline?: boolean; acFound?: boolean;}
export function batteryPresentation(percent: number | null, status: BatteryStatus = 'Unknown', context: BatteryContext = {}) {
    const found = context.found ?? true, charging = status === 'Charging';
    const plugged = charging || status === 'Full' || status === 'Not charging';
    if (!found) {
        const detail = context.acOnline ? 'AC adapter connected, but the kernel exposes no battery' : 'The kernel exposes no battery (check devos-battery-report)';
        return {icon: 'battery-unknown-symbolic', text: 'No battery data', tooltip: `Battery · No data · ${detail}`, className: 'panel-battery-unknown'};
    }
    const level = percent === null ? 'unknown' : percent <= 10 ? 'caution' : percent <= 25 ? 'low' : percent >= 90 ? 'full' : 'good';
    const label = status === 'Not charging' ? 'Plugged in' : status === 'Unknown' ? 'Status unavailable' : status;
    const icon = level === 'unknown' ? charging ? 'battery-good-charging' : 'battery-unknown' : `battery-${level}${charging ? '-charging' : ''}`;
    const text = percent === null ? label : `${percent}%${plugged ? ` · ${label}` : ''}`;
    return {icon: `${icon}-symbolic`, text,
        tooltip: `Battery · ${percent === null ? 'Percentage not reported by the firmware' : `${percent}%`} · ${label}`,
        className: charging ? 'panel-battery-charging' : percent === null ? 'panel-battery-unknown' : percent <= 20 && !plugged ? 'panel-battery-low' : 'panel-battery-normal'};
}
