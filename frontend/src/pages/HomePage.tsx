import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  HeartPulse,
  MessageCircle,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import clinicExterior from '../assets/images/clinic-exterior-hero-v1.png';
import desktopLogo from '../assets/logos/logo_web.png';
import mobileLogo from '../assets/logos/logo_web700.png';
import { PublicServiceCard } from '../components/PublicServiceCard';
import { clinicHoursRows, useClinicTypes } from '../data/clinicSchedule';
import { contactPlaceholders, faqs } from '../data/site';
import { useTeamDirectory } from '../data/teamDirectory';
import { usePublicServices } from '../services/publicServices';

const trustHighlights = [
  {
    icon: ShieldCheck,
    title: 'มาตรฐานการบริการ',
    description: 'ดูแลตามมาตรฐานทางทันตกรรม',
  },
  {
    icon: HeartPulse,
    title: 'ใส่ใจทุกขั้นตอน',
    description: 'ให้ความสำคัญกับผู้รับบริการ',
  },
  {
    icon: ClipboardCheck,
    title: 'ทีมทันตบุคลากร',
    description: 'พร้อมดูแลและให้คำแนะนำด้านสุขภาพช่องปาก',
  },
];

const carePrinciples = [
  'รับฟังความกังวลก่อนเริ่มทุกขั้นตอน',
  'สื่อสารข้อมูลสุขภาพช่องปากด้วยภาษาที่เข้าใจง่าย',
  'ร่วมวางแผนการดูแลตามความเหมาะสมของแต่ละคน',
];

