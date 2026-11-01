# DevOs App Registry — data contract v2

Repo นี้เป็นแหล่ง authoring กลางของข้อมูลแอปสำหรับ DevOs Linux ARM64 ไม่ใช่ฐานข้อมูล installed state และไม่ใช่ opkg feed หรือ runtime registry ของ PM โดยตัวมันเอง

v2 แทนแบบร่าง v1 ที่เคยออกแบบจากสมมติฐาน ZIP/standalone launcher แบบเดิมยังไม่มี release หรือ consumer ที่เชื่อมจริง ห้าม client เดาว่า schema_version 2 ของ repo นี้เป็น schema 2 ของ PM local registry เพราะเป็นคนละสัญญา

## 1. ขอบเขตของระบบจริง

| ระบบ | หน้าที่ปัจจุบัน | รูปแบบ/สิทธิ์ |
| --- | --- | --- |
| Registry นี้ | metadata, README, รูป, upstream download sources, prepared user releases | Git + JSON; ใช้ DevLang ตรวจและสร้าง index |
| DevOsPM | แตกไฟล์, ตรวจ hash, snapshots, rollback/remove, bin, shim, .desktop | dpk/dpkx/tar.gz/deb/rpm; user scope |
| AppStore / Packages | inspect local file แล้วเรียก devospm; อ่าน list --json | user scope; ไม่ใช้ opkg/polkit |
| AppStore / Native catalog | allowlist app ID → opkg package | signed IPK feed, same OE ABI, system scope, polkit |
| DevOs Launcher | แสดงและเปิด Gio.AppInfo จาก XDG desktop files | ไม่อ่าน app.json นี้เพื่อสร้าง launcher เอง |

หลักฐานและ source paths อยู่ใน [source audit](source-audit.md) ปัจจุบัน DevOs มี bundled app importer และ flow review/install ผ่าน PM แล้ว ส่วน CLI name resolver และ extension listing adapter กลางยังไม่มี ดู [extension contract](extensions-contract.md) สำหรับหน้าร้านที่รวมแล้ว

## 2. หนึ่งแอป มีหลาย identity

- `id`: registry ID คงที่ เช่น vscode สำหรับค้นหาและ deep link
- `name`: ชื่อแสดงใน Store เช่น Visual Studio Code ไม่ใช่ชื่อแพ็กเกจ PM
- `aliases`: exact search tokens ของ resolver ที่จะเพิ่ม เช่น code
- `artifact.package.name`: ชื่อที่ PM บันทึกจริง ใช้กับ info/remove/rollback อาจต่างจาก registry ID
- `artifact.package.bin`: key คือคำสั่ง dev run, value คือ path ในแพ็กเกจ
- `.desktop` ของ PM: dev-COMMAND.desktop สร้างตาม bin แต่ละ command
- native catalog `id`, `package`, `desktopId`: identity ของ native Store/opkg แยกต่างหาก ไม่อนุมานจากชื่อ PM

ห้ามจับคู่ installed state ด้วยชื่อแสดงผล และห้ามเดา package.name ของไฟล์ deb ก่อนอ่าน metadata จริง

## 3. ข้อมูลแสดงผลและ assets

app.json เก็บ id, name, aliases, summary, publisher, license, categories, tags, links, readme, screenshots, icon หรือ icon_fallback

`readme`, `icon`, `screenshots[].src` เป็น path ภายใน apps/ID/ ของ registry ส่วน `artifact.package.icon` และ `storepage` เป็น path ภายใน payload ที่ติดตั้ง เป็นคนละ root ถึงจะใช้ไฟล์ต้นฉบับเดียวกันก็ตาม icon ไม่บังคับ PNG: PM รองรับไฟล์ภายในแพ็กเกจ และการ detect จาก native payload รู้จัก PNG/SVG/XPM

