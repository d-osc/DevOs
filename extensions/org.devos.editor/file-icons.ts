import {materialIcon} from '../org.devos.icons/material.js';
export function editorFileIcon(path?: string): string {
    const material = materialIcon(path);
    if (material) return material;
    const extension = path?.split('.').pop()?.toLowerCase();
    if (extension === 'tsx' || extension === 'jsx') return 'dev-os-file-react';
    if (extension === 'ts') return 'dev-os-file-typescript';
    if (['js', 'mjs', 'cjs'].includes(extension ?? '')) return 'dev-os-file-javascript';
    return 'text-x-generic-symbolic';
}
