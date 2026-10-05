# Base และ UI extensions

Base อยู่ใน `packages/shell/index.ts` ดูแล GTK application, Wayland display, monitors,
คำสั่งระบบ, configuration และ event services โดยไม่สร้าง panel หรือหน้าต่าง UI เอง
UI ทั้งหมดของ shell อยู่ใน system extension packages ซึ่งเป็นชุดพื้นฐานที่เปิดพร้อม session

| Package | หน้าที่ |
| --- | --- |
| `org.devos.theme` | CSS และเปลี่ยนธีมเมื่อ reload |
| `org.devos.icons` | GTK icon theme และใช้ธีมเดิมของ session เป็น fallback |
| `org.devos.background` | React wallpaper และ layer surface ต่อจอ |
| `org.devos.panel` | React panel, clock และ layer surface ต่อจอ |
| `org.devos.launcher` | React launcher และ logout confirmation |
| `org.devos.settings` | React Settings และ generated extension forms |
| `org.devos.files` | React file browser, async GIO และ filesystem operations |
| `org.devos.updates` | อัปเดต desktop ผ่าน GitHub Releases |
| `org.devos.store` | GitHub repository connections และ user extension releases |

แต่ละ package มี `extension.json` เป็น manifest, `extension.ts` เป็น lifecycle source และ `index.ts` เป็น native window adapter
และ `view.tsx` เป็น React UI (theme ใช้ `style.css`)
ไฟล์ UI compatibility อยู่ใน `packages/compat/` และใช้ผ่าน `@dev-os/compat/*`

`packages/extensions/system.ts` อ่าน manifest และโหลด compiled entry ตามค่า `order`
`packages/core/extension-runtime.ts` ให้ `UIExtension.activate(context)` และ cleanup
Base ไม่อ้าง instance ของ Panel, Launcher, Background หรือ Settings
การสื่อสารระหว่าง UI ใช้ `context.invoke('settings')`, `context.invoke('launcher')`
และ command ที่ extension ลงทะเบียนผ่าน `registerCommand()`

## Lifecycle ของ UI

1. Base เริ่ม application และตรวจ Wayland layer-shell
2. Runtime activate system extensions ตามลำดับ theme, icons, launcher, settings, files, background, panel
3. Extension สร้าง window/React root และสมัคร command/events ที่ใช้
4. `onMonitors()` แจ้ง monitor changes; helper `monitorUI()` เพิ่ม/ลบ surface เฉพาะจอที่เปลี่ยน
5. `onReload()` แจ้ง config ใหม่; panel/background/launcher สร้าง UI ใหม่ ส่วน Settings คงหน้าต่างเดิม
6. ปิด session เรียก cleanup ย้อนลำดับ พร้อมถอน command/subscription อัตโนมัติ

หาก activate ล้มเหลว runtime rollback extension ที่เปิดไปแล้วและ registrations ที่สร้างบางส่วน
ID และ command ที่ซ้ำจะถูกปฏิเสธ
Extension ต้องคืน cleanup เพื่อ unmount React, destroy window และล้าง timer ของตัวเอง
UI callbacks ใช้บริการจาก `UIContext`: `config()`, `saveCore()`, `preferences`,
`runCommand()`, `reload()`, `quit()`, `onMessage()`, `onMonitors()`, `onReload()`

ตัวอย่าง entry สำหรับ UI extension ที่มี React window adapter:

```ts
import type {UIExtension} from '../../packages/extensions/runtime.js';
import {MyWindow} from './index.js';

export default {
    id: 'org.example.widget',
    activate(context) {
        const window = new MyWindow(context);
        context.registerCommand('widget', () => window.show());
        return () => window.destroy();
    }
} satisfies UIExtension;
```

