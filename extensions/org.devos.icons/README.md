# Theme icons

System extension สำหรับเลือก GTK icon theme ของ Dev OS shell
ตั้งค่าผ่าน Settings → Theme icons → Apply

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
