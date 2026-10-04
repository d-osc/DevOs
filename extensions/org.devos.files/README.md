# Dev OS Files

Native file manager ของ shell เขียนด้วย React + TypeScript + GTK 3
เปิดจากปุ่ม Files บน panel, launcher, Super + E หรือ `bin/dev-os-shell files`
Extension มี command `files`; base ส่ง Files action ให้ extension ก่อน external fallback

รองรับ local filesystem:

- Sidebar, breadcrumb และพิมพ์ folder path
- Back, forward, parent folder และ refresh
- ธีม dark graphite, path และชื่อไฟล์ monospace พร้อมสีระบุชนิดไฟล์
- List เป็นค่าเริ่มต้น พร้อมคอลัมน์ชนิด ขนาด เวลาแก้ไข; สลับ grid พร้อมไอคอน GTK
- Sidebar แสดงโฟลเดอร์ย่อย
- Header เป็นแท็บแบบ Chrome พร้อมไอคอนโฟลเดอร์ ปุ่ม + และปุ่มปิดแต่ละแท็บ
- แต่ละแท็บเก็บโฟลเดอร์ ประวัติ การเลือกไฟล์ และ Quick Open แยกกัน
- คลิกขวาบนแถบชื่อเปิดเมนูหน้าต่างของ compositor รวมคำสั่ง workspace
- Terminal เปิดในโฟลเดอร์ปัจจุบันด้วย terminal command จากการตั้งค่าระบบ
- Copy path คัดลอก path ของ item ที่เลือก หรือโฟลเดอร์ปัจจุบัน
- แสดงหรือซ่อน hidden files
- Quick Open แบบ VS Code: ค้นหาชื่อหรือ relative path แบบ fuzzy รวมโฟลเดอร์ย่อย
- ดับเบิลคลิกหรือ Enter เปิดโฟลเดอร์; ไฟล์เปิดผ่าน GIO default application
- สร้างโฟลเดอร์และเปลี่ยนชื่อไฟล์/โฟลเดอร์ โดยไม่เขียนทับชื่อที่มีอยู่

คีย์ลัด: Ctrl + L ไปช่อง path, Alt + Left/Right ย้อน/ไปข้างหน้า,
Ctrl + H แสดง hidden files, F5 refresh, Ctrl + T เปิดแท็บ, Ctrl + W ปิดแท็บ,
Ctrl + Tab / Ctrl + Shift + Tab สลับแท็บ; ปิดแท็บสุดท้ายจะปิดหน้าต่าง,
Ctrl + 1/2 เลือก list/grid, Ctrl + Shift + T เปิด Terminal ในโฟลเดอร์ปัจจุบัน
เลือก item ก่อนใช้ Rename หรือ Open

Quick Open: เปิดโฟลเดอร์โปรเจกต์แล้วกด Ctrl + P
พิมพ์ `files-view`, `fvtsx` หรือ `src/view`; ตัวค้นหาจัดอันดับชื่อไฟล์ก่อน path
ใช้ ↑/↓ เลือก, Enter เปิดผ่าน default application, Shift + Enter แสดงและเลือกไฟล์ในโฟลเดอร์,
Esc กลับหน้า Files โดยไม่เปิดไฟล์ ผลลัพธ์แสดง relative path เพื่อแยกชื่อซ้ำ
Scope คือโฟลเดอร์ปัจจุบันตอนเปิด Quick Open; เปิดใหม่เพื่ออ่านไฟล์ที่เพิ่ม/เปลี่ยนชื่อ
Toolbar ด้านบนถูกถอดออกชั่วคราว; เปิดค้นหาด้วย Ctrl + P และ Terminal ด้วย Ctrl + Shift + T

