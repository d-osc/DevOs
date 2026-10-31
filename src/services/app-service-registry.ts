// Only data controllers are imported here; this entry never initializes GTK.
export const serviceControllers: Record<string, {create(args: any[]): Promise<any>; properties: string[]}> = {
    preferences: {create: async () => new (await import('./preferences.backend.js')).PreferencesData(), properties: ['snapshot']},
    updates: {create: async () => new (await import('./app-data.backend.js')).UpdatesData(), properties: ['state', 'canInstall', 'canUseInstalled', 'selectedRoot', 'root']},
    'extension-store': {create: async () => new (await import('./app-data.backend.js')).ExtensionStoreData(), properties: ['items', 'busy', 'error', 'message', 'installable', 'root', 'packages']},
    'browser/data.BrowserData': {create: async () => new (await import('../apps/org.devos.browser/data.backend.js')).BrowserData(), properties: []},
    'screenshot/capture.ScreenshotData': {create: async () => new (await import('../apps/org.devos.screenshot/capture.backend.js')).ScreenshotData(), properties: []},
    'editor/assets.AssetsData': {create: async () => new (await import('../apps/org.devos.editor/assets.backend.js')).AssetsData(), properties: []},
    'editor/document.EditorDocument': {create: async args => new ((await import('../apps/org.devos.editor/document.backend.js')).EditorDocument as any)(...args), properties: ["path","content","loading","saving","error","dirty","language","title"]},
    'appstore/backend.AppStore': {create: async args => new ((await import('../apps/org.devos.appstore/backend.backend.js')).AppStore as any)(...args), properties: ["busy"]},
    'appstore/package-backend.PackageManagerCli': {create: async args => new ((await import('../apps/org.devos.appstore/package-backend.backend.js')).PackageManagerCli as any)(...args), properties: ["busy"]},
    'appstore/registry-backend.RegistryManager': {create: async args => new ((await import('../apps/org.devos.appstore/registry-backend.backend.js')).RegistryManager as any)(...args), properties: ["busy","bindings"]},
};
