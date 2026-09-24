import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BellRing,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Database,
  FileScan,
  KeyRound,
  Landmark,
  Layers,
  Loader2,
  Lock,
  Mail,
  Network,
  Receipt,
  Rocket,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserCheck,
  Users,
  Workflow,
} from 'lucide-react';
import { trackPointer, useReveal } from './use-reveal';
import { isApiError } from '@/lib/api';
import { submitContactForm } from '@/lib/contact';
import './landing.css';

/**
 * Public landing page — what a signed-out visitor sees at `/`
 * (`ProtectedRoute` renders it instead of redirecting to /login there).
 * Every claim on this page is something the product actually does today;
 * Payroll & statutory compliance are labelled as coming next, and there are
 * no customer logos, testimonials or usage numbers we can't back up.
 */
export function LandingPage() {
  const root = React.useRef<HTMLDivElement>(null);
  useReveal(root);

  React.useEffect(() => {
    const previous = document.title;
    document.title = 'Lumen HRMS — Empower people. Build tomorrow.';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div ref={root} className="landing min-h-screen">
      <Nav />
      <Hero />
      <ModuleMarquee />
      <Features />
      <LeaveFlow />
      <Security />
      <BuiltFor />
      <Roadmap />
      <Contact />
      <FinalCta />
      <Footer />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <header className="landing-nav fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2.5">
          <LumenMark className="h-8 w-8" />
          <span className="text-[17px] font-bold tracking-tight">Lumen</span>
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--text-3)] sm:inline">
            HRMS
          </span>
        </a>
        <nav className="hidden items-center gap-8 text-sm text-[var(--text-2)] md:flex">
          <a href="#features" className="transition-colors hover:text-[var(--text)]">
            Features
          </a>
          <a href="#how" className="transition-colors hover:text-[var(--text)]">
            How it works
          </a>
          <a href="#security" className="transition-colors hover:text-[var(--text)]">
            Security
          </a>
          <a href="#roadmap" className="transition-colors hover:text-[var(--text)]">
            Roadmap
          </a>
          <a href="#contact" className="transition-colors hover:text-[var(--text)]">
            Contact
          </a>
        </nav>
        <Link
          to="/login"
          className="btn-gold inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold"
        >
          Sign in <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const HEADLINE = ['Empower', 'people.'];
const HEADLINE_GOLD = ['Build', 'tomorrow.'];

function Hero() {
  return (
    <section id="top" className="relative isolate overflow-x-clip pt-32 pb-16 sm:pt-40">
      <span aria-hidden="true" className="brand-aurora brand-aurora--gold" />
      <span aria-hidden="true" className="brand-aurora brand-aurora--blue" />
      <span aria-hidden="true" className="brand-grid" />

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-5 text-center">
        <Eclipse />

        <div
          className="brand-in mt-2 inline-flex items-center gap-2 rounded-full border border-[rgba(245,181,68,0.25)] bg-[rgba(245,181,68,0.06)] px-3.5 py-1.5 text-xs text-[var(--gold-hi)]"
          style={{ animationDelay: '600ms' }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          The HR workspace for growing Indian teams
        </div>

        <h1 className="mt-6 text-[42px] font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          {HEADLINE.map((w, i) => (
            <span key={w} className="hero-word mr-[0.25em]" style={{ '--d': `${700 + i * 110}ms` } as React.CSSProperties}>
              {w}
            </span>
          ))}
          <br />
          {HEADLINE_GOLD.map((w, i) => (
            // Outer span runs the rise-in; the inner one owns the gold shimmer —
            // both are `animation`s, so they can't share an element.
            <span
              key={w}
              className="hero-word mr-[0.25em]"
              style={{ '--d': `${950 + i * 110}ms` } as React.CSSProperties}
            >
              <span className="gold-text">{w}</span>
            </span>
          ))}
        </h1>

        <p
          className="brand-in mt-6 max-w-2xl text-base leading-relaxed text-[var(--text-2)] sm:text-lg"
          style={{ animationDelay: '1250ms' }}
        >
          Lumen brings your people records, leave, attendance and documents into one calm,
          secure workspace — with approvals that route themselves and emails that tell the right
          person at the right moment.
        </p>

        <div
          className="brand-in mt-9 flex flex-col items-center gap-3 sm:flex-row"
          style={{ animationDelay: '1400ms' }}
        >
          <Link
            to="/login"
            className="btn-gold inline-flex items-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold"
          >
            Sign in to your workspace <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#features"
            className="btn-ghost inline-flex items-center gap-2 rounded-xl px-6 py-3 text-[15px] font-medium"
          >
            See what's inside
          </a>
        </div>

        <ProductPreview />
      </div>
    </section>
  );
}

