import * as React from 'react';
import { Link } from 'react-router-dom';
// Same mark the landing nav uses on its midnight background.
import lumenMark from '@/assets/brand/lumen-mark-dark.png';
import './auth-scene.css';

/**
 * Shared shell for every auth screen (tenant sign-in, Platform Admin
 * sign-in, and both their password-reset sub-views). Same look as the
 * landing page: midnight with gold light and a slow ring, the form on a
 * single centred card. Deliberately NOT theme-driven; see auth-scene.css.
 * The name is historical (it used to be a split panel); the props are kept
 * so the four callers don't change.
 */
export function AuthSplitLayout({
  taglineLines,
  operatorBadge,
  children,
}: {
  taglineLines: [string, string];
  operatorBadge?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-scene">
      <div aria-hidden="true" className="auth-glow" />
      <svg aria-hidden="true" viewBox="0 0 100 100" className="auth-ring">
        <defs>
          <linearGradient id="authRingGold" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#e0b23e" stopOpacity="0" />
            <stop offset="100%" stopColor="#e0b23e" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="49" />
      </svg>

      <header className="flex h-14 items-center justify-between px-5 sm:px-8">
        <Link to="/" className="auth-brand">
          <img src={lumenMark} alt="" className="h-6 w-6 object-contain" />
          Lumen
        </Link>
        <Link to="/" className="auth-back">
          Back to home
        </Link>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-10 pt-4 sm:px-6">
        <div className="auth-card auth-rise">{children}</div>

        <div
          className="auth-rise mt-6 flex max-w-[440px] flex-col items-center gap-2 text-center text-[13.5px] leading-relaxed"
          style={{ '--d': '200ms', color: 'var(--lumen-text-secondary)' } as React.CSSProperties}
        >
          {operatorBadge && (
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
              style={{ background: 'rgba(224, 178, 62, 0.12)', color: 'var(--lumen-gold)' }}
            >
              Operator access
            </span>
          )}
          {taglineLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </main>
    </div>
  );
}

export function AuthBanner({
  kind,
  children,
}: {
  kind: 'error' | 'success';
  children: React.ReactNode;
}) {
  const isError = kind === 'error';
  return (
    <div
      role={isError ? 'alert' : undefined}
      className="mb-5 flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3"
      style={{
        background: isError ? 'var(--lumen-error-soft)' : 'var(--lumen-success-soft)',
        borderColor: isError ? 'var(--lumen-error)' : 'var(--lumen-success)',
        animation: isError ? 'lumenShake 400ms ease' : 'lumenFadeIn 220ms ease',
      }}
    >
      <div
        className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
        style={{ background: isError ? 'var(--lumen-error)' : 'var(--lumen-success)' }}
      >
        {isError ? '!' : '✓'}
      </div>
      <div
        className="text-[13.5px] leading-relaxed"
        style={{ color: isError ? 'var(--lumen-error)' : 'var(--lumen-success)' }}
      >
        {children}
      </div>
    </div>
  );
}

export function AuthField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  error,
  placeholder,
  autoComplete,
  isPassword,
  showPassword,
  onToggleShow,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  error?: string | null;
  placeholder?: string;
  autoComplete?: string;
  isPassword?: boolean;
  showPassword?: boolean;
  onToggleShow?: () => void;
}) {
  const errId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold" style={{ color: 'var(--lumen-text)' }}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type={isPassword ? (showPassword ? 'text' : 'password') : type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="lumen-auth-input w-full rounded-xl px-3.5 py-2.5 text-[15px] outline-none transition-[border-color,box-shadow] duration-150"
          style={{
            background: 'var(--lumen-surface)',
            color: 'var(--lumen-text)',
            border: `1px solid ${error ? 'var(--lumen-error)' : 'var(--lumen-border)'}`,
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={onToggleShow}
            className="shrink-0 whitespace-nowrap px-0.5 py-1 text-[12.5px] font-semibold"
            style={{ color: 'var(--lumen-gold)' }}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {error && (
        <div id={errId} className="text-[12.5px]" style={{ color: 'var(--lumen-error)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function AuthSubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="mt-1.5 flex h-[46px] w-full items-center justify-center rounded-xl text-[15px] font-bold transition-[background,box-shadow,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed"
      style={{
        background: loading ? 'var(--lumen-gold-light)' : 'var(--lumen-gold)',
        color: '#030812',
        boxShadow: '0 0 34px -6px rgba(224, 178, 62, 0.65)',
      }}
      onMouseEnter={(e) => {
        if (!loading) e.currentTarget.style.background = 'var(--lumen-gold-light)';
      }}
      onMouseLeave={(e) => {
        if (!loading) e.currentTarget.style.background = 'var(--lumen-gold)';
      }}
    >
      {loading ? (
        <span
          className="h-[18px] w-[18px] rounded-full"
          style={{
            border: '2.5px solid rgba(3,8,18,0.25)',
            borderTopColor: '#030812',
            animation: 'lumenSpin 700ms linear infinite',
          }}
        />
      ) : (
        children
      )}
    </button>
  );
}
