# Theme icons

System extension สำหรับเลือก GTK icon theme ของ Dev OS shell
ตั้งค่าผ่าน Settings → Theme icons → Apply

- **Icon theme name**: ชื่อโฟลเดอร์ของธีมที่ติดตั้ง ค่าเริ่มต้น `Adwaita`
- **Use the session icon theme**: ใช้ธีมที่ GTK กำหนดตอนเริ่ม session

Manifest และ defaults อยู่ใน `extension.json`
ค่าของผู้ใช้บันทึกใน `~/.config/dev-os/extensions/org.devos.icons.json`
รองรับ `XDG_CONFIG_HOME` ตาม framework ของระบบ

```json
{
  "version": 1,
  "enabled": true,
  "values": {
    "themeName": "Adwaita",
    "useSystemTheme": false
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
