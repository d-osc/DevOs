<p align="center"><img src="data/icons/devos/devos-mark.svg" width="96" alt="Dev OS"></p>

# Dev OS — Wayland Desktop Environment Base

เตรียม Live USB ARM64: ดู [Live USB](docs/live-usb.md) และใช้ `.\live-usb.ps1 prepare`.
มี profile Snapdragon X2 / UX3407NA และตัวสร้าง USB image แบบทดลองแล้ว ยังต้องทดสอบบูตบนเครื่องจริง.

ฐาน OS อิสระที่ build จาก Linux kernel upstream และ userspace จาก source อยู่ใน
[distro/](distro/README.md): ใช้ `.\distro.ps1 base` และ `.\distro.ps1 base-test`
เพื่อสร้าง/ทดสอบฐาน ARM64 ใน QEMU โดยไม่ใช้ Ubuntu rootfs ส่วน desktop image
มีชุด build ของ DevOs แยกต่างหาก ฐาน console ที่บูตผ่านยังไม่ใช่ desktop image สำเร็จรูป.

ฐาน Desktop Environment แบบ native บน **Linux / Wayland** ใช้ **labwc (wlroots)**
จัดการหน้าต่างและอุปกรณ์ input ส่วน desktop shell เขียนด้วย **TypeScript / GJS + GTK 3 + gtk-layer-shell**
แยกเป็นโมดูลเพื่อเปลี่ยนหน้าตาและเพิ่มความสามารถต่อได้ง่าย

รองรับ **React + TypeScript / TSX → native GTK widgets** ผ่าน lib ใน `packages/core/`
UI ทุกส่วนของ shell ใช้ React / TSX: panel, launcher, เมนู session และพื้นหลัง
เริ่มแก้ได้ที่ `src/system/org.devos.panel/view.tsx`, `src/apps/org.devos.launcher/view.tsx` และ `src/apps/org.devos.files/view.tsx`

## สิ่งที่มีแล้ว

- พื้นหลังวาดด้วย Cairo ปรับตามความละเอียดจอ
- Panel ด้านล่าง: Menu, Terminal, Files, Quick Settings, วันเวลา และ Alert
- Launcher ค้นหาแอปจาก `.desktop` entries ด้วย GIO พร้อม icon และคีย์บอร์ดนำทาง
- Files ของเราเอง: React UI ธีม graphite สำหรับ developer, list/grid, ชนิดไฟล์และเวลาแก้ไข, ค้นหา, navigation, Terminal ในโฟลเดอร์ปัจจุบัน, Copy path, เปิดไฟล์, สร้างโฟลเดอร์และเปลี่ยนชื่อ
- Background และ panel แยกต่อจอ พร้อมรับเหตุการณ์เพิ่ม/ถอดจอ
- Compositor: ย้าย/ปรับขนาดหน้าต่าง, Alt + Tab, snap และ 4 workspaces
- ตั้งค่าผ่าน JSON, เปลี่ยนสีและความสูง panel แล้ว reload ได้
- ตัวจัดการ session: shell ปิดแล้ว compositor ปิดตาม และหยุด autostart services
- Lock screen ใช้ธีม Dev OS พร้อมชื่อผู้ใช้และตัวบอกสถานะรหัสผ่านผ่าน `swaylock`; logout มีขั้นตอนยืนยัน
- ตัวติดตั้งและ Wayland session entry สำหรับ display manager
- Dependency doctor, config tests และ smoke test บน Wayland compositor จริง
- Settings → Updates: ดาวน์โหลดรุ่น stable จาก GitHub Releases, ตรวจ SHA-256 และย้อนกลับรุ่นก่อนหน้าได้ ติดตั้งจากไฟล์ในเครื่อง (USB) และ patch ขนาดเล็กได้ตรวจลายเซ็น Ed25519 เมื่อ image มี public key; Live USB ไม่อัปเดตในที่เดิม (ดู docs/updates.md).
- App Store → Extensions: เชื่อม GitHub repo แล้วติดตั้ง/อัปเดต user extensions จาก Releases ([วิธีเผยแพร่](docs/extension-store.md))

นี่เป็นฐานเริ่มต้น ยังไม่มี taskbar รายการหน้าต่าง, system tray, notification daemon,
polkit agent และ desktop portals ในตัว

## เริ่มบน Linux

ตรวจอุปกรณ์และไดรเวอร์ได้ด้วย `sh bin/dev-os-shell drivers` หรือ `.\dev.ps1 drivers`
บน Windows/WSL โดยไม่ต้อง build ก่อน รองรับ JSON และ `--fix` สำหรับโหลดโมดูล
ที่ติดตั้งอยู่แล้ว ดูขอบเขตและวิธีแก้ไขใน [docs/drivers.md](docs/drivers.md).

