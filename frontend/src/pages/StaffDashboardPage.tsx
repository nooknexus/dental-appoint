import { CalendarX2, CheckCircle2, ClipboardList, Eye } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Toast, useToast } from "../components/Toast";
import { appointmentStatusLabels } from "../services/appointmentStatus";
import { getStaffRole, staffFetch } from "../services/staffAuth";

type Appointment = {
  id: number;
  queueNumber: string;
  status: string;
  paymentStatus: string;
  patientName: string;
  serviceName: string;
  dentistName: string;
  startsAt: string;
  phone: string;
  slipAvailable: boolean;
};
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "/api";

export function StaffDashboardPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const { toast, notify, dismissToast } = useToast();
  const [slipPreview, setSlipPreview] = useState<{
    queueNumber: string;
    url: string;
  } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const slipDialogRef = useRef<HTMLDialogElement>(null);
  const cancelDialogRef = useRef<HTMLDialogElement>(null);
  const role = getStaffRole() === "IT_STAFF" ? "IT_STAFF" : "CLINIC_STAFF";
  const load = useCallback(
    () =>
      staffFetch(`${apiBase}/staff/appointments`, {
        headers: { "x-mock-role": role },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("ไม่สามารถโหลดข้อมูลนัดหมายได้");
          const data = await response.json();
          setAppointments(
            data.appointments.filter(
              (appointment: Appointment) =>
                appointment.status !== "CONFIRMED" &&
                appointment.status !== "CANCELLED",
            ),
          );
        })
        .catch((error) => notify(error.message, "error")),
    [role, notify],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (slipPreview) slipDialogRef.current?.showModal();
  }, [slipPreview]);
  useEffect(() => {
    if (cancelTarget) cancelDialogRef.current?.showModal();
  }, [cancelTarget]);
  const approve = async (appointment: Appointment) => {
    const endpoint =
      appointment.paymentStatus === "SLIP_UPLOADED"
        ? "approve-payment"
        : "confirm";
    await staffFetch(
      `${apiBase}/staff/appointments/${appointment.id}/${endpoint}`,
      { method: "POST", headers: { "x-mock-role": role } },
    );
    load();
  };
  const viewSlip = async (appointment: Appointment) => {
    try {
      const response = await staffFetch(
        `${apiBase}/staff/appointments/${appointment.id}/slip`,
        { headers: { "x-mock-role": role } },
      );
      if (!response.ok) throw new Error("ไม่สามารถเปิดสลิปการโอนเงินได้");
      setSlipPreview({
        queueNumber: appointment.queueNumber,
        url: URL.createObjectURL(await response.blob()),
      });
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "ไม่สามารถเปิดสลิปการโอนเงินได้",
        "error",
      );
    }
  };
  const closeSlipPreview = () =>
    setSlipPreview((preview) => {
      if (preview) URL.revokeObjectURL(preview.url);
      return null;
    });
  const closeCancelDialog = () => {
    setCancelTarget(null);
    setCancelReason("");
  };
  const cancelAppointment = async () => {
    const appointment = cancelTarget;
    const reason = cancelReason.trim();
    if (!appointment || !reason) return;
    closeCancelDialog();
    try {
      const response = await staffFetch(
        `${apiBase}/staff/appointments/${appointment.id}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mock-role": role,
          },
          body: JSON.stringify({ reason }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      notify(result.message);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "ไม่สามารถยกเลิกคิวได้",
        "error",
      );
    }
  };
  return (
    <section className="staff-page">
      <div className="container">
        <p className="eyebrow">
          {role === "IT_STAFF" ? "ผู้ดูแลระบบ IT" : "เจ้าหน้าที่คลินิก"}
        </p>
        <h1>รายการนัดหมายรอตรวจสอบ</h1>
        <p>
          {role === "IT_STAFF"
            ? "เข้าถึงประเภทบริการ ทันตแพทย์ ผู้ใช้งาน และ Queue Prefix ได้"
            : "จัดการคิว นัดหมาย สล็อตจอง และคำถามคัดกรองเบื้องต้นได้"}
        </p>
        {role === "IT_STAFF" && (
          <Link className="button button--outline" to="/staff/services">
            เปิดหน้าประเภทบริการ
          </Link>
        )}
        <div className="staff-table-wrap">
          <table>
            <thead>
              <tr>
                <th>คิว</th>
                <th>ชื่อ-สกุล</th>
                <th>บริการ / ทันตแพทย์</th>
                <th>เวลา</th>
                <th>เบอร์โทร</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {appointments.length ? (
                appointments.map((item) => (
                  <tr key={item.id}>
                    <td>{item.queueNumber}</td>
                    <td>{item.patientName}</td>
                    <td>
                      {item.serviceName}
                      <br />
                      <small>{item.dentistName}</small>
                    </td>
                    <td>{new Date(item.startsAt).toLocaleString("th-TH")}</td>
                    <td>{item.phone}</td>
                    <td>
                      {item.paymentStatus === "SLIP_UPLOADED"
                        ? "รอตรวจสลิป"
                        : (appointmentStatusLabels[item.status] ?? item.status)}
                    </td>
                    <td>
                      {item.slipAvailable && (
                        <button
                          className="button button--small"
                          type="button"
                          onClick={() => viewSlip(item)}
                        >
                          <Eye size={15} /> ดูสลิป
                        </button>
                      )}{" "}
                      {(item.paymentStatus === "SLIP_UPLOADED" ||
                        (item.status === "PENDING_CONFIRMATION" &&
                          item.paymentStatus === "NOT_REQUIRED")) && (
                        <button
                          className="button button--small"
                          type="button"
                          onClick={() => approve(item)}
                        >
                          <CheckCircle2 size={15} /> ยืนยันคิว
                        </button>
                      )}
                      {role === "CLINIC_STAFF" && (
                        <button
                          className="button button--small button--outline"
                          type="button"
                          onClick={() => setCancelTarget(item)}
                        >
                          <CalendarX2 size={15} /> ยกเลิกคิว
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <ClipboardList size={22} /> ยังไม่มีรายการนัดหมาย
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {slipPreview && (
          <dialog
            aria-label={`สลิปโอนเงิน หมายเลขคิว ${slipPreview.queueNumber}`}
            className="slip-preview-modal"
            onClose={closeSlipPreview}
            ref={slipDialogRef}
          >
            <button
              className="text-button"
              type="button"
              onClick={closeSlipPreview}
            >
              × ปิด
            </button>
            <h2>สลิปโอนเงิน — {slipPreview.queueNumber}</h2>
            <iframe
              sandbox="allow-same-origin"
              src={slipPreview.url}
              title={`สลิปโอนเงิน ${slipPreview.queueNumber}`}
            />
          </dialog>
        )}
        {cancelTarget && (
          <dialog
            aria-label={`ยืนยันยกเลิกคิวหมายเลข ${cancelTarget.queueNumber}`}
            className="confirm-dialog"
            onClose={closeCancelDialog}
            ref={cancelDialogRef}
          >
            <h2>
              ต้องการยกเลิกคิวหมายเลข {cancelTarget.queueNumber} ใช่หรือไม่?
            </h2>
            <p>{cancelTarget.patientName}</p>
            <label className="confirm-dialog__field" htmlFor="cancel-reason">
              เหตุผลการยกเลิก
              <textarea
                id="cancel-reason"
                maxLength={500}
                required
                rows={3}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </label>
            <div className="confirm-dialog__actions">
              <button
                className="text-button"
                type="button"
                onClick={closeCancelDialog}
              >
                ไม่ยกเลิก
              </button>
              <button
                className="button button--danger"
                disabled={!cancelReason.trim()}
                type="button"
                onClick={() => void cancelAppointment()}
              >
                <CalendarX2 size={15} /> ยืนยันยกเลิกคิว
              </button>
            </div>
          </dialog>
        )}
        <Toast onDismiss={dismissToast} toast={toast} />
      </div>
    </section>
  );
}
