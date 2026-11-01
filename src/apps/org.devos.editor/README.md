# Editor

Editor เป็นหน้าต่าง native เขียนด้วย DevLang ทั้งหมด: พื้นที่แก้ไขเป็น code view ของ toolkit
(`packages/react-devlang/native/code.inc`: GtkTextView + เลขบรรทัด + undo + auto-indent) ระบายสีไวยากรณ์ด้วย
`highlight.dev` ตามกฎสีของธีมใน `data/themes/palettes.json` ไม่มี WebKit, JavaScript หรือ bundle.

เปิดจาก Applications → Editor หรือ `dev-os-shell editor file.ts`.

แท็บอยู่ในแถบหัวหน้าต่างแบบ Chrome: ไอคอน ชื่อ และปุ่มปิดรวมอยู่ในแท็บเดียว ลากเพื่อสลับลำดับ หรือคลิกเมาส์กลางเพื่อปิดแท็บได้ เปิดหลายไฟล์เป็นแท็บได้ด้วยปุ่ม `+` (หรือ Ctrl+N) แต่ละแท็บเก็บข้อความที่ยังไม่บันทึก, Undo/Redo, cursor และตำแหน่งเลื่อนแยกกัน เปิดไฟล์เดิมจะเลือกแท็บที่มีอยู่ ปุ่ม `×` จะถาม Save and close / Discard / Cancel เมื่อมีการแก้ไขที่ยังไม่บันทึก.

| ปุ่ม | ทำอะไร |
|---|---|
| Ctrl+S | บันทึก |
| Ctrl+F / Ctrl+H | ค้นหา / ค้นหาและแทนที่ (เลือกข้อความก่อนเพื่อใส่ในช่องค้นหา) |
| F3 หรือ Ctrl+G / Shift+F3 | ผลถัดไป / ก่อนหน้า (วนรอบ) |
| Ctrl+Z / Ctrl+Y หรือ Ctrl+Shift+Z | undo / redo (แทนที่ทั้งหมดเป็น undo ขั้นเดียว) |
| Tab / Shift+Tab | เยื้อง / ลดการเยื้องบรรทัดที่เลือก |
| Enter | ขึ้นบรรทัดใหม่โดยคงการเยื้อง (เพิ่มอีกระดับหลัง `{ ( [`) |
| Esc | ปิดแถบค้นหา |

ไฟล์ต้องเป็น UTF-8 ไม่เกิน 8 MB; binary ถูกปฏิเสธ.

## ภาษาที่ระบายสี

TypeScript/JavaScript, C/C++, Rust, Go, Java/C#, Python, shell, Lua, SQL, Dockerfile, Makefile (สแกนเนอร์ทั่วไป:
คอมเมนต์ สตริง ตัวเลข คีย์เวิร์ด ชนิด ฟังก์ชัน ค่าคงที่) และ JSON, HTML/XML, CSS/SCSS, Markdown, YAML/INI/TOML
(สแกนเนอร์เฉพาะ). ภาษาอื่นแสดงเป็นข้อความธรรมดา. เป็น highlighter ไม่ใช่ parser: ไม่ล้มเหลวเมื่อไฟล์ไม่สมบูรณ์.

## สิ่งที่ Editor ตัวนี้ไม่มี (เทียบกับ Monaco เดิม)

แท็บหลายไฟล์ในหน้าต่างเดียว, minimap, IntelliSense/diagnostics ของ TypeScript, code folding, multi-cursor,
regex ในการค้นหา, ลากแท็บแยกหน้าต่าง. เปิดหลายไฟล์ = เปิดหลายหน้าต่างผ่าน `dev-os-shell editor`.

## Source

- `native.devx`: หน้าต่าง, แถบ Open/Save/Find, แถบค้นหา/แทนที่, สถานะ.
- `highlight.dev`: ตัวระบายสี (ไม่ใช้ standard library เพื่อให้หน้าต่าง import ได้).
- `find.dev`: ค้นหา/แทนที่ (offset เป็น byte).
- `literal.dev`: ถอดรหัส JSON string literal ที่ worker ส่งมา.
- `service.dev`: worker อ่าน/เขียนไฟล์ และส่งสีของธีมให้ code view. `kit.dev`: อ่านกฎสีจาก palettes.json.

ทดสอบ: `d tests/editor-highlight.test.dev`, `editor-find`, `editor-literal` (ตรรกะล้วน) และ
`d tests/editor-native.test.dev` (หน้าต่างจริงใต้ Xvfb: เปิดไฟล์, ข้อความตรงเป๊ะ, ค้นหา, แทนที่ทั้งหมด, undo/redo, บันทึก).


Drag a tab outside its window to move it into a separate window. Drag it onto another tab strip from the same app instance to merge it back. The live editor buffer (including unsaved changes and undo), browser view/history, terminal shell/PTY, or Files navigation state moves with the tab. Moving the final tab closes only the empty source window; other windows continue running.
