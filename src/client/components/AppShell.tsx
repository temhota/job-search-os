import type { ReactNode } from "react";
import type { PageKey } from "../types.js";
import { uiText } from "../ui-text.js";

interface AppShellProps {
  activePage: PageKey;
  reviewCount: number;
  onNavigate: (page: PageKey) => void;
  children: ReactNode;
}

export function AppShell({ activePage, reviewCount, onNavigate, children }: AppShellProps) {
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span>JS</span><div>{uiText.labels.brand}<small>{uiText.labels.operatingSystem}</small></div></div>
      <nav aria-label={uiText.labels.primaryNavigation}>
        {uiText.nav.map(({ key, label }, index) => <button type="button" key={key} className={activePage === key ? "active" : ""} aria-current={activePage === key ? "page" : undefined} onClick={() => onNavigate(key)}>
          <i aria-hidden="true">{String(index + 1).padStart(2, "0")}</i>{label}
          {key === "review" && reviewCount > 0 && <b aria-label={`${reviewCount} items needing review`}>{reviewCount}</b>}
        </button>)}
      </nav>
      <div className="goal-card" aria-label="Search overview"><small>{uiText.labels.search}</small><strong>{uiText.labels.localSearch}</strong><span>{uiText.labels.planApplication}</span></div>
    </aside>
    <main className="content">
      <header className="topbar"><div><p>{new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(new Date())}</p><h1>{uiText.nav.find(({ key }) => key === activePage)?.label}</h1></div><div className="sync"><span />{uiText.labels.appleMail}</div></header>
      {children}
    </main>
  </div>;
}
