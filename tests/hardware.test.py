"""Hardware identification, profile matching and merging (POSIX sh tool) on fixture trees."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from hardware_fixtures import FIXTURES, materialize

ROOT = HERE.parent
PROFILES = ROOT / 'profiles'
TOOL = PROFILES / 'devos-hwprofile'
SHELL = os.environ.get('DEVOS_TEST_SH') or 'sh'
BUSYBOX = os.environ.get('DEVOS_BUSYBOX') or '/var/tmp/devos-usb/busybox-build/busybox'
# mem_sleep_default=s2idle comes from the UX3407NA suspend correction (Modern Standby only).
KERNEL_ARGS = ['clk_ignore_unused', 'pd_ignore_unused', 'arm64.nopauth', 'mem_sleep_default=s2idle']

def tool(*args, root=None, arch='x86_64', profiles=PROFILES):
    env = {'PATH': os.environ['PATH'], 'DEVOS_PROFILES_DIR': str(profiles), 'DEVOS_HW_ARCH': arch}
    if root: env['DEVOS_HW_ROOT'] = str(root)
    return subprocess.run([SHELL, str(TOOL), *args], capture_output=True, text=True, env=env, timeout=60)

class HardwareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.count = 0
    def run_tool(self, fixture, *args, profiles=PROFILES):
        self.count += 1
        root, arch = materialize(fixture, self.work / f'fx{self.count}')
        result = tool(*args, root=root, arch=arch, profiles=profiles)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result
    def identify(self, fixture):
        return json.loads(self.run_tool(fixture, 'identify').stdout)
    def select(self, fixture, profiles=PROFILES):
        return json.loads(self.run_tool(fixture, 'select', profiles=profiles).stdout)
    def merge(self, fixture, profiles=PROFILES):
        out = self.work / ('merged-' + fixture)
        self.run_tool(fixture, 'merge', str(out), profiles=profiles)
        return out
    def copy_profiles(self):
        tree = self.work / 'profiles'
        shutil.copytree(PROFILES, tree)
        return tree

class IdentifyTests(HardwareTests):
    def test_ux3407na_from_dmi_and_device_tree(self):
        info = self.identify('ux3407na-dmi')
        self.assertEqual((info['vendor'], info['model']), ('asus', 'zenbook-a14-ux3407na_ux3407na'))
        self.assertEqual(info['machine_id'], 'asus/zenbook-a14-ux3407na_ux3407na')
        self.assertEqual((info['form_factor'], info['form_factor_source']), ('laptop', 'chassis_type'))
        self.assertEqual(info['dmi']['chassis_type'], 10)
        self.assertEqual(info['dmi']['bios']['version'], 'UX3407NA.300')
        if 'dt-compatible-unsplit' in info['warnings']:  # BusyBox without tr cannot split NUL separated strings
            self.assertEqual(info['devicetree']['compatible'], ['asus,zenbook-a14-ux3407naqcom,glymur'])
        else:
            self.assertEqual(info['devicetree']['compatible'], ['asus,zenbook-a14-ux3407na', 'qcom,glymur'])
            self.assertEqual(info['cpu']['soc'], 'qcom,glymur')
        self.assertEqual(info['devicetree']['model'], 'ASUSTeK Zenbook A14 (UX3407NA)')
        self.assertEqual((info['cpu']['cores'], info['arch']), (2, 'aarch64'))
        self.assertTrue(info['battery'])
    def test_device_tree_only_machine(self):
        info = self.identify('ux3407na-dt-only')
        self.assertEqual((info['vendor'], info['firmware_type']), ('asus', 'devicetree'))
        self.assertEqual((info['form_factor'], info['form_factor_source']), ('laptop', 'devicetree'))
    def test_generic_desktop(self):
        info = self.identify('generic-desktop')
        self.assertEqual((info['machine_id'], info['form_factor']), ('contoso-systems/dt-9000', 'desktop'))
        self.assertEqual(info['cpu']['model'], 'Contoso Core 9 9900')
    def test_placeholder_dmi_strings_are_ignored(self):
        info = self.identify('placeholder-board')
        self.assertEqual((info['dmi']['sys_vendor'], info['dmi']['product_name']), ('', ''))
        self.assertEqual((info['machine_id'], info['form_factor']), ('unknown/b550m', 'desktop'))
    def test_two_in_one_from_chassis_and_tablet_switch(self):
        info = self.identify('yoga-2in1')
        self.assertEqual((info['vendor'], info['form_factor'], info['form_factor_source']), ('lenovo', '2-in-1', 'chassis_type'))
        self.assertTrue(info['tablet_mode_switch'])
    def test_notebook_chassis_with_tablet_switch_is_two_in_one(self):
        info = self.identify('laptop-with-tablet-switch')
        self.assertEqual((info['form_factor'], info['form_factor_source']), ('2-in-1', 'tablet-mode-switch'))
    def test_battery_is_only_a_last_resort_hint(self):
        self.assertEqual(self.identify('battery-only')['form_factor_source'], 'battery-hint')
        self.assertEqual(self.identify('generic-desktop')['form_factor_source'], 'chassis_type')
    def test_missing_everything_never_fails(self):
        info = self.identify('empty')
        self.assertEqual((info['machine_id'], info['form_factor'], info['firmware_type']), ('unknown', 'unknown', 'unknown'))
        self.assertEqual((info['dmi']['chassis_type'], info['devicetree']['compatible'], info['cpu']['cores']), (None, [], 0))
    def test_hostile_values_stay_valid_json_and_are_never_executed(self):
        root, arch = materialize('empty', self.work / 'hostile')
        dmi = root / 'sys/class/dmi/id'; dmi.mkdir(parents=True)
        (dmi / 'sys_vendor').write_bytes(b'Ev"il\\ \x01vendor\n')
        (dmi / 'product_name').write_bytes(b'$(touch pwned) `touch pwned2`\n')
        env = {'PATH': os.environ['PATH'], 'DEVOS_HW_ROOT': str(root), 'DEVOS_HW_ARCH': arch, 'DEVOS_PROFILES_DIR': str(PROFILES)}
        result = subprocess.run([SHELL, str(TOOL), 'identify'], capture_output=True, text=True, env=env, cwd=self.work)
        info = json.loads(result.stdout)
        self.assertIn('Ev"il', info['dmi']['sys_vendor'])
        self.assertEqual([p.name for p in self.work.glob('pwned*')], [])

class SelectionTests(HardwareTests):
    def test_exact_model_then_form_factor_then_generic_layers(self):
        selection = self.select('ux3407na-dmi')
        self.assertEqual((selection['profile'], selection['profile_kind']), ('asus/ux3407na', 'model'))
        self.assertEqual([layer['path'] for layer in selection['layers']], ['generic', 'form-factors/laptop', 'asus/ux3407na'])
        self.assertEqual(selection['matched_rule'], 'vendor=asus product_name=*ux3407na*')  # most predicates wins
    def test_device_tree_only_matches_same_model(self):
        selection = self.select('ux3407na-dt-only')
        self.assertEqual(selection['profile'], 'asus/ux3407na')
        self.assertEqual(selection['matched_rule'], 'dt_compatible=*asus,zenbook-a14-ux3407na*')
    def test_dmi_rule_without_device_tree(self):
        root = self.work / 'dmi-only'
        for name, content in FIXTURES['ux3407na-dmi']['files'].items():
            if 'devicetree' in name: continue
            (root / name).parent.mkdir(parents=True, exist_ok=True); (root / name).write_text(content)
        selection = json.loads(tool('select', root=root, arch='aarch64').stdout)
        self.assertEqual(selection['profile'], 'asus/ux3407na')
        self.assertEqual(selection['matched_rule'], 'vendor=asus product_name=*ux3407na*')
    def test_unknown_desktop_uses_form_factor_then_generic(self):
        selection = self.select('generic-desktop')
        self.assertEqual(selection['profile_kind'], 'form-factor')
        self.assertEqual([l['path'] for l in selection['layers']], ['generic', 'form-factors/desktop'])
        self.assertIn('unrecognised machine contoso-systems/dt-9000', selection['message'])
    def test_two_in_one_maps_to_convertible(self):
        self.assertEqual([l['path'] for l in self.select('yoga-2in1')['layers']], ['generic', 'form-factors/convertible'])
    def test_unknown_machine_falls_back_to_generic_with_message(self):
        selection = self.select('empty')
        self.assertEqual((selection['profile'], selection['profile_kind']), ('generic', 'generic'))
        self.assertIn('using the generic profile', selection['message'])
    def test_most_specific_rule_wins_and_other_models_do_not_match(self):
        tree = self.copy_profiles()
        (tree / 'contoso/dt-9000').mkdir(parents=True)
        (tree / 'contoso/dt-9000/match').write_text('vendor=contoso*\nvendor=contoso* product_name=dt-9000 form_factor=desktop\n')
        (tree / 'contoso/dt-9000/profile.conf').write_text('name=Contoso DT-9000\n')
        (tree / 'contoso/loose').mkdir()
        (tree / 'contoso/loose/match').write_text('vendor=contoso*\n')
        self.assertEqual(self.select('generic-desktop', profiles=tree)['profile'], 'contoso/dt-9000')
        self.assertEqual(self.select('ux3407na-dmi', profiles=tree)['profile'], 'asus/ux3407na')
    def test_profile_without_match_file_is_never_selected(self):
        tree = self.copy_profiles()
        (tree / 'contoso/dt-9000').mkdir(parents=True)
        (tree / 'contoso/dt-9000/profile.conf').write_text('name=Contoso DT-9000\n')
        self.assertEqual(self.select('generic-desktop', profiles=tree)['profile_kind'], 'form-factor')
    def test_devos_hw_override_forces_generic_or_a_named_model(self):
        root, arch = materialize('ux3407na-dmi', self.work / 'forced')
        def forced(value):
            env = {'PATH': os.environ['PATH'], 'DEVOS_PROFILES_DIR': str(PROFILES), 'DEVOS_HW_ROOT': str(root), 'DEVOS_HW_ARCH': arch, 'DEVOS_HW_FORCE': value}
            return json.loads(subprocess.run([SHELL, str(TOOL), 'select'], capture_output=True, text=True, env=env).stdout)
        self.assertEqual(forced('generic')['layers'], [{'kind': 'generic', 'path': 'generic'}])
        self.assertEqual(forced('../../etc')['profile'], 'asus/ux3407na')  # unsafe values are ignored
        self.assertEqual(forced('asus/nope')['profile'], 'asus/ux3407na')
    def test_model_form_factor_is_used_when_detection_is_unknown(self):
        facts = self.work / 'facts2'
        facts.write_text('vendor=asus\nproduct_name=ux3407na\n')
        selection = json.loads(tool('select', '--facts', str(facts)).stdout)
        self.assertEqual([l['path'] for l in selection['layers']], ['generic', 'form-factors/laptop', 'asus/ux3407na'])
    def test_select_from_facts_file(self):
        facts = self.work / 'facts'
        facts.write_text('vendor=asus\nproduct_name=zenbook-a14-ux3407na\nform_factor=laptop\n')
        result = tool('select', '--facts', str(facts))
        self.assertEqual(json.loads(result.stdout)['profile'], 'asus/ux3407na')

class MergeTests(HardwareTests):
    def conf(self, directory):
        return dict(line.split('=', 1) for line in (directory / 'profile.conf').read_text().splitlines() if line)
    def lines(self, directory, name):
        return (directory / name).read_text().splitlines()
    def test_model_overrides_form_factor_overrides_generic(self):
        conf = self.conf(self.merge('ux3407na-dmi'))
        self.assertEqual(conf['power_lid_action'], 'ignore')       # model beats laptop and generic (suspend)
        self.assertEqual(conf['input_touchpad'], '1')                # laptop layer
        self.assertEqual(conf['power_profile'], 'balanced')          # generic layer survives
        self.assertEqual(conf['graphics_renderer'], 'pixman')        # model beats generic 'auto'
        self.assertEqual((conf['selected_profile'], conf['name']), ('asus/ux3407na', 'ASUS Zenbook A14 UX3407NA'))
        self.assertEqual(conf['test_status'], 'untested-on-hardware')
    def test_lists_are_concatenated_in_order_without_duplicates(self):
        merged = self.merge('ux3407na-dmi')
        self.assertEqual(self.lines(merged, 'early.modules'), ['qcom_rpmh_regulator', 'qcom_refgen_regulator', 'phy_qcom_m31_eusb2', 'phy_qcom_qmp_usb', 'dwc3_qcom',
            'xhci_plat_hcd', 'usb_storage', 'uas'])  # proven USB bring-up order of the pre-profile init
        self.assertEqual(self.lines(merged, 'kernel.args'), KERNEL_ARGS)
        self.assertIn('ath12k/QCC2072/hw1.0/board.bin', self.lines(merged, 'firmware.list'))
    def test_later_layer_can_remove_an_inherited_entry(self):
        tree = self.copy_profiles()
        (tree / 'asus/ux3407na/early.modules').write_text('-uas\nnew_module\n')
        modules = self.lines(self.merge('ux3407na-dmi', profiles=tree), 'early.modules')
        self.assertNotIn('uas', modules)
        self.assertEqual(modules[-1], 'new_module')
    def test_convertible_quirks_and_generic_only_merge(self):
        self.assertEqual(self.lines(self.merge('yoga-2in1'), 'quirks.list'), ['touch-first-shell', 'iio-sensor-proxy'])
        generic = self.merge('empty')
        self.assertEqual(self.conf(generic)['selected_kind'], 'generic')
        self.assertEqual(self.lines(generic, 'firmware.list'), [])
        self.assertIn("DEVOS_HW_SELECTED_PROFILE='generic'", (generic / 'profile.env').read_text())
        self.assertEqual(json.loads((generic / 'identity.json').read_text())['schema'], 1)
    def test_compose_builds_a_model_profile_without_hardware(self):
        out = self.work / 'composed'
        result = tool('compose', 'asus/ux3407na', str(out))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.lines(out, 'kernel.args'), KERNEL_ARGS)
        self.assertEqual(self.conf(out)['form_factor'], 'laptop')
        self.assertNotEqual(tool('compose', 'asus/missing', str(self.work / 'x')).returncode, 0)
    def test_apply_installs_safe_files_and_generated_modprobe_policy(self):
        tree = self.copy_profiles()
        (tree / 'asus/ux3407na/modules.blacklist').write_text('badmod\n')
        (tree / 'asus/ux3407na/modules.load').write_text('goodmod\n')
        files = tree / 'asus/ux3407na/files'
        (files / 'opt/evil').mkdir(parents=True); (files / 'opt/evil/x').write_text('x')
        (files / 'etc/link').symlink_to('/etc/passwd')
        merged = self.merge('ux3407na-dmi', profiles=tree)
        target = self.work / 'target'; target.mkdir()
        result = tool('apply', str(target), str(merged), profiles=tree)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('HandleLidSwitch=ignore', (target / 'etc/systemd/logind.conf.d/95-devos-hwprofile.conf').read_text())
        self.assertEqual((target / 'etc/modprobe.d/50-devos-hwprofile.conf').read_text().splitlines()[-1], 'blacklist badmod')
        self.assertEqual((target / 'etc/modules-load.d/50-devos-hwprofile.conf').read_text().splitlines()[-1], 'goodmod')
        self.assertFalse((target / 'opt').exists())
        self.assertFalse((target / 'etc/link').exists())
        self.assertIn('skipped unsafe profile file', result.stderr)

class RealMachineTests(HardwareTests):
    """Values from the first physical UX3407NA boot."""
    def test_real_dmi_and_device_tree_select_the_model_profile(self):
        info = self.identify('ux3407na-real')
        self.assertEqual((info['vendor'], info['model']), ('asus', 'zenbook-a14-ux3407na'))
        self.assertEqual(info['devicetree']['model'], 'ASUS Zenbook A14 (UX3407NA)')
        selection = self.select('ux3407na-real')
        self.assertEqual((selection['profile'], selection['profile_kind']), ('asus/ux3407na', 'model'))
        # Chassis type was not captured: the model profile supplies the laptop form factor.
        self.assertEqual([l['path'] for l in selection['layers']], ['generic', 'form-factors/laptop', 'asus/ux3407na'])
    def test_real_device_tree_alone_selects_the_model_profile(self):
        selection = self.select('ux3407na-real-dt-only')
        self.assertEqual(selection['profile'], 'asus/ux3407na')
        self.assertEqual(selection['matched_rule'], 'dt_compatible=*asus,zenbook-a14-ux3407na*')
    def test_unrecognised_machine_records_what_was_read(self):
        out = self.merge('generic-desktop')
        selection = json.loads((out / 'selection.json').read_text())
        self.assertIn('sys_vendor=[Contoso Systems]', selection['read'])
        self.assertIn('product_name=[DT-9000]', selection['read'])
        self.assertIn('values read:', (out / 'message').read_text())
        self.assertIn('dt_compatible=[]', json.loads((out / 'identity.json').read_text())['read'])
        empty = json.loads((self.merge('empty') / 'identity.json').read_text())
        self.assertIn('no-dmi-sysfs', empty['warnings'])
        self.assertIn('no-devicetree', empty['warnings'])

@unittest.skipUnless(Path(BUSYBOX).is_file(), 'static Live BusyBox is not built')
class InitramfsEnvironmentTests(unittest.TestCase):
    """Run the tool with only the real Live BusyBox applets on PATH, as in the initramfs.

    The first physical boot produced empty identity files because that BusyBox has no
    printf, no `command` builtin, no `echo -n`, and (in that build) no tr or uname."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        bin_dir = self.work / 'bin'; bin_dir.mkdir()
        shutil.copy(BUSYBOX, bin_dir / 'busybox')
        for applet in subprocess.run([BUSYBOX, '--list'], capture_output=True, text=True, check=True).stdout.split():
            if applet not in ('tr', 'uname', 'printf'): (bin_dir / applet).symlink_to('busybox')  # worst case
        self.bin = bin_dir
    def sh(self, env, *args):
        return subprocess.run([str(self.bin / 'busybox'), 'sh', str(TOOL), *args], capture_output=True, text=True, env=env)
    def boot(self, fixture):
        root, _ = materialize(fixture, self.work / ('fx-' + fixture))
        out = self.work / 'run'
        env = {'PATH': str(self.bin), 'DEVOS_HW_ROOT': str(root), 'DEVOS_PROFILES_DIR': str(PROFILES)}
        return self.sh(env, 'boot', str(out)), out, env
    def test_real_ux3407na_boots_with_its_profile_under_the_live_busybox(self):
        result, out, env = self.boot('ux3407na-real')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, '')
        self.assertIn('model profile asus/ux3407na', result.stdout)
        identity = json.loads((out / 'identity.json').read_text())
        self.assertEqual((identity['vendor'], identity['arch']), ('asus', 'aarch64'))
        self.assertEqual(json.loads((out / 'selection.json').read_text())['profile'], 'asus/ux3407na')
        modules = (out / 'early.modules').read_text().split()
        self.assertEqual(modules[:5], ['qcom_rpmh_regulator', 'qcom_refgen_regulator', 'phy_qcom_m31_eusb2', 'phy_qcom_qmp_usb', 'dwc3_qcom'])
        self.assertEqual(modules[-3:], ['xhci_plat_hcd', 'usb_storage', 'uas'])
        self.assertEqual((out / 'kernel.args').read_text().split(), KERNEL_ARGS)
        self.assertIn('qcom/glymur/ASUSTeK/UX3407NA/qcadsp8480.mbn', (out / 'firmware.list').read_text().split())
        target = self.work / 'newroot'; target.mkdir()
        applied = self.sh(env, 'apply', str(target), str(out))
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertIn('asus/ux3407na', applied.stdout)
        self.assertTrue((target / 'etc/systemd/logind.conf.d/95-devos-hwprofile.conf').is_file())
    def test_device_tree_only_boot_under_the_live_busybox(self):
        result, out, _ = self.boot('ux3407na-real-dt-only')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((out / 'selection.json').read_text())['profile'], 'asus/ux3407na')
    def test_unknown_machine_logs_why_and_still_produces_files(self):
        result, out, _ = self.boot('generic-desktop')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('values read:', result.stdout)
        self.assertIn('product_name=[DT-9000]', result.stdout)
        self.assertGreater((out / 'identity.json').stat().st_size, 0)
        self.assertGreater((out / 'selection.json').stat().st_size, 0)

class LayoutTests(unittest.TestCase):
    def test_every_model_profile_has_match_rules_readme_and_status(self):
        models = [p.parent for p in PROFILES.glob('*/*/match') if p.parts[-3] not in ('generic', 'form-factors')]
        self.assertTrue(models)
        for model in models:
            self.assertTrue((model / 'README.md').is_file(), model)
            self.assertIn('test_status=', (model / 'profile.conf').read_text(), model)
    def test_kernel_dtsi_moved_into_profile(self):
        self.assertTrue((PROFILES / 'asus/ux3407na/kernel/ux3407na-audio.dtsi').is_file())
        self.assertFalse((ROOT / 'distro/usb/ux3407na-audio.dtsi').exists())

if __name__ == '__main__': unittest.main()
