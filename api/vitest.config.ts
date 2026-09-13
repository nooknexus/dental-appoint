import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // integration tests ใช้ MySQL ตัวจริงและแก้ system_settings ร่วมกัน — ห้ามรันไฟล์ขนานกัน
    // (เคยเจอ deadlock, FK error และ booking_flow เปลี่ยนกลางคันเมื่อ vitest เริ่มสองไฟล์พร้อมกัน)
    fileParallelism: false,
  },
});
