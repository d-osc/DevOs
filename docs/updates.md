# Dev OS updates

## ใช้งาน

เปิด **Settings → Updates** แล้วเลือก **Check for updates → Install update**.
แหล่งเริ่มต้นคือ public repository `d-osc/DevOs`; เปลี่ยนได้ที่ **Update source** ในรูปแบบ `owner/repo`.
ระบบตรวจเฉพาะ stable release และแพ็กเกจที่ตรงกับสถาปัตยกรรมของ Linux ที่ใช้อยู่.
หาก repository ยังไม่มี release หน้าจอจะแสดง **No published releases yet**.
ตัวเลือก **Check when opening Updates** เปิดการตรวจเมื่อเข้าหน้านี้ได้; ค่าเริ่มต้นปิด.
การตรวจรุ่นไม่ดาวน์โหลดหรือติดตั้งแพ็กเกจอัตโนมัติ.

เมื่อติดตั้งเสร็จแล้ว ให้สลับ session ไปใช้รุ่นที่ติดตั้งไว้:

ตั้งแต่ session manager รุ่น 0.3.1 มีปุ่ม **Use latest version** หลังติดตั้งหรือเมื่อเปิด Updates กลับมา.
กดปุ่มแล้วบันทึกงานก่อนยืนยัน **Restart and use v…**. ระบบตรวจ dependencies และ version ของ runtime
ก่อนปิด shell เดิม แล้วเปิด shell/services ของรุ่นที่ติดตั้งไว้บน compositor เดิม.
Terminal, Files, Editor และ native apps ที่เป็นของ shell จะปิดระหว่างสลับ; preferences ยังคงอยู่.
เลข Running เปลี่ยนเมื่อ process ใหม่เริ่มทำงาน ไม่ถูกเปลี่ยนเพียงเพราะดาวน์โหลดเสร็จ.
รุ่น 0.2.0/0.3.0 ที่เปิดอยู่ยังไม่มี protocol นี้ ให้ใช้คำสั่งด้านล่างเพื่อเปิด 0.3.1 ครั้งแรก.

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
SHA-256 ใช้ตรวจความครบถ้วนจาก metadata ที่รับผ่าน HTTPS; แพ็กเกจยังไม่ได้ใช้ digital signature.
แหล่งอัปเดตจึงควรเป็น repository ที่คุณเชื่อถือ.

หลังตรวจครบจึงย้ายไปเก็บเป็นรุ่นแยก แล้วแทนที่ `history.json` แบบ atomic เพื่อเลือก session ถัดไป.
launcher อ่าน selection ครั้งเดียวและใช้ path ของรุ่นนั้นตลอด session.
source checkout และ preferences ใต้ `$XDG_CONFIG_HOME/dev-os` ไม่ถูกเขียนทับ.
runtime เก่าเก็บไว้เพื่อย้อนกลับ; การติดตั้งหลายรุ่นใช้พื้นที่เพิ่มตามขนาดแต่ละแพ็กเกจ.

หาก process ถูกหยุดระหว่างติดตั้งและเหลือ `install.lock`, ปิด Dev OS ทุก session ก่อน
แล้วลบเฉพาะไฟล์ lock ที่ระบุใน error เพื่อให้ติดตั้งใหม่ได้.
ถ้า `history.json` เสีย ระบบจะรายงาน error และไม่ทับ selection ด้วยประวัติที่อ่านไม่ได้.

## สร้าง release

workflow `.github/workflows/release.yml` build บน Ubuntu 24.04 x64 และ publish GitHub Release เมื่อ push tag `vX.Y.Z`.
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

`src/updates/service.ts` ดูแลการตรวจ ดาวน์โหลด ติดตั้ง และย้อนกลับ.
`src/updates/protocol.ts` ตรวจข้อมูล release และ archive.
`src/extensions/settings-pages.ts` เป็น registry ใน base สำหรับ Settings page contributions.
UI อยู่ใน `extensions/org.devos.updates/view.tsx` แบบ React + TypeScript; configuration อยู่ใน `extension.json`.
extension เรียก `context.registerSettingsPage(id, Component)` เพื่อแทน generic JSON form ของ extension ตัวเอง.
เมื่อ unregister จะกลับไปใช้ form ปกติ; runtime เก็บ cleanup ของ contribution ให้อัตโนมัติ.

## ทดสอบ

```sh
npm run build
gjs -m dist/updates-test.js
gjs -m dist/extensions-test.js
python3 tools/smoke.py
```

integration test ใช้ tar จริงใน temporary directories และ mock เฉพาะ network:
ตรวจ numeric version, URL, path ที่ไม่ปลอดภัย, การติดตั้งหลายรุ่น, launcher,
rollback, checksum ผิด, การติดตั้ง release แรกที่ version ตรงกับ development และ repository ว่าง.
ทดสอบติดตั้งแพ็กเกจจาก release packager เพิ่มได้โดยตั้ง `DEV_OS_UPDATE_TEST_PACKAGE` เป็น absolute path ของ tar ก่อนรัน `updates-test.js`.

หลังมี public release แล้ว ทดสอบ network และ session จริงด้วย:

```sh
python3 tools/update-smoke.py --output build/update-live
# ทดสอบสลับ shell ที่กำลังเปิดอยู่ไปใช้แพ็กเกจจาก GitHub บน compositor เดิม
python3 tools/update-smoke.py --switch --output build/update-switch
```

คำสั่งนี้ใช้ GitHub API และ HTTPS downloader ของระบบจริง ไม่มี network mock.
ติดตั้งใน temporary user data แยกจากผู้ใช้ แล้วเปิด Wayland แบบ headless พร้อม Files, Monaco Editor และ Settings.
เก็บ `report.json`, log และ screenshots ไว้ใน output และลบ temporary install หลังจบ.
ตัวเลือก `--switch` ตรวจ preflight, การปิด shell เดิม, การเปิดรุ่นใหม่เพียงครั้งเดียว และ compositor ที่คงเดิม.
ก่อนเผยแพร่ ใช้ `--package /absolute/path/dev-os-linux-x64.tar.gz` เพื่อทดสอบ artifact ในเครื่องแทน network.