แนะนำ Ubuntu 24.04 หรือ Linux ที่มี labwc >= 0.7, GJS >= 1.74,
GLib >= 2.80, GTK >= 3.24 และ gtk-layer-shell >= 0.6
runtime ของ shell และ session ใช้ GJS, shell scripts และ DevLang `d` 0.5.5 ขึ้นไป
desktop helpers ใน `bin/` และบริการจัดการบัญชี/PAM/App Store ใน `native/` ใช้ DevLang
ส่วนเครื่องมือ install / smoke test / ย้าย config ใน `tools/` ใช้ DevLang ทั้งหมด
Node.js กับ npm ใช้ตอน build
ขั้นตอน build ใช้ Node.js 22.18+ (สาย 22) หรือ 24+ และ npm;
bundle ที่ได้รันด้วย GJS ได้โดยไม่ต้องมี Node.js หรือ TypeScript compiler

```sh
sudo apt update
sudo apt install labwc gjs gir1.2-gtk-3.0 gir1.2-gtklayershell-0.1 \
  dbus-daemon util-linux grim gir1.2-vte-2.91 gir1.2-webkit2-4.1 gir1.2-soup-3.0 xdg-utils thunar \
  build-essential pkg-config libwayland-dev libwayland-bin curl tar coreutils
sudo sh tools/setup/bootstrap-lock.sh

chmod +x bin/*
npm ci
npm run build
sh tools/setup/bootstrap-window-tracker.sh
bin/dev-os-shell doctor
bin/dev-os-session --nested
```

`--nested` เปิด DE ในหน้าต่างภายใน desktop ที่ใช้อยู่ เหมาะสำหรับพัฒนา
หากรันจาก TTY ของ Linux และต้องการ session บนจอจริง ใช้ `bin/dev-os-session`
โดยผู้ใช้ต้องมีสิทธิ์เข้าถึง seat ผ่าน logind/seatd ของระบบ

ออกจาก session: คลิก **Session → Log out → Confirm log out**
หรือปิดหน้าต่าง compositor ในโหมด nested

## เริ่มจาก Windows / WSLg

ตั้งค่าเครือข่ายได้ที่ **Settings → Network & Internet → Wi-Fi** หรือปุ่ม Wi-Fi ใน Quick settings ดู [docs/wifi.md](docs/wifi.md).

รองรับ Windows ARM64 / Snapdragon ผ่าน Ubuntu WSL2 ดูการเตรียม dependencies ใน [docs/wsl-arm64.md](docs/wsl-arm64.md).

โปรเจกต์นี้อยู่ใน Windows แต่ runtime ของ Wayland ต้องอยู่ใน Linux
`dev.ps1` ใช้ WSL distribution ชื่อ `Ubuntu` และ WSLg

ระบบอัปเดตและขั้นตอนสร้าง release อยู่ใน [docs/updates.md](docs/updates.md).
เปิด **Settings → Updates → Check for updates** เพื่อค้นหารุ่นใหม่จาก `d-osc/DevOs`.
หลังติดตั้ง กด **Use latest version** แล้วบันทึกงานก่อนยืนยันสลับ shell ไปใช้รุ่นใหม่.
session รุ่นก่อน 0.3.1 ต้องเปิดแพ็กเกจใหม่ครั้งแรกด้วย `.\dev.ps1 updated` บน Windows หรือ `bin/dev-os-updated-session --nested` บน Linux
เพื่อเริ่ม session ของรุ่นที่ติดตั้งไว้; `.\dev.ps1 run` ยังใช้ source ใน checkout สำหรับพัฒนา.

บนเครื่องนี้เตรียม dependencies และ private compositor ไว้แล้ว เริ่มได้จาก PowerShell:

```powershell
npm ci
.\dev.ps1 run
```

`dev.ps1 run` จะส่งสำเนา runtime ที่ build แล้วไปยังพื้นที่ชั่วคราวของ Linux ก่อนเปิด DE
เพื่อลดเวลารออ่าน GJS modules และ GTK assets ผ่าน `/mnt/c`.
Session ใช้ PATH ของ Linux โดยตัดโฟลเดอร์โปรแกรม Windows ที่ WSL เพิ่มให้อัตโนมัติ
เพื่อให้การตรวจหา optional device tools ไม่บล็อกการเริ่ม panel.
Source ยังอยู่ใน Windows และ settings ยังอยู่ในตำแหน่งเดิม; runtime ชั่วคราวถูกลบเมื่อ session ปิด.
หลังแก้ source หรือ theme assets ให้ปิดแล้วรันใหม่เพื่อใช้ build ล่าสุด.

