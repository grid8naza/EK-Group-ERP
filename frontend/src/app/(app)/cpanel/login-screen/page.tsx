'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Upload,
  Trash2,
  Bold,
  Italic,
  Save,
  Plus,
  X,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input, Select, Checkbox, Textarea } from '@/components/ui/Field';
import { LoginCarousel } from '@/components/LoginCarousel';
import { RichTextEditor } from '@/components/RichTextEditor';
import { cn } from '@/lib/utils';
import {
  type LoginScreenConfig,
  type LoginMedia,
  type TextStyle,
  type CtaButton,
  FONT_OPTIONS,
  FONT_SIZE_RANGE,
  LAYOUT_OPTIONS,
  withDefaults,
  resolveTextStyle,
  withAlpha,
  mediaUrl,
  sanitizeHtml,
  stripTextAlign,
  usedGoogleFonts,
  googleFontsHref,
  formatCopyright,
} from '@/lib/login-screen';

/** Plain text → minimal HTML (escape + line breaks), to seed the editor. */
function textToHtml(text?: string): string {
  if (!text) return '';
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc.replace(/\n/g, '<br>');
}

const ROUTE = '/cpanel/login-screen';

export default function LoginScreenSetupPage() {
  const { can } = useAuth();
  const toast = useToast();
  const readOnly = !can(ROUTE, 'edit');

  const [config, setConfig] = useState<LoginScreenConfig>(() => withDefaults(null));
  const [media, setMedia] = useState<LoginMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const logoInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get<{ config: LoginScreenConfig | null; media: LoginMedia[] }>(
          '/login-screen',
        );
        if (!active) return;
        setConfig(withDefaults(res.config));
        setMedia(res.media ?? []);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401))
          toast.error('Failed to load login screen settings.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // Load once on mount. (toast is intentionally omitted — it changes identity
    // each render and would otherwise re-fetch and clobber unsaved edits.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load any Google fonts referenced by the current config for the preview.
  useEffect(() => {
    const href = googleFontsHref(usedGoogleFonts(config));
    if (!href) return;
    if (document.querySelector(`link[data-login-font="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-login-font', href);
    document.head.appendChild(link);
  }, [config]);

  const patch = (p: Partial<LoginScreenConfig>) => setConfig((c) => ({ ...c, ...p }));
  const patchStyle = (key: keyof LoginScreenConfig, s: Partial<TextStyle>) =>
    setConfig((c) => ({ ...c, [key]: { ...(c[key] as TextStyle), ...s } }));

  const buttons = config.buttons ?? [];
  const setButtons = (next: CtaButton[]) => patch({ buttons: next });
  const updateButton = (i: number, b: Partial<CtaButton>) =>
    setButtons(buttons.map((x, idx) => (idx === i ? { ...x, ...b } : x)));
  const patchForgot = (p: Partial<NonNullable<LoginScreenConfig['forgotPassword']>>) =>
    patch({ forgotPassword: { ...config.forgotPassword, ...p } });
  const patchSecondary = (p: Partial<NonNullable<LoginScreenConfig['secondaryButton']>>) =>
    patch({ secondaryButton: { ...config.secondaryButton, ...p } });
  const patchSignUp = (p: Partial<NonNullable<LoginScreenConfig['signUp']>>) =>
    patch({ signUp: { ...config.signUp, ...p } });
  const patchKnowMore = (p: Partial<NonNullable<LoginScreenConfig['knowMore']>>) =>
    patch({ knowMore: { ...config.knowMore, ...p } });

  // Field-level alignment for the rich-text fields: store on the field's style
  // (applied to the render container) and strip any stale inline text-align.
  const alignHandler =
    (styleKey: keyof LoginScreenConfig, htmlKey: keyof LoginScreenConfig) =>
    (a: NonNullable<TextStyle['align']>) =>
      setConfig((c) => ({
        ...c,
        [styleKey]: { ...(c[styleKey] as TextStyle), align: a },
        [htmlKey]: stripTextAlign((c[htmlKey] as string) || ''),
      }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put<{ config: LoginScreenConfig | null; media: LoginMedia[] }>(
        '/login-screen',
        { config },
      );
      setConfig(withDefaults(res.config));
      setMedia(res.media ?? []);
      toast.success('Login screen saved.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post<{ config: LoginScreenConfig | null }>('/login-screen/logo', fd);
      patch({ logoUrl: res.config?.logoUrl ?? null });
      toast.success('Logo uploaded.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload failed.');
    }
  };

  const uploadMedia = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const m = await api.post<LoginMedia>('/login-screen/media', fd);
      setMedia((list) => [m, ...list]);
      toast.success('Media uploaded.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload failed.');
    }
  };

  const deleteMedia = async (id: number) => {
    try {
      const res = await api.delete<{ media: LoginMedia[]; config: LoginScreenConfig | null }>(
        `/login-screen/media/${id}`,
      );
      setMedia(res.media ?? []);
      if (config.backgroundMediaId === id) patch({ backgroundMediaId: null });
      toast.success('Media removed.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Delete failed.');
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Login Screen Setup" icon={<ImageIcon className="h-5 w-5" />} />
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Login Screen Setup"
        description="Customize the public login page — logo, text, colors and background."
        icon={<ImageIcon className="h-5 w-5" />}
        actions={
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            onClick={save}
            disabled={readOnly || saving}
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr,420px]">
        {/* ---- Controls ---- */}
        <fieldset disabled={readOnly} className="space-y-6">
          {/* Layout */}
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Layout</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {LAYOUT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => patch({ layout: opt.value })}
                  className={cn(
                    'rounded-lg border-2 p-3 text-left transition',
                    (config.layout ?? 'centered') === opt.value
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
                      : 'border-slate-200 dark:border-slate-700',
                  )}
                >
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {opt.label}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{opt.hint}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Logo */}
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Logo</h2>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                {config.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl(config.logoUrl)} alt="Logo" className="h-full w-full object-contain" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-slate-300" />
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2"
                  onClick={() => logoInput.current?.click()}
                >
                  <Upload className="h-4 w-4" /> Upload
                </button>
                {config.logoUrl && (
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-2 text-rose-600"
                    onClick={() => patch({ logoUrl: null })}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </button>
                )}
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadLogo(f);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="label">
                Logo size — {config.logoSize ?? 48}px
              </label>
              <input
                type="range"
                min={24}
                max={200}
                step={4}
                value={config.logoSize ?? 48}
                onChange={(e) => patch({ logoSize: Number(e.target.value) })}
                className="w-full max-w-xs accent-brand-600"
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">PNG, JPG, WEBP or GIF — up to 5 MB.</p>
          </section>

          {/* Heading (rich text) */}
          <RichField
            title="Heading"
            value={config.headingHtml || textToHtml(config.heading)}
            onChange={(html) => patch({ headingHtml: html })}
            style={config.headingStyle}
            onAlign={alignHandler('headingStyle', 'headingHtml')}
            bgClassName="bg-white text-slate-900"
          />

          {/* Description (rich text) */}
          <RichField
            title="Description"
            value={config.descriptionHtml || textToHtml(config.description)}
            onChange={(html) => patch({ descriptionHtml: html })}
            style={config.descriptionStyle}
            onAlign={alignHandler('descriptionStyle', 'descriptionHtml')}
            bgClassName="bg-white text-slate-900"
          />

          {/* Colors */}
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Colors</h2>
            <div className="flex flex-wrap gap-6">
              <ColorField
                label="Form card"
                value={config.cardColor ?? '#ffffff'}
                onChange={(v) => patch({ cardColor: v })}
              />
              <ColorField
                label="Page background"
                value={config.pageColor ?? '#f8fafc'}
                onChange={(v) => patch({ pageColor: v })}
              />
            </div>
            <div className="mt-4">
              <label className="label">
                Form card opacity — {config.cardOpacity ?? 100}%{' '}
                <span className="font-normal text-slate-400">(lower = more transparent)</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={config.cardOpacity ?? 100}
                onChange={(e) => patch({ cardOpacity: Number(e.target.value) })}
                className="w-full max-w-xs accent-brand-600"
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Page background is used when no media is selected below. Card opacity lets the
              background show through the login card.
            </p>
          </section>

          {/* Background media library */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Background media
              </h2>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => mediaInput.current?.click()}
              >
                <Upload className="h-4 w-4" /> Upload
              </button>
              <input
                ref={mediaInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadMedia(f);
                  e.target.value = '';
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {/* None option */}
              <button
                type="button"
                onClick={() => patch({ backgroundMediaId: null })}
                className={cn(
                  'flex h-24 items-center justify-center rounded-lg border-2 text-xs font-medium text-slate-500',
                  !config.backgroundMediaId
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
                    : 'border-slate-200 dark:border-slate-700',
                )}
              >
                None
              </button>

              {media.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'group relative h-24 overflow-hidden rounded-lg border-2',
                    config.backgroundMediaId === m.id
                      ? 'border-brand-500'
                      : 'border-slate-200 dark:border-slate-700',
                  )}
                >
                  <button
                    type="button"
                    className="h-full w-full"
                    onClick={() => patch({ backgroundMediaId: m.id })}
                    title={m.originalName}
                  >
                    {m.kind === 'VIDEO' ? (
                      <video src={mediaUrl(m.url)} className="h-full w-full object-cover" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(m.url)} alt={m.originalName} className="h-full w-full object-cover" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteMedia(m.id)}
                    className="absolute right-1 top-1 rounded-md bg-white/90 p-1 text-rose-600 opacity-0 shadow group-hover:opacity-100 dark:bg-slate-900/90"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {config.backgroundMediaId === m.id && (
                    <span className="absolute bottom-1 left-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      Background
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Image, GIF or video — up to 50 MB. Layout 1 uses the selected item behind the card;
              Layout 2 cycles through all uploaded media as a slideshow on the image panel.
            </p>
          </section>

          {/* Form options */}
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Form</h2>
            <Input
              label="Card title"
              value={config.formTitle ?? ''}
              onChange={(e) => patch({ formTitle: e.target.value })}
              placeholder="e.g. Login to your admin panel"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Input
                label="Username label"
                value={config.usernameLabel ?? ''}
                onChange={(e) => patch({ usernameLabel: e.target.value })}
                placeholder="Username"
              />
              <Input
                label="Password label"
                value={config.passwordLabel ?? ''}
                onChange={(e) => patch({ passwordLabel: e.target.value })}
                placeholder="Password"
              />
              <Input
                label="Button label"
                value={config.submitLabel ?? ''}
                onChange={(e) => patch({ submitLabel: e.target.value })}
                placeholder="Sign In"
              />
            </div>
            <div className="mt-3">
              <ColorField
                label="Sign-in button color (blank = brand)"
                value={config.buttonColor || '#2563eb'}
                onChange={(v) => patch({ buttonColor: v })}
              />
              {config.buttonColor && (
                <button
                  type="button"
                  className="mt-1 text-xs text-slate-400 hover:underline"
                  onClick={() => patch({ buttonColor: '' })}
                >
                  Reset to brand color
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3">
              <Checkbox
                label="Show “Remember me”"
                checked={!!config.showRememberMe}
                onChange={(e) => patch({ showRememberMe: e.target.checked })}
              />
              {config.showRememberMe && (
                <Input
                  wrapClassName="pl-6 max-w-xs"
                  label="Remember-me text"
                  value={config.rememberMeLabel ?? ''}
                  onChange={(e) => patch({ rememberMeLabel: e.target.value })}
                  placeholder="Remember me for 30 days"
                />
              )}
              <Checkbox
                label="Show “Forgot your password?” link"
                checked={!!config.forgotPassword?.show}
                onChange={(e) => patchForgot({ show: e.target.checked })}
              />
              {config.forgotPassword?.show && (
                <div className="grid gap-3 sm:grid-cols-2 pl-6">
                  <Input
                    label="Link text"
                    value={config.forgotPassword?.label ?? ''}
                    onChange={(e) => patchForgot({ label: e.target.value })}
                    placeholder="Forgot your password?"
                  />
                  <Input
                    label="Link URL"
                    value={config.forgotPassword?.url ?? ''}
                    onChange={(e) => patchForgot({ url: e.target.value })}
                    placeholder="https://… or mailto:…"
                  />
                </div>
              )}

              <Checkbox
                label="Show secondary button (e.g. Sign in with Google)"
                checked={!!config.secondaryButton?.show}
                onChange={(e) => patchSecondary({ show: e.target.checked })}
              />
              {config.secondaryButton?.show && (
                <div className="grid gap-3 sm:grid-cols-2 pl-6">
                  <Input
                    label="Button text"
                    value={config.secondaryButton?.label ?? ''}
                    onChange={(e) => patchSecondary({ label: e.target.value })}
                    placeholder="Sign in with Google"
                  />
                  <Input
                    label="Button URL"
                    value={config.secondaryButton?.url ?? ''}
                    onChange={(e) => patchSecondary({ url: e.target.value })}
                    placeholder="https://…"
                  />
                </div>
              )}

              <Checkbox
                label="Show “Sign up” line"
                checked={!!config.signUp?.show}
                onChange={(e) => patchSignUp({ show: e.target.checked })}
              />
              {config.signUp?.show && (
                <div className="grid gap-3 sm:grid-cols-3 pl-6">
                  <Input
                    label="Prompt"
                    value={config.signUp?.prompt ?? ''}
                    onChange={(e) => patchSignUp({ prompt: e.target.value })}
                    placeholder="Don't have an account?"
                  />
                  <Input
                    label="Link text"
                    value={config.signUp?.label ?? ''}
                    onChange={(e) => patchSignUp({ label: e.target.value })}
                    placeholder="Sign up"
                  />
                  <Input
                    label="Link URL"
                    value={config.signUp?.url ?? ''}
                    onChange={(e) => patchSignUp({ url: e.target.value })}
                    placeholder="https://…"
                  />
                </div>
              )}
            </div>
          </section>

          {/* Image panel overlay (Layout 2, rich text) */}
          <RichField
            title="Image overlay heading (Layout 2)"
            value={config.overlayHeadingHtml || textToHtml(config.overlayHeading)}
            onChange={(html) => patch({ overlayHeadingHtml: html })}
            style={config.overlayHeadingStyle}
            onAlign={alignHandler('overlayHeadingStyle', 'overlayHeadingHtml')}
            bgClassName="bg-slate-700"
            hint="Shown over the image panel. Use the toolbar to format; select text and choose size/colour, or press Enter for a new line."
          />
          <RichField
            title="Image overlay subtitle (Layout 2)"
            value={config.overlayTextHtml || textToHtml(config.overlayText)}
            onChange={(html) => patch({ overlayTextHtml: html })}
            style={config.overlayTextStyle}
            onAlign={alignHandler('overlayTextStyle', 'overlayTextHtml')}
            bgClassName="bg-slate-700"
          />
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
              Image panel “Know more” link (Layout 2)
            </h2>
            <Checkbox
              label="Show “Know more” link"
              checked={!!config.knowMore?.show}
              onChange={(e) => patchKnowMore({ show: e.target.checked })}
            />
            {config.knowMore?.show && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input
                  label="Link text"
                  value={config.knowMore?.label ?? ''}
                  onChange={(e) => patchKnowMore({ label: e.target.value })}
                  placeholder="Know more"
                />
                <Input
                  label="Link URL"
                  value={config.knowMore?.url ?? ''}
                  onChange={(e) => patchKnowMore({ url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
            )}
          </section>

          {/* Branding buttons (Layout 2) */}
          <section className="card p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Branding buttons
              </h2>
              {buttons.length < 2 && (
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1 text-xs"
                  onClick={() => setButtons([...buttons, { label: '', url: '' }])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              )}
            </div>
            <p className="mb-3 text-xs text-slate-400">
              Pill buttons shown under the card on Layout 1 (centered).
            </p>
            {buttons.length === 0 && <p className="text-sm text-slate-400">No buttons.</p>}
            <div className="space-y-3">
              {buttons.map((b, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Input
                    label="Label"
                    wrapClassName="flex-1"
                    value={b.label ?? ''}
                    onChange={(e) => updateButton(i, { label: e.target.value })}
                    placeholder="MEET PICKPLANT"
                  />
                  <Input
                    label="URL"
                    wrapClassName="flex-1"
                    value={b.url ?? ''}
                    onChange={(e) => updateButton(i, { url: e.target.value })}
                    placeholder="https://…"
                  />
                  <button
                    type="button"
                    className="mb-1 rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
                    onClick={() => setButtons(buttons.filter((_, idx) => idx !== i))}
                    title="Remove"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Copyright */}
          <StyledTextField
            label="Copyright / warning (below Sign In)"
            value={config.copyright ?? ''}
            style={config.copyrightStyle}
            onText={(v) => patch({ copyright: v })}
            onStyle={(s) => patchStyle('copyrightStyle', s)}
            hint="Use {year} for the current year."
          />
        </fieldset>

        {/* ---- Live preview ---- */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Live preview
          </p>
          <LoginPreview config={config} media={media} />
        </div>
      </div>

      {/* Always-reachable save bar — sticks to the bottom while scrolling. */}
      {!readOnly && (
        <div className="sticky bottom-0 z-30 mt-6 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/85 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
          <span className="text-xs text-slate-400">Changes aren’t saved until you click Save.</span>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            onClick={save}
            disabled={saving}
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- sub-components ---------- */

function RichField({
  title,
  value,
  onChange,
  style,
  onAlign,
  bgClassName,
  hint,
}: {
  title: string;
  value: string;
  onChange: (html: string) => void;
  style?: TextStyle;
  onAlign?: (a: NonNullable<TextStyle['align']>) => void;
  bgClassName?: string;
  hint?: string;
}) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
      <RichTextEditor
        value={value}
        onChange={onChange}
        baseStyle={resolveTextStyle(style)}
        align={style?.align}
        onAlign={onAlign}
        bgClassName={bgClassName}
        placeholder={`Enter ${title.toLowerCase()}…`}
      />
      {hint && <p className="mt-2 text-xs text-slate-400">{hint}</p>}
    </section>
  );
}

function StyledTextField({
  label,
  value,
  style,
  onText,
  onStyle,
  hint,
  multiline,
}: {
  label: string;
  value: string;
  style?: TextStyle;
  onText: (v: string) => void;
  onStyle: (s: Partial<TextStyle>) => void;
  hint?: string;
  multiline?: boolean;
}) {
  const align = style?.align ?? 'left';
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</h2>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onText(e.target.value)}
          placeholder={`Enter ${label.toLowerCase()} — press Enter for a new line`}
          rows={2}
        />
      ) : (
        <Input value={value} onChange={(e) => onText(e.target.value)} placeholder={`Enter ${label.toLowerCase()}`} />
      )}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Select
          label="Font"
          wrapClassName="w-44"
          value={style?.fontFamily ?? ''}
          onChange={(e) => onStyle({ fontFamily: e.target.value })}
          options={FONT_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
        />
        <Input
          label="Size"
          type="number"
          wrapClassName="w-20"
          min={FONT_SIZE_RANGE.min}
          max={FONT_SIZE_RANGE.max}
          value={style?.fontSize ?? ''}
          onChange={(e) => onStyle({ fontSize: e.target.value ? Number(e.target.value) : undefined })}
        />
        <ColorField
          label="Color"
          value={style?.color ?? '#000000'}
          onChange={(v) => onStyle({ color: v })}
        />
        <div className="flex gap-1">
          <ToggleBtn active={!!style?.bold} onClick={() => onStyle({ bold: !style?.bold })} title="Bold">
            <Bold className="h-4 w-4" />
          </ToggleBtn>
          <ToggleBtn active={!!style?.italic} onClick={() => onStyle({ italic: !style?.italic })} title="Italic">
            <Italic className="h-4 w-4" />
          </ToggleBtn>
        </div>
        <div className="flex gap-1">
          <ToggleBtn active={align === 'left'} onClick={() => onStyle({ align: 'left' })} title="Align left">
            <AlignLeft className="h-4 w-4" />
          </ToggleBtn>
          <ToggleBtn active={align === 'center'} onClick={() => onStyle({ align: 'center' })} title="Align center">
            <AlignCenter className="h-4 w-4" />
          </ToggleBtn>
          <ToggleBtn active={align === 'right'} onClick={() => onStyle({ align: 'right' })} title="Align right">
            <AlignRight className="h-4 w-4" />
          </ToggleBtn>
        </div>
      </div>
    </section>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-800"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-base w-24"
        />
      </div>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg border transition',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-950'
          : 'border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  );
}

function PreviewLogo({ config }: { config: LoginScreenConfig }) {
  // Scale the configured size down a bit so the small preview stays tidy.
  const size = Math.min((config.logoSize ?? 48) * 0.85, 120);
  return config.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={mediaUrl(config.logoUrl)} alt="Logo" style={{ height: size }} className="w-auto object-contain" />
  ) : (
    <div
      className="flex items-center justify-center rounded-2xl bg-brand-600 text-white"
      style={{ height: size, width: size }}
    >
      <ImageIcon style={{ height: size * 0.55, width: size * 0.55 }} />
    </div>
  );
}

function PreviewFormFields({ config }: { config: LoginScreenConfig }) {
  const btnStyle = config.buttonColor ? { backgroundColor: config.buttonColor } : undefined;
  return (
    <div className="text-left">
      <div className="mb-1 text-[11px] font-medium text-slate-600">{config.usernameLabel || 'Username'}</div>
      <div className="mb-3 h-7 rounded-md border border-slate-200 bg-white" />
      <div className="mb-1 text-[11px] font-medium text-slate-600">{config.passwordLabel || 'Password'}</div>
      <div className="mb-3 h-7 rounded-md border border-slate-200 bg-white" />
      {(config.showRememberMe || config.forgotPassword?.show) && (
        <div className="mb-3 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            {config.showRememberMe && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-slate-300" />
                {config.rememberMeLabel || 'Remember me'}
              </span>
            )}
          </span>
          {config.forgotPassword?.show && (
            <span className="font-medium text-brand-600">
              {config.forgotPassword.label || 'Forgot your password?'}
            </span>
          )}
        </div>
      )}
      <div
        className="h-8 rounded-md bg-brand-600 text-center text-xs font-semibold leading-8 text-white"
        style={btnStyle}
      >
        {config.submitLabel || 'Sign In'}
      </div>
      {config.secondaryButton?.show && (
        <div className="mt-2 flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white text-[11px] font-semibold text-slate-700">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[8px]">G</span>
          {config.secondaryButton.label || 'Sign in with Google'}
        </div>
      )}
      {config.signUp?.show && (
        <div className="mt-2 text-center text-[11px] text-slate-500">
          {config.signUp.prompt || "Don't have an account?"}{' '}
          <span className="font-medium text-slate-800 underline">{config.signUp.label || 'Sign up'}</span>
        </div>
      )}
    </div>
  );
}

function PreviewCard({ config }: { config: LoginScreenConfig }) {
  return (
    <div className="rounded-xl p-4 shadow" style={{ backgroundColor: withAlpha(config.cardColor, config.cardOpacity) }}>
      {config.formTitle && (
        <div className="mb-2 text-left" style={resolveTextStyle(config.formTitleStyle)}>
          {config.formTitle}
        </div>
      )}
      <PreviewFormFields config={config} />
    </div>
  );
}

function PreviewButtons({ config }: { config: LoginScreenConfig }) {
  const btns = (config.buttons ?? []).filter((b) => b.label);
  if (!btns.length) return null;
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      {btns.map((b, i) => (
        <span
          key={i}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700"
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

function MediaBg({ media, config }: { media?: LoginMedia; config: LoginScreenConfig }) {
  if (!media)
    return <div className="absolute inset-0" style={{ backgroundColor: config.pageColor }} />;
  return media.kind === 'VIDEO' ? (
    <video src={mediaUrl(media.url)} autoPlay muted loop className="absolute inset-0 h-full w-full object-cover" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={mediaUrl(media.url)} alt="" className="absolute inset-0 h-full w-full object-cover" />
  );
}

// Cap overlay font sizes so the small preview stays tidy.
function previewOverlayStyle(style: TextStyle | undefined, cap: number) {
  const s = resolveTextStyle(style);
  return { ...s, fontSize: `${Math.min(style?.fontSize ?? cap, cap)}px` };
}

// Render sanitized rich-text HTML if present, otherwise the plain text.
function RichOrPlain({
  html,
  text,
  style,
  className,
}: {
  html?: string;
  text?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const clean = html ? sanitizeHtml(html) : '';
  if (clean) return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: clean }} />;
  if (!text) return null;
  return (
    <div className={className} style={style}>
      {text}
    </div>
  );
}

function LoginPreview({
  config,
  media,
}: {
  config: LoginScreenConfig;
  media: LoginMedia[];
}) {
  const bg = media.find((m) => m.id === config.backgroundMediaId);
  const year = new Date().getFullYear();

  if (config.layout === 'split') {
    return (
      <div className="grid min-h-[360px] grid-cols-2 overflow-hidden rounded-xl border border-slate-200 shadow dark:border-slate-700">
        {/* left image panel (slideshow + overlay) */}
        <LoginCarousel media={media} fallbackColor={config.pageColor} className="min-h-[360px]">
          <RichOrPlain
            html={config.overlayHeadingHtml}
            text={config.overlayHeading}
            style={previewOverlayStyle(config.overlayHeadingStyle, 20)}
          />
          <RichOrPlain
            className="mt-1.5"
            html={config.overlayTextHtml}
            text={config.overlayText}
            style={previewOverlayStyle(config.overlayTextStyle, 12)}
          />
          {config.knowMore?.show && (
            <div className="mt-2 text-[11px] font-medium text-white/90">
              {config.knowMore.label || 'Know more'} ↗
            </div>
          )}
        </LoginCarousel>
        {/* right form panel */}
        <div className="flex items-center justify-center p-4" style={{ backgroundColor: config.cardColor || '#ffffff' }}>
          <div className="w-full">
            <div className="mb-3 flex flex-col items-center text-center">
              <div className="mb-2 flex justify-center">
                <PreviewLogo config={config} />
              </div>
              <RichOrPlain html={config.headingHtml} text={config.heading} style={resolveTextStyle(config.headingStyle)} />
              <RichOrPlain
                className="mt-1"
                html={config.descriptionHtml}
                text={config.description}
                style={resolveTextStyle(config.descriptionStyle)}
              />
            </div>
            <PreviewFormFields config={config} />
            {config.copyright && (
              <div className="mt-2 text-center" style={resolveTextStyle(config.copyrightStyle)}>
                {formatCopyright(config.copyright, year)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // centered
  return (
    <div
      className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-xl border border-slate-200 p-6 dark:border-slate-700"
      style={{ backgroundColor: config.pageColor }}
    >
      {bg && <MediaBg media={bg} config={config} />}
      <div className="relative w-full max-w-[260px] text-center">
        <div className="mb-3 flex justify-center">
          <PreviewLogo config={config} />
        </div>
        <RichOrPlain html={config.headingHtml} text={config.heading} style={resolveTextStyle(config.headingStyle)} />
        <RichOrPlain
          className="mt-1"
          html={config.descriptionHtml}
          text={config.description}
          style={resolveTextStyle(config.descriptionStyle)}
        />
        <div className="mt-4">
          <PreviewCard config={config} />
        </div>
        <PreviewButtons config={config} />
        {config.copyright && (
          <div className="mt-3" style={resolveTextStyle(config.copyrightStyle)}>
            {formatCopyright(config.copyright, year)}
          </div>
        )}
      </div>
    </div>
  );
}
