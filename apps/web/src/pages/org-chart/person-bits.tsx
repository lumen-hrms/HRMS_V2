import * as React from 'react';
import { Check, Copy, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hueVar, initials, type OrgNode } from './model';

/** Photo avatar that falls back to department-tinted initials (also on a broken image URL). */
export function PersonAvatar({
  person,
  size = 40,
  className,
}: {
  person: Pick<OrgNode, 'firstName' | 'lastName' | 'photoUrl' | 'department'>;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = React.useState(false);
  const hue = hueVar(person.department?.id);
  const style: React.CSSProperties = { width: size, height: size, fontSize: size * 0.36 };

  if (person.photoUrl && !broken) {
    return (
      <img
        src={person.photoUrl}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
        style={style}
        className={cn('shrink-0 rounded-full object-cover ring-2 ring-card', className)}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{
        ...style,
        color: hue,
        background: `color-mix(in srgb, ${hue} 16%, var(--card))`,
      }}
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-2 ring-card',
        className,
      )}
    >
      {initials(person)}
    </div>
  );
}

/** Department chip in the department's accent hue. */
export function DeptChip({ department }: { department: OrgNode['department'] }) {
  if (!department) return null;
  const hue = hueVar(department.id);
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: hue, background: `color-mix(in srgb, ${hue} 12%, transparent)` }}
    >
      {department.name}
    </span>
  );
}

/** Icon + value row with an optional link and a copy-to-clipboard button. */
export function ContactRow({
  icon: Icon,
  value,
  href,
  copyable,
  label,
}: {
  icon: LucideIcon;
  value: React.ReactNode;
  href?: string;
  copyable?: string;
  label: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    if (!copyable) return;
    try {
      await navigator.clipboard.writeText(copyable);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be blocked (insecure origin / permissions) — nothing useful to do.
    }
  }

  return (
    <div className="group/row flex min-w-0 items-center gap-2.5 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{label}: </span>
      {href ? (
        <a
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate text-foreground hover:text-primary hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate">{value}</span>
      )}
      {copyable && (
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}