/** The Lumen mark — ring + horizon + flare — drawn live in SVG. */
function Eclipse() {
  return (
    <div className="relative h-40 w-40 sm:h-48 sm:w-48" aria-hidden="true">
      <svg viewBox="0 0 200 200" className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id="ring" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#c68118" stopOpacity="0" />
            <stop offset="35%" stopColor="#c68118" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#ffd77a" />
          </linearGradient>
          <linearGradient id="horizon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f5b544" stopOpacity="0" />
            <stop offset="70%" stopColor="#f5b544" stopOpacity="0.9" />
            <stop offset="85%" stopColor="#ffe6a8" />
            <stop offset="100%" stopColor="#f5b544" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="flare">
            <stop offset="0%" stopColor="#fff6dc" />
            <stop offset="25%" stopColor="#ffc861" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#f5b544" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="glow" cx="0.72" cy="0.62">
            <stop offset="0%" stopColor="#f5b544" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#f5b544" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="eclipse-glow" cx="100" cy="100" r="98" fill="url(#glow)" />
        <circle
          className="eclipse-ring"
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke="url(#ring)"
          strokeWidth="5"
          strokeLinecap="round"
          transform="rotate(120 100 100)"
        />
        <rect className="eclipse-horizon" x="-20" y="129" width="240" height="2" rx="1" fill="url(#horizon)" />
        <circle className="eclipse-flare" cx="174" cy="130" r="16" fill="url(#flare)" />
      </svg>
    </div>
  );
}

/** Static, crisp version of the mark for the nav, CTA and footer. */
function LumenMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="markRing" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#c68118" stopOpacity="0.15" />
          <stop offset="45%" stopColor="#d99220" />
          <stop offset="100%" stopColor="#ffd77a" />
        </linearGradient>
        <radialGradient id="markFlare">
          <stop offset="0%" stopColor="#fff6dc" />
          <stop offset="35%" stopColor="#ffc861" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#f5b544" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="74" fill="none" stroke="url(#markRing)" strokeWidth="11" />
      <rect x="6" y="126" width="188" height="5" rx="2.5" fill="#f5b544" opacity="0.85" />
      <circle cx="170" cy="128" r="22" fill="url(#markFlare)" />
    </svg>
  );
}

