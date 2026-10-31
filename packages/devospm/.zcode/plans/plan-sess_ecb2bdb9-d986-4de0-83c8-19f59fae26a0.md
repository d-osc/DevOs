# ปรับ DevOsPM ให้เชื่อมกับ DevOs (3 ฟีเจอร์)

## สรุปสิ่งที่ทำ

ทำให้ `dev` เป็นเครื่องมือประกอบ desktop จริงของ Dev OS:

1. **รองรับแพ็กเกจ extension ของ DevOs** — `dev install` รับ `dev-os-extension.tar.gz` (มี `extension/extension.json`) แล้วลงใน layout จริงของ Extension Store เพื่อให้ DevOs โหลดตอนเริ่ม session ใหม่ และ Settings → Extension Store ยัง update/rollback ต่อได้
2. **แอปปรากฏใน Launcher** — แพ็กเกจ `kind: app` ได้ไฟล์ `.desktop` ใน `~/.local/share/applications` (Launcher ของ DevOs สแกนตำแหน่งนี้ด้วย GIO และรีเฟรชทันที)
3. **`dev update`** — ตรวจรุ่นล่าสุดจาก GitHub API ตามค่า `repository.release` ดาวน์โหลด ตรวจ SHA-256 แล้วแทนที่รุ่นเดิม

---

## 1. DevOs extension support — ไฟล์ใหม่ `src/devos.rs`

**การตรวจจับแพ็กเกจ:** หลังอ่าน tar entries ถ้าทุก path อยู่ใต้ `extension/` และมี `extension/extension.json` และไม่มี `package.json`/`dev-package.json` ที่ราก → เข้าเส้นทาง extension; ถ้าปนกัน → error (ambiguous)

**การ validate (มิเรอร์ `packages/extensions/schema.ts` + `store-protocol.ts` ของ DevOs):**
- `ExtensionManifest` แบบ `deny_unknown_fields`: keys อนุญาต `id, name, description, version, apiVersion, settingsVersion, enabledByDefault, settings, kind` + เฉพาะ `kind: ui` ได้ `system, entry, order`
- id: ≤128 ตัว, regex `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$`; `apiVersion == 1`; `version` ต้องเป็น semver เต็ม `^\d+\.\d+\.\d+$` (ใช้ในชื่อ release dir)
- ปฏิเสธ `system: true` (แพ็กเกจ user ห้ามเป็น base), ปฏิเสธ id ที่ขึ้นต้น `org.devos.` (ปกป้อง base packages), ปฏิเสธ entry ที่ตรง reserved regex `^(?:react-gtk|core|extensions|updates|runtime|services|compat|config|shell|supervisor)(?:-|\.js$)`, ปฏิเสธ `store-install.json` ในแพ็กเกจ, `kind: ui` ต้องมีไฟล์ `dist/<entry>` จริง
- ขอบเขตตาม DevOs: tarball ≤ 32 MiB, แตกแล้ว ≤ 128 MiB, ≤ 4,000 entries, ทุก path ตรง `^extension(?:/[A-Za-z0-9._/-]*)?/?$`, ห้าม links/special files

**การติดตั้ง (มิเรอร์ `packages/extensions/store.ts` ทุกจุดสำคัญ):**
- DevOs data root: `--devos-data` → `$XDG_DATA_HOME/dev-os` → `~/.local/share/dev-os`
- ถือ `<devos>/extension-store/install.lock` แบบ create-exclusive เหมือน DevOs (ตั้งแต่ต้นจบจบ ลบเมื่อเสร็จ)
- key = `<version>-<sha256-12-hex>` โดย sha256 มาจากไฟล์ tar.gz ที่ดาวน์โหลด/อ่าน (ตรงกับ digest ที่ GitHub API ให้)
- แตก tar โดย strip `extension/` ลง staging ใน `releases/<id>/` แล้วเขียน `store-install.json` รูปแบบเดียวกับ DevOs (`{"key","id","version","repository","previous"}`, JSON 2-space + `\n`): `repository` = `owner/repo` ถ้าติดตั้งจาก URL github.com, ไม่งั้น `"local/cli"` (ผ่าน regex repoInput), `previous` = record เดิมถ้ามี extension id นี้อยู่แล้ว (ทำให้ rollback ฝั่ง Settings ใช้ได้ต่อ)
- reuse release dir เดิมถ้า `store-install.json` ในนั้นตรง key/id/repository (มิเรอร์ caching ของ DevOs)
- สลับ symlink `extensions/<id>` → absolute target แบบ atomic (temp symlink + rename); ถ้ามีของเดิมที่ไม่ใช่ symlink → error "An existing local package owns this extension ID"
- symlink ใช้ `std::os::unix::fs::symlink`; บน Windows ใช้ `symlink_dir` ถ้าได้ ไม่งั้น error ชัดเจน (extension รันบน Linux เท่านั้น) — tests ที่เกี่ยวกับ symlink gate `#[cfg(unix)]` ตาม pattern เดิมใน tests.rs

