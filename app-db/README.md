# DevOs App Registry

แหล่งข้อมูลกลางสำหรับแอปใน **DevOs Linux ARM64** เก็บข้อมูล Store, README, รูป, แหล่งไฟล์ต้นทาง และ release ที่เตรียมให้ DevOsPM โดยอิง implementation จริงของ DevOs/DevOsPM

## ขอบเขตที่ต้องรู้

- **DevOsPM / Packages tab**: ติดตั้งระดับผู้ใช้จาก dpk/dpkx/tar.gz/deb/rpm, มี snapshot/rollback, bin และ XDG launcher
- **Native AppStore**: ระบบ opkg/IPK ระดับ system, signed HTTPS feed และ polkit; ไม่ใช้ vendor deb เป็น native package โดยตรง
- **Repo นี้**: catalog กลางที่ `pm-cli` และ App Store อ่านผ่าน `database-cli.dev`; รองรับ `dev catalog`, `dev search` และ `dev install ID/ALIAS` แล้ว สถานะติดตั้งและ binding ใช้ registry ของ PM ชุดเดียว
- **Extensions ใน AppStore**: ย้ายหน้าจอเดิมมาอยู่แท็บ Extensions แต่คง GitHub release verification, preferences, enable/disable และ rollback เดิม

ผลอ่าน source อยู่ใน [source audit](docs/source-audit.md) และ [data contract v2](docs/registry-contract.md) แบบ v2 ยกเลิกสมมติฐาน ZIP-only/standalone launcher ของแบบร่างเดิม

## ฐานข้อมูลที่ใช้งานจริง

`database.dev`/`database-cli.dev` เป็น reader และตัวเลือก artifact ร่วมของ CLI กับ
App Store โดยอ่าน `apps/*/app.json` โดยตรงใน checkout หรืออ่าน snapshot
`catalog-data/` ที่แพ็กไปกับ CLI ผ่าน `pm-cli/stage.sh` การเปิดหน้าร้านไม่ดาวน์โหลดแอป
และไม่เขียน authoring metadata

สถานะติดตั้ง, active/previous และ mapping id → ชื่อแพ็กเกจจริงอยู่ใน registry
ของ PM ภายใต้ lock เดียว App Store เรียก `dev catalog --json`/`list --json` และคำสั่ง
ติดตั้ง/ถอน/rollback แทนการเขียนไฟล์สถานะเอง มีการย้าย legacy bindings ของ UI
แบบครั้งเดียวโดยเก็บไฟล์ต้นฉบับเป็น `.migrated` ดูรายละเอียดและคำสั่งใน
[pm-cli README](../pm-cli/README.md#ฐานข้อมูลร่วมกับ-app-store)

## ข้อมูลแอป

```text
apps/<id>/app.json            metadata + upstream downloads + prepared releases
apps/<id>/README.md           รายละเอียดสำหรับ Store
apps/<id>/assets/             icon/screenshots เมื่อมีไฟล์จริง
schema/app.schema.json       registry schema v2 + expected PM package manifest
scripts/build_registry.dev   ตรวจข้อมูลและสร้าง index ด้วย DevLang
scripts/package_contract.dev ตรวจส่วนที่สัมพันธ์กับ DevOsPM
examples/                    schema fixtures เท่านั้น ไม่ใช่แอปที่ติดตั้งได้
extensions/<namespaced-id>/listing.json  ข้อมูลแนะนำ extension ใน registry
extensions/<namespaced-id>/package/      runtime manifest และ source ของตัวอย่าง
schema/extension*.schema.json            แยก listing ออกจาก runtime manifest
```

เพิ่ม vscode, chrome, chatgpt, claude-desktop (alias claude), zcode ของ Z.ai และ firefox แล้ว ทั้งหมดเป็น catalog/untested พร้อม upstream Linux ARM64 deb ใน downloads[].file_url จึงยังไม่ใช่ prepared release ที่รับรอง compatibility การสั่งติดตั้งด้วยชื่อหรือเลือกติดตั้งใน App Store เป็นการติดตั้ง upstream ตามคำสั่งผู้ใช้ การตรวจ HEAD ผ่านไม่ใช่การรับรอง dependency/ABI/launcher โดย Firefox ยังเป็น source-only เพราะ HEAD ตอบ 400

ชื่อแสดงผลของ Store, registry ID, PM package.name, bin command และ native opkg package เป็นคนละ identity ให้ยึด metadata ที่ตรวจจากแพ็กเกจจริง ห้ามเดา package name เพื่อถอนการติดตั้ง

ไอคอน launcher ของ PM มาจาก package.json: fullname/shortname, icon และ bin ส่วน registry icon/readme อยู่คนละ root กับไฟล์ใน payload

## สร้างและตรวจ

ใช้ DevLang release v0.5.6 และ Git ใน PATH ไม่ต้องติดตั้ง dependency เพิ่ม:

```sh
d scripts/build_registry.dev
d scripts/test_registry.dev
d scripts/test_registry.dev --engine ast
d scripts/package_extension.dev -- org.example.workspace-notes
d scripts/test_extensions.dev
d scripts/test_extensions.dev --engine ast
```

รันด้วย absolute path จากโฟลเดอร์อื่นได้ ผลลัพธ์ dist/index.json เป็น local preview ที่ไม่ commit เข้า Git ไม่ใช่ native catalog ที่ผ่านการเซ็น ตัว validator รองรับเฉพาะ schema keywords ใน repo และปฏิเสธ keyword ที่ไม่รองรับ ยังไม่ดาวน์โหลด artifact เพื่อตรวจ hash หรือทดสอบแอปบน DevOs

เตรียม release จริงหลังตรวจ binary/dependencies และ install/run/verify/replace/rollback/remove บน DevOs desktop image ที่ระบุเท่านั้น Desktop target ใช้ glibc/Wayland ต่างจาก console bootstrap ที่ใช้ musl

## Extension ตัวอย่าง

[Workspace Notes](extensions/org.example.workspace-notes/README.md) เป็น settings extension ที่มี source จริง ใช้ field string/boolean/color/number ของ DevOs สร้าง tar.gz + extension.json + SHA256SUMS ด้วย DevLang ได้ ไม่สร้าง launcher/bin และไม่ยกระดับเป็น native IPK

index มี `apps` และ `extensions` แยกกัน พร้อม `kind` ของแต่ละ entry ตัวอย่างยังเป็น draft/local-example ไม่มี GitHub release จึงไม่แสดงเป็น published/connectable ปัจจุบัน DevOs importer อ่าน listing/manifest/README/icon ของ extensions แล้ว และแท็บ Extensions แสดงรายการจาก repo นี้แทนช่อง Connect หลังเปลี่ยนข้อมูลให้ import ใหม่แล้ว rebuild/reopen AppStore ดู [extension contract](docs/extensions-contract.md)
