'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface FieldWrapProps {
  label?: string;
  /** Tooltip shown on hover over the label (e.g. an abbreviation's full form). */
  labelTitle?: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

export function FieldWrap({
  label,
  labelTitle,
  required,
  error,
  className,
  children,
}: FieldWrapProps) {
  return (
    <div className={className}>
      {label && (
        <label
          className={cn('label', labelTitle && 'cursor-help')}
          title={labelTitle}
        >
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  labelTitle?: string;
  required?: boolean;
  error?: string;
  wrapClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, labelTitle, required, error, wrapClassName, className, ...props },
  ref,
) {
  return (
    <FieldWrap
      label={label}
      labelTitle={labelTitle}
      required={required}
      error={error}
      className={wrapClassName}
    >
      <input ref={ref} className={cn('input-base', className)} {...props} />
    </FieldWrap>
  );
});

type SelectOption = { value: string | number; label: string };

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  required?: boolean;
  error?: string;
  wrapClassName?: string;
  options?: SelectOption[];
  placeholder?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    required,
    error,
    wrapClassName,
    className,
    options,
    placeholder,
    children,
    ...props
  },
  ref,
) {
  return (
    <FieldWrap
      label={label}
      required={required}
      error={error}
      className={wrapClassName}
    >
      <select ref={ref} className={cn('input-base', className)} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          : children}
      </select>
    </FieldWrap>
  );
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  required?: boolean;
  error?: string;
  wrapClassName?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, required, error, wrapClassName, className, ...props },
    ref,
  ) {
    return (
      <FieldWrap
        label={label}
        required={required}
        error={error}
        className={wrapClassName}
      >
        <textarea
          ref={ref}
          className={cn('input-base min-h-[84px] resize-y', className)}
          {...props}
        />
      </FieldWrap>
    );
  },
);

type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
> & {
  label?: string;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, className, ...props }, ref) {
    return (
      <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          ref={ref}
          type="checkbox"
          className={cn(
            'h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800',
            className,
          )}
          {...props}
        />
        {label && <span>{label}</span>}
      </label>
    );
  },
);
