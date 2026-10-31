# Example App

ตัวอย่าง schema v2 เท่านั้น URL, checksum, ขนาดไฟล์, image ID และสถานะ verified เป็น fixture สมมติ ไม่ใช่ release จริง ไม่มี binary แนบมา และห้ามเพิ่มลง production index

`releases[].artifacts[].package` แสดง expected PM package manifest แยกจาก metadata ของ registry ใช้ format dpk (tar+gzip), Linux ARM64 และ backend devospm/user ส่วนชื่อและไอคอน launcher มาจาก fullname/shortname/icon/bin ตาม PM จริง
