export function editorFileIcon(path?: string): string {
    const extension = path?.split('.').pop()?.toLowerCase();
    if (extension === 'tsx' || extension === 'jsx') return 'dev-os-file-react';
    if (extension === 'ts') return 'dev-os-file-typescript';
    if (['js', 'mjs', 'cjs'].includes(extension ?? '')) return 'dev-os-file-javascript';
    return 'text-x-generic-symbolic';
}
