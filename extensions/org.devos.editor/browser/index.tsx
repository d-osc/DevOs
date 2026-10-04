import React, {useLayoutEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import * as monaco from 'monaco-editor';
import type {EditorConfig, EditorMessage, EditorAction} from '../protocol.js';
import './style.css';

declare global {
    interface Window {
        webkit: {messageHandlers: {editor: {postMessage(message: string): void}}};
        devOsEditor: {configure(options: EditorConfig): void; getValue(): string;
            setValue(value: string): void; replace(value: string): void; undo(): void; focus(): void; find(replace?: boolean): void; diagnostics(): string[]};
    }
}
globalThis.MonacoEnvironment = {getWorker(_id, label) {
    const name = ['typescript', 'javascript'].includes(label) ? 'ts' : ['css', 'scss', 'less'].includes(label) ? 'css'
        : ['html', 'handlebars', 'razor'].includes(label) ? 'html' : label === 'json' ? 'json' : 'editor';
    return new Worker(new URL(`${name}.worker.js`, window.location.href));
}};
// Standalone Monaco does not enable JSX by default. React files need TSX/JSX parsing.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
    defaults.setCompilerOptions({...defaults.getCompilerOptions(), jsx: monaco.typescript.JsxEmit.Preserve,
        module: monaco.typescript.ModuleKind.ESNext, moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs});
}
function send(message: EditorMessage) { window.webkit.messageHandlers.editor.postMessage(JSON.stringify(message)); }
window.addEventListener('error', event => send({type: 'error', message: event.message}));
window.addEventListener('unhandledrejection', event => send({type: 'error', message: String(event.reason)}));

function EditorSurface() {
    const host = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        monaco.editor.defineTheme('dev-os', {base: 'vs-dark', inherit: true, rules: [
            {token: 'comment', foreground: '6A737D', fontStyle: 'italic'},
            {token: 'keyword', foreground: 'F97583'},
            {token: 'keyword.control', foreground: 'F97583'},
            {token: 'string', foreground: 'FFDA79'},
            {token: 'number', foreground: 'B392F0'},
            {token: 'type.identifier', foreground: '79B8FF'},
            {token: 'tag', foreground: 'F97583'},
            {token: 'attribute.name', foreground: 'B392F0'},
            {token: 'delimiter', foreground: 'E1E4E8'},
        ], colors: {
            'editor.background': '#24292e', 'editor.foreground': '#e1e4e8',
            'editorLineNumber.foreground': '#485563', 'editorLineNumber.activeForeground': '#c9d1d9',
            'editorCursor.foreground': '#d7dae0', 'editor.selectionBackground': '#3b5369',
            'editor.inactiveSelectionBackground': '#343f4b',
            'editor.lineHighlightBackground': '#24292e', 'editor.lineHighlightBorder': '#24292e',
            'editorIndentGuide.background1': '#353c44', 'editorIndentGuide.activeBackground1': '#59636e',
            'editorBracketMatch.background': '#343f4b', 'editorBracketMatch.border': '#59636e',
            'editorWidget.background': '#20252a', 'editorWidget.border': '#444d56',
            'input.background': '#2f363d', 'input.foreground': '#e1e4e8', 'input.border': '#444d56',
            'focusBorder': '#79b8ff', 'minimap.background': '#24292e',
            'scrollbarSlider.background': '#58606955', 'scrollbarSlider.hoverBackground': '#6a737d88',
        }});
        const editor = monaco.editor.create(host.current!, {theme: 'dev-os', value: '', language: 'plaintext',
            readOnly: true, automaticLayout: true, fontFamily: 'JetBrains Mono, Fira Code, monospace',
            fontSize: 14, lineHeight: 21, minimap: {enabled: true, renderCharacters: true, maxColumn: 100, scale: 1, size: 'fit'},
            lineNumbersMinChars: 3, glyphMargin: true, folding: true, showFoldingControls: 'mouseover',
            guides: {indentation: true, bracketPairs: true}, bracketPairColorization: {enabled: true},
            scrollBeyondLastLine: true, padding: {top: 22, bottom: 16},
            smoothScrolling: true, renderWhitespace: 'selection', overviewRulerBorder: false, stickyScroll: {enabled: false},
            scrollbar: {verticalScrollbarSize: 10, horizontalScrollbarSize: 10},
            find: {addExtraSpaceOnTop: false}});
        let configuring = false;
        window.devOsEditor = {
            configure(options) {
                configuring = true;
                if (options.content !== undefined && options.path && editor.getModel()!.uri.toString() !== monaco.Uri.file(options.path).toString()) {
                    const previous = editor.getModel()!;
                    editor.setModel(monaco.editor.createModel(options.content, options.language, monaco.Uri.file(options.path)));
                    previous.dispose();
                } else if (options.content !== undefined && options.content !== editor.getValue()) editor.setValue(options.content);
                monaco.editor.setModelLanguage(editor.getModel()!, options.language);
                editor.updateOptions({fontSize: options.fontSize, lineHeight: options.fontSize + 7, tabSize: options.tabSize,
                    minimap: {enabled: options.minimap}, readOnly: options.readOnly});
                configuring = false; editor.focus();
            },
            getValue: () => editor.getValue(), setValue: value => editor.setValue(value),
            replace(value) {
                editor.pushUndoStop();
                editor.executeEdits('native', [{range: editor.getModel()!.getFullModelRange(), text: value}]);
                editor.pushUndoStop();
            },
            undo: () => { editor.trigger('native', 'undo', null); }, focus: () => editor.focus(),
            find(replace = false) {
                editor.focus();
                void editor.getAction(replace ? 'editor.action.startFindReplaceAction' : 'actions.find')?.run();
            },
            diagnostics: () => monaco.editor.getModelMarkers({resource: editor.getModel()!.uri}).map(marker => marker.message),
        };
        const change = editor.onDidChangeModelContent(() => { if (!configuring) send({type: 'change', content: editor.getValue()}); });
        const cursor = editor.onDidChangeCursorPosition(event => send({type: 'cursor', line: event.position.lineNumber, column: event.position.column}));
        const shortcut = (key: number, action: EditorAction) => editor.addCommand(key, () => send({type: 'action', action}));
        const control = monaco.KeyMod.CtrlCmd, shift = monaco.KeyMod.Shift;
        shortcut(control | monaco.KeyCode.KeyS, 'save'); shortcut(control | shift | monaco.KeyCode.KeyS, 'saveAs');
        shortcut(control | monaco.KeyCode.KeyO, 'open'); shortcut(control | monaco.KeyCode.KeyN, 'new');
        shortcut(control | monaco.KeyCode.KeyT, 'new');
        shortcut(control | monaco.KeyCode.KeyW, 'close');
        shortcut(control | monaco.KeyCode.Tab, 'next'); shortcut(control | shift | monaco.KeyCode.Tab, 'previous');
        send({type: 'ready'});
        return () => { change.dispose(); cursor.dispose(); editor.getModel()?.dispose(); editor.dispose(); };
    }, []);
    return <div ref={host} className="editor-surface" />;
}
createRoot(document.getElementById('root')!).render(<EditorSurface />);
