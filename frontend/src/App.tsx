import { BrowserRouter, MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';

import { SiteLayout } from './components/SiteLayout';
import { AdminPanelLayout } from './components/AdminPanelLayout';
import { StaffAccessDenied } from './components/StaffAccessDenied';
import { AboutPage } from './pages/AboutPage';
import { AppointmentPage } from './pages/AppointmentPage';
import { BookingPage } from './pages/BookingPage';
import { PatientAppointmentsPage } from './pages/PatientAppointmentsPage';
import { PatientMenuPage } from './pages/PatientMenuPage';
import { ContactPage } from './pages/ContactPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ServiceDetailPage } from './pages/ServiceDetailPage';
import { ServicesPage } from './pages/ServicesPage';
import { TeamPage } from './pages/TeamPage';
import { StaffDashboardPage } from './pages/StaffDashboardPage';
import { StaffAdminPage } from './pages/StaffAdminPage';
import { StaffUsersPage } from './pages/StaffUsersPage';
import { StaffDentistsPage } from './pages/StaffDentistsPage';
import { StaffDutyRosterPage } from './pages/StaffDutyRosterPage';
import { StaffSlotsPage } from './pages/StaffSlotsPage';
import { StaffQueueBoardPage } from './pages/StaffQueueBoardPage';
import { StaffRoleSelectPage } from './pages/StaffRoleSelectPage';
import { ManagerDashboardPage } from './pages/ManagerDashboardPage';
import { StaffAppointmentsReportPage } from './pages/StaffAppointmentsReportPage';
import { StaffVisitsReportPage } from './pages/StaffVisitsReportPage';
import { StaffRevenueReportPage } from './pages/StaffRevenueReportPage';
import { StaffDentistProductivityPage } from './pages/StaffDentistProductivityPage';
import { StaffNotificationsReportPage } from './pages/StaffNotificationsReportPage';
import { StaffPeakHoursPage } from './pages/StaffPeakHoursPage';
import { SatisfactionPage } from './pages/SatisfactionPage';
import { SystemSettingsPage } from './pages/SystemSettingsPage';
import { PatientRegistryPage } from './pages/PatientRegistryPage';
import { StaffPendingApprovalPage } from './pages/StaffPendingApprovalPage';
import { ScrollToTop } from './router/ScrollToTop';
import { getStaffRole, loadStaffAuth, type StaffRole, useStaffAuth } from './services/staffAuth';
import './styles/global.css';

export interface AppProps {
  initialEntries?: string[];
}

function StaffRoleOnly({ children, roles, description }: { children: ReactNode; roles: StaffRole[]; description: string }) {
  useStaffAuth();
  const role = getStaffRole();
  return role && roles.includes(role)
    ? children
    : <StaffAccessDenied description={description} />;
}

function PatientOnly({ children }: { children: ReactNode }) {
  return sessionStorage.getItem('clinic_mock_role') === 'PATIENT'
    ? children
    : <Navigate replace to="/appointment" />;
}

function StaffAuthenticated({ children }: { children: ReactNode }) {
  const auth = useStaffAuth();
  useEffect(() => { loadStaffAuth(); }, []);
  if (!auth.loaded) return <section className="auth-screen"><div className="auth-card"><p>กำลังตรวจสอบสิทธิ์เจ้าหน้าที่...</p></div></section>;
  if (auth.mode === 'mock' && getStaffRole()) return children;
  if (!auth.session) return <Navigate replace to={auth.mode === 'mock' ? '/staff/role-select' : '/appointment'} />;
  if (auth.session.status === 'PENDING_APPROVAL') return <Navigate replace to="/staff/pending-approval" />;
  if (auth.session.status === 'DISABLED') return <Navigate replace to="/appointment" />;
  return children;
}

function MockStaffRoleSelect() {
  const auth = useStaffAuth();
  useEffect(() => { loadStaffAuth(); }, []);
  if (!auth.loaded) return <section className="auth-screen"><div className="auth-card"><p>กำลังตรวจสอบรูปแบบการเข้าสู่ระบบ...</p></div></section>;
  if (auth.mode === 'provider') return <Navigate replace to="/appointment" />;
  return <StaffRoleSelectPage />;
}

function AppRoutes() {
  const location = useLocation();
  const isAdminPanel = location.pathname.startsWith('/staff/') && !['/staff/role-select', '/staff/pending-approval'].includes(location.pathname);
  const clinicOnly = (page: ReactNode) => <StaffRoleOnly roles={['CLINIC_STAFF']} description="หน้านี้สงวนสิทธิ์สำหรับเจ้าหน้าที่คลินิกเท่านั้น">{page}</StaffRoleOnly>;
  const itOnly = (page: ReactNode) => <StaffRoleOnly roles={['IT_STAFF']} description="หน้านี้สงวนสิทธิ์สำหรับ IT Staff ผู้ดูแลระบบเท่านั้น">{page}</StaffRoleOnly>;
  const managerOnly = (page: ReactNode) => <StaffRoleOnly roles={['MANAGER']} description="หน้านี้สงวนสิทธิ์สำหรับผู้จัดการคลินิกเท่านั้น">{page}</StaffRoleOnly>;
  const reportsOnly = (page: ReactNode) => <StaffRoleOnly roles={['IT_STAFF', 'MANAGER']} description="หน้านี้สงวนสิทธิ์สำหรับผู้จัดการและ IT Staff เท่านั้น">{page}</StaffRoleOnly>;
  const staffRoutes = <Routes><Route element={clinicOnly(<StaffQueueBoardPage />)} path="/staff/queue" /><Route element={clinicOnly(<StaffDashboardPage />)} path="/staff/appointments" /><Route element={clinicOnly(<StaffSlotsPage />)} path="/staff/slots" /><Route element={itOnly(<StaffAdminPage />)} path="/staff/services" /><Route element={itOnly(<SystemSettingsPage />)} path="/staff/system-settings" /><Route element={clinicOnly(<PatientRegistryPage />)} path="/staff/patient-registry" /><Route element={itOnly(<StaffDentistsPage />)} path="/staff/dentists" /><Route element={clinicOnly(<StaffDutyRosterPage />)} path="/staff/duty-roster" /><Route element={itOnly(<StaffUsersPage />)} path="/staff/users" /><Route element={managerOnly(<ManagerDashboardPage />)} path="/staff/dashboard" /><Route element={reportsOnly(<StaffAppointmentsReportPage />)} path="/staff/reports/appointments" /><Route element={reportsOnly(<StaffVisitsReportPage />)} path="/staff/reports/visits" /><Route element={reportsOnly(<StaffRevenueReportPage />)} path="/staff/reports/revenue" /><Route element={reportsOnly(<StaffDentistProductivityPage />)} path="/staff/reports/dentist-productivity" /><Route element={reportsOnly(<StaffNotificationsReportPage />)} path="/staff/reports/notifications" /><Route element={reportsOnly(<StaffPeakHoursPage />)} path="/staff/reports/peak-hours" /></Routes>;
  if (isAdminPanel) return <StaffAuthenticated><AdminPanelLayout>{staffRoutes}</AdminPanelLayout></StaffAuthenticated>;
  return (
    <>
      <ScrollToTop />
      <SiteLayout>
        <Routes>
          <Route element={<HomePage />} path="/" />
          <Route element={<ServicesPage />} path="/services" />
          <Route element={<ServiceDetailPage />} path="/services/:id" />
          <Route element={<TeamPage />} path="/team" />
          <Route element={<AboutPage />} path="/about" />
          <Route element={<AppointmentPage />} path="/appointment" />
          <Route element={<BookingPage />} path="/booking/service" />
          <Route element={<PatientOnly><PatientMenuPage /></PatientOnly>} path="/patient/menu" />
          <Route element={<PatientAppointmentsPage />} path="/patient/appointments" />
          <Route element={<SatisfactionPage />} path="/patient/satisfaction" />
          <Route element={<MockStaffRoleSelect />} path="/staff/role-select" />
          <Route element={<StaffPendingApprovalPage />} path="/staff/pending-approval" />
          <Route element={<ContactPage />} path="/contact" />
          <Route element={<NotFoundPage />} path="*" />
        </Routes>
      </SiteLayout>
    </>
  );
}

export default function App({ initialEntries }: AppProps) {
  if (initialEntries) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <AppRoutes />
      </MemoryRouter>
    );
  }

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
