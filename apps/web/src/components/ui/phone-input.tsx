import * as React from 'react';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { COUNTRIES, joinPhone, phoneError, splitPhone } from '@/lib/phone';

const VALIDATE_DEBOUNCE_MS = 400;

/**
 * Country-code dropdown + national number. `value` / `onChange` carry the whole
 * number as `+<dial><digits>` ('' when empty). With `validate` (default) it shows
 * a per-country format message shortly after typing stops; pass `validate={false}`
 * where the caller already shows server-side errors.
 */
export function PhoneInput({
  value,
  onChange,
  disabled,
  validate = true,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  validate?: boolean;
  id?: string;
}) {
  const parsed = splitPhone(value);
  // The dropdown must remember a country while the number is still empty.
  const [picked, setPicked] = React.useState(parsed.country);
  const country = value ? parsed.country : picked;

  const [message, setMessage] = React.useState<string | undefined>();
  React.useEffect(() => {
    if (!validate) return;
    const timer = window.setTimeout(() => setMessage(phoneError(value)), VALIDATE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value, validate]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Select
          className="w-28 shrink-0"
          aria-label="Country code"
          value={country}
          disabled={disabled}
          onChange={(e) => {
            setPicked(e.target.value);
            onChange(joinPhone(e.target.value, parsed.national));
          }}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} +{c.dial}
            </option>
          ))}
        </Select>
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          disabled={disabled}
          value={parsed.national}
          aria-invalid={message ? true : undefined}
          onChange={(e) => onChange(joinPhone(country, e.target.value))}
        />
      </div>
      {validate && message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}
