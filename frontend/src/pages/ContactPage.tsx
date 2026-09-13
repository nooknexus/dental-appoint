import { CalendarDays, Clock3, MapPin, MessageCircle, Phone, Share2, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import { PageIntro } from '../components/PageIntro';
import { contactPlaceholders, faqs } from '../data/site';
import { clinicHoursLabel, useClinicTypes } from '../data/clinicSchedule';

type ContactItem = { icon: LucideIcon; label: string; value: string; href?: string };

const contactItems: ContactItem[] = [
  { icon: MapPin, label: 'ที่อยู่', value: contactPlaceholders.address },
  { icon: Phone, label: 'โทรศัพท์', value: contactPlaceholders.phone, href: `tel:${contactPlaceholders.phone.replaceAll('-', '')}` },
  { icon: MessageCircle, label: 'LINE', value: contactPlaceholders.line },
  { icon: Share2, label: 'Facebook', value: contactPlaceholders.facebook, href: 'https://www.facebook.com/profile.php?id=61593621128540' },
];

export function ContactPage() {
  const clinicTypes = useClinicTypes();
  const items = [...contactItems, { icon: Clock3, label: 'เวลาให้บริการ', value: clinicHoursLabel(clinicTypes) }];
  return (
    <>
      <PageIntro
        description="ช่องทางติดต่ออย่างเป็นทางการและเวลาให้บริการจะประกาศในหน้านี้เมื่อข้อมูลพร้อมใช้งาน"
        eyebrow="ติดต่อเรา"
        title="เตรียมข้อมูลก่อนเข้ารับบริการ"
      />
      <section className="section" aria-labelledby="contact-info-title">
        <div className="container contact-page-grid">
          <div>
            <p className="eyebrow">ข้อมูลติดต่อ</p>
            <h2 id="contact-info-title">ช่องทางของคลินิก</h2>
            <div className="contact-cards">
              {items.map(({ icon: Icon, label, value, href }) => (
                <article className="contact-card" key={label}>
                  <Icon aria-hidden="true" size={24} strokeWidth={1.65} />
                  <div>
                    <h3>{label}</h3>
                    {href ? <a href={href} rel={href.startsWith('https://') ? 'noreferrer' : undefined} target={href.startsWith('https://') ? '_blank' : undefined}>{value}</a> : <p>{value}</p>}
                  </div>
                </article>
              ))}
            </div>
          </div>
          <aside className="contact-map" aria-labelledby="clinic-map-title">
            <h2 id="clinic-map-title">แผนที่ตั้งคลินิก</h2>
            <iframe
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              sandbox="allow-scripts allow-same-origin"
              src="https://www.google.com/maps?q=16.8170326,100.2609722&z=17&output=embed"
              title="แผนที่ตั้งคลินิก"
            />
          </aside>
        </div>
      </section>
      <section className="section section--soft" aria-labelledby="faq-title">
        <div className="container faq-page-grid">
          <div>
            <p className="eyebrow">คำถามที่พบบ่อย</p>
            <h2 id="faq-title">ก่อนส่งคำขอนัดหมาย</h2>
            <p className="section-copy">เราแนะนำให้ระบุข้อมูลที่จำเป็นให้ครบ เพื่อให้เจ้าหน้าที่ประสานกลับได้สะดวก</p>
          </div>
          <div className="faq-list faq-list--large">
            {faqs.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container inline-cta">
          <div>
            <h2>ต้องการนัดหมายล่วงหน้า?</h2>
            <p>กรอกแบบฟอร์มโดยเลือกบริการและช่วงเวลาที่สะดวก แล้วรอการยืนยันจากเจ้าหน้าที่</p>
          </div>
          <Link className="button" to="/appointment">จองคิวทันตกรรม <CalendarDays aria-hidden="true" size={18} /></Link>
        </div>
      </section>
    </>
  );
}
