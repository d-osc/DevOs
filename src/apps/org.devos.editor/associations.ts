// Comma/space separated extensions or exact filenames; no shell/glob execution.
export function opensInEditor(path: string, associations: string): boolean {
    const name = path.split('/').at(-1)?.toLowerCase() ?? '';
    return associations.toLowerCase().split(/[\s,;]+/).filter(Boolean).some(token => {
        if (token.startsWith('*.')) token = token.slice(1);
        return token.startsWith('.') ? name.endsWith(token) : name === token;
    });
}