icon_fallback เป็น tile ตัวอักษรระหว่างรอโลโก้จริง ไม่ใช่ข้อมูลที่ PM รับไปสร้างไอคอนโดยตรง sanitize README ก่อน render การมีไฟล์ assets ใน Git ไม่ทำให้ไฟล์นั้นถูกติดตั้งลงเครื่อง ต้องรวมลง payload ตอนสร้างแพ็กเกจ

## 4. Upstream download ไม่เท่ากับ prepared release

`downloads[]` เป็นแหล่งไฟล์ต้นทาง มี platform, arch, format, file_url, version_policy, source_url, checked_on, verification, note

- `headers-checked`: ตรวจ HTTP HEAD สำเร็จ ไม่ได้ตรวจ bytes, checksum หรือการรัน
- `source-only`: พบ URL ในหน้า/index ทางการ แต่ยังตรวจ response ไม่สำเร็จ
- `rolling`: URL เดิมเปลี่ยนเนื้อหาได้ จึงไม่ใช้แทน release ที่ตรึงเวอร์ชัน
- `versioned`: URL ระบุ version แต่ยังต้องตรวจเนื้อหาและ hash จริง

ทั้ง 6 แอปยังเป็น `status: catalog` และ `compatibility.status: untested` มี upstream Linux ARM64 deb โดย Firefox ยังเป็น source-only ไม่มีไบนารีใดผ่านการทดสอบบน DevOs จากงานนี้

`distribution.url` เป็นหน้าดาวน์โหลดสำหรับคน `downloads[].file_url` เป็นไฟล์สำหรับเตรียมแพ็กเกจ ห้ามเปิด native install หรือเลื่อนเป็น installable เพียงเพราะมี URL

## 5. Runtime compatibility

เป้าหมายปัจจุบันคือ `devos-desktop-arm64`: Linux ARM64, glibc, Wayland/labwc จาก OE desktop image ไม่รวม musl console/bootstrap image

ทุก app ระบุ compatibility.profile/status/libc/display/note การทำ prepared release ต้องบันทึก image_id ที่ทดสอบและ test_report เป็นไฟล์ในโฟลเดอร์แอป แต่ profile name เป็นชื่อที่ registry กำหนด ไม่ใช่ API profile ที่ DevOs มีแล้ว

ต้องทดสอบอย่างน้อย: ELF/loader และ shared libraries, executable/wrapper ที่ relocate แล้ว, Wayland และข้อกำหนด Chromium/Electron sandbox, เปิดจาก .desktop, verify, replace, remove และ rollback บน image จริง การอ่าน deb ได้ไม่ใช่การรับรองว่าแอปรันได้

PM ไม่ติดตั้ง dependencies, ไม่รัน maintainer scripts และข้าม links ของ native packages การตั้ง DEV_PACKAGE_ROOT ตอน run ไม่แก้ path absolute หรือ dynamic loader ให้เอง หากต้องเตรียม wrapper ให้เป็นไฟล์จริงใน payload และ map ผ่าน bin ห้ามใส่ install shell scripts ลง registry ให้ client รัน

## 6. Prepared user releases

เมื่อทดสอบแล้วจึงใช้ status installable พร้อม icon, channels.stable, releases และ compatibility.status verified

แต่ละ artifact มี:

| Field | สัญญา |
| --- | --- |
| platform / arch | linux / arm64 |
| backend / scope | devospm / user |
| format | dpk, dpkx, tar.gz, deb หรือ rpm ที่ PM รับจริง |
| url / filename | HTTPS pinned artifact; ชื่อไฟล์ลงท้าย format; URL path ต้องผ่าน suffix gate ปัจจุบันของ PM |
| sha256 / size_bytes | ค่าของไฟล์ที่ตรวจจริง ไม่ใช่ค่า placeholder |
| package | expected package.json/installed manifest ที่ PM ยอมรับ |
| compatibility | verified + image_id + local test_report |

