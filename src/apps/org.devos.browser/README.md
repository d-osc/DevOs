# Browser

Native DevLang + WebKit browser with Chrome-style tabs in the window title bar. Each keyed tab owns a live WebKit view, its page state and Back/Forward history. The address field, Back, Forward and Reload operate on the selected tab. External browser commands open a new tab.

Use `+` to open a blank tab, drag a tab to reorder it, or click its close button / middle mouse button to close it. Closing the last tab closes the window.

Validation: `d tests/browser-native.test.dev` and `d tests/native-tabs.test.dev` (local pages under isolated Xvfb).


Drag a tab outside its window to move it into a separate window. Drag it onto another tab strip from the same app instance to merge it back. The live editor buffer (including unsaved changes and undo), browser view/history, terminal shell/PTY, or Files navigation state moves with the tab. Moving the final tab closes only the empty source window; other windows continue running.
