import gzip
import importlib.util
import json
from pathlib import Path
import stat
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('usb',Path(__file__).resolve().parents[1]/'distro/usb/prepare.py')
usb=importlib.util.module_from_spec(spec);spec.loader.exec_module(usb)

class LiveUsbTests(unittest.TestCase):
    def test_root_password_overlay_with_actual_static_busybox(self):
        busybox=Path('/var/tmp/devos-usb/busybox-build/busybox')
        if not busybox.exists(): self.skipTest('Static Live BusyBox is not built')
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            (directory/'shadow').write_text('root:*:15069:0:99999:7:::\ndaemon:*:15069:0:99999:7:::\n')
            script=(usb.HERE/'init').read_text()
            script=script[script.index('root_password_hash='):script.index('unset root_password_hash')]
            script=script.replace('/newroot/etc',str(directory)).replace('/live/root-password.hash',str(usb.HERE/'root-password.hash'))
            subprocess.run([str(busybox),'sh','-c','rescue() { exit 1; };\n'+script],check=True)
            lines=(directory/'shadow').read_text().splitlines()
            self.assertEqual(lines[0],'root:'+(usb.HERE/'root-password.hash').read_text().strip()+':15069:0:99999:7:::')
            self.assertEqual(lines[1],'daemon:*:15069:0:99999:7:::')
            self.assertEqual(stat.S_IMODE((directory/'shadow').stat().st_mode),0o600)

    def test_missing_shell_bracket_applet_blocks_initramfs_packaging(self):
        applets=usb.REQUIRED_APPLETS-{'['}
        with patch.object(usb,'run',return_value='\n'.join(applets)):
            with self.assertRaisesRegex(ValueError,'Missing live boot tools'):
                usb.install_boot_tools(Path('/unused'),Path('/unused/busybox'))

    def test_refresh_boot_tools_preserves_original_hardlinked_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);tree=root/'tree';(tree/'bin').mkdir(parents=True)
            original=root/'original';original.write_bytes(b'old-busybox')
            (tree/'bin/busybox').hardlink_to(original)
            old_init=root/'old-init';old_init.write_bytes(b'old-init')
            (tree/'init').hardlink_to(old_init)
            replacement=root/'new-busybox';replacement.write_bytes(b'new-busybox')
            with patch.object(usb,'run',return_value='\n'.join(usb.REQUIRED_APPLETS)):
                usb.install_boot_tools(tree,replacement)
            self.assertEqual(original.read_bytes(),b'old-busybox')
            self.assertEqual(old_init.read_bytes(),b'old-init')
            self.assertEqual((tree/'bin/busybox').read_bytes(),b'new-busybox')
            self.assertTrue((tree/'diagnostics/collector.service').is_file())
            self.assertTrue((tree/'live/root-session').is_file())
            self.assertTrue((tree/'live/greetd-root.toml').is_file())
            self.assertEqual((tree/'sbin/modprobe').readlink(),Path('../bin/busybox'))
            self.assertTrue((tree/'live/root-password.hash').is_file())

    def test_efi_sections_require_arm64(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'boot.efi';data=bytearray(256)
            data[:2]=b'MZ';struct.pack_into('<I',data,60,64)
            data[64:68]=b'PE\0\0';struct.pack_into('<HH',data,68,0xaa64,1)
            data[88:96]=b'.linux\0\0';struct.pack_into('<I',data,96,16);struct.pack_into('<I',data,108,200)
            file.write_bytes(data)
            self.assertEqual(usb.pe_sections(file)['.linux'],(200,16))
            struct.pack_into('<H',data,68,0x8664);file.write_bytes(data)
            with self.assertRaisesRegex(ValueError,'not ARM64'): usb.pe_sections(file)

    def test_firmware_rejects_unlisted_windows_executable(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);(output/'driver.dll').write_bytes(b'MZ')
            (output/'manifest.json').write_text(json.dumps({'board':'asus-ux3407na','files':{}}))
            with self.assertRaisesRegex(ValueError,'Unlisted'): usb.firmware_bundle(output)

    def test_kernel_bundle_rejects_other_board(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            (output/'manifest.json').write_text(json.dumps({'board':'another-arm-board','architecture':'aarch64'}))
            with self.assertRaisesRegex(ValueError,'UX3407NA'): usb.kernel_bundle(output)

    def test_cpio_preserves_files_symlinks_and_console_without_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp);tree=tmp/'tree';(tree/'dev').mkdir(parents=True)
            (tree/'hello').write_bytes(b'abc');(tree/'link').symlink_to('hello')
            usb.cpio(tree,tmp/'init.gz');data=gzip.decompress((tmp/'init.gz').read_bytes())
            offset=0;entries={}
            while True:
                self.assertEqual(data[offset:offset+6],b'070701')
                fields=[int(data[offset+6+i*8:offset+14+i*8],16) for i in range(13)]
                size,namesize=fields[6],fields[11];offset+=110
                name=data[offset:offset+namesize-1].decode();offset=(offset+namesize+3)//4*4
                content=data[offset:offset+size];offset=(offset+size+3)//4*4
                entries[name]=(fields,content)
                if name=='TRAILER!!!': break
            self.assertEqual(entries['hello'][1],b'abc')
            self.assertEqual(entries['link'][1],b'hello')
            self.assertTrue(stat.S_ISLNK(entries['link'][0][1]))
            self.assertTrue(stat.S_ISCHR(entries['dev/console'][0][1]))
            self.assertEqual(entries['dev/console'][0][9:11],[5,1])

    def test_foreign_rootfs_rejected(self):
        with patch.object(usb,'run',return_value='ID=ubuntu\n'):
            with self.assertRaisesRegex(ValueError,'not independent DevOs'): usb.identity(Path('/tmp/rootfs'))

    def test_os_release_symlink_fallback(self):
        with patch.object(usb,'run',side_effect=['','ID=devos\n']):
            self.assertEqual(usb.identity(Path('/tmp/rootfs')),'ID=devos\n')

    def test_pending_hardware_blocks_usb_image_creation(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            (output/'manifest.json').write_text(json.dumps({'files':{},'hardwareReady':False,'reason':'pending X2'}))
            with self.assertRaisesRegex(ValueError,'X2 kernel/DTB'): usb.build(output)
            self.assertFalse((output/'devos-live-arm64-ux3407na.img').exists())

    def test_checksum_failure_blocks_modified_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);(output/'Image').write_bytes(b'changed')
            (output/'manifest.json').write_text(json.dumps({'files':{'Image':'0'*64},'reason':'pending'}))
            with self.assertRaisesRegex(ValueError,'Checksum mismatch'): usb.check(output)

if __name__=='__main__': unittest.main()
