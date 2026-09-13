import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // พร็อกซี /api ไปที่ Express (:3001) เพื่อให้ทุก fetch เป็น same-origin — cookie ของ session
    // (ล็อกอินผู้ป่วยด้วยหมอพร้อม) เดินทางอัตโนมัติตาม default credentials policy ของ browser
    proxy: { '/api': 'http://localhost:3001' },
  },
});
