export type SettingValue = string | number | boolean;
export type SettingsValues = Record<string, SettingValue>;
export type SettingField = {
    key: string; title: string; description?: string;
} & (
    {type: 'string' | 'color'; default: string} |
    {type: 'number'; default: number; min?: number; max?: number; integer?: boolean} |
    {type: 'boolean'; default: boolean}
);
export interface SettingsSection {
    id: string;
    title: string;
    description?: string;
    fields: SettingField[];
}
export interface ExtensionManifest {
    kind?: 'settings' | 'ui';
    system?: boolean;
    entry?: string;
    order?: number;
    id: string;
    name: string;
    description: string;
    version: string;
    apiVersion: 1;
    settingsVersion: number;
    enabledByDefault: boolean;
    settings: SettingsSection[];
}
export interface ExtensionState {
    version: number;
    enabled: boolean;
    values: SettingsValues;
}
export interface ExtensionInfo {
    manifest: ExtensionManifest;
    origin: 'bundled' | 'user';
    state: ExtensionState;
    error?: string;
}
export interface SettingsHost {
    readonly diagnostics?: string[];
    list(): ExtensionInfo[];
    get(id: string): ExtensionInfo;
    update(id: string, enabled: boolean, values: SettingsValues): void;
    subscribe(listener: () => void): () => void;
    settingsFile?(id: string): string;
    reloadSettingsFile?(path: string): void;
}
