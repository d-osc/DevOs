"""Exercise the real DT overlay tools, including unrelated nodes and hardlinks."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'distro/usb/preserve-firmware-display'
OVERLAY = ROOT / 'profiles/asus/ux3407na/kernel/firmware-display.dtso'


@unittest.skipUnless(all(shutil.which(t) for t in ('dtc', 'fdtget', 'fdtoverlay')), 'install device-tree-compiler')
class FirmwareDisplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.dtb = self.directory / 'board.dtb'

    def compile(self, board='asus,zenbook-a14-ux3407na', regulator='VREG_EDP_3P3'):
        source = self.directory / 'board.dts'
        source.write_text('''/dts-v1/;
/ {
    compatible = "%s", "qcom,glymur";
    regulator-edp {
        compatible = "regulator-fixed";
        regulator-name = "%s";
        regulator-boot-on;
        phandle = <0x131>;
    };
    audio { routing = "Speaker"; power-supply = <0x131>; };
    camera { status = "okay"; };
    ec { wakeup-source; };
};
''' % (board, regulator))
        subprocess.run(['dtc', '-q', '-I', 'dts', '-O', 'dtb', '-o', str(self.dtb), str(source)], check=True)

    def patch(self, success=True):
        result = subprocess.run(['sh', str(HELPER), str(self.dtb), str(OVERLAY)], capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, success, result.stderr)

    def normalized(self):
        return subprocess.check_output(['dtc', '-q', '-s', '-I', 'dtb', '-O', 'dts', str(self.dtb)], text=True)

    def test_only_power_constraint_changes_and_base_hardlink_is_untouched(self):
        self.compile()
        before = self.normalized()
        base = self.directory / 'base.dtb'
        base.hardlink_to(self.dtb)
        original = base.read_bytes()
        self.patch()
        after = self.normalized()
        self.assertIn('\t\tregulator-always-on;\n', after)
        self.assertEqual(after.replace('\t\tregulator-always-on;\n', ''), before)
        self.assertEqual(base.read_bytes(), original)
        subprocess.run(['sh', str(HELPER), '--check', str(self.dtb)], check=True)
        self.patch()
        self.assertEqual(self.normalized(), after)

    def test_rejects_other_board_without_modifying_input(self):
        self.compile(board='asus,other-model')
        before = self.dtb.read_bytes()
        self.patch(success=False)
        self.assertEqual(self.dtb.read_bytes(), before)

    def test_rejects_unexpected_regulator_without_modifying_input(self):
        self.compile(regulator='OTHER_RAIL')
        before = self.dtb.read_bytes()
        self.patch(success=False)
        self.assertEqual(self.dtb.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
