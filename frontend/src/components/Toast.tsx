import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export type ToastMessage = { text: string; tone: 'success' | 'error' };

/** จัดการ state ของ toast หนึ่งชุดต่อหน้า: notify() แสดงข้อความใหม่ dismissToast() ปิดก่อนกำหนด */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const notify = useCallback((text: string, tone: ToastMessage['tone'] = 'success') => setToast({ text, tone }), []);
  return { toast, notify, dismissToast };
}

/** แจ้งเตือนมุมขวาล่าง ปิดเองใน 6 วินาที หรือกดปิดเองได้ ใช้คู่กับ useToast() */
export function Toast({ toast, onDismiss, duration = 6000 }: { toast: ToastMessage | null; onDismiss: () => void; duration?: number }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [toast, duration, onDismiss]);

  if (!toast) return null;
  const Icon = toast.tone === 'error' ? CircleAlert : CheckCircle2;
  return <div className="toast-stack">
    <div className={`toast toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <Icon size={19} />
      <p>{toast.text}</p>
      <button aria-label="ปิดการแจ้งเตือน" className="toast__close" type="button" onClick={onDismiss}><X size={16} /></button>
    </div>
  </div>;
}
