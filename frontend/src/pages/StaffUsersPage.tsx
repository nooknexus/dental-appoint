import { UserCheck, UsersRound } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { StaffAccessDenied } from '../components/StaffAccessDenied';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type StaffRole = 'IT_STAFF' | 'CLINIC_STAFF' | 'MANAGER';
type ApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'DISABLED';
type StaffUser = { id: number; providerIdentity: string; displayName: string; department: string; hcode?: string | null; role: StaffRole; status: ApprovalStatus };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const roleLabels: Record<StaffRole, string> = { IT_STAFF: 'IT Staff', CLINIC_STAFF: 'Clinic Staff', MANAGER: 'Manager' };
let usersSnapshot: StaffUser[] = [];
const userSubscribers = new Set<() => void>();
async function fetchUsers() { const response = await staffFetch(`${apiBase}/staff/users`, { headers: { 'x-mock-role': 'IT_STAFF' } }); return response.ok ? await response.json() as { users: StaffUser[] } : null; }
function notifyUsers() { userSubscribers.forEach((subscriber) => subscriber()); }
function refreshUsers() { void fetchUsers().then((data) => { if (data?.users) { usersSnapshot = data.users; notifyUsers(); } }).catch(() => undefined); }
function subscribeToUsers(listener: () => void) { userSubscribers.add(listener); refreshUsers(); return () => userSubscribers.delete(listener); }
function getUsersSnapshot() { return usersSnapshot; }

export function StaffUsersPage() {
  const role = getStaffRole();
  const { toast, notify, dismissToast } = useToast();
  const users = useSyncExternalStore(subscribeToUsers, getUsersSnapshot, getUsersSnapshot);

  const updateUser = async (id: number, role: StaffRole, status: ApprovalStatus) => {
    const response = await staffFetch(`${apiBase}/staff/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-mock-role': 'IT_STAFF' },
      body: JSON.stringify({ role, status }),
    });
    if (!response.ok) { notify('ไม่สามารถบันทึกข้อมูลผู้ใช้งานได้', 'error'); return false; }
    const data = await response.json() as { user: StaffUser };
    usersSnapshot = usersSnapshot.map((user) => user.id === id ? data.user : user);
    notifyUsers();
    notify(status === 'APPROVED' ? 'อนุมัติผู้ใช้งานและกำหนดสิทธิ์เรียบร้อยแล้ว' : 'บันทึกการเปลี่ยนแปลงสิทธิ์เรียบร้อยแล้ว');
    return true;
  };

  if (role !== 'IT_STAFF') return <StaffAccessDenied />;

  return <section className="staff-page"><div className="container"><p className="eyebrow">IT Staff · User Administration</p><h1>ผู้ใช้งานและสิทธิ์</h1><p>ตรวจสอบผู้ใช้งานจาก Provider ID อนุมัติการเข้าใช้ และกำหนดบทบาทก่อนใช้งานระบบหลังบ้าน</p><section className="user-admin-card"><div className="user-admin-card__heading"><UsersRound size={25} /><div><h2>ทะเบียนผู้ใช้งาน</h2><p>เฉพาะ IT Staff เท่านั้นที่อนุมัติผู้ใช้และเปลี่ยนระดับสิทธิ์ได้</p></div></div><div className="staff-table-wrap"><table><thead><tr><th>ผู้ใช้งาน</th><th>หน่วยงาน</th><th>บทบาท</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{users.map((user) => <UserRow key={`${user.id}-${user.role}-${user.status}`} user={user} onSave={updateUser} />)}</tbody></table></div></section></div><Toast onDismiss={dismissToast} toast={toast} /></section>;
}

function UserRow({ user, onSave }: { user: StaffUser; onSave: (id: number, role: StaffRole, status: ApprovalStatus) => Promise<boolean> }) {
  const [role, setRole] = useState<StaffRole>(user.role);
  const status = user.status;
  return <tr><td><b>{user.displayName}</b><br /><small>{user.providerIdentity}</small></td><td>{user.department}{user.hcode ? <><br /><small>HCODE {user.hcode}</small></> : null}</td><td><select aria-label={`บทบาท ${user.displayName}`} value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td><select aria-label={`สถานะ ${user.displayName}`} value={status} onChange={(event) => void onSave(user.id, role, event.target.value as ApprovalStatus)}><option value="PENDING_APPROVAL">รออนุมัติ</option><option value="APPROVED">อนุมัติแล้ว</option><option value="DISABLED">ปิดใช้งาน</option></select></td><td><button className="button button--small" type="button" onClick={() => { const nextStatus = status === 'PENDING_APPROVAL' ? 'APPROVED' : status; void onSave(user.id, role, nextStatus); }}><UserCheck size={15} /> {status === 'PENDING_APPROVAL' ? 'อนุมัติ' : 'บันทึก'}</button></td></tr>;
}
