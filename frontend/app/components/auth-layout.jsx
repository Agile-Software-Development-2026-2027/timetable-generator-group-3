import Image from "next/image";

// Split layout of the login and set-password pages: brand panel on the left, form card on the right.
export function AuthLayout({ eyebrow, headline, tagline, icon, children }) {
  return <main className="login-page">
    <aside className="login-brand">
      <Image src="/unical-logo-white.svg" alt="University of Calabria" width={245} height={20} className="login-logo" priority />
      <div className="login-brand-copy">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{headline}</h1>
        <p>{tagline}</p>
      </div>
      <div className="login-footer">Università della Calabria <span>© {new Date().getFullYear()}</span></div>
    </aside>
    <section className="login-side">
      <div className="login-card">
        <div className="login-emblem" aria-hidden="true">{icon}</div>
        {children}
      </div>
    </section>
  </main>;
}
