import type {DesktopWindow, SnapGroup} from './windows.js';
export interface SnapCell {id: number; x: number; y: number; width: number; height: number;}
export interface SnapDivider {axis: 'x' | 'y'; index: number; position: number;}
export function snapCuts(group: SnapGroup) {
    return group.cuts ?? (group.layout === 'thirds' ? [3300, 6700] : group.layout === 'wide-left' ? [6700] : group.layout === 'wide-right' ? [3300] : [5000]);
}
export function snapCells(group: SnapGroup): SnapCell[] {
    const xs = [0, ...snapCuts(group), 10000], row = group.row ?? 5000;
    return group.members.map(member => {
        const name = member.region.replace('devos-', '');
        const column = name.endsWith('left') ? 0 : name.endsWith('center') ? 1 : xs.length - 2;
        const bottom = name.includes('bottom');
        return {id: member.id, x: xs[column], y: group.layout === 'quarters' && bottom ? row : 0,
            width: xs[column + 1] - xs[column], height: group.layout === 'quarters' ? bottom ? 10000 - row : row : 10000};
    });
}
export function snapDividers(group: SnapGroup): SnapDivider[] {
    return [...snapCuts(group).map((position, index) => ({axis: 'x' as const, index, position})),
        ...(group.layout === 'quarters' ? [{axis: 'y' as const, index: 0, position: group.row ?? 5000}] : [])];
}
export function resizeSnap(group: SnapGroup, windows: readonly DesktopWindow[], axis: 'x' | 'y', index: number, value: number): SnapGroup | undefined {
    const members = group.members.map(member => windows.find(window => window.id === member.id));
    if (!Number.isFinite(value) || !Number.isInteger(index) || members.some(window => !window?.geometry || window.minimized || window.maximized || window.fullscreen || window.sticky)) return;
    const first = members[0]?.geometry;
    if (!first || members.some(window => window!.geometry!.output !== first.output || window!.desktop !== members[0]!.desktop)) return;
    const cuts = [...snapCuts(group)];
    if (axis === 'y' ? group.layout !== 'quarters' || index !== 0 : index < 0 || index >= cuts.length) return;
    const cells = snapCells(group), start = axis === 'y' ? 0 : index === 0 ? 0 : cuts[index - 1], end = axis === 'y' ? 10000 : cuts[index + 1] ?? 10000;
    const current = axis === 'x' ? cuts[index] : group.row ?? 5000;
    let before = 0, after = 0;
    for (const cell of cells) {
        const geometry = members.find(window => window!.id === cell.id)!.geometry!;
        const minimum = axis === 'x' ? Math.max(160, geometry.minWidth) : Math.max(100, geometry.minHeight);
        const required = Math.ceil((minimum + 10) * 10000 / (axis === 'x' ? first.area.width : first.area.height));
        const offset = axis === 'x' ? cell.x : cell.y, size = axis === 'x' ? cell.width : cell.height;
        if (offset + size === current) before = Math.max(before, required);
        if (offset === current) after = Math.max(after, required);
    }
    if (start + before > end - after) return;
    const position = Math.max(start + before, Math.min(end - after, Math.round(value)));
    if (axis === 'y') return {...group, row: position};
    cuts[index] = position; return {...group, cuts};
}

export function fitSnapGroup(group: SnapGroup, windows: readonly DesktopWindow[]): SnapGroup {
    // Restore minimized windows too; minimum-size metadata remains available.
    const visible = windows.map(window => window.minimized ? {...window, minimized: false} : window);
    let result = group;
    for (let pass = 0; pass < 2; pass++) for (const divider of snapDividers(result))
        result = resizeSnap(result, visible, divider.axis, divider.index, divider.position) ?? result;
    return result;
}
