Dev OS Package Manager สำหรับ Linux ใช้คำสั่ง `dev` ติดตั้ง `.dpk`, `.dpkx` และ `.tar.gz` จากไฟล์หรือ HTTP(S) URL

### ใหม่ในรุ่นนี้: `dev self-update`

```sh
dev self-update
```

- อัปเดตตัว `dev` เองจาก release ล่าสุดของ `d-osc/DevOsPM` โดยเลือกไบนารี static ตามสถาปัตยกรรมปัจจุบัน (`dev-linux-x86_64` หรือ `dev-linux-arm64`)
- ตรวจ SHA-256 กับ digest จาก GitHub API ระหว่างดาวน์โหลด, **ทดสอบรันไบนารีใหม่ด้วย `--version` ก่อน** ว่ารายงานรุ่นถูกต้อง แล้วจึงแทนที่ไฟล์ที่รันอยู่ด้วย atomic rename — ถ้ารุ่นปัจจุบันใหม่กว่าหรือเท่ากันจะแจ้ง up to date และไม่แตะไฟล์
- ไม่ถือ lock ของ package store จึงรันคู่กับคำสั่งอื่นได้ หมายเหตุ: รุ่น 0.4.0 ยังไม่มีคำสั่งนี้ ผู้ใช้ 0.4.0 ติดตั้งรุ่นนี้ด้วย curl/install.sh หนึ่งครั้ง แล้วอัปเดตเป็นรุ่นถัดไปผ่าน `dev self-update` ได้เลย

รวมทุกอย่างจาก 0.4.0: ติดตั้ง extension ของ Dev OS Extension Store ลง layout จริงของ desktop, รายการ `.desktop` ให้ Launcher, `dev update` สำหรับแพ็กเกจ/extension และการรับชื่อไฟล์ `.dpk`/`.dpkx`/`.tar.gz`

ไฟล์ดาวน์โหลด:
- `dev-linux-x86_64`, `dev-linux-arm64`: ไบนารี static musl สำหรับ Linux x86_64 และ arm64
- `dev-linux-x86_64.tar.gz`, `dev-linux-arm64.tar.gz`: ไบนารี `dev`, ตัวติดตั้ง และเอกสาร
- `hello-1.0.0.dpk`, `hello-1.0.0.tar.gz`, `greeting-extension-1.0.0.dpk`: แพ็กเกจตัวอย่าง
- `SHA256SUMS`: checksum ของไฟล์ดาวน์โหลด

ติดตั้งไบนารี:
```sh
case "$(uname -m)" in aarch64) ARCH=arm64;; *) ARCH=x86_64;; esac
curl -fL "https://github.com/d-osc/DevOsPM/releases/latest/download/dev-linux-$ARCH" -o dev
chmod +x dev
mkdir -p "$HOME/.local/bin"
install -m 755 dev "$HOME/.local/bin/dev"
export PATH="$HOME/.local/bin:$PATH"
dev --version
```

ตรวจ checksum ของไฟล์ที่ดาวน์โหลดด้วย `sha256sum --ignore-missing -c SHA256SUMS`

ทดสอบก่อนเผยแพร่: unit tests 55 กรณีผ่านบน Linux musl ทั้ง aarch64 (รันชุดทดสอนจริง) และ x86_64 (build ด้วย cargo-zigbuild) พร้อม CLI/URL-install smoke tests ครอบคลุม extension ของ Dev OS, launcher entries, URL นามสกุล `.dpkx`, `dev update` และ `dev self-update` ผ่าน API mirror ในเครื่อง

**Full Changelog**: https://github.com/d-osc/DevOsPM/compare/v0.4.0...v0.5.0
