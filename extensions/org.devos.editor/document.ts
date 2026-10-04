import {Gio, GLib} from '../../src/gtk.js';

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

export class EditorDocument {
    path?: string;
    content = '';
    loading = false;
    saving = false;
    error = '';
    private saved = '';
    private etag: string | null = null;
    private bom = false;
    private disposed = false;
    private cancel = new Gio.Cancellable();
    private listeners = new Set<() => void>();
    get dirty() { return this.content !== this.saved; }
    get language() { return languageForPath(this.path); }
    get title() { return this.path ? GLib.path_get_basename(this.path) : 'Untitled'; }
    subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    private publish() { if (!this.disposed) this.listeners.forEach(listener => listener()); }
    reportError(message: string) { this.error = message; this.publish(); }
    edit(content: string) { if (!this.disposed && !this.loading) { this.content = content; this.error = ''; this.publish(); } }
    async load(path: string): Promise<boolean> {
        if (this.disposed || this.loading || this.saving) return false;
        this.loading = true; this.error = ''; this.publish();
        try {
            const file = Gio.File.new_for_path(path);
            const info = await new Promise<Gio.FileInfo>((resolve, reject) => file.query_info_async('standard::size,standard::type',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, this.cancel, (source, result) => {
                    try { resolve((source as Gio.File).query_info_finish(result)); } catch (error) { reject(error); }
                }));
            if (info.get_file_type() !== Gio.FileType.REGULAR) throw new Error('Choose a regular text file.');
            if (info.get_size() > 8 * 1024 * 1024) throw new Error('This editor supports text files up to 8 MB.');
            const [bytes, etag] = await new Promise<[Uint8Array, string]>((resolve, reject) => file.load_contents_async(this.cancel, (source, result) => {
                try { const [, bytes, etag] = (source as Gio.File).load_contents_finish(result); resolve([bytes, etag]); } catch (error) { reject(error); }
            }));
            if (this.disposed) return false;
            if (bytes.length > 8 * 1024 * 1024) throw new Error('This editor supports text files up to 8 MB.');
            const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
            const text = new TextDecoder('utf-8', {fatal: true}).decode(bom ? bytes.subarray(3) : bytes);
            if (text.includes('\0')) throw new Error('Binary files cannot be opened as text.');
            this.path = file.get_path()!; this.content = this.saved = text; this.etag = etag;
            this.bom = bom;
            return true;
        } catch (error) { if (!this.disposed) this.error = String(error); return false; }
        finally { this.loading = false; this.publish(); }
    }
    async save(path = this.path): Promise<boolean> {
        if (!path || this.disposed || this.loading || this.saving) return false;
        const text = this.content, sameFile = path === this.path;
        this.saving = true; this.error = ''; this.publish();
        try {
            const file = Gio.File.new_for_path(path);
            const bytes = new TextEncoder().encode((this.bom ? '\ufeff' : '') + text);
            const etag = await new Promise<string>((resolve, reject) => file.replace_contents_async(bytes, sameFile ? this.etag : null,
                false, Gio.FileCreateFlags.NONE, this.cancel, (source, result) => {
                    try { const [, etag] = (source as Gio.File).replace_contents_finish(result); resolve(etag); } catch (error) { reject(error); }
                }));
            if (this.disposed) return false;
            this.path = file.get_path()!; this.etag = etag; this.saved = text; return true;
        } catch (error) { if (!this.disposed) this.error = String(error); return false; }
        finally { this.saving = false; this.publish(); }
    }
    dispose() { this.disposed = true; this.cancel.cancel(); this.listeners.clear(); }
}
