# Dev OS updates

## ใช้งาน

เปิด **Settings → Updates** แล้วเลือก **Check for updates → Install update**.
แหล่งเริ่มต้นคือ public repository `d-osc/DevOs`; เปลี่ยนได้ที่ **Update source** ในรูปแบบ `owner/repo`.
ระบบตรวจเฉพาะ stable release และแพ็กเกจที่ตรงกับสถาปัตยกรรมของ Linux ที่ใช้อยู่.
หาก repository ยังไม่มี release หน้าจอจะแสดง **No published releases yet**.
ตัวเลือก **Check when opening Updates** เปิดการตรวจเมื่อเข้าหน้านี้ได้; ค่าเริ่มต้นปิด.
การตรวจรุ่นไม่ดาวน์โหลดหรือติดตั้งแพ็กเกจอัตโนมัติ.
ตัวเลือก **Check for updates daily in the background** (ค่าเริ่มต้นปิด) ตรวจเองไม่เกินวันละครั้งขณะ shell ทำงาน; เปิดแล้วจะมี request ไป GitHub โดยไม่ต้องกดปุ่ม.

หน้า Updates แสดง: รุ่นที่รันอยู่/ติดตั้งไว้/รุ่นก่อนหน้า, ขนาด, สถานะ checksum และ signature, release notes (เนื้อหา `docs/releases/<version>.md`),
แถบ progress ระหว่างดาวน์โหลด, และข้อความที่บอกวิธีแก้เมื่อผิดพลาด (ไม่มีอินเทอร์เน็ต, GitHub rate limit พร้อมเวลาที่ลองใหม่ได้, พื้นที่ดิสก์ไม่พอ).
เมื่อติดตั้งเสร็จ ปุ่ม **Restart shell now** สลับไปรุ่นใหม่ (ต้องยืนยัน) หรือ **Restart later** เพื่อใช้ต่อก่อน.
**Use previous version** ย้อนกลับได้ทุกเมื่อ; ไฟล์ของแต่ละรุ่นไม่ถูกแก้ไขหลังติดตั้ง.

**Apply an update file** — เครื่องที่ไม่มีอินเทอร์เน็ต: คัดลอก `dev-os-linux-<arch>.tar.gz` (หรือ `dev-os-patch-…tar.gz`) จากหน้า GitHub release
ลง USB stick/Downloads พร้อม `SHA256SUMS` และ `SHA256SUMS.sig` ของ release เดียวกัน แล้วเลือกไฟล์ในหน้านี้ (ต้องกดยืนยันอีกครั้ง).
ไฟล์ถูกคัดลอกเป็นสำเนาส่วนตัวก่อนตรวจ จึงไม่เปลี่ยนระหว่างตรวจ; ไม่รับรุ่นที่ไม่ใหม่กว่ารุ่นที่ติดตั้ง (ใช้ **Use previous version** แทน).

### ขอบเขตและข้อจำกัด

- มีสองชั้น: **desktop layer** (shell, extensions, bin helpers, data, config, native tools — ต่อผู้ใช้ ไม่ใช้ root) และ **system layer**
  (kernel + initramfs + bootloader stub ใน boot image บน ESP, firmware, kernel modules, ไฟล์ระบบใต้ `/usr` — ใช้ helper สิทธิ์ root,
  ต้องยืนยันรหัสผ่านผู้ดูแล และมีปุ่ม **Restart now / Restart later** เพราะมีผลหลัง restart). ดู "System updates" ด้านล่าง.
  ไม่แตะ partition table, boot entry อื่น (เช่น Windows), `/etc` และข้อมูลผู้ใช้.
- **Live USB ไม่อัปเดตในที่เดิม**: root เป็น read-only image + RAM overlay การเปลี่ยนแปลงหายเมื่อปิดเครื่อง. หน้า Updates ตรวจพบ `/run/devos-live` จึงแสดง
  "Live USB is not updated in place" และปิดปุ่มติดตั้ง/Apply file (ยังตรวจรุ่นใหม่และอ่าน release notes ได้). ให้เขียน image ใหม่ลง USB (`tools/live/release-live-usb.ps1`).
