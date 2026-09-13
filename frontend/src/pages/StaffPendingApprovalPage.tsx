import { Clock3, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { Toast, useToast } from '../components/Toast';
import { loadStaffAuth, refreshStaffAuth, staffLandingPath, staffLogout, useStaffAuth } from '../services/staffAuth';

export function StaffPendingApprovalPage() {
  const auth = useStaffAuth();
  const navigate = useNavigate();
  const { toast, notify, dismissToast } = useToast();
  useEffect(() => {
    loadStaffAuth();
    const timer = window.setInterval(() => { void refreshStaffAuth(); }, 180_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void refreshStaffAuth(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  const logout = async () => {
    try { await staffLogout(); navigate('/appointment', { replace: true }); }
    catch (error) { notify(error instanceof Error ? error.message : 'ไม่สามารถออกจากระบบได้ กรุณาลองใหม่', 'error'); }
  };

  if (!auth.loaded) return <section className="auth-screen"><div className="auth-card"><p>กำลังตรวจสอบสถานะบัญชี...</p></div></section>;
  if (!auth.session || auth.session.status === 'DISABLED') return <Navigate replace to="/appointment" />;
  if (auth.session.status === 'APPROVED') return <Navigate replace to={staffLandingPath(auth.session.role)} />;

  return <section className="auth-screen"><div className="auth-card" aria-labelledby="pending-approval-title">
    <div className="auth-card__brand"><ShieldCheck size={19} /> ระบบเจ้าหน้าที่คลินิก</div>
    <Clock3 aria-hidden="true" size={48} />
    <h1 id="pending-approval-title">บัญชีกำลังรอการอนุมัติ</h1>
    <p>ระบบได้รับข้อมูลจาก Provider ID แล้ว กรุณารอ IT Staff ตรวจสอบและกำหนดสิทธิ์การใช้งาน</p>
    <div className="booking-summary">
      <p><span>ผู้ใช้งาน</span><strong>{auth.session.displayName}</strong></p>
      <p><span>หน่วยงาน</span><strong>{auth.session.department}{auth.session.hcode ? ` (${auth.session.hcode})` : ''}</strong></p>
    </div>
    <div className="booking-actions">
      <button className="button" type="button" onClick={() => void refreshStaffAuth()}><RefreshCw size={17} /> ตรวจสอบสถานะอีกครั้ง</button>
      <button className="button button--ghost" type="button" onClick={() => void logout()}><LogOut size={17} /> ออกจากระบบ</button>
    </div>
    <small>ระบบจะตรวจสอบสถานะอัตโนมัติทุก 3 นาที</small>
    <Toast onDismiss={dismissToast} toast={toast} />
  </div></section>;
}
