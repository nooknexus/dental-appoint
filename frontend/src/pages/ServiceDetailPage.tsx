import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { PageIntro } from '../components/PageIntro';
import { ServiceIcon } from '../components/ServiceIcon';
import { getServiceById } from '../data/services';
import { NotFoundPage } from './NotFoundPage';

export function ServiceDetailPage() {
  const { id } = useParams();
  const service = getServiceById(id);

  if (!service) {
    return <NotFoundPage />;
  }

  return (
    <>
      <PageIntro eyebrow="บริการทันตกรรม" title={service.title} description={service.description} />
      <section className="section service-detail">
        <div className="container service-detail__grid">
          <div className="service-detail__summary">
            <div className="service-detail__icon" aria-hidden="true">
              <ServiceIcon kind={service.icon} size={42} strokeWidth={1.45} />
            </div>
            <h2>สิ่งที่คุณจะได้รับจากการปรึกษา</h2>
            <p>{service.shortDescription}</p>
            <Link className="button" to="/appointment">
              จองคิวทันตกรรม <CalendarDays aria-hidden="true" size={18} />
            </Link>
          </div>
          <div className="service-detail__content">
            <section aria-labelledby="care-points-title" className="detail-panel">
              <h2 id="care-points-title">แนวทางการดูแล</h2>
              <ul className="check-list">
                {service.carePoints.map((point) => (
                  <li key={point}><CheckCircle2 aria-hidden="true" size={20} />{point}</li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="suitable-for-title" className="detail-panel">
              <h2 id="suitable-for-title">เหมาะสำหรับ</h2>
              <ul className="check-list">
                {service.suitableFor.map((item) => (
                  <li key={item}><CheckCircle2 aria-hidden="true" size={20} />{item}</li>
                ))}
              </ul>
            </section>
          </div>
        </div>
        <div className="container service-detail__back">
          <Link className="text-link" to="/services"><ArrowLeft aria-hidden="true" size={17} /> บริการทั้งหมด</Link>
          <Link className="text-link" to="/appointment">ส่งคำขอนัดหมาย <ArrowRight aria-hidden="true" size={17} /></Link>
        </div>
      </section>
    </>
  );
}