- desktop layer ติดตั้งต่อผู้ใช้ (`~/.local/share/dev-os-updates`) โดยไม่ใช้ root: ผู้ใช้หลายคนมีรุ่นของตัวเอง และไฟล์ที่ดาวน์โหลดไม่ถูกรันด้วยสิทธิ์สูง.
  การเขียนทับ `/usr/share/dev-os` ทั้งเครื่องไม่ทำ; system layer เป็นทางเดียวที่แก้ไฟล์ของ image (เฉพาะ path ที่อนุญาต).

เมื่อติดตั้งเสร็จแล้ว ให้สลับ session ไปใช้รุ่นที่ติดตั้งไว้:

ตั้งแต่ session manager รุ่น 0.3.1 มีปุ่ม **Use latest version** หลังติดตั้งหรือเมื่อเปิด Updates กลับมา.
กดปุ่มแล้วบันทึกงานก่อนยืนยัน **Restart and use v…**. ระบบตรวจ dependencies และ version ของ runtime
ก่อนปิด shell เดิม แล้วเปิด shell/services ของรุ่นที่ติดตั้งไว้บน compositor เดิม.
Terminal, Files, Editor และ native apps ที่เป็นของ shell จะปิดระหว่างสลับ; preferences ยังคงอยู่.
เลข Running เปลี่ยนเมื่อ process ใหม่เริ่มทำงาน ไม่ถูกเปลี่ยนเพียงเพราะดาวน์โหลดเสร็จ.
รุ่น 0.2.0/0.3.0 ที่เปิดอยู่ยังไม่มี protocol นี้ ให้ใช้คำสั่งด้านล่างเพื่อเปิด 0.3.1 ครั้งแรก.

ตั้งแต่ 0.3.5 launcher เตรียม optional VTE runtime ให้ supervisor ก่อนเริ่ม GJS
เพื่อส่งต่อ `GI_TYPELIB_PATH` และ `LD_LIBRARY_PATH` ไปยัง shell รุ่นใหม่ด้วย.
รองรับการรับต่อจาก supervisor เก่าด้วยการหา VTE ข้าง private WSL tools ใน PATH.
บน Linux ที่ติดตั้ง VTE ใน system paths อยู่แล้วจะไม่เพิ่ม dependency paths.

```powershell
# Windows / WSLg, จาก checkout นี้
.\dev.ps1 updated
```

```sh
# Linux, จาก checkout นี้
bin/dev-os-updated-session --nested
# ถ้าติดตั้ง command ลง PATH แล้ว
dev-os-updated-session --nested
# จาก TTY ใช้ session ปกติแทน nested
dev-os-updated-session
```

`.\dev.ps1 run` และ `bin/dev-os-session` ใน checkout เปิด source สำหรับพัฒนา.
คำสั่ง `updated` เปิดแพ็กเกจที่เลือกไว้บน Linux filesystem โดยไม่ build source ใหม่.
Windows ยังใช้ private compositor และ optional VTE runtime ที่เตรียมผ่าน `dev.ps1 bootstrap`.
Linux ต้องมี dependencies ของ desktop ตาม README รวมถึง Soup 3, `curl`, `tar` และ `sha256sum`.
ไม่มี Node.js หรือ npm ในขั้นตอนติดตั้งและเปิด release.

เลือก **Use previous version** เพื่อย้อนกลับ แล้วกดปุ่มสลับรุ่นหรือเริ่ม updated session ใหม่ด้วยคำสั่งเดิม.
การติดตั้งและย้อนกลับไม่ปิดแอปหรือเปลี่ยน runtime ของ session ที่กำลังทำงาน.
ระบบนี้อัปเดต Dev OS shell, แอปและ extensions ที่มาพร้อมแพ็กเกจ; package manager ของ Linux ยังใช้ตามปกติ.

