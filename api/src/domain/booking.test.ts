import { describe, expect, it } from 'vitest';

import { createAppointment, createPendingAppointment } from './booking.js';

describe('createPendingAppointment', () => {
  it('assigns a pending-confirmation appointment and payment status with a padded queue number', () => {
    const appointment = createPendingAppointment({
      queuePrefix: 'DEN',
      queueSequence: 7,
      reference: 'APT-20260903-AB12',
      serviceId: 2,
      dentistId: 4,
      slotId: 9,
      patientPhone: '0812345678',
    });

    expect(appointment.queueNumber).toBe('DEN007');
    expect(appointment.appointmentStatus).toBe('PENDING_CONFIRMATION');
    expect(appointment.paymentStatus).toBe('AWAITING_PAYMENT');
    expect(appointment.reference).toBe('APT-20260903-AB12');
  });
});

describe('createAppointment', () => {
  it('keeps a booking pending staff confirmation when the reservation payment is disabled', () => {
    const appointment = createAppointment({
      queuePrefix: 'DEN',
      queueSequence: 8,
      reference: 'APT-20260903-CD34',
      serviceId: 2,
      dentistId: 4,
      slotId: 10,
      patientPhone: '0812345678',
      reservationPaymentEnabled: false,
    });

    expect(appointment.queueNumber).toBe('DEN008');
    expect(appointment.appointmentStatus).toBe('PENDING_CONFIRMATION');
    expect(appointment.paymentStatus).toBe('NOT_REQUIRED');
  });
});
