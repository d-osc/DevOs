import {serviceClass} from '@dev-os/runtime/app-service';
export type {ProcessInfo, ProcessState, ProcessControls} from './process-types.js';
export type Processes = import('./processes.backend.js').Processes;
export const Processes = serviceClass<typeof import('./processes.backend.js').Processes>('taskmanager/processes.Processes', {}, []);
