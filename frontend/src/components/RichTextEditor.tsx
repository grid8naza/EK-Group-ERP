'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FONT_OPTIONS, type TextAlign } from '@/lib/login-screen';

const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 52, 64];

/**
 * Lightweight WYSIWYG editor (contentEditable) that emits inline-styled HTML so
 * it renders anywhere without extra CSS. Toolbar: bold / italic / underline,
 * font family, size, colour, alignment. Output is sanitized at render time
 * (see sanitizeHtml). Bold/Italic/Underline/Align use execCommand with CSS
 * styling; font family / size / colour wrap the selection in a styled span
 * (whole field when nothing is selected).
 */
export function RichTextEditor({
  value,
  onChange,
  baseStyle,
  bgClassName,
  placeholder,
  align,
  onAlign,
}: {
  value: string;
  onChange: (html: string) => void;
  baseStyle?: CSSProperties;
  bgClassName?: string;
  placeholder?: string;
  align?: TextAlign;
  onAlign?: (a: TextAlign) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Seed / sync content without clobbering the caret while editing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.innerHTML !== (value ?? '')) el.innerHTML = value ?? '';
  }, [value]);

  const emit = () => ref.current && onChange(ref.current.innerHTML);

  const exec = (command: string, arg?: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, arg);
    emit();
  };

  // Wrap the current selection (or the whole field if collapsed) in a styled span.
  const applyStyle = (style: Partial<CSSProperties>) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let range = sel.getRangeAt(0);
    if (range.collapsed || !el.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
    }
    const span = document.createElement('span');
    Object.assign(span.style, style);
    try {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
      sel.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(span);
      sel.addRange(nr);
    } catch {
      /* ignore exotic selections */
    }
    emit();
  };

  const btn =
    'flex h-8 w-8 items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800';

  return (
    <div className="rounded-lg border border-slate-300 dark:border-slate-600">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 p-2 dark:border-slate-700">
        <button
          type="button"
          className={btn}
          title="Bold"
          onClick={() => exec('bold')}
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={btn}
          title="Italic"
          onClick={() => exec('italic')}
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={btn}
          title="Underline"
          onClick={() => exec('underline')}
        >
          <Underline className="h-4 w-4" />
        </button>

        <select
          className="h-8 rounded border border-slate-300 bg-white px-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          title="Font"
          defaultValue=""
          onChange={(e) => {
            const f = FONT_OPTIONS.find((o) => o.value === e.target.value);
            if (f?.stack) applyStyle({ fontFamily: f.stack });
            e.target.value = '';
          }}
        >
          <option value="" disabled>
            Font
          </option>
          {FONT_OPTIONS.filter((f) => f.stack).map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          className="h-8 rounded border border-slate-300 bg-white px-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          title="Font size"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) applyStyle({ fontSize: `${e.target.value}px` });
            e.target.value = '';
          }}
        >
          <option value="" disabled>
            Size
          </option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className={cn(btn, 'cursor-pointer p-0')} title="Text color">
          <input
            type="color"
            className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
            onChange={(e) => applyStyle({ color: e.target.value })}
          />
        </label>

        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

        {(
          [
            ['left', AlignLeft, 'Align left'],
            ['center', AlignCenter, 'Align center'],
            ['right', AlignRight, 'Align right'],
          ] as const
        ).map(([a, Icon, title]) => (
          <button
            key={a}
            type="button"
            title={title}
            onClick={() => onAlign?.(a)}
            className={cn(
              btn,
              (align ?? 'left') === a &&
                'bg-brand-50 text-brand-600 dark:bg-brand-950',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        data-placeholder={placeholder}
        className={cn(
          'min-h-[64px] px-3 py-2 outline-none [&:empty::before]:text-slate-400 [&:empty::before]:content-[attr(data-placeholder)]',
          bgClassName,
        )}
        style={baseStyle}
      />
    </div>
  );
}
