/** คำแปลสถานะนัดหมาย/การชำระเงินที่ใช้ร่วมกันทุกหน้า staff ห้ามแก้คำแปลในหน้าเดียวโดยไม่แก้ที่นี่ */
export const appointmentStatusLabels: Record<string, string> = { PENDING_CONFIRMATION: 'นัดรอคอนเฟิร์ม', CONFIRMED: 'ยืนยันแล้ว', CANCELLED: 'ยกเลิก' };
export const paymentStatusLabels: Record<string, string> = { AWAITING_PAYMENT: 'รอชำระเงิน', SLIP_UPLOADED: 'รอตรวจสลิป', VERIFIED: 'ชำระแล้ว', REJECTED: 'สลิปถูกปฏิเสธ', NOT_REQUIRED: 'ไม่ต้องชำระ' };
export const visitStatusLabels: Record<string, string> = { BOOKED: 'รอเข้าพบ', SERVED: 'มาตามนัด', NO_SHOW: 'ไม่มาตามนัด' };
