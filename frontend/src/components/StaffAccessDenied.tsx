import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export function StaffAccessDenied({ description = 'หน้านี้สงวนสิทธิ์สำหรับ IT Staff ผู้ดูแลระบบเท่านั้น' }: { description?: string }) {
  return <section className="staff-page"><div className="container"><div className="booking-card booking-payment"><ShieldCheck size={46} /><h1>ไม่มีสิทธิ์เข้าถึง</h1><p>{description}</p><Link className="button" to="/staff/dashboard">กลับหน้าปฏิบัติงาน</Link></div></div></section>;
}
