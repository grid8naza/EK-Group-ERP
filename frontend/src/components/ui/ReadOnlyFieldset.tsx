'use client';

import { focusNextField } from './Field';

/**
 * Wraps a form body and, when `readOnly` is true, disables every control inside
 * via a native disabled <fieldset> — without affecting layout. Used to render
 * master forms read-only in "view" mode (e.g. for locked records).
 *
 * It also carries the app-wide data-entry keyboard rule: Enter moves to the next
 * field rather than doing nothing. Marking the body `data-enter-advance` is what
 * puts a form under the rule, so every drawer that uses this wrapper gets it
 * without wiring anything per field.
 */
export function ReadOnlyFieldset({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: React.ReactNode;
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/⌘+Enter is Save & New and Shift+Enter is a deliberate newline, so
    // only a bare Enter advances. A field that handles Enter itself (the
    // pickers, an explicit `enterTo` chain) has already called preventDefault.
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const el = e.target as HTMLElement;
    // Textareas keep Enter for new lines; buttons keep it for activation.
    if (el.tagName !== 'INPUT') return;
    e.preventDefault();
    focusNextField(el);
  };

  return (
    <fieldset
      disabled={readOnly}
      onKeyDown={onKeyDown}
      data-enter-advance=""
      className="m-0 min-w-0 border-0 p-0"
    >
      {children}
    </fieldset>
  );
}
