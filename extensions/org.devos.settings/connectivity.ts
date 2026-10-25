import {HelperClient} from './helper-client.js';
export type TaskFirstProfile = 'off' | 'productivity' | 'streaming' | 'games';
/** Result of `dev-os-connectivity get`. */
export interface ConnectivityState {
    taskfirstSupported: boolean; taskfirstReason: string; taskfirst: TaskFirstProfile;
    /** The traffic classes are installed on at least one network interface right now. */
    taskfirstActive: boolean; taskfirstInterfaces: string;
    smartconnectSupported: boolean; smartconnectReason: string; smartconnect: boolean; smartconnectRunning: boolean; smartconnectLast: string;
}
export type ConnectivityAction = 'get' | 'taskfirst' | 'smartconnect';
export interface ConnectivityControls {request(action: ConnectivityAction, ...args: string[]): Promise<ConnectivityState>; destroy(): void;}
export const unsupportedConnectivity: ConnectivityState = {taskfirstSupported: false, taskfirstReason: '', taskfirst: 'off', taskfirstActive: false, taskfirstInterfaces: '', smartconnectSupported: false, smartconnectReason: '', smartconnect: false, smartconnectRunning: false, smartconnectLast: ''};
/** MyASUS' fifth option (Screen Extend, GlideX) does not exist in Dev OS and is left out. */
export const taskFirstProfiles: {id: TaskFirstProfile; title: string; description: string}[] = [
    {id: 'off', title: 'Off', description: 'Switch off data prioritizing'},
    {id: 'productivity', title: 'Productivity and Communication', description: 'Prioritize productivity and communication tasks, such as loading websites, cloud drives, and communication apps'},
    {id: 'streaming', title: 'Multimedia streaming', description: 'Prioritize audio / video streaming apps and websites'},
    {id: 'games', title: 'Games', description: 'Prioritize game-related tasks, such as gameplay and game live streaming'},
];
export class Connectivity extends HelperClient<ConnectivityState, ConnectivityAction> implements ConnectivityControls {
    constructor() {super('dev-os-connectivity', 120, {closed: 'Connectivity settings closed.', missing: 'Connectivity settings are not installed.', failed: 'Connectivity settings failed.'});}
}
