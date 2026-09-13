import { HeartHandshake, Star } from 'lucide-react';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';

type Survey = {
  cleanlinessRating: number; staffRating: number; dentistRating: number | null;
  waitTimeRating: number; overallRating: number; comment: string; submittedAt: string;
};
type SatisfactionVisit = {
  appointmentId: number; reference: string; queueNumber: string; serviceName: string;
  dentistName: string; hasDentist: boolean; startsAt: string; survey: Survey | null;
};
type SatisfactionState = { visits: SatisfactionVisit[]; loading: boolean; unauthorized?: boolean };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const loadingState: SatisfactionState = { visits: [], loading: true, unauthorized: false };
// identity มาจาก session cookie ฝั่ง server เท่านั้น ฝั่ง browser จึงเก็บสถานะเดียวพอ
let satisfactionState: SatisfactionState = loadingState;
let satisfactionRequested = false;
const satisfactionSubscribers = new Set<() => void>();

function notify() { satisfactionSubscribers.forEach((subscriber) => subscriber()); }

function requestSatisfaction() {
  return fetch(`${apiBase}/patient/satisfaction`)
    // 401 = ยังไม่ได้ล็อกอิน/session หมดอายุ ต้องแยกจากกรณี "ไม่มีนัดที่มาตามนัดแล้ว"
    .then(async (response) => (response.ok
      ? { visits: (await response.json()).visits as SatisfactionVisit[], unauthorized: false }
      : { visits: [] as SatisfactionVisit[], unauthorized: response.status === 401 }))
    .then((data) => { satisfactionState = { ...data, loading: false }; notify(); })
    .catch(() => { satisfactionState = { visits: [], loading: false, unauthorized: false }; notify(); });
}

function subscribeToSatisfaction(listener: () => void) {
  satisfactionSubscribers.add(listener);
  if (!satisfactionRequested) {
    satisfactionRequested = true;
    satisfactionState = loadingState;
    void requestSatisfaction();
  }
  return () => {
    satisfactionSubscribers.delete(listener);
    if (satisfactionSubscribers.size === 0) satisfactionRequested = false;
  };
}

function reloadSatisfaction() {
  satisfactionState = loadingState;
  notify();
  void requestSatisfaction();
}

/** ใช้ใน test เท่านั้น ล้าง cache ระดับโมดูลก่อน mount หน้านี้ซ้ำ */
export function resetSatisfactionCache() {
  satisfactionRequested = false;
  satisfactionState = loadingState;
}

type RatingKey = 'cleanlinessRating' | 'staffRating' | 'dentistRating' | 'waitTimeRating' | 'overallRating';
type StandardRatingKey = Exclude<RatingKey, 'dentistRating'>;
type RatingValues = Record<RatingKey, number>;
const emptyRatings: RatingValues = { cleanlinessRating: 0, staffRating: 0, dentistRating: 0, waitTimeRating: 0, overallRating: 0 };
const ratingLabels: { key: StandardRatingKey; label: string }[] = [
  { key: 'cleanlinessRating', label: 'ความสะอาดของสถานที่' },
  { key: 'staffRating', label: 'ความสุภาพของเจ้าหน้าที่' },
  { key: 'waitTimeRating', label: 'ระยะเวลารอคิว' },
  { key: 'overallRating', label: 'ความประทับใจโดยรวม' },
];

function StarRow({ label, value, onChange, readOnly }: { label: string; value: number; onChange?: (value: number) => void; readOnly?: boolean }) {
  return <div className="satisfaction-rating-row">
    <span>{label}</span>
    <span className="satisfaction-rating-row__stars">
      {[1, 2, 3, 4, 5].map((star) => readOnly
        ? <Star fill={star <= value ? '#f0b429' : 'none'} color={star <= value ? '#f0b429' : '#c8ded0'} key={star} size={22} />
        : <button aria-label={`${label} ${star} ดาว`} key={star} onClick={() => onChange?.(star)} type="button">
            <Star fill={star <= value ? '#f0b429' : 'none'} color={star <= value ? '#f0b429' : '#c8ded0'} size={24} />
          </button>)}
    </span>
  </div>;
}

