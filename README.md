# Eisenhower Board

เว็บแอปจัดการงานส่วนตัวที่โฮสต์ได้เอง สร้างบนหลักการ Eisenhower Matrix — กรอบการตัดสินใจที่แบ่งงานตามความเร่งด่วนและความสำคัญ เหมาะสำหรับผู้ที่ต้องการควบคุมข้อมูลของตนเองโดยไม่พึ่งบริการคลาวด์ภายนอก

---

## ภาพรวม

แอปจะแบ่งทุกงานออกเป็น 4 ช่อง ดังนี้

| ช่อง | ชื่อ | แนวทางการรับมือ |
|---|---|---|
| เร่งด่วน + สำคัญ | ทำทันที | ลงมือทำเลย |
| ไม่เร่งด่วน + สำคัญ | วางแผนทำ | กำหนดเวลาและทำให้เสร็จ |
| เร่งด่วน + ไม่สำคัญ | มอบหมาย | ส่งต่อให้คนอื่น |
| ไม่เร่งด่วน + ไม่สำคัญ | ทำทีหลัง | ตัดทิ้งหรือเลื่อนออกไป |

---

## คุณสมบัติ

### หลัก

- บอร์ด Eisenhower Matrix 4 ช่อง พร้อมระบบลากวางงาน
- แผงบันทึกด่วนสำหรับจดความคิดก่อนจัดหมวดหมู่
- กำหนดวันที่สิ้นสุด — เก็บเป็น UTC โดยถือว่ากำหนดส่งคือสิ้นสุดวันนั้น และแสดงตามเวลาท้องถิ่น
- ธีมสว่างและมืด พร้อมตรวจจับค่าที่ตั้งไว้ในระบบปฏิบัติการโดยอัตโนมัติ

### ความปลอดภัย

- เก็บ Session ใน SQLite และยกเลิก Session ทั้งหมดทันทีเมื่อเปลี่ยนรหัสผ่าน
- เข้ารหัส Telegram Bot Token ด้วย AES-256-GCM ก่อนบันทึกลงดิสก์
- Security headers, same-origin protection และ Rate limiting ที่ปรับค่าได้
- Setup token สำหรับป้องกันการยึดบัญชีระหว่างการตั้งค่าครั้งแรก

### Google Login

- เชื่อมต่อ Google Identity Services (OAuth 2.0) แบบเลือกเปิดใช้
- จำกัดสิทธิ์เข้าใช้งานเฉพาะอีเมล Google ที่อนุญาตไว้
- เชื่อมบัญชี Google กับบัญชีท้องถิ่นที่มีอยู่แล้วได้จากหน้าตั้งค่า

### การแจ้งเตือน

- ส่งสรุปงานประจำวันผ่าน Telegram Bot
- Scheduler มีระบบ claim-lock ป้องกันการส่งซ้ำเมื่อมีหลาย instance รันพร้อมกัน

### ความเสถียร

- Integration test อัตโนมัติด้วย Node.js built-in test runner
- CI pipeline ผ่าน GitHub Actions และอัปเดต Dependency อัตโนมัติด้วย Dependabot
- Docker health check ที่ endpoint `/api/health`

### ส่วนติดต่อผู้ใช้

- ดีไซน์แบบ Neumorphism
- รองรับทุกขนาดหน้าจอ — desktop, tablet และ mobile
- รองรับการใช้งานด้วยแป้นพิมพ์อย่างครบถ้วน

---

## เทคโนโลยีที่ใช้

| ชั้น | เทคโนโลยี |
|---|---|
| Runtime | Node.js >= 20 |
| Framework | Express |
| ฐานข้อมูล | SQLite ผ่าน `better-sqlite3` |
| Frontend | HTML / CSS / JavaScript แบบ plain — ไม่ต้อง build |
| Container | Docker / Docker Compose |

---


## โครงสร้างโปรเจกต์

```
eisenhower-board/
├── src/              # โมดูลฝั่งเซิร์ฟเวอร์ (routes, auth, scheduler และอื่น ๆ)
├── public/           # ไฟล์ static frontend (HTML, CSS, JavaScript)
├── test/             # Integration tests
├── data/             # ไฟล์ฐานข้อมูล SQLite (สร้างตอน runtime, mount เป็น volume ใน Docker)
├── server.js         # จุดเริ่มต้นของแอปพลิเคชัน
├── Dockerfile
├── docker-compose.yml
└── .env.example      # ตัวอย่าง environment variables
```

---
