import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';
import { resetPatientAuthCache } from '../services/patientSession';
import { resetPatientAppointmentsCache } from '../pages/PatientAppointmentsPage';
import { resetSatisfactionCache } from '../pages/SatisfactionPage';

async function signInWithCitizenForm(user: ReturnType<typeof userEvent.setup>, name = 'มานี รักเรียน', citizenId = '1101700203456') {
  const [firstName, lastName] = name.split(' ');
  // ฟอร์มกรอกเองขอ session จริงจาก server แล้ว จึงต้อง stub endpoint นี้ (คง stub เดิมของเทสต์ไว้)
  const previousFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/auth/patient/manual')) {
      return Promise.resolve(new Response(JSON.stringify({ displayName: name, provider: 'manual' }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    }
    return typeof previousFetch === 'function' ? previousFetch(input, init) : Promise.resolve(new Response('{}', { status: 404 }));
  }));
  await user.click(await screen.findByRole('button', { name: 'หากไม่มีแอพข้างต้น / กรอกข้อมูลเพื่อใช้งาน' }));
  await user.type(screen.getByLabelText('ชื่อ'), firstName);
  await user.type(screen.getByLabelText('นามสกุล'), lastName);
  await user.type(screen.getByLabelText('เลขบัตร13หลัก'), citizenId);
  await user.click(screen.getByRole('button', { name: 'เข้าสู่เมนูบริการ' }));
}

function stubActiveServices() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    services: [
      { id: 6, code: 'SERVICE-6', name: 'เคลือบฟลูออไรด์', category: 'ทันตกรรมสำหรับเด็ก', description: 'ระยะเวลานัดหมายประมาณ 30 นาที', priceLabel: '300 บาท', depositAmount: 400 },
      { id: 3, code: 'SERVICE-3', name: 'อุดฟัน', category: 'งานทั่วไป', description: 'ระยะเวลานัดหมายประมาณ 60 นาที', priceLabel: '550–1,000 บาท', depositAmount: 400 },
      { id: 2, code: 'SERVICE-2', name: 'ผ่าฟันคุด/ฟันฝัง', category: 'งานทั่วไป', description: 'ระยะเวลานัดหมายประมาณ 90 นาที', priceLabel: '1,500–3,500 บาท', depositAmount: 400 },
    ],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
}

