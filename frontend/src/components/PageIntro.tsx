import type { ReactNode } from 'react';

interface PageIntroProps {
  eyebrow: string;
  title: string;
  description: ReactNode;
}

export function PageIntro({ eyebrow, title, description }: PageIntroProps) {
  return (
    <section className="page-intro">
      <div className="page-intro__halo" aria-hidden="true" />
      <div className="container page-intro__content">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-intro__description">{description}</p>
      </div>
    </section>
  );
}
