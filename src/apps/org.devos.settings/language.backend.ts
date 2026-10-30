import {Gio} from '@dev-os/core/base';
import {ROOT} from '@dev-os/config';
export interface LanguagePreferences {layouts: string[]; shortcut: string;}
export interface LanguageCatalog {settings: LanguagePreferences; warning?: string; layouts: {id: string; name: string; sample: string}[]; shortcuts: {id: string; name: string}[];}
export interface LanguageControls {load(): Promise<LanguageCatalog>; save(value: LanguagePreferences): Promise<{settings: LanguagePreferences; applied: boolean}>; destroy(): void;}
export class LinuxLanguage implements LanguageControls {
    private process?: Gio.Subprocess;
    private disposed = false;
    private request(action: 'get' | 'save', value?: LanguagePreferences): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {reject(new Error('Language settings closed.')); return;}
            try {
                const process = Gio.Subprocess.new(['d', `${ROOT}/bin/dev-os-language`, '--', action], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                this.process = process;
                process.communicate_utf8_async(value ? JSON.stringify(value) : null, null, (_source, result) => {
                    this.process = undefined;
                    try {
                        const [, stdout, stderr] = process.communicate_utf8_finish(result);
                        const response = JSON.parse((stdout || stderr) || '{}') as Record<string, unknown>;
                        if (!process.get_successful() || response.ok !== true) throw new Error(String(response.error || 'Could not update keyboard languages.'));
                        resolve(response);
                    } catch (reason) {reject(reason);}
                });
            } catch (reason) {reject(reason);}
        });
    }
    async load() {return await this.request('get') as unknown as LanguageCatalog;}
    async save(value: LanguagePreferences) {return await this.request('save', value) as unknown as {settings: LanguagePreferences; applied: boolean};}
    destroy() {this.disposed = true; this.process?.force_exit();}
}