## ที่เก็บและการติดตั้ง

ข้อมูลอยู่ใน `${XDG_DATA_HOME:-$HOME/.local/share}/dev-os-updates/` ของผู้ใช้:

```text
history.json                         รุ่น current และ previous
releases/<version>-<digest-prefix>/  runtime ของแต่ละรุ่น
current                             symlink สำหรับดูรุ่นที่เลือก
install.lock                        ป้องกันตัวติดตั้งทำงานพร้อมกัน
```

ตรวจขนาดและ SHA-256 เทียบกับ asset digest จาก GitHub Releases API ก่อนแตกไฟล์.
ปฏิเสธ path traversal, symlink, hardlink และ special files ใน tar รวมถึงแพ็กเกจที่ขาด runtime ที่จำเป็น.
metadata ต้องระบุ version และ platform ตรงกับ release และ session commands ต้อง executable.
ดูรายละเอียดความเชื่อถือใน "Trust model" ด้านล่าง.

หลังตรวจครบจึงย้ายไปเก็บเป็นรุ่นแยก แล้วแทนที่ `history.json` แบบ atomic เพื่อเลือก session ถัดไป.
launcher อ่าน selection ครั้งเดียวและใช้ path ของรุ่นนั้นตลอด session.
source checkout และ preferences ใต้ `$XDG_CONFIG_HOME/dev-os` ไม่ถูกเขียนทับ.
runtime เก่าเก็บไว้เพื่อย้อนกลับ; การติดตั้งหลายรุ่นใช้พื้นที่เพิ่มตามขนาดแต่ละแพ็กเกจ.

หาก process ถูกหยุดระหว่างติดตั้งและเหลือ `install.lock`, ปิด Dev OS ทุก session ก่อน
แล้วลบเฉพาะไฟล์ lock ที่ระบุใน error เพื่อให้ติดตั้งใหม่ได้.
ถ้า `history.json` เสีย ระบบจะรายงาน error และไม่ทับ selection ด้วยประวัติที่อ่านไม่ได้.

## รูปแบบแพ็กเกจ

`dev-os-linux-<arch>.tar.gz` (สร้างโดย `tools/build/release.ts`) มีโฟลเดอร์ `dev-os/` ที่ประกอบด้วย payload (`bin`, `lib`, `dist`, `data`, `config`, `extensions`, `native`),
`release.json` และ **`manifest.json`**:

```json
{
  "format": 1, "version": "0.3.7", "platform": "linux-arm64",
  "minCompatible": "0.3.0",
  "postInstall": ["restart-shell"],
  "rollback": {"strategy": "keep-previous"},
  "files": [{"path": "dist/main.js", "sha256": "…64 hex…", "size": 123456, "mode": "644"}]
}
```

- `files` ครบทุกไฟล์ (ยกเว้น `manifest.json`) พร้อม sha256/ขนาด/โหมด (`644` หรือ `755`); path ต้องเป็น `[A-Za-z0-9._-]` คั่นด้วย `/` ไม่มี `..`.
  ตัวติดตั้งตรวจว่าต้นไม้ที่แตกไฟล์ **เท่ากับ** manifest พอดี: เนื้อหา, ชุดไฟล์ (ไฟล์เกิน/ขาดถูกปฏิเสธ) และ executable bit.
- `minCompatible` — รุ่นที่ติดตั้งอยู่ต้องไม่เก่ากว่านี้ (ตั้งผ่าน `DEV_OS_MIN_COMPATIBLE` ตอน package) ไม่งั้นแจ้งให้ลงรุ่นกลางก่อน.
- `postInstall` เป็นรายการปิด (ตอนนี้มีแค่ `restart-shell`): แพ็กเกจ **สั่งรันคำสั่งไม่ได้** ค่าที่ไม่รู้จักทำให้ปฏิเสธทั้งแพ็กเกจ.
- `rollback` — รุ่นก่อนหน้าเก็บไว้ครบ; ย้อนกลับคือสลับ `history.json` แบบ atomic. หลังติดตั้งรุ่นใหม่เก็บเฉพาะ current + previous
  (และรุ่นที่ session นี้รันอยู่); รุ่นเก่ากว่านั้นถูกลบเพื่อคืนพื้นที่.
