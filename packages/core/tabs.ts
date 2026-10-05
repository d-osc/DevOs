interface TabItem {id: number;}

// Moving between windows can change the ID before insertion into the target.
export function moveTabItem<T extends TabItem>(source: T[], target: T[], id: number,
    before?: number, transfer?: (tab: T) => void): {tab: T; index: number} | null {
    const index = source.findIndex(tab => tab.id === id);
    if (index < 0 || (source === target && before === id)) return null;
    const [tab] = source.splice(index, 1);
    if (source !== target) transfer?.(tab);
    const at = target.findIndex(item => item.id === before);
    target.splice(at < 0 ? target.length : at, 0, tab);
    return {tab, index};
}

export function reconcileRemovedTab<T extends TabItem>(tabs: T[], active: number,
    removed: number, index: number, actions: {empty(): void; select(id: number): void; refresh(): void}): void {
    if (!tabs.length) actions.empty();
    else if (active === removed) actions.select(tabs[Math.min(index, tabs.length - 1)].id);
    else actions.refresh();
}

export function completeTabMove<T extends TabItem>(moved: {tab: T; index: number} | null,
    crossWindow: boolean, source: {tabs: T[]; active: number; removed: number;
        empty(): void; select(id: number): void; refresh(): void},
    destination: {selectTab(id: number): void; show(): void}): void {
    if (!moved) return;
    destination.selectTab(moved.tab.id);
    if (crossWindow) {
        reconcileRemovedTab(source.tabs, source.active, source.removed, moved.index, source);
        destination.show();
    }
}
