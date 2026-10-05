import {build} from 'esbuild';
import {mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

// Run with a reviewed checkout of the upstream repository; normal builds are offline.
const upstream = resolve(process.argv[2] ?? 'build/material-icon-upstream');
const generated = resolve('build/material-icon-data.mjs');
mkdirSync(resolve('build'), {recursive: true});
await build({stdin: {contents: `export {fileIcons} from '../src/core/icons/fileIcons.ts'; export {folderIcons} from '../src/core/icons/folderIcons.ts';`, resolveDir: upstream},
    outfile: generated, bundle: true, platform: 'node', format: 'esm'});
interface Icon {name: string; fileExtensions?: string[]; fileNames?: string[]; folderNames?: string[]; disabled?: boolean; enabledFor?: string[]; clone?: {base: string};}
const {fileIcons, folderIcons} = await import(pathToFileURL(generated).href) as {
    fileIcons: {icons: Icon[]}; folderIcons: {name: string; icons: Icon[]}[];
};
const destination = resolve('data/icons/hicolor/scalable/apps');
const metadata = resolve('extensions/org.devos.icons/material');
mkdirSync(destination, {recursive: true}); mkdirSync(metadata, {recursive: true});
const names: Record<string, string> = {}, extensions: Record<string, string> = {}, folders: Record<string, string> = {};
const copied = new Set<string>();
function asset(icon: Icon): string | undefined {
    const name = existsSync(join(upstream, 'icons', `${icon.name}.svg`)) ? icon.name : icon.clone?.base;
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name) || !existsSync(join(upstream, 'icons', `${name}.svg`))) return;
    if (!copied.has(name)) { copyFileSync(join(upstream, 'icons', `${name}.svg`), join(destination, `dev-os-material-${name}.svg`)); copied.add(name); }
    return `dev-os-material-${name}`;
}
for (const icon of fileIcons.icons) {
    if (icon.disabled || (icon.enabledFor && !icon.enabledFor.includes('angular'))) continue;
    const id = asset(icon); if (!id) continue;
    for (const key of icon.fileNames ?? []) names[key.toLowerCase()] = id;
    for (const key of icon.fileExtensions ?? []) extensions[key.toLowerCase()] = id;
}
for (const icon of folderIcons.find(theme => theme.name === 'specific')!.icons) {
    const id = asset(icon); if (!id) continue;
    for (const key of icon.folderNames ?? []) folders[key.toLowerCase()] = id;
}
// Upstream default icons are generated from these paths by its file/folder generators.
const defaults = {
    file: 'm8.668 6h3.6641l-3.6641-3.668v3.668m-4.668-4.668h5.332l4 4v8c0 0.73828-0.59375 1.3359-1.332 1.3359h-8c-0.73828 0-1.332-0.59766-1.332-1.3359v-10.664c0-0.74219 0.59375-1.3359 1.332-1.3359m3.332 1.3359h-3.332v10.664h8v-6h-4.668z',
    folder: 'm6.922 3.768-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232',
};
for (const [name, path] of Object.entries(defaults)) writeFileSync(join(destination, `dev-os-material-${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#90a4ae" d="${path}"/></svg>\n`);
writeFileSync(join(metadata, 'mapping.json'), JSON.stringify({names, extensions, folders}, null, 2) + '\n');
copyFileSync(join(upstream, 'LICENSE'), join(metadata, 'LICENSE'));
writeFileSync(join(metadata, 'source.json'), JSON.stringify({repository: 'https://github.com/material-extensions/vscode-material-icon-theme',
    commit: execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), version: JSON.parse(readFileSync(join(upstream, 'package.json'), 'utf8')).version,
    adaptation: 'GTK icon names; default angular pack, specific folders, clone base icons without color transformations.'}, null, 2) + '\n');
console.log(`Imported ${copied.size + 2} Material icons and ${Object.keys(names).length + Object.keys(extensions).length + Object.keys(folders).length} associations`);