**ผูกกับ DevOsPM registry:** เพิ่ม schema 2 — top-level `"extensions": {<id>: {version, key, repository, bytes, files}}` (อ่าน schema 1 เดิมได้ อัปเกรดในหน่วยความจำ) เพื่อให้ `dev list` / `dev info <id>` / `dev verify` เห็นและตรวจ integrity ได้

**remove/rollback:** `dev remove <id>` ลบ symlink เท่านั้น เก็บ releases + preferences ไว้เหมือน uninstall ของ DevOs (มี `--purge` ให้ลบ `releases/<id>` ด้วย); `dev rollback <id>` สลับผ่าน `previous` ใน store-install.json แล้วสลับ previous กลับ

**หมายเหตุที่จะเขียนใน README:** session ที่เปิดอยู่ไม่เห็น extension ใหม่ (ต้อง restart session เหมือน Store เอง) และ CLI จะไม่แก้ `repositories.json` เพื่อหลีกเลี่ยงการทับของ Store UI ที่กำลังรันอยู่

## 2. Launcher .desktop — ไฟล์ใหม่ `src/desktop.rs`

- ไดเรกทอรี: `--applications` → `$XDG_DATA_HOME/applications` → `~/.local/share/applications`
- ชื่อไฟล์ `dev-<command>.desktop` (คำสั่ง unique ทั้ง store อยู่แล้วจากกฎ collision)
- เนื้อหา: `Type=Application`, `Name=<fullname||shortname||command>`, `Comment=<description>`, `Exec=<quoted abs path ของ dev จาก current_exe (fallback `dev`)> run <command>`, `Icon=<abs path ของ icon ในแพ็กเกจ>` เมื่อมี, `Terminal=false` + escaping อักขระควบคุม
- เขียนหลัง install commit สำเร็จ, ลบตอน remove, เขียนใหม่ตอน rollback; มี `--no-desktop` บน `dev install` สำหรับเครื่อง headless; ทำเฉพาะ `kind: app`
- ทำงานข้ามแพลตฟอร์ฟอร์ม (เขียนไฟล์ธรรมดา) → test ได้บน Windows ด้วย

## 3. `dev update` — ไฟล์ใหม่ `src/update.rs`

- `dev update [names...]` (ไม่ระบุ = ทุกแพ็กเกจที่ตั้ง `repository.release` ไว้ + extension ที่มี github repo)
- ต่อ `GET {api}/repos/<owner/repo>/releases/latest` (base URL จาก env `DEV_UPDATE_API`, default `https://api.github.com`) header `User-Agent` + `Accept: application/vnd.github+json` — ใช้ reqwest blocking ที่เป็น dependency อยู่แล้ว
- ตรวจตามแบบฝั่ง DevOs updates: ปฏิเสธ draft/prerelease, asset ต้อง `state=uploaded` + มี `digest: sha256:<64hex>` + `browser_download_url` ตรง `https://github.com/<repo>/releases/download/<tag>/<name>`
- เลือก asset จาก template `filename` ใน release config (แทน `{name}`,`{version}` จาก tag ที่ strip `v` เติม suffix `.dpk`/`.tar.gz`); extension ใช้ `dev-os-extension.tar.gz` + `extension.json`
- เทียบ semver: ใหม่กว่าเดิมเท่านั้นถ้าอ่านได้ทั้งคู่ ไม่งั้นอัปเดตเมื่อต่างกัน; ข้ามพร้อมข้อความ "up to date"
- ดาวน์โหลดผ่าน `download::resolve` เดิม แล้ว install ด้วย `--sha256 <digest> --replace` (ได้ .desktop ใหม่อัตโนมัติจากข้อ 2)
- exit code 1 ถ้ามีรายการใดล้มเหลว, ข้ามรายการที่ config ไม่ครบด้วยข้อความ ไม่ถือเป็น error

