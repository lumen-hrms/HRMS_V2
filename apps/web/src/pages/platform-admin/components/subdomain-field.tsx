import * as React from 'react';
import { Check, X } from 'lucide-react';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const RE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;

export type SubdomainState =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'taken' }
  | { kind: 'ok' };

export function validateSubdomain(value: string, taken: string[]): SubdomainState {
  const v = value.trim().toLowerCase();
  if (!v) return { kind: 'empty' };
  if (v.length < 3 || v.length > 30)
    return { kind: 'invalid', message: '3–30 characters' };
  if (!RE.test(v))
    return {
      kind: 'invalid',
      message: 'lowercase letters, digits and hyphens; no leading/trailing hyphen',
    };
  if (taken.includes(v)) return { kind: 'taken' };
  return { kind: 'ok' };
}

/**
 * Subdomain input with format rules + a local uniqueness check against
 * `taken` (there is no dedicated availability endpoint yet — TODO(api) — so
 * we check the loaded tenant list) + a live URL preview.
 */
export function SubdomainField({
  value,
  onChange,
  taken,
  onStateChange,
}: {
  value: string;
  onChange: (v: string) => void;
  taken: string[];
  onStateChange?: (ok: boolean) => void;
}) {
  const state = validateSubdomain(value, taken);
  React.useEffect(() => {
    onStateChange?.(state.kind === 'ok');
  }, [state.kind, onStateChange]);

  const showError = state.kind === 'invalid' || state.kind === 'taken';

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="subdomain">Subdomain</Label>
      <div className="relative">
        <Input
          id="subdomain"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="acme"
          aria-invalid={showError}
          className={cn('pr-9 font-mono', showError && 'border-destructive focus-visible:ring-destructive')}
        />
        {state.kind === 'ok' && (
          <Check className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-success" />
        )}
        {(state.kind === 'taken' || state.kind === 'invalid') && (
          <X className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-destructive" />
        )}
      </div>
      {state.kind === 'invalid' && (
        <p className="text-xs text-destructive">{state.message}</p>
      )}
      {state.kind === 'taken' && (
        <p className="text-xs text-destructive">That subdomain is taken.</p>
      )}
      {state.kind !== 'invalid' && state.kind !== 'taken' && (
        <p className="text-xs text-muted-foreground">
          {value.trim()
            ? `${value.trim()}.hrms-platform.com`
            : 'Becomes ‹subdomain›.hrms-platform.com — immutable after creation.'}
        </p>
      )}
    </div>
  );
}
