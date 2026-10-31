Dev OS Package Manager สำหรับ Linux ใช้คำสั่ง `dev` ติดตั้ง `.dpk`, `.dpkx` และ `.tar.gz` จากไฟล์หรือ HTTP(S) URL

### เชื่อมกับ Dev OS desktop

- ติดตั้งแพ็กเกจ extension ของ Extension Store จาก CLI ลง layout จริงของ desktop (release directories + `store-install.json` + symlink ที่ `extensions/<id>`) — เปิด session ใหม่ของ Dev OS แล้วโหลดได้เลย และหน้า Settings → Extension Store ยัง update/rollback ต่อได้เพราะใช้ format เดียวกัน
- แอป `kind: app` ได้ไฟล์ `.desktop` ใน `~/.local/share/applications` อัตโนมัติ ทำให้แอปโผล่ใน Launcher และ panel ของ Dev OS ทันที (`--no-desktop` เพื่อปิด)
- `dev update` ตรวจรุ่นล่าสุดจาก GitHub Releases ตาม `repository.release`, ปฏิเสธ draft/prerelease, ตรวจ SHA-256 กับ digest จาก API แล้วติดตั้งแทนรุ่นเดิมแบบทรานแซกชัน
- แพ็กเกจ extension รับได้ทั้งชื่อไฟล์ `.dpk`, `.dpkx` และ `.tar.gz` เพราะตรวจชนิดแพ็กเกจจากเนื้อหาใน tar

### อื่น ๆ

- registry schema 2 เก็บประวัติ extension (อ่าน store เดิม schema 1 ได้), `dev list`/`info`/`verify`/`rollback`/`remove --purge` รองรับ extension ทั้งหมด
- แชร์ระบบตรวจ archive, path traversal, checksum และ symlink ชุดเดียวกันทั้งแพ็กเกจและ extension

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

ทดสอบก่อนเผยแพร่: unit tests 54 กรณีผ่านบน Linux musl ทั้ง aarch64 (รันชุดทดสอนจริง) และ x86_64 (build ด้วย cargo-zigbuild) พร้อม CLI/URL-install smoke tests ที่ครอบคลุม extension ของ Dev OS, launcher entries, URL นามสกุล `.dpkx` และ `dev update` ผ่าน API mirror ในเครื่อง

**Full Changelog**: https://github.com/d-osc/DevOsPM/compare/v0.3.14...v0.4.0