- แพ็กเกจจากรุ่นก่อนมี manifest (ไม่มี `manifest.json`) ยังติดตั้งได้ถ้า hash ของ archive ตรง แต่ใช้เป็นฐานของ patch ไม่ได้.

### Patch (delta ระดับไฟล์)

`dev-os-patch-<from>-to-<to>-<platform>.tar.gz` มีเฉพาะไฟล์ที่เพิ่ม/เปลี่ยน (`tree/…`), manifest ของรุ่นปลายทางและ `patch.json`
(sha256 ของ manifest ฐานและปลายทาง + รายการ add/replace/remove พร้อม sha256 ของแต่ละไฟล์). สร้างด้วย:

```sh
gjs -m dist/make-patch.js --from build/previous/dev-os-linux-arm64.tar.gz --to build/release/dev-os-linux-arm64.tar.gz --output build/release
```

ตัวติดตั้ง **คัดลอกรุ่นที่ติดตั้งไว้** (ไม่แก้ของเดิม) แล้วลบ/ทับตาม patch และตรวจผลทั้งต้นไม้กับ manifest ปลายทาง; ปฏิเสธเมื่อ manifest ฐานไม่ตรงกับ
`patch.json`, ไฟล์ที่ติดตั้งไว้ถูกแก้, patch มีไฟล์เกินจากความต่างของสอง manifest หรือ checksum ไม่ตรง. ถ้า patch ใช้ไม่ได้ด้วยเหตุใดก็ตาม
จะดาวน์โหลดแพ็กเกจเต็มแทนโดยอัตโนมัติ (ตรวจแยกต่างหาก). Workflow สร้าง patch จาก release ก่อนหน้าให้เมื่อมี `manifest.json`; ผู้ใช้ที่ข้ามหลายรุ่นได้แพ็กเกจเต็ม.

## System updates (kernel, initramfs, bootloader/ESP, firmware, system packages)

เครื่องที่ติดตั้งแล้ว boot ด้วย unified kernel image เดียว (`EFI/DEVOS/DEVOS.EFI`, สำเนาที่ `EFI/BOOT/BOOTAA64.EFI`) ที่รวม kernel, initramfs, device tree และ
bootloader stub ไว้ในไฟล์เดียว (`distro/usb/prepare.dev`, ดู docs/installer.md). ดังนั้น "kernel + initramfs + bootloader" คือการเปลี่ยนไฟล์นี้,
"firmware/modules/package" คือไฟล์ใต้ `/usr`.

**Bundle** `dev-os-system-<platform>.tar.gz` (+ `dev-os-system-<platform>.json` คำอธิบายสั้น ๆ ที่หน้า Updates อ่านก่อนดาวน์โหลด) มี `dev-os-system/system.json`,
`system.list` (รูปแบบบรรทัดที่ helper อ่าน), `esp/EFI/DEVOS/*.EFI` และ `root/usr/...` พร้อม sha256/ขนาด/โหมดของทุกไฟล์. สร้างจากผลของ OE build บนเครื่อง build:

```sh
gjs -m dist/make-system-bundle.js --version 0.3.7 --platform linux-arm64 --kernel 6.17.0-devos --uki INSTALLED.EFI \
    --rootfs /path/to/extracted/rootfs --root-path usr/lib/modules/6.17.0-devos --root-path usr/lib/firmware --dereference --output build/release
sh tools/release/publish-system-bundle.sh --tag v0.3.7 --dir build/release --key /secure/private.pem   # แนบ asset + ลงนาม SHA256SUMS ใหม่
```

