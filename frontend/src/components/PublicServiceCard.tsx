import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { PublicService } from '../services/publicServices';
import { formatStartingPrice } from '../utils/price';
import { ServiceIcon } from './ServiceIcon';

interface PublicServiceCardProps {
  service: PublicService;
}

export function PublicServiceCard({ service }: PublicServiceCardProps) {
  return (
    <article className="service-card">
      <div className="service-card__icon" aria-hidden="true">
        <ServiceIcon kind="checkup" size={27} strokeWidth={1.7} />
      </div>
      <h3>{service.name}</h3>
      <p>{formatStartingPrice(service.priceLabel)}</p>
      <Link className="text-link" to="/appointment">
        จองบริการ <ArrowRight aria-hidden="true" size={17} />
      </Link>
    </article>
  );
}
