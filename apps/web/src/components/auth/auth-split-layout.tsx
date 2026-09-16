import * as React from 'react';
// Brand panel is a fixed navy constant — always the white mark (transparent PNG).
import lumenMark from '@/assets/brand/lumen-mark-white.png';

/**
 * Shared shell for every auth screen (tenant sign-in, Platform Admin
 * sign-in, and both their password-reset sub-views) — a fixed-navy brand
 * panel on the left (deliberately NOT theme-driven, same navy in light or
 * dark mode — it's a brand constant, not a surface) and a theme-aware form
 * panel on the right. See the approved Lumen login design (Claude Design
 * canvas) for the full spec this implements.
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
    <div className="flex min-h-screen">
      <div
        data-brand-panel
        className="relative isolate flex w-[45%] max-md:w-full flex-col justify-center overflow-hidden px-12 py-14 max-md:px-6 max-md:py-9"
        style={{ background: '#020E19' }}
      >
        {/* Ambient motion — slow-drifting aurora blobs + a fine dot grid. */}
        <span aria-hidden="true" className="brand-aurora brand-aurora--gold" />
        <span aria-hidden="true" className="brand-aurora brand-aurora--blue" />
        <span aria-hidden="true" className="brand-grid" />

        <div
          className="brand-hairline pointer-events-none absolute inset-x-0 top-[18%] h-px"
          style={{ background: '#F5B544' }}
        />
        <div
          className="brand-hairline pointer-events-none absolute inset-x-0 top-[52%] h-px"
          style={{ background: '#F5B544', animationDelay: '-4s' }}
        />
        <div
          className="brand-hairline pointer-events-none absolute inset-x-0 top-[82%] h-px"
          style={{ background: '#F5B544', animationDelay: '-8s' }}
        />

        <div className="brand-in relative z-[2] mb-12 flex flex-col items-start gap-5">
          <div className="relative">
            <span aria-hidden="true" className="brand-mark-halo" />
            <img
              src={lumenMark}
              alt=""
              className="relative h-24 w-24 shrink-0 object-contain max-md:h-16 max-md:w-16"
            />
          </div>
          <div className="flex flex-col">
            <span
              className="text-[34px] font-bold leading-none tracking-tight max-md:text-[28px]"
              style={{ color: '#F5F7F9' }}
            >
              Lumen
            </span>
            <span
              className="mt-2.5 text-[11px] font-semibold uppercase"
              style={{ color: '#8FA0AD', letterSpacing: '0.36em' }}
            >
              Enterprise Suite
            </span>
          </div>
        </div>

        <h2
          className="brand-in relative z-[2] mb-5 max-w-[360px] text-[26px] font-bold leading-[1.3]"
          style={{ color: '#F5F7F9', animationDelay: '80ms' }}
        >
          Empower People. Build Tomorrow.
        </h2>
        {taglineLines.map((line, i) => (
          <p
            key={line}
            className="brand-in relative z-[2] mb-2.5 max-w-[360px] text-[15px] leading-relaxed"
            style={{ color: '#AAB7C2', animationDelay: `${140 + i * 60}ms` }}
          >
            {line}
          </p>
        ))}

        {operatorBadge && (
          <div
            className="brand-in relative z-[2] mt-6 w-fit rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
            style={{ background: 'rgba(245,181,68,0.12)', color: '#F5B544', animationDelay: '260ms' }}
          >
            Operator access
          </div>
        )}
      </div>

      <div
        data-form-col
        className="flex w-[55%] max-md:w-full items-center justify-center px-8 py-12"
        style={{ background: 'var(--lumen-bg)' }}
      >
        <div className="w-full max-w-[400px]">{children}</div>
      </div>
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
          className="lumen-auth-input w-full rounded-lg px-3.5 py-2.5 text-[15px] outline-none transition-[border-color,box-shadow] duration-150"
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
      className="mt-1.5 flex h-[46px] w-full items-center justify-center rounded-[9px] text-[15px] font-bold transition-[background,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed"
      style={{
        background: loading ? 'var(--lumen-gold-light)' : 'var(--lumen-gold)',
        color: '#07141F',
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
            border: '2.5px solid rgba(7,20,31,0.25)',
            borderTopColor: '#07141F',
            animation: 'lumenSpin 700ms linear infinite',
          }}
        />
      ) : (
        children
      )}
    </button>
  );
}
