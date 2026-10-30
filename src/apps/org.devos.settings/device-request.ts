import {serviceClass} from '@dev-os/runtime/app-service';
export type DeviceRequest = import('./device-request.backend.js').DeviceRequest;
export const DeviceRequest = serviceClass<typeof import('./device-request.backend.js').DeviceRequest>('settings/device-request.DeviceRequest', {});
