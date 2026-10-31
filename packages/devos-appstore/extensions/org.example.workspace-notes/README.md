# Workspace Notes

ตัวอย่าง **settings extension** สำหรับ App Store ที่รวม Extensions แล้ว เก็บ note, boolean, color และจำนวน focus minutes ด้วย declarative settings ของ DevOs ไม่โหลด JavaScript เพิ่ม ไม่เปลี่ยน panel/launcher/theme และยังไม่มี public GitHub release

`listing.json` เป็นข้อมูลของ registry ส่วน `package/extension.json` เป็น manifest ที่ runtime อ่าน ห้ามเอา publisher, delivery, readme หรือ target ไปเติมใน runtime manifest เพราะ consumer ปฏิเสธ field ที่ไม่รู้จัก

## สร้าง package ด้วย DevLang

จาก root ของ DevOsAppStore:

```sh
d scripts/build_registry.dev
d scripts/package_extension.dev -- org.example.workspace-notes
```

ผลลัพธ์อยู่ที่ `dist/extensions/org.example.workspace-notes/1.0.0/`:

- `extension.json`
- `dev-os-extension.tar.gz` ที่มี `extension/extension.json` และ `extension/icons/workspace-notes.svg`
- `SHA256SUMS` พร้อม hash จริงของไฟล์ที่สร้าง

ทดสอบ local package บน DevOs Linux ผ่าน DevOsPM ที่ติดตั้งอยู่ได้ด้วย:

```sh
dev install /absolute/path/dev-os-extension.tar.gz --sha256 ACTUAL_ARCHIVE_HASH
```

ชื่อ executable อาจใช้ `devospm` หรือ path ตาม environment ให้เลือก binary ของ DevOsPM ไม่ใช่ alias ของ DevLang ตัวอย่างนี้ตรวจ manifest และ archive ได้บนเครื่องพัฒนา แต่ยังไม่ได้เปิดทดสอบ settings page ใน session DevOs จริง

## เผยแพร่เข้า App Store → Extensions

Consumer ปัจจุบันใช้หนึ่ง public GitHub repo ต่อหนึ่ง extension ต้องนำ package source นี้ไปไว้ใน repo ของ extension แยก แล้วเผยแพร่ stable tag `v1.0.0` พร้อม 3 assets ข้างต้น ค่า version ต้องตรง manifest และ GitHub API ต้องให้ SHA-256 digest ของ archive

หลังมี repo/release จริง จึงแก้ delivery.source เป็น `{"type":"github","repository":"OWNER/REPO"}` และ status เป็น published ใน listing (OWNER/REPO เป็นคำอธิบาย ไม่ใช่ repository ที่สร้างแล้ว) ปัจจุบัน AppStore importer อ่าน `extensions/` และแสดงรายการนี้ในแท็บ Extensions แล้ว รายการ published จะมี Check availability เพื่อตรวจ release ก่อนติดตั้ง ตัวอย่าง local draft นี้แสดง Not released yet

การ enable/disable, connected repositories, preferences และ install history เป็นข้อมูลเครื่องผู้ใช้ ไม่อยู่ใน listing การเปลี่ยน enable/disable มีผลต่อ session ถัดไปตาม runtime เดิม