(GitHub Actions build image ไม่ได้ และ asset ต้อง < 2 GiB จึงทำจากเครื่อง build; ยังไม่มี bundle = หน้า Updates ไม่แสดงการ์ด System update.)

**ขั้นตอน (helper `native/devos-system-update`, polkit `org.devos.system.update`, `auth_admin`)**
1. ดาวน์โหลด bundle + `SHA256SUMS(.sig)` เป็นผู้ใช้, ตรวจ hash/ลายเซ็นฝั่ง UI, แล้ว helper (root) **ตรวจซ้ำทั้งหมดจากสำเนาของ root เอง**: hash ของไฟล์,
   ลายเซ็นกับ key ใน image (`/usr/share/dev-os/data/update-keys`), รายการ tar (ไม่มี link/อุปกรณ์/path แปลก), ทุกไฟล์ตรง `system.list` และไม่มีไฟล์เกิน,
   platform/รุ่น/`min`, พื้นที่ว่างบน ESP และ root. ไม่ผ่าน = ไม่เปลี่ยนอะไร.
2. Allow-list ของ path: ESP เฉพาะ `EFI/DEVOS/*.EFI`; root เฉพาะ `usr/{lib,bin,sbin,libexec,share}/…` ยกเว้น helper เอง, polkit actions และ unit `devos-system-*`;
   โหมดไฟล์ 644/755 เท่านั้น (ไม่มี setuid). ลบไฟล์ได้เฉพาะ path ที่ allow-list.
3. สำรองไฟล์ root ที่จะถูกทับ/ลบ แล้วเขียนทีละไฟล์ด้วย rename; ล้มเหลวกลางทาง = คืนทุกไฟล์.
4. boot image ใหม่ถูกวางข้าง ๆ (`EFI/DEVOS-NEXT/`) และสร้าง boot entry ชั่วคราวด้วย `efibootmgr` แล้วตั้ง **BootNext** (ครั้งเดียว) โดยคง BootOrder เดิม:
   ถ้า kernel ใหม่ boot ไม่ขึ้น (หรือ power cycle) firmware กลับไปใช้ entry เดิมเอง. ไม่มี efibootmgr/UEFI variables → เขียนทับในที่เดิมโดยเก็บของเดิมเป็น `.prev` (UI เตือนว่าไม่มี fallback อัตโนมัติ).
5. UI แสดง **Restart now / Restart later**. หลัง boot `devos-system-commit.timer` (90 วินาที) เรียก `commit`: ถ้า `uname -r` ตรงกับ kernel ของ bundle จึง promote
   (คัดลอกเป็น `DEVOS.EFI` และ `BOOTAA64.EFI`, เก็บของเดิมเป็น `.prev`, ลบ entry ชั่วคราว); ถ้าไม่ตรง (firmware fallback) จะ **คืนไฟล์ root ทั้งหมดและแจ้งว่าไม่ boot**.
6. **Restore previous system** (หลัง commit) คืนไฟล์ root + boot image จาก `.prev` แล้วต้อง restart. **Cancel system update** ใช้ก่อน restart.

ข้อจำกัด: ยังไม่ทดสอบบนฮาร์ดแวร์จริงหรือ QEMU (ทดสอบด้วย `efibootmgr` จำลอง); Secure Boot ไม่รองรับ (image ไม่ได้เซ็น); เก็บ kernel modules ของ kernel เก่าไว้ (ไม่ลบอัตโนมัติ);
ไฟล์ firmware ที่ถูกทับมีผลกับ kernel เก่าด้วยจนกว่าจะ restart; `/etc` ไม่ถูกแตะ; บนเครื่องที่ไม่มี key ใน image การป้องกันคือ HTTPS + SHA-256 + การยืนยันผู้ดูแลเท่านั้น
(helper รันโค้ดจาก bundle ที่ได้รับอนุญาตแล้วด้วยสิทธิ์ root ดังนั้น **ควรเปิดลายเซ็นก่อนปล่อย system update ครั้งแรก**). เวอร์ชันระบบเริ่มต้นอ่านจาก `VERSION_ID` ใน `/etc/os-release`
(ถ้าไม่ใช่ semver ถือเป็น 0.0.0 และเสนอ bundle ล่าสุดหนึ่งครั้ง) แล้วเก็บเองที่ `/var/lib/devos-system/state`.