เพิ่ม `extension.json` ข้าง `extension.ts` แล้ว `npm run build`
Build ค้นหา UI manifests และสร้าง entry bundle ตามชื่อ `entry` ใน `dist/` ให้อัตโนมัติ
ไม่ต้องเพิ่ม import หรือแก้ registry ใน base เมื่อเพิ่ม system UI package
ตอน startup ตัวโหลดอ่าน JSON จาก bundled packages และ import compiled entry
User UI packages ที่เปิดใช้งานจะโหลดจาก `<package>/dist/<entry>` ตอนเริ่ม session.
ใช้ [Extension Store](extension-store.md) เพื่อเชื่อม repo และติดตั้ง compiled packages จาก GitHub Releases.
การวาง source code อย่างเดียวใน user data directory จะยังไม่ compile โค้ดให้อัตโนมัติ
System UI เป็น base package set จึงไม่มี toggle ปิดจาก Settings ในรุ่นนี้

## JSON ของ UI extension

ตัวอย่างจาก `extensions/org.devos.panel/extension.json`:

```json
{
  "id": "org.devos.panel",
  "name": "Panel",
  "description": "Base desktop panel on every monitor.",
  "version": "1.0.0",
  "apiVersion": 1,
  "kind": "ui",
  "system": true,
  "entry": "org.devos.panel.js",
  "order": 40,
  "settingsVersion": 1,
  "enabledByDefault": true,
  "settings": [{
    "id": "layout",
    "title": "Panel layout",
    "fields": [{"key": "spacing", "title": "Item spacing", "type": "number", "default": 12, "min": 0, "max": 32, "integer": true}]
  }]
}
```

`kind: ui` ระบุ package ที่มี lifecycle code; `system: true` ระบุ base package
`entry` เป็นชื่อ JavaScript bundle ใน `dist/` ต้องเป็นชื่อไฟล์เดียวและไม่มี path separators
Source สำหรับ build อยู่ใน `<id>/extension.ts` และชื่อโฟลเดอร์ต้องตรงกับ ID
`order` เป็นเลขจำนวนเต็มตั้งแต่ศูนย์ ตัวน้อย activate ก่อน; หากเท่ากันเรียงตาม ID
`settings` ใช้ schema กลางและอนุญาตให้เป็น `[]` สำหรับ UI ที่ไม่มี options ของตัวเอง

Settings แสดง system packages ด้วยป้าย Base; panel มีฟอร์ม Item spacing จาก JSON
ค่า default มาจาก manifest และค่า override เก็บใน `~/.config/dev-os/extensions/org.devos.panel.json`
กด Apply เพื่อบันทึกและ reload panel ทันที
ส่วน system packages ที่ไม่มี options ใช้ค่าจาก Desktop preferences
User packages ไม่สามารถประกาศตัวเป็น system หรือแทน base package เดิมได้
หาก preferences ของ base package เสีย จะคง UI ไว้ด้วย defaults และไม่เขียนทับไฟล์เดิม

แก้ default ของ setting แล้ว reload เพื่ออ่าน manifest ใหม่ (ค่าที่เคยบันทึก override ยังมีผล)
การแก้ entry/order หรือเพิ่ม code package ต้อง build แล้ว restart session

## Settings contributions

โครงสร้างนี้ใช้ TypeScript + React + GTK โดยให้ extension ประกาศฟอร์มผ่าน JSON
Settings app ใช้ renderer กลางสร้าง native GTK widgets จาก schema เดียวกัน
Settings API v1 รองรับ extension แบบ declarative สำหรับการตั้งค่า แยกจาก compiled UI lifecycle ข้างต้น

## โครงสร้าง

