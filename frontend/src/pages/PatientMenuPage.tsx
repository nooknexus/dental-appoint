import { CalendarPlus, ClipboardCheck, HeartHandshake } from 'lucide-react';
import { Link } from 'react-router-dom';

export function PatientMenuPage() {
  const patientName = sessionStorage.getItem('clinic_mock_patient') ?? 'ผู้รับบริการ';
  return <section className="booking-page"><div className="container booking-shell"><p className="eyebrow">บัญชีผู้รับบริการ</p><h1>สวัสดี {patientName}</h1><div className="booking-card"><h2>เลือกเมนูบริการ</h2><p>กรุณาเลือกบริการที่ต้องการดำเนินการ</p><div className="patient-menu-grid">
    <Link className="patient-menu-card" to="/booking/service"><CalendarPlus size={31} /><strong>จองคิว</strong><span>เลือกบริการ ทันตแพทย์ และช่วงเวลาที่สะดวก</span></Link>
    <Link className="patient-menu-card" to="/patient/appointments"><ClipboardCheck size={31} /><strong>ดูคิวจอง</strong><span>ตรวจสอบสถานะนัดหมายและผลการยืนยัน</span></Link>
    <Link className="patient-menu-card" to="/patient/satisfaction"><HeartHandshake size={31} /><strong>ประเมินความพึงพอใจ</strong><span>ร่วมสะท้อนประสบการณ์เพื่อพัฒนาการบริการ</span></Link>
  </div></div></div></section>;
}
