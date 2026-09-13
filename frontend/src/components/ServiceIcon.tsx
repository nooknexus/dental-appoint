import {
  BrushCleaning,
  CirclePlus,
  ClipboardCheck,
  HeartPulse,
  MessageCircle,
  Stethoscope,
  type LucideProps,
} from 'lucide-react';

import type { Service } from '../types';

interface ServiceIconProps extends LucideProps {
  kind: Service['icon'];
}

export function ServiceIcon({ kind, ...props }: ServiceIconProps) {
  switch (kind) {
    case 'scaling':
      return <BrushCleaning {...props} />;
    case 'filling':
      return <CirclePlus {...props} />;
    case 'restorative':
      return <HeartPulse {...props} />;
    case 'children':
      return <ClipboardCheck {...props} />;
    case 'consultation':
      return <MessageCircle {...props} />;
    case 'checkup':
    default:
      return <Stethoscope {...props} />;
  }
}