```text
extensions/
  org.devos.panel/               extension.json, extension.ts, index.ts, view.tsx
  org.devos.launcher/            extension.json, extension.ts, index.ts, view.tsx
  org.devos.background/          extension.json, extension.ts, index.ts, view.tsx
  org.devos.settings/            extension.json, extension.ts, index.ts, view.tsx
  org.devos.theme/               extension.json, extension.ts, style.css
  org.devos.icons/               extension.json, extension.ts, README.md
  org.devos.files/               extension.json, extension.ts, index.ts, model.ts, view.tsx
  org.devos.clock/extension.json  ตัวอย่าง bundled extension
packages/extensions/
  types.ts                       contract ของ manifest, state และ SettingsHost
  schema.ts                      ตรวจ manifest, defaults, values และ version
  manager.ts                     discovery, registry, persistence และ subscriptions
  clock.ts                       เชื่อมค่าของ Clock เข้ากับ panel
  runtime.ts                     UIContext และ activation/cleanup contract
  system.ts                      manifest discovery และ compiled UI loader
  monitor-ui.ts                  per-monitor surface lifecycle
packages/compat/preferences.ts               atomic JSON writer
packages/shell/index.ts                     base services และ runtime host
packages/config/index.ts                    core desktop config และ validation
```

การไหลของข้อมูล: `extension.json → validate → ExtensionManager → React form → Apply → validate → atomic save → notify → reload shell`

การแยกหน้าที่นี้ทำให้เพิ่มหมวดตั้งค่าได้โดยไม่ต้องแก้ Settings app
ส่วนที่นำค่าตั้งค่าไปเปลี่ยนพฤติกรรม desktop ใช้ `SettingsHost` ผ่าน consumer ที่เขียนด้วย TypeScript
ตัวอย่างคือ `clockFormat()` ที่ panel เรียกเพื่ออ่านค่า Clock

## ตำแหน่งไฟล์

| ประเภท | ตำแหน่งเริ่มต้น |
| --- | --- |
| Bundled package | `<project>/extensions/<id>/extension.json` หรือ `<prefix>/share/dev-os/extensions/<id>/extension.json` |
| User package | `~/.local/share/dev-os/extensions/<id>/extension.json` |
| Extension preferences | `~/.config/dev-os/extensions/<id>.json` |
| Core desktop preferences | `~/.config/dev-os/config.json` |

ตำแหน่ง user เคารพ `XDG_DATA_HOME` และ `XDG_CONFIG_HOME`
User package ที่ valid และมี ID เดียวกันจะแทน bundled package
Package ที่ manifest ไม่ถูกต้องจะถูกข้าม และแสดง diagnostic ใน Settings
ไฟล์ตั้งค่าเก็บแยกตาม ID; เปิด/ปิด extension ไม่ลบค่าที่บันทึกไว้

## เพิ่ม extension

สร้าง `~/.local/share/dev-os/extensions/org.example.appearance/extension.json`:

```json
{
  "id": "org.example.appearance",
  "name": "Appearance options",
  "description": "Preferences for an appearance feature.",
  "version": "1.0.0",
  "apiVersion": 1,
  "settingsVersion": 1,
  "enabledByDefault": false,
  "settings": [{
    "id": "general",
    "title": "General",
    "fields": [
      {"key": "compact", "title": "Compact mode", "type": "boolean", "default": false},
      {"key": "label", "title": "Label", "type": "string", "default": "Desktop"},
      {"key": "spacing", "title": "Spacing", "type": "number", "default": 8, "min": 0, "max": 32, "integer": true},
      {"key": "tint", "title": "Tint", "type": "color", "default": "#88e0c0"}
    ]
  }]
}
```

รัน `bin/dev-os-shell reload` แล้วเปิด `bin/dev-os-shell settings`
หมวดใหม่และฟอร์มจะปรากฏโดยไม่ต้อง rebuild เพราะอ่าน manifest ขณะ runtime
ตัวอย่าง Appearance นี้สร้างและบันทึก preferences เท่านั้น; หากต้องการให้เปลี่ยน desktop ให้เพิ่ม consumer ใน shell แล้ว build

ID ต้องเป็น namespace ตัวพิมพ์เล็ก เช่น `org.example.appearance` และไม่มี path separator
Field key ต้องเริ่มด้วยตัวอักษรเล็กและประกอบด้วยตัวอักษร ตัวเลข หรือ underscore
Section ID ต้องไม่ซ้ำ และ field key ต้องไม่ซ้ำทั้ง extension
`string`, `boolean`, `number`, `color` เป็นชนิดที่รองรับ; color ใช้ `#RRGGBB`
Numeric field รองรับ `min`, `max`, `integer`; ทุก field ต้องมี default ที่ valid
Unknown properties และ unknown setting keys จะถูกปฏิเสธ

