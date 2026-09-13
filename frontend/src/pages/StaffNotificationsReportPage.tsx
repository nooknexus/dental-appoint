import { useCallback, useEffect, useState } from 'react';
import { Toast, useToast } from '../components/Toast';
import { getStaffRole, staffFetch } from '../services/staffAuth';

type NotificationSummary = { total: number; sent: number; pending: number; sending: number; failed: number; invalidRecipient: number; successRate: number };
type NotificationRow = { id: number; queueNumber: string; recipientMasked: string; status: string; attemptCount: number; lastAttemptAt: string | null; sentAt: string | null; responseStatus: number | null; errorMessage: string | null };
type NotificationsReport = { summary: NotificationSummary; recent: NotificationRow[] };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const deliveryStatusLabels: Record<string, string> = { SENT: 'ส่งสำเร็จ', PENDING: 'รอส่ง', SENDING: 'กำลังส่ง', FAILED: 'ล้มเหลว', INVALID_RECIPIENT: 'ผู้รับไม่ถูกต้อง' };

export function StaffNotificationsReportPage() {
  const [report, setReport] = useState<NotificationsReport | null>(null);
  const { toast, notify, dismissToast } = useToast();
  const role = getStaffRole() === 'IT_STAFF' ? 'IT_STAFF' : 'MANAGER';

  const load = useCallback(() => {
    void staffFetch(`${apiBase}/staff/reports/notifications`, { headers: { 'x-mock-role': role } }).then(async (response) => {
      if (!response.ok) throw new Error('ไม่สามารถโหลดรายงานการแจ้งเตือนได้');
      setReport(await response.json() as NotificationsReport);
    }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'ไม่สามารถโหลดรายงานการแจ้งเตือนได้', 'error'));
  }, [role, notify]);

  useEffect(() => { void load(); }, [load]);
  const summary = report?.summary;

  return <section className="staff-page"><div className="container">
    <p className="eyebrow">Manager · Reports</p>
    <h1>ติดตามการแจ้งเตือน (MOPH Alert)</h1>
    <p>ภาพรวมการส่งข้อความแจ้งเตือนนัดหมายผ่าน MOPH Alert v3.1 แบบอ่านอย่างเดียว</p>

    {summary && <div className="report-summary">
      <span>ทั้งหมด <b>{summary.total.toLocaleString()}</b> รายการ</span>
      <span>ส่งสำเร็จ <b>{summary.sent.toLocaleString()}</b></span>
      <span>รอส่ง <b>{summary.pending.toLocaleString()}</b></span>
      <span>ล้มเหลว <b>{summary.failed.toLocaleString()}</b></span>
      <span>ผู้รับไม่ถูกต้อง <b>{summary.invalidRecipient.toLocaleString()}</b></span>
      <span>อัตราส่งสำเร็จ <b>{summary.successRate}%</b></span>
    </div>}

    <div className="staff-table-wrap">
      <table>
        <thead><tr><th>คิว</th><th>ผู้รับ</th><th>สถานะ</th><th>ลองส่ง</th><th>ส่งเมื่อ</th><th>เหตุขัดข้อง</th></tr></thead>
        <tbody>
          {report && report.recent.length ? report.recent.map((row) => <tr key={row.id}>
            <td><b>{row.queueNumber}</b></td>
            <td>{row.recipientMasked}</td>
            <td><span className={`status-pill ${row.status === 'SENT' ? 'status-pill--approved' : row.status === 'FAILED' || row.status === 'INVALID_RECIPIENT' ? 'status-pill--disabled' : ''}`}>{deliveryStatusLabels[row.status] ?? row.status}</span></td>
            <td>{row.attemptCount}/3</td>
            <td>{row.sentAt ?? '—'}</td>
            <td>{row.errorMessage ?? '—'}</td>
          </tr>) : <tr><td colSpan={6}>{report ? 'ยังไม่มีประวัติการส่งการแจ้งเตือน (ระบบสร้างรายการหลังเจ้าหน้าที่ยืนยันนัด)' : 'กำลังโหลด...'}</td></tr>}
        </tbody>
      </table>
    </div>

    <p className="report-note">แสดงล่าสุด 20 รายการ · การเปิด/ปิดระบบ ตั้งค่า credentials และส่งซ้ำ อยู่ในหน้าตั้งค่าระบบของผู้ดูแล IT</p>
    <Toast onDismiss={dismissToast} toast={toast} />
  </div></section>;
}
