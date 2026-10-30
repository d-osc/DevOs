export interface ProcessInfo {
    pid: number; name: string; user: string; uid: number; state: string; cpu: number; memory: number; start: string; canStop: boolean;
    command?: string; executable?: string;
    swap?: number | null; diskRead?: number | null; diskWrite?: number | null;
    networkReceive?: number | null; networkSend?: number | null;
    gpu?: number | null; gpuMemory?: number | null;
}
export interface ProcessState {processes: ProcessInfo[]; cpu: number; memoryTotal: number; memoryUsed: number; swapTotal: number; swapUsed: number; cores: number; uptime: number;}
export interface ProcessControls {load(): Promise<ProcessState>; stop(item: ProcessInfo, force: boolean): Promise<void>; destroy(): void;}