## การใช้ค่าจาก TypeScript

```ts
import type {SettingsHost} from './extensions/types.js';

function compactMode(host: SettingsHost): boolean {
    try {
        const {state} = host.get('org.example.appearance');
        return state.enabled && state.values.compact === true;
    } catch {
        return false; // package อาจยังไม่ได้ติดตั้ง
    }
}
```

`list()` / `get()` คืน snapshot จึงแก้ registry โดยตรงไม่ได้
ใช้ `update(id, enabled, values)` เพื่อ validate และบันทึกค่า
`subscribe(listener)` คืน cleanup function สำหรับ React effect หรือ consumer อื่น
`reload()` อ่าน registry และ preferences ใหม่; shell เรียกเมื่อ reload config
`dispose()` ล้าง subscriptions เมื่อ session ปิด

## Apply และ version

ฟอร์มเก็บ draft จนกด Apply; เปลี่ยนหมวดหรือเปิดหน้าต่างใหม่จะทิ้ง draft ที่ยังไม่บันทึก
ข้อมูลที่ไม่ valid จะขึ้นข้อความและไม่เขียนไฟล์
บันทึกผ่าน `Gio.File.replace_contents` พร้อม private permissions แล้ว notify subscribers
Settings app reload shell หลังบันทึกเพื่อให้ panel และ wallpaper ใช้ค่าปัจจุบัน
Core autostart ใช้ค่าที่เปลี่ยนใน session ถัดไป

Preferences ของ Clock ที่บันทึกแล้วมีรูปแบบ:

```json
{
  "version": 1,
  "enabled": true,
  "values": {"format": "%H:%M", "showSeconds": true}
}
```

`version` ใน manifest คือเวอร์ชัน package; `apiVersion` คือเวอร์ชัน contract
`settingsVersion` คือเวอร์ชันข้อมูล preferences
เพิ่ม field ที่มี default ได้โดยคง settingsVersion เดิม; validator จะเติม default ที่ขาด
หากเปลี่ยนชนิด ลบ หรือเปลี่ยนชื่อ field ให้เพิ่ม settingsVersion
v1 ยังไม่มี migration callback: เมื่อเวอร์ชันไม่ตรงหรือไฟล์เสีย จะปิด extension
แสดง error และห้าม Apply ทับไฟล์เดิม เพื่อเก็บข้อมูลไว้ให้แก้ไขหรือ migrate ด้วยตนเอง
หลังสำรองและแก้ไขไฟล์แล้วให้ reload; หากต้องการเริ่มจาก defaults ให้ย้ายไฟล์ preferences ออกแล้ว reload

Clock extension ปิดไว้เริ่มต้น ใช้ core `clock_format` จนเปิดใน Settings
เมื่อเปิดจะใช้ `format` ของ extension และเพิ่มวินาทีเมื่อเลือก Show seconds
Clock consumer ใช้ core fallback เมื่อ extension ไม่พบหรือถูกปิด

## การตรวจสอบ

`dev.ps1 check` ตรวจ config และ extension contract/persistence/lifecycle/JSON loader รวม 25 รายการ
`dev.ps1 smoke` ตรวจ renderer 8 รายการ และ desktop UI 10 รายการบน Wayland จริง
รวมการสร้างฟอร์มจาก manifest, invalid draft, Apply และการเปิดใหม่โดยทิ้ง draft
รวม icon theme switching, missing theme fallback และคืนค่า GTK settings เมื่อ cleanup
รวม async filesystem/history/cancellation และ UI create/rename/search/list/grid ของ Files
Smoke ยังตรวจการเปิดหน้าต่าง Settings ผ่าน CLI และ reload บน shell ที่ทำงานอยู่
