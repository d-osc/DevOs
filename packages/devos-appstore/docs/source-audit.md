# Source audit: DevOs / DevOsPM

อ่านเมื่อ 2026-10-27 จาก sibling working trees ไม่ได้แก้ไขสอง repo นี้

- DevOs HEAD: `e36e469f26fcdf8e03fa6980f770e200bd5a1b64` มี local changes จึงถือ working tree ที่อ่านเป็นหลัก ไม่อ้างว่าข้อค้นพบทั้งหมดอยู่ใน commit นี้
- DevOsPM HEAD: `1ba50a834c9fb4237f41959c24ddb38deb98658a` มี untracked `.zcode/`

## สิ่งที่ implementation ทำอยู่จริง

| เรื่อง | Source | ข้อค้นพบ |
| --- | --- | --- |
| Native Store | `../DevOs/docs/app-store.md`, `extensions/org.devos.appstore/backend.ts`, `native/devos_app_store.dev` | catalog `{schemaVersion,source,apps}`; signed HTTPS opkg feed; IPK; system scope; polkit; allowlist ID → package; ไม่รับ arbitrary URL เป็น native install |
| Packages / registry apps | `../DevOs/extensions/org.devos.appstore/package-backend.ts`, `registry-backend.ts`, `tools/store/import-registry.mjs` | รุ่นปัจจุบัน import apps ของ repo นี้เป็น bundled preview; ดาวน์โหลด/inspect/review ก่อนส่ง local path เข้า PM; inventory จาก list --json; ตรวจ executable เป็น PM ไม่ใช่ DevLang alias |
| Native target | `../DevOs/distro/oe/meta-devos/conf/distro/devos.conf`, `distro/README.md` | desktop เป็น OpenEmbedded, glibc, systemd, Wayland/labwc, package_ipk; console bootstrap เป็น musl/BusyBox คนละ runtime profile |
| CLI install | `../DevOsPM/src/main.rs`, `src/download.rs` | install รับ path/URL; ยังไม่มี registry search, alias resolver หรือ dev install name; URL ต้องมี suffix dpk/dpkx/tar.gz/deb/rpm ก่อนตาม redirect |
| Package identity | `../DevOsPM/src/manager.rs::Manifest` | name คือรหัสติดตั้ง, shortname/fullname คือชื่อแสดงผล, kind app/extension, version ไม่บังคับ SemVer; deny_unknown_fields |
| Payload formats | `../DevOsPM/src/native.rs`, `src/manager.rs` | dpk/dpkx เป็น tar+gzip; deb/rpm แตกลง PM store; ไม่แก้ dependencies, ไม่รัน maintainer scripts, ข้าม links ใน native packages |
| Launcher | `../DevOsPM/src/desktop.rs` | ทุก command ใน bin ของ kind app สร้าง dev-COMMAND.desktop; Name fullname → shortname → command; Icon package-root/icon หรือ theme fallback; Exec PM --root STORE run COMMAND; Terminal=false |
| Desktop discovery | `../DevOs/packages/services/apps.ts` | Gio.AppInfo.get_all + AppInfoMonitor; launcher ไม่อ่าน registry JSON นี้เพื่อสร้างไอคอนเอง |
| Launcher failure | `../DevOsPM/src/manager.rs` หลัง save registry | launcher/shim failure เป็น warning หลังติดตั้งสำเร็จ ไม่ rollback package อัตโนมัติตามที่แบบเดิมเคยเสนอ |
| Run | `../DevOsPM/src/manager.rs::run` | ตรวจ executable hash, ส่ง args ตรง process, ตั้ง DEV_PACKAGE_ROOT; ไม่ตั้ง working directory/LD_LIBRARY_PATH ให้เอง |
| Installed state | `../DevOsPM/src/manager.rs::Registry`, `src/main.rs` | registry schema 2 มี packages.active/previous และ extensions; ใช้ list --json; ไม่ใช่ remote catalog schema_version 2 ของ repo นี้ |
| Update | `../DevOsPM/src/update.rs`, `src/metadata.rs` | ใช้ repository/GitHub release และ package manifest; ไม่ได้ใช้ channels ของ repo นี้; repository.release.type รองรับ dpk/tar.gz เท่านั้น |
| Icon assets | `../DevOsPM/src/manager.rs` native desktop import | อ่าน PNG/SVG/XPM ที่อยู่ใน payload จริง; ไม่ควรบังคับ PNG อย่างเดียวหรือใส่ URL logo ลง package.icon |
| Store detail | `../DevOsPM/src/manager.rs::StorePage` | homepage เป็น URL; storepage เป็น package-local HTML/Markdown + files หรือ legacy reference; ไม่ใช่ registry README path |
| Context menu | `../DevOsPM/src/manager.rs::ContextMenuItem` | command ต้องอยู่ใน bin; targets file/directory/background; args แยก; PM เก็บ metadata แต่ host เป็นผู้ใช้ |
| Extension | `../DevOsPM/src/devos.rs`, `../DevOs/extensions/org.devos.appstore/extensions-view.tsx`, `packages/extensions/store.ts` | UI ย้ายเข้า AppStore → Extensions แล้ว บริการ ExtensionStore และ storage/release lifecycle เดิมยังอยู่; ยังไม่อ่าน extensions listings ของ registry นี้ |

