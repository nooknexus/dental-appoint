export interface Service {
  id: string;
  title: string;
  shortDescription: string;
  description: string;
  carePoints: string[];
  suitableFor: string[];
  icon: 'checkup' | 'scaling' | 'filling' | 'restorative' | 'children' | 'consultation';
}

export interface TeamMember {
  role: string;
  name: string;
  focus: string;
  credentials: string;
  specialties: string[];
  availability: string;
  image: string;
  imageAlt: string;
}

export interface AppointmentRequest {
  firstName: string;
  lastName: string;
  phone: string;
  date: string;
  time: string;
  service: string;
  details: string;
  consent: boolean;
}

export type AppointmentErrors = Partial<Record<keyof AppointmentRequest, string>>;
