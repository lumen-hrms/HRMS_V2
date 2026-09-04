import * as React from 'react';

export type FieldKind = 'subdomain' | 'email' | 'password';

/** Validates on blur, not on every keystroke — matches the approved Lumen
 * auth design. Exact copy per field kind, shared by every auth screen so
 * the messages never drift between the tenant and Platform Admin forms. */
export function validateAuthField(kind: FieldKind, value: string): string | null {
  if (kind === 'subdomain') {
    if (!value.trim()) return 'Enter your company subdomain';
    if (!/^[a-z0-9-]+$/i.test(value)) return 'Only letters, numbers, and hyphens allowed';
    return null;
  }
  if (kind === 'email') {
    if (!value.trim()) return 'Enter your email address';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address';
    return null;
  }
  if (kind === 'password') {
    if (!value) return 'Enter your password';
    if (value.length < 6) return 'Password must be at least 6 characters';
    return null;
  }
  return null;
}

/** One field's value/touched/error state, with a stable onChange/onBlur
 * pair suitable for <AuthField>. */
export function useAuthField(kind: FieldKind, initial = '') {
  const [value, setValue] = React.useState(initial);
  const [touched, setTouched] = React.useState(false);
  const error = touched ? validateAuthField(kind, value) : null;

  return {
    value,
    error,
    onChange: setValue,
    onBlur: () => setTouched(true),
    /** Marks touched + returns whether the field is currently valid — for
     * validating every field at once on submit. */
    validateNow: () => {
      setTouched(true);
      return !validateAuthField(kind, value);
    },
  };
}
