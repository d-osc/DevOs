// The small browser-compatible surface supplied by runtime.ts in GJS 1.80.
declare function setTimeout(callback: (...args: unknown[]) => unknown, delay?: number, ...args: unknown[]): number;
declare function clearTimeout(id: number): void;
declare function queueMicrotask(callback: () => void): void;
declare var performance: {now(): number};
declare var console: {
    log(...values: unknown[]): void;
    warn(...values: unknown[]): void;
    error(...values: unknown[]): void;
};
interface ImportMeta {readonly url: string;}
declare class TextEncoder {encode(input?: string): Uint8Array;}
declare class TextDecoder {constructor(label?: string, options?: {fatal?: boolean; ignoreBOM?: boolean}); decode(input?: Uint8Array): string;}
