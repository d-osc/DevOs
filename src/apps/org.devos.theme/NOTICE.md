# Notice

The Dev OS themes come in two color themes, each with a Dark and a Light variant: **VS Code 2026** and **GitHub**.

The Dev OS Dark and Light themes are copied from the default **2026 Dark** and
**2026 Light** color themes of Visual Studio Code (Code - OSS), version 1.143.1:

- `extensions/theme-defaults/themes/2026-dark.json`
- `extensions/theme-defaults/themes/2026-light.json`
- `extensions/theme-defaults/themes/dark_modern.json` and `light_modern.json`
  (the files the 2026 themes `include`; they supply the keys the 2026 files do not override)

The copies are in `vscode/`. `packages/core/theme-palette.ts` is generated from
them by `tools/theme/generate-palette.dev`. The sixteen terminal ANSI colors and the
terminal foreground are not in those files: they are the VS Code workbench defaults
(`terminal.ansi*`, `terminal.foreground`) and are copied from the same installation.

Source: https://github.com/microsoft/vscode/tree/main/extensions/theme-defaults/themes

Copyright (c) Microsoft Corporation. All rights reserved.

Licensed under the MIT License (https://github.com/microsoft/vscode/blob/main/LICENSE.txt):

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## GitHub Dark Default / GitHub Light Default

The GitHub color theme is copied from the `GitHub.github-vscode-theme` extension, version 6.3.5
(https://github.com/primer/github-vscode-theme, downloaded from Open VSX): `themes/dark-default.json` and
`themes/light-default.json`, kept in `vscode/github/`. Where those themes leave a color unset, the token is
taken from the key that carries the matching Primer role (see `families.github.map` in `data/themes/palette-map.json`, used in `tools/theme/generate-palette.dev`);
`paletteSources` in the generated file lists the key for every token.

Copyright (c) 2020 Primer. Licensed under the MIT License; the license text is in `vscode/github/LICENSE.txt`.

