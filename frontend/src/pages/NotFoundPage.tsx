import { ArrowLeft, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="not-found">
      <div className="container not-found__content">
        <SearchX aria-hidden="true" size={52} strokeWidth={1.35} />
        <p className="eyebrow">404</p>
        <h1>ไม่พบหน้าที่คุณต้องการ</h1>
        <p>ลิงก์นี้อาจเปลี่ยนแปลง หรือหน้าที่คุณกำลังมองหาอาจยังไม่พร้อมใช้งาน</p>
        <Link className="button" to="/"><ArrowLeft aria-hidden="true" size={18} /> กลับหน้าหลัก</Link>
      </div>
    </section>
  );
}
