import { CalendarDays, Clock3, HeartHandshake, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { PageIntro } from '../components/PageIntro';
import { useTeamDirectory } from '../data/teamDirectory';

type WeeklyDutySchedule = { weekStart: string; weekEnd: string; dentists: { id: number; displayName: string; dates: string[] }[] };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';
const thaiWeekdayNames = ['วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์', 'วันอาทิตย์'];
const thaiMonthsShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** วันที่จริงทั้ง 7 วันของสัปดาห์ (จันทร์–อาทิตย์) พร้อมป้ายวันแบบไทย เพื่อแสดงคู่กับตารางเวรจริง */
function weekDates(weekStart: string) {
  const [year, month, day] = weekStart.split('-').map(Number);
  return Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(year, month - 1, day + index)).toISOString().slice(0, 10));
}
function thaiDateLabel(date: string) {
  const [, month, day] = date.split('-').map(Number);
  return `${day} ${thaiMonthsShort[month - 1]}`;
}

function useWeeklyDutySchedule() {
  const [schedule, setSchedule] = useState<WeeklyDutySchedule | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(`${apiBase}/dentists/weekly-duty-schedule`)
      .then(async (response) => (response.ok ? await response.json() as WeeklyDutySchedule : null))
      .then((data) => { if (!cancelled) setSchedule(data); })
      .catch(() => { if (!cancelled) setSchedule(null); });
    return () => { cancelled = true; };
  }, []);
  return schedule;
}

export function TeamPage() {
  const directory = useTeamDirectory();
  const schedule = useWeeklyDutySchedule();
  const days = schedule ? weekDates(schedule.weekStart) : [];

  return (
    <>
      <PageIntro
        description="เราตั้งใจให้การดูแลสุขภาพช่องปากเริ่มต้นด้วยการรับฟังอย่างเข้าใจ และประสานข้อมูลอย่างชัดเจนในทุกขั้นตอน"
        eyebrow="ทีมของเรา"
        title="ทีมที่พร้อมรับฟังและดูแล"
      />
      <section className="section" aria-labelledby="team-list-title">
        <div className="container">
          <div className="section-heading section-heading--stacked">
            <div>
              <p className="eyebrow">บุคลากรคลินิก</p>
              <h2 id="team-list-title">พบกับทีมที่พร้อมดูแลคุณ</h2>
            </div>
          </div>
          <div className="team-grid team-grid--directory">
            {directory.map((member, index) => (
              <article className="team-card team-card--full" key={member.name}>
                {member.image
                  ? <img alt={member.imageAlt} className="team-card__portrait" decoding="async" loading={index === 0 ? 'eager' : 'lazy'} src={member.image} />
                  : <div className="team-card__portrait team-card__portrait--placeholder" role="img" aria-label={`ยังไม่มีรูปประจำตัวของ ${member.name}`}><UserRound aria-hidden="true" size={48} /></div>}
                <p className="team-card__role">{member.role}</p>
                <h3>{member.name}</h3>
                <p className="team-card__credentials">{member.credentials}</p>
                {member.focus && <p>{member.focus}</p>}
                {member.specialties.length > 0 && <ul className="team-card__specialties" aria-label={`ความเชี่ยวชาญ ${member.name}`}>
                  {member.specialties.map((specialty) => <li key={specialty}>{specialty}</li>)}
                </ul>}
                {member.availability && <p className="team-card__availability"><Clock3 aria-hidden="true" size={16} />{member.availability}</p>}
                <span className="team-card__index">0{index + 1}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section section--soft" aria-labelledby="weekly-schedule-title">
        <div className="container">
          <div className="section-heading section-heading--stacked">
            <div>
              <p className="eyebrow">ตารางทันตแพทย์</p>
              <h2 id="weekly-schedule-title">ตารางเวรประจำสัปดาห์นี้</h2>
            </div>
            <p className="section-copy">ดึงจากทะเบียนลงเวรที่เจ้าหน้าที่บันทึกไว้ล่าสุด{schedule ? ` (${thaiDateLabel(schedule.weekStart)}–${thaiDateLabel(schedule.weekEnd)})` : ''} หากยังไม่พบทันตแพทย์ที่ต้องการ กรุณาติดต่อคลินิกโดยตรง</p>
          </div>
          {schedule && schedule.dentists.length > 0 ? (
            <div className="schedule-table-wrap">
              <table aria-label="ตารางเวรประจำสัปดาห์นี้" className="schedule-table">
                <thead>
                  <tr><th scope="col">วัน</th>{schedule.dentists.map((dentist) => <th key={dentist.id} scope="col">{dentist.displayName}</th>)}</tr>
                </thead>
                <tbody>
                  {days.map((date, index) => (
                    <tr key={date}>
                      <th scope="row">{thaiWeekdayNames[index]} {thaiDateLabel(date)}</th>
                      {schedule.dentists.map((dentist) => <td key={dentist.id}>{dentist.dates.includes(date) ? 'ออกตรวจ' : '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="section-copy">{schedule ? 'ยังไม่มีตารางเวรของสัปดาห์นี้ในระบบ กรุณาติดตามข้อมูลอัปเดตจากคลินิกโดยตรง' : 'กำลังโหลดตารางเวร...'}</p>
          )}
        </div>
      </section>
      <section className="section section--soft">
        <div className="container team-note">
          <HeartHandshake aria-hidden="true" size={34} />
          <div>
            <h2>เราพร้อมเริ่มต้นจากคำถามของคุณ</h2>
            <p>หากยังไม่แน่ใจว่าควรเริ่มดูแลเรื่องใด คุณสามารถส่งคำขอนัดหมายเพื่อรับข้อมูลเบื้องต้นได้</p>
          </div>
          <Link className="button" to="/appointment">จองคิวทันตกรรม <CalendarDays aria-hidden="true" size={18} /></Link>
        </div>
      </section>
    </>
  );
}
