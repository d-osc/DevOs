const systemComponents = new Set(['org.devos.panel', 'org.devos.displaycare', 'org.devos.background']);

export function packageCategory(manifest: {id: string; system?: boolean}): 'system' | 'app' | 'extension' {
    return manifest.system ? systemComponents.has(manifest.id) ? 'system' : 'app' : 'extension';
}
