# Extensions ใน unified AppStore

อ้างอิง working tree ของ DevOs เมื่อ 2026-10-27: `docs/extension-store.md`, `extensions/org.devos.appstore/extensions-view.tsx`, `packages/extensions/{schema,store,store-protocol}.ts` และ `tools/store/import-registry.mjs`

## รวมหน้าร้าน แต่คง lifecycle ตามชนิด

AppStore เป็นหน้าร้านเดียว มี Discover, Packages และ Extensions แทน Settings Extension Store เดิม บริการ `ExtensionStore` และ storage paths เดิมยังอยู่ ชื่อ `delivery.backend: devos-extension-store` ใน registry นี้จึงหมายถึงบริการติดตั้ง ไม่ใช่การสร้างหน้าร้านแยกกลับมา

| Registry kind | Payload manifest | การส่งมอบ | Lifecycle |
| --- | --- | --- | --- |
| app | package.json, bin/icon/fullname | DevOsPM user packages หรือ native adapter แยก | install/run/remove/rollback |
| extension | extension.json, kind settings/ui | Public GitHub stable release → ExtensionStore | connect/check/install/update/enable/disable/rollback/disconnect/uninstall |

`package.json.kind: extension` ของ PM command package ไม่เหมือน `extension.json.kind: settings/ui` ของ shell extension อย่าสร้าง launcher จาก bin หรือจัดเก็บ UI extension เป็น app โดยอนุมานจากคำว่า extension อย่างเดียว

## โครงสร้างข้อมูลกลาง

```text
extensions/org.example.workspace-notes/
  listing.json             metadata ของร้าน + delivery source
  README.md                รายละเอียดสำหรับคน
  LICENSE
  package/
    extension.json         runtime manifest ที่ DevOs อ่านจริง
    icons/workspace-notes.svg
```

listing ใช้ schema_version 2, kind extension, namespaced id, status draft/published, name, summary, publisher, license, categories, tags, readme, icon, target, manifest และ delivery

- `manifest`: path ของ runtime manifest snapshot ภายใน listing directory ไม่ใช่ release URL
- `target`: host ที่ registry นี้ตั้งใจรองรับ (linux/arm64/API 1); ไม่เพิ่ม platform/arch ใน extension.json เพราะ runtime ไม่รับ field ดังกล่าว ตัวอย่าง settings-only ไม่มี native binary จึงไม่ต้องตรึง glibc ABI แบบแอป Electron
- `delivery.backend`: devos-extension-store; scope user
- `delivery.source.type: local-example`: มี directory ของ source ใน repo, ต้องเป็น draft, ไม่มี repository URL สมมติ
- `delivery.source.type: github`: repository เป็น owner/repo ที่มีจริงสำหรับ published entry หนึ่ง repo ต่อหนึ่ง extension
- `delivery.assets`: ชื่อคงที่ extension.json, dev-os-extension.tar.gz, SHA256SUMS

version/name/id ของตัวอย่างมาจาก runtime manifest โดย builder ตรวจ name/id ตรง listing version ไม่เก็บซ้ำใน listing ส่วน publisher/readme/license อยู่ใน listing เท่านั้น อย่าคัดลอกไป runtime manifest ที่ deny unknown fields

## Runtime manifest และ archive

runtime ใช้ camelCase เดิม: id, name, description, version, apiVersion, kind, settingsVersion, enabledByDefault, settings และเฉพาะ UI มี system=false, entry, order

- ID เป็น namespaced lowercase ห้าม org.devos.* และ base/system IDs
- stable version 1.0.0; tag v1.0.0 ต้องตรงกัน
- API version 1; settingsVersion เป็น positive integer และไม่ใช่ release version
- settings kind ต้องมี sections/fields ที่ไม่ว่าง, key ไม่ซ้ำข้าม section, default ถูก type/range
- UI entry เป็น flat JavaScript filename ห้าม shared-runtime reserved names; source TSX/TS ต้อง build ด้วย DevOs toolkit และใช้ shared runtime
- package tar มี root `extension/` ต้องมี `extension/extension.json`; UI ต้องมี `extension/dist/ENTRY.js`
- runtime manifest ใน tar ต้องตรงกับ release-side manifest; ห้าม store-install.json, links, traversal, duplicate paths และ special files
- consumer limits: compressed 32 MiB, expanded 128 MiB, 4,000 entries

schema/extension-manifest.schema.json เป็น canonical subset: บังคับ kind ชัดเจนแม้ runtime จะรับ implicit settings เพื่อให้ authoring data ไม่กำกวม ตัว validator DevLang ตรวจ structural และ semantic conditions; test เพิ่มตรวจด้วย DevOs schema/protocol จริง ไม่อ้างว่าครบทุก security check ของ installer