`releases[].version` คือ version ที่ PM ติดตั้งแล้วรายงานจริง ต้องตรง artifact.package.version ไม่บังคับ SemVer เพราะ PM ยอมรับตัวอักษร ตัวเลข . _ + - และมี normalization สำหรับ deb/rpm อย่าตัดสินว่า string ที่ต่างคือเวอร์ชันใหม่กว่าโดยไม่มี comparator/policy

`artifact.package` เป็น expected metadata สำหรับตรวจผล ไม่ใช่การสั่งให้ PM override manifest จาก registry PM อ่านชื่อ/รุ่นที่คาดไว้และ SHA-256 เพื่อตรวจ prepared release ถ้าเป็น dpk ให้ฝัง package.json ที่ตรงกันใน payload จริง ถ้าเป็น deb/rpm ต้อง inspect ว่า installed metadata ตรง รวมถึงชื่อที่ normalize แล้ว ห้ามคัดลอก app.json ทั้งก้อนไปเป็น package.json เพราะ PM deny_unknown_fields

แบบ canonical ของ package ใช้ kind, name, shortname, fullname, version, description, homepage, storepage, icon, repository, bin, contextmenu ตาม implementation app.schema.json ใช้กับ app โดยเฉพาะ ส่วน extension ใช้ extension.schema.json และ extension-manifest.schema.json แยก lifecycle ตาม extension.json

ตัวอย่างที่ examples/example-app เป็น schema fixture เท่านั้น hash, URL และผลทดสอบเป็นสมมติ ไม่รวมใน apps หรือ production index

## 7. Launcher และไอคอนจริง

ไม่ใช้ standalone launcher field ของแบบเดิม PM สร้าง .desktop ให้ทุก command ใน package.bin สำหรับ kind app อยู่แล้ว:

```text
Name = fullname ถ้ามี → shortname ถ้ามี → command
Icon = installed-package-root/package.icon หรือ application-x-executable
Exec = PM_BINARY --root STORE run COMMAND
Terminal = false
Desktop ID = dev-COMMAND.desktop
X-DevOS-Package = package.name
```

DevOs ใช้ Gio.AppInfoMonitor ตรวจพบการเปลี่ยนแปลงและอ่านไอคอนผ่าน GIO PM จัดการ refresh/remove เมื่อ replace/rollback/remove

ไม่มี field สำหรับ launcher args, working directory, terminal true หรือ desktop placement ใน PM manifest ปัจจุบัน ห้าม advertise ว่ารองรับ หากแอปต้องการ behavior เพิ่มต้องทำ wrapper ที่ตรวจแล้วหรือเปลี่ยน consumer ก่อน การสร้าง launcher/shim ล้มเหลวใน PM เป็น warning หลัง commit install ไม่ rollback package อัตโนมัติ

## 8. ฐานข้อมูลร่วมสำหรับ CLI และ App Store

Reader กลางอยู่ที่ `database.dev`/`database-cli.dev` อ่าน app.json จากแพ็กเกจนี้
PM ใช้ `dev catalog --json` และ `dev search` เพื่อเปิดเผยข้อมูลชุดเดียวกับ GUI
resolver ของ `dev install NAME` exact-match id/aliases; ไม่เลือกชื่อจาก fuzzy match
แพ็กเกจ local ที่มีอยู่ยังคงเป็น local input ไม่ถูกแทนด้วย catalog lookup

Prepared stable release ต้องตรง Linux/architecture/backend devospm/user scope
และมี SHA-256 ชื่อ/รุ่น package ที่คาดไว้ PM ตรวจ digest และ identity ของไฟล์จริง
ก่อน commit ส่วน catalog-only entry อนุญาตการติดตั้ง upstream ผ่านคำสั่ง install
ที่ผู้ใช้ระบุอย่างชัดเจนพร้อมข้อความว่า compatibility ยังไม่ผ่านการรับรอง
ไม่มีการเปลี่ยน status ให้เป็น verified และไม่มีการติดตั้งเมื่ออ่านรายการ

