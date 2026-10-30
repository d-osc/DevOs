import {serviceClass} from '@dev-os/runtime/app-service';
import {
    Listeners, Gio, GLib
} from '@dev-os/core';

export function languageForPath(path: string | undefined): string {
    const name = (path ? GLib.path_get_basename(path) : '').toLowerCase();
    if (name === 'dockerfile') return 'dockerfile';
    if (['makefile', 'gnumakefile'].includes(name)) return 'makefile';
    const extension = name.split('.').pop() ?? '';
    return ({ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
        json: 'json', jsonc: 'json', html: 'html', htm: 'html', css: 'css', scss: 'scss',
        md: 'markdown', py: 'python', rs: 'rust', go: 'go', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
        sh: 'shell', bash: 'shell', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', xml: 'xml',
        svg: 'xml', sql: 'sql', lua: 'lua', java: 'java'} as Record<string, string>)[extension] ?? 'plaintext';
}

export type EditorDocument = import('./document.backend.js').EditorDocument;
export const EditorDocument = serviceClass<typeof import('./document.backend.js').EditorDocument>('editor/document.EditorDocument', {path: undefined, content: '', loading: false, saving: false, error: '', dirty: false, language: 'plaintext', title: 'Untitled'}, ["reportError","edit"]);
