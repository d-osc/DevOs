# Theme icons

System extension สำหรับเลือก GTK icon theme ของ Dev OS shell
ตั้งค่าผ่าน Settings → Theme icons → Apply

หน้าใหม่แสดง preview ไอคอนจริงจาก GTK theme ที่เลือกและตัวอย่าง Material files
โดยใช้ IconTheme แยก จึงไม่เปลี่ยนไอคอนจริงระหว่างทดลองเลือก มีรายการธีมที่ติดตั้ง
ค้นหาและ Refresh หลังเพิ่มธีมในเครื่องได้ รวมถึง Apply/Reset และตัวเลือกใช้ session theme
หากธีมที่บันทึกไว้หายไป จะแสดง preview ของ session theme และให้เลือกธีมที่ติดตั้งก่อน Apply
ไอคอน symbolic ใน preview ใช้สีตาม style context เพื่อให้อ่านได้บนพื้นหลังมืด

ทดสอบด้วย `npm run build` และ `gjs -m dist/icons-settings-test.js` ใน Linux ที่รองรับ GTK
ครอบคลุม preview แยกจากค่าจริง, Apply/Reset, ค้นหา/รีเฟรช, Material icons และ session fallback

- **Icon theme name**: ชื่อโฟลเดอร์ของธีมที่ติดตั้ง ค่าเริ่มต้น `Adwaita`
- **Use the session icon theme**: ใช้ธีมที่ GTK กำหนดตอนเริ่ม session
- **Material file and folder icons**: ใช้ไอคอนสีจาก Material Icon Theme ใน Files, Quick Open และแท็บ Editor (เปิดเป็นค่าเริ่มต้น)

SVG และ mapping มาจาก [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
รุ่น 5.39.0; commit และรายละเอียดการปรับใช้เก็บใน `material/source.json`, MIT license เก็บใน `material/LICENSE`.
เลือกตามชื่อไฟล์ก่อน แล้วจึงนามสกุลแบบยาว เช่น `.d.ts`; โฟลเดอร์เช่น `src` และ `node_modules` ใช้ไอคอนเฉพาะ.
ไฟล์ไม่รู้จักใช้ Material file icon และโฟลเดอร์ทั่วไปใช้ Material folder icon. ไอคอนปุ่มและแอปยังใช้ GTK theme.
บันเดิล SVG ไว้ใน `data/icons/hicolor/scalable/apps` จึงใช้ได้ออฟไลน์และรวมอยู่ในแพ็กเกจอัปเดต.
clone icons ใช้ SVG ของ base icon โดยไม่ปรับสี clone. ใช้ default Angular icon pack และ specific folder theme.
นำเข้ารุ่นใหม่ด้วย `node tools/maintenance/import-material-icons.ts /path/to/reviewed/upstream-checkout` แล้วทดสอบก่อนเผยแพร่;
การ build และเปิด desktop ตามปกติไม่ดาวน์โหลดไอคอนจาก network.

Manifest และ defaults อยู่ใน `extension.json`
ค่าของผู้ใช้บันทึกใน `~/.config/dev-os/extensions/org.devos.icons.json`
รองรับ `XDG_CONFIG_HOME` ตาม framework ของระบบ

```json
{
  "version": 1,
  "enabled": true,
  "values": {
    "themeName": "Adwaita",
    "useSystemTheme": false,
    "materialFiles": true
  }
}
```

ใช้ชื่อธีมตามโฟลเดอร์ใน GTK icon search paths
ตัวอย่างตำแหน่งธีมผู้ใช้คือ `~/.local/share/icons/<theme-name>/index.theme`
หรือ `~/.icons/<theme-name>/index.theme`; system themes มักอยู่ใน `/usr/share/icons/`
Extension อ่าน search paths จาก `Gtk.IconTheme` จึงใช้เส้นทางที่ GTK กำหนดจริง
ชื่อ theme ต้องตรงกัน รวมตัวพิมพ์เล็ก/ใหญ่

เมื่อค่าเปลี่ยน extension ตั้ง `gtk-icon-theme-name` ของ GTK Settings ใน process ของ shell
panel, launcher และ GTK icons ที่อ้างชื่อไอคอนจะใช้ theme ใหม่
GTK ดูแล inherited themes และ symbolic icons ตาม icon theme ที่เลือก
แอปอื่นที่เปิดแยก process ใช้การตั้งค่าของตัวเอง

ถ้าชื่อว่างหรือไม่พบ `index.theme` จะใช้ธีมเดิมและบันทึกข้อความใน shell log
ไม่ดาวน์โหลด icon packs อัตโนมัติ
ตอน cleanup จะถอน subscription และคืนค่า theme เดิม
Package เป็น base extension; ใช้ตัวเลือก session theme เมื่อต้องการให้ใช้ธีมเดิม

## Font Awesome base icons

ไอคอน `*-symbolic` ของ shell (panel, launcher, settings, ปุ่มต่าง ๆ) วาดจาก Font Awesome Pro ใน `assets/`
โดย `tools/maintenance/build-fa-icons.py` (ต้องใช้ `pip install fonttools brotli`) ดึง outline ของไอคอนที่ใช้
(รายการใน `fa/mapping.json`) เป็น `data/icons/fa/<pack>-<style>.json`; runtime อ่านเฉพาะ pack/style ที่เลือก
และไม่ส่ง `assets/` (webfonts ~9 MB) เข้า image

Settings: `baseIcons` (เปิด/ปิด), `basePack` (classic, duotone, sharp, sharp-duotone, chisel, etch, graphite,
jelly, mosaic, notdog, pixel, slab, thumbprint, utility, vellum, whiteboard) และ `baseStyle`
(solid, regular, light, thin) ค่าเริ่มต้นคือ duotone + solid. ค่าที่ไม่ถูกต้องจะถูกปฏิเสธตอนบันทึก
และอ่านกลับเป็นค่าเริ่มต้น

Pack ที่มีไม่ครบทุก style: classic/duotone/sharp/sharp-duotone มีครบ 4; chisel, jelly, pixel, slab = regular;
etch, mosaic, notdog, vellum = solid; graphite = thin; thumbprint = light; utility และ whiteboard เป็น semibold
(แสดงเป็น solid). ถ้าไม่มีไอคอนใน pack/style ที่เลือก จะลอง style ใกล้เคียงใน pack เดียวกัน,
Classic style เดิม, Classic solid และสุดท้ายใช้ GTK icon theme จึงไม่มีไอคอนว่าง
ไอคอนที่ไม่อยู่ใน mapping และชื่อที่ไม่ลงท้าย `-symbolic` (ไอคอนแอป) ใช้ GTK theme ตามเดิม

License: Font Awesome Pro เป็น Commercial License; ดู `data/icons/fa/NOTICE.md`

ไอคอนแอปพื้นฐานทั้ง 11 แอปใช้ชื่อ `dev-os-*` ใน `fa/mapping.json` และ outline จาก `assets/` เช่นกัน
หลังอัปเดต webfonts ให้รัน `python tools/maintenance/build-fa-icons.py` แล้ว
`d tools/maintenance/build-app-icons.dev` เพื่อสร้าง SVG ปกติและ symbolic ใน
`data/icons/hicolor/scalable/apps/` สำหรับ Launcher, desktop entries และ native windows.
ไอคอน symbolic ใน shell เปลี่ยนตาม pack/style ที่เลือก ส่วนไอคอนแอปใน Launcher ใช้ Duotone Solid
(ถ้าไม่มี glyph จะใช้ Classic Solid) โดยไม่ต้องติดตั้ง webfont บนเครื่องปลายทาง.
