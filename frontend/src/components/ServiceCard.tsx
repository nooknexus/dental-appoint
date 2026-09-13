import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { Service } from '../types';
import { ServiceIcon } from './ServiceIcon';

interface ServiceCardProps {
  service: Service;
}

export function ServiceCard({ service }: ServiceCardProps) {
  return (
    <article className="service-card">
      <div className="service-card__icon" aria-hidden="true">
        <ServiceIcon kind={service.icon} size={27} strokeWidth={1.7} />
      </div>
      <h3>{service.title}</h3>
      <p>{service.shortDescription}</p>
      <Link className="text-link" to={`/services/${service.id}`}>
        ดูรายละเอียด <ArrowRight aria-hidden="true" size={17} />
      </Link>
    </article>
  );
}
