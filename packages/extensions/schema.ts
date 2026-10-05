import type {ExtensionManifest, ExtensionState, SettingField, SettingsValues} from './types.js';

function object(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
    return value as Record<string, unknown>;
}
function string(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
    return value;
}
function validateKeys(input: Record<string, unknown>, allowed: string[], name: string): void {
    if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error(`Unknown ${name} property`);
}
export function validateExtensionId(value: unknown): string {
    const id = string(value, 'Extension ID');
    if (id.length > 128 || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(id))
        throw new Error('Extension ID must be namespaced, lowercase, and contain no path separators');
    return id;
}
export function validateManifest(value: unknown): ExtensionManifest {
    const input = object(value, 'Manifest');
    validateKeys(input, ['id', 'name', 'description', 'version', 'apiVersion', 'settingsVersion', 'enabledByDefault', 'settings', 'kind',
        ...(input.kind === 'ui' ? ['system', 'entry', 'order'] : [])], 'manifest');
    validateExtensionId(input.id);
    for (const key of ['name', 'description', 'version']) string(input[key], key);
    if (input.apiVersion !== 1) throw new Error('Unsupported extension API version');
    if (typeof input.settingsVersion !== 'number' || !Number.isInteger(input.settingsVersion) || input.settingsVersion < 1)
        throw new Error('settingsVersion must be a positive integer');
    if (typeof input.enabledByDefault !== 'boolean') throw new Error('enabledByDefault must be boolean');
    if (input.kind !== undefined && input.kind !== 'settings' && input.kind !== 'ui') throw new Error('Invalid extension kind');
    if (input.kind === 'ui') {
        if (typeof input.system !== 'boolean') throw new Error('UI system flag must be boolean');
        if (typeof input.entry !== 'string' || !/^[a-z][a-z0-9.-]*\.js$/.test(input.entry)) throw new Error('UI entry must be a flat JavaScript filename');
        if (typeof input.order !== 'number' || !Number.isSafeInteger(input.order) || input.order < 0) throw new Error('UI order must be a non-negative integer');
        if (input.system && !input.enabledByDefault) throw new Error('System UI must be enabled by default');
    }
    if (!Array.isArray(input.settings) || (input.kind !== 'ui' && !input.settings.length)) throw new Error('Extension must contribute settings sections');
    const keys = new Set<string>(), sections = new Set<string>();
    for (const raw of input.settings) {
        const section = object(raw, 'Section');
        validateKeys(section, ['id', 'title', 'description', 'fields'], 'section');
        const id = string(section.id, 'Section ID');
        if (sections.has(id)) throw new Error(`Duplicate section ${id}`);
        sections.add(id); string(section.title, 'Section title');
        if (section.description !== undefined) string(section.description, 'Section description');
        if (!Array.isArray(section.fields) || !section.fields.length) throw new Error('Section must have fields');
        for (const rawField of section.fields) {
            const field = object(rawField, 'Field'), key = string(field.key, 'Field key');
            validateKeys(field, ['key', 'title', 'description', 'type', 'default', ...(field.type === 'number' ? ['min', 'max', 'integer'] : [])], 'field');
            if (!/^[a-z][a-zA-Z0-9_]*$/.test(key) || keys.has(key)) throw new Error(`Invalid or duplicate setting key ${key}`);
            keys.add(key); string(field.title, 'Field title');
            if (field.description !== undefined) string(field.description, 'Field description');
            if (!['string', 'color', 'number', 'boolean'].includes(String(field.type))) throw new Error(`Unsupported field type ${field.type}`);
            if (field.type === 'number') {
                for (const bound of ['min', 'max']) if (field[bound] !== undefined &&
                    (typeof field[bound] !== 'number' || !Number.isFinite(field[bound]))) throw new Error(`Invalid ${bound}`);
                if (typeof field.min === 'number' && typeof field.max === 'number' && field.min > field.max) throw new Error('min exceeds max');
                if (field.integer !== undefined && typeof field.integer !== 'boolean') throw new Error('integer must be boolean');
            }
            validateValue(field as unknown as SettingField, field.default);
        }
    }
    return JSON.parse(JSON.stringify(input)) as ExtensionManifest;
}
function validateValue(field: SettingField, value: unknown): void {
    if (field.type === 'string' && typeof value === 'string') return;
    if (field.type === 'color' && typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return;
    if (field.type === 'boolean' && typeof value === 'boolean') return;
    if (field.type === 'number' && typeof value === 'number' && Number.isFinite(value) &&
        (!field.integer || Number.isInteger(value)) && (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max)) return;
    throw new Error(`Invalid value for ${field.title} (${field.key})`);
}
export function validateValues(manifest: ExtensionManifest, value: unknown): SettingsValues {
    const input = object(value, 'Settings values'), result: SettingsValues = {};
    const fields = manifest.settings.flatMap(section => section.fields);
    if (Object.keys(input).some(key => !fields.some(field => field.key === key))) throw new Error('Unknown extension setting');
    for (const field of fields) {
        const current = Object.hasOwn(input, field.key) ? input[field.key] : field.default;
        validateValue(field, current); result[field.key] = current as SettingsValues[string];
    }
    return result;
}
export function validateState(manifest: ExtensionManifest, value: unknown): ExtensionState {
    const input = object(value, 'Extension settings');
    if (Object.keys(input).some(key => !['version', 'enabled', 'values'].includes(key))) throw new Error('Unknown extension state key');
    if (input.version !== manifest.settingsVersion) throw new Error('Extension settings version requires migration');
    if (typeof input.enabled !== 'boolean') throw new Error('Extension enabled must be boolean');
    if (manifest.system && !input.enabled) throw new Error('System UI cannot be disabled');
    return {version: input.version, enabled: input.enabled, values: validateValues(manifest, input.values)};
}