## Trust model

| ชั้น | ตรวจอะไร | ป้องกันอะไร |
| --- | --- | --- |
| HTTPS + repository ที่ pin (`d-osc/DevOs`; URL ต้องเป็น `github.com/<repo>/releases/download/<tag>/…`) | ที่มาของ metadata และไฟล์ | คนกลางในเครือข่าย, asset ที่ชี้ไปโฮสต์อื่น |
| SHA-256 จาก GitHub API `digest` **และ** `SHA256SUMS` ของ release เดียวกัน (ต้องตรงกันทั้งคู่) | archive ที่ดาวน์โหลด | ไฟล์เสีย/ถูกสลับระหว่างทาง, asset ที่ถูกอัปโหลดทับโดยไม่แก้ sums |
| **Ed25519** ของ `SHA256SUMS` (`SHA256SUMS.sig`) กับ public key ใน `data/update-keys/*.pub` ของรุ่นที่รันอยู่ | ว่า sums มาจากผู้ถือ private key | ผู้ที่แก้ได้เฉพาะ release บน GitHub: แก้ asset หรือ sums แล้วไม่มีลายเซ็นที่ถูกต้อง |
| `manifest.json` ต่อไฟล์ | ต้นไม้ที่แตกไฟล์ทั้งหมด | patch/แพ็กเกจที่ประกอบผิด, ไฟล์แทรกเพิ่ม, executable bit ผิด |

กติกา: ถ้ารุ่นที่ติดตั้งมี public key อย่างน้อยหนึ่งดอก จะติดตั้ง **เฉพาะ release ที่ลายเซ็นถูกต้อง** (ไม่มี sums/ไม่มี sig/ลายเซ็นผิด = ปฏิเสธและไม่เปลี่ยนอะไร) ทั้งจาก GitHub
และไฟล์ในเครื่อง. ถ้ายังไม่มี key (สถานะปัจจุบันของ repository) จะตรวจเพียง HTTPS + SHA-256 และหน้า Updates แสดง "Not signed (checksum only)".
Private key **ไม่อยู่ใน repository**: เก็บเป็น GitHub secret `DEVOS_UPDATE_SIGNING_KEY` (PEM; workflow ใช้ `openssl pkeyutl -sign -rawin`).
หมุน key ได้โดย release ที่เซ็นด้วย key เดิมนำ `.pub` ใหม่มาด้วย.

**สิ่งที่ยังไม่ป้องกัน:**
- ถ้าไม่มี public key ใน image: ผู้ที่ควบคุม release ของ `d-osc/DevOs` บน GitHub (เช่น ขโมย token ของเจ้าของ repo) ทำให้เครื่องติดตั้งโค้ดอะไรก็ได้ (รันด้วยสิทธิ์ผู้ใช้ ไม่ใช่ root).
- ผู้ถือ private key, หรือ workflow/runner ที่ build ถูกบุกรุกก่อนเซ็น. ลายเซ็นยืนยัน "ใครปล่อย" ไม่ใช่ "โค้ดปลอดภัย".
- Freeze attack: ผู้โจมตีซ่อน release ใหม่ได้ (เครื่องจะไม่เห็นรุ่นใหม่) แม้ลงรุ่นเก่ากว่าไม่ได้ (รุ่นที่ไม่ใหม่กว่าถูกปฏิเสธ).
- ไฟล์อัปเดตในเครื่องบนระบบที่ยังไม่มี key: เชื่อถือเฉพาะ checksum ข้างไฟล์ (ถ้ามี).
- เครื่องที่ถูกบุกรุกอยู่แล้ว (แก้ `dev-os-updates` หรือ `data/update-keys` ได้).
- ความเป็นส่วนตัว: การตรวจรุ่นเปิดเผยต่อ GitHub ว่า IP นี้ใช้ Dev OS; จึงปิดการตรวจอัตโนมัติเป็นค่าเริ่มต้น.

