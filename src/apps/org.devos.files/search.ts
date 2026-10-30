import {serviceClass} from '@dev-os/runtime/app-service';
import {
    Listeners, Gio, GLib
} from '@dev-os/core';

export const DEFAULT_SEARCH_EXCLUDES = '.git,node_modules,dist,build,.venv,vendor,.cache';
export interface SearchFile {name: string; path: string; relative: string;}
export interface SearchState {
    root: string; query: string; results: SearchFile[]; matches: number; indexed: number;
    scanning: boolean; pending: boolean; limited: boolean; skipped: number; error: string;
}
export interface SearchOptions {excludedDirectories: string[]; maxEntries?: number; maxResults?: number;}

// Prefer file names, then relative paths. Consecutive letters and word boundaries
// rank above scattered subsequences, so "fvtsx" can find "files-view.tsx".
function fuzzyScore(text: string, query: string): number | null {
    if (text === query) return 1000;
    if (text.startsWith(query)) return 700 - text.length;
    const substring = text.indexOf(query);
    if (substring >= 0) return 500 - substring * 2 - text.length;
    let position = -1, score = 100;
    for (const letter of query) {
        const next = text.indexOf(letter, position + 1);
        if (next < 0) return null;
        score += next === position + 1 ? 12 : -(next - position);
        if (next === 0 || '/._- '.includes(text[next - 1])) score += 10;
        position = next;
    }
    return score - text.length;
}
export function matchFiles(files: readonly SearchFile[], query: string, limit = 100) {
    const tokens = query.trim().toLowerCase().replaceAll('\\', '/').split(/\s+/).filter(Boolean);
    const ranked: {file: SearchFile; score: number}[] = [];
    for (const file of files) {
        let score = 0, matched = true;
        for (const token of tokens) {
            const name = fuzzyScore(file.name.toLowerCase(), token);
            const path = name === null ? fuzzyScore(file.relative.toLowerCase(), token) : null;
            if (name === null && path === null) { matched = false; break; }
            score += name !== null ? name + 200 : path!;
        }
        if (matched) ranked.push({file, score});
    }
    ranked.sort((a, b) => b.score - a.score || (tokens.length ? a.file.relative.length - b.file.relative.length : 0) || a.file.relative.localeCompare(b.file.relative));
    return {results: ranked.slice(0, limit).map(item => item.file), matches: ranked.length};
}

export type FileSearch = import('./search.backend.js').FileSearch;
export const FileSearch = serviceClass<typeof import('./search.backend.js').FileSearch>('files/search.FileSearch', {state: {root: '', query: '', results: [], matches: 0, indexed: 0,
        scanning: false, pending: false, limited: false, skipped: 0, error: ''}}, ["setQuery","stop"]);
