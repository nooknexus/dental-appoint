import type { TeamMember } from '../types';
import nattawutPortrait from '../assets/images/team-nattawut-v1.png';
import pimjaiPortrait from '../assets/images/team-pimjai-v1.png';

export const clinicName = 'สาสุข พรีเมียม Dental Clinic';

export const contactPlaceholders = {
  address: 'สาสุขพรีเมี่ยม คลินิกทันตกรรม ถ.พุทธบูชา ต.ในเมือง อ.เมือง จ.พิษณุโลก',
  phone: '063-192-3003',
  line: 'LINE: อยู่ระหว่างการอัปเดต',
  facebook: 'สาสุขพรีเมี่ยม คลินิกทันตกรรม',
  hours: 'ในเวลา จันทร์–ศุกร์ 08:30–16:30 น. · นอกเวลา จันทร์–ศุกร์ 16:30–20:30 น. และเสาร์–อาทิตย์ 08:30–16:30 น.',
} as const;

export const teamMembers: TeamMember[] = [
  {
    role: 'ทันตแพทย์ทั่วไป',
    name: 'ทพญ. พิมพ์ใจ สุขสันต์',
    credentials: 'DDS · General Dentistry',
    focus: 'ให้คำปรึกษาและวางแผนการดูแลสุขภาพช่องปากสำหรับผู้รับบริการทุกช่วงวัย',
    specialties: ['ตรวจสุขภาพช่องปาก', 'ขูดหินปูน', 'อุดฟัน'],
    availability: 'จันทร์–ศุกร์ 09:00–16:00 น.',
    image: pimjaiPortrait,
    imageAlt: 'ภาพ ทพญ. พิมพ์ใจ สุขสันต์',
  },
  {
    role: 'ทันตแพทย์ทั่วไป',
    name: 'ทพ. ณัฐวุฒิ ยิ้มแย้ม',
    credentials: 'DDS · Restorative Care',
    focus: 'ดูแลการบูรณะฟันและอธิบายทางเลือกการรักษาอย่างเข้าใจง่าย',
    specialties: ['อุดฟัน', 'ถอนฟัน', 'ให้คำปรึกษา'],
    availability: 'อังคาร–เสาร์ 09:00–16:00 น.',
    image: nattawutPortrait,
    imageAlt: 'ภาพ ทพ. ณัฐวุฒิ ยิ้มแย้ม',
  },
];


export const faqs = [
  {
    question: 'ส่งคำขอนัดหมายแล้วต้องทำอย่างไรต่อ?',
    answer: 'เจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันวัน เวลา และรายละเอียดก่อนเข้ารับบริการ',
  },
  {
    question: 'ควรเตรียมข้อมูลอะไรสำหรับการนัดหมาย?',
    answer: 'โปรดแจ้งชื่อ เบอร์โทรศัพท์ วันที่และช่วงเวลาที่สะดวก รวมถึงบริการที่ต้องการปรึกษา',
  },
  {
    question: 'ต้องการเปลี่ยนแปลงการนัดหมายทำอย่างไร?',
    answer: 'ช่องทางติดต่อของคลินิกอยู่ระหว่างการอัปเดต กรุณาตรวจสอบข้อมูลล่าสุดก่อนเดินทาง',
  },
];
