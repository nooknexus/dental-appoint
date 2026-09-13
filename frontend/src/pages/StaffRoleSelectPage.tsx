import { BarChart3, ShieldCheck, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { selectMockStaffRole, staffLandingPath, type StaffRole } from '../services/staffAuth';

export function StaffRoleSelectPage() {
  const navigate = useNavigate();
  const selectRole = (role: StaffRole) => { selectMockStaffRole(role); navigate(staffLandingPath(role)); };
  return <section className="auth-screen"><div className="role-select-card"><button className="text-button" type="button" onClick={() => navigate('/appointment')}>← กลับ</button><h1>เลือกระดับสิทธิ์ของเจ้าหน้าที่</h1><p>เลือกบทบาทที่ต้องการใช้งานสำหรับบัญชี Provider ID นี้</p><button className="role-option" type="button" onClick={() => selectRole('CLINIC_STAFF')}><UsersRound /><span><b>เจ้าหน้าที่ประจำคลินิก / แผนก</b><small>จัดการคิว นัดหมาย และงานประจำวันของคลินิก</small></span></button><button className="role-option" type="button" onClick={() => selectRole('MANAGER')}><BarChart3 /><span><b>ผู้จัดการคลินิก (Manager)</b><small>ดูภาพรวมและยอดการจองของคลินิก</small></span></button><button className="role-option" type="button" onClick={() => selectRole('IT_STAFF')}><ShieldCheck /><span><b>เจ้าหน้าที่ไอที (Super Admin)</b><small>จัดการผู้ใช้ ตั้งค่าคลินิก และข้อมูลระบบ</small></span></button></div></section>;
}
