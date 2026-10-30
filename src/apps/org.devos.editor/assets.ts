import {serviceClass} from '@dev-os/runtime/app-service';
const AssetsData = serviceClass<typeof import('./assets.backend.js').AssetsData>('editor/assets.AssetsData', {});
/** The UI receives only an asset URL. HTTP and disk work run in the service. */
export class EditorAssets {
    private constructor(private service: InstanceType<typeof AssetsData>, readonly uri: string) {}
    static async create() {
        const service = new AssetsData();
        try {return new EditorAssets(service, await service.initialize());}
        catch (error) {service.destroy(); throw error;}
    }
    dispose() {this.service.destroy();}
}
