# Dev OS บน Windows ARM64 / WSLg

ใช้ Ubuntu WSL2 ชื่อ `Ubuntu` และ WSLg เช่นเดียวกับ x64 ตัว runtime เป็น GJS/GTK ส่วน window tracker และ private labwc ต้องคอมไพล์บน Linux สถาปัตยกรรมเดียวกับ distro

## เตรียมเครื่องใหม่

ใน PowerShell ที่โฟลเดอร์ checkout:

```powershell
wsl -l -v
wsl -d Ubuntu -- uname -m
wsl -d Ubuntu
```

ผล `uname -m` สำหรับ Snapdragon ต้องเป็น `aarch64` ภายใน Ubuntu ไปที่ checkout ผ่าน `/mnt/c/...` แล้วติดตั้ง dependencies และสร้าง private compositor:

```sh
sudo sh tools/setup/install-wsl-dependencies.sh
sh tools/setup/bootstrap-wsl.sh
```

Compositor gesture integration ใช้ DevLang: ติดตั้ง `d` (linux-arm64) ไว้ที่
`~/.local/bin/d` ก่อนรัน bootstrap เช่น

```sh
curl -sL -O https://github.com/d-osc/DevLang/releases/latest/download/devlang-d-v0.5.5-linux-arm64.tar.gz
tar -xzf devlang-d-v0.5.5-linux-arm64.tar.gz
mkdir -p ~/.local/bin
cp devlang-d-v0.5.5-linux-arm64/d ~/.local/bin/
```

กลับ PowerShell ใช้ Node.js 24+ และ npm:

```powershell
npm ci
.\dev.ps1 build
.\dev.ps1 doctor
.\dev.ps1 run
```

`run` เปิด desktop แบบ nested ผ่าน WSLg โดยใช้ pixman และเตรียม runtime บน Linux filesystem ก่อนเริ่ม session ไม่จำเป็นต้องเปลี่ยน default distribution จาก docker-desktop

## ส่วนรองรับ ARM64

### Google Chrome

ติดตั้ง Chrome Linux รุ่นตรงกับ ARM64/x64 จาก Google (เป็นส่วนเสริม ไม่รวมใน base dependencies):

```sh
sudo sh tools/setup/bootstrap-chrome.sh
```

เปิด Dev OS Launcher แล้วค้นหา `Chrome` ตัว desktop entry ของ Dev OS ระบุ Wayland เพื่อให้หน้าต่างอยู่ภายใน Dev OS nested compositor เปิดหลายแท็บ ดาวน์โหลด และใช้โปรไฟล์ Linux แยกจาก Chrome บน Windows ได้ โดยไม่ต้องปิด browser sandbox

- Private VTE ใช้ `aarch64-linux-gnu` บน ARM64 และ `x86_64-linux-gnu` บน x64 รวมการสลับไป runtime ที่ติดตั้งจาก release
- Ubuntu 24.04 คง swaylock package pin เดิม ส่วน Ubuntu ใหม่ใช้แพ็กเกจและ PAM ของ distro โดยไม่ downgrade ไปแพ็กเกจ 24.04
- Private labwc 0.7.1 ใช้ wlroots 0.17 จาก subproject แทน wlroots รุ่นใหม่ของ distro และแสดง compiler warnings โดยไม่ทำให้ compatibility build ล้มเหลว
- Release workflow สร้าง `dev-os-linux-arm64.tar.gz` แยกจาก x64 แล้วรวม SHA256SUMS ก่อนเผยแพร่ การแก้ workflow ใน checkout ไม่ได้เผยแพร่ release โดยอัตโนมัติ

## ขอบเขตฮาร์ดแวร์

Windows จัดการจอ input Wi-Fi และพลังงาน ส่วน Dev OS ใช้ compositor แบบ nested, input และเสียงผ่าน WSLg ไม่ได้ติดตั้ง Snapdragon kernel driver หรือบูต Linux บนเครื่องจริง

บน ASUS UX3407NA / X2E88100 ที่ตรวจ 16 ตุลาคม 2026: Ubuntu 26.04.1 ARM64, WSL 3.0.3 และ kernel 6.18.54.1; `glxinfo -B` รายงาน llvmpipe / Accelerated: no และ PulseAudio เชื่อม WSLg ได้ โหมด pixman จึงเป็นฐานที่ใช้ได้โดยไม่อ้างว่ามี Adreno hardware acceleration

Lock ใน Dev OS ล็อกเฉพาะ compositor ของ Dev OS ใน WSLg ใช้ Win+L เมื่อต้องการล็อก Windows ทั้งเครื่อง

## ตรวจสอบ

```powershell
.\dev.ps1 check
.\dev.ps1 smoke
```

สำหรับ regression ของ private VTE บนทั้ง ARM64/x64:

```sh
python3 tests/runtime-env.test.py
d tools/test/runtime-env-test.dev --
```

การทดสอบแบบ headless ตรวจ session/keyboard/apps และการปิด session ส่วนการแสดงผลบน Windows ต้องตรวจ nested WSLg เพิ่มเติม
