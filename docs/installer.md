# Installing Dev OS from the Live USB

The Live USB can install Dev OS onto the computer's internal disk (ARM64 UEFI). Open
**Install Dev OS** in the launcher, or run `dev-os-shell installer`. It works only from the Live
session, because it erases a whole disk. The installed system does not carry the installer: the helper removes
`dev-os-install`, its launcher entry, its extension and its bundle from the new disk after copying.

## What it does

1. Lists disks that are safe to erase: whole, writable, at least 8 GiB, with **no mounted
   filesystem or active swap**, and never the Live USB the system booted from. Existing data
   (for example `ntfs,vfat`) is shown so the choice is informed.
2. Asks for a user name, computer name and password. The user is an administrator (`wheel`);
   the root account stays locked.
3. Requires typing the exact disk path (for example `/dev/nvme0n1`) before **Erase disk and
   install** is enabled. The helper checks the path **and** the disk's byte size again.
4. Partitions the disk (GPT: 512 MiB EFI system partition `DEVOSESP`, the rest ext4 `devos-root`),
   copies the clean Dev OS root filesystem from the Live USB (not the Live RAM overlay, so no
   Live autologin or password is carried over), writes `/etc/fstab` with UUIDs, the host name and
   the user, and copies the machine's hardware profile.
5. Installs the boot image `EFI/DEVOS/DEVOS.EFI` and the removable-media fallback
   `EFI/BOOT/BOOTAA64.EFI`, and adds a firmware entry with `efibootmgr` when available. Other
   disks and the Windows boot entries are not touched.

Closing the window is blocked while the installation runs. If it fails, the helper unmounts
everything and reports the error; the target disk may then be partly written, and the Live USB
still works.

## Command line

```sh
dev-os-install disks [--json]        # candidate disks, read only
dev-os-install plan --disk /dev/nvme0n1 --username me
echo 'password' | dev-os-install run --disk /dev/nvme0n1 \
    --confirm-erase /dev/nvme0n1 --confirm-size <bytes from plan> \
    --username me --hostname mybox --password-stdin
```

`plan` prints what would be erased and the confirmation flags. `run` is refused unless it runs as
root from the Live session on a UEFI ARM64 machine and every confirmation matches. The password
is read only from standard input, never from arguments or the environment, and is not written to
the log (`/var/log/devos-install.log`). Progress lines look like `STEP 4/10 Copying Dev OS`,
then `DONE` or `ERROR message`.

## How the installed system boots

`distro/usb/prepare.py` builds two unified kernel images from the same kernel, initramfs and board
device tree. `EFI/BOOT/BOOTAA64.EFI` is the Live system. `EFI/DEVOS/INSTALLED.EFI` has the command
line `devos.root=LABEL=devos-root`; the initramfs `init` then mounts that root read-write and
starts systemd directly, without the Live overlay, autologin or diagnostics. The hardware profile
for the detected machine is applied on every boot. The installer copies `INSTALLED.EFI` from the
Live USB's EFI partition (label `DEVOS_EFI`), so a Live USB built before this feature must be
rebuilt (`.\live-usb.ps1 build`).

## Limits

- UEFI and ARM64 only. Secure Boot is not supported yet (the images are unsigned).
- One install per machine: the root is found by the label `devos-root`; two disks with that label
  would be ambiguous.
- No dual boot, resizing or encryption. The whole disk is used.
- Tested here with the real root filesystem on a loop-device disk and a QEMU boot of the installed
  system through the modified `init`; the UEFI/UKI path and the ASUS UX3407NA were **not** tested on
  hardware. Do not install on a machine you cannot recover until Live USB boot has been confirmed.

Tests: `python3 tests/installer.test.py` (disk selection and refusals, no disk writes),
`wsl -u root python3 tests/installer-loop.test.py` (real run on a loop device), and the
`installer-ui-test` GJS test for the wizard.
