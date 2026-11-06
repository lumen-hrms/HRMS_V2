import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Database, Lock, ShieldCheck } from 'lucide-react';
import lumenMark from '@/assets/brand/lumen-mark-dark.png';
import attendanceShot from '@/assets/landing/attendance.webp';
import dashboardShot from '@/assets/landing/dashboard.webp';
import employeesShot from '@/assets/landing/employees.webp';
import leaveShot from '@/assets/landing/leave.webp';
import { Bento } from './bento';
import { Contact } from './contact';
import { ParticleHeadline } from './particle-headline';
import { magnet, magnetOff, useReveal, useScenes } from './use-reveal';
import './landing.css';

/**
 * Public landing page — what a signed-out visitor sees at `/`
 * (`ProtectedRoute` renders it instead of redirecting to /login there).
 * A scroll-driven story in the app's dark midnight and gold that ends in a
 * sunrise into its cream; see landing.css for how the scenes work.
 * Screenshots show the real UI filled with invented demo people. Every claim
 * here is something the product actually does today, with no customer logos,
 * testimonials or usage numbers we can't back up.
 */
export function LandingPage() {
  const root = React.useRef<HTMLDivElement>(null);
  const light = React.useRef<HTMLDivElement>(null);
  useReveal(root);
  useScenes(root);

  React.useEffect(() => {
    const previous = document.title;
    document.title = 'Lumen HRMS — People operations, illuminated.';
    return () => {
      document.title = previous;
    };
  }, []);

  // The cursor light trails the pointer rather than sticking to it.
  React.useEffect(() => {
    const node = light.current;
    if (!node || !window.matchMedia('(hover: hover)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const goal = { x: window.innerWidth / 2, y: window.innerHeight / 3 };
    const at = { ...goal };
    let frame = 0;
    const tick = () => {
      at.x += (goal.x - at.x) * 0.1;
      at.y += (goal.y - at.y) * 0.1;
      node.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`;
      const settled = Math.abs(goal.x - at.x) + Math.abs(goal.y - at.y) < 0.5;
      frame = settled ? 0 : requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      goal.x = e.clientX;
      goal.y = e.clientY;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Nav and hero links glide to their section instead of jumping.
  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    html.style.scrollBehavior = 'smooth';
    return () => {
      html.style.scrollBehavior = previous;
    };
  }, []);

  return (
    <div ref={root} className="landing min-h-screen">
      <div ref={light} aria-hidden="true" className="cursor-light" />
      <Nav />
      <main>
        <Hero />
        <Statement />
        <Gallery />
        <Marquee />
        <Bento />
        <Security />
        <Sunrise />
        <div className="cream-zone">
          <Contact />
          <Footer />
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <header className="landing-nav">
      <span aria-hidden="true" className="nav-scrim" />
      <span aria-hidden="true" className="nav-scrim nav-scrim--dawn" />
      <div className="flex h-14 items-center justify-center gap-6 px-6 sm:gap-10">
        <a href="#top" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <img src={lumenMark} alt="" className="h-6 w-6 object-contain" />
          Lumen
        </a>
        <nav className="flex items-center gap-6 text-[13px]">
          <a href="#product" className="nav-link hidden sm:inline">
            Product
          </a>
          <a href="#security" className="nav-link hidden sm:inline">
            Security
          </a>
          <a href="#contact" className="nav-link hidden sm:inline">
            Contact
          </a>
          <Link to="/login" className="btn-gold rounded-md px-4 py-1.5 font-medium">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function Hero() {
  const scene = React.useRef<HTMLElement>(null);
  return (
    <section ref={scene} id="top" data-scene className="hero-scene">
      <div className="sticky-frame">
        <div aria-hidden="true" className="hero-glow" />
        <svg aria-hidden="true" viewBox="0 0 100 100" className="hero-ring">
          <defs>
            <linearGradient id="ringGold" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#e0b23e" stopOpacity="0" />
              <stop offset="100%" stopColor="#e0b23e" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="49" />
        </svg>
        <h1 className="hero-title">People operations, illuminated.</h1>
        <ParticleHeadline scene={scene} />
        <div className="hero-copy">
          <p
            className="rise mx-auto max-w-2xl text-balance text-lg leading-relaxed text-[var(--text-2)] sm:text-[21px]"
            style={{ '--d': '1100ms' } as React.CSSProperties}
          >
            Records, leave, attendance and documents in one secure workspace, built for growing
            Indian teams.
          </p>
          <div
            className="rise mt-8 flex items-center justify-center gap-7"
            style={{ '--d': '1300ms' } as React.CSSProperties}
          >
            <a
              href="#contact"
              onPointerMove={magnet}
              onPointerLeave={magnetOff}
              className="btn-gold rounded-md px-7 py-3 text-[15px] font-semibold"
            >
              Talk to us
            </a>
            <Link to="/login" className="text-link inline-flex items-center gap-0.5 text-[15px]">
              Sign in <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <div className="hero-device">
          <img
            src={dashboardShot}
            width={1440}
            height={900}
            alt="The Lumen dashboard: today's attendance, headcount, people on leave and approvals waiting."
            className="shot"
          />
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const STATEMENT =
  'Behind every record is a person. Lumen keeps the record right, so you can look after the person.'.split(' ');

function Statement() {
  return (
    <section data-scene className="statement-scene">
      <div className="sticky-frame flex items-center justify-center px-6">
        <p className="statement" style={{ '--n': STATEMENT.length } as React.CSSProperties}>
          {STATEMENT.map((word, i) => (
            <React.Fragment key={i}>
              <span
                className={`word ${word.startsWith('person') ? 'word--lit' : ''}`}
                style={{ '--i': i } as React.CSSProperties}
              >
                {word}
              </span>{' '}
            </React.Fragment>
          ))}
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const SCREENS = [
  {
    kicker: 'People',
    title: 'One record for every person.',
    body: 'From before their first day to after their last. Search anyone, see who they report to, and import your whole team from one sheet.',
    shot: employeesShot,
    height: 900,
    alt: 'The Lumen employee directory with departments, managers and status.',
  },
  {
    kicker: 'Leave',
    title: 'Leave that runs itself.',
    body: 'Requests find the right approver on their own. Balances, holidays and accruals stay correct without a spreadsheet.',
    shot: leaveShot,
    height: 900,
    alt: 'The Lumen leave overview with balances, requests and recent activity.',
  },
  {
    kicker: 'Attendance',
    title: 'Your shifts. Your rules.',
    body: 'Clock in from the browser, track breaks and overtime against your own shifts, and close out every day automatically.',
    shot: attendanceShot,
    height: 500,
    alt: 'The Lumen attendance page with a live clock-in timer and monthly stats.',
  },
];

function Gallery() {
  return (
    <section id="product" data-scene className="gallery-scene">
      <div className="sticky-frame">
        <div className="gallery-track">
          {SCREENS.map(({ kicker, title, body, shot, height, alt }, i) => (
            <article key={kicker} className="gallery-panel" style={{ '--i': i } as React.CSSProperties}>
              <span aria-hidden="true" className="panel-ghost">
                {kicker}
              </span>
              <div className="panel-text">
                <p className="kicker">{kicker}</p>
                <h2 className="mt-2">{title}</h2>
                <p className="mt-5 text-lg leading-relaxed text-[var(--text-2)]">{body}</p>
              </div>
              <div className="panel-shot">
                <img src={shot} width={1440} height={height} alt={alt} decoding="async" className="shot" />
              </div>
            </article>
          ))}
        </div>
        <div aria-hidden="true" className="gallery-rail" />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const MARQUEE = 'Records · Leave · Attendance · Documents · Org chart · Audit trail · Reports ·';

function Marquee() {
  return (
    <div aria-hidden="true" className="marquee">
      <div className="marquee-track">
        <span>{MARQUEE}</span>
        <span>{MARQUEE}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

const SECURITY = [
  { icon: Database, title: 'Walled off', body: "Each company's data is fenced in by the database itself, not just by our code." },
  { icon: Lock, title: 'Encrypted', body: 'PAN and bank details are encrypted, masked on screen, and logged when revealed.' },
  { icon: ShieldCheck, title: 'Minimised', body: 'We keep only the last four digits of Aadhaar. The full number is never stored.' },
];

function Security() {
  return (
    <section id="security" data-scene className="security-scene">
      <div className="sticky-frame">
        <div data-reveal className="text-center">
          <h2 className="display-title">
            Private by <span className="gold-word">design</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-balance text-lg leading-relaxed text-[var(--text-2)]">
            HR data is the most personal data a company holds. We treat it that way.
          </p>
        </div>
        <div className="fan">
          {SECURITY.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="fan-card" style={{ '--i': i } as React.CSSProperties}>
              <Icon className="h-6 w-6 text-[var(--gold)]" />
              <h3 className="mt-5 text-lg font-semibold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--text-2)]">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function Sunrise() {
  return (
    <section data-scene="sunrise" className="sunrise-scene">
      <div className="sticky-frame">
        <div aria-hidden="true" className="sun" />
        <div className="sunrise-copy">
          <h2 className="display-title max-w-4xl">Your whole organisation, in full view.</h2>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer>
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 pb-6 text-sm text-[var(--text-2)] sm:flex-row">
        <span>Lumen HRMS. People operations, illuminated.</span>
        <span>© {new Date().getFullYear()}</span>
      </div>
      <div aria-hidden="true" className="footer-word">
        Lumen
      </div>
    </footer>
  );
}
