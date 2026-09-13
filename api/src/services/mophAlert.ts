import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const mophEndpoint = 'https://morpromt2c.moph.go.th/alert/v3.1/messages';

export type AppointmentConfirmation = {
  citizenId: string;
  queueNumber: string;
  serviceDate: string;
  startTime: string;
  dentistName: string | null;
  serviceName: string | null;
};

export type AppointmentCancellation = AppointmentConfirmation & { reason: string | null };

function keyFor(encryptionKey: string) { return scryptSync(encryptionKey, 'clinic-moph-alert-v1', 32); }

export function encryptCredential(value: string, encryptionKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(encryptionKey), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptCredential(value: string, encryptionKey: string) {
  const [ivText, tagText, encryptedText] = value.split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('Invalid encrypted MOPH credential');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(encryptionKey), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

export function isValidCid(value: string) { return /^\d{13}$/.test(value); }
export function retryableDeliveryFailure(status: number | undefined, networkError: boolean) { return networkError || (status !== undefined && status >= 500); }

export function buildAppointmentConfirmationPayload(input: AppointmentConfirmation) {
  const details = [
    { label: 'หมายเลขคิว', value: input.queueNumber },
    { label: 'วันนัด', value: input.serviceDate },
    { label: 'เวลา', value: `${input.startTime} น.` },
    ...(input.dentistName ? [{ label: 'ทันตแพทย์', value: input.dentistName }] : []),
    ...(input.serviceName ? [{ label: 'หัตถการ', value: input.serviceName }] : []),
  ];
  const text = `ยืนยันนัดหมายแล้ว เลขคิว ${input.queueNumber} วันที่ ${input.serviceDate} เวลา ${input.startTime} น.`;
  return {
    cid: [input.citizenId],
    messages: [{ type: 'flex', altText: text, contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#0F766E', paddingAll: '20px',
        contents: [
          { type: 'text', text: 'ใบนัดหมายทันตกรรม', size: 'sm', color: '#CCFBF1' },
          { type: 'text', text: 'ยืนยันนัดหมายแล้ว', weight: 'bold', size: 'xl', color: '#FFFFFF', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
          {
            type: 'box', layout: 'vertical', backgroundColor: '#F0FDFA', cornerRadius: '12px', paddingAll: '16px',
            contents: [
              { type: 'text', text: 'หมายเลขคิว', size: 'sm', color: '#0F766E', align: 'center' },
              { type: 'text', text: input.queueNumber, size: 'xxl', weight: 'bold', color: '#115E59', align: 'center', margin: 'sm' },
            ],
          },
          { type: 'separator', color: '#D1FAE5', margin: 'md' },
          ...details.map((detail) => ({
            type: 'box', layout: 'horizontal', margin: 'md', spacing: 'sm',
            contents: [
              { type: 'text', text: detail.label, size: 'sm', color: '#64748B', flex: 3 },
              { type: 'text', text: detail.value, size: 'sm', color: '#0F172A', wrap: true, align: 'end', flex: 5 },
            ],
          })),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', backgroundColor: '#ECFDF5', paddingAll: '16px',
        contents: [
          { type: 'text', text: 'กรุณามารับบริการตามวันและเวลานัดหมาย', wrap: true, align: 'center', size: 'sm', color: '#065F46' },
        ],
      },
    } }],
    message_title: 'ยืนยันนัดหมายทันตกรรม',
    message_html: `<div><strong>ยืนยันนัดหมาย</strong><br>หมายเลขคิว ${input.queueNumber}</div>`,
    message_text: text,
    message_type: 'HPT',
  };
}

export function buildAppointmentCancellationPayload(input: AppointmentCancellation) {
  const details = [
    { label: 'หมายเลขคิว', value: input.queueNumber },
    { label: 'วันนัด', value: input.serviceDate },
    { label: 'เวลา', value: `${input.startTime} น.` },
    ...(input.dentistName ? [{ label: 'ทันตแพทย์', value: input.dentistName }] : []),
    ...(input.serviceName ? [{ label: 'หัตถการ', value: input.serviceName }] : []),
    ...(input.reason ? [{ label: 'เหตุผล', value: input.reason }] : []),
  ];
  const text = `ยกเลิกนัดหมายแล้ว เลขคิว ${input.queueNumber} วันที่ ${input.serviceDate} เวลา ${input.startTime} น.`;
  return {
    cid: [input.citizenId],
    messages: [{ type: 'flex', altText: text, contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#B91C1C', paddingAll: '20px',
        contents: [
          { type: 'text', text: 'ใบนัดหมายทันตกรรม', size: 'sm', color: '#FEE2E2' },
          { type: 'text', text: 'ยกเลิกนัดหมายแล้ว', weight: 'bold', size: 'xl', color: '#FFFFFF', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
          {
            type: 'box', layout: 'vertical', backgroundColor: '#FEF2F2', cornerRadius: '12px', paddingAll: '16px',
            contents: [
              { type: 'text', text: 'หมายเลขคิว', size: 'sm', color: '#B91C1C', align: 'center' },
              { type: 'text', text: input.queueNumber, size: 'xxl', weight: 'bold', color: '#7F1D1D', align: 'center', margin: 'sm' },
            ],
          },
          { type: 'separator', color: '#FECACA', margin: 'md' },
          ...details.map((detail) => ({
            type: 'box', layout: 'horizontal', margin: 'md', spacing: 'sm',
            contents: [
              { type: 'text', text: detail.label, size: 'sm', color: '#64748B', flex: 3 },
              { type: 'text', text: detail.value, size: 'sm', color: '#0F172A', wrap: true, align: 'end', flex: 5 },
            ],
          })),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', backgroundColor: '#FEF2F2', paddingAll: '16px',
        contents: [
          { type: 'text', text: 'หากต้องการนัดหมายใหม่ กรุณาติดต่อคลินิก', wrap: true, align: 'center', size: 'sm', color: '#7F1D1D' },
        ],
      },
    } }],
    message_title: 'ยกเลิกนัดหมายทันตกรรม',
    message_html: `<div><strong>ยกเลิกนัดหมาย</strong><br>หมายเลขคิว ${input.queueNumber}</div>`,
    message_text: text,
    message_type: 'HPT',
  };
}

export async function sendMophAlert(payload: ReturnType<typeof buildAppointmentConfirmationPayload> | ReturnType<typeof buildAppointmentCancellationPayload>, credentials: { clientKey: string; secretKey: string }, fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetcher(mophEndpoint, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'client-key': credentials.clientKey, 'secret-key': credentials.secretKey }, body: JSON.stringify(payload) });
    return { status: response.status, body: (await response.text()).slice(0, 1000) };
  } finally { clearTimeout(timeout); }
}
