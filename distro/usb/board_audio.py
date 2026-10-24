"""Shared UX3407NA audio composition; helpers do not compile anything on import."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
AUDIO = ROOT / 'profiles/asus/ux3407na/kernel/ux3407na-audio.dtsi'
CAMERA = ROOT / 'profiles/asus/ux3407na/kernel/ux3407na-camera-candidate.dtsi'
EC_PATCH = ROOT / 'native/kernel/asus-glymur-ec/0002-ux3407na-ec.patch'
EC_PATCH_SHA256 = 'e8110cf1d5fa3aad9c17f914da0c951142da463cffdc7718dbeb03fc6982fc83'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def append_audio(board):
    text = board.read_text()
    if 'asus,zenbook-a14-ux3407na' not in text:
        raise ValueError('Audio configuration requires the UX3407NA board source')
    board.write_text(text + '\n' + AUDIO.read_text())


def check_camera_source(source):
    """The candidate graph needs the SoC camera nodes and the PM8010 driver from the 11-patch stack."""
    soc = (source / 'arch/arm64/boot/dts/qcom/glymur.dtsi').read_text()
    pmic = (source / 'drivers/mfd/qcom-pm8008.c').read_text()
    if 'qcom,glymur-camss' not in soc or 'qcom,pm8010-i2c' not in pmic:
        raise ValueError('Camera candidate needs a source tree prepared with native/kernel/ux3407na-camera/prepare-source.py --output')


def append_camera_candidate(board):
    board.write_text(board.read_text() + chr(10) + CAMERA.read_text())


def preserve_ec(tree, record):
    """Reapply the known EC change when rebuilding audio from pinned source."""
    if 'suspend-fixes.json' not in record['files']:
        return
    if digest(EC_PATCH) != EC_PATCH_SHA256:
        raise ValueError('EC board patch checksum mismatch')
    subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(EC_PATCH)], cwd=tree, check=True)


def write_proof(bundle, original, camera=False):
    proof = bundle / 'board-fixes.json'
    proof.write_text(json.dumps({
        'baseDtsSha256': digest(original), 'overrideSha256': digest(AUDIO),
        'audioLayout': 'two-speakers-two-dmics',
        'upstreamAudio': 'https://patchew.org/linux/20260915-zenbook-dts-v2-0-41de8669a7a8@oss.qualcomm.com/',
        'bluetoothFirmware': ['qca/ornnv11.bin', 'qca/ornbtfw11.tlv'],
        'hardwareTested': False,
        **({'cameraCandidateSha256': digest(CAMERA), 'cameraCandidate': 'unverified community wiring; see native/kernel/ux3407na-camera/BOARD-EVIDENCE.md'} if camera else {}),
    }, indent=2) + '\n')
    return digest(proof)


def validate_proof(bundle, record, filename='board-fixes.json'):
    if filename not in record['files']:
        raise ValueError('UX3407NA audio routing correction is missing. Prepare a fresh corrected board bundle; the four-speaker DTB does not match the ASUS microphone UCM profile.')
    proof = json.loads((bundle / filename).read_text())
    if proof.get('overrideSha256') != digest(AUDIO) or proof.get('audioLayout') != 'two-speakers-two-dmics':
        raise ValueError('UX3407NA audio routing proof is stale; prepare a corrected board bundle')
    if 'cameraCandidateSha256' in proof:
        if proof['cameraCandidateSha256'] != digest(CAMERA) or 'camera-fixes.json' not in record['files']:
            raise ValueError('Camera DTB needs matching rebuilt camera modules; use prepare-bundle.py')
        camera = json.loads((bundle/'camera-fixes.json').read_text())
        modules = camera.get('patchedModules', {})
        expected = {'qcom-camss.ko', 'qcom-pm8008.ko', 'qcom-pm8008-regulator.ko'}
        if {Path(name).name for name in modules} != expected:
            raise ValueError('Matching camera module provenance is incomplete')
        kernel_record = json.loads((bundle/'kernel-provenance.json').read_text()) if filename != 'board-fixes.json' else record
        for name, value in modules.items():
            target = name if filename == 'board-fixes.json' else 'staged-camera-' + Path(name).name
            if kernel_record['files'].get(name) != value or record['files'].get(target) != value or digest(bundle/target) != value:
                raise ValueError('Camera module does not match the camera DTB: ' + name)
