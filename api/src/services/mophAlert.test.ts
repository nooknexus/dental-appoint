import { describe, expect, it } from 'vitest';

import { buildAppointmentCancellationPayload, buildAppointmentConfirmationPayload, decryptCredential, encryptCredential, isValidCid, retryableDeliveryFailure } from './mophAlert.js';

describe('MOPH Alert appointment confirmation', () => {
  it('builds a Flex confirmation for a valid citizen ID without inventing an unspecified procedure', () => {
    const payload = buildAppointmentConfirmationPayload({
      citizenId: '1101700203456', queueNumber: 'DDS15001', serviceDate: '2026-09-12', startTime: '09:00', dentistName: 'ทพ. สมชาย ใจดี', serviceName: null,
    });

    expect(payload.cid).toEqual(['1101700203456']);
    expect(payload.message_type).toBe('HPT');
    expect(payload.messages[0].type).toBe('flex');
    expect(JSON.stringify(payload)).toContain('DDS15001');
    expect(JSON.stringify(payload)).toContain('ทพ. สมชาย ใจดี');
    expect(JSON.stringify(payload)).not.toContain('ยังไม่ระบุหัตถการ');
  });

  it('presents the appointment as a structured card with a highlighted queue number', () => {
    const payload = buildAppointmentConfirmationPayload({
      citizenId: '1101700203456', queueNumber: 'DDS15001', serviceDate: '2026-09-12', startTime: '09:00', dentistName: 'ทพ. สมชาย ใจดี', serviceName: 'อุดฟัน',
    });
    const bubble = payload.messages[0].contents as {
      header?: { backgroundColor?: string; contents: Array<{ text?: string }> };
      body?: { contents: Array<{ layout?: string; contents?: Array<{ text?: string; size?: string; weight?: string }> }> };
      footer?: { contents: Array<{ text?: string }> };
    };

    expect(bubble.header?.backgroundColor).toBe('#0F766E');
    expect(bubble.header?.contents.map((item) => item.text)).toContain('ยืนยันนัดหมายแล้ว');
    expect(bubble.body?.contents.some((item) => item.contents?.some((child) => child.text === 'DDS15001' && child.size === 'xxl' && child.weight === 'bold'))).toBe(true);
    expect(bubble.body?.contents.filter((item) => item.layout === 'horizontal')).toHaveLength(5);
    expect(bubble.footer?.contents.map((item) => item.text)).toContain('กรุณามารับบริการตามวันและเวลานัดหมาย');
  });

  it('validates CID and distinguishes retryable MOPH failures', () => {
    expect(isValidCid('1101700203456')).toBe(true);
    expect(isValidCid('MOCK-PATIENT-001')).toBe(false);
    expect(retryableDeliveryFailure(503, false)).toBe(true);
    expect(retryableDeliveryFailure(400, false)).toBe(false);
    expect(retryableDeliveryFailure(undefined, true)).toBe(true);
  });

  it('encrypts saved credentials so their stored value is not plaintext', () => {
    const encrypted = encryptCredential('moph-secret', 'a'.repeat(32));

    expect(encrypted).not.toContain('moph-secret');
    expect(decryptCredential(encrypted, 'a'.repeat(32))).toBe('moph-secret');
  });
});

describe('MOPH Alert appointment cancellation', () => {
  it('builds a Flex cancellation card with the reason omitted when not given', () => {
    const payload = buildAppointmentCancellationPayload({
      citizenId: '1101700203456', queueNumber: 'DDS15001', serviceDate: '2026-09-12', startTime: '09:00', dentistName: 'ทพ. สมชาย ใจดี', serviceName: 'อุดฟัน', reason: null,
    });

    expect(payload.cid).toEqual(['1101700203456']);
    expect(payload.message_type).toBe('HPT');
    expect(payload.messages[0].type).toBe('flex');
    expect(JSON.stringify(payload)).toContain('DDS15001');
    expect(JSON.stringify(payload)).toContain('ยกเลิกนัดหมายแล้ว');
    expect(JSON.stringify(payload)).not.toContain('เหตุผล');
  });

  it('presents the cancellation as a structured card with the reason line when given', () => {
    const payload = buildAppointmentCancellationPayload({
      citizenId: '1101700203456', queueNumber: 'DDS15001', serviceDate: '2026-09-12', startTime: '09:00', dentistName: 'ทพ. สมชาย ใจดี', serviceName: null, reason: 'ผู้ป่วยโทรมายกเลิกเอง',
    });
    const bubble = payload.messages[0].contents as {
      header?: { backgroundColor?: string; contents: Array<{ text?: string }> };
      body?: { contents: Array<{ layout?: string; contents?: Array<{ text?: string; size?: string; weight?: string }> }> };
      footer?: { contents: Array<{ text?: string }> };
    };

    expect(bubble.header?.backgroundColor).toBe('#B91C1C');
    expect(bubble.header?.contents.map((item) => item.text)).toContain('ยกเลิกนัดหมายแล้ว');
    expect(bubble.body?.contents.some((item) => item.contents?.some((child) => child.text === 'DDS15001' && child.size === 'xxl' && child.weight === 'bold'))).toBe(true);
    expect(bubble.body?.contents.some((item) => item.contents?.some((child) => child.text === 'ผู้ป่วยโทรมายกเลิกเอง'))).toBe(true);
    expect(bubble.footer?.contents.map((item) => item.text)).toContain('หากต้องการนัดหมายใหม่ กรุณาติดต่อคลินิก');
  });
});
