#!/usr/bin/env python3
"""Stage independent DevOs Live USB inputs; never open a physical disk."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import tempfile
import uuid

HERE=Path(__file__).resolve().parent
DEFAULT_IMAGES=Path('/var/tmp/devos-oe/build/tmp/deploy/images/qemuarm64')
REQUIRED_APPLETS={'mount','modprobe','switch_root','sh','find','findfs','seq','cat','mkdir','sleep',
    'cp','chmod','ln','readlink','dmesg','timeout','kill','umount','sync','mv','tail','echo','true','false','test','['}

def run(*args):
    return subprocess.run(list(map(str,args)),check=True,capture_output=True,text=True).stdout

def digest(path):
    with path.open('rb') as stream: return hashlib.file_digest(stream,'sha256').hexdigest()

def regular(path):
    path=path.resolve()
    if not path.is_file() or path.stat().st_size==0: raise ValueError(f'Missing regular file: {path}')
    return path

def kernel_release(kernel):
    data=kernel.read_bytes()
    if data[56:60]!=b'ARM\x64': raise ValueError('An ARM64 Linux Image is required')
    match=re.search(rb'Linux version ([0-9][A-Za-z0-9.+_-]*-devos[A-Za-z0-9.+_-]*) ',data)
    if not match: raise ValueError('Expected a DevOs kernel')
    return match.group(1).decode()

def identity(rootfs):
    for path in ('/etc/os-release','/usr/lib/os-release'):
        text=run('debugfs','-R',f'cat {path}',rootfs)
        value=next((s.split('=',1)[1].strip().strip('\"\'') for s in text.splitlines() if s.startswith('ID=')),None)
        if value is not None:
            if value!='devos': raise ValueError('The rootfs is not independent DevOs')
            return text
    raise ValueError('Cannot read DevOs OS identity')

def kernel_bundle(path):
    path=path.resolve();record=json.loads((path/'manifest.json').read_text())
    if record.get('board')!='asus-ux3407na' or record.get('architecture')!='aarch64':
        raise ValueError('The kernel bundle must target ASUS UX3407NA ARM64')
    for name,expected in record['files'].items():
        file=(path/name).resolve()
        if not file.is_relative_to(path) or not file.is_file() or digest(file)!=expected:
            raise ValueError(f'Invalid kernel bundle input: {name}')
    release=kernel_release(regular(path/'Image'))
    if release!=record['release']: raise ValueError('Kernel bundle release mismatch')
    dtb=regular(path/'board.dtb').read_bytes()
    if dtb[:4]!=b'\xd0\x0d\xfe\xed' or b'asus,zenbook-a14-ux3407na\0' not in dtb:
        raise ValueError('The DTB does not target UX3407NA')
    config=(path/'kernel.config').read_text()
    for flag in ('CONFIG_EFI_STUB=y','CONFIG_MODULES=y','CONFIG_OVERLAY_FS=y','CONFIG_EXT4_FS=y','CONFIG_DRM_SIMPLEDRM=y',
                 'CONFIG_PINCTRL_GLYMUR=y','CONFIG_CLK_GLYMUR_GCC=y','CONFIG_CLK_GLYMUR_TCSRCC=y',
                 'CONFIG_INTERCONNECT_QCOM_GLYMUR=y','CONFIG_QCOM_CPUCP_MBOX=y','CONFIG_QCOM_AOSS_QMP=y'):
        if flag not in config.splitlines(): raise ValueError(f'X2 kernel missing {flag}')
    modules=path/'modules/lib/modules'/release
    if not (modules/'modules.dep').is_file(): raise ValueError('Missing matching X2 kernel modules')
    return record,modules

def firmware_bundle(path):
    path=path.resolve();record=json.loads((path/'manifest.json').read_text())
    if record.get('board')!='asus-ux3407na': raise ValueError('Wrong firmware board')
    actual={str(p.relative_to(path)) for p in path.rglob('*') if p.is_file() and p.name!='manifest.json'}
    if actual!=set(record['files']) or any(p.is_symlink() for p in path.rglob('*')):
        raise ValueError('Unlisted or symlinked firmware files are not allowed')
    for name,expected in record['files'].items():
        file=(path/name).resolve()
        board_elf = name == 'ath12k/QCC2072/hw1.0/board.bin' and regular(file).read_bytes()[:4] == b'\x7fELF'
        if not file.is_relative_to(path) or (file.suffix not in ('.mbn','.elf','.jsn') and not board_elf) or digest(regular(file))!=expected:
            raise ValueError(f'Invalid board firmware file: {name}')
    return record

def install_modules(rootfs,modules,output,target=None):
    # Offline writes to our private copied ext4 file only; no mount or /dev path.
    if not rootfs.is_file() or rootfs.is_symlink(): raise ValueError('Expected private regular rootfs copy')
    if target is None:
        with rootfs.open('r+b') as stream: stream.truncate(rootfs.stat().st_size+1024*1024*1024)
        result=subprocess.run(['e2fsck','-fy',str(rootfs)],capture_output=True,text=True)
        if result.returncode not in (0,1): raise ValueError('Rootfs filesystem check failed')
        run('resize2fs',rootfs)
    def quote(value):
        value=str(value)
        if any(c in value for c in ('\n','\r','\"','\\')): raise ValueError('Unsafe debugfs path')
        return '"'+value+'"'
    commands=[];base=Path(target) if target else Path('/usr/lib/modules')/modules.name
    commands.append('mkdir '+quote(base))
    for file in sorted(modules.rglob('*')):
        if file.is_symlink(): continue  # build/source links are not runtime inputs
        destination=base/file.relative_to(modules)
        if file.is_dir(): commands.append('mkdir '+quote(destination))
        elif file.is_file(): commands.append('write '+quote(file)+' '+quote(destination))
    kind='firmware' if target else 'modules'
    script=output/f'install-{kind}.debugfs';script.write_text('\n'.join(commands)+'\n')
    result=subprocess.run(['debugfs','-w','-f',str(script),str(rootfs)],capture_output=True,text=True)
    (output/f'install-{kind}.log').write_text(result.stdout+result.stderr)
    if result.returncode or any(word in result.stderr.lower() for word in ('not found','could not','no space','short read','usage:')):
        raise ValueError('Could not stage matching modules; see install-modules.log')
    proof=base/'qcom/glymur/ASUSTeK/UX3407NA/qcadsp8480.mbn' if target else base/'modules.dep'
    if 'Inode:' not in run('debugfs','-R',f'stat {proof}',rootfs):
        raise ValueError('Matching modules were not written into rootfs')

def cpio(tree,output):
    """Write newc without root privileges, preserving modules and symlinks."""
    with output.open('wb') as raw,gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0,compresslevel=6) as stream:
        inode=0
        def entry(name,mode,size=0,data=None,device=(0,0)):
            nonlocal inode
            inode+=1; name=name.encode()+b'\0'
            fields=(inode,mode,0,0,1,0,size,0,0,*device,len(name),0)
            header=b'070701'+b''.join(f'{v:08x}'.encode() for v in fields)
            stream.write(header+name+b'\0'*((-len(header)-len(name))%4))
            if isinstance(data,bytes): stream.write(data)
            elif data:
                with data.open('rb') as source: shutil.copyfileobj(source,stream)
            stream.write(b'\0'*((-size)%4))
        for path in sorted(tree.rglob('*')):
            info=path.lstat(); name=path.relative_to(tree).as_posix()
            if path.is_symlink():
                data=os.readlink(path).encode(); entry(name,info.st_mode,len(data),data)
            elif path.is_dir(): entry(name,info.st_mode)
            elif path.is_file(): entry(name,info.st_mode,info.st_size,path)
            else: raise ValueError(f'Unexpected initramfs file type: {path}')
        entry('dev/console',stat.S_IFCHR|0o600,device=(5,1))
        entry('dev/null',stat.S_IFCHR|0o666,device=(1,3))
        entry('TRAILER!!!',0)

def install_boot_tools(tree,busybox):
    applets=set(run(busybox,'--list').split())
    if REQUIRED_APPLETS-applets: raise ValueError(f'Missing live boot tools: {REQUIRED_APPLETS-applets}')
    destination=tree/'bin/busybox'
    if destination.exists(): destination.unlink()  # copied trees may use hardlinks
    shutil.copyfile(busybox,destination);destination.chmod(0o755)
    for applet in REQUIRED_APPLETS:
        link=tree/'bin'/applet
        if link.exists() or link.is_symlink(): link.unlink()
        link.symlink_to('busybox')
    (tree/'sbin').mkdir(exist_ok=True)
    kernel_modprobe=tree/'sbin/modprobe'
    if kernel_modprobe.exists() or kernel_modprobe.is_symlink(): kernel_modprobe.unlink()
    kernel_modprobe.symlink_to('../bin/busybox')
    init=tree/'init'
    if init.exists(): init.unlink()
    shutil.copyfile(HERE/'init',init);init.chmod(0o755)
    (tree/'diagnostics').mkdir(exist_ok=True)
    for source,name in (('collector','collector'),('collector.service','collector.service')):
        target=tree/'diagnostics'/name
        if target.exists(): target.unlink()
        shutil.copyfile(HERE/source,target)
    (tree/'live').mkdir(exist_ok=True)
    for name in ('greetd-root.toml','root-session','root-password.hash','pipewire-root.conf'):
        target=tree/'live'/name
        if target.exists(): target.unlink()
        shutil.copyfile(HERE/name,target)

def diagnose(args):
    record=check(args.output);destination=args.output.with_name(args.output.name+'-diagnostic')
    if destination.exists(): raise ValueError(f'Refusing to overwrite {destination}')
    destination.mkdir(parents=True)
    for name in record['files']: os.link(args.output/name,destination/name)
    shutil.copytree(args.output/'initramfs',destination/'initramfs',symlinks=True,copy_function=os.link)
    install_boot_tools(destination/'initramfs',regular(args.busybox))
    # Replace the linked old initrd without changing the original candidate.
    (destination/'initramfs.cpio.gz').unlink()
    cpio(destination/'initramfs',destination/'initramfs.cpio.gz')
    record['files']['initramfs.cpio.gz']=digest(destination/'initramfs.cpio.gz')
    record['bootDiagnostics']=True
    record['kernelInitcallDebug']=False
    record['liveDefaultUser']='root'
    record['espVolumeId']=record['filesystemUuid'].replace('-','')[:8].upper()
    record['reason']='Diagnostic candidate: bounded USB discovery, visible boot checkpoints and USB-local boot/GUI logs; hardware failure cause not yet established.'
    (destination/'manifest.json').write_text(json.dumps(record,indent=2)+'\n')
    print(f'Diagnostic staging bundle: {destination}',flush=True)

def stage_regulatory_database(rootfs, tree):
    # cfg80211 can initialize before switch_root, so rootfs-only firmware is late.
    source = '/usr/lib/firmware/regulatory.db'
    if 'Inode:' not in run('debugfs', '-R', f'stat {source}', rootfs):
        return False
    destination = tree / 'lib/firmware'
    destination.mkdir(parents=True, exist_ok=True)
    for name in ('regulatory.db', 'regulatory.db.p7s'):
        target = destination / name
        run('debugfs', '-R', f'dump /usr/lib/firmware/{name} "{target}"', rootfs)
        if not regular(target).stat().st_size:
            raise ValueError(f'Empty regulatory firmware: {name}')
    return True

def prepare(args):
    firmware_record=firmware_bundle(args.firmware) if args.firmware else None
    rootfs=args.rootfs
    if rootfs is None:
        candidates=[p for p in args.images.glob('devos-image*.ext4') if p.is_file()]
        if not candidates: raise ValueError('Build DevOs desktop first: .\\distro.ps1 desktop-build')
        rootfs=max(candidates,key=lambda p:p.stat().st_mtime)
    bundle_record=None;bundle_modules=None
    if args.kernel_bundle:
        bundle_record,bundle_modules=kernel_bundle(args.kernel_bundle)
    rootfs=regular(rootfs); kernel=regular(args.kernel_bundle/'Image' if args.kernel_bundle else args.kernel or args.images/'Image')
    busybox=regular(args.busybox); release=kernel_release(kernel); os_release=identity(rootfs)
    if 'INTERP' in run('readelf','-l',busybox): raise ValueError('BusyBox must be statically linked')
    header=busybox.read_bytes()[:20]
    if header[:4]!=b'\x7fELF' or int.from_bytes(header[18:20],'little')!=183: raise ValueError('BusyBox must be ARM64')
    applets=set(run(busybox,'--list').split())
    required=REQUIRED_APPLETS
    if required-applets: raise ValueError(f'Missing BusyBox applets: {required-applets}')
    output=args.output.resolve()
    if output.exists(): raise ValueError(f'Choose a new output directory: {output}')
    output.mkdir(parents=True)
    print('Staging checked DevOs kernel and rootfs...',flush=True)
    shutil.copyfile(kernel,output/'Image')
    shutil.copyfile(rootfs,output/'rootfs.ext4')
    filesystem_uuid=str(uuid.uuid4())
    run('tune2fs','-U',filesystem_uuid,output/'rootfs.ext4')
    if bundle_modules:
        print('Installing the matching X2 modules into the private DevOs rootfs copy...',flush=True)
        install_modules(output/'rootfs.ext4',bundle_modules,output)
        shutil.copyfile(args.kernel_bundle/'board.dtb',output/'board.dtb')
        shutil.copyfile(args.kernel_bundle/'manifest.json',output/'kernel-provenance.json')
        shutil.copyfile(args.kernel_bundle/'kernel.config',output/'kernel.config')
    if firmware_record:
        install_modules(output/'rootfs.ext4',args.firmware,output,target='/usr/lib/firmware')
        shutil.copyfile(args.firmware/'manifest.json',output/'firmware-provenance.json')
    (output/'os-release').write_text(os_release)
    tree=output/'initramfs'
    for path in ('bin','sbin','dev','proc','sys','run','lib/modules'): (tree/path).mkdir(parents=True,exist_ok=True)
    install_boot_tools(tree,busybox)
    # Extract modules from the exact image, not from the WSL/build-host kernel.
    if bundle_modules:
        shutil.copytree(bundle_modules,tree/'lib/modules'/release,symlinks=True,
                        ignore=lambda directory,names: [n for n in names if (Path(directory)/n).is_symlink()])
    else:
        for base in ('/usr/lib/modules','/lib/modules'):
            run('debugfs','-R',f'rdump {base}/{release} {tree}/lib/modules',rootfs)
            if (tree/'lib/modules'/release/'modules.dep').is_file(): break
        else: raise ValueError(f'No modules matching {release} in the rootfs')
    print('Packing static live initramfs with matching kernel modules...',flush=True)
    if firmware_record:
        shutil.copytree(args.firmware,tree/'lib/firmware',symlinks=False)
    regulatory_database = stage_regulatory_database(output/'rootfs.ext4', tree)
    cpio(tree,output/'initramfs.cpio.gz')
    manifest={'schemaVersion':1,'board':'asus-ux3407na','architecture':'aarch64','liveDefaultUser':'root',
        'release':release,'filesystemUuid':filesystem_uuid,'hardwareReady':False,'imageReady':bool(bundle_record),
        'reason':('X2 kernel/DTB/modules integrated. Experimental USB candidate; physical UX3407NA boot and device testing pending.' if bundle_record else 'Snapdragon X2 board kernel/Device Tree integration is pending; this is a staging bundle, not a bootable USB image.'),
        'files':{name:digest(output/name) for name in ('Image','rootfs.ext4','initramfs.cpio.gz','os-release')}}
    manifest['regulatoryDatabaseInInitramfs'] = regulatory_database
    if bundle_record:
        manifest['files'].update({name:digest(output/name) for name in ('board.dtb','kernel-provenance.json','kernel.config')})
    if firmware_record: manifest['files']['firmware-provenance.json']=digest(output/'firmware-provenance.json')
    manifest['limitations']=['Physical-machine boot not yet tested','OEM DSP firmware staged' if firmware_record else 'OEM DSP firmware not staged','Wi-Fi/BT calibration, audio and suspend not validated']
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Prepared: {output}\n{manifest["reason"]}\nNo USB drive was written.',flush=True)

def check(output):
    record=json.loads((output/'manifest.json').read_text())
    for name,expected in record['files'].items():
        if Path(name).name!=name: raise ValueError('Unsafe manifest filename')
        if digest(regular(output/name))!=expected: raise ValueError(f'Checksum mismatch: {name}')
    image=output/'devos-live-arm64-ux3407na.img'
    if image.exists(): verify_image(output,record)
    print('PASS: staged files and checksums\n'+record['reason'])
    return record

def pe_sections(path):
    with path.open('rb') as stream:
        header=stream.read(64)
        if header[:2]!=b'MZ': raise ValueError('Invalid EFI DOS header')
        pe=struct.unpack_from('<I',header,60)[0];stream.seek(pe)
        header=stream.read(24)
        if header[:4]!=b'PE\0\0' or struct.unpack_from('<H',header,4)[0]!=0xaa64:
            raise ValueError('EFI executable is not ARM64')
        count=struct.unpack_from('<H',header,6)[0];optional=struct.unpack_from('<H',header,20)[0]
        stream.seek(pe+24+optional);sections={}
        for _ in range(count):
            section=stream.read(40)
            name=section[:8].rstrip(b'\0').decode()
            size=struct.unpack_from('<I',section,8)[0];offset=struct.unpack_from('<I',section,20)[0]
            sections[name]=(offset,size)
        return sections

def verify_image(output,record):
    image=regular(output/'devos-live-arm64-ux3407na.img')
    expected=(output/'SHA256SUMS').read_text().split()[0]
    if digest(image)!=expected: raise ValueError('USB image checksum mismatch')
    if 'No problems found' not in run('sgdisk','--verify',image): raise ValueError('Invalid USB GPT')
    with image.open('rb') as stream:
        stream.seek(512);header=stream.read(92)
        entries=struct.unpack_from('<Q',header,72)[0]*512
        stream.seek(entries);entry=stream.read(128)
        if entry[:16]!=uuid.UUID('c12a7328-f81f-11d2-ba4b-00a0c93ec93b').bytes_le: raise ValueError('Missing EFI partition')
        offset=struct.unpack_from('<Q',entry,32)[0]*512
        if record.get('bootDiagnostics'):
            stream.seek(offset+67)
            if struct.unpack('<I',stream.read(4))[0]!=int(record['espVolumeId'],16): raise ValueError('Diagnostic ESP UUID mismatch')
        stream.seek(entries+128);root=stream.read(128);root_offset=struct.unpack_from('<Q',root,32)[0]*512
        stream.seek(root_offset);remaining=(output/'rootfs.ext4').stat().st_size;hasher=hashlib.sha256()
        while remaining:
            data=stream.read(min(8*1024*1024,remaining))
            if not data: raise ValueError('Truncated root partition')
            hasher.update(data);remaining-=len(data)
        if hasher.hexdigest()!=record['files']['rootfs.ext4']: raise ValueError('USB root partition mismatch')
    with tempfile.TemporaryDirectory(prefix='efi-check-',dir=output) as tmp:
        efi=Path(tmp)/'BOOTAA64.EFI';run('mcopy','-i',f'{image}@@{offset}','::/EFI/BOOT/BOOTAA64.EFI',efi)
        sections=pe_sections(efi)
        with efi.open('rb') as stream:
            for section,name in (('.linux','Image'),('.initrd','initramfs.cpio.gz'),('.dtb','board.dtb'),('.osrel','os-release')):
                start,size=sections[section];stream.seek(start);hasher=hashlib.sha256()
                remaining=size
                while remaining:
                    data=stream.read(min(8*1024*1024,remaining))
                    if not data: raise ValueError('Truncated EFI section')
                    hasher.update(data);remaining-=len(data)
                if hasher.hexdigest()!=record['files'][name]: raise ValueError(f'EFI section mismatch: {section}')
            start,size=sections['.cmdline'];stream.seek(start);cmdline=stream.read(size).decode().rstrip('\0')
            if f'devos.live.uuid={record["filesystemUuid"]}' not in cmdline: raise ValueError('EFI live UUID mismatch')
            if record.get('bootDiagnostics'):
                esp_id=record['espVolumeId'];esp_uuid=esp_id[:4]+'-'+esp_id[4:]
                if f'devos.live.esp_uuid={esp_uuid}' not in cmdline: raise ValueError('EFI diagnostic ESP UUID mismatch')
            if record.get('kernelInitcallDebug') and 'initcall_debug' not in cmdline.split():
                raise ValueError('EFI kernel initcall diagnostics missing')
    print('PASS: USB GPT, root partition, ARM64 EFI, kernel, DTB, initramfs and boot UUID',flush=True)

def build(output):
    record=check(output)
    if not record.get('imageReady') or 'board.dtb' not in record['files']:
        raise ValueError('Cannot create a bootable UX3407NA USB image yet: integrate and validate the X2 kernel/DTB first. Staged files remain available.')
    image=output/'devos-live-arm64-ux3407na.img'
    if image.exists(): raise ValueError(f'Refusing to overwrite {image}')
    for tool in ('ukify','sgdisk','mkfs.vfat','mmd','mcopy'):
        if not shutil.which(tool): raise ValueError(f'Missing build tool: {tool}')
    stub=regular(Path('/usr/lib/systemd/boot/efi/linuxaa64.efi.stub'))
    # All writes are to newly created regular files, never /dev devices.
    with tempfile.TemporaryDirectory(prefix='usb-pack-',dir=output) as tmp:
        tmp=Path(tmp); efi=tmp/'BOOTAA64.EFI'; esp=tmp/'esp.fat'
        cmdline=f'console=tty0 rdinit=/init clk_ignore_unused pd_ignore_unused arm64.nopauth devos.live.uuid={record["filesystemUuid"]} devos.renderer=pixman'
        if record.get('bootDiagnostics'):
            esp_id=record['espVolumeId'];esp_uuid=esp_id[:4]+'-'+esp_id[4:]
            cmdline+=f' devos.live.esp_uuid={esp_uuid} loglevel=3 panic=0 systemd.show_status=false systemd.log_target=journal vt.global_cursor_default=0'
        if record.get('kernelInitcallDebug'):
            cmdline+=' initcall_debug log_buf_len=4M'
        run('ukify','build','--efi-arch=aa64',f'--stub={stub}',
            f'--linux={output}/Image',f'--initrd={output}/initramfs.cpio.gz',
            f'--devicetree={output}/board.dtb',f'--os-release=@{output}/os-release',
            f'--uname={record["release"]}',
            f'--cmdline={cmdline}',
            f'--output={efi}')
        mib=1024*1024; esp_size=max(256*mib,((efi.stat().st_size+64*mib+mib-1)//mib)*mib)
        fat_options=['-i',record['espVolumeId']] if record.get('bootDiagnostics') else []
        run('mkfs.vfat','-C','-F','32','-n','DEVOS_EFI',*fat_options,esp,esp_size//1024)
        run('mmd','-i',esp,'::/EFI','::/EFI/BOOT')
        run('mcopy','-i',esp,efi,'::/EFI/BOOT/BOOTAA64.EFI')
        root_offset=mib+esp_size
        size=root_offset+((output/'rootfs.ext4').stat().st_size+mib-1)//mib*mib+mib
        partial=tmp/'disk.img'
        with partial.open('xb') as disk: disk.truncate(size)
        run('sgdisk','--clear','--new=1:2048:+'+str(esp_size//512),
            '--typecode=1:ef00','--change-name=1:DevOs EFI',
            '--new=2:'+str(root_offset//512)+':'+str((size-mib)//512-1),'--typecode=2:8300',
            '--change-name=2:DevOs Live',partial)
        with partial.open('r+b') as disk:
            for offset,source in ((mib,esp),(root_offset,output/'rootfs.ext4')):
                disk.seek(offset)
                with source.open('rb') as stream: shutil.copyfileobj(stream,disk,8*mib)
            disk.flush();os.fsync(disk.fileno())
        run('sgdisk','--verify',partial)
        partial.rename(image)
    (output/'SHA256SUMS').write_text(f'{digest(image)}  {image.name}\n')
    print(f'USB disk image: {image}\nUnsigned ARM64 UEFI boot. No physical USB drive was written.')

def export(output,destination):
    check(output);source=regular(output/'devos-live-arm64-ux3407na.img')
    destination.mkdir(parents=True,exist_ok=True);target=destination/source.name
    with source.open('rb') as stream,target.open('xb') as sink:
        shutil.copyfileobj(stream,sink,8*1024*1024);sink.flush();os.fsync(sink.fileno())
    if digest(target)!=digest(source): raise ValueError('Exported image checksum mismatch')
    (destination/'SHA256SUMS').write_text(f'{digest(target)}  {target.name}\n')
    shutil.copyfile(output/'manifest.json',destination/'candidate.json')
    print(f'Exported and verified: {target}\nNo physical USB drive was written.')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=('prepare','check','build','export','diagnose'))
    parser.add_argument('--output',type=Path,default=Path('/var/tmp/devos-usb/staged'))
    parser.add_argument('--images',type=Path,default=DEFAULT_IMAGES)
    parser.add_argument('--kernel',type=Path);parser.add_argument('--rootfs',type=Path)
    parser.add_argument('--kernel-bundle',type=Path)
    parser.add_argument('--firmware',type=Path)
    parser.add_argument('--export-directory',type=Path)
    parser.add_argument('--busybox',type=Path,default=Path('/var/tmp/devos-usb/busybox-build/busybox'))
    args=parser.parse_args()
    try:
        if args.mode=='diagnose': diagnose(args)
        elif args.mode=='export':
            if not args.export_directory: raise ValueError('Specify --export-directory')
            export(args.output,args.export_directory)
        elif args.mode=='build': build(args.output)
        elif args.mode=='check': check(args.output)
        else: prepare(args)
    except (OSError,ValueError,KeyError,struct.error,subprocess.SubprocessError) as error: parser.exit(1,str(error)+'\n')
if __name__=='__main__': main()
