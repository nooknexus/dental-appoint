import { CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';

import { PublicServiceCard } from '../components/PublicServiceCard';
import { PageIntro } from '../components/PageIntro';
import { usePublicServices } from '../services/publicServices';

export function ServicesPage() {
  const serviceRegistry = usePublicServices();

  return (
    <>
      <PageIntro
        description="สำรวจบริการสำหรับการดูแลสุขภาพช่องปากในแต่ละช่วง พร้อมข้อมูลเบื้องต้นเพื่อช่วยให้คุณเริ่มต้นได้อย่างมั่นใจ"
        eyebrow="บริการทันตกรรม"
        title="ดูแลสุขภาพช่องปากอย่างเป็นระบบ"
      />
      <section className="section" aria-label="รายการบริการทันตกรรม">
        <div className="container">
          <div className="services-grid">
            {serviceRegistry.status === 'loading' && <p>กำลังโหลดรายการบริการ...</p>}
            {serviceRegistry.status === 'error' && <p>ไม่สามารถโหลดรายการบริการได้ในขณะนี้</p>}
            {serviceRegistry.status === 'ready' && serviceRegistry.services.length === 0 && <p>ยังไม่มีบริการที่เปิดให้จองในขณะนี้</p>}
            {serviceRegistry.services.map((service) => (
              <PublicServiceCard key={service.id} service={service} />
            ))}
          </div>
        </div>
      </section>
      <section className="section section--soft">
        <div className="container inline-cta">
          <div>
            <h2>ยังไม่แน่ใจว่าควรเริ่มจากบริการใด?</h2>
            <p>สามารถเลือกนัดหมายเพื่อตรวจสุขภาพช่องปากหรือปรึกษาแผนการดูแลเบื้องต้นได้</p>
          </div>
          <Link className="button" to="/appointment">จองคิวทันตกรรม <CalendarDays aria-hidden="true" size={18} /></Link>
        </div>
      </section>
    </>
  );
}
