'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A small formatting editor, and the viewer that renders what it produced.
 *
 * Built here rather than pulled in: what a circular or an announcement needs is
 * bold, a list and a heading, and every editor package that does that also
 * brings a document model, a plugin system and a megabyte of schema for the
 * things it does not need. This is a contentEditable box with six buttons.
 *
 * `document.execCommand` is deprecated and has no replacement — every browser
 * still implements it precisely because contentEditable has nothing else, and
 * the packages above reimplement the same six operations by hand. When one of
 * them becomes worth its weight (tables, images, collaborative editing), this
 * component is the only file that changes: everything else deals in HTML.
 *
 * Safety lives on the server (backend common/rich-text.ts): whatever is typed,
 * pasted or forged into the request is cut to an inert allowlist on the way in.
 * The paste handler below is about tidiness — text pasted from Word arriving as
 * text — not about security, which cannot be enforced from in here anyway.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 200,
  disabled,
}: {
  /** HTML. Read on mount and when it changes from outside — see below. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /**
   * The last HTML this component itself emitted.
   *
   * A contentEditable cannot be driven from state like an input: writing
   * innerHTML on every keystroke rebuilds the DOM under the caret and throws it
   * back to the start of the box. So the element owns its content, and the prop
   * is only adopted when it differs from what we last sent up — which is a
   * genuine outside change (a form reset, a draft loaded) rather than our own
   * keystroke coming back around.
   */
  const emitted = useRef<string | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== emitted.current) {
      el.innerHTML = value ?? '';
      emitted.current = value ?? '';
      setEmpty(isBlank(el));
    }
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    setEmpty(isBlank(el));
    // An "empty" contentEditable still holds <br> or an empty <div>. Report it
    // as nothing, so "did they write a body" is a plain falsy check upstream.
    const html = isBlank(el) ? '' : el.innerHTML;
    emitted.current = html;
    onChange(html);
  };

  const run = (command: string, argument?: string) => {
    const el = ref.current;
    if (!el || disabled) return;
    el.focus();
    // Produce <b>/<i> rather than <span style>: the server drops every
    // attribute, so a style-based bold would arrive as no bold at all.
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(command, false, argument);
    emit();
  };

  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/25 dark:border-slate-700 dark:bg-slate-900',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-1.5 py-1 dark:border-slate-700">
        <Tool label="Bold" hint="Ctrl+B" onClick={() => run('bold')}>
          <Bold className="h-3.5 w-3.5" />
        </Tool>
        <Tool label="Italic" hint="Ctrl+I" onClick={() => run('italic')}>
          <Italic className="h-3.5 w-3.5" />
        </Tool>
        <Tool label="Underline" hint="Ctrl+U" onClick={() => run('underline')}>
          <Underline className="h-3.5 w-3.5" />
        </Tool>
        <Tool label="Strikethrough" onClick={() => run('strikeThrough')}>
          <Strikethrough className="h-3.5 w-3.5" />
        </Tool>
        <Divider />
        {/* The angle-bracket form of the block name: Firefox has only ever
            accepted `<h3>`, while Chrome and Safari take either. */}
        <Tool
          label="Heading"
          onClick={() => run('formatBlock', '<h3>')}
          text="H"
        />
        <Tool label="Bulleted list" onClick={() => run('insertUnorderedList')}>
          <List className="h-3.5 w-3.5" />
        </Tool>
        <Tool label="Numbered list" onClick={() => run('insertOrderedList')}>
          <ListOrdered className="h-3.5 w-3.5" />
        </Tool>
        <Tool label="Quote" onClick={() => run('formatBlock', '<blockquote>')}>
          <Quote className="h-3.5 w-3.5" />
        </Tool>
        <Divider />
        <Tool
          label="Clear formatting"
          onClick={() => {
            run('removeFormat');
            run('formatBlock', '<p>');
          }}
        >
          <RemoveFormatting className="h-3.5 w-3.5" />
        </Tool>
      </div>

      <div className="relative">
        {empty && placeholder && (
          <span className="pointer-events-none absolute left-3 top-2 text-sm text-slate-400">
            {placeholder}
          </span>
        )}
        <div
          ref={ref}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          onInput={emit}
          onBlur={emit}
          onPaste={(e) => {
            // Paste as text. What comes off a clipboard from a website or a
            // Word document is a page's worth of styling that the server would
            // strip anyway — better it never looks pasted in the first place.
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
            emit();
          }}
          style={{ minHeight }}
          className="rich-text w-full resize-y overflow-y-auto px-3 py-2 text-sm text-slate-800 outline-none dark:text-slate-100"
        />
      </div>
    </div>
  );
}

/**
 * Formatted text, as written.
 *
 * `dangerouslySetInnerHTML` is safe HERE and only here because the string comes
 * back from the server, which sanitised it on the way in (backend
 * common/rich-text.ts). Never point this at HTML from anywhere else.
 */
export function RichText({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  return (
    <div
      className={cn('rich-text', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Nothing but whitespace and empty formatting — `<p><br></p>` is what an editor
 * somebody clicked into and out of leaves behind. The same rule the server
 * applies (backend common/rich-text.ts), so the placeholder showing and the
 * body being stored never disagree.
 */
function isBlank(el: HTMLElement): boolean {
  return (el.textContent ?? '').trim() === '';
}

/**
 * Does this formatted body say anything?
 *
 * The same question isBlank asks, for callers holding the HTML rather than the
 * element — "may this be sent". Tags out, entities that render as nothing but
 * space out, then look for a character. The server decides the same thing its
 * own way (sanitizeRichText reduces empty formatting to ''), so a body that
 * passes here passes there.
 */
export function richTextIsEmpty(html: string): boolean {
  if (!html) return true;
  return (
    html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim() === ''
  );
}

function Tool({
  label,
  hint,
  onClick,
  children,
  text,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  children?: React.ReactNode;
  text?: string;
}) {
  return (
    <button
      type="button"
      title={hint ? `${label} (${hint})` : label}
      aria-label={label}
      // The toolbar must not steal the selection it is about to act on —
      // mousedown is where focus moves, so that is where it is stopped.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {text ? <span className="text-xs font-bold">{text}</span> : children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />;
}
