import {edgeActive, edgeAlpha, edgeBand, localRect, contains, refreshColors} from '../extensions/org.devos.displaycare/dim.js';
import {shiftMargins, pixelShiftSteps} from '../extensions/org.devos.displaycare/panel-care.js';
function assert(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}

assert(edgeAlpha(0) === 0 && edgeAlpha(1) < edgeAlpha(2) && edgeAlpha(2) < edgeAlpha(3) && edgeAlpha(3) < edgeAlpha(4) && edgeAlpha(4) <= 0.5 && edgeAlpha(9) === edgeAlpha(4), 'Edge strength grows with the level and is capped');
assert(edgeActive(2, {present: true, onBattery: true}) && !edgeActive(2, {present: true, onBattery: false}) && !edgeActive(0, {present: true, onBattery: true}) && !edgeActive(2, {present: false, onBattery: false}), 'Adaptive Edge Brightness only runs on battery with a level above 0');
assert(edgeBand(1920, 1200) === 96, 'The band is 8% of the shorter side');
const local = localRect({x: 1020, y: 90, width: 800, height: 600}, {x: 1920, y: 0, width: 1920, height: 1044});
assert(local.x === -900 && local.y === 90, 'Window rectangles are translated into the work area of their output');
assert(contains({x: 1920, y: 0, width: 1920, height: 1200}, 1921, 1) && !contains({x: 1920, y: 0, width: 1920, height: 1200}, 100, 1), 'A work area is matched to its monitor');
assert(refreshColors.length === 5 && refreshColors[0].join() === '1,1,1' && refreshColors[4].join() === '0,0,0', 'Pixel refresh walks white, the primaries and black');
// Pixel Shift keeps the content size constant, stays within 0..2 px and visits every position.
const seen = new Set<string>();
for (let step = 0; step < pixelShiftSteps.length * 2; step++) {
    const [left, right, top, bottom] = shiftMargins(step);
    assert(left + right === 2 && top + bottom === 2 && [left, right, top, bottom].every(value => value >= 0 && value <= 2), 'Margins keep the size and stay inside 0..2 px');
    seen.add(`${left},${top}`);
}
assert(seen.size === 9, 'Pixel Shift visits all nine positions');
print('PASS: display care shell rules (edge dimming, Target Mode geometry, Pixel refresh colours, Pixel Shift)');