## Registry → AppStore

index เดิมคง apps array สำหรับ app consumer และเพิ่ม extensions array สำหรับ listing adapter พร้อม kind เพื่อแยกเส้นทางติดตั้ง ไม่ส่ง extension ให้ RegistryManager ของ app

extension entry มี listing path, readme/icon ที่ resolve จาก registry root, extension_manifest snapshot, version, delivery และ connectable การมี published+github หมายถึงเสนอ repo ให้ Connect ได้เท่านั้น ไม่ใช่ติดตั้งได้แล้ว `installable` จาก builder ยังคง false เพราะต้องตรวจ live GitHub release ก่อน

adapter ที่ต้องเพิ่มใน DevOs คืออ่าน recommended extensions จาก registry แล้วส่ง repository ให้บริการ ExtensionStore.connect หลังผู้ใช้เลือก ห้ามเขียน repositories.json เอง ห้าม auto-connect เมื่อเปิด Store และห้ามติดตั้งโค้ดเพียงเพราะอยู่ใน listing

DevOs importer ปัจจุบันอ่านทั้ง apps/ และ extensions/*/listing.json แล้ว พร้อม runtime manifest, README และไอคอน ExtensionsView แสดง catalog กลางแทนช่อง Connect และรักษารายการที่เคยเชื่อมไว้ใน Your extensions รายการ published มี Check availability ซึ่งเชื่อมและตรวจ release เมื่อผู้ใช้เลือก ส่วน draft แสดง Not released yet ก่อน Install ต้องตรวจ ID ของ live manifest ตรงกับ listing ด้วย

ข้อมูลถูก bundle ตอน import/build ตาม pattern ของ app เดิม ไม่ได้ fetch Git repo ทุกครั้งที่กด refresh เปลี่ยนข้อมูลแล้วให้รัน node tools/store/import-registry.mjs ../DevOsAppStore และ npm run build ใน DevOs แล้วเปิด AppStore ใหม่

## การเผยแพร่

consumer ปัจจุบันใช้ GitHub releases/latest และ fixed asset names จึงรองรับหนึ่ง repo ต่อหนึ่ง extension Repo กลางนี้มีหลาย listing ได้ แต่ไม่ควรให้ผู้ใช้ Connect DevOsAppStore ทั้ง repo เพราะไม่ใช่หนึ่ง extension release ต้องเผยแพร่ artifact ของแต่ละ extension ใน repo แยก หรือแก้ release discovery ใน consumer ก่อนใช้หลาย extension ใน repo เดียว

เมื่อมี release จริง: ตรวจ tag/version และ archive bytes, แนบ manifest/archive/SHA256SUMS แล้วเปลี่ยน source เป็น github และ status published Store ปฏิเสธ draft/prerelease และ archive asset ที่ไม่มี SHA-256 digest จาก GitHub API ค่าใน SHA256SUMS ช่วยตรวจด้วยมือ แต่ไม่ได้แทน digest ที่ consumer ต้องการ ขนาดและ manifest ยังต้องผ่านตรวจ runtime ทุกครั้ง

ตัวอย่าง Workspace Notes มี local artifact พร้อม hash จริง แต่ยังไม่มี public release, ยังไม่ Connect/ติดตั้งลง user session และไม่ถูกยกระดับเป็น verified DevOs binary

## State ของเครื่องผู้ใช้

คง paths เดิมไว้ภายใต้ XDG:

```text
data/dev-os/extension-store/repositories.json
data/dev-os/extension-store/releases/ID/VERSION-DIGEST/
data/dev-os/extensions/ID                  selected release link
config/dev-os/extensions/ID.json           preferences
```

enabled/values, connected repo, active/previous release และ install history ไม่อยู่ใน Git registry Disconnect ไม่ uninstall; uninstall เก็บ preferences; UI code และ enable/disable มีผล session ถัดไป ส่วน declarative settings แสดงหลัง reload ตาม loader เดิม ไม่เปลี่ยน field เหล่านี้จาก enabledByDefault ของ release ที่อัปเดต

## Validation ของงานนี้

DevLang สร้างและอ่าน archive/checksums กลับได้ ใช้ validator `validateManifest` และ `validateValues` จาก DevOs ปัจจุบันตรวจตัวอย่าง และใช้ `manifestForRelease`/`validateExtensionArchive` ตรวจ artifact ที่สร้างจริง ผ่านโดยใช้ GNU tar ใน WSL สำหรับ file listing ไม่มีการ publish, Connect หรือ activate ใน desktop session จึงยังไม่ได้พิสูจน์ UI rendering/settings persistence บนระบบที่ boot จริง
