import { LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';

import desktopLogo from '../assets/logos/logo_web.png';
import mobileLogo from '../assets/logos/logo_web700.png';
import { clinicName } from '../data/site';
import { patientSsoLogout } from '../services/patientSession';

const navigation = [
  { to: '/', label: 'หน้าหลัก', end: true },
  { to: '/services', label: 'บริการ' },
  { to: '/team', label: 'ทีมของเรา' },
  { to: '/about', label: 'เกี่ยวกับคลินิก' },
  { to: '/contact', label: 'ติดต่อเรา' },
];

interface NavigationLinksProps {
  onNavigate?: () => void;
}

function NavigationLinks({ onNavigate }: NavigationLinksProps) {
  return (
    <>
      {navigation.map(({ to, label, end }) => (
        <NavLink
          className={({ isActive }) => `site-nav__link${isActive ? ' site-nav__link--active' : ''}`}
          end={end}
          key={to}
          onClick={onNavigate}
          to={to}
        >
          {label}
        </NavLink>
      ))}
    </>
  );
}

export function SiteHeader() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navigate = useNavigate();
  const isPatient = sessionStorage.getItem('clinic_mock_role') === 'PATIENT';
  const closeMenu = () => setIsMenuOpen(false);
  const signOut = () => {
    void patientSsoLogout();
    sessionStorage.removeItem('clinic_mock_role');
    sessionStorage.removeItem('clinic_mock_patient');
    closeMenu();
    navigate('/', { replace: true });
  };

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link className="brand" onClick={closeMenu} to="/" aria-label={`${clinicName} หน้าหลัก`}>
          <picture className="brand__picture">
            <source media="(max-width: 620px)" srcSet={mobileLogo} />
            <img alt="ตราสัญลักษณ์ สาสุข พรีเมียม Dental Clinic" className="brand__logo" src={desktopLogo} />
          </picture>
          <span className="brand__copy">
            <span className="brand__name">สาสุข พรีเมียม</span>
            <span className="brand__descriptor">Dental Clinic</span>
          </span>
        </Link>

        <nav className="site-nav site-nav--desktop" aria-label="เมนูหลัก">
          <NavigationLinks />
          {isPatient ? <><Link className="button button--small" to="/booking/service">จองคิว</Link><button className="button button--small button--outline" onClick={signOut} type="button"><LogOut aria-hidden="true" size={16} /> ออกจากระบบ</button></> : <Link className="button button--small" to="/appointment">จองคิวทันตกรรม</Link>}
        </nav>

        <button
          aria-controls="mobile-navigation"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
          className="menu-button"
          onClick={() => setIsMenuOpen((isOpen) => !isOpen)}
          type="button"
        >
          {isMenuOpen ? <X aria-hidden="true" size={23} /> : <Menu aria-hidden="true" size={23} />}
        </button>
      </div>

      <div className={`mobile-nav${isMenuOpen ? ' mobile-nav--open' : ''}`} id="mobile-navigation">
        <nav aria-label="เมนูหลักสำหรับมือถือ" className="container mobile-nav__inner">
          <NavigationLinks onNavigate={closeMenu} />
          {isPatient ? <><Link className="button" onClick={closeMenu} to="/booking/service">จองคิว</Link><button className="button button--outline" onClick={signOut} type="button"><LogOut aria-hidden="true" size={16} /> ออกจากระบบ</button></> : <Link className="button" onClick={closeMenu} to="/appointment">จองคิวทันตกรรม</Link>}
        </nav>
      </div>
    </header>
  );
}
