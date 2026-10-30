import assert from 'node:assert/strict';
import {batteryReading, batteryPresentation, readPower} from '../src/system/org.devos.panel/battery.ts';

const ROOT = '/sys/class/power_supply';
/** In-memory /sys/class/power_supply: {supply: {attribute: value}}; missing attributes read as '' like unreadable sysfs files. */
const fixture = supplies => ({
    list: path => path === ROOT ? Object.keys(supplies) : [],
    read: path => supplies[path.split('/')[4]]?.[path.split('/')[5]] ?? ''
});
const shown = (supplies) => {
    const power = readPower(fixture(supplies));
    return {power, view: batteryPresentation(power.battery, power.batteryStatus, {found: power.batteryFound, acOnline: power.acOnline})};
};

// batteryReading
assert.equal(batteryReading('', 'Charging').battery, null, 'Missing capacity must not become 0%');
for (const value of ['bad', '-1', '101', 'Infinity']) assert.equal(batteryReading(value, 'Unknown').battery, null);
assert.deepEqual(batteryReading('72', 'Charging'), {battery: 72, batteryStatus: 'Charging'});

// Laptop with charging battery (ACPI names)
let {power, view} = shown({BAT0: {type: 'Battery', status: 'Charging', capacity: '72', present: '1'}, AC: {type: 'Mains', online: '1'}});
assert.deepEqual([power.battery, power.batteryStatus, power.acOnline], [72, 'Charging', true]);
assert.equal(view.text, '72% · Charging'); assert.equal(view.icon, 'battery-good-charging-symbolic'); assert.equal(view.className, 'panel-battery-charging');

// Discharging, low and normal
({view} = shown({BAT0: {type: 'Battery', status: 'Discharging', capacity: '30'}, AC: {type: 'Mains', online: '0'}}));
assert.equal(view.text, '30%'); assert.equal(view.icon, 'battery-good-symbolic'); assert.equal(view.className, 'panel-battery-normal');
({view} = shown({BAT0: {type: 'Battery', status: 'Discharging', capacity: '9'}}));
assert.equal(view.icon, 'battery-caution-symbolic'); assert.equal(view.className, 'panel-battery-low');
({view} = shown({BAT0: {type: 'Battery', status: 'Discharging', capacity: '22'}}));
assert.equal(view.icon, 'battery-low-symbolic');

// Full on AC, and "Not charging" (charge limit)
({view} = shown({BAT0: {type: 'Battery', status: 'Full', capacity: '100'}, AC: {type: 'Mains', online: '1'}}));
assert.equal(view.text, '100% · Full'); assert.equal(view.icon, 'battery-full-symbolic');
({view} = shown({BAT0: {type: 'Battery', status: 'Not charging', capacity: '80'}, AC: {type: 'Mains', online: '1'}}));
assert.equal(view.text, '80% · Plugged in');

// Only energy_now/energy_full (and charge_now/charge_full): the percentage is computed
({power} = shown({BAT0: {type: 'Battery', status: 'Discharging', energy_now: '25000000', energy_full: '50000000'}}));
assert.equal(power.battery, 50);
({power} = shown({BAT0: {type: 'Battery', status: 'Discharging', charge_now: '1234000', charge_full: '4936000'}}));
assert.equal(power.battery, 25);
({power} = shown({BAT0: {type: 'Battery', status: 'Discharging', energy_now: '1', energy_full: '0'}}));
assert.equal(power.battery, null, 'Zero full energy must not divide by zero');
({power} = shown({BAT0: {type: 'Battery', status: 'Discharging', energy_now: '70', energy_full: '50'}}));
assert.equal(power.battery, null, 'Impossible counters must not become a percentage');

