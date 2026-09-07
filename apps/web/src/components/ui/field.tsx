import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/input';

/**
 * Form field wrapper: label + control + optional hint/error. Keeps the
 * label/spacing/error markup identical across every form in the app.
 *
 *   <Field label="Leave type" error={errors.type} hint="Half-day not supported yet">
 *     <Select .../>
 *   </Field>
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