## Identity ที่ต้องแยก

1. Registry ID เช่น `vscode`: ค้นหาและอ้างอิงข้อมูลกลาง
2. PM package.name: รหัสจริงจาก package.json หรือ deb/rpm metadata หลัง normalize; อาจเป็น `code` แทน vscode ห้ามเดาแล้วใช้ remove
3. bin command: key ใน package.bin ที่ dev run เรียกได้
4. XDG desktop ID: `dev-<command>.desktop` สำหรับ PM; native ใช้ desktopId ที่ IPK จัดส่ง
5. opkg package: ชื่อแพ็กเกจ native feed ไม่ใช่ PM package หรือ registry ID โดยอัตโนมัติ

## การแก้แบบเดิม

- ยกเลิก ZIP-only install recipe, strip_components และ standalone launcher ที่ไม่มีใน PM
- เปลี่ยน installable artifact เป็น format ที่ PM รองรับ พร้อม expected package manifest และหลักฐานทดสอบ target
- แยก upstream download / prepared user package / native signed feed ไม่เลื่อนสถานะเพียงเพราะ HTTP 200
- ไม่คัดลอก app.json ทั้งก้อนไป package.json เพราะ PM ปฏิเสธ unknown fields
- ไม่เรียก `dev update` โดยอ้างว่าจะตาม registry stable channel; ต้องมี integration ใหม่
- catalog กลางเป็นแหล่ง authoring; DevOs มี adapter สำหรับ app แล้ว แต่ยังต้องเพิ่ม extension recommendation adapter และ CLI name resolver

การอ่าน source เป็นการตรวจสัญญา ไม่ได้พิสูจน์ว่าทั้ง 6 binary รันบน booted DevOs ได้ และไม่ได้ทดสอบ native feed หรือแก้ code ของสองระบบ

## หลังรวม Extensions เข้า AppStore

อ่าน working tree อีกครั้งในวันเดียวกัน: `org.devos.store` ถูกยุบใน UI; `app-store-extensions` เปิด AppStore window เดียว; extension-store/settings.store เป็น compatibility aliases; ไม่มีการย้าย preferences หรือ install data

บริการยังอ่าน stable release ล่าสุดจาก public GitHub repo ที่ Connect และต้องมี extension.json + dev-os-extension.tar.gz + GitHub asset digest จึงออกแบบ registry listing สำหรับ discovery แยกจาก runtime extension.json โดยไม่สั่งให้ผู้ใช้ติดตั้งผ่าน native opkg หรือ app RegistryManager

ตัวอย่าง settings extension ที่เพิ่มใน repo นี้ตรวจผ่าน current DevOs validateManifest/validateValues และ archive protocol จริงแล้ว ยังไม่ได้ activate ใน session DevOs ดูรายละเอียดใน [extension contract](extensions-contract.md)

อัปเดตหลังงาน integration: แก้ DevOs importer ให้ bundle extensions listings/manifest/README/icons แล้ว และ ExtensionsView ใช้ catalog นี้แทน manual repository input พร้อมรักษารายการเดิมและตรวจ ID ก่อน Install ชุดทดสอบ GTK ของหน้าต่างจริงผ่านแล้ว ข้อความเรื่อง extension adapter ที่ยังไม่มีด้านบนเป็นบันทึกจากรอบอ่าน source ก่อนงานนี้