Quick Open อ่านด้วย GIO async ทีละ 100 entries, แสดงไม่เกิน 100 ผลลัพธ์
และ debounce การพิมพ์ 150 ms โดยไม่ตาม symlink directory
จำกัดการสำรวจ 30,000 entries รวมไฟล์และโฟลเดอร์; แจ้งเมื่อผลลัพธ์เป็นบางส่วนหรือข้ามโฟลเดอร์ที่อ่านไม่ได้
ปิดค้นหา/หน้าต่างจะยกเลิก IO และ timer ที่ค้างอยู่

`extension.json` กำหนด defaults และ generated settings ของ Files:
`homeDirectory` เป็น start folder, `gridView` เลือกเริ่มด้วย grid, `showHidden` เลือก hidden files
`searchExcludedDirectories` เป็นรายชื่อโฟลเดอร์คั่นด้วย comma ที่ Quick Open จะข้าม:
ค่าเริ่มต้น `.git,node_modules,dist,build,.venv,vendor,.cache`
ข้ามตามชื่อ directory ในทุกระดับ; dotfiles อื่นยังค้นหาได้
รุ่นนี้ยังไม่อ่าน `.gitignore` และยังไม่ค้นหาข้อความภายในไฟล์
แก้ใน Settings → Files → Apply; start folder ใช้เมื่อเปิดหน้าต่างใหม่
View defaults ที่เปลี่ยนใช้กับหน้าต่างที่เปิดอยู่ ส่วน path ปัจจุบันคงเดิม
ค่าของผู้ใช้แยกใน `~/.config/dev-os/extensions/org.devos.files.json`

โครงสร้าง:

```text
extension.json   metadata, entry และ settings schema
extension.ts     command registration และ lifecycle
index.ts         native window, keyboard และ default-app launch
model.ts         async filesystem IO, history, cancellation และ mutations
view.tsx         React UI ทั้งหมด
presentation.ts  ชนิดไฟล์, path display และเวลาแก้ไข
search.ts        async recursive index, cancellation และ fuzzy ranking
search-view.tsx  React Quick Open และ keyboard selection
```

สีและระยะห่างอยู่ใน `extensions/org.devos.theme/style.css` ภายใต้ selector `#files`
การออกแบบนี้ใช้ native GTK widgets; ไม่ต้องเปิด browser หรือ webview

Directory IO อ่าน metadata ครั้งละ 100 entries ด้วย GIO async APIs
ยกเลิกการอ่านก่อนหน้าเมื่อเปลี่ยน folder และเมื่อปิดหน้าต่าง
UI แสดงครั้งละ 200 items และมี Show more เพื่อไม่สร้าง widgets ทั้งหมดพร้อมกัน
Navigation ที่ไม่สำเร็จแสดง error และเก็บ folder เดิมไว้
File operations มี inline error; rename ไม่ overwrite และชื่อไม่อนุญาต path separators

รุ่นแรกยังไม่มี delete, copy/paste, drag-and-drop, thumbnails หรือ network mounts
Quick Open ค้นหาไฟล์รวมโฟลเดอร์ย่อย
การเปลี่ยนไฟล์จากแอปอื่นใช้ Refresh หรือเปิด Quick Open ใหม่
การอ่าน/เปิดไฟล์ไม่เรียก Thunar หรือ xdg-open

WSL ใช้ labwc ส่วนตัวที่ build ด้วย `tools/bootstrap-wsl.sh` ซึ่งเพิ่มรองรับ
`xdg_toplevel.show_window_menu` ผ่าน `tools/patches/labwc-window-menu.patch`
แพตช์ตรวจ input serial และ seat ก่อนเปิด `client-menu` ของหน้าต่างที่ส่งคำขอ
ทดสอบเมาส์ได้ด้วย `tools/bootstrap-pointer-test.sh` แล้วรัน
`tools/smoke.py --keyboard --pointer` โดยเพิ่ม `build/wsl/bin` ใน PATH
เครื่องมือเมาส์อยู่ใน build ของโปรเจกต์และไม่ติดตั้งทับเครื่องมือระบบ