function SurveyForm({ visit }: { visit: SatisfactionVisit }) {
  const [ratings, setRatings] = useState<RatingValues>(emptyRatings);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError('');
    if (visit.hasDentist && ratings.dentistRating === 0) { setError('กรุณาให้คะแนนทันตแพทย์ที่ให้บริการด้วย'); return; }
    if (ratings.cleanlinessRating === 0 || ratings.staffRating === 0 || ratings.waitTimeRating === 0 || ratings.overallRating === 0) {
      setError('กรุณาให้คะแนนครบทุกหัวข้อ');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${apiBase}/patient/satisfaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId: visit.appointmentId,
          cleanlinessRating: ratings.cleanlinessRating,
          staffRating: ratings.staffRating,
          dentistRating: visit.hasDentist ? ratings.dentistRating : undefined,
          waitTimeRating: ratings.waitTimeRating,
          overallRating: ratings.overallRating,
          comment,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      reloadSatisfaction();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'ไม่สามารถส่งแบบประเมินได้');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="satisfaction-form">
    {ratingLabels.map(({ key, label }) => <StarRow key={key} label={label} onChange={(value) => setRatings((prev) => ({ ...prev, [key]: value }))} value={ratings[key]} />)}
    {visit.hasDentist && <StarRow label={`ให้คะแนนทันตแพทย์ ${visit.dentistName}`} onChange={(value) => setRatings((prev) => ({ ...prev, dentistRating: value }))} value={ratings.dentistRating} />}
    <label>ความคิดเห็นเพิ่มเติม (ถ้ามี)<textarea onChange={(event) => setComment(event.target.value)} rows={3} value={comment} /></label>
    {error && <p className="booking-message">{error}</p>}
    <button className="button" disabled={submitting} onClick={() => void submit()} type="button">ส่งแบบประเมิน</button>
  </div>;
}

function SurveySummary({ survey }: { survey: Survey }) {
  return <div className="satisfaction-form">
    {ratingLabels.map(({ key, label }) => <StarRow key={key} label={label} readOnly value={survey[key]} />)}
    {survey.dentistRating !== null && <StarRow label="คะแนนทันตแพทย์" readOnly value={survey.dentistRating} />}
    {survey.comment && <p>{survey.comment}</p>}
    <p className="booking-disclaimer">ขอบคุณสำหรับความคิดเห็นเมื่อ {new Date(survey.submittedAt).toLocaleString('th-TH')}</p>
  </div>;
}

export function SatisfactionPage() {
  const subscribe = useCallback((listener: () => void) => subscribeToSatisfaction(listener), []);
  const getSnapshot = useCallback(() => satisfactionState, []);
  const { visits, loading, unauthorized } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return <section className="booking-page"><div className="container booking-shell">
    <Link className="booking-back" to="/patient/menu">← กลับเมนูบริการ</Link>
    <div className="booking-card">
      <div className="booking-payment"><HeartHandshake size={46} /><h1>ประเมินความพึงพอใจ</h1><p>ทุกความคิดเห็นของท่านช่วยให้เราพัฒนาการบริการได้ดียิ่งขึ้น</p></div>
      {visits.map((visit) => <article className="queue-ticket satisfaction-ticket" key={visit.appointmentId}>
        <div className="queue-ticket__details"><strong>{visit.serviceName}</strong><span>{visit.dentistName}</span><span>{new Date(visit.startsAt).toLocaleString('th-TH')}</span></div>
        {visit.survey ? <SurveySummary survey={visit.survey} /> : <SurveyForm visit={visit} />}
      </article>)}
      {visits.length === 0 && (unauthorized
        ? <p className="booking-message">เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ <Link to="/appointment">เข้าสู่ระบบอีกครั้ง</Link></p>
        : <p className="booking-disclaimer">{loading ? 'กำลังตรวจสอบนัดหมายของท่าน...' : 'แบบประเมินจะเปิดให้ตอบหลังได้รับบริการ เพื่อให้ทุกความคิดเห็นช่วยพัฒนาคลินิกของเรา'}</p>)}
      <Link className="button" to="/patient/menu">กลับเมนูบริการ</Link>
    </div>
  </div></section>;
}
