# Editor

Editor เป็น system UI extension ที่ใช้ React + TypeScript, header และแท็บร่วมกับ Terminal.
พื้นที่แก้ไขใช้ Monaco 0.57 ใน WebKitGTK 4.1. React DOM ดูแลการ mount Monaco ภายใน WebKit;
toolbar, status bar, native header และ dialogs ใช้ GTK. Assets และ language workers bundle ใน `dist/editor/`
และเสิร์ฟเฉพาะบน loopback ระหว่างเปิดแอป จึงใช้ได้โดยไม่ต้องเชื่อมต่อ CDN.

ติดตั้ง runtime บน Ubuntu:

```sh
sudo apt install gir1.2-webkit2-4.1 gir1.2-soup-3.0
```

เปิดจาก Applications → Editor หรือ `dev-os-editor file.ts other.json` ใน Terminal.
Ctrl+N / Ctrl+T เปิดแท็บใหม่, Ctrl+O เปิดไฟล์, Ctrl+S บันทึก, Ctrl+Shift+S บันทึกเป็นชื่อใหม่,
Ctrl+W ปิดแท็บ และ Ctrl+Tab / Ctrl+Shift+Tab สลับแท็บ.
ลากแท็บเพื่อแยก/รวมหน้าต่างได้เหมือน Terminal โดยย้าย WebKit widget และ Monaco instance เดิม.
Ctrl+F, Ctrl+H, undo/redo และ syntax highlighting เป็นคำสั่งของ Monaco ตามปกติ.

หน้าตาอิง VS Code: แท็บแบนพร้อมไอคอน React/TypeScript/JavaScript, ชื่อโฟลเดอร์เมื่อชื่อไฟล์ซ้ำ,
breadcrumbs, ปุ่ม Open/Save/Find/Replace แบบไอคอน, minimap และ status bar ขนาดเล็ก.
เปิด minimap เป็นค่าเริ่มต้นและรองรับ JSX ในไฟล์ `.tsx` / `.jsx`.

ตั้งค่า font size, tab size และ minimap ที่ Settings → Editor.
ไฟล์รองรับ UTF-8 ขนาดไม่เกิน 8 MB; ปฏิเสธ binary และ encoding ที่ไม่ใช่ UTF-8.
แสดงจุดเมื่อมีการแก้ไข เตือนก่อนปิด และตรวจ etag ก่อนบันทึกเพื่อป้องกันการเขียนทับไฟล์ที่เปลี่ยนจากภายนอก.
การปิด session ยังคงใช้ขั้นตอน Log out ของ desktop; ควรบันทึกงานก่อนออกจากระบบ.

Source:

- `extension.tsx`: window, React toolbar/status, tabs, dialogs และ lifecycle.
- `document.ts`: local file IO, dirty state และ external modification detection.
- `surface.ts`: WebKit และ typed bridge.
- `assets.ts`: bundled asset server บน loopback.
- `browser/index.tsx`: React DOM + Monaco และ workers.
- `extension.json`: manifest และ settings.

Build ด้วย `npm run build`. `tools/smoke.py` ทดสอบ file IO, Monaco workers, save,
dirty close cancellation และการย้ายแท็บที่รักษา undo history.
`python3 tools/editor-smoke.py` ทดสอบเปิดหลายไฟล์จาก command line, พิมพ์แล้วกด Ctrl+S,
ลากแท็บแยก/รวมหน้าต่าง และ Esc ด้วย input จริงใน private headless session
(ต้องมี `wtype`, `grim`, Pillow และ pointer helpers จาก `tools/bootstrap-pointer-test.sh`).
