"""Execute migrated DevLang tools against disposable files, source trees and QMP."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import unittest
from devlang_support import D, ROOT, run_source

class ToolMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='devos-tools-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
    def run_tool(self, file, *arguments, expected=0, env=None):
        value = subprocess.run([D, str(ROOT / 'tools' / file), '--', *map(str, arguments)], text=True, capture_output=True,
                               env=os.environ | (env or {}), timeout=30)
        self.assertEqual(value.returncode, expected, value.stdout + value.stderr)
        return value.stdout
    def test_toml_migration_is_exclusive_and_preserves_source(self):
        source = self.base / 'old config.toml'
        original = 'accent = "#88e0c0"\nname = "ไทย"\n[panel]\nheight = 36\n'
        source.write_text(original)
        self.run_tool('maintenance/migrate-config.dev', '--source', source)
        target = source.with_suffix('.json')
        self.assertEqual(json.loads(target.read_text())['name'], 'ไทย')
        before = target.read_bytes()
        self.run_tool('maintenance/migrate-config.dev', '--source', source, expected=1)
        self.assertEqual(target.read_bytes(), before)
        self.assertEqual(source.read_text(), original)
    def test_missing_library_skips_regular_files_without_enotdir(self):
        source=f'use {json.dumps(str(ROOT / "tools/lib/tool.dev"))} as tool\nuse "std/result"\nlet outcome=result.attempt(fn(): str {{ return tool.library("libdevos-test-missing.so.999") }})\nprint(result.message(outcome))\n'
        output=run_source(source)
        self.assertIn('Required system library is missing',output)
        self.assertNotIn('Not a directory',output)
    def test_workspace_patch_handles_both_abis_and_is_idempotent(self):
        for modern in (False, True):
            base = self.base / ('modern' if modern else 'legacy')
            (base / 'include').mkdir(parents=True)
            (base / 'src').mkdir()
            (base / 'protocols').mkdir()
            (base / 'include/labwc.h').write_text('struct session_lock_manager *session_lock_manager;' if modern else 'struct seat seat;')
            (base / 'src/meson.build').write_text('labwc_sources = files(\n)')
            (base / 'protocols/meson.build').write_text('server_protocols = [\n]')
            (base / 'src/server.c').write_text('#include "labwc.h"\n\tworkspaces_init(server);\n')
            (base / 'src/workspaces.c').write_text('/* workspace functions */\n')
            foreign = base / ('src/foreign-toplevel/wlr-foreign.c' if modern else 'src/foreign.c')
            foreign.parent.mkdir(exist_ok=True)
            foreign.write_text('\thandle_new_app_id(&wlr_toplevel->on_view.new_app_id, NULL);' if modern else '\ttoplevel->maximize.notify = handle_request_maximize;')
            self.run_tool('setup/patch-task-view-workspaces.dev', base)
            first = {path.relative_to(base): path.read_bytes() for path in base.rglob('*') if path.is_file()}
            self.run_tool('setup/patch-task-view-workspaces.dev', base)
            self.assertEqual(first, {path.relative_to(base): path.read_bytes() for path in base.rglob('*') if path.is_file()})
            text = (base / 'src/devos-workspaces.c').read_text()
            self.assertNotIn('DEVOS_DESKTOP_LIST', text)
            self.assertIn('workspaces.all' if modern else '(s)->workspaces', text)
            self.assertIn('handle->data = view', foreign.read_text())
    def test_tab_drag_escape_patch_handles_fresh_and_upgraded_sources(self):
        for variant in ('legacy', 'upgraded', 'modern'):
            base = self.base / variant
            (base / 'include').mkdir(parents=True)
            (base / 'src/input').mkdir(parents=True)
            menu = '\t/*\n\t * Handle compositor keybinds\n\t */'
            cycle = '\tif (server->osd_state.cycle_view) {\n\t\tkey_state_store_pressed_key_as_bound(event->keycode);\n\t\thandle_cycle_view_key(server, &keyinfo);\n\t}\n'
            old = "\t/* wlroots' drag keyboard grab does not forward Escape to GTK. */\n\tif (seat->drag.active) { wlr_data_source_destroy(seat->seat->drag->source); }\n" if variant == 'upgraded' else ''
            original = '#include "workspaces.h"\n/* ภาษาไทย */\n' + old + (cycle if variant != 'modern' else '') + menu
            file = base / 'src/input/keyboard.c'
            file.write_text(original)
            self.run_tool('setup/patch-tab-drag.dev', base)
            patched = file.read_text()
            self.assertIn('/* ภาษาไทย */', patched)
            self.assertIn('devos_tab_drag_key(server, event', patched)
            self.assertIn('!locked &&' if variant == 'modern' else cycle, patched)
            self.assertNotIn("wlroots' drag keyboard grab", patched)
            self.assertEqual(patched.count('#include "devos-tab-drag.h"'), 1)
            before = file.read_bytes()
            self.run_tool('setup/patch-tab-drag.dev', base)
            self.assertEqual(before, file.read_bytes())

    def test_touchpad_patch_handles_legacy_cursor_and_modern_button_handlers(self):
        for modern in (False, True):
            base = self.base / ('modern' if modern else 'legacy')
            (base / 'include/input').mkdir(parents=True)
            (base / 'src/input').mkdir(parents=True)
            header = 'struct devos_task_view_swipe devos_task_view;\n' + ('session_lock_manager' if modern else 'session_lock')
            (base / 'include/labwc.h').write_text(header)
            cursor = base / 'src/input/cursor.c'
            handler = 'handle_button' if modern else 'cursor_button'
            cursor.write_text('static void\n' + handler + '(struct wl_listener *listener, void *data)\n{\n\tstruct wlr_pointer_button_event *event = data;\n}\n')
            (base / 'src/input/gestures.c').write_text('/* DEVOS_TOUCHPAD_MAP_V2 */\n')
            self.run_tool('setup/patch-touchpad.dev', base)
            self.assertIn('devos_touchpad_button(seat, event)', cursor.read_text())
            helper = (base / 'include/input/devos-touchpad.h').read_text()
            self.assertIn('#include <wlr/backend/libinput.h>', helper)
            self.assertIn('WL_POINTER_BUTTON_STATE_PRESSED' if modern else 'WLR_BUTTON_PRESSED', helper)
            before = {file.relative_to(base): file.read_bytes() for file in base.rglob('*') if file.is_file()}
            self.run_tool('setup/patch-touchpad.dev', base)
            self.assertEqual(before, {file.relative_to(base): file.read_bytes() for file in base.rglob('*') if file.is_file()})

    def test_modern_menu_patch_preserves_unicode_and_function_boundaries(self):
        base = self.base / 'modern-menu'
        (base / 'include').mkdir(parents=True)
        (base / 'src/menu').mkdir(parents=True)
        file = base / 'src/menu/menu.c'
        file.write_text('#include "theme.h"\n/* เมนู → rounded */\n'
                        'wlr_scene_rect_create(tree, bg_width, theme->menu_item_height, bg_color);\n'
                        'wlr_scene_rect_create(menuitem->normal_tree, bg_width, bg_height,\n\t\ttheme->menu_items_bg_color);\n'
                        'wlr_scene_rect_create(menuitem->normal_tree,\n\t\tbg_width, theme->menu_header_height, bg_color);\n'
                        'int item_y = theme->menu_border_width;\n'
                        'menu->size.height = item_y + theme->menu_border_width;\n'
                        'void menu_scene(void) {\n\tstruct lab_scene_rect_options opts = {0};\n'
                        '\twlr_scene_node_lower_to_bottom(&bg_rect->tree->node);\n}\n'
                        '/* ฟังก์ชันถัดไป */\nvoid next_function(void) {}\n')
        self.run_tool('setup/patch-menu-shape.dev', base)
        text = file.read_text()
        self.assertIn('/* เมนู → rounded */', text)
        self.assertIn('void menu_scene(void) {\n\tdevos_menu_finish_scene(menu);\n}', text)
        self.assertTrue(text.endswith('/* ฟังก์ชันถัดไป */\nvoid next_function(void) {}\n'))
        before = file.read_bytes()
        self.run_tool('setup/patch-menu-shape.dev', base)
        self.assertEqual(before, file.read_bytes())

    def test_initrd_hook_order_and_idempotence(self):
        path = self.base / 'ORDER'
        path.write_text('/scripts/casper-bottom/99casperboot "$@"\n')
        self.run_tool('live/patch-initrd-order.dev', path)
        before = path.read_bytes()
        self.run_tool('live/patch-initrd-order.dev', path)
        self.assertEqual(before, path.read_bytes())
        self.assertLess(path.read_text().index('/90devos-session '), path.read_text().index('/99casperboot '))
    def test_qmp_uses_json_and_handles_fragmented_socket_data(self):
        endpoint = self.base / 'qemu-live-qmp.sock'
        server = socket.socket(socket.AF_UNIX)
        server.bind(str(endpoint))
        server.listen()
        server.settimeout(10)
        requests, errors = [], []
        def serve():
            try:
                with server.accept()[0] as peer:
                    stream = peer.makefile('rb')
                    peer.sendall(b'{"QMP":{}}\n')
                    for _ in range(2):
                        request = json.loads(stream.readline())
                        requests.append(request)
                        response = json.dumps({'id': request['id'], 'return': {'status': 'running'}}).encode() + b'\n'
                        for offset in range(0, len(response), 3): peer.sendall(response[offset:offset+3])
                    stream.close()
            except Exception as error: errors.append(error)
        worker = threading.Thread(target=serve)
        worker.start()
        try:
            output = self.run_tool('live/devos-qmp.dev', 'status', env={'DEVOS_LIVE_WORK': str(self.base)})
            self.assertEqual(json.loads(output)['return']['status'], 'running')
        finally:
            worker.join(timeout=10)
            server.close()
        self.assertFalse(errors, errors)
        self.assertEqual([request['execute'] for request in requests], ['qmp_capabilities', 'query-status'])
    def test_mcp_bridge_runs_qmp_steps_skips_events_and_survives_a_closing_socket(self):
        endpoint = self.base / 'qmp.sock'
        server = socket.socket(socket.AF_UNIX)
        server.bind(str(endpoint))
        server.listen()
        server.settimeout(10)
        seen = []
        def serve():
            with server.accept()[0] as peer:
                stream = peer.makefile('rb')
                peer.sendall(b'{"QMP":{"version":{}}}\n')
                while True:
                    line = stream.readline()
                    if not line: return
                    request = json.loads(line)
                    seen.append(request)
                    if request['execute'] == 'quit': return   # closes without replying
                    peer.sendall(b'{"event":"STOP"}\n')
                    reply = json.dumps({'return': {'echo': request['execute'], 'arguments': request.get('arguments')}}).encode() + b'\n'
                    for offset in range(0, len(reply), 4): peer.sendall(reply[offset:offset+4])
        worker = threading.Thread(target=serve)
        worker.start()
        steps = [{'execute': 'query-status'}, {'sleep': 0.05}, {'execute': 'send-key', 'arguments': {'keys': [{'type': 'qcode', 'data': 'a'}]}}, {'execute': 'quit'}, {'execute': 'never'}]
        try:
            done = subprocess.run([D, str(ROOT / 'tools/mcp/qemu-vm/qmp.dev'), '--', 'qmp', str(endpoint)], input=json.dumps(steps), text=True, capture_output=True, timeout=30)
            self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        finally:
            worker.join(timeout=10)
            server.close()
        replies = json.loads(done.stdout)
        self.assertEqual([r['return'].get('echo') for r in replies[:2]], ['query-status', 'send-key'])
        self.assertEqual(replies[1]['return']['arguments'], {'keys': [{'type': 'qcode', 'data': 'a'}]})
        self.assertEqual(replies[2], {'return': {}, 'closed': True})
        self.assertEqual(len(replies), 3, 'Nothing is sent after the socket closed')
        self.assertEqual([r['execute'] for r in seen], ['qmp_capabilities', 'query-status', 'send-key', 'quit'])

    def test_mcp_bridge_writes_serial_bytes_and_reports_errors_as_json(self):
        endpoint = self.base / 'serial.sock'
        server = socket.socket(socket.AF_UNIX)
        server.bind(str(endpoint))
        server.listen()
        server.settimeout(10)
        received = []
        def serve():
            with server.accept()[0] as peer:
                chunks = []
                while True:
                    data = peer.recv(4096)
                    if not data: break
                    chunks.append(data)
                received.append(b''.join(chunks))
        worker = threading.Thread(target=serve)
        worker.start()
        try:
            done = subprocess.run([D, str(ROOT / 'tools/mcp/qemu-vm/qmp.dev'), '--', 'serial', str(endpoint)], input='root\n', text=True, capture_output=True, timeout=30)
            self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
            self.assertEqual(json.loads(done.stdout), {'sent': 5})
        finally:
            worker.join(timeout=10)
            server.close()
        self.assertEqual(received, [b'root\n'])
        missing = subprocess.run([D, str(ROOT / 'tools/mcp/qemu-vm/qmp.dev'), '--', 'qmp', str(self.base / 'absent.sock')], input='[]', text=True, capture_output=True, timeout=30)
        self.assertEqual(missing.returncode, 1)
        self.assertIn('error', json.loads(missing.stdout))

    def test_camera_source_preparation_checks_applies_and_refuses_overwrites(self):
        import hashlib
        kit = self.base / 'native/kernel/ux3407na-camera'
        kit.mkdir(parents=True)
        (self.base / 'tools').mkdir()
        (self.base / 'tools/lib').symlink_to(ROOT / 'tools/lib')
        (self.base / 'lib').symlink_to(ROOT / 'lib')
        script = kit / 'prepare-source.dev'
        script.write_bytes((ROOT / 'native/kernel/ux3407na-camera/prepare-source.dev').read_bytes())
        source = self.base / 'src'
        (source / 'a').mkdir(parents=True)
        (source / 'a/f.c').write_text('one\n')
        patch = kit / '0001.patch'
        patch.write_text('--- a/a/f.c\n+++ b/a/f.c\n@@ -1 +1 @@\n-one\n+two\n')
        sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
        series = {'sourceFiles': {'a/f.c': sha(source / 'a/f.c')}, 'patches': [{'file': '0001.patch', 'sha256': sha(patch)}]}
        (kit / 'series.json').write_text(json.dumps(series))
        def run(*arguments, expected=0):
            done = subprocess.run([D, str(script), '--', *map(str, arguments)], text=True, capture_output=True, timeout=60)
            self.assertEqual(done.returncode, expected, done.stdout + done.stderr)
            return done.stdout + done.stderr
        self.assertIn('PASS: all 1 camera dependency patches apply', run('--source', source))
        output = self.base / 'out'
        run('--source', source, '--output', output)
        self.assertEqual((output / 'a/f.c').read_text(), 'two\n')
        self.assertEqual((source / 'a/f.c').read_text(), 'one\n', 'The pinned original stays unchanged')
        self.assertEqual(json.loads((output / 'devos-camera-provenance.json').read_text()), series)
        self.assertIn('new output directory', run('--source', source, '--output', output, expected=1))
        self.assertIn('new output directory', run('--source', source, '--output', source / 'inside', expected=1))
        (source / 'a/f.c').write_text('changed\n')
        self.assertIn('Wrong or modified pinned source', run('--source', source, expected=1))

    def test_every_tool_parses_without_running_its_action(self):
        for path in (ROOT / 'tools').rglob('*.dev'):
            if path.parent.name == 'lib': continue
            self.run_tool(path.relative_to(ROOT / 'tools'), '--validate')
    def test_no_python_tool_sources_or_embedded_interpreters(self):
        # The one developer-only exception: it reads the WOFF2 Font Awesome fonts (Brotli + glyf transform), which DevLang cannot decode.
        # Its output (data/icons/fa/*.json) is committed and normal builds never run it.
        self.assertEqual([path.relative_to(ROOT).as_posix() for path in (ROOT / 'tools').rglob('*.py')], ['tools/maintenance/build-fa-icons.py'])
        for path in (ROOT / 'tools').rglob('*.sh'):
            self.assertNotIn("<<'PY'", path.read_text())

if __name__ == '__main__': unittest.main()
