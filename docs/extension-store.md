# Extension Store

Store อยู่ที่ **Settings → Extension Store**. ใส่ `owner/repo` หรือ `https://github.com/owner/repo`
แล้วเลือก **Connect**. ระบบอ่าน stable release ล่าสุดกับไฟล์ `extension.json` ใน release
เพื่อแสดงชื่อ รายละเอียด รุ่น และปุ่ม Install / Update.
เมื่อเชื่อม repo แล้ว ไม่ต้องอัปโหลดไฟล์เข้าระบบ Store อีก: เผยแพร่ GitHub Release ของ repo นั้นได้เลย.
ในรุ่นนี้ใช้ public GitHub repositories; ไม่ต้องล็อกอินหรือใส่ token ใน desktop.

เลือก **Check all** หรือ **Check release** เพื่ออ่านรุ่นใหม่. การตรวจไม่ติดตั้งอัตโนมัติ.
Store รองรับ Install, Update, Rollback, enable/disable และ Remove แบบยืนยันสองครั้ง.
Disconnect ถอนการติดตาม repo แต่เก็บ extension ที่ติดตั้งไว้.
Remove ถอน package link และเก็บ preferences ไว้เผื่อติดตั้งกลับ.
settings แบบ declarative แสดงทันทีหลังติดตั้ง; UI code และการเปลี่ยน enable/disable ใช้เมื่อเริ่ม session ใหม่.

UI extensions ใช้สิทธิ์เดียวกับ desktop session จึงควรเชื่อม repo ที่คุณเชื่อถือ.
base ของระบบไม่ถูกแทนที่หรือปิดผ่าน Store.
ถ้า user UI โหลด/activate ล้มเหลว ระบบข้าม extension นั้นและเก็บ base UI ไว้.

## รูปแบบ release สำหรับผู้พัฒนา

หนึ่ง repo ใช้กับหนึ่ง extension. Tag ต้องเป็น stable semver เช่น `v1.0.0`
และตรงกับ `extension.json` ที่ระบุ `version: "1.0.0"`.
แนบไฟล์เหล่านี้ลง GitHub Release:

| Asset | หน้าที่ |
| --- | --- |
| `extension.json` | manifest สำหรับ discovery และรายละเอียดใน Store |
| `dev-os-extension.tar.gz` | package สำหรับติดตั้ง |
| `SHA256SUMS` | checksum สำหรับตรวจเอง; Store ใช้ digest ของ tar จาก GitHub API |

package มี root directory ชื่อ `extension/`:

```text
extension/
  extension.json
  dist/<entry>.js       สำหรับ kind: ui
  dist/core.js     shim เพื่อใช้ React GTK runtime ของ desktop
  assets/              optional
  icons/               optional
  style.css            optional
```

Store ตรวจ SHA-256 และขนาดของ tar, path traversal, duplicate paths, links และ special files.
manifest ใน tar ต้องตรงกับ release manifest และห้าม `system: true` หรือใช้ ID ของ base package.
ขนาด tar ไม่เกิน 32 MiB, หลังแตกไม่เกิน 128 MiB และไม่เกิน 4,000 entries.
draft, prerelease และ asset ที่ไม่มี SHA-256 digest ถูกปฏิเสธ.
ค่าการตั้งค่าที่บันทึกไว้ไม่ถูกเขียนทับตอนอัปเดต; หากเปลี่ยน settingsVersion ยังต้องจัดการ migration ตาม schema ปัจจุบัน.

## สร้าง package

มีตัวอย่าง React UI ที่ `examples/extensions/org.example.status/`.
ใช้ Dev OS toolkit ที่มี `tools/build/extension-release.ts` (Node.js 24+ และ tar):

```sh
npm ci
npm run build
npm run extension:package -- examples/extensions/org.example.status
```

ไฟล์พร้อมแนบ release อยู่ใน `build/extension-release/`.
ระบุ output directory เองได้เป็น argument ตัวที่สอง.
สำหรับ source ของ extension repo แยก ให้เรียก CLI ของ toolkit โดยส่ง path ไปยัง directory ที่มี manifest:

```sh
node /path/to/dev-os/tools/build/extension-release.ts /path/to/my-extension /path/to/output
gh release create v1.0.0 /path/to/output/extension.json /path/to/output/dev-os-extension.tar.gz /path/to/output/SHA256SUMS --title "My extension 1.0.0" --generate-notes
```

UI source ชื่อ `extension.tsx` หรือ `extension.ts`. Import React และ GTK components จาก `@dev-os/core`.
ตัว packager compile TS/TSX เป็น GJS module และใช้ runtime ของ desktop ร่วมกัน จึงไม่ bundle React สำเนาใหม่.
ใช้ `context.packageRoot` เป็น absolute path สำหรับอ่าน icons, CSS หรือ assets ของรุ่นที่กำลังรัน.
ส่งคืน cleanup จาก `activate(context)` เพื่อปิด window/React root/subscriptions.
user extension ลงทะเบียน Settings page ของ ID ตัวเองผ่าน `context.registerSettingsPage(id, Component)` ได้.

## GitHub Actions สำหรับ upload อัตโนมัติ

คัดลอก [extension-release.workflow.yml](extension-release.workflow.yml) ไปเป็น `.github/workflows/release.yml` ใน extension repo
แล้ว push source และ tag `vX.Y.Z`. Workflow checkout repo ของ extension กับ Dev OS toolkit,
build package และ publish release assets ให้ Store อ่านได้.
ต้องใช้ toolkit revision ที่มีเครื่องมือ Store นี้; template ใช้ `d-osc/DevOs` branch `main`.
สำหรับ production สามารถ pin `ref` ของ toolkit เป็น commit ที่ตรวจแล้ว.
นี่เป็นการเผยแพร่ผ่าน GitHub Releases ของผู้พัฒนา ไม่ต้องลงทะเบียนใน central catalog.

## ที่เก็บและ lifecycle

```text
~/.local/share/dev-os/extension-store/repositories.json
~/.local/share/dev-os/extension-store/releases/<id>/<version>-<digest-prefix>/
~/.local/share/dev-os/extensions/<id>   symlink ไปยังรุ่นที่เลือก
~/.config/dev-os/extensions/<id>.json  preferences
```

ใช้ XDG_DATA_HOME / XDG_CONFIG_HOME หากกำหนดไว้.
ตัวติดตั้งดาวน์โหลดและแตกใน staging directory ก่อนเปลี่ยน package symlink แบบ atomic.
runtime loader resolve symlink เป็น immutable path ก่อน import เพื่อไม่เปลี่ยน module ของ session ที่เปิดอยู่.
Rollback เลือกรุ่นก่อนหน้า; Check release + Update ใช้กลับไปยังรุ่นล่าสุดได้.
เก็บ runtime เก่าไว้สำหรับ rollback. ถ้า process ถูกหยุดและทิ้ง `install.lock`, ปิด Dev OS ก่อนลบ lock ดังกล่าว.

## ทดสอบ

```sh
npm run build
gjs -m dist/store-test.js
python3 tools/test/smoke.py
```

Store integration tests ใช้ network fixture และ tar จริง ตรวจ install/update/rollback,
loader ของ user UI, settings persistence, corrupt downloads, disable/uninstall และ base protection.
ไม่ได้สร้างหรือ publish GitHub extension repo ตัวอย่างให้อัตโนมัติ.
หลัง package ตัวอย่างแล้ว ตั้ง `DEV_OS_STORE_TEST_PACKAGE` เป็น absolute path ของ tar
เพื่อทดสอบ packager artifact และ shared React hooks เพิ่มด้วย `store-test.js` และ `tools/test/smoke.py`.