## 4. เชื่อม CLI (`src/main.rs`)

- Subcommand ใหม่ `Update`, global option `--devos-data <dir>`, `--applications <dir>` (ใช้ทดสอบ/override เหมือน `--root`), flag `--no-desktop` บน Install, `--purge` บน Remove
- `dev list` แสดงส่วน extensions, `dev list --json` รวม `extensions`, `dev info` รองรับ extension id

## 5. Tests

- **ข้ามแพลตฟอร์ม (วิ่งบน Windows ด้วย):** ตาราง validate `extension.json` (id เสีย/system:true/entry ผิด/ขาด dist/apiVersion ผิด/unknown key), การตรวจจับแพ็กเกจ extension vs dpk vs ผสม, เนื้อหา .desktop/ลบไฟล์ตอน remove/`--no-desktop`, unit ของ update (asset matching, semver compare, ปฏิเสธ draft/prerelease/digest ขาด) จาก JSON fixture
- **`#[cfg(unix)]`:** install extension เต็ม flow (staging→release dir→symlink→store-install.json รูปแบบ `^\d+\.\d+\.\d+-[a-f0-9]{12}$` → previous chain เมื่อ install รุ่นที่สอง → rollback → remove), install.lock ป้องกันซ้อน, cache reuse, ปฏิเสธ id ที่ `org.devos.` / system:true
- **`scripts/smoke_linux.py`:** เพิ่ม scenario สร้าง `dev-os-extension.tar.gz` ด้วย tarfile ของ Python แล้ว install ตรวจ symlink + layout + ลบทิ้ง, ตรวจ .desktop โผล่ใน XDG applications dir, และ flow `dev update` ผ่าน local HTTP server ที่ให้ JSON รูป GitHub + asset (ใช้ `DEV_UPDATE_API`)

## 6. เอกสาร/เวอร์ชัน

- `Cargo.toml` 0.3.14 → **0.4.0**, `README.md` เพิ่มหมัด "เชื่อมกับ Dev OS desktop" (extension layout + ต้อง restart session + ข้อจำกัด symlink บน Windows), ส่วน Launcher, ส่วน `dev update` พร้อมลบประโยค "ยังไม่มี dev update" ทั้งสองจุด, เอกสาร flags ใหม่

## ลำดับทำงาน

1. manager.rs: registry schema 2 + `Manager::open` รับพารามิเตอร์ devos-data/applications
2. `src/devos.rs` + แขนง install
3. `src/desktop.rs` + hooks ใน install/remove/rollback
4. `src/update.rs` + คำสั่ง Update
5. main.rs เชื่อมทุกอย่าง
6. tests + smoke_linux.py
7. README + Cargo.toml

## การตรวจสอบ

- `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked`, `cargo build --release --locked` บนเครื่องนี้ (tests ที่ gate unix จะข้าม)
- ถ้ามี WSL: รัน `cargo test` + `python3 scripts/smoke_linux.py` ใน WSL เพื่อครอบคลุม symlink/full-flow บน Linux จริง

## สิ่งที่จะไม่ทำ (กัน scope บวม)

- ไม่ย้าย store เดิมจาก `~/.local/share/devos` เป็น `dev-os` (เสี่ยง migration ไม่มีประโยชน์เชิงหน้าที่)
- ไม่แตะ `repositories.json` ของ Store (กันการทับ state ของ session ที่กำลังรัน)
- ไม่ทำ dependency resolver / install hooks ตามที่ README ระบุว่ายังไม่มี