`dev.ps1 run` และ `demo` จะใช้ build เดิมเมื่อ source, dependencies และไฟล์ bundle ยังตรงกัน;
เมื่อมีการแก้โค้ดหรือ bundle หาย จะตรวจ TypeScript และ build ใหม่อัตโนมัติ.
build ปกติใช้ React production และลดขนาด bundle; `npm run watch` หรือ
`node tools/build/build.ts --development` ใช้ development สำหรับ debug.
ดูรายละเอียดการปรับประสิทธิภาพและวิธีวัดซ้ำใน [docs/performance.md](docs/performance.md).

## พัฒนาด้วย React

lib ใช้ React 19.2.8 และ `react-reconciler` 0.33.0 สร้าง GTK 3 widgets จริง
รองรับ functional components, state, effects, context, refs และ keyed lists
lib และ React UI เขียนด้วย TypeScript แบบ `strict` มี type ของ GTK props, events และ refs
Node.js / esbuild ใช้แปลง TSX และ bundle dependencies ก่อนรันใน GJS

```powershell
.\dev.ps1 demo       # หน้าต่าง counter, input และนาฬิกา บน WSLg
.\dev.ps1 run        # desktop ที่ UI ทั้งหมดเขียนด้วย React / TSX
npm run typecheck   # ตรวจ types โดยไม่ต้องเปิด GUI
npm run watch       # rebuild เมื่อแก้โค้ด แล้วปิด/เปิด demo หรือ session ใหม่
```

บน Linux ใช้ `npm run build` ตามด้วย `npm run demo` หรือ `npm run dev`
ตัวอย่างเต็มอยู่ที่ `examples/Counter.tsx` และคู่มือ API อยู่ที่
[packages/core/README.md](packages/core/README.md)

```tsx
import {React, Box, Label, Button, useState} from '@dev-os/core';

function Counter() {
    const [count, setCount] = useState(0);
    return <Box orientation="vertical" spacing={12}>
        <Label>Count: {count}</Label>
        <Button onClicked={() => setCount(value => value + 1)}>เพิ่ม</Button>
    </Box>;
}
```

ใช้ `createRoot(gtkContainer).render(<Counter />)` เพื่อ mount; `root.unmount()` ก่อน destroy
container จะ cleanup hooks และ signals ส่วน layer-shell และบริการระบบเป็น TypeScript / GJS
เพื่อจัดการ native windows, monitors, process และ session lifecycle
ไฟล์ `panel.ts`, `launcher.ts`, `background.ts` เป็น adapters สำหรับ Wayland surfaces
ส่วน widget tree, การค้นหาแอป, ข้อความ, การยืนยัน logout และนาฬิกาอยู่ใน React
พื้นหลังใช้ `<DrawingArea onDraw={...}>` ใน TSX โดยวาดภาพด้วย Cairo

