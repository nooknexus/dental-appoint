import { Building2, Clock3, MapPin, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';

import desktopLogo from '../assets/logos/logo_web.png';
import mobileLogo from '../assets/logos/logo_web700.png';
import { clinicName, contactPlaceholders } from '../data/site';
import { clinicHoursLabel, useClinicTypes } from '../data/clinicSchedule';

export function SiteFooter() {
  const clinicTypes = useClinicTypes();
  return (
    <footer className="site-footer">
      <div className="container site-footer__grid">
        <section aria-label="ข้อมูลคลินิก" className="site-footer__identity">
          <div className="site-footer__brand-row">
            <picture className="site-footer__logo-picture">
              <source media="(max-width: 620px)" srcSet={mobileLogo} />
              <img alt="ตราสัญลักษณ์ สาสุข พรีเมียม Dental Clinic" className="site-footer__logo" src={desktopLogo} />
            </picture>
            <div>
              <p className="site-footer__name">สาสุข พรีเมียม</p>
              <p className="site-footer__clinic">Dental Clinic</p>
            </div>
          </div>
          <p>
            คลินิกทันตกรรม สำนักงานสาธารณสุขจังหวัดพิษณุโลก
          </p>
        </section>

        <section aria-labelledby="footer-links-title">
          <h2 id="footer-links-title">เมนู</h2>
          <nav className="footer-links" aria-label="เมนูส่วนท้าย">
            <Link to="/services">บริการทันตกรรม</Link>
            <Link to="/team">ทีมของเรา</Link>
            <Link to="/about">เกี่ยวกับคลินิก</Link>
            <Link to="/appointment">จองคิวทันตกรรม</Link>
          </nav>
        </section>

        <section aria-labelledby="footer-contact-title">
          <h2 id="footer-contact-title">ข้อมูลติดต่อ</h2>
          <ul className="footer-contact-list">
            <li><MapPin aria-hidden="true" size={18} />{contactPlaceholders.address}</li>
            <li><Phone aria-hidden="true" size={18} />{contactPlaceholders.phone}</li>
            <li><Clock3 aria-hidden="true" size={18} />{clinicHoursLabel(clinicTypes)}</li>
          </ul>
        </section>

        <section aria-label="ตราสัญลักษณ์หน่วยงาน" className="site-footer__institution">
          <Building2 aria-hidden="true" size={20} />
          <p className="site-footer__institution-name">สำนักงานสาธารณสุขจังหวัดพิษณุโลก</p>
        </section>
      </div>
      <div className="container site-footer__bottom">
        <p>© {new Date().getFullYear()} {clinicName} — สำนักงานสาธารณสุขจังหวัดพิษณุโลก</p>
        <p>ข้อมูลบริการและช่องทางติดต่ออยู่ระหว่างการอัปเดต</p>
      </div>
    </footer>
  );
}
