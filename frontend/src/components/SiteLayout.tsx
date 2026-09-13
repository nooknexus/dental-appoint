import type { ReactNode } from 'react';

import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

interface SiteLayoutProps {
  children: ReactNode;
}

export function SiteLayout({ children }: SiteLayoutProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>
      <SiteHeader />
      <main id="main-content">{children}</main>
      <SiteFooter />
    </div>
  );
}