// UX3407NA style: qcom_battmgr returns -ENODATA for capacity until firmware reports it, status stays readable
({power, view} = shown({'qcom-battmgr-bat': {type: 'Battery', status: 'Charging', present: '1'}, 'qcom-battmgr-ac': {type: 'Mains', online: '1'}, 'qcom-battmgr-usb': {type: 'USB', online: '0'}}));
assert.deepEqual([power.battery, power.batteryStatus, power.batteryFound], [null, 'Charging', true]);
assert.equal(view.text, 'Charging'); assert.equal(view.icon, 'battery-good-charging-symbolic');
assert.match(view.tooltip, /Percentage not reported/);
({view} = shown({'qcom-battmgr-bat': {type: 'Battery', status: 'Discharging', present: '1'}, 'qcom-battmgr-ac': {type: 'Mains', online: '0'}}));
assert.equal(view.icon, 'battery-unknown-symbolic'); assert.equal(view.className, 'panel-battery-unknown'); assert.equal(view.text, 'Discharging');
// ...and the same names with a normal capacity
({power} = shown({'qcom-battmgr-bat': {type: 'Battery', status: 'Discharging', capacity: '64', present: '1'}, 'qcom-battmgr-ac': {type: 'Mains', online: '0'}}));
assert.equal(power.battery, 64);
// Charger connected through USB-C only
({power, view} = shown({'qcom-battmgr-bat': {type: 'Battery', status: 'Unknown', capacity: '55'}, 'qcom-battmgr-usb': {type: 'USB', online: '1'}}));
assert.equal(power.acOnline, true); assert.equal(power.batteryStatus, 'Not charging'); assert.equal(view.text, '55% · Plugged in');

// Real UX3407NA values (build/live-usb/hardware-logs-20261024-1017, battery-report.txt): no capacity file at all,
// charge_* unreadable (ENODATA), the charger reported online by qcom-battmgr-usb and the UCSI source, qcom-battmgr-ac offline.
({power, view} = shown({
    'qcom-battmgr-ac': {type: 'Mains', online: '0'},
    'qcom-battmgr-bat': {type: 'Battery', present: '1', status: 'Charging', energy_now: '68357000', energy_full: '70857000', energy_full_design: '70016000', voltage_now: '13424000', power_now: '13289000', cycle_count: '8', technology: 'Li-ion'},
    'qcom-battmgr-usb': {type: 'USB', online: '1'}, 'qcom-battmgr-wls': {type: 'Wireless', online: '0'},
    'ucsi-source-psy-pmic_glink.ucsi.01': {type: 'USB', scope: 'System', status: 'Not charging', online: '1'},
    'ucsi-source-psy-pmic_glink.ucsi.02': {type: 'USB', scope: 'System', status: 'Not charging', online: '0'}}));
assert.deepEqual([power.battery, power.batteryStatus, power.acOnline], [96, 'Charging', true]);
assert.equal(view.text, '96% · Charging'); assert.equal(view.icon, 'battery-full-charging-symbolic');

// No battery, AC only: explicit "no battery data" state, never a slash glyph
({power, view} = shown({'qcom-battmgr-ac': {type: 'Mains', online: '1'}}));
assert.deepEqual([power.batteryFound, power.acFound, power.acOnline], [false, true, true]);
assert.equal(view.text, 'No battery data'); assert.equal(view.icon, 'battery-unknown-symbolic'); assert.match(view.tooltip, /AC adapter connected/);
assert.ok(!view.icon.includes('missing'));
// No power supplies at all (desktop, VM): nothing found, the panel hides the indicator
({power} = shown({}));
assert.deepEqual([power.batteryFound, power.acFound], [false, false]);

// Peripheral batteries and absent batteries are ignored
({power} = shown({'hid-0003-battery': {type: 'Battery', scope: 'Device', status: 'Discharging', capacity: '5'}, BAT1: {type: 'Battery', present: '0', status: 'Unknown'}}));
assert.equal(power.batteryFound, false);
({power} = shown({'hid-0003-battery': {type: 'Battery', scope: 'Device', status: 'Discharging', capacity: '5'}, BAT0: {type: 'Battery', status: 'Discharging', capacity: '61'}}));
assert.equal(power.battery, 61);
// Two internal batteries: prefer the one that reports a percentage
({power} = shown({BAT0: {type: 'Battery', status: 'Discharging'}, BAT1: {type: 'Battery', status: 'Discharging', capacity: '40'}}));
assert.equal(power.battery, 40);

// Remaining presentation cases
assert.equal(batteryPresentation(80, 'Not charging').text, '80% · Plugged in');
assert.equal(batteryPresentation(9, 'Charging').className, 'panel-battery-charging');
assert.match(batteryPresentation(45).tooltip, /Status unavailable/);
console.log('PASS: battery fixtures (charging, discharging, full, energy-only, qcom-battmgr, AC-only, none), icons and text');
