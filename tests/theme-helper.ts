import {GLib, themeTokens} from '@dev-os/core';

/** Token definitions for tests that load style.css directly; DEV_OS_TEST_THEME=light renders the Light theme and DEV_OS_TEST_FAMILY=github the GitHub colors. */
export const testTheme = () => themeTokens(GLib.getenv('DEV_OS_TEST_THEME') === 'light' ? 'light' : 'dark', GLib.getenv('DEV_OS_TEST_FAMILY') === 'github' ? 'github' : 'vscode');