/** Illustrative product preview built from UI primitives (not a screenshot). */
function ProductPreview() {
  return (
    <div
      className="brand-in relative mt-16 w-full max-w-5xl sm:mt-20"
      style={{ animationDelay: '1550ms' }}
      aria-label="Illustration of the Lumen dashboard"
      role="img"
    >
      <div className="preview-frame overflow-hidden rounded-2xl text-left">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/70" />
          <span className="ml-4 hidden rounded-md bg-white/5 px-3 py-1 text-[11px] text-[var(--text-3)] sm:inline">
            www.lumenhrms.work
          </span>
        </div>

        <div className="grid grid-cols-12">
          {/* sidebar */}
          <aside className="col-span-3 hidden flex-col gap-1 border-r border-[var(--line)] p-4 md:flex">
            {[
              ['Dashboard', Layers, true],
              ['Employees', Users, false],
              ['Leave', CalendarDays, false],
              ['Attendance', Clock, false],
              ['Documents', FileScan, false],
              ['Email log', BellRing, false],
            ].map(([label, Icon, active]) => {
              const I = Icon as typeof Users;
              return (
                <div
                  key={label as string}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] ${
                    active ? 'bg-[rgba(245,181,68,0.12)] text-[var(--gold-hi)]' : 'text-[var(--text-3)]'
                  }`}
                >
                  <I className="h-4 w-4" /> {label as string}
                </div>
              );
            })}
          </aside>

          {/* main */}
          <div className="col-span-12 p-5 sm:p-6 md:col-span-9">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-3)]">Good morning</p>
                <p className="mt-1 text-lg font-semibold">Asha Rao</p>
              </div>
              <span className="flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-300">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" /> Clocked in 09:12
              </span>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* leave balances */}
              <div className="float-slow rounded-xl border border-[var(--line)] bg-white/[0.03] p-4">
                <p className="text-[12px] text-[var(--text-3)]">Leave balance</p>
                {[
                  ['Casual', '8 / 12', '66%', '1.2s', '#f5b544'],
                  ['Sick', '6 / 8', '75%', '1.35s', '#60a5fa'],
                  ['Earned', '14 / 18', '78%', '1.5s', '#34d399'],
                ].map(([name, val, pct, d, color]) => (
                  <div key={name} className="mt-3">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-[var(--text-2)]">{name}</span>
                      <span className="tabular-nums">{val}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="bar-fill h-full rounded-full"
                        style={{ width: pct, background: color, '--d': d } as React.CSSProperties}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* today ring */}
              <div className="float-slower flex flex-col items-center justify-center rounded-xl border border-[var(--line)] bg-white/[0.03] p-4">
                <p className="self-start text-[12px] text-[var(--text-3)]">Today</p>
                <div className="relative mt-2 h-28 w-28">
                  <svg viewBox="0 0 70 70" className="h-full w-full -rotate-90">
                    <circle cx="35" cy="35" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
                    <circle
                      className="ring-progress"
                      cx="35"
                      cy="35"
                      r="28"
                      fill="none"
                      stroke="#f5b544"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-base font-semibold tabular-nums">
                    6h 24m
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-3)]">of 8h shift</p>
              </div>

              {/* approvals */}
              <div className="float-slow rounded-xl border border-[var(--line)] bg-white/[0.03] p-4">
                <p className="text-[12px] text-[var(--text-3)]">Waiting on you</p>
                {[
                  ['Rahul M.', 'Casual · 2 days'],
                  ['Priya S.', 'Missed punch-out'],
                ].map(([who, what]) => (
                  <div key={who} className="mt-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{who}</p>
                      <p className="truncate text-[11px] text-[var(--text-3)]">{what}</p>
                    </div>
                    <span className="shrink-0 rounded-md bg-[rgba(245,181,68,0.14)] px-2 py-1 text-[11px] font-medium text-[var(--gold-hi)]">
                      Approve
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* floating toast */}
      <div className="toast-pop absolute -bottom-12 right-4 hidden items-center sm:flex gap-3 rounded-xl border border-emerald-400/20 bg-[#0b2a2a]/95 px-4 py-3 text-left shadow-2xl sm:right-10">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
          <Check className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[13px] font-medium">Leave approved</p>
          <p className="text-[11px] text-[var(--text-3)]">Rahul has been emailed · attendance updated</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const MODULES = [
  'Employee Master',
  'Org Chart',
  'Leave Management',
  'Attendance & Shifts',
  'Regularization',
  'Documents',
  'Malware Scanning',
  'Email Notifications',
  'Role-based Access',
  'Audit Trail',
  'Setup Wizard',
  'Multi-tenant Isolation',
];

function ModuleMarquee() {
  const items = [...MODULES, ...MODULES];
  return (
    <section className="hairline-top mt-16 py-8" aria-label="Modules">
      <div className="marquee overflow-hidden">
        <div className="marquee-track gap-3">
          {items.map((m, i) => (
            <span
              key={`${m}-${i}`}
              className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--line)] bg-white/[0.02] px-4 py-2 text-sm text-[var(--text-2)]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
              {m}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Users,
    title: 'Employee Master',
    body: 'One source of truth for every person — lifecycle from pre-joining to exit, bulk Excel import, departments and an interactive org chart.',
  },
  {
    icon: CalendarDays,
    title: 'Leave that routes itself',
    body: 'Manager and HR approvals, escalation timers, holiday-aware day counts, accruals, comp-off and a full balance ledger.',
  },
  {
    icon: Clock,
    title: 'Attendance & shifts',
    body: 'Clock-in, breaks and overtime on your own shift rules, with a nightly close-out and corrections that settle before the payroll cut-off.',
  },
  {
    icon: FileScan,
    title: 'Documents, scanned',
    body: 'ID proofs, medical notes and evidence stored privately — every upload is malware-scanned before anyone can open it.',
  },
  {
    icon: BellRing,
    title: 'The right email, on time',
    body: 'Approvers hear about new requests, employees hear about decisions — queued, retried and logged so nothing slips.',
  },
  {
    icon: KeyRound,
    title: 'Roles that fit your org',
    body: 'Company Admin, HR Manager, Line Manager, Employee and read-only Auditor — each sees exactly their slice, nothing more.',
  },
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24">
      <SectionHead
        kicker="Features"
        title="Everything your HR team runs on, in one place"
        body="Built as one product, not stitched together — so a leave approval updates attendance, notifies the employee and leaves an audit trail in a single step."
      />
      <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <article
            key={title}
            data-reveal
            onPointerMove={trackPointer}
            className="spot-card rounded-2xl p-6"
            style={{ '--delay': `${(i % 3) * 90}ms` } as React.CSSProperties}
          >
            <span className="icon-chip flex h-11 w-11 items-center justify-center rounded-xl">
              <Icon className="h-5 w-5" />
            </span>
            <h3 className="mt-5 text-lg font-semibold">{title}</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--text-2)]">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const FLOW = [
  { icon: CalendarDays, title: 'Employee applies', body: 'Balance and working days are checked instantly.' },
  { icon: UserCheck, title: 'Manager approves', body: 'Emailed the moment it lands — escalates if it sits.' },
  { icon: Workflow, title: 'HR signs off', body: 'Final approval deducts the balance on the ledger.' },
  { icon: Check, title: 'Everything updates', body: 'Attendance marked, employee emailed, trail recorded.' },
];

function LeaveFlow() {
  return (
    <section id="how" className="hairline-top scroll-mt-20 py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead
          kicker="How it works"
          title="One request, four hands, zero chasing"
          body="Here's a leave request moving through Lumen — the same flow your team will use from day one."
        />
        <div className="relative mt-16">
          <div className="flow-line absolute left-[12%] right-[12%] top-7 hidden h-px lg:block" />
          <ol className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {FLOW.map(({ icon: Icon, title, body }, i) => (
              <li
                key={title}
                data-reveal
                className="flow-step relative flex flex-col items-center text-center"
                style={{ '--delay': `${i * 160}ms` } as React.CSSProperties}
              >
                <span className="flow-node relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-[rgba(245,181,68,0.35)] bg-[var(--ink-2)] text-[var(--gold-hi)]">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-3)]">
                  Step {i + 1}
                </span>
                <h3 className="mt-1 font-semibold">{title}</h3>
                <p className="mt-1.5 max-w-[15rem] text-sm leading-relaxed text-[var(--text-2)]">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const SECURITY = [
  {
    icon: Database,
    title: 'Isolation enforced by the database',
    body: "Every company's rows are fenced off by Postgres row-level security — not just application code. A bug can't show one company another's data.",
  },
  {
    icon: Lock,
    title: 'Sensitive fields encrypted',
    body: 'PAN and bank account numbers are encrypted at the application layer, masked on screen, and revealing one is permissioned and logged.',
  },
  {
    icon: ShieldCheck,
    title: 'Aadhaar, minimised',
    body: 'Only the last four digits are ever stored. The full number never touches our database.',
  },
  {
    icon: ScrollText,
    title: 'Append-only audit trails',
    body: 'Sign-ins, role changes, downloads and decisions are written to logs the application itself cannot edit or delete.',
  },
  {
    icon: FileScan,
    title: 'Uploads scanned before use',
    body: 'Files are type-checked by their actual contents and malware-scanned; anything infected is removed and the uploader told.',
  },
  {
    icon: KeyRound,
    title: 'Least-privilege by role',
    body: "Line managers see their reporting line, employees see themselves. Our own operators can't browse your company's data.",
  },
];

function Security() {
  return (
    <section id="security" className="hairline-top relative scroll-mt-20 overflow-hidden py-24">
      <span aria-hidden="true" className="brand-aurora brand-aurora--blue" style={{ left: '-10rem', right: 'auto', top: '10%' }} />
      <div className="relative mx-auto max-w-6xl px-5">
        <SectionHead
          kicker="Security"
          title="Your people's data, treated like it matters"
          body="HR data is the most personal data a company holds. Lumen is built on the assumption that every layer should protect it — not just the login screen."
        />
        <div className="mt-14 grid grid-cols-1 gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY.map(({ icon: Icon, title, body }, i) => (
            <div
              key={title}
              data-reveal
              className="flex gap-4"
              style={{ '--delay': `${(i % 3) * 90}ms` } as React.CSSProperties}
            >
              <span className="icon-chip flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-2)]">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function BuiltFor() {
  const cards = [
    {
      icon: Rocket,
      title: 'Fast-moving startups',
      points: [
        'A guided first-run setup wizard',
        'Import your team from one Excel sheet',
        'Single-step approvals when you want speed',
      ],
    },
    {
      icon: Stethoscope,
      title: 'Hospitals & shift-heavy teams',
      points: [
        'Multiple shifts with grace periods and overtime',
        'Two-level approvals with escalation timers',
        'Holiday and weekly-off aware attendance',
      ],
    },
    {
      icon: Building2,
      title: 'Organisations that answer to auditors',
      points: [
        'A read-only Auditor role out of the box',
        'Every sensitive action leaves a trail',
        'Role changes and password resets are logged',
      ],
    },
  ];
  return (
    <section className="hairline-top py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead kicker="Built for" title="Shaped around how Indian teams actually work" />
        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {cards.map(({ icon: Icon, title, points }, i) => (
            <article
              key={title}
              data-reveal
              onPointerMove={trackPointer}
              className="spot-card rounded-2xl p-7"
              style={{ '--delay': `${i * 110}ms` } as React.CSSProperties}
            >
              <Icon className="h-7 w-7 text-[var(--gold-hi)]" />
              <h3 className="mt-5 text-lg font-semibold">{title}</h3>
              <ul className="mt-4 space-y-2.5">
                {points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-[14.5px] text-[var(--text-2)]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--gold)]" />
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function Roadmap() {
  const items = [
    { icon: Landmark, title: 'Payroll', body: 'Salary structures, monthly runs and payslips — fed directly by attendance and leave.' },
    { icon: Receipt, title: 'Statutory compliance', body: 'EPF, ESI, professional tax and TDS, with the returns and registers they need.' },
    { icon: Network, title: 'Reports & analytics', body: 'Headcount, attrition and cost views, exportable for your accountant.' },
  ];
  return (
    <section id="roadmap" className="hairline-top scroll-mt-20 py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead
          kicker="Coming next"
          title="What we're building now"
          body="Lumen ships in careful, tested slices. These are the next ones on the bench."
        />
        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {items.map(({ icon: Icon, title, body }, i) => (
            <div
              key={title}
              data-reveal
              className="rounded-2xl border border-dashed border-[rgba(245,247,249,0.14)] p-6"
              style={{ '--delay': `${i * 100}ms` } as React.CSSProperties}
            >
              <div className="flex items-center justify-between">
                <Icon className="h-6 w-6 text-[var(--text-2)]" />
                <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium text-[var(--text-3)]">
                  In progress
                </span>
              </div>
              <h3 className="mt-5 font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-2)]">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

type ContactStatus = 'idle' | 'sending' | 'sent' | 'error';

function Contact() {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [status, setStatus] = React.useState<ContactStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      await submitContactForm({
        name,
        email,
        company,
        phone,
        message,
      });
      setStatus('sent');
      setName('');
      setEmail('');
      setCompany('');
      setPhone('');
      setMessage('');
    } catch (err) {
      setStatus('error');
      setError(
        isApiError(err) && err.status === 429
          ? "You've sent a few of these already — please wait a few minutes and try again."
          : 'Something went wrong sending your message. Please try again in a moment.',
      );
    }
  }

  return (
    <section id="contact" className="hairline-top scroll-mt-20 py-24">
      <div className="mx-auto max-w-3xl px-5">
        <SectionHead
          kicker="Get in touch"
          title="Talk to us about your team"
          body="Tell us a bit about your company and what you need — we'll get back to you shortly."
        />

        <div data-reveal className="spot-card mt-12 rounded-2xl p-6 sm:p-8" onPointerMove={trackPointer}>
          {status === 'sent' ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="icon-chip flex h-12 w-12 items-center justify-center rounded-full">
                <CheckCircle2 className="h-6 w-6" />
              </span>
              <h3 className="text-lg font-semibold">Message sent</h3>
              <p className="max-w-sm text-sm text-[var(--text-2)]">
                Thanks for reaching out — we'll get back to you at the email you gave us.
              </p>
              <button
                type="button"
                onClick={() => setStatus('idle')}
                className="btn-ghost mt-2 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--text-2)]">Name</span>
                <input
                  required
                  minLength={2}
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  className="form-field rounded-lg px-3.5 py-2.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--text-2)]">Work email</span>
                <input
                  required
                  type="email"
                  maxLength={320}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@company.com"
                  className="form-field rounded-lg px-3.5 py-2.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--text-2)]">Company</span>
                <input
                  required
                  minLength={2}
                  maxLength={200}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Acme Hospital"
                  className="form-field rounded-lg px-3.5 py-2.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--text-2)]">Phone</span>
                <input
                  required
                  type="tel"
                  minLength={6}
                  maxLength={40}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="form-field rounded-lg px-3.5 py-2.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                <span className="text-[var(--text-2)]">Message</span>
                <textarea
                  required
                  minLength={10}
                  maxLength={4000}
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us about your team and what you're looking for…"
                  className="form-field resize-none rounded-lg px-3.5 py-2.5 text-sm"
                />
              </label>

              {status === 'error' && error && (
                <p className="sm:col-span-2 text-sm text-[#ff9b9b]">{error}</p>
              )}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={status === 'sending'}
                  className="btn-gold inline-flex items-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold disabled:opacity-60"
                >
                  {status === 'sending' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4" /> Send message
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function FinalCta() {
  return (
    <section className="px-5 pb-24">
      <div
        data-reveal
        className="cta-panel relative mx-auto flex max-w-5xl flex-col items-center overflow-hidden rounded-3xl px-6 py-16 text-center"
      >
        <LumenMark className="h-14 w-14" />
        <h2 className="mt-6 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
          Your workspace is <span className="gold-text">ready when you are</span>
        </h2>
        <p className="mt-4 max-w-xl text-[var(--text-2)]">
          Already set up by your company? Sign in with your work email to see your leave, attendance
          and everything waiting on you.
        </p>
        <Link
          to="/login"
          className="btn-gold mt-8 inline-flex items-center gap-2 rounded-xl px-7 py-3.5 text-[15px] font-semibold"
        >
          Sign in to Lumen <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="hairline-top">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-[var(--text-3)] sm:flex-row">
        <div className="flex items-center gap-2.5">
          <LumenMark className="h-6 w-6" />
          <span className="font-semibold text-[var(--text-2)]">Lumen HRMS</span>
          <span>· Empower people. Build tomorrow.</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#features" className="hover:text-[var(--text)]">
            Features
          </a>
          <a href="#security" className="hover:text-[var(--text)]">
            Security
          </a>
          <a href="#contact" className="hover:text-[var(--text)]">
            Contact
          </a>
          <Link to="/login" className="hover:text-[var(--text)]">
            Sign in
          </Link>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function SectionHead({ kicker, title, body }: { kicker: string; title: string; body?: string }) {
  return (
    <div data-reveal className="mx-auto max-w-2xl text-center">
      <p className="section-kicker text-[11px] font-semibold uppercase">{kicker}</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 leading-relaxed text-[var(--text-2)]">{body}</p>}
    </div>
  );
}