export function HomePage() {
  const serviceRegistry = usePublicServices();
  const clinicTypes = useClinicTypes();
  const serviceHours = clinicHoursRows(clinicTypes);
  const teamDirectory = useTeamDirectory();

  return (
    <>
      <section className="hero">
        <div className="hero__orb hero__orb--one" aria-hidden="true" />
        <div className="hero__orb hero__orb--two" aria-hidden="true" />
        <div className="container hero__grid">
          <div className="hero__copy">
            <p className="eyebrow eyebrow--light">สาสุข พรีเมียม Dental Clinic</p>
            <h1>ดูแลทุกรอยยิ้มด้วยมาตรฐานและความใส่ใจ</h1>
            <p className="hero__lead">
              คลินิกทันตกรรม สำนักงานสาธารณสุขจังหวัดพิษณุโลก พร้อมให้บริการด้านสุขภาพช่องปาก
              โดยทีมทันตบุคลากร ภายใต้มาตรฐานการบริการที่ให้ความสำคัญกับผู้รับบริการ
            </p>
            <div className="hero__actions">
              <Link className="button button--gold" to="/appointment">
                จองคิวทันตกรรม <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <Link className="button button--ghost-light" to="/services">
                ดูบริการของเรา
              </Link>
            </div>
          </div>
          <div className="hero__visual">
            <div className="hero__visual-card">
              <img
                alt="ภาพอาคารคลินิก สาสุข พรีเมียม"
                className="hero__building-image"
                src={clinicExterior}
              />
              <div className="hero__visual-caption">
                <CheckCircle2 aria-hidden="true" size={21} />
                <span>ใส่ใจทุกขั้นตอนของการดูแล</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--overlap" aria-labelledby="trust-title">
        <div className="container">
          <div className="trust-grid">
            {trustHighlights.map(({ icon: Icon, title, description }) => (
              <article className="trust-card" key={title}>
                <Icon aria-hidden="true" size={28} strokeWidth={1.7} />
                <div>
                  <h2>{title}</h2>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
          <h2 className="sr-only" id="trust-title">เหตุผลที่ผู้รับบริการไว้วางใจ</h2>
        </div>
      </section>

      <section className="section home-hours" aria-labelledby="home-hours-title">
        <div className="container home-hours__grid">
          <div className="home-hours__heading">
            <p className="eyebrow">วางแผนเข้ารับบริการ</p>
            <h2 id="home-hours-title">เวลาให้บริการ</h2>
            <p>ตรวจสอบวันและเวลาให้บริการก่อนนัดหมาย</p>
          </div>
          <div className="home-hours__table-wrap">
            <table aria-label="เวลาให้บริการของแต่ละแผนก" className="home-hours__table">
              <thead>
                <tr>
                  <th scope="col">ช่วงให้บริการ</th>
                  <th scope="col">วัน</th>
                  <th scope="col">เวลา</th>
                </tr>
              </thead>
              <tbody>
                {serviceHours.map(({ department, days, hours }) => (
                  <tr key={`${department}-${days}`}>
                    <th scope="row">{department}</th>
                    <td>{days}</td>
                    <td>{hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="home-about-title">
        <div className="container about-snapshot">
          <div className="about-snapshot__visual">
            <div className="about-snapshot__circle" aria-hidden="true" />
            <picture className="about-snapshot__logo">
              <source media="(max-width: 620px)" srcSet={mobileLogo} />
              <img alt="ตราสัญลักษณ์ สาสุข พรีเมียม Dental Clinic" src={desktopLogo} />
            </picture>
          </div>
          <div className="about-snapshot__copy">
            <p className="eyebrow">เกี่ยวกับคลินิก</p>
            <h2 id="home-about-title">มากกว่าการรักษา คือการดูแลทุกรอยยิ้ม</h2>
            <p>
              สาสุข พรีเมียม Dental Clinic เป็นคลินิกทันตกรรมภายใต้สำนักงานสาธารณสุขจังหวัดพิษณุโลก
              มุ่งให้บริการด้านสุขภาพช่องปากภายใต้มาตรฐานวิชาชีพ พร้อมให้ความสำคัญกับคุณภาพการบริการและประสบการณ์ของผู้รับบริการ
            </p>
            <Link className="text-link" to="/about">
              รู้จักแนวทางของเรา <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </div>
        </div>
      </section>

      <section className="section section--soft" aria-labelledby="home-services-title">
        <div className="container">
          <div className="section-heading">
            <div>
              <p className="eyebrow">บริการทันตกรรม</p>
              <h2 id="home-services-title">ดูแลได้ตั้งแต่การตรวจสุขภาพจนถึงการวางแผนรักษา</h2>
            </div>
            <Link className="text-link" to="/services">
              บริการทั้งหมด <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </div>
          <div className="services-grid services-grid--preview">
            {serviceRegistry.status === 'loading' && <p>กำลังโหลดรายการบริการ...</p>}
            {serviceRegistry.status === 'error' && <p>ไม่สามารถโหลดรายการบริการได้ในขณะนี้</p>}
            {serviceRegistry.status === 'ready' && serviceRegistry.services.length === 0 && <p>ยังไม่มีบริการที่เปิดให้จองในขณะนี้</p>}
            {serviceRegistry.services.slice(0, 3).map((service) => (
              <PublicServiceCard key={service.id} service={service} />
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="why-title">
        <div className="container why-grid">
          <div>
            <p className="eyebrow">ทำไมต้องสาสุข พรีเมียม</p>
            <h2 id="why-title">การดูแลที่ดี คือการตัดสินใจร่วมกันบนข้อมูลที่เข้าใจตรงกัน</h2>
            <p className="section-copy">
              เราให้พื้นที่สำหรับคำถามของคุณ และช่วยอธิบายข้อมูลสุขภาพช่องปากอย่างเป็นลำดับ เพื่อให้คุณตัดสินใจได้อย่างมั่นใจ
            </p>
            <Link className="button button--outline" to="/appointment">
              เริ่มต้นนัดหมาย <CalendarDays aria-hidden="true" size={18} />
            </Link>
          </div>
          <ul className="principle-list">
            {carePrinciples.map((principle) => (
              <li key={principle}>
                <CheckCircle2 aria-hidden="true" size={22} />
                <span>{principle}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section section--soft" aria-labelledby="team-preview-title">
        <div className="container">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ทีมของเรา</p>
              <h2 id="team-preview-title">พร้อมดูแลทุกคำถามของคุณ</h2>
            </div>
            <Link className="text-link" to="/team">
              พบกับทีมของเรา <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </div>
          <div className="team-grid team-grid--preview">
            {teamDirectory.slice(0, 3).map((member, index) => (
              <article className="team-card" key={member.name}>
                <div className="team-card__avatar" aria-hidden="true">{index + 1}</div>
                <p className="team-card__role">{member.role}</p>
                <h3>{member.name}</h3>
                <p>{member.focus}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="appointment-cta-title">
        <div className="container appointment-cta">
          <div>
            <p className="eyebrow eyebrow--light">นัดหมายล่วงหน้า</p>
            <h2 id="appointment-cta-title">เริ่มต้นดูแลรอยยิ้มของคุณวันนี้</h2>
            <p>ส่งวันและช่วงเวลาที่สะดวก แล้วเจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันรายละเอียด</p>
          </div>
          <Link className="button button--gold" to="/appointment">
            จองคิวทันตกรรม <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="contact-preview-title">
        <div className="container contact-preview-grid">
          <div className="contact-preview">
            <p className="eyebrow">ติดต่อและคำถามที่พบบ่อย</p>
            <h2 id="contact-preview-title">ข้อมูลสำหรับการเตรียมตัวก่อนเข้ารับบริการ</h2>
            <p>{contactPlaceholders.hours}</p>
            <p>{contactPlaceholders.phone}</p>
            <Link className="text-link" to="/contact">
              ดูข้อมูลติดต่อ <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </div>
          <div className="faq-list">
            {faqs.slice(0, 2).map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <aside className="floating-contact" aria-label="ทางลัดการนัดหมาย">
        <Link to="/appointment"><CalendarDays aria-hidden="true" size={18} /> จองคิว</Link>
        <Link to="/contact"><MessageCircle aria-hidden="true" size={18} /> สอบถาม</Link>
        <Link to="/team"><UsersRound aria-hidden="true" size={18} /> ทีมเรา</Link>
      </aside>
    </>
  );
}
