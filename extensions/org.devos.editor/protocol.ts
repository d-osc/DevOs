export interface EditorConfig {
    content?: string;
    path?: string;
    language: string;
    fontSize: number;
    tabSize: number;
    minimap: boolean;
    readOnly: boolean;
}
export type EditorAction = 'new' | 'open' | 'save' | 'saveAs' | 'close' | 'next' | 'previous';
export type EditorMessage = {type: 'ready'} | {type: 'change'; content: string}
    | {type: 'cursor'; line: number; column: number} | {type: 'action'; action: EditorAction}
    | {type: 'error'; message: string};
