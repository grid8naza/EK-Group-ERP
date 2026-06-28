'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { type LoginMedia, mediaUrl } from '@/lib/login-screen';

/**
 * Full-bleed media panel for the login split layout. Cycles through all uploaded
 * media (image/GIF/video) on a timer with clickable dots; a single item shows
 * static. A dark bottom gradient keeps overlay text legible. `children` render
 * over the media (bottom-anchored overlay text / links).
 */
export function LoginCarousel({
  media,
  fallbackColor,
  className,
  showDots = true,
  intervalMs = 5000,
  children,
}: {
  media: LoginMedia[];
  fallbackColor?: string;
  className?: string;
  showDots?: boolean;
  intervalMs?: number;
  children?: React.ReactNode;
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (media.length <= 1) return;
    const t = setInterval(() => setI((x) => (x + 1) % media.length), intervalMs);
    return () => clearInterval(t);
  }, [media.length, intervalMs]);

  const current = media.length ? media[i % media.length] : undefined;

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {current ? (
        current.kind === 'VIDEO' ? (
          <video
            key={current.id}
            src={mediaUrl(current.url)}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.id}
            src={mediaUrl(current.url)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )
      ) : (
        <div className="absolute inset-0" style={{ backgroundColor: fallbackColor }} />
      )}

      {current && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
      )}

      {children && (
        <div className="absolute inset-0 flex flex-col justify-end p-8 sm:p-10">{children}</div>
      )}

      {showDots && media.length > 1 && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2">
          {media.map((m, idx) => (
            <button
              key={m.id}
              type="button"
              aria-label={`Slide ${idx + 1}`}
              onClick={() => setI(idx)}
              className={cn(
                'h-2 w-2 rounded-full transition',
                idx === i % media.length ? 'bg-white' : 'bg-white/50 hover:bg-white/80',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
