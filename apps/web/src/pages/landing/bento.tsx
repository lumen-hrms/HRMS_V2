import * as React from 'react';
import { CheckCircle2, FileText } from 'lucide-react';
import { resetPointer, trackPointer } from './use-reveal';

function Tile({
  area,
  title,
  body,
  children,
}: {
  area: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <article
      data-reveal
      onPointerMove={trackPointer}
      onPointerLeave={resetPointer}
      className="bento-tile"
      style={{ gridArea: area }}
    >
      <div className="bento-visual" aria-hidden="true">
        {children}
      </div>
      <div className="relative">
        <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-[15px] leading-relaxed text-[var(--text-2)]">{body}</p>
      </div>
    </article>
  );
}

const ORG_LINKS = ['M160 34V70', 'M160 70H70V104', 'M160 70H250V104', 'M70 134V160H30V180', 'M70 160H110V180', 'M250 134V180'];
const ORG_NODES = [
  [160, 22, 14],
  [70, 118, 12],
  [250, 118, 12],
  [30, 188, 9],
  [110, 188, 9],
  [250, 188, 9],
];

function OrgVisual() {
  return (
    <svg viewBox="0 0 320 210" className="h-full w-full">
      {ORG_LINKS.map((d, i) => (
        <path key={d} d={d} pathLength={1} className="org-link" style={{ '--i': i } as React.CSSProperties} />
      ))}
      {ORG_NODES.map(([cx, cy, r], i) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} className="org-node" style={{ '--i': i } as React.CSSProperties} />
      ))}
    </svg>
  );
}

function DocumentVisual() {
  return (
    <div className="doc-card">
      <FileText className="h-5 w-5 text-[var(--gold)]" />
      <span className="doc-line w-4/5" />
      <span className="doc-line w-3/5" />
      <span className="doc-line w-2/3" />
      <span className="doc-scan" />
      <CheckCircle2 className="doc-ok h-6 w-6" />
    </div>
  );
}

const TOASTS = ['Leave approved', 'New request waiting', 'Correction resolved'];

function EmailVisual() {
  return (
    <div className="toast-stack">
      {TOASTS.map((text, i) => (
        <span key={text} className="toast" style={{ '--i': i } as React.CSSProperties}>
          {text}
        </span>
      ))}
    </div>
  );
}

const ROLES = ['Admin', 'HR', 'Manager', 'Employee', 'Auditor'];

function RolesVisual() {
  return (
    <div className="flex flex-wrap content-center justify-center gap-2">
      {ROLES.map((role, i) => (
        <span key={role} className="role-pill" style={{ '--i': i } as React.CSSProperties}>
          {role}
        </span>
      ))}
    </div>
  );
}

const AUDIT = ['Role changed', 'PAN revealed', 'Leave approved', 'Password reset', 'Document opened', 'Salary revised'];

function AuditVisual() {
  return (
    <div className="audit-window">
      <div className="audit-track">
        {[...AUDIT, ...AUDIT].map((line, i) => (
          <span key={`${line}-${i}`}>{line}</span>
        ))}
      </div>
    </div>
  );
}

const BARS = [38, 62, 48, 80, 66, 92];

function ReportsVisual() {
  return (
    <div className="flex h-full items-end justify-center gap-2.5">
      {BARS.map((height, i) => (
        <span key={i} className="report-bar" style={{ height: `${height}%`, '--i': i } as React.CSSProperties} />
      ))}
    </div>
  );
}

export function Bento() {
  return (
    <section className="px-6 py-24 sm:py-36">
      <div className="mx-auto max-w-6xl">
        <h2 data-reveal className="display-title text-center">
          And everything around it.
        </h2>
        <div className="bento-grid mt-14">
          <Tile area="org" title="Org chart" body="See how the whole company fits together.">
            <OrgVisual />
          </Tile>
          <Tile area="doc" title="Documents" body="Stored privately, and scanned before anyone can open them.">
            <DocumentVisual />
          </Tile>
          <Tile area="mail" title="Email alerts" body="The right person hears at the right moment.">
            <EmailVisual />
          </Tile>
          <Tile area="role" title="Roles" body="Everyone sees exactly their slice.">
            <RolesVisual />
          </Tile>
          <Tile area="audit" title="Audit trail" body="Every sensitive action leaves a record.">
            <AuditVisual />
          </Tile>
          <Tile area="report" title="Reports" body="Headcount and attrition, ready to export.">
            <ReportsVisual />
          </Tile>
        </div>
      </div>
    </section>
  );
}
