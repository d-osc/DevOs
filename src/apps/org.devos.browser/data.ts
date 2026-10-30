import {serviceClass} from '@dev-os/runtime/app-service';
export const BrowserData = serviceClass<typeof import('./data.backend.js').BrowserData>('browser/data.BrowserData', {});