## สร้าง release

**วิธี release ที่รองรับ** คือ workflow "Build and publish DevOs release" (`release-manual.yml` บน branch `ux3407na-dev`; เขียน notes ที่
`docs/releases/<version>.md` ก่อน — เนื้อหานั้นคือ release body ที่หน้า Updates แสดง). มันเผยแพร่ `dev-os-linux-x64/arm64.tar.gz` (มี `manifest.json`),
patch จาก release ก่อนหน้า (`dev-os-patch-*`), runtime/source archives, `SHA256SUMS` ของทุก asset และ `SHA256SUMS.sig` เมื่อตั้ง secret `DEVOS_UPDATE_SIGNING_KEY`.
เปิดใช้ลายเซ็น: `openssl genpkey -algorithm ed25519 -out private.pem` แล้ว `openssl pkey -in private.pem -pubout -out data/update-keys/release.pub`,
เก็บ `private.pem` เป็น secret และ commit เฉพาะ `.pub` (หลังนั้น workflow ปฏิเสธการ release ที่ไม่มี secret). image ที่ build หลังจากนั้นจึงบังคับลายเซ็น.
ก่อนมี key คู่แรกใน image การติดตั้งเป็นแบบ checksum อย่างเดียว.

workflow `.github/workflows/release.yml` build บน Ubuntu 24.04 ทั้ง x64 และ ARM64 แล้ว publish GitHub Release พร้อมแพ็กเกจทั้งสองสถาปัตยกรรมและ SHA256SUMS เมื่อ push tag `vX.Y.Z`.
ต้องส่ง source และ workflow ไปยัง repository ก่อน; การเพิ่ม Git remote อย่างเดียวไม่ได้ publish release.
ตัวอย่างเมื่อพร้อมเผยแพร่ source ที่ตรวจแล้ว:

```sh
git add .
git commit -m "Add Dev OS desktop and release updater"
git push -u origin main
git tag v0.2.0
git push origin v0.2.0
```

workflow อ่าน version จาก tag, build ให้ runtime รายงาน version ตรงกัน,
รันทดสอบตัวติดตั้ง และแนบ `dev-os-linux-x64.tar.gz` กับ `SHA256SUMS`.
release ต้องเป็น public stable release และ GitHub asset ต้องมี `digest` แบบ `sha256:...`.
draft, prerelease หรือ asset ที่ไม่มี digest จะไม่ถูกติดตั้ง.

สร้างแพ็กเกจเองบน Linux (Node.js 24+ และ dependencies สำหรับ build native tracker):

```sh
npm ci
DEV_OS_RELEASE_VERSION=0.3.0 npm run build
DEV_OS_RELEASE_VERSION=0.3.0 npm run release:package
```

ผลลัพธ์อยู่ใน `build/release/`. ต้อง build และ package ด้วย version เดียวกัน.
เครื่อง x64 สร้าง `dev-os-linux-x64.tar.gz`; เครื่อง ARM64 สร้าง `dev-os-linux-arm64.tar.gz`.
workflow ปัจจุบัน build อัตโนมัติเฉพาะ x64; ARM64 ต้อง build บนเครื่อง ARM64 แล้วแนบ asset เพิ่มเอง.
แพ็กเกจประกอบด้วย `bin`, compiled `dist`, `data`, `config`, built-in `extensions`, native tracker และ `release.json`:

```json
{"format": 1, "version": "0.3.0", "platform": "linux-x64"}
```

