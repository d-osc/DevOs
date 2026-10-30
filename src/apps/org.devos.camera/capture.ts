import {serviceClass} from '@dev-os/runtime/app-service';
export type CaptureKind = 'camera' | 'microphone';
export const MediaData = serviceClass<typeof import('./capture.backend.js').MediaData>('camera/capture.MediaData', {}, ['photo', 'stop']);
export async function devices(kind: CaptureKind) {
    const service = new MediaData(kind, () => {}, () => {}, () => {}, () => {});
    try {return await service.devices();} finally {service.destroy();}
}

export async function mediaFolder(kind: CaptureKind) {
    const service = new MediaData(kind, () => {}, () => {}, () => {}, () => {});
    try {return await service.folder();} finally {service.destroy();}
}
