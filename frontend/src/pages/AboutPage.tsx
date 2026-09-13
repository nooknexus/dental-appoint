import { CheckCircle2, Compass, HeartHandshake, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

import { PageIntro } from '../components/PageIntro';

const values = [
  {
    icon: HeartHandshake,
    title: 'ฟังอย่างเข้าใจ',
    description: 'เริ่มต้นจากความกังวล เป้าหมาย และบริบทของผู้รับบริการแต่ละคน',
  },
  {
    icon: ShieldCheck,
    title: 'ดูแลอย่างรอบคอบ',
    description: 'ให้ความสำคัญกับการอธิบายข้อมูลและขั้นตอนที่เหมาะสมก่อนตัดสินใจ',
  },
  {
    icon: Compass,
    title: 'วางแผนอย่างชัดเจน',
    description: 'ช่วยให้เห็นทางเลือกและลำดับการดูแลสุขภาพช่องปากได้เป็นระบบ',
  },
];

export function AboutPage() {
  return (
    <>
      <PageIntro
        description="สาสุข พรีเมียม Dental Clinic ตั้งใจเป็นพื้นที่สำหรับการดูแลสุขภาพช่องปากที่สื่อสารตรงไปตรงมาและให้เกียรติการตัดสินใจของคุณ"
        eyebrow="เกี่ยวกับคลินิก"
        title="มาตรฐานและความใส่ใจในทุกการดูแล"
      />
      <section className="section" aria-labelledby="approach-title">
        <div className="container about-page-grid">
          <div className="about-page-grid__statement">
            <p className="eyebrow">แนวทางของเรา</p>
            <h2 id="approach-title">การดูแลที่ดี ไม่ควรเริ่มด้วยความเร่งรีบ</h2>
            <p>
              เราเชื่อว่าความมั่นใจเกิดจากการได้รับข้อมูลที่เพียงพอ จึงให้ความสำคัญกับการพูดคุย ตรวจประเมิน และอธิบายทางเลือกก่อนร่วมกันวางแผนดูแล
            </p>
            <ul className="check-list">
              <li><CheckCircle2 aria-hidden="true" size={20} />รับฟังข้อกังวลก่อนเริ่มต้น</li>
              <li><CheckCircle2 aria-hidden="true" size={20} />อธิบายข้อมูลด้วยภาษาที่เข้าใจง่าย</li>
              <li><CheckCircle2 aria-hidden="true" size={20} />สนับสนุนการตัดสินใจที่เหมาะกับคุณ</li>
            </ul>
          </div>
          <div className="about-page-grid__panel">
            <span aria-hidden="true">S</span>
            <p>สุขภาพช่องปากที่ดี เริ่มจากการดูแลที่เหมาะกับแต่ละคน</p>
          </div>
        </div>
      </section>
      <section className="section section--soft" aria-labelledby="values-title">
        <div className="container">
          <div className="section-heading section-heading--stacked">
            <div>
              <p className="eyebrow">สิ่งที่เราให้ความสำคัญ</p>
              <h2 id="values-title">หลักคิดในการดูแลผู้รับบริการ</h2>
            </div>
          </div>
          <div className="value-grid">
            {values.map(({ icon: Icon, title, description }) => (
              <article className="value-card" key={title}>
                <Icon aria-hidden="true" size={31} strokeWidth={1.55} />
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container inline-cta">
          <div>
            <h2>พร้อมเริ่มต้นพูดคุยเรื่องสุขภาพช่องปาก?</h2>
            <p>ส่งคำขอนัดหมายล่วงหน้าเพื่อให้ทีมงานติดต่อกลับและยืนยันรายละเอียด</p>
          </div>
          <Link className="button" to="/appointment">จองคิวทันตกรรม</Link>
        </div>
      </section>
    </>
  );
}