## โครงสร้างสำหรับ extension

`packages/updates/manifest.ts` รูปแบบ manifest/patch/SHA256SUMS (ไม่ใช้ GLib); `package.ts` ตรวจต้นไม้, ตรวจลายเซ็น, สร้าง/ใช้ patch; `make-patch.ts` คำสั่งสำหรับ release.

`packages/updates/service.ts` ดูแลการตรวจ ดาวน์โหลด ติดตั้ง และย้อนกลับ.
`packages/updates/protocol.ts` ตรวจข้อมูล release และ archive.
`packages/extensions/settings-pages.ts` เป็น registry ใน base สำหรับ Settings page contributions.
UI อยู่ใน `src/apps/org.devos.updates/view.tsx` แบบ React + TypeScript; configuration อยู่ใน `extension.json`.
extension เรียก `context.registerSettingsPage(id, Component)` เพื่อแทน generic JSON form ของ extension ตัวเอง.
เมื่อ unregister จะกลับไปใช้ form ปกติ; runtime เก็บ cleanup ของ contribution ให้อัตโนมัติ.

## ทดสอบ

```sh
npm run build
gjs -m dist/updates-test.js
gjs -m dist/extensions-test.js
d tools/test/smoke.dev --
gjs -m dist/update-package-test.js   # manifest, ตรวจต้นไม้, patch, ลายเซ็น Ed25519, make-patch (ต้องมี openssl)
gjs -m dist/system-update-test.js    # helper สิทธิ์ root: boot image A/B, BootNext, commit/rollback, allow-list, ลายเซ็น, ตัวติดตั้งใน UI (ต้องมี openssl)
gjs -m dist/updates-patch-test.js    # ติดตั้ง/patch/ย้อนกลับ/ไฟล์ในเครื่อง/ล้มเหลวกลางทาง/Live USB/offline/rate limit ด้วย GitHub จำลอง
gjs -m dist/updates-ui-test.js       # หน้า Settings → Updates
```

integration test ใช้ tar จริงใน temporary directories และ mock เฉพาะ network:
ตรวจ numeric version, URL, path ที่ไม่ปลอดภัย, การติดตั้งหลายรุ่น, launcher,
rollback, checksum ผิด, การติดตั้ง release แรกที่ version ตรงกับ development และ repository ว่าง.
ทดสอบติดตั้งแพ็กเกจจาก release packager เพิ่มได้โดยตั้ง `DEV_OS_UPDATE_TEST_PACKAGE` เป็น absolute path ของ tar ก่อนรัน `updates-test.js`.

หลังมี public release แล้ว ทดสอบ network และ session จริงด้วย:

```sh
d tools/test/update-smoke.dev -- --output build/update-live
# ทดสอบสลับ shell ที่กำลังเปิดอยู่ไปใช้แพ็กเกจจาก GitHub บน compositor เดิม
d tools/test/update-smoke.dev -- --switch --output build/update-switch
```

คำสั่งนี้ใช้ GitHub API และ HTTPS downloader ของระบบจริง ไม่มี network mock.
ติดตั้งใน temporary user data แยกจากผู้ใช้ แล้วเปิด Wayland แบบ headless พร้อม Files, Monaco Editor และ Settings.
เก็บ `report.json`, log และ screenshots ไว้ใน output และลบ temporary install หลังจบ.
ตัวเลือก `--switch` ตรวจ preflight, การปิด shell เดิม, การเปิดรุ่นใหม่เพียงครั้งเดียว และ compositor ที่คงเดิม.
ทดสอบเปิด Terminal และ PTY หลังสลับรุ่นด้วย โดยไม่ตั้งค่า VTE environment ล่วงหน้าให้ launcher.
ก่อนเผยแพร่ ใช้ `--package /absolute/path/dev-os-linux-x64.tar.gz` เพื่อทดสอบ artifact ในเครื่องแทน network.
