"""Non-building checks for audio provenance and preservation of EC changes."""
import json
import ctypes
import ctypes.util
import re
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from usb_support import usb as audio, fake_tool   # the DevLang implementation (distro/usb/usbstage.dev)


class BoardAudioTests(unittest.TestCase):
    def test_ucm_router_matches_real_asus_card_identity(self):
        # /proc/asound/cards from native boot 3367a468, not QEMU.
        name = 'GLYMUR-ASUS-Zenbook-A14-UX3407N'
        long_name = 'ASUSTeKCOMPUTERINC.-ZenbookA14UX3407NA-1.0-UX3407NA'
        router = (ROOT / 'distro/oe/meta-devos/recipes-multimedia/alsa/files/devos-glymur.conf').read_text()
        variable = re.search(r'String "\$\{(\w+)\}"', router).group(1)
        pattern = re.search(r'Regex "([^"]+)"', router).group(1)
        identity = {'CardName': name, 'CardLongName': long_name}
        self.assertIsNotNone(re.search(pattern, identity[variable]), 'Physical ASUS must select its microphone UCM profile')
        self.assertIsNone(re.search(pattern, 'GLYMUR-CRD'))

    @unittest.skipUnless(ctypes.util.find_library('asound'), 'requires libasound parser')
    def test_ucm_router_parses_with_alsa(self):
        alsa = ctypes.CDLL(ctypes.util.find_library('asound'))
        pointer = ctypes.c_void_p
        alsa.snd_config_top.argtypes = [ctypes.POINTER(pointer)]
        alsa.snd_input_stdio_open.argtypes = [ctypes.POINTER(pointer), ctypes.c_char_p, ctypes.c_char_p]
        alsa.snd_config_load.argtypes = [pointer, pointer]
        alsa.snd_input_close.argtypes = [pointer]
        alsa.snd_config_delete.argtypes = [pointer]
        config, stream = pointer(), pointer()
        router = ROOT / 'distro/oe/meta-devos/recipes-multimedia/alsa/files/devos-glymur.conf'
        self.assertEqual(alsa.snd_config_top(ctypes.byref(config)), 0)
        try:
            self.assertEqual(alsa.snd_input_stdio_open(ctypes.byref(stream), str(router).encode(), b'r'), 0)
            try:
                self.assertEqual(alsa.snd_config_load(config, stream), 0)
            finally:
                alsa.snd_input_close(stream)
        finally:
            alsa.snd_config_delete(config)

    def test_audio_composition_preserves_existing_ec(self):
        with tempfile.TemporaryDirectory() as directory:
            board = Path(directory) / 'board.dts'
            original = 'compatible = "asus,zenbook-a14-ux3407na";\n/* existing EC */\n'
            board.write_text(original)
            audio.append_audio(board)
            self.assertTrue(board.read_text().startswith(original))
            self.assertIn('SpkrLeft', board.read_text())
            self.assertIn('DMIC1', board.read_text())
            other = Path(directory) / 'other.dts'
            other.write_text('compatible = "another,board";\n')
            with self.assertRaisesRegex(ValueError, 'requires the UX3407NA board source'):
                audio.append_audio(other)

    def test_ec_patch_only_for_ec_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            tools = Path(directory) / 'tools'
            tools.mkdir()
            log = Path(directory) / 'patch.log'
            fake_tool(tools, 'patch', 'echo "$*" >> "$FAKE_LOG"\n')
            tree = Path(directory) / 'tree'
            tree.mkdir()
            env = {'FAKE_LOG': str(log)}
            audio.preserve_ec(tree, {'files': {}}, tools=tools, env=env)
            self.assertFalse(log.exists(), 'No EC bundle: nothing is patched')
            audio.preserve_ec(tree, {'files': {'suspend-fixes.json': 'hash'}}, tools=tools, env=env)
            calls = log.read_text().splitlines()
            self.assertEqual(len(calls), 1)
            self.assertIn('--fuzz=0', calls[0])
            self.assertIn('0002-ux3407na-ec.patch', calls[0])

    def test_missing_and_stale_provenance_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory)
            with self.assertRaisesRegex(ValueError, 'missing'):
                audio.validate_proof(bundle, {'files': {}})
            original = bundle / 'original.dts'
            original.write_text('original board')
            audio.write_proof(bundle, original)
            record = {'files': {'board-fixes.json': 'hash'}}
            audio.validate_proof(bundle, record)
            proof = bundle / 'board-fixes.json'
            content = json.loads(proof.read_text())
            content['overrideSha256'] = 'stale'
            proof.write_text(json.dumps(content))
            with self.assertRaisesRegex(ValueError, 'stale'):
                audio.validate_proof(bundle, record)

    def test_camera_dtb_alone_cannot_be_staged_with_stock_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle=Path(directory); original=bundle/'board.dts'; original.write_text('board')
            audio.write_proof(bundle, original, camera=True)
            with self.assertRaisesRegex(ValueError, 'matching rebuilt camera modules'):
                audio.validate_proof(bundle, {'files': {'board-fixes.json':'hash'}})


if __name__ == '__main__':
    unittest.main()
