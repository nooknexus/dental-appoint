import { Building2, ShieldCheck, Stethoscope } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { loadPatientAuth, usePatientAuth } from '../services/patientSession';
import { prepareMockStaffAuth } from '../services/staffAuth';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const ssoErrorMessages: Record<string, string> = {
  cancelled: 'ยกเลิกการเข้าสู่ระบบ หรือผู้ให้บริการตอบกลับไม่ครบถ้วน กรุณาลองอีกครั้ง',
  invalid_state: 'ลิงก์เข้าสู่ระบบไม่ถูกต้องหรือหมดอายุ กรุณากดเข้าสู่ระบบใหม่',
  ial: 'ระดับการยืนยันตัวตนของบัญชีนี้ยังไม่ถึงขั้นต่ำ กรุณายืนยันตัวตนด้วย Dipchip ในแอปหมอพร้อมก่อน',
  blocked: 'บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อคลินิก',
  identity: 'ไม่สามารถยืนยันเลขบัตรประชาชนจากผู้ให้บริการได้ กรุณาติดต่อคลินิก',
  disabled: 'บัญชีเจ้าหน้าที่นี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
  server: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองอีกครั้ง',
};

export function AppointmentPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParameters] = useSearchParams();
  const [showManualDetails, setShowManualDetails] = useState(false);
  const [manualError, setManualError] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const auth = usePatientAuth();
  useEffect(() => { loadPatientAuth(); }, []);
  const message = String((location.state as { message?: string } | null)?.message ?? '');
  const loginOutcomeMessage = (key: 'login' | 'thaid') => {
    const outcome = searchParameters.get(key);
    if (outcome === 'error') return ssoErrorMessages[searchParameters.get('reason') ?? 'server'] ?? ssoErrorMessages.server;
    if (outcome === 'success') return 'เข้าสู่ระบบสำเร็จ กำลังพาไปเมนูบริการ...';
    return null;
  };
  if (sessionStorage.getItem('clinic_mock_role') === 'PATIENT') {
    return <Navigate replace to="/patient/menu" />;
  }
  /** ฟอร์มกรอกเอง: ขอ session จริงจาก server (เหมือนหมอพร้อม/ThaiD) แล้วค่อยเข้าเมนู
   *  — ไม่เก็บเลขบัตรไว้ใน browser เลย เพราะทุก endpoint อ่าน identity จาก session cookie เท่านั้น */
  const enterWithoutSso = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const displayName = `${String(data.get('firstName')).trim()} ${String(data.get('lastName')).trim()}`;
    const citizenId = String(data.get('citizenId')).trim();
    setManualError('');
    setManualSubmitting(true);
    try {
      const response = await fetch(`${apiBase}/auth/patient/manual`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ citizenId, displayName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'เข้าสู่ระบบไม่สำเร็จ');
      sessionStorage.setItem('clinic_mock_role', 'PATIENT');
      sessionStorage.setItem('clinic_mock_patient', result.displayName);
      sessionStorage.setItem('clinic_patient_sso', '1');
      navigate('/patient/menu');
    } catch (error) {
      setManualError(error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setManualSubmitting(false);
    }
  };

  if (!auth.loaded) {
    return (
      <section className="auth-screen">
        <div className="auth-card" aria-labelledby="appointment-login-title">
          <div className="auth-card__brand"><Stethoscope size={19} /> สาสุข พรีเมียม Dental Clinic</div>
          <h1 id="appointment-login-title">ระบบจองคิวออนไลน์</h1>
          <p>กำลังตรวจสอบสถานะการเข้าสู่ระบบ...</p>
        </div>
      </section>
    );
  }
  if (auth.session) return <Navigate replace to="/patient/menu" />;
  const loginMessage = loginOutcomeMessage('login') ?? loginOutcomeMessage('thaid') ?? message;
  const staffLoginMessage = searchParameters.get('staff') === 'error'
    ? ssoErrorMessages[searchParameters.get('reason') ?? 'server'] ?? ssoErrorMessages.server
    : null;

  return (
    <section className="auth-screen">
      <div className="auth-card" aria-labelledby="appointment-login-title">
        <div className="auth-card__brand"><Stethoscope size={19} /> สาสุข พรีเมียม Dental Clinic</div>
        <h1 id="appointment-login-title">ระบบจองคิวออนไลน์</h1>
        <p>นัดหมายตรวจรักษาและรับบริการล่วงหน้า สะดวก รวดเร็ว</p>
        <div className="auth-card__group"><span>สำหรับประชาชน</span>
          {auth.thaidSso && <a className="auth-option auth-option--thaid" href={`${apiBase}/auth/patient/thaid/login`}><ShieldCheck size={22} /> ลงชื่อเข้าใช้ด้วย ThaiD</a>}
          {auth.patientSso && <a className="auth-option auth-option--health" href={`${apiBase}/auth/patient/moph/login`}><Building2 size={22} /> ลงชื่อเข้าใช้ด้วย หมอพร้อม</a>}
          {loginMessage && <p className="booking-message" role="alert">{loginMessage}</p>}
          <button aria-expanded={showManualDetails} className="auth-option auth-option--manual" type="button" onClick={() => setShowManualDetails(true)}><ShieldCheck size={22} /> หากไม่มีแอพข้างต้น / กรอกข้อมูลเพื่อใช้งาน</button>
          {showManualDetails && <form className="auth-manual-form" onSubmit={enterWithoutSso}><p>กรอกข้อมูลเพื่อใช้เข้าสู่ระบบจองคิว</p><label htmlFor="manual-first-name">ชื่อ<input id="manual-first-name" name="firstName" required /></label><label htmlFor="manual-last-name">นามสกุล<input id="manual-last-name" name="lastName" required /></label><label htmlFor="manual-citizen-id">เลขบัตร13หลัก<input id="manual-citizen-id" inputMode="numeric" maxLength={13} name="citizenId" pattern="[0-9]{13}" placeholder="เลขบัตรประชาชน 13 หลัก" required type="text" /></label>{manualError && <p className="booking-message" role="alert">{manualError}</p>}<button className="button" disabled={manualSubmitting} type="submit">เข้าสู่เมนูบริการ</button></form>}
        </div>
        <div className="auth-card__group auth-card__group--staff"><span>สำหรับเจ้าหน้าที่ / บุคลากร</span>
          {auth.staffProviderSso
            ? <a className="auth-option auth-option--provider" href={`${apiBase}/auth/staff/provider/login`}><Stethoscope size={22} /> ลงชื่อเข้าใช้ด้วย Provider ID</a>
            : <button className="auth-option auth-option--provider" type="button" onClick={() => { prepareMockStaffAuth(); navigate('/staff/role-select'); }}><Stethoscope size={22} /> ลงชื่อเข้าใช้ด้วย Provider ID</button>}
          {staffLoginMessage && <p className="booking-message" role="alert">{staffLoginMessage}</p>}
        </div>
      </div>
    </section>
  );
}
