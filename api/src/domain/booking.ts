export type AppointmentStatus = 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'CANCELLED';
export type PaymentStatus = 'AWAITING_PAYMENT' | 'SLIP_UPLOADED' | 'VERIFIED' | 'REJECTED' | 'NOT_REQUIRED';

export interface PendingAppointmentInput {
  queuePrefix: string;
  queueSequence: number;
  reference: string;
  serviceId?: number;
  dentistId?: number;
  slotId: number;
  patientPhone: string;
}

export interface AppointmentInput extends PendingAppointmentInput {
  reservationPaymentEnabled: boolean;
}

export function createPendingAppointment(input: PendingAppointmentInput) {
  return {
    ...input,
    queueNumber: `${input.queuePrefix}${String(input.queueSequence).padStart(3, '0')}`,
    appointmentStatus: 'PENDING_CONFIRMATION' as AppointmentStatus,
    paymentStatus: 'AWAITING_PAYMENT' as PaymentStatus,
  };
}

export function createAppointment(input: AppointmentInput) {
  const appointment = createPendingAppointment(input);
  if (input.reservationPaymentEnabled) return appointment;
  return {
    ...appointment,
    paymentStatus: 'NOT_REQUIRED' as PaymentStatus,
  };
}