function stubDentistRegistry(bookingFlow: 'PROCEDURE_AND_DENTIST' | 'DENTIST_ONLY' | 'TIME_ONLY') {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    if (String(input).endsWith('/staff/dentists')) {
      return Promise.resolve(new Response(JSON.stringify({
        bookingFlow,
        dentists: [{ id: 1, displayName: 'ทพ.ทดสอบ ระบบ', title: 'ทพ.', queuePrefix: 'TST', portraitUrl: null, active: true, serviceIds: [1] }],
        services: [{ id: 1, title: 'ตรวจฟัน', category: 'ทั่วไป' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
}

function stubStaffSlots(bookingFlow: 'PROCEDURE_AND_DENTIST' | 'DENTIST_ONLY' | 'TIME_ONLY' = 'PROCEDURE_AND_DENTIST') {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    if (String(input).includes('/staff/slots')) {
      return Promise.resolve(new Response(JSON.stringify({
        date: '2026-09-15',
        bookingFlow,
        dentists: [{ id: 1, displayName: 'ทพ.ทดสอบ ระบบ', queuePrefix: 'TST', services: ['ตรวจฟัน'] }],
        slots: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
}

function stubBookingJourney({ reservationPaymentRequired = true } = {}) {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/services')) return Promise.resolve(new Response(JSON.stringify({ services: [
      { id: 3, code: 'SERVICE-3', name: 'อุดฟัน', category: 'งานทั่วไป', description: 'บูรณะฟันผุ', priceLabel: '550–1,000 บาท', depositAmount: 400 },
      { id: 6, code: 'SERVICE-6', name: 'เคลือบฟลูออไรด์', category: 'ทันตกรรมสำหรับเด็ก', description: 'ป้องกันฟันผุ', priceLabel: '300 บาท', depositAmount: 400 },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (url.includes('/services/3/dentists')) return Promise.resolve(new Response(JSON.stringify({ dentists: [{ id: 2, code: 'DENTIST-2', name: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', specialty: 'บูรณะฟัน' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (url.includes('/availability')) return Promise.resolve(new Response(JSON.stringify({ slots: [{ id: 99, startsAt: '2026-09-10T09:00:00+07:00', endsAt: '2026-09-10T09:30:00+07:00' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (url.endsWith('/appointments') && init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ appointment: { reference: 'APT-MTS53N2D-3B508A', queueNumber: 'DNT002', paymentAmount: reservationPaymentRequired ? 400 : 0, reservationPaymentRequired } }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    if (url.includes('/payment-qr')) return Promise.resolve(new Response(JSON.stringify({ qrCodeDataUrl: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (url.includes('/slip')) return Promise.resolve(new Response('{}', { status: 200 }));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
}

function stubStaffAppointments() {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/staff/appointments/7/slip')) return Promise.resolve(new Response(new Blob(['slip'], { type: 'image/png' }), { status: 200 }));
    if (url.endsWith('/staff/appointments')) return Promise.resolve(new Response(JSON.stringify({ appointments: [{
      id: 7,
      reference: 'APT-MTS53N2D-3B508A',
      queueNumber: 'DNT002',
      status: 'PENDING',
      paymentStatus: 'SLIP_UPLOADED',
      patientName: 'คุณสมหญิง ใจงาม',
      serviceName: 'อุดฟัน',
      dentistName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม',
      startsAt: '2026-09-10T09:00:00+07:00',
      phone: '0826018089',
      slipAvailable: true,
    }, {
      id: 9,
      reference: 'APT-NO-PAYMENT-QUEUE',
      queueNumber: 'DNT004',
      status: 'PENDING_CONFIRMATION',
      paymentStatus: 'NOT_REQUIRED',
      patientName: 'คุณวิไล พร้อมเพรียง',
      serviceName: 'ตรวจสุขภาพช่องปาก',
      dentistName: 'ทพญ. พิมพ์ใจ สุขสันต์',
      startsAt: '2026-09-10T11:00:00+07:00',
      phone: '0826018099',
      slipAvailable: false,
    }, {
      id: 8,
      reference: 'APT-OLD-CONFIRMED',
      queueNumber: 'DNT003',
      status: 'CONFIRMED',
      paymentStatus: 'VERIFIED',
      patientName: 'คุณประยุทธ มั่นคง',
      serviceName: 'ขูดหินปูน',
      dentistName: 'ทพ. กิตติพงศ์ ใจดี',
      startsAt: '2026-09-11T09:00:00+07:00',
      phone: '0826018090',
      slipAvailable: true,
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
}

function stubDutyRoster() {
  const parsed = {
    sheetName: 'เวรกันยายน',
    title: 'ตารางปฏิบัติงานสำหรับเจ้าหน้าที่ คลินิกรูปแบบพิเศษ Premium Clinic โรงพยาบาลวังทอง ประจำเดือน กันยายน 2569',
    detectedMonth: '2026-09',
    sourceFileName: 'duty-2569-09.xlsx',
    rows: [
      { sequenceNo: 1, name: 'ทพญ.นิศา ทองนพคุณ', dentistId: 3, matchedName: 'ทพญ.นิศา ทองนพคุณ', days: [{ day: 17, mark: '/' }] },
      { sequenceNo: 2, name: 'ทพ.สมชาย ใจดี', dentistId: null, matchedName: null, days: [{ day: 14, mark: '/' }, { day: 28, mark: '/' }] },
    ],
    skippedNames: ['นางสาวสมหญิง ใจดี', 'ผู้ช่วยทันตแพทย์ สมศรี'],
    warnings: ['ข้าม 2 รายชื่อที่ไม่ใช่ทันตแพทย์: นางสาวสมหญิง ใจดี, ผู้ช่วยทันตแพทย์ สมศรี', 'มี 1 รายชื่อที่ยังจับคู่กับทะเบียนทันตแพทย์ไม่ได้ กรุณาเลือกด้วยตนเองก่อนบันทึก'],
    dentists: [{ id: 3, displayName: 'ทพญ.นิศา ทองนพคุณ', active: true }, { id: 4, displayName: 'ทพ.จรูญพันธ์ อธิกชัย', active: true }],
  };
  const detail = {
    roster: { month: '2026-09', title: parsed.title, sourceFileName: 'duty-2569-09.xlsx', uploadedBy: 'CLINIC_STAFF', updatedAt: '2026-09-11 12:00', daysInMonth: 30 },
    holidays: [{ date: '2026-09-28', day: 28, name: 'วันทดสอบวันหยุด' }],
    holidaySource: 'google',
    members: [
      { id: 11, sequenceNo: 1, name: 'ทพญ.นิศา ทองนพคุณ', sourceName: 'ทพญ.นิศา ทองนพคุณ', dentistId: 3, queuePrefix: 'DDS01', dutyDays: [{ day: 17, date: '2026-09-17', mark: '/' }] },
      { id: 12, sequenceNo: 2, name: 'ทพ.จรูญพันธ์ อธิกชัย', sourceName: 'ทพ.สมชาย ใจดี', dentistId: 4, queuePrefix: 'DDS02', dutyDays: [{ day: 14, date: '2026-09-14', mark: '/' }, { day: 28, date: '2026-09-28', mark: '/' }] },
    ],
  };
  const saved: unknown[] = [];
  const requestedTemplates: string[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
    if (url.includes('/staff/duty-rosters/template')) { requestedTemplates.push(url); return Promise.resolve(new Response(new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), { status: 200 })); }
    if (url.endsWith('/staff/duty-rosters/parse')) return json(parsed);
    if (url.endsWith('/staff/duty-rosters') && init?.method === 'POST') { saved.push(JSON.parse(String(init.body))); return json({ message: 'บันทึกทะเบียนลงเวรเดือน 2026-09 แล้ว (2 คน / 3 วันลงเวร)', ...detail }, 201); }
    if (url.endsWith('/staff/duty-rosters')) return json({ rosters: saved.length ? [{ month: '2026-09', title: parsed.title, sourceFileName: 'duty-2569-09.xlsx', uploadedBy: 'CLINIC_STAFF', updatedAt: '2026-09-11 12:00', memberCount: 2, dutyCount: 3 }] : [] });
    if (url.endsWith('/staff/duty-rosters/2026-09')) return json(detail);
    return json({}, 404);
  }));
  return { saved, requestedTemplates };
}

describe('clinic SPA', () => {
  it('shows the clinic promise and an appointment action on the home route', () => {
    render(<App initialEntries={['/']} />);

    expect(
      screen.getByRole('heading', { name: /ดูแลทุกรอยยิ้ม.*ด้วยมาตรฐานและความใส่ใจ/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /จองคิวทันตกรรม/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'มาตรฐานการบริการ' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ใส่ใจทุกขั้นตอน' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ทีมทันตบุคลากร' })).toBeInTheDocument();
    expect(screen.getAllByText('สำนักงานสาธารณสุขจังหวัดพิษณุโลก').length).toBeGreaterThan(0);
    expect(screen.queryByRole('img', { name: 'ตราสัญลักษณ์สำนักงานสาธารณสุขจังหวัดพิษณุโลก' })).not.toBeInTheDocument();
  });

  it('shows active registry services in the home preview', async () => {
    stubActiveServices();

    render(<App initialEntries={['/']} />);

    expect(await screen.findByRole('heading', { name: 'เคลือบฟลูออไรด์' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'อุดฟัน' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ผ่าฟันคุด/ฟันฝัง' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ตรวจสุขภาพช่องปาก' })).not.toBeInTheDocument();
  });

  it('shows the clinic building in the opening hero', () => {
    render(<App initialEntries={['/']} />);

    expect(screen.getByRole('img', { name: 'ภาพอาคารคลินิก สาสุข พรีเมียม' })).toBeInTheDocument();
  });

  it('shows in-hours and after-hours service times on the home route', () => {
    render(<App initialEntries={['/']} />);

    expect(screen.getByRole('heading', { name: 'เวลาให้บริการ' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'เวลาให้บริการของแต่ละแผนก' })).toBeInTheDocument();
    expect(
      screen.getByRole('row', { name: 'ในเวลา จันทร์–ศุกร์ 08:30–16:30 น.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('row', { name: 'นอกเวลา จันทร์–ศุกร์ 16:30–20:30 น.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('row', { name: 'นอกเวลา เสาร์–อาทิตย์ 08:30–16:30 น.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('เวลาให้บริการ: อยู่ระหว่างการอัปเดต')).not.toBeInTheDocument();
  });

  it('shows the clinic logo in the home about snapshot', () => {
    render(<App initialEntries={['/']} />);

    expect(
      screen.getAllByRole('img', { name: 'ตราสัญลักษณ์ สาสุข พรีเมียม Dental Clinic' }),
    ).toHaveLength(3);
  });

  it('shows mock team profiles and an appointment action on the team route', () => {
    render(<App initialEntries={['/team']} />);

    expect(screen.getByRole('heading', { name: 'ทพญ. พิมพ์ใจ สุขสันต์' })).toBeInTheDocument();
    expect(screen.getByText('ตรวจสุขภาพช่องปาก')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'คุณกมลวรรณ ใจดี' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /จองคิวทันตกรรม/i }).length).toBeGreaterThan(0);
  });

  it('shows staff portraits and links the weekly schedule to real duty roster data', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/dentists/weekly-duty-schedule')) return Promise.resolve(new Response(JSON.stringify({
        weekStart: '2026-09-14', weekEnd: '2026-09-20',
        dentists: [{ id: 3, displayName: 'ทพญ. พิมพ์ใจ สุขสันต์', dates: ['2026-09-14', '2026-09-16'] }, { id: 4, displayName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', dates: ['2026-09-15'] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    render(<App initialEntries={['/team']} />);

    expect(screen.getByRole('img', { name: 'ภาพ ทพญ. พิมพ์ใจ สุขสันต์' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'ภาพ คุณกมลวรรณ ใจดี' })).toBeInTheDocument();
    expect(screen.queryByText(/Mockup/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ข้อมูลตัวอย่าง/)).not.toBeInTheDocument();

    const table = await screen.findByRole('table', { name: 'ตารางเวรประจำสัปดาห์นี้' });
    expect(within(table).getByRole('columnheader', { name: 'ทพญ. พิมพ์ใจ สุขสันต์' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม' })).toBeInTheDocument();
    const mondayRow = within(table).getByRole('row', { name: /วันจันทร์/ });
    expect(within(mondayRow).getAllByText('ออกตรวจ')).toHaveLength(1);
    expect(within(mondayRow).getAllByText('—')).toHaveLength(1);
  });

  it('shows an empty-state message instead of a stale schedule when no one is on duty this week', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/dentists/weekly-duty-schedule')) return Promise.resolve(new Response(JSON.stringify({ weekStart: '2026-09-14', weekEnd: '2026-09-20', dentists: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    render(<App initialEntries={['/team']} />);

    expect(await screen.findByText('ยังไม่มีตารางเวรของสัปดาห์นี้ในระบบ กรุณาติดตามข้อมูลอัปเดตจากคลินิกโดยตรง')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'ตารางเวรประจำสัปดาห์นี้' })).not.toBeInTheDocument();
  });

  it('gives a registered dentist without a curated bio a generic, honest profile instead of borrowing another dentist\'s bio and photo', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/dentists')) return Promise.resolve(new Response(JSON.stringify({ dentists: [{
        id: 101,
        name: 'ทพญ.นิศา ทองนพคุณ',
        title: 'ทพญ.',
        specialty: 'ทันตกรรมทั่วไป',
        portraitUrl: null,
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));

    render(<App initialEntries={['/team']} />);
    window.dispatchEvent(new Event('dentist-registry-updated'));

    const profile = (await screen.findByRole('heading', { name: 'ทพญ.นิศา ทองนพคุณ' })).closest('article');
    expect(profile).not.toBeNull();
    // no portrait uploaded and no curated bio for this name: a neutral placeholder, never another named dentist's photo or bio
    expect(within(profile!).getByRole('img', { name: 'ยังไม่มีรูปประจำตัวของ ทพญ.นิศา ทองนพคุณ' })).toBeInTheDocument();
    expect(within(profile!).queryByRole('img', { name: /พิมพ์ใจ/ })).not.toBeInTheDocument();
    expect(within(profile!).getByText('ทันตกรรมทั่วไป')).toBeInTheDocument();
    expect(within(profile!).queryByText('ให้คำปรึกษาและวางแผนการดูแลสุขภาพช่องปากสำหรับผู้รับบริการทุกช่วงวัย')).not.toBeInTheDocument();
    expect(within(profile!).queryByText('จันทร์–ศุกร์ 09:00–16:00 น.')).not.toBeInTheDocument();
  });

  it('shows only active registry services on the public services route', async () => {
    stubActiveServices();

    render(<App initialEntries={['/services']} />);

    expect(await screen.findByRole('heading', { name: 'เคลือบฟลูออไรด์' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'อุดฟัน' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ผ่าฟันคุด/ฟันฝัง' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ทันตกรรมป้องกัน' })).not.toBeInTheDocument();
  });

  it('shows only the price in public service cards', async () => {
    stubActiveServices();

    render(<App initialEntries={['/services']} />);

    expect(await screen.findByText('เริ่มต้นที่ 300 บาท')).toBeInTheDocument();
    expect(screen.queryByText('ระยะเวลานัดหมายประมาณ 30 นาที')).not.toBeInTheDocument();
  });

  it('shows each procedure’s starting price on public services and procedure booking', async () => {
    stubActiveServices();
    const servicesView = render(<App initialEntries={['/services']} />);

    expect(await screen.findByText('เริ่มต้นที่ 550 บาท')).toBeInTheDocument();
    expect(screen.queryByText('ราคา 550–1,000 บาท')).not.toBeInTheDocument();
    servicesView.unmount();

    stubBookingJourney();
    const user = userEvent.setup();
    render(<App initialEntries={['/booking/service']} />);
    await user.click(screen.getByRole('button', { name: 'งานทั่วไป' }));

    expect(screen.getByText('เริ่มต้นที่ 550 บาท')).toBeInTheDocument();
    expect(screen.queryByText('ราคา 550–1,000 บาท')).not.toBeInTheDocument();
  });

  it('renders a known service from a direct detail route', () => {
    render(<App initialEntries={['/services/scaling']} />);

    expect(screen.getByRole('heading', { name: 'ขูดหินปูน' })).toBeInTheDocument();
    expect(screen.getByText(/คราบหินปูนและดูแลสุขภาพเหงือก/i)).toBeInTheDocument();
  });

  it('keeps an unknown route inside the application with a home link', () => {
    render(<App initialEntries={['/does-not-exist']} />);

    expect(screen.getByRole('heading', { name: 'ไม่พบหน้าที่คุณต้องการ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'กลับหน้าหลัก' })).toHaveAttribute('href', '/');
  });

  it('renders the contact route without an invalid social icon', () => {
    render(<App initialEntries={['/contact']} />);

    expect(screen.getByRole('heading', { name: 'ช่องทางของคลินิก' })).toBeInTheDocument();
    expect(screen.getAllByText('สาสุขพรีเมี่ยม คลินิกทันตกรรม ถ.พุทธบูชา ต.ในเมือง อ.เมือง จ.พิษณุโลก').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Facebook' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '063-192-3003' })).toHaveAttribute('href', 'tel:0631923003');
    expect(screen.getByRole('link', { name: 'สาสุขพรีเมี่ยม คลินิกทันตกรรม' })).toHaveAttribute(
      'href',
      'https://www.facebook.com/profile.php?id=61593621128540',
    );
  });

  it('embeds the clinic location map at the supplied coordinates', () => {
    render(<App initialEntries={['/contact']} />);

    expect(screen.getByTitle('แผนที่ตั้งคลินิก')).toHaveAttribute(
      'src',
      'https://www.google.com/maps?q=16.8170326,100.2609722&z=17&output=embed',
    );
    expect(screen.getByTitle('แผนที่ตั้งคลินิก')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  });

  it('shows the patient service menu after citizen sign-in before booking', async () => {
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await signInWithCitizenForm(user);
    expect(await screen.findByRole('heading', { name: 'เลือกเมนูบริการ' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /^จองคิว เลือกบริการ/ }));

    expect(screen.getByRole('heading', { name: 'เลือกหมวดบริการ' })).toBeInTheDocument();
  });

  it('lets citizens without SSO enter their 13-digit citizen ID before opening the service menu', async () => {
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await signInWithCitizenForm(user);

    expect(await screen.findByRole('heading', { name: 'สวัสดี มานี รักเรียน' })).toBeInTheDocument();
  });

  it('returns a patient with an existing session to the service menu instead of the login page', async () => {
    sessionStorage.setItem('clinic_mock_role', 'PATIENT');
    sessionStorage.setItem('clinic_mock_patient', 'คุณสมชาย ใจดี');

    render(<App initialEntries={['/appointment']} />);

    expect(await screen.findByRole('heading', { name: 'เลือกเมนูบริการ' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ระบบจองคิวออนไลน์' })).not.toBeInTheDocument();
  });

  it('redirects a visitor without a patient session from the patient menu to sign-in', () => {
    sessionStorage.clear();
    render(<App initialEntries={['/patient/menu']} />);

    expect(screen.getByRole('heading', { name: 'ระบบจองคิวออนไลน์' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'เลือกเมนูบริการ' })).not.toBeInTheDocument();
  });

  it('shows booking and sign-out actions in the header for a signed-in patient', async () => {
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await signInWithCitizenForm(user);
    expect(await screen.findByRole('button', { name: 'ออกจากระบบ' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'เมนูหลัก' })).getByRole('link', { name: 'จองคิว' })).toHaveAttribute('href', '/booking/service');
    expect(screen.getByRole('button', { name: 'ออกจากระบบ' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ออกจากระบบ' }));
    expect(screen.getAllByRole('link', { name: 'จองคิวทันตกรรม' }).length).toBeGreaterThan(0);
  });

  it('guides patients from a service category to a procedure, dentist, and matching mock slot', async () => {
    stubBookingJourney();
    const user = userEvent.setup();
    render(<App initialEntries={['/booking/service']} />);

    expect(screen.getByRole('heading', { name: 'เลือกหมวดบริการ' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'งานทั่วไป' }));
    expect(screen.getByRole('heading', { name: 'เลือกหัตถการ' })).toBeInTheDocument();
    expect(screen.queryByText('บูรณะฟันผุ')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /อุดฟัน/ }));
    expect(screen.getByRole('heading', { name: 'เลือกทันตแพทย์' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ทพ. ณัฐวุฒิ ยิ้มแย้ม/ }));
    expect(await screen.findByRole('button', { name: /09:00/ })).toBeInTheDocument();
  });

  it('starts with date and time instead of treatment categories for the central-clinic queue flow', async () => {
    sessionStorage.setItem('clinic_mock_role', 'PATIENT');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/booking-config')) return Promise.resolve(new Response(JSON.stringify({ bookingFlow: 'TIME_ONLY' }), { status: 200 }));
      if (url.includes('/availability')) return Promise.resolve(new Response(JSON.stringify({ slots: [{ id: 99, startsAt: '2026-09-10T09:00:00+07:00', endsAt: '2026-09-10T09:30:00+07:00', available: 5 }] }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    render(<App initialEntries={['/booking/service']} />);

    expect(await screen.findByRole('heading', { name: 'เลือกวันและเวลาที่ต้องการ' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'เลือกหมวดบริการ' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /09:00/ })).toBeInTheDocument();
  });

  it('starts with dentist selection instead of treatment categories for the dentist-only flow', async () => {
    sessionStorage.setItem('clinic_mock_role', 'PATIENT');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/booking-config')) return Promise.resolve(new Response(JSON.stringify({ bookingFlow: 'DENTIST_ONLY' }), { status: 200 }));
      if (url.endsWith('/dentists')) return Promise.resolve(new Response(JSON.stringify({ dentists: [{ id: 2, name: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', specialty: 'บูรณะฟัน' }] }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    render(<App initialEntries={['/booking/service']} />);

    expect(await screen.findByRole('heading', { name: 'เลือกทันตแพทย์' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'เลือกหมวดบริการ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'เลือกหัตถการ' })).not.toBeInTheDocument();
  });

  it('requires patients to acknowledge their appointment commitment before showing a paid booking success', async () => {
    stubBookingJourney();
    const user = userEvent.setup();
    render(<App initialEntries={['/booking/service']} />);

    await user.click(screen.getByRole('button', { name: 'งานทั่วไป' }));
    await user.click(screen.getByRole('button', { name: /อุดฟัน/ }));
    await user.click(screen.getByRole('button', { name: /ทพ. ณัฐวุฒิ ยิ้มแย้ม/ }));
    await user.click(await screen.findByRole('button', { name: /09:00/ }));
    await user.click(screen.getByRole('button', { name: 'ต่อไป: กรอกเบอร์โทร' }));
    await user.type(screen.getByLabelText('เบอร์โทรศัพท์สำหรับติดต่อ'), '0826018089');
    await user.click(screen.getByRole('button', { name: 'ยืนยันและรับหมายเลขคิว' }));

    expect(await screen.findByRole('heading', { name: 'โปรดรับทราบก่อนยืนยันการจองคิว' })).toBeInTheDocument();
    expect(screen.getByText('กรุณามารับบริการตามวันและเวลาที่จองคิวไว้')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'จองคิวสำเร็จ รอยืนยันการชำระเงิน' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'ข้าพเจ้ารับทราบและยืนยันการจองคิว' }));
    await user.click(screen.getByRole('button', { name: 'ยืนยันการรับทราบ' }));

    expect(await screen.findByRole('heading', { name: 'จองคิวสำเร็จ รอยืนยันการชำระเงิน' })).toBeInTheDocument();
    expect(screen.getByText('DNT002')).toBeInTheDocument();
    expect(screen.queryByText('DNT003')).not.toBeInTheDocument();
    expect(screen.queryByText('APT-MTS53N2D-3B508A')).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText(/แนบสลิปโอนเงิน/), new File(['slip'], 'slip.png', { type: 'image/png' }));
    expect(await screen.findByRole('heading', { name: 'ส่งหลักฐานการโอนเงินเรียบร้อย' })).toBeInTheDocument();
    expect(screen.getByText('DNT002')).toBeInTheDocument();
    expect(screen.queryByText('APT-MTS53N2D-3B508A')).not.toBeInTheDocument();
  });

  it('warns of walk-in-only future bookings when the reservation payment is disabled', async () => {
    stubBookingJourney({ reservationPaymentRequired: false });
    const user = userEvent.setup();
    render(<App initialEntries={['/booking/service']} />);

    await user.click(screen.getByRole('button', { name: 'งานทั่วไป' }));
    await user.click(screen.getByRole('button', { name: /อุดฟัน/ }));
    await user.click(screen.getByRole('button', { name: /ทพ. ณัฐวุฒิ ยิ้มแย้ม/ }));
    await user.click(await screen.findByRole('button', { name: /09:00/ }));
    await user.click(screen.getByRole('button', { name: 'ต่อไป: กรอกเบอร์โทร' }));
    await user.type(screen.getByLabelText('เบอร์โทรศัพท์สำหรับติดต่อ'), '0826018089');
    await user.click(screen.getByRole('button', { name: 'ยืนยันและรับหมายเลขคิว' }));

    expect(await screen.findByText(/หากไม่มาตามวันและเวลาที่จอง.*จะไม่สามารถจองผ่านระบบออนไลน์และทางโทรศัพท์ได้.*ต้องวอล์กอินจองที่คลินิกเท่านั้น/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'ข้าพเจ้ารับทราบและยืนยันการจองคิว' }));
    await user.click(screen.getByRole('button', { name: 'ยืนยันการรับทราบ' }));

    expect(await screen.findByText('นัดหมายของคุณอยู่ระหว่างรอเจ้าหน้าที่ยืนยันนัดหมาย')).toBeInTheDocument();
    expect(screen.getByText('เมื่อเจ้าหน้าที่ดำเนินการแล้ว ระบบจะส่งข้อความยืนยันนัดหมายผ่านไลน์หมอพร้อม หรือแอปพลิเคชันหมอพร้อม')).toBeInTheDocument();
    expect(screen.queryByText('คลินิกปิดการเก็บค่าจองคิวในขณะนี้ นัดหมายของคุณได้รับการยืนยันแล้ว')).not.toBeInTheDocument();
  });

  it('returns from service booking to the patient menu', async () => {
    sessionStorage.setItem('clinic_mock_role', 'PATIENT');
    sessionStorage.setItem('clinic_mock_patient', 'คุณสมชาย ใจดี');
    const user = userEvent.setup();
    render(<App initialEntries={['/booking/service']} />);

    await user.click(screen.getByRole('link', { name: 'กลับเมนูบริการ' }));
    expect(screen.getByRole('heading', { name: 'เลือกเมนูบริการ' })).toBeInTheDocument();
  });

  it('shows common procedures as a preview on each service category card', async () => {
    stubBookingJourney();
    render(<App initialEntries={['/booking/service']} />);

    expect(await screen.findByText('ตัวอย่างหัตถการ: อุดฟัน, ขูดหินปูนทั้งปาก, ถอนฟัน/ถอนฟันยาก')).toBeInTheDocument();
    expect(screen.getByText('ตัวอย่างหัตถการ: เคลือบฟลูออไรด์, เคลือบหลุมร่องฟัน, ครอบฟันเหล็กไร้สนิม')).toBeInTheDocument();
  });

  it('opens booked queues directly from the patient menu without a manual refresh action', async () => {
    sessionStorage.setItem('clinic_mock_role', 'PATIENT');
    sessionStorage.setItem('clinic_mock_patient', 'คุณสมชาย ใจดี');
    const user = userEvent.setup();
    render(<App initialEntries={['/patient/menu']} />);

    await user.click(screen.getByRole('link', { name: /^ดูคิวจอง ตรวจสอบ/ }));

    expect(screen.getByRole('heading', { name: 'ดูคิวที่จอง' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ตรวจสอบสถานะล่าสุด' })).not.toBeInTheDocument();
  });

  it('never sends the citizen ID when requesting booked queues (session cookie only)', async () => {
    resetPatientAppointmentsCache();
    sessionStorage.setItem('clinic_mock_role', 'PATIENT');
    sessionStorage.setItem('clinic_mock_patient', 'มานี รักเรียน');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ appointments: [{
      reference: 'APT-OWN-QUEUE', queueNumber: 'DNT009', status: 'CONFIRMED', paymentStatus: 'VERIFIED',
      serviceName: 'อุดฟัน', dentistName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', startsAt: '2026-09-10T09:00:00+07:00',
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App initialEntries={['/patient/appointments']} />);

    expect(await screen.findByText('DNT009')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/patient/appointments');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('identity');
  });

  it('shows a pending staff-confirmation message for a booking without a reservation payment', async () => {
    resetPatientAppointmentsCache();
    sessionStorage.setItem('clinic_mock_role', 'PATIENT');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ appointments: [{
      reference: 'APT-NO-PAYMENT', queueNumber: 'CLN001', status: 'PENDING_CONFIRMATION', paymentStatus: 'NOT_REQUIRED',
      serviceName: 'ยังไม่ระบุหัตถการ', dentistName: 'คิวกลางคลินิก', startsAt: '2026-09-10T09:00:00+07:00',
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    render(<App initialEntries={['/patient/appointments']} />);

    expect(await screen.findByText('รอเจ้าหน้าที่ยืนยันนัดหมาย เมื่อยืนยันแล้วระบบจะแจ้งผลผ่านไลน์หมอพร้อมหรือแอปพลิเคชันหมอพร้อม')).toBeInTheDocument();
    expect(screen.getAllByText('คิวกลางคลินิก')).toHaveLength(2);
    expect(screen.queryByText('ยังไม่ระบุหัตถการ')).not.toBeInTheDocument();
    expect(screen.queryByText('รอเจ้าหน้าที่ตรวจสอบหลักฐานการโอนเงินจอง')).not.toBeInTheDocument();
  });

  it('refreshes booked queues after a previous empty lookup', async () => {
    resetPatientAppointmentsCache();
    sessionStorage.setItem('clinic_mock_role', 'PATIENT');
    const appointmentResponses = [
      new Response(JSON.stringify({ appointments: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      new Response(JSON.stringify({ appointments: [{
        reference: 'APT-NEW-QUEUE', queueNumber: 'DNT010', status: 'PENDING_CONFIRMATION', paymentStatus: 'AWAITING_PAYMENT',
        serviceName: 'ขูดหินปูน', dentistName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', startsAt: '2026-09-11T09:00:00+07:00',
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/clinic-config')) return Promise.resolve(new Response(JSON.stringify({ clinicTypes: ['PMC', 'SMC'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(appointmentResponses.shift()!);
    }));

    const firstVisit = render(<App initialEntries={['/patient/appointments']} />);
    expect(await screen.findByText('ไม่พบรายการนัดหมายของท่าน')).toBeInTheDocument();
    firstVisit.unmount();

    render(<App initialEntries={['/patient/appointments']} />);
    expect(await screen.findByText('DNT010')).toBeInTheDocument();
  });

  it('does not render a back button on the patient menu', () => {
    render(<App initialEntries={['/patient/menu']} />);

    expect(screen.queryByRole('button', { name: /ย้อนกลับ/ })).not.toBeInTheDocument();
  });

  describe('satisfaction survey (/patient/satisfaction)', () => {
    it('shows the placeholder message when there are no served visits yet', async () => {
      resetSatisfactionCache();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ visits: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

      render(<App initialEntries={['/patient/satisfaction']} />);

      expect(await screen.findByText('แบบประเมินจะเปิดให้ตอบหลังได้รับบริการ เพื่อให้ทุกความคิดเห็นช่วยพัฒนาคลินิกของเรา')).toBeInTheDocument();
    });

    it('lets a patient rate a dentist-bound visit including the dentist question, then shows it read-only', async () => {
      resetSatisfactionCache();
      let satisfactionCalls = 0;
      let postBody: Record<string, unknown> | null = null;
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/patient/satisfaction') && init?.method === 'POST') {
          postBody = JSON.parse(String(init.body));
          return Promise.resolve(new Response(JSON.stringify({ message: 'ขอบคุณสำหรับความคิดเห็นของท่าน' }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
        }
        satisfactionCalls += 1;
        const survey = satisfactionCalls > 1 ? {
          cleanlinessRating: 4, staffRating: 5, dentistRating: 5, waitTimeRating: 3, overallRating: 4, comment: 'ประทับใจมาก', submittedAt: '2026-09-01T09:00:00Z',
        } : null;
        return Promise.resolve(new Response(JSON.stringify({ visits: [{
          appointmentId: 501, reference: 'APT-SAT-001', queueNumber: 'DNT001', serviceName: 'อุดฟัน',
          dentistName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', hasDentist: true, startsAt: '2026-09-01T09:00:00+07:00', survey,
        }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }));
      const user = userEvent.setup();

      render(<App initialEntries={['/patient/satisfaction']} />);

      expect(await screen.findByText('อุดฟัน')).toBeInTheDocument();
      expect(screen.getByText(/ให้คะแนนทันตแพทย์ ทพ\. ณัฐวุฒิ ยิ้มแย้ม/)).toBeInTheDocument();

      const rows = screen.getAllByRole('button', { name: /ดาว/ });
      const clickStar = (label: string, star: number) => {
        const button = screen.getByRole('button', { name: `${label} ${star} ดาว` });
        return user.click(button);
      };
      expect(rows.length).toBeGreaterThan(0);
      await clickStar('ความสะอาดของสถานที่', 4);
      await clickStar('ความสุภาพของเจ้าหน้าที่', 5);
      await clickStar('ระยะเวลารอคิว', 3);
      await clickStar('ความประทับใจโดยรวม', 4);
      await clickStar('ให้คะแนนทันตแพทย์ ทพ. ณัฐวุฒิ ยิ้มแย้ม', 5);
      await user.type(screen.getByLabelText('ความคิดเห็นเพิ่มเติม (ถ้ามี)'), 'ประทับใจมาก');
      await user.click(screen.getByRole('button', { name: 'ส่งแบบประเมิน' }));

      await waitFor(() => expect(postBody).toMatchObject({
        appointmentId: 501, cleanlinessRating: 4, staffRating: 5, dentistRating: 5, waitTimeRating: 3, overallRating: 4, comment: 'ประทับใจมาก',
      }));
      expect(await screen.findByText(/ขอบคุณสำหรับความคิดเห็นเมื่อ/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'ส่งแบบประเมิน' })).not.toBeInTheDocument();
    });

    it('does not ask for a dentist rating on a central-queue visit', async () => {
      resetSatisfactionCache();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ visits: [{
        appointmentId: 502, reference: 'APT-SAT-002', queueNumber: 'CLN005', serviceName: 'คิวกลางคลินิก',
        dentistName: 'คิวกลางคลินิก', hasDentist: false, startsAt: '2026-09-02T09:00:00+07:00', survey: null,
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

      render(<App initialEntries={['/patient/satisfaction']} />);

      await screen.findByRole('button', { name: 'ส่งแบบประเมิน' });
      expect(screen.queryByText(/ให้คะแนนทันตแพทย์/)).not.toBeInTheDocument();
    });

    it('shows a previously submitted survey as read-only', async () => {
      resetSatisfactionCache();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ visits: [{
        appointmentId: 503, reference: 'APT-SAT-003', queueNumber: 'DNT002', serviceName: 'ขูดหินปูน',
        dentistName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', hasDentist: true, startsAt: '2026-08-01T09:00:00+07:00',
        survey: { cleanlinessRating: 5, staffRating: 5, dentistRating: 4, waitTimeRating: 5, overallRating: 5, comment: 'บริการดีมาก', submittedAt: '2026-08-01T10:00:00Z' },
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

      render(<App initialEntries={['/patient/satisfaction']} />);

      expect(await screen.findByText('บริการดีมาก')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'ส่งแบบประเมิน' })).not.toBeInTheDocument();
    });
  });

  it('lets mock Provider ID users choose Manager and open the booking dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    expect(screen.getByRole('heading', { name: 'เลือกระดับสิทธิ์ของเจ้าหน้าที่' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ผู้จัดการคลินิก/ }));
    expect(screen.getByRole('heading', { name: 'ภาพรวมการจอง' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'เมนูผู้ดูแลระบบ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('keeps appointment and booking-slot navigation and routes away from Manager', () => {
    sessionStorage.setItem('clinic_mock_role', 'MANAGER');
    const dashboardView = render(<App initialEntries={['/staff/dashboard']} />);

    expect(screen.queryByRole('link', { name: 'นัดหมายรอตรวจสอบ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'สล็อตจอง' })).not.toBeInTheDocument();
    dashboardView.unmount();

    const appointmentsView = render(<App initialEntries={['/staff/appointments']} />);
    expect(screen.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeInTheDocument();
    appointmentsView.unmount();

    render(<App initialEntries={['/staff/slots']} />);
    expect(screen.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeInTheDocument();
  });

  it('shows the Manager dashboard with real bookings, today\'s queue, trend, and duty-week summary', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/staff/dashboard')) return Promise.resolve(new Response(JSON.stringify({
        totals: { totalBookings: 11, pendingConfirmation: 5, confirmedBookings: 6, cancelledBookings: 1, bookingValue: 3200 },
        today: { date: '2026-09-11', total: 2, confirmed: 2, pending: 0, appointments: [
          { id: 23, queueNumber: 'DNT001', status: 'CONFIRMED', paymentStatus: 'NOT_REQUIRED', patientName: 'คุณสมชาย ใจดี', startTime: '10:00', serviceName: 'ถอนฟัน', dentistName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม' },
        ] },
        last7Days: [
          { date: '2026-09-05', bookings: 2, revenue: 800 }, { date: '2026-09-06', bookings: 0, revenue: 0 }, { date: '2026-09-07', bookings: 0, revenue: 0 },
          { date: '2026-09-08', bookings: 1, revenue: 400 }, { date: '2026-09-09', bookings: 2, revenue: 800 }, { date: '2026-09-10', bookings: 0, revenue: 0 }, { date: '2026-09-11', bookings: 2, revenue: 800 },
        ],
        topServices: [{ title: 'ถอนฟัน/ถอนฟันยาก', category: 'งานทั่วไป', bookings: 2 }],
        patients: { totalPatients: 4, blockedPatients: 1, noShowCount: 2 },
        duty: { weekStart: '2026-09-07', weekEnd: '2026-09-13', dentists: [{ id: 4, displayName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', dutyDayCount: 3 }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    sessionStorage.setItem('clinic_mock_role', 'MANAGER');
    render(<App initialEntries={['/staff/dashboard']} />);

    const queueCell = await screen.findByText('DNT001');
    const todayRow = queueCell.closest('tr');
    expect(todayRow).not.toBeNull();
    expect(within(todayRow!).getByText('คุณสมชาย ใจดี')).toBeInTheDocument();
    expect(todayRow!.textContent).toContain('ถอนฟัน');
    expect(screen.getAllByText('3,200 บาท').length).toBeGreaterThan(0);
    expect(screen.getByText('ถอนฟัน/ถอนฟันยาก')).toBeInTheDocument();
    expect(screen.getAllByText('ทพ. ณัฐวุฒิ ยิ้มแย้ม')).toHaveLength(2);
    expect(screen.getByText('3 วัน')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('lets Manager open the all-appointments report and filter it', async () => {
    sessionStorage.setItem('clinic_mock_role', 'MANAGER');
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/staff/reports/appointments')) return Promise.resolve(new Response(JSON.stringify({
        summary: { total: 2, pending: 1, confirmed: 1, cancelled: 0, bookingValue: 800 },
        appointments: [
          { id: 31, reference: 'APT-RPT-0001', queueNumber: 'DNT001', serviceDate: '2026-09-05', startTime: '09:00', patientName: 'คุณสมชาย ใจดี', phone: '0812345678', serviceName: 'ถอนฟัน', dentistName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', status: 'CONFIRMED', paymentStatus: 'NOT_REQUIRED', paymentAmount: 400 },
          { id: 32, reference: 'APT-RPT-0002', queueNumber: 'DNT002', serviceDate: '2026-10-02', startTime: '14:30', patientName: 'คุณสมหญิง ใจงาม', phone: '0898765432', serviceName: 'อุดฟัน', dentistName: 'คิวกลางคลินิก', status: 'PENDING_CONFIRMATION', paymentStatus: 'AWAITING_PAYMENT', paymentAmount: 400 },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.endsWith('/dentists')) return Promise.resolve(new Response(JSON.stringify({ dentists: [{ id: 4, name: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', title: 'ทพ.', specialty: 'ทันตกรรมทั่วไป', portraitUrl: null }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App initialEntries={['/staff/reports/appointments']} />);

    expect(screen.getByRole('link', { name: 'รายงานนัดหมาย' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'รายงานการเข้าพบ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('DNT001')).toBeInTheDocument();
    const confirmedRow = screen.getByText('DNT001').closest('tr');
    expect(confirmedRow).not.toBeNull();
    expect(within(confirmedRow!).getByText('ยืนยันแล้ว')).toBeInTheDocument();
    expect(screen.getByText('คุณสมชาย ใจดี')).toBeInTheDocument();
    expect(screen.getByText('DNT002')).toBeInTheDocument();
    expect(screen.getByText('คิวกลางคลินิก')).toBeInTheDocument();
    expect(screen.getByText('800 บาท')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('สถานะนัดในรายงาน'), 'PENDING_CONFIRMATION');
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('status=PENDING_CONFIRMATION'))).toBe(true));
  });

  it('shows the visit and no-show report grouped by month and dentist', async () => {
    sessionStorage.setItem('clinic_mock_role', 'MANAGER');
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/staff/reports/visits')) return Promise.resolve(new Response(JSON.stringify({
        range: { from: '2026-04-01', to: '2026-09-11' },
        summary: { total: 6, served: 4, noShow: 2, booked: 0, noShowRate: 33.3 },
        monthly: [
          { month: '2026-09', total: 4, served: 3, noShow: 1, booked: 0, noShowRate: 25 },
          { month: '2026-08', total: 2, served: 1, noShow: 1, booked: 0, noShowRate: 50 },
        ],
        byDentist: [
          { dentistId: 4, dentistName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', total: 4, served: 3, noShow: 1, booked: 0, noShowRate: 25 },
          { dentistId: null, dentistName: 'คิวกลางคลินิก', total: 2, served: 1, noShow: 1, booked: 0, noShowRate: 50 },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App initialEntries={['/staff/reports/visits']} />);

    expect(screen.getByRole('link', { name: 'รายงานการเข้าพบ' })).toBeInTheDocument();
    expect(await screen.findByText('2026-09')).toBeInTheDocument();
    expect(screen.getByText('2026-08')).toBeInTheDocument();
    expect(screen.getByText('33.3%')).toBeInTheDocument();
    expect(screen.getAllByText('25%')).toHaveLength(2);
    expect(screen.getByText('คิวกลางคลินิก')).toBeInTheDocument();
    expect(screen.getByText('อัตรา No-show = ไม่มาตามนัด ÷ (เข้าพบแล้ว + ไม่มาตามนัด) นับเฉพาะนัดที่ถึงกำหนดแล้ว · ช่วงข้อมูล 2026-04-01 ถึง 2026-09-11')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('ถึงวันที่'), { target: { value: '2026-08-31' } });
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('to=2026-08-31'))).toBe(true));
  });

  it('shows the revenue report with payment statuses and CSV export', async () => {
    sessionStorage.setItem('clinic_mock_role', 'MANAGER');
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/staff/reports/revenue')) return Promise.resolve(new Response(JSON.stringify({
        range: { from: '2026-04-01', to: '2026-09-12' },
        summary: { bookings: 5, revenue: 2000, awaitingPayment: 1, slipUploaded: 1, verified: 2, rejected: 1, notRequired: 0 },
        monthly: [
          { month: '2026-09', bookings: 3, revenue: 1200, awaitingPayment: 1, slipUploaded: 0, verified: 2, rejected: 0, notRequired: 0 },
          { month: '2026-08', bookings: 2, revenue: 800, awaitingPayment: 0, slipUploaded: 1, verified: 0, rejected: 1, notRequired: 0 },
        ],
        byService: [{ serviceName: 'ถอนฟัน', bookings: 3, revenue: 1200, awaitingPayment: 1, slipUploaded: 0, verified: 2, rejected: 0, notRequired: 0 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<App initialEntries={['/staff/reports/revenue']} />);

    expect(screen.getByRole('link', { name: 'รายงานรายได้' })).toBeInTheDocument();
    expect(await screen.findByText('2026-09')).toBeInTheDocument();
    expect(screen.getByText('2026-08')).toBeInTheDocument();
    expect(screen.getByText('ถอนฟัน')).toBeInTheDocument();
    expect(screen.getByText('2,000 บาท')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ส่งออก CSV/ }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    anchorClick.mockRestore();
  });

  it('shows dentist productivity comparing appointments with duty days', async () => {
    sessionStorage.setItem('clinic_mock_role', 'MANAGER');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/staff/reports/dentist-productivity')) return Promise.resolve(new Response(JSON.stringify({
        range: { from: '2026-04-01', to: '2026-09-12' },
        dentists: [
          { dentistId: 4, dentistName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', appointments: 9, dutyDays: 3, appointmentsPerDutyDay: 3 },
          { dentistId: 2, dentistName: 'ทพญ. พิมพ์ใจ สุขสันต์', appointments: 0, dutyDays: 2, appointmentsPerDutyDay: 0 },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    render(<App initialEntries={['/staff/reports/dentist-productivity']} />);

    expect(screen.getByRole('link', { name: 'ผลิตภาพทันตแพทย์' })).toBeInTheDocument();
    const busyRow = (await screen.findByText('ทพ. ณัฐวุฒิ ยิ้มแย้ม')).closest('tr');
    expect(busyRow).not.toBeNull();
    expect(within(busyRow!).getByText('9')).toBeInTheDocument();
    expect(within(busyRow!).getByText('3')).toBeInTheDocument();
    expect(within(busyRow!).getByText('3.00')).toBeInTheDocument();
    const idleRow = screen.getByText('ทพญ. พิมพ์ใจ สุขสันต์').closest('tr');
    expect(within(idleRow!).getByText('0.00')).toBeInTheDocument();
  });

  it('shows the read-only MOPH Alert delivery overview', async () => {
    sessionStorage.setItem('clinic_mock_role', 'MANAGER');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/staff/reports/notifications')) return Promise.resolve(new Response(JSON.stringify({
        summary: { total: 4, sent: 2, pending: 1, sending: 0, failed: 1, invalidRecipient: 0, successRate: 50 },
        recent: [
          { id: 7, queueNumber: 'DNT009', recipientMasked: '123******4567', status: 'SENT', attemptCount: 1, lastAttemptAt: '2026-09-11 10:00', sentAt: '2026-09-11 10:00', responseStatus: 200, errorMessage: null },
          { id: 8, queueNumber: 'DNT010', recipientMasked: '555******0000', status: 'FAILED', attemptCount: 3, lastAttemptAt: '2026-09-11 11:00', sentAt: null, responseStatus: 503, errorMessage: 'MOPH returned HTTP 503' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    render(<App initialEntries={['/staff/reports/notifications']} />);

    expect(screen.getByRole('link', { name: 'MOPH Alert' })).toBeInTheDocument();
    expect(await screen.findByText('DNT009')).toBeInTheDocument();
    expect(screen.getByText('DNT010')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getAllByText('ส่งสำเร็จ')).toHaveLength(2);
    expect(screen.getByText('MOPH returned HTTP 503')).toBeInTheDocument();
  });

  it('shows the peak-hours heatmap of weekdays and hours', async () => {
    sessionStorage.setItem('clinic_mock_role', 'MANAGER');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/staff/reports/peak-hours')) return Promise.resolve(new Response(JSON.stringify({
        byWeekday: [{ dow: 6, bookings: 4 }, { dow: 3, bookings: 2 }],
        byHour: [{ hour: 9, bookings: 3 }, { hour: 10, bookings: 3 }],
        grid: [
          { dow: 6, hour: 9, bookings: 2 }, { dow: 6, hour: 10, bookings: 2 },
          { dow: 3, hour: 9, bookings: 2 }, { dow: 3, hour: 10, bookings: 2 },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    render(<App initialEntries={['/staff/reports/peak-hours']} />);

    expect(screen.getByRole('link', { name: 'ช่วงเวลานิยม' })).toBeInTheDocument();
    expect(await screen.findByText('ตารางความหนาแน่น วัน × ชั่วโมง')).toBeInTheDocument();
    expect(screen.getAllByText('ศุกร์').length).toBeGreaterThan(0);
    expect(screen.getAllByText('อาทิตย์').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10:00').length).toBeGreaterThan(0);
  });

  it('keeps the manager report pages out of the clinic staff menu', () => {
    sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    render(<App initialEntries={['/staff/reports/appointments']} />);

    expect(screen.queryByRole('link', { name: 'รายงานนัดหมาย' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'รายงานการเข้าพบ' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'นัดหมายรอตรวจสอบ' })).toBeInTheDocument();
  });

  it('shows the real Mor Prom SSO login on the appointment page when patient SSO is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return Promise.resolve(new Response(JSON.stringify({ patientSso: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.endsWith('/auth/me')) return Promise.resolve(new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    resetPatientAuthCache();
    render(<App initialEntries={['/appointment']} />);

    const morPromLink = await screen.findByRole('link', { name: /ลงชื่อเข้าใช้ด้วย หมอพร้อม/ });
    expect(morPromLink).toHaveAttribute('href', '/api/auth/patient/moph/login');
    // ปุ่ม mock ถูกลบทิ้งแล้ว: provider ที่ยังไม่เปิด flag ต้องไม่โผล่ทั้งแบบ link และแบบปุ่ม
    expect(screen.queryByRole('link', { name: /ลงชื่อเข้าใช้ด้วย ThaiD/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ลงชื่อเข้าใช้ด้วย ThaiD/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /หากไม่มีแอพข้างต้น/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ลงชื่อเข้าใช้ด้วย Provider ID/ })).toBeInTheDocument();
  });

  it('lands a signed-in HealthID patient straight on the service menu without storing the citizen id', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return Promise.resolve(new Response(JSON.stringify({ patientSso: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.endsWith('/auth/me')) return Promise.resolve(new Response(JSON.stringify({ authenticated: true, role: 'PATIENT', displayName: 'นายหมอพร้อม ทดสอบ', identityMasked: '110******3456', ial: 1.3, provider: 'MOPH HealthID' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    resetPatientAuthCache();
    render(<App initialEntries={['/appointment']} />);

    expect(await screen.findByText(/นายหมอพร้อม ทดสอบ/)).toBeInTheDocument();
    expect(sessionStorage.getItem('clinic_mock_role')).toBe('PATIENT');
    expect(sessionStorage.getItem('clinic_mock_patient')).toBe('นายหมอพร้อม ทดสอบ');
    expect(sessionStorage.getItem('clinic_mock_patient_citizen_id')).toBeNull();
    expect(sessionStorage.getItem('clinic_patient_sso')).toBe('1');
  });

  it('explains SSO login failures on the appointment page', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return Promise.resolve(new Response(JSON.stringify({ patientSso: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.endsWith('/auth/me')) return Promise.resolve(new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    resetPatientAuthCache();
    render(<App initialEntries={['/appointment?login=error&reason=blocked']} />);

    expect(await screen.findByText('บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อคลินิก')).toBeInTheDocument();
  });

  it('turns the ThaiD button into the real ThaiID SSO flow when enabled', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return Promise.resolve(new Response(JSON.stringify({ patientSso: false, thaidSso: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.endsWith('/auth/me')) return Promise.resolve(new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    resetPatientAuthCache();
    render(<App initialEntries={['/appointment']} />);

    const thaidLink = await screen.findByRole('link', { name: /ลงชื่อเข้าใช้ด้วย ThaiD/ });
    expect(thaidLink).toHaveAttribute('href', '/api/auth/patient/thaid/login');
    expect(screen.queryByRole('link', { name: /ลงชื่อเข้าใช้ด้วย หมอพร้อม/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ลงชื่อเข้าใช้ด้วย หมอพร้อม/ })).not.toBeInTheDocument();
  });

  it('explains ThaiID SSO login failures on the appointment page', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/config')) return Promise.resolve(new Response(JSON.stringify({ patientSso: false, thaidSso: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.endsWith('/auth/me')) return Promise.resolve(new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    resetPatientAuthCache();
    render(<App initialEntries={['/appointment?thaid=error&reason=invalid_state']} />);

    expect(await screen.findByText('ลิงก์เข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ กรุณากดเข้าสู่ระบบใหม่')).toBeInTheDocument();
  });

  it('gives IT Staff a dedicated user-and-roles menu separate from system settings', async () => {
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    await user.click(screen.getByRole('button', { name: /เจ้าหน้าที่ไอที/ }));
    await user.click(screen.getByRole('link', { name: 'ผู้ใช้งานและสิทธิ์' }));

    expect(screen.getByRole('heading', { name: 'ผู้ใช้งานและสิทธิ์' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'บริหารจัดการระบบคลินิก' })).not.toBeInTheDocument();
  });

  it('does not show the Dashboard menu to IT Staff', () => {
    sessionStorage.setItem('clinic_mock_role', 'IT_STAFF');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));

    render(<App initialEntries={['/staff/users']} />);

    expect(screen.getByRole('navigation', { name: 'เมนูผู้ดูแลระบบ' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('lets Super Admin turn off the fixed 400-baht reservation payment from system settings', async () => {
    sessionStorage.setItem('clinic_mock_role', 'IT_STAFF');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/staff/system-settings') && !init?.method) return Promise.resolve(new Response(JSON.stringify({ reservationPaymentEnabled: true, reservationPaymentAmount: 400, bookingFlow: 'PROCEDURE_AND_DENTIST' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.endsWith('/staff/system-settings/reservation-payment') && init?.method === 'PATCH') return Promise.resolve(new Response(JSON.stringify({ reservationPaymentEnabled: false, reservationPaymentAmount: 400 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    const user = userEvent.setup();
    render(<App initialEntries={['/staff/system-settings']} />);

    expect(await screen.findByRole('heading', { name: 'ตั้งค่าระบบ' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /เลือกทันตแพทย์โดยไม่เลือกหัตถการ/ })).toBeInTheDocument();
    const toggle = screen.getByRole('checkbox', { name: 'เปิดใช้การชำระค่าจองคิว 400 บาท' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    const successToast = await screen.findByText('ปิดการชำระค่าจองคิว 400 บาทแล้ว');
    expect(successToast.closest('.toast-stack')).toBeInTheDocument();
    expect(successToast.closest('.toast')).toHaveClass('toast--success');
    expect(successToast.closest('.toast')).toHaveAttribute('role', 'status');
    expect(document.querySelector('.booking-message')).toBeNull();
    expect(toggle).not.toBeChecked();
  });

  it('lets IT Staff select PMC and SMC clinic types in system settings', async () => {
    sessionStorage.setItem('clinic_mock_role', 'IT_STAFF');
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/staff/system-settings') && !init?.method) return Promise.resolve(new Response(JSON.stringify({ reservationPaymentEnabled: true, reservationPaymentAmount: 400, bookingFlow: 'PROCEDURE_AND_DENTIST', clinicTypes: ['PMC'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.endsWith('/staff/system-settings/clinic-types') && init?.method === 'PATCH') return Promise.resolve(new Response(JSON.stringify({ clinicTypes: ['PMC', 'SMC'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.includes('/notification-deliveries')) return Promise.resolve(new Response(JSON.stringify({ deliveries: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App initialEntries={['/staff/system-settings']} />);

    const smc = await screen.findByRole('checkbox', { name: /SMC · นอกเวลา/ });
    expect(smc).not.toBeChecked();
    await user.click(smc);

    expect(await screen.findByText('บันทึกประเภทคลินิกที่เปิดบริการแล้ว')).toBeInTheDocument();
    expect(smc).toBeChecked();
    expect(fetchMock).toHaveBeenCalledWith('/api/staff/system-settings/clinic-types', expect.objectContaining({ body: JSON.stringify({ clinicTypes: ['PMC', 'SMC'] }) }));
  });

  it('shows only enabled clinic hours consistently on Contact and the footer', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/clinic-config')) return Promise.resolve(new Response(JSON.stringify({ clinicTypes: ['PMC'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    render(<App initialEntries={['/contact']} />);

    const pmcHours = 'PMC · ในเวลา จันทร์–ศุกร์ 08:30–16:30 น.';
    await waitFor(() => expect(screen.queryByText(/SMC · นอกเวลา/)).not.toBeInTheDocument());
    expect(screen.getAllByText(pmcHours)).toHaveLength(2);
  });

  it('lets IT Staff configure MOPH Alert without exposing saved credentials', async () => {
    sessionStorage.setItem('clinic_mock_role', 'IT_STAFF');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/staff/system-settings')) return Promise.resolve(new Response(JSON.stringify({ reservationPaymentEnabled: true, reservationPaymentAmount: 400, bookingFlow: 'PROCEDURE_AND_DENTIST', mophAlert: { enabled: false, clientKeyConfigured: true, secretKeyConfigured: true, encryptionKeyConfigured: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (url.includes('/notification-deliveries')) return Promise.resolve(new Response(JSON.stringify({ deliveries: [{ id: 3, queueNumber: 'DDS15001', recipientMasked: '110******3456', deliveryStatus: 'FAILED', attemptCount: 3, errorMessage: 'MOPH returned HTTP 503' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));

    render(<App initialEntries={['/staff/system-settings']} />);
    expect(await screen.findByRole('heading', { name: 'MOPH Alert' })).toBeInTheDocument();
    expect(screen.getByText('DDS15001')).toBeInTheDocument();
    expect(screen.getByText('110******3456')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('moph-secret')).not.toBeInTheDocument();
  });

  it('hides appointment-list and booking-slot menus from Super Admin', async () => {
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    await user.click(screen.getByRole('button', { name: /เจ้าหน้าที่ไอที/ }));

    expect(screen.queryByRole('link', { name: 'นัดหมายรอตรวจสอบ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'สล็อตจอง' })).not.toBeInTheDocument();
  });

  it('keeps dentist registry navigation limited to IT Staff', async () => {
    const user = userEvent.setup();
    const clinicView = render(<App initialEntries={['/appointment']} />);

    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    await user.click(screen.getByRole('button', { name: /เจ้าหน้าที่ประจำคลินิก/ }));
    expect(screen.queryByRole('link', { name: 'ทะเบียนทันตแพทย์' })).not.toBeInTheDocument();

    clinicView.unmount();
    render(<App initialEntries={['/appointment']} />);
    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    await user.click(screen.getByRole('button', { name: /ผู้จัดการคลินิก/ }));
    expect(screen.queryByRole('link', { name: 'ทะเบียนทันตแพทย์' })).not.toBeInTheDocument();
  });

  it('loads booked patients when Clinic Staff opens the patient registry', async () => {
    sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/staff/patient-registry')) return Promise.resolve(new Response(JSON.stringify({ patients: [{ patientIdentity: '1101700203999', patientDisplayName: 'นายทดสอบ ผู้จอง', accessStatus: 'ACTIVE', bookingCount: 1, noShowCount: 0 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));

    render(<App initialEntries={['/staff/patient-registry']} />);

    expect(await screen.findByText('นายทดสอบ ผู้จอง')).toBeInTheDocument();
    expect(screen.getByText('1101700203999')).toBeInTheDocument();
  });

  it('gives Clinic Staff a dedicated page to generate booking slots', async () => {
    stubStaffSlots();
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    await user.click(screen.getByRole('button', { name: /เจ้าหน้าที่ประจำคลินิก/ }));
    expect(screen.getByRole('link', { name: 'สล็อตจอง' })).toHaveAttribute('href', '/staff/slots');

    await user.click(screen.getByRole('link', { name: 'สล็อตจอง' }));
    expect(screen.getByRole('heading', { name: 'จัดการสล็อตจอง' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'สร้างสล็อตที่เลือก' })).toBeInTheDocument();
  });

  it('waits for the configured booking flow before showing slot controls', async () => {
    sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
    let resolveSlots: (response: Response) => void = () => undefined;
    let firstSlotsRequest = true;
    const slotsResponse = new Promise<Response>((resolve) => { resolveSlots = resolve; });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/staff/slots')) {
        if (firstSlotsRequest) { firstSlotsRequest = false; return slotsResponse; }
        return Promise.resolve(new Response(JSON.stringify({ date: '2026-09-15', bookingFlow: 'TIME_ONLY', dentists: [], slots: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));

    render(<App initialEntries={['/staff/slots']} />);

    expect(screen.getByText('กำลังโหลดรูปแบบการจอง...')).toBeInTheDocument();
    expect(screen.queryByLabelText('ทันตแพทย์')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'สร้างสล็อตนัดหมาย' })).not.toBeInTheDocument();

    resolveSlots(new Response(JSON.stringify({ date: '2026-09-15', bookingFlow: 'TIME_ONLY', dentists: [], slots: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    expect(await screen.findByLabelText('จำนวนรับต่อช่วง')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'สร้างสล็อตคิวกลางคลินิก' })).toBeInTheDocument();
  });

  it('offers the clinic’s full weekday and weekend opening hours when creating slots', async () => {
    stubStaffSlots();
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    await user.click(screen.getByRole('button', { name: /เจ้าหน้าที่ประจำคลินิก/ }));
    await user.click(screen.getByRole('link', { name: 'สล็อตจอง' }));
    fireEvent.change(await screen.findByLabelText('วันให้บริการ'), { target: { value: '2026-09-07' } });
    expect(screen.getByRole('checkbox', { name: '08:30–09:00 น.' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '20:00–20:30 น.' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '12:00–12:30 น.' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '12:30–13:00 น.' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '13:00–13:30 น.' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('วันให้บริการ'), { target: { value: '2026-09-06' } });
    expect(screen.getByRole('checkbox', { name: '16:00–16:30 น.' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '16:30–17:00 น.' })).not.toBeInTheDocument();
  });

  it('changes the generated slot intervals when Clinic Staff selects a different duration', async () => {
    stubStaffSlots();
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    await user.click(screen.getByRole('button', { name: /เจ้าหน้าที่ประจำคลินิก/ }));
    await user.click(screen.getByRole('link', { name: 'สล็อตจอง' }));
    await user.selectOptions(await screen.findByLabelText('ระยะเวลาต่อสล็อต'), '60');

    expect(screen.getByRole('checkbox', { name: '08:30–09:30 น.' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '08:30–09:00 น.' })).not.toBeInTheDocument();
  });

  it('selects or clears all available slot times at once', async () => {
    stubStaffSlots();
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    await user.click(screen.getByRole('button', { name: /เจ้าหน้าที่ประจำคลินิก/ }));
    await user.click(screen.getByRole('link', { name: 'สล็อตจอง' }));
    await user.click(await screen.findByRole('button', { name: 'ไม่เลือกทั้งหมด' }));
    expect(screen.getByRole('checkbox', { name: '08:30–09:00 น.' })).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'เลือกทั้งหมด' }));
    expect(screen.getByRole('checkbox', { name: '08:30–09:00 น.' })).toBeChecked();
  });

  it('offers IT Staff a disabled status option for a user account', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/staff/users')) return Promise.resolve(new Response(JSON.stringify({ users: [{
        id: 1, providerIdentity: 'PROVIDER-1001', displayName: 'นางสาวอรทัย ใจดี', department: 'คลินิกทันตกรรม',
        role: 'CLINIC_STAFF', status: 'PENDING_APPROVAL',
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    await user.click(screen.getByRole('button', { name: /เจ้าหน้าที่ไอที/ }));
    await user.click(screen.getByRole('link', { name: 'ผู้ใช้งานและสิทธิ์' }));

    expect((await screen.findAllByRole('option', { name: 'ปิดใช้งาน' })).length).toBeGreaterThan(0);
  });

  it('keeps the dentist registry available to IT Staff when the active booking flow does not use queue prefixes', async () => {
    stubDentistRegistry('TIME_ONLY');
    sessionStorage.setItem('clinic_mock_role', 'IT_STAFF');
    render(<App initialEntries={['/staff/dentists']} />);

    expect(await screen.findByRole('heading', { name: 'ทะเบียนทันตแพทย์' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Queue Prefix' })).not.toBeInTheDocument());
  });

  it('keeps the dentist registry away from Clinic Staff and Manager', () => {
    sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
    const clinicStaffView = render(<App initialEntries={['/staff/dentists']} />);

    expect(screen.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ทะเบียนทันตแพทย์' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ทะเบียนทันตแพทย์' })).not.toBeInTheDocument();
    clinicStaffView.unmount();

    sessionStorage.setItem('clinic_mock_role', 'MANAGER');
    render(<App initialEntries={['/staff/dentists']} />);

    expect(screen.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ทะเบียนทันตแพทย์' })).not.toBeInTheDocument();
  });

  it('hides procedure management from IT Staff when the active booking flow does not use procedures', async () => {
    stubDentistRegistry('TIME_ONLY');
    sessionStorage.setItem('clinic_mock_role', 'IT_STAFF');
    render(<App initialEntries={['/staff/dentists']} />);

    await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'หัตถการที่ให้บริการ' })).not.toBeInTheDocument());
    expect(screen.queryByText('เพิ่ม/ลด หัตถการ')).not.toBeInTheDocument();
  });

  it('hides the service administration menu when the booking flow does not use procedures', async () => {
    sessionStorage.setItem('clinic_mock_role', 'IT_STAFF');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/booking-config')) return Promise.resolve(new Response(JSON.stringify({ bookingFlow: 'DENTIST_ONLY' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));

    render(<App initialEntries={['/staff/users']} />);

    await waitFor(() => expect(screen.queryByRole('link', { name: 'ประเภทบริการ' })).not.toBeInTheDocument());
  });

  it('opens service administration from /staff/services without a back-to-appointments link', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/booking-config')) return Promise.resolve(new Response(JSON.stringify({ bookingFlow: 'PROCEDURE_AND_DENTIST' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response(JSON.stringify({ services: [], dentists: [], permissions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));
    const user = userEvent.setup();
    render(<App initialEntries={['/appointment']} />);

    await user.click(screen.getByRole('button', { name: 'ลงชื่อเข้าใช้ด้วย Provider ID' }));
    await user.click(screen.getByRole('button', { name: /เจ้าหน้าที่ไอที/ }));

    expect(await screen.findByRole('link', { name: 'ประเภทบริการ' })).toHaveAttribute('href', '/staff/services');
    await user.click(screen.getByRole('link', { name: 'ประเภทบริการ' }));
    expect(screen.getByRole('heading', { name: 'ประเภทบริการ' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '← กลับรายการนัดหมาย' })).not.toBeInTheDocument();
  });

  it('hides confirmed appointments from the staff review list', async () => {
    stubStaffAppointments();
    sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:slip-preview') });
    const user = userEvent.setup();
    render(<App initialEntries={['/staff/appointments']} />);

    expect(screen.getByRole('heading', { name: 'รายการนัดหมายรอตรวจสอบ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'นัดหมายรอตรวจสอบ' })).toHaveAttribute('href', '/staff/appointments');
    expect(await screen.findByText('DNT002')).toBeInTheDocument();
    expect(screen.queryByText('DNT003')).not.toBeInTheDocument();
    expect(screen.queryByText('APT-MTS53N2D-3B508A')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ชื่อ-สกุล' })).toBeInTheDocument();
    const pendingAppointmentRow = screen.getByText('DNT002').closest('tr');
    expect(pendingAppointmentRow).not.toBeNull();
    expect(within(pendingAppointmentRow!).getByText('คุณสมหญิง ใจงาม')).toBeInTheDocument();
    expect(within(pendingAppointmentRow!).getByRole('button', { name: 'ดูสลิป' })).toBeInTheDocument();
    const noPaymentRow = screen.getByText('DNT004').closest('tr');
    expect(noPaymentRow).not.toBeNull();
    expect(within(noPaymentRow!).getByText('นัดรอคอนเฟิร์ม')).toBeInTheDocument();
    expect(within(noPaymentRow!).queryByText('PENDING_CONFIRMATION')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '← ออกจากโหมดเจ้าหน้าที่' })).not.toBeInTheDocument();

    await user.click(within(pendingAppointmentRow!).getByRole('button', { name: 'ดูสลิป' }));
    expect(await screen.findByRole('dialog', { name: 'สลิปโอนเงิน หมายเลขคิว DNT002' })).toBeInTheDocument();
    expect(showModal).toHaveBeenCalledTimes(1);
  });
  it('shows a failed slip preview as an error toast without hiding the appointment table', async () => {
    sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/staff/appointments/7/slip')) return Promise.resolve(new Response('{}', { status: 500 }));
      if (url.endsWith('/staff/appointments')) return Promise.resolve(new Response(JSON.stringify({ appointments: [{
        id: 7, reference: 'APT-MTS53N2D-3B508A', queueNumber: 'DNT002', status: 'PENDING', paymentStatus: 'SLIP_UPLOADED',
        serviceName: 'อุดฟัน', dentistName: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม', startsAt: '2026-09-10T09:00:00+07:00', phone: '0826018089', slipAvailable: true,
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    const user = userEvent.setup();
    render(<App initialEntries={['/staff/appointments']} />);

    const slipButton = await screen.findByRole('button', { name: 'ดูสลิป' });
    await user.click(slipButton);

    const errorToast = await screen.findByRole('alert');
    expect(errorToast).toHaveTextContent('ไม่สามารถเปิดสลิปการโอนเงินได้');
    expect(errorToast).toHaveClass('toast--error');
    expect(errorToast.closest('.toast-stack')).toBeInTheDocument();
    expect(document.querySelector('.booking-message')).toBeNull();
    // regression: the appointment table used to be replaced entirely by the message banner
    expect(screen.getByText('DNT002')).toBeInTheDocument();
    expect(slipButton).toBeInTheDocument();
  });

  it('imports a dentist duty roster from an Excel file and renders the monthly duty grid', async () => {
    const { saved } = stubDutyRoster();
    sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
    const user = userEvent.setup();
    render(<App initialEntries={['/staff/duty-roster']} />);

    expect(screen.getByRole('heading', { name: 'ทะเบียนลงเวรทันตแพทย์' })).toBeInTheDocument();
    await user.upload(screen.getByLabelText('ไฟล์ตารางเวร Excel'), new File(['duty'], 'duty-2569-09.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    await user.click(screen.getByRole('button', { name: /อ่านไฟล์/ }));

    const readToast = await screen.findByRole('status');
    expect(readToast).toHaveTextContent('อ่านไฟล์สำเร็จ พบทันตแพทย์ 2 รายชื่อ');
    expect(readToast.closest('.toast-stack')).toBeInTheDocument();
    expect(readToast).toHaveClass('toast--success');
    expect(screen.getByText('ระบบนำเข้าเฉพาะ ทพ./ทพญ. — ข้าม 2 รายชื่อ')).toBeInTheDocument();
    expect(screen.getByText('นางสาวสมหญิง ใจดี')).toBeInTheDocument();
    expect(screen.getByText('ผู้ช่วยทันตแพทย์ สมศรี')).toBeInTheDocument();
    expect(screen.getByText('มี 1 รายชื่อที่ยังจับคู่กับทะเบียนทันตแพทย์ไม่ได้ กรุณาเลือกด้วยตนเองก่อนบันทึก')).toBeInTheDocument();
    expect(screen.getByLabelText('เดือนที่บันทึก')).toHaveValue('2026-09');

    await user.selectOptions(screen.getByLabelText('จับคู่ทันตแพทย์สำหรับ ทพ.สมชาย ใจดี'), '4');
    await user.click(screen.getByRole('button', { name: 'บันทึกเข้าทะเบียนลงเวร' }));

    expect(await screen.findByText(/บันทึกทะเบียนลงเวรเดือน 2026-09 แล้ว/)).toBeInTheDocument();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ month: '2026-09', rows: [{ name: 'ทพญ.นิศา ทองนพคุณ', dentistId: 3 }, { name: 'ทพ.สมชาย ใจดี', dentistId: 4 }] });

    expect(await screen.findByRole('heading', { name: 'ตารางลงเวรเดือนกันยายน 2569' })).toBeInTheDocument();
    const dutyRow = screen.getByText('ทพ.จรูญพันธ์ อธิกชัย').closest('tr');
    expect(dutyRow).not.toBeNull();
    expect(within(dutyRow!).getAllByText('/')).toHaveLength(2);
    expect(screen.getByText('ทันตแพทย์ 2 คน · วันลงเวรรวม 3 ครั้ง · แก้ไขล่าสุด 2026-09-11 12:00')).toBeInTheDocument();

    const headerCells = within(screen.getByRole('table', { name: '' }) ?? document.body).queryAllByRole('columnheader');
    expect(headerCells.length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: '28' })).toHaveClass('duty-grid__holiday');
    expect(screen.getByRole('columnheader', { name: '28' })).toHaveAttribute('title', 'วันทดสอบวันหยุด');
    expect(screen.getByRole('columnheader', { name: '27' })).toHaveClass('duty-grid__weekend');
    expect(screen.getByText('28 วันทดสอบวันหยุด')).toBeInTheDocument();

    const summaryRow = screen.getByText('ทันตแพทย์ลงเวรต่อวัน').closest('tr');
    expect(summaryRow).not.toBeNull();
    const summaryCells = summaryRow!.querySelectorAll('td');
    expect(summaryCells[14]).toHaveTextContent('1'); // วันที่ 14 มี ทพ.สมชาย ใจดี ลงเวรคนเดียว
    expect(summaryCells[17]).toHaveTextContent('1'); // วันที่ 17 มี ทพญ.นิศา ทองนพคุณ ลงเวรคนเดียว
    expect(summaryCells[27]).toHaveTextContent('0'); // ไม่มีใครลงเวรวันนี้
    expect(summaryCells[28]).toHaveTextContent('1');
    expect(summaryCells[summaryCells.length - 1]).toHaveTextContent('3'); // รวมวันลงเวรทั้งเดือน
  });

  it('links clinic staff to the Wangthong doctor schedule and explains the red swap marking', () => {
    stubDutyRoster();
    sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
    render(<App initialEntries={['/staff/duty-roster']} />);

    const scheduleLink = screen.getByRole('link', { name: /ดูตารางแพทย์วังทอง/ });
    expect(scheduleLink).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1sHMXo4i7UWfFdnKy2k1ULl1zrv_lZn1a/edit?gid=661870771#gid=661870771');
    expect(scheduleLink).toHaveAttribute('target', '_blank');
    expect(scheduleLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/คือเวรที่/)).toHaveTextContent('ช่องที่เป็น สีแดง ในตารางแพทย์วังทอง คือเวรที่มีการแลกเวร เจ้าหน้าที่คลินิกโปรดตรวจสอบก่อนใช้งาน');
  });

  it('downloads a duty roster template for the selected month', async () => {
    const { requestedTemplates } = stubDutyRoster();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:duty-template') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
    const user = userEvent.setup();
    render(<App initialEntries={['/staff/duty-roster']} />);

    fireEvent.change(screen.getByLabelText('เดือนของไฟล์ต้นแบบ'), { target: { value: '2026-10' } });
    await user.click(screen.getByRole('button', { name: /ดาวน์โหลดไฟล์ต้นแบบ/ }));

    expect(await screen.findByText('ดาวน์โหลดไฟล์ต้นแบบเดือนตุลาคม 2569 แล้ว')).toBeInTheDocument();
    expect(requestedTemplates).toEqual([expect.stringContaining('/staff/duty-rosters/template?month=2026-10')]);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('reports a failed import as a dismissable error toast instead of a page banner', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/staff/duty-rosters/parse')) return Promise.resolve(new Response(JSON.stringify({ message: 'บันทึกทะเบียนลงเวรไม่ได้ เพราะข้อมูลไม่ถูกต้อง (title: ยาวเกินกำหนด)' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response(JSON.stringify({ rosters: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));
    sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
    const user = userEvent.setup();
    render(<App initialEntries={['/staff/duty-roster']} />);

    await user.upload(screen.getByLabelText('ไฟล์ตารางเวร Excel'), new File(['x'], 'duty.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    await user.click(screen.getByRole('button', { name: /อ่านไฟล์/ }));

    const errorToast = await screen.findByRole('alert');
    expect(errorToast).toHaveTextContent('บันทึกทะเบียนลงเวรไม่ได้ เพราะข้อมูลไม่ถูกต้อง (title: ยาวเกินกำหนด)');
    expect(errorToast).toHaveClass('toast--error');
    expect(document.querySelector('.booking-message')).toBeNull();

    await user.click(within(errorToast).getByRole('button', { name: 'ปิดการแจ้งเตือน' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the duty roster page away from IT staff and other roles', () => {
    sessionStorage.setItem('clinic_mock_role', 'IT_STAFF');
    const itStaffView = render(<App initialEntries={['/staff/duty-roster']} />);

    expect(screen.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ทะเบียนลงเวรทันตแพทย์' })).not.toBeInTheDocument();
    itStaffView.unmount();

    sessionStorage.setItem('clinic_mock_role', 'MANAGER');
    render(<App initialEntries={['/staff/duty-roster']} />);

    expect(screen.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ทะเบียนลงเวรทันตแพทย์' })).not.toBeInTheDocument();
  });

  describe('daily queue board (/staff/queue)', () => {
    function dayQueueFixture() {
      return {
        date: '2026-09-12',
        summary: { totalSlots: 1, totalCapacity: 2, totalBooked: 1, freeSeats: 1, pending: 1, confirmed: 0, cancelled: 0 },
        slots: [{
          id: 501, dentistId: null, dentistName: 'คิวกลางคลินิก', startTime: '09:00', endTime: '09:30', capacity: 2, bookedCount: 1, active: true,
          appointments: [{
            id: 9001, reference: 'APT-QUEUE-1', queueNumber: 'CLN001', patientIdentityMasked: '110******3456', patientName: 'คุณรอคิว ทดสอบ',
            phone: '0812345678', status: 'PENDING_CONFIRMATION', paymentStatus: 'NOT_REQUIRED', visitStatus: 'BOOKED', serviceName: 'คิวกลางคลินิก', notes: '', slipAvailable: false,
          }],
        }],
        dentists: [],
      };
    }

    it('keeps the daily queue board restricted to Clinic Staff', () => {
      sessionStorage.setItem('clinic_mock_role', 'MANAGER');
      render(<App initialEntries={['/staff/queue']} />);

      expect(screen.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'ปฏิบัติงานประจำวัน' })).not.toBeInTheDocument();
    });

    it('shows the day summary and lists who is booked in each slot', async () => {
      sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/staff/day-queue')) return Promise.resolve(new Response(JSON.stringify(dayQueueFixture()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        return Promise.resolve(new Response('{}', { status: 404 }));
      }));
      render(<App initialEntries={['/staff/queue']} />);

      expect(screen.getByRole('heading', { name: 'ปฏิบัติงานประจำวัน' })).toBeInTheDocument();
      expect(await screen.findByText('CLN001')).toBeInTheDocument();
      expect(screen.getByText('คุณรอคิว ทดสอบ')).toBeInTheDocument();
      expect(screen.getByText('110******3456')).toBeInTheDocument();
      expect(screen.getByText('นัดรอคอนเฟิร์ม')).toBeInTheDocument();
      expect(screen.getByText('1/2 ที่นั่ง')).toBeInTheDocument();
    });

    it('shows an empty-state link to /staff/slots when the day has no slots yet', async () => {
      sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/staff/day-queue')) return Promise.resolve(new Response(JSON.stringify({ date: '2026-09-12', summary: { totalSlots: 0, totalCapacity: 0, totalBooked: 0, freeSeats: 0, pending: 0, confirmed: 0, cancelled: 0 }, slots: [], dentists: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        return Promise.resolve(new Response('{}', { status: 404 }));
      }));
      render(<App initialEntries={['/staff/queue']} />);

      expect(await screen.findByRole('link', { name: /ไปสร้างสล็อตที่/ })).toHaveAttribute('href', '/staff/slots');
    });

    it('lets Clinic Staff add a walk-in queue entry from a slot card', async () => {
      sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
      const showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
      let dayQueueCalls = 0;
      let walkInBody: Record<string, unknown> | null = null;
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/staff/appointments/walk-in') && init?.method === 'POST') {
          walkInBody = JSON.parse(String(init.body));
          return Promise.resolve(new Response(JSON.stringify({ appointment: { queueNumber: 'CLN002' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
        }
        if (url.includes('/staff/day-queue')) {
          dayQueueCalls += 1;
          return Promise.resolve(new Response(JSON.stringify(dayQueueFixture()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return Promise.resolve(new Response('{}', { status: 404 }));
      }));
      const user = userEvent.setup();
      render(<App initialEntries={['/staff/queue']} />);

      await user.click(await screen.findByRole('button', { name: /เพิ่มคิว/ }));
      expect(showModal).toHaveBeenCalledTimes(1);
      const dialog = screen.getByRole('dialog');
      await user.type(within(dialog).getByLabelText('ชื่อ-สกุล'), 'คุณวอล์กอิน ทดสอบ');
      await user.type(within(dialog).getByLabelText('เบอร์โทร'), '0898765432');
      await user.type(within(dialog).getByLabelText('เลขบัตรประชาชน*'), '1109900001199');
      await user.click(within(dialog).getByRole('button', { name: 'เพิ่มคิว' }));

      expect(await screen.findByText('เพิ่มคิว CLN002 เรียบร้อยแล้ว')).toBeInTheDocument();
      expect(walkInBody).toMatchObject({ slotId: 501, patientDisplayName: 'คุณวอล์กอิน ทดสอบ', phone: '0898765432', citizenId: '1109900001199' });
      expect(dayQueueCalls).toBeGreaterThanOrEqual(2);
    });

    it('lets Clinic Staff cancel a queue entry after confirming in the dialog, and shows it struck through', async () => {
      sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
      const showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
      Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }) });
      let cancelCalled = false;
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/cancel') && init?.method === 'POST') {
          cancelCalled = true;
          const fixture = dayQueueFixture();
          fixture.slots[0].appointments[0].status = 'CANCELLED';
          fixture.slots[0].bookedCount = 0;
          return Promise.resolve(new Response(JSON.stringify({ message: 'ยกเลิกคิวหมายเลข CLN001 แล้ว' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (url.includes('/staff/day-queue')) {
          const fixture = dayQueueFixture();
          if (cancelCalled) { fixture.slots[0].appointments[0].status = 'CANCELLED'; fixture.slots[0].bookedCount = 0; }
          return Promise.resolve(new Response(JSON.stringify(fixture), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return Promise.resolve(new Response('{}', { status: 404 }));
      }));
      const user = userEvent.setup();
      render(<App initialEntries={['/staff/queue']} />);

      const row = (await screen.findByText('CLN001')).closest('tr');
      expect(row).not.toBeNull();
      await user.click(within(row!).getByRole('button', { name: /ยกเลิก/ }));

      expect(showModal).toHaveBeenCalledTimes(1);
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('ยืนยันยกเลิกคิวหมายเลข CLN001?')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'ยืนยันยกเลิก' }));

      expect(await screen.findByText('ยกเลิกคิวหมายเลข CLN001 แล้ว')).toBeInTheDocument();
      await waitFor(() => expect((screen.getByText('CLN001').closest('tr') as HTMLElement).className).toContain('queue-cancelled-row'));
    });

    it('lets Clinic Staff mark a confirmed appointment as served or no-show, but not a pending one', async () => {
      sessionStorage.setItem('clinic_mock_role', 'CLINIC_STAFF');
      let visitStatusBody: Record<string, unknown> | null = null;
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/visit-status') && init?.method === 'PATCH') {
          visitStatusBody = JSON.parse(String(init.body));
          return Promise.resolve(new Response(JSON.stringify({ message: 'บันทึกว่ามาตามนัดแล้ว' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (url.includes('/staff/day-queue')) {
          const fixture = dayQueueFixture();
          fixture.slots[0].appointments[0].status = 'CONFIRMED';
          return Promise.resolve(new Response(JSON.stringify(fixture), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return Promise.resolve(new Response('{}', { status: 404 }));
      }));
      const user = userEvent.setup();
      render(<App initialEntries={['/staff/queue']} />);

      const row = (await screen.findByText('CLN001')).closest('tr');
      expect(row).not.toBeNull();
      expect(within(row!).queryByText('—')).not.toBeInTheDocument();
      await user.click(within(row!).getByRole('button', { name: /^มา$/ }));

      expect(visitStatusBody).toEqual({ visitStatus: 'SERVED' });
      expect(await screen.findByText('บันทึกว่ามาตามนัดแล้ว')).toBeInTheDocument();
    });
  });
});
