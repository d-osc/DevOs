import React, {useLayoutEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import * as monaco from 'monaco-editor';
import type {EditorConfig, EditorMessage, EditorAction} from '../protocol.js';
import {familyPalettes, syntaxRules, type ThemeFamily, type ThemeName} from '../../../../packages/core/theme-palette.js';
import './style.css';

declare global {
    interface Window {
        webkit: {messageHandlers: {editor: {postMessage(message: string): void}}};
        devOsEditor: {configure(options: EditorConfig): void; getValue(): string;
            setValue(value: string): void; setTheme(name: ThemeName, family?: ThemeFamily): void; replace(value: string): void; undo(): void; focus(): void; find(replace?: boolean): void; diagnostics(): string[]};
    }
}
globalThis.MonacoEnvironment = {getWorker(_id, label) {
    const name = ['typescript', 'javascript'].includes(label) ? 'ts' : ['css', 'scss', 'less'].includes(label) ? 'css'
        : ['html', 'handlebars', 'razor'].includes(label) ? 'html' : label === 'json' ? 'json' : 'editor';
    return new Worker(new URL(`${name}.worker.js`, window.location.href), {type: 'module'});
}};
// Standalone Monaco does not enable JSX by default. React files need TSX/JSX parsing.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
    defaults.setCompilerOptions({...defaults.getCompilerOptions(), jsx: monaco.typescript.JsxEmit.Preserve,
        module: monaco.typescript.ModuleKind.ESNext, moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs});
}
function send(message: EditorMessage) { window.webkit.messageHandlers.editor.postMessage(JSON.stringify(message)); }
window.addEventListener('error', event => send({type: 'error', message: event.message}));
window.addEventListener('unhandledrejection', event => send({type: 'error', message: String(event.reason)}));

/** The VS Code 2026 colors for Monaco: the workbench colors from the palette and the syntax colors from the tokenColors. */
function editorTheme(name: ThemeName, family: ThemeFamily): monaco.editor.IStandaloneThemeData {
    const p = familyPalettes[family][name], strip = (hex: string) => hex.replace('#', '');
    const hex8 = (rgba: string) => {
        const [, r, g, b, a] = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(rgba)!;
        return '#' + [r, g, b].map(v => Number(v).toString(16).padStart(2, '0')).join('') + Math.round(Number(a) * 255).toString(16).padStart(2, '0');
    };
    const color = (scope: string) => strip(syntaxRules[family][name].find(rule => rule.scope === scope && rule.foreground)?.foreground ?? p.editorFg);
    const italic = (scope: string) => syntaxRules[family][name].find(rule => rule.scope === scope)?.fontStyle ?? '';
    return {base: name === 'dark' ? 'vs-dark' : 'vs', inherit: true, rules: [
        {token: 'comment', foreground: color('comment'), fontStyle: italic('comment')},
        {token: 'keyword', foreground: color('keyword')}, {token: 'keyword.control', foreground: color('keyword')},
        {token: 'storage', foreground: color('storage')},
        {token: 'string', foreground: color('string')}, {token: 'string.escape', foreground: color('support')},
        {token: 'number', foreground: color('constant')}, {token: 'constant', foreground: color('constant')},
        {token: 'regexp', foreground: color('string.regexp')},
        {token: 'type', foreground: color('entity.name')}, {token: 'type.identifier', foreground: color('entity.name')},
        {token: 'variable', foreground: color('variable')}, {token: 'identifier', foreground: color('variable.other')},
        {token: 'variable.predefined', foreground: color('support')},
        {token: 'tag', foreground: color('entity.name.tag')},
        {token: 'attribute.name', foreground: color('meta.property-name')}, {token: 'attribute.value', foreground: color('string')},
        {token: 'delimiter', foreground: color('variable.other')},
    ], colors: {
        'editor.background': p.editorBg, 'editor.foreground': p.editorFg,
        'editorLineNumber.foreground': p.fgMuted, 'editorLineNumber.activeForeground': p.editorFg,
        'editorCursor.foreground': p.editorFg, 'editor.selectionBackground': hex8(p.editorSelection),
        'editor.inactiveSelectionBackground': hex8(p.terminalSelection),
        'editor.lineHighlightBackground': p.lineHighlight, 'editor.lineHighlightBorder': p.lineHighlight,
        'editorIndentGuide.background1': p.line0, 'editorIndentGuide.activeBackground1': p.line3,
        'editorBracketMatch.background': hex8(p.terminalSelection), 'editorBracketMatch.border': p.line1,
        'editorWidget.background': p.s2, 'editorWidget.border': p.line0,
        'input.background': p.s1, 'input.foreground': p.fg, 'input.border': p.line1,
        'focusBorder': p.focus, 'minimap.background': p.editorBg,
        'scrollbarSlider.background': hex8(p.scrollbar), 'scrollbarSlider.hoverBackground': hex8(p.scrollbar),
    }};
}

function EditorSurface() {
    const host = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        for (const family of ['vscode', 'github'] as const) for (const name of ['dark', 'light'] as const) monaco.editor.defineTheme(`dev-os-${family}-${name}`, editorTheme(name, family));
        const editor = monaco.editor.create(host.current!, {theme: 'dev-os-vscode-dark', value: '', language: 'plaintext',
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
            setTheme(name, family = 'vscode') { document.documentElement.style.setProperty('--editor-bg', familyPalettes[family][name].editorBg); monaco.editor.setTheme(`dev-os-${family}-${name}`); },
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