`npm run build` ตรวจ types ก่อน build และสร้าง `dist/core.d.ts` ให้ด้วย
source, tests และ build tool เป็น `.ts` / `.tsx` ทั้งหมด; JavaScript ใน `dist/` เป็นไฟล์ที่สร้างจาก build
แยกการตรวจ GJS ใน `tsconfig.json` และ Node build tool ใน `tsconfig.tools.json`
build tool `tools/build/build.ts` รันด้วย [Node TypeScript support](https://nodejs.org/en/blog/release/v22.18.0/)
alias `@dev-os/core` ชี้ไปที่ source ระหว่างตรวจ types และชี้ไปที่ bundle เดียวกัน
เมื่อ build เพื่อให้ React กับ renderer ใช้ instance เดียวกัน
ถ้าแก้เฉพาะไฟล์ type ให้ใช้ `npm run typecheck` หรือเปิด `npm run typecheck:watch` อีก terminal

นี่เป็น renderer รุ่นเริ่มต้นสำหรับ GTK ไม่ใช่ตัวแปลงหน้าเว็บ HTML/CSS อัตโนมัติ
ใช้ `<Box>`, `<Label>`, `<Button>` แทน `<div>` และใช้ GTK CSS ใน `src/apps/org.devos.theme/style.css`
ยังไม่มี hot reload ที่รักษา state และไม่ได้รองรับ React DOM, SSR หรือ React Native APIs
รายละเอียดสัญญา renderer ดู [React reconciler](https://github.com/facebook/react/tree/v19.2.0/packages/react-reconciler)

หากติดตั้งบนเครื่อง Windows เครื่องอื่น ให้ติดตั้ง dependencies ใน Ubuntu ตามด้านบน
แล้วติดตั้ง build dependencies เพิ่ม:

```sh
sudo apt install build-essential git meson ninja-build pkg-config \
  libwlroots-dev libxml2-dev libcairo2-dev libpango1.0-dev libgtk-3-dev
```

จากนั้นใน PowerShell:

```powershell
.\dev.ps1 bootstrap
.\dev.ps1 doctor
.\dev.ps1 run
```

Ubuntu 24.04 มี labwc 0.7.1 ซึ่งหยุดทำงานเมื่อสร้าง XWayland socket
บน `/tmp/.X11-unix` แบบ read-only ของ WSLg ไม่ได้ `bootstrap` จึง build
labwc 0.7.1 แบบปิด XWayland ไว้ใน `build/wsl/bin/` สำหรับการพัฒนาเท่านั้น
`dev.ps1 run` และ `smoke` เลือก binary นี้และใช้ software rendering
แอปที่เปิดใน DE บน WSL จึงต้องรองรับ Wayland ส่วน session บน Linux ปกติใช้ labwc ของระบบ

ดูรายละเอียด build options ได้จาก [labwc source](https://github.com/labwc/labwc/tree/0.7.1)

## คีย์ลัด

| คีย์ | การทำงาน |
| --- | --- |
| Super / Windows | กดแล้วปล่อยเพื่อเปิด/ปิด Applications |
| Super + Space | เปิด/ปิด Applications (ปุ่มลัดเสริม) |
| Super + Tab | เปิด/ปิด Task View เพื่อเลือกหน้าต่าง |
| Super + Enter | เปิด terminal |
| Super + E | เปิดไฟล์ |
| Super + L | เรียก lock screen |
| Super + Shift + R | Reload shell config |
| Super + 1–4 | สลับ workspace |
| Super + Shift + 1–4 | ย้ายหน้าต่างไป workspace |
| Super + Left / Right | Snap หน้าต่างซ้าย/ขวา |
| Super + Z | เปิด Snap Layouts: ครึ่งจอ, สี่มุม, สามคอลัมน์ และกว้าง/แคบ |
| Super + Down | ย่อหน้าต่างที่กำลังใช้งานลง panel |
| Super + Up | ขยายหน้าต่างเต็มพื้นที่ทำงาน |
| Alt + Tab | สลับหน้าต่าง |
| Alt + F4 | ปิดหน้าต่าง |
| Super + ลากเมาส์ซ้าย/ขวา | ย้าย/ปรับขนาดหน้าต่าง |

ใน launcher ใช้ ↑ / ↓ เลือกแอป, Enter เปิด และ Esc ปิด
ใน Snap Layouts ใช้ลูกศรเลือกตำแหน่ง, Enter จัดหน้าต่าง และ Esc ปิดเมนู
รูปแบบ Snap ใช้พื้นที่ทำงานของจอที่หน้าต่างอยู่ โดยเว้นพื้นที่ panel ไว้
บน Windows คีย์ที่ใช้ Super บางรายการอาจถูก Windows จับก่อน;
ปุ่มบน panel ใช้ได้เช่นกัน

## ท่าทางทัชแพด 3 นิ้ว

| ท่าทาง | การทำงาน |
| --- | --- |
| ปัดขึ้น | เปิด Task View |
| ปัดลง | ย่อแอปที่ใช้งานอยู่ |
| ปัดซ้าย/ขวา | สลับ workspace |

เปิดใช้ด้วย `DEV_OS_TASK_VIEW=1` ใน `dev-os-session` (ค่าเริ่มต้นเปิดอยู่)
รายละเอียดอยู่ใน [docs/task-view.md](docs/task-view.md)

## ตั้งค่า

```sh
mkdir -p ~/.config/dev-os
cp config/config.json ~/.config/dev-os/config.json
```

ตัวอย่าง:

```json
{
  "name": "My Desktop",
  "panel_height": 36,
  "clock_format": "%a %d %b  ·  %H:%M",
  "terminal": ["dev-os-terminal"],
  "files": ["thunar"],
  "lock": ["dev-os-lock"],
  "autostart": []
}
```

คำสั่งเป็น array ของ arguments และส่งเข้า process โดยตรง
ใช้ `~` เป็น home directory ได้ แต่ไม่มีการแปล `$VARIABLE`, pipes หรือ shell expressions
ถ้า config ไม่ถูกต้อง จะรายงานข้อผิดพลาด; การ reload ที่ไม่สำเร็จเก็บ config เดิมไว้

กด Super + Shift + R เพื่อใช้สี/ความสูง/คำสั่งใหม่
การเปลี่ยน `autostart` ต้องเริ่ม session ใหม่
คีย์ลัดและ window manager อยู่ใน `config/labwc/rc.xml`;
หลังแก้ ใช้ `labwc --reconfigure` จาก terminal ภายใน Dev OS
การแก้โค้ด JavaScript ต้องเริ่ม session ใหม่

หากมี config จากเวอร์ชัน Python ที่ `~/.config/dev-os/config.toml` อยู่แล้ว:

```sh
d tools/maintenance/migrate-config.dev --
```

ตัวแปลงเก็บ TOML ต้นฉบับไว้ และไม่เขียนทับ JSON ที่มีอยู่แล้ว
หากไม่มี config.json แต่มี TOML เก่า runtime จะแจ้งให้ย้ายก่อน เพื่อไม่ทิ้งค่าที่เคยตั้งไว้

## ติดตั้ง

รันทดสอบก่อน แล้วติดตั้งเฉพาะผู้ใช้ได้:

```sh
npm run build
d tools/maintenance/install.dev -- --prefix ~/.local
~/.local/bin/dev-os-session --nested
```

หากต้องการให้ Dev OS เป็นตัวเลือกที่หน้า login:

```sh
sudo d tools/maintenance/install.dev -- --prefix /usr/local
```

ตัวติดตั้งสร้าง `/usr/local/share/wayland-sessions/dev-os.desktop`
พร้อม Exec เป็น absolute path หาก display manager ของ distro ค้นหา session
เฉพาะ `/usr/share/wayland-sessions` ให้คัดลอก entry ที่ติดตั้งแล้วไปที่นั่น:

```sh
sudo install -m 644 /usr/local/share/wayland-sessions/dev-os.desktop \
  /usr/share/wayland-sessions/dev-os.desktop
```

ตัวติดตั้งไม่เขียนทับ user config ใน `~/.config/dev-os/`
การรันจาก source ใช้ config และธีมในโปรเจกต์; การรันที่ติดตั้งแล้วใช้สำเนาใน prefix
หากใช้ WSL ให้พัฒนาด้วย `dev.ps1 run`; session entry สำหรับ login เหมาะกับ Linux ปกติ

## Settings และ extensions

เปิด Settings จากปุ่มบน panel, footer ของ launcher หรือ `bin/dev-os-shell settings`

หน้า **Launcher** มี preview และตั้งค่าความกว้างเมนู ขนาดไอคอน ความหนาแน่นรายการ
คำอธิบายแอป ปุ่มลัด workspace และการจำคำค้น พร้อม Apply/Reset.
ดูรายละเอียดใน [docs/launcher.md](docs/launcher.md).

หน้า **Background** มี preview, พื้นหลัง DevOs / สีล้วน / รูปภาพ, เลือกไฟล์และ
Fill/Fit/Stretch พร้อม Apply ใช้กับทุกจอ และ Reset เพื่อทิ้งค่าที่ยังไม่บันทึก.
ดูรายละเอียดใน [docs/background.md](docs/background.md).

หน้า **Bluetooth & Devices** แสดง Bluetooth adapters, อุปกรณ์ที่จับคู่/เชื่อมต่อ,
USB และ input พร้อมทางเข้า Mouse & touchpad, Keyboard และ Printers.
บน Linux ใช้ BlueZ; บน WSL เปิด Windows Settings สำหรับอุปกรณ์ของ host.
ดูขอบเขตและวิธีทดสอบใน [docs/bluetooth.md](docs/bluetooth.md).
UI เป็น React + GTK ทั้งหมด มีหมวด Desktop และฟอร์มที่สร้างจาก `extension.json`
Clock extension เป็นตัวอย่างที่เปิด/ปิด ปรับรูปแบบเวลา และแสดงวินาทีบน panel ได้
กด Apply เพื่อ validate บันทึก และ reload shell

เพิ่ม user package ใน `~/.local/share/dev-os/extensions/<id>/extension.json`
ค่าบันทึกแยกใน `~/.config/dev-os/extensions/<id>.json`
UI ของ shell ทั้งหมดอยู่ใน system extension packages; base ดูแล Wayland และบริการระบบ
UI packages ใช้ TypeScript lifecycle + React ส่วน settings contributions ใช้ JSON schema
ทุก package มี `extension.json`; system UI ระบุ `kind`, `system`, `entry`, `order` และ settings defaults
Build และตัวโหลดอ่าน manifest อัตโนมัติ โดยไม่ต้องเพิ่ม import ใน base
ตัวอย่าง Panel มี Item spacing ที่แก้และ Apply ผ่าน Settings ได้
เลือกธีมไอคอนที่ Settings → Theme icons โดยระบุชื่อธีมที่ติดตั้งแล้วและกด Apply
ค่าเริ่มต้นคือ Adwaita; ดู [คู่มือ Theme icons](src/apps/org.devos.icons/README.md)
ดูโครงสร้าง contract และตัวอย่างการเพิ่ม package ใน [docs/extensions.md](docs/extensions.md)
ดู [คู่มือ Dev OS Files](src/apps/org.devos.files/README.md) สำหรับ UI, คีย์ลัด และ async filesystem model
ค้นหาไฟล์ทั้งโฟลเดอร์โปรเจกต์ด้วย Ctrl + P (Quick Open): fuzzy filename/path,
↑/↓ เลือก, Enter เปิดไฟล์, Shift + Enter แสดงในโฟลเดอร์ และ Esc ปิดค้นหา
ตั้งโฟลเดอร์ที่ข้ามได้ใน Settings → Files → Search: excluded folders

## ตรวจสอบการทำงาน

```sh
npm run build
gjs -m dist/config-test.js # config และ app search tests 13 รายการ + imports ของ UI
gjs -m dist/extensions-test.js # extension schema, persistence, UI lifecycle และ JSON loader 12 รายการ
d tools/test/check.dev --     # เพิ่มตรวจ syntax ของ development tools และ XML
bin/dev-os-session --check
d tools/test/smoke.dev -- --screenshots build/screenshots
```

Smoke test ใช้ `labwc`, `dbus-run-session` และ `grim` (เมื่อเลือกบันทึกภาพ):

```sh
sudo apt install grim wtype
```

บน Windows:

```powershell
.\dev.ps1 check
.\dev.ps1 smoke
```

Smoke test สร้าง runtime และ config ชั่วคราว ตรวจ startup, remote commands,
เปิดคำสั่งแอปที่กำหนด, ข้อผิดพลาดเมื่อไม่มี optional dependency,
reload config และการปิด compositor เมื่อ shell ปิด เพิ่ม `--keyboard` เพื่อใช้ `wtype`
ตรวจคีย์ลัดและเปิด `foot` ผ่าน launcher จริง (รวมไว้ใน `dev.ps1 smoke` แล้ว)
ภาพจริงอยู่ใน `build/screenshots/`
Smoke test รัน React/GTK integration tests 8 รายการภายใน Wayland session จริงด้วย
และ desktop UI tests อีก 10 รายการ: ค้นหา/empty state, logout, actions, clock/message,
keyed list, drawing lifecycle, settings forms/Apply, icon themes และ file browser/model
เมื่อใช้ `--keyboard` จะเปิดและปิด JSX demo เพื่อทดสอบ lifecycle ของหน้าต่างเพิ่มเติม

## จุดสำหรับต่อยอด

```text
src/                        entry points and application source
  apps/                     built-in system apps (org.devos.*)
  system/                   Panel, Display Care and Background desktop infrastructure
  components/               reusable application UI components
  utils/                    shared formatting, parsing and validation helpers
  extensions/               optional extensions (including Clock)
  services/                 service hosts, controller registry and shared data processing
packages/
  react-devlang/            independent native DevLang/GTK React-style UI library
  core/                     React renderer, GTK widgets and native bindings
  extensions/               manifests, lifecycle, settings and extension store
  updates/                  update service and release protocol
  runtime/, services/       session runtime and desktop services
  compat/, config/          UI compatibility and configuration
  shell/, supervisor/       application host and session supervision
tools/
  build/                    bundles, release archives and npm packages
  check/                    DevLang JSX syntax and native type checks
  setup/                    native dependencies, WSL staging and patches
  test/                     checks, smoke tests and performance tools
  maintenance/              installation, config migration and icon imports
tests/                      integration tests and type checks
examples/                   renderer demo and example extensions
bin/                        CLI entry points
config/, data/              compositor configuration and desktop assets
docs/                       architecture and usage guides
dist/, build/               generated output and local development artifacts
```

ลำดับที่ต่อยอดได้:

1. Taskbar ผ่าน `wlr-foreign-toplevel-management`
2. Status items ผ่าน D-Bus: NetworkManager, PipeWire/WirePlumber, UPower
3. Notification daemon และ system tray
4. ขยาย Settings ด้วย monitor layout และ keyboard layout
5. Polkit agent และ xdg-desktop-portal สำหรับ permissions / screen sharing
6. Packaging สำหรับ distro และทดสอบ session บน hardware จริง

การรัน nested ใช้ D-Bus session แยกเพื่อแยก shell ของแต่ละ compositor
optional services ใส่ใน `"autostart"` เช่น `[["mako"], ["kanshi"]]`
เมนู Files เปิด file manager ของเราเองผ่าน `org.devos.files`; ไม่ต้องมี Thunar เพื่อใช้ UI นี้
Lock ต้องมี locker จริงที่รองรับ compositor
คำสั่ง Files ภายนอกใช้เป็น fallback เมื่อไม่มี extension โดยค่าเริ่มต้นคือ `thunar ~`
หากต้องการใช้ file manager ตาม MIME handler ให้กำหนด `"files": ["xdg-open", "~"]`
คำสั่ง `xdg-open` มีขั้นตอนตรวจ desktop และค้นหา MIME handler จึงอาจเปิดช้ากว่าคำสั่งตรง โดยเฉพาะบน WSL
ตรวจ handler ของโฟลเดอร์ด้วย `xdg-mime query default inode/directory`
หากยังไม่มี handler ให้ตั้ง `xdg-mime default thunar.desktop inode/directory`
หรือกำหนด `"files": ["thunar", "~"]` ใน Settings → Desktop แล้วกด Apply

โค้ดใช้ TypeScript ES modules และ imports เช่น `import Gtk from 'gi://Gtk?version=3.0'`
imports ภายใน source ใช้นามสกุล `.js` ตาม ESM และ TypeScript resolve ไปที่ `.ts` / `.tsx`
ต้อง build ก่อน แล้วใช้ entry points ใน `bin/` ซึ่งเริ่ม shell จาก `dist/main.js` และ supervisor DevLang จาก `src/system/supervisor.dev`

การย้ายระบบทั้ง repo ไป DevLang พร้อมเก็บ npm `@dev-os/*` สำหรับ JS/TS apps/extensions ยังอยู่ระหว่างดำเนินการ ดู [สถานะและขอบเขต migration](docs/devlang-repository-migration.md) และตรวจรายการที่เหลือด้วย `npm run migration:audit`
GJS ใช้ bundle ที่คอมไพล์แล้ว; Node.js และ browser รัน GI imports เหล่านี้ไม่ได้
`Gio.Subprocess` ใช้เปิด process แบบ asynchronous เพื่อไม่ค้าง UI
และใช้ `ApplicationCommandLine.done()` ของ GLib 2.80 เพื่อจบ remote commands โดยไม่รอ garbage collection

เอกสารต้นทาง: [GJS guides](https://gjs.guide/guides/),
[GIO command-line lifecycle](https://docs.gtk.org/gio/method.ApplicationCommandLine.done.html),
[labwc integration](https://labwc.github.io/integration.html),
[labwc configuration](https://labwc.github.io/labwc-config.5.html),
[gtk-layer-shell](https://wmww.github.io/gtk-layer-shell/)


Terminal ของระบบอยู่ที่ `src/apps/org.devos.terminal/extension.tsx` ใช้ VTE GTK3
Header ของ Terminal และ Files เป็นแท็บ React ที่แชร์ `packages/services/window-tabs.tsx`;
ปุ่มควบคุมหน้าต่างและเมนูคลิกขวายังใช้ `mountWindowHeader()` ร่วมกับ Settings และ React demo.
Terminal เปิดแท็บด้วย + หรือ Ctrl+Shift+T, ปิดด้วย Ctrl+Shift+W; shell exit ปิดเฉพาะแท็บนั้น.
Files เปิดแท็บด้วย + หรือ Ctrl+T, ปิดด้วย Ctrl+W. ทั้งสองแอปสลับด้วย Ctrl+Tab / Ctrl+Shift+Tab.
แต่ละแท็บแยก shell หรือโฟลเดอร์และประวัติ; ปิดแท็บสุดท้ายจะปิดหน้าต่าง.
ลากแท็บไปปล่อยบนเดสก์ท็อปหรือเนื้อหาหน้าต่างเพื่อแยกเป็นหน้าต่างใหม่;
ลากไปปล่อยบน header ของหน้าต่างแอปชนิดเดียวกันเพื่อรวมกลับ หรือจัดลำดับแท็บในหน้าต่างเดิม.
กด Esc ระหว่างลากเพื่อยกเลิก. ย้าย VTE/PTY และ FileBrowser เดิม จึงรักษา shell, scrollback, โฟลเดอร์และ history.
ถ้าย้ายแท็บสุดท้ายออก หน้าต่างต้นทางจะปิด; หน้าต่างที่แยกยังมีรายการบน panel และปิดตาม extension lifecycle.
WSL ใช้ `tools/setup/patches/labwc-tab-drag-focus.patch` และ `labwc-tab-drag-escape.patch` เพื่อแก้ focus และการยกเลิก DnD ใน labwc 0.7.1;
`dev.ps1 run` เตรียม compositor ส่วนตัวให้อัตโนมัติเมื่อยังไม่มี fix นี้.
ทดสอบลากด้วยเมาส์จริงได้หลัง `tools/setup/bootstrap-pointer-test.sh` ด้วย `d tools/test/tab-drag-smoke.dev --`.
Header ที่ compositor วาดใช้ไอคอนแอปขนาด 16 px จาก `app_id` และ `Icon` ใน `.desktop`
ผ่าน `tools/setup/patches/labwc-app-icons.patch`; หากหาไม่พบใช้ไอคอนแอปทั่วไปของ Adwaita.
คลิกไอคอนหรือคลิกขวาที่ header ยังเปิดเมนูหน้าต่างเดิม.
`dev.ps1 run` build patch นี้ให้อัตโนมัติ; ทดสอบได้ด้วย `d tools/test/app-icons-smoke.dev --`
หลังเตรียม pointer tools เช่นเดียวกับการทดสอบลากแท็บ.
ตั้งค่า `terminal: ["dev-os-terminal"]` เพื่อใช้ตัวนี้; ค่าเดิม `["foot"]` ใช้ Terminal ใหม่เช่นกัน.
ถ้าต้องการ foot ภายนอกโดยตรงใช้ `["foot", "--app-id=foot"]`; คำสั่งภายนอกอื่นยังทำงานตามเดิม.
ปรับฟอนต์และ scrollback ได้ใน Settings → Terminal. ใช้ Ctrl+Shift+C/V เพื่อคัดลอก/วาง.
บน Linux ติดตั้ง `gir1.2-vte-2.91`; WSL ใช้ `tools/setup/bootstrap-terminal.sh`
ซึ่งจัดเตรียม dependency ใน `build/wsl/vte` และ `dev.ps1 run` เรียกให้อัตโนมัติ.

อิมเมจ DevOs ไม่รวม VS Code, Chrome, Rust, Node.js/nvm และ QEMU เพื่อให้ไฟล์เล็ก (ดู [Bundled apps](docs/bundled-apps.md)); ไม่มี Python ด้วย (helper ใน Settings เขียนด้วย DevLang).

Editor ของระบบใช้ Monaco + WebKitGTK และ header แบบแท็บร่วมกับ Terminal.
เปิดจาก Applications → Editor หรือ `dev-os-editor file.ts`; ใช้ Ctrl+O / Ctrl+S และลากแท็บแยกหรือรวมหน้าต่างได้.
ตั้งค่า font size, tab size และ minimap ผ่าน JSON preferences ที่ Settings → Editor.
Monaco และ workers bundle ในแอปทั้งหมด; ดู [คู่มือ Editor](src/apps/org.devos.editor/README.md).


Panel อยู่ด้านล่างบนทุก monitor: ซ้ายเป็น Menu → Terminal → Files;
ไอคอนแอปมี indicator แสดงสถานะเปิด/active/minimized จาก Wayland foreign-toplevel protocol.
กดไอคอนเพื่อย่อหน้าต่าง active หรือเรียกหน้าต่างที่ย่อกลับมา; หลายหน้าต่างมี popup ให้เลือก.
แอปอื่นที่เปิดอยู่แสดงบน panel ด้วย และรายการจะหายเมื่อปิดแอป.
Base service อยู่ที่ `packages/services/windows.ts`, transport ที่ `native/window-tracker.c`; UI ยังอยู่ใน panel extension.
ขวาเป็น Quick Settings (network/audio/battery) → เวลาและวันที่ → Alert.
กดกลุ่มอุปกรณ์เพื่อเปิด Wi-Fi/Bluetooth, mute และแถบปรับเสียง; กดวันเวลาเพื่อดูวันที่เต็ม.
Alert เก็บข้อความจาก desktop shell และล้างรายการได้ (ยังไม่ใช่ Freedesktop notification daemon).
UI อยู่ที่ `src/system/org.devos.panel/view.tsx`; backend ที่ `devices.ts`; ธีมอยู่ใน `org.devos.theme/style.css`.
เสียงรองรับ `wpctl` (PipeWire) หรือ `pactl` (PulseAudio/WSLg); Wi-Fi ใช้ NetworkManager (`nmcli`)
และ Bluetooth ใช้ BlueZ (`bluetoothctl`). อุปกรณ์หรือ backend ที่ไม่มีจะแสดง Unavailable.
`dev.ps1 run` เตรียม `pactl` ใน `build/wsl/bin` ให้อัตโนมัติสำหรับ WSL;
บน Linux ติดตั้งเครื่องมือควบคุมเสียง/เครือข่ายผ่าน package manager ของ distro.

แพ็กเกจ `@dev-os/core` รวม API และ types สำหรับ extension lifecycle, settings และ desktop services ดู [packages/core/README.md](packages/core/README.md).

สร้างแพ็กเกจ `@dev-os/core` แบบ standalone ด้วย `npm run core:pack` ไฟล์ `.tgz` อยู่ใน `build/core-package/` โดยรวม React, React Reconciler และ Scheduler ไว้ใน bundle พร้อม TypeScript declarations ดู [คู่มือแพ็กเกจ](packages/core/README.md#pack-a-standalone-library).

Extension services live in `packages/extensions` (`@dev-os/extensions`), and update services in `packages/updates` (`@dev-os/updates`). Build package archives with `npm run extensions:pack` and `npm run updates:pack`; the output is under `build/extensions-package` and `build/updates-package`.

Desktop libraries are published separately as `@dev-os/runtime`, `@dev-os/services`, `@dev-os/config`, `@dev-os/shell` and `@dev-os/supervisor`. Pack each library with `npm run <name>:pack`.
