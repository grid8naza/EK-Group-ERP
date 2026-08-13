'use client';

import { useEffect, useState } from 'react';
import { Lock, User, Eye, EyeOff, ExternalLink, Loader2 } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { LoginCarousel } from '@/components/LoginCarousel';
import { ApiError, API_URL } from '@/lib/api';
import {
  type LoginScreenConfig,
  type LoginMedia,
  withDefaults,
  resolveTextStyle,
  withAlpha,
  mediaUrl,
  sanitizeHtml,
  usedGoogleFonts,
  googleFontsHref,
  formatCopyright,
} from '@/lib/login-screen';
import type { CSSProperties } from 'react';

/** Render sanitized rich-text HTML when present, else the plain styled text. */
function RichOrPlain({
  html,
  text,
  style,
  className,
}: {
  html?: string;
  text?: string;
  style?: CSSProperties;
  className?: string;
}) {
  const clean = html ? sanitizeHtml(html) : '';
  if (clean)
    return (
      <div
        className={className}
        style={style}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  if (!text) return null;
  return (
    <div className={className} style={style}>
      {text}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 5.1 29.6 3 24 3 16 3 9.1 7.6 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.9 26.7 37 24 37c-5.3 0-9.7-3.6-11.3-8.4l-6.5 5C9.1 40.4 16 45 24 45z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.4 36.3 45 30.7 45 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [cfg, setCfg] = useState<LoginScreenConfig>(() => withDefaults(null));
  const [media, setMedia] = useState<LoginMedia[]>([]);
  const [logoBroken, setLogoBroken] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/login-screen/public`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          config: LoginScreenConfig | null;
          media: LoginMedia[];
        };
        if (!active) return;
        setCfg(withDefaults(data.config));
        setMedia(data.media ?? []);
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const href = googleFontsHref(usedGoogleFonts(cfg));
    if (!href || document.querySelector(`link[data-login-font]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-login-font', '1');
    document.head.appendChild(link);
  }, [cfg]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401)
        setError('Invalid username or password.');
      else if (err instanceof ApiError) setError(err.message);
      else setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  const year = new Date().getFullYear();
  const split = cfg.layout === 'split';

  const logoSize = cfg.logoSize || 48;
  // Falls back to the committed /brand-logo.png so a logo always shows, even on
  // a fresh git pull where the uploaded file isn't present.
  const renderLogo = () => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={
        !logoBroken && cfg.logoUrl ? mediaUrl(cfg.logoUrl) : '/brand-logo.png'
      }
      alt="Logo"
      onError={() => setLogoBroken(true)}
      style={{ height: logoSize }}
      className="w-auto object-contain"
    />
  );

  // The form fields/buttons/links — shared by both layouts.
  const formInner = (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      <div>
        <label className="label">{cfg.usernameLabel || 'Username'}</label>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input-base pl-9"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={`Enter your ${(cfg.usernameLabel || 'username').toLowerCase()}`}
            autoComplete="username"
            required
          />
        </div>
      </div>

      <div>
        <label className="label">{cfg.passwordLabel || 'Password'}</label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input-base pl-9 pr-10"
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`Enter your ${(cfg.passwordLabel || 'password').toLowerCase()}`}
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            tabIndex={-1}
          >
            {showPw ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {(cfg.showRememberMe || cfg.forgotPassword?.show) && (
        <div className="flex items-center justify-between gap-2">
          {cfg.showRememberMe ? (
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
              />
              {cfg.rememberMeLabel || 'Remember me'}
            </label>
          ) : (
            <span />
          )}
          {cfg.forgotPassword?.show && (
            <a
              href={cfg.forgotPassword.url || '#'}
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              {cfg.forgotPassword.label || 'Forgot your password?'}
            </a>
          )}
        </div>
      )}

      <button
        type="submit"
        className="btn-primary w-full"
        style={
          cfg.buttonColor ? { backgroundColor: cfg.buttonColor } : undefined
        }
        disabled={loading}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {cfg.submitLabel || 'Sign In'}
      </button>

      {cfg.secondaryButton?.show && (
        <a
          href={cfg.secondaryButton.url || '#'}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <GoogleIcon />
          {cfg.secondaryButton.label || 'Sign in with Google'}
        </a>
      )}

      {cfg.signUp?.show && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          {cfg.signUp.prompt || "Don't have an account?"}{' '}
          <a
            href={cfg.signUp.url || '#'}
            className="font-medium text-slate-800 underline dark:text-slate-100"
          >
            {cfg.signUp.label || 'Sign up'}
          </a>
        </p>
      )}
    </form>
  );

  /* ---------------- Layout 2: split (image left, form right) ---------------- */
  if (split) {
    return (
      <div className="flex min-h-screen">
        {/* LEFT: full-height image panel with overlay + slideshow */}
        <LoginCarousel
          media={media}
          fallbackColor={cfg.pageColor}
          className="hidden md:block md:w-1/2 lg:w-[55%]"
        >
          <RichOrPlain
            html={cfg.overlayHeadingHtml}
            text={cfg.overlayHeading}
            style={resolveTextStyle(cfg.overlayHeadingStyle)}
          />
          <RichOrPlain
            className="mt-3"
            html={cfg.overlayTextHtml}
            text={cfg.overlayText}
            style={resolveTextStyle(cfg.overlayTextStyle)}
          />
          {cfg.knowMore?.show && (
            <a
              href={cfg.knowMore.url || '#'}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-white/90 hover:text-white"
            >
              {cfg.knowMore.label || 'Know more'}
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </LoginCarousel>

        {/* RIGHT: form panel */}
        <div
          className="flex w-full items-center justify-center p-6 sm:p-10 md:w-1/2 lg:w-[45%]"
          style={{ backgroundColor: cfg.cardColor || '#ffffff' }}
        >
          <div className="w-full max-w-sm">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-3 flex justify-center">{renderLogo()}</div>
              <RichOrPlain
                html={cfg.headingHtml}
                text={cfg.heading}
                style={resolveTextStyle(cfg.headingStyle)}
              />
              <RichOrPlain
                className="mt-1"
                html={cfg.descriptionHtml}
                text={cfg.description}
                style={resolveTextStyle(cfg.descriptionStyle)}
              />
            </div>
            {formInner}
            {cfg.copyright && (
              <p
                className="mt-6 text-center"
                style={resolveTextStyle(cfg.copyrightStyle)}
              >
                {formatCopyright(cfg.copyright, year)}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Layout 1: centered ---------------- */
  const bg = media.find((m) => m.id === cfg.backgroundMediaId);
  const ctaButtons = (cfg.buttons ?? []).filter((b) => b.label);
  return (
    <div
      className="relative flex min-h-screen items-center justify-center p-4"
      style={{ backgroundColor: cfg.pageColor }}
    >
      {bg &&
        (bg.kind === 'VIDEO' ? (
          <video
            src={mediaUrl(bg.url)}
            autoPlay
            muted
            loop
            playsInline
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(bg.url)}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        ))}

      {!bg && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-500/10 blur-3xl" />
          <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-brand-600/10 blur-3xl" />
        </div>
      )}

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex items-center justify-center">
            {renderLogo()}
          </div>
          <RichOrPlain
            html={cfg.headingHtml}
            text={cfg.heading}
            style={resolveTextStyle(cfg.headingStyle)}
          />
          <RichOrPlain
            className="mt-1"
            html={cfg.descriptionHtml}
            text={cfg.description}
            style={resolveTextStyle(cfg.descriptionStyle)}
          />
        </div>

        <div
          className="card p-6"
          style={{ backgroundColor: withAlpha(cfg.cardColor, cfg.cardOpacity) }}
        >
          {cfg.formTitle && (
            <div className="mb-3" style={resolveTextStyle(cfg.formTitleStyle)}>
              {cfg.formTitle}
            </div>
          )}
          {formInner}
        </div>

        {ctaButtons.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {ctaButtons.map((b, i) => (
              <a
                key={i}
                href={b.url || '#'}
                className="rounded-full border border-slate-200 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {b.label}
              </a>
            ))}
          </div>
        )}

        {cfg.copyright && (
          <p
            className="mt-6 text-center"
            style={resolveTextStyle(cfg.copyrightStyle)}
          >
            {formatCopyright(cfg.copyright, year)}
          </p>
        )}
      </div>
    </div>
  );
}