Catalog download ใช้ HTTPS และ redirect ที่เป็น HTTPS เท่านั้น จำกัด 2 GiB
บันทึก endpoint ลงไฟล์ suffix ตาม format ก่อนเรียก installer จึงรองรับ URL
ของ VS Code ที่ไม่มี suffix ได้ ส่วน `dev install URL` ตรงยังคง suffix gate เดิม

PM บันทึก snapshot metadata ใน `packages[actual-package-name].catalog` พร้อม
การติดตั้งภายใต้ lock และ atomic registry commit เดียวกัน GUI ไม่เขียน registry
หรือ binding file แยกอีกต่อไป replace/rollback คง association และ remove ลบพร้อมกัน
PM list/canonical catalog query เป็นแหล่ง installed state เดียวสำหรับทั้งสอง client

Legacy bindings ของ GUI ย้ายผ่านคำสั่ง PM ที่ตรวจ package/id จริง ไม่ทับ binding
ปัจจุบัน และเก็บ JSON เดิมเป็น `.migrated` เพื่อไม่ resurrect หลัง uninstall
`--root`/`DEV_ROOT` ยังคงแยก installed store ส่วน catalog override คือ `--catalog`
หรือ `DEVOS_APPSTORE_DATABASE` Source release/image ต้อง bundle catalog-data ด้วย
`pm-cli/stage.sh`; self-update ไม่รับ CLI payload ที่ขาดฐานข้อมูลร่วมนี้

## 9. Native AppStore เป็นอีก delivery adapter

Current native catalog ใช้รูปแบบนี้ ไม่ใช่ index ของ repo นี้:

```json
{
  "schemaVersion": 1,
  "source": { "name": "DevOs", "url": "" },
  "apps": []
}
```

เมื่อมี native IPK ที่สร้างจาก OE sources/target ABI เดียวกับ image แล้ว ค่อย map metadata กลางไป current fields id, name, package, category, description, desktopId, website, removable และ icon ตาม contract ของ consumer ต้องมี mapping ที่ยืนยันจริง ไม่เดา desktopId/opkg package จาก registry ID

native publisher ใน DevOs tools/store/publish.dev ตรวจ IPK/architecture และสร้าง signed catalog, Packages/Packages.gz/Packages.asc, signing key export และ opkg conf ต้องจัด feed พร้อม transitive dependencies และ provision trusted root-owned config ผ่านกระบวนการ native ที่มีอยู่ ห้ามส่ง vendor deb ตรงไป native feed หรือเปลี่ยน backend แบบเงียบๆ

repo นี้ยังไม่สร้างหรือเผยแพร่ native feed และยังไม่มี native binding ของหกแอป การรวม source authoring กลางไม่ได้แปลว่าต้องรวม user packages กับ system package database

## 10. Index และ validation

ใช้ d scripts/build_registry.dev สร้าง dist/index.json สำหรับ preview มี schema_version 2, source_commit (null ถ้ายังไม่มี commit), snapshot false, working_tree_dirty และ apps

entry ของ app มี kind app, metadata สั้น, manifest path, compatibility, backend devospm, scope user, status และ installable สำหรับ catalog ไม่มี package_name/stable_version และยังไม่ join installed state เพราะไม่รู้ package identity จริง สำหรับ installable จะมี stable_version/package_name/platforms เพิ่ม extensions array ที่มี kind extension แยกจาก app ตาม extension contract โดยไม่เปลี่ยน semantic ของ apps array

builder ตรวจโครงสร้างและความสัมพันธ์ รวม command identifiers, package version, native format, PM URL suffix และ test_report มีจริง แต่ไม่ตรวจ payload/hash/ความแท้ของหลักฐานทดสอบ ไม่เทียบประวัติ release และยังไม่ใช่ publisher

ก่อน production ต้องเพิ่ม immutable snapshot publication, asset copying, release immutability และ byte/hash verification รวมตรวจ symlink/junction escape เพราะ DevLang fs ไม่มี realpath API ในชุดที่ใช้นี้ index ของ working tree ห้ามนำไปอ้างเป็น signed/verified native feed
