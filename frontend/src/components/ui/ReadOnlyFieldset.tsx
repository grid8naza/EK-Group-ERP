'use client';

/**
 * Wraps a form body and, when `readOnly` is true, disables every control inside
 * via a native disabled <fieldset> — without affecting layout. Used to render
 * master forms read-only in "view" mode (e.g. for locked records).
 */
export function ReadOnlyFieldset({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
      {children}
    </fieldset>
  );
}
