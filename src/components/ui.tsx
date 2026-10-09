import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useRouter } from '../lib/router';
import { useI18n } from '../lib/i18n';
import { AVATARS } from '../lib/units';
import { FRAMES, SHOP_AVATARS } from '../lib/cosmetics';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  title, back, right, children, footer, nav = false, wide = false, backdrop,
}: {
  title?: ReactNode; back?: string | true; right?: ReactNode; children: ReactNode; footer?: ReactNode; nav?: boolean; wide?: boolean;
  /** CSS background-image, e.g. a room theme */
  backdrop?: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col" style={backdrop ? { backgroundImage: backdrop } : undefined}>
      {(title || back || right) && (
        <header className="safe-top sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
          <div className={cx('mx-auto flex h-14 items-center gap-2 px-2', wide ? 'max-w-3xl' : 'max-w-md')}>
            {back ? (
              <button
                aria-label={t('common.back')}
                onClick={() => router.back(typeof back === 'string' ? back : '/')}
                className="grid h-11 w-11 place-items-center rounded-full text-xl hover:bg-surface-2"
              >
                ←
              </button>
            ) : (
              <span className="w-2" />
            )}
            <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
            {right}
          </div>
        </header>
      )}
      <main className={cx('mx-auto w-full flex-1 px-4 pt-4', wide ? 'max-w-3xl' : 'max-w-md', nav ? 'pb-24' : 'pb-6')}>{children}</main>
      {footer && (
        <div className="safe-bottom sticky bottom-0 z-20 border-t border-line bg-bg/95 backdrop-blur">
          <div className={cx('mx-auto px-4 pt-3', wide ? 'max-w-3xl' : 'max-w-md')}>{footer}</div>
        </div>
      )}
      {nav && <BottomNav />}
    </div>
  );
}

function BottomNav() {
  const { path, navigate } = useRouter();
  const { t } = useI18n();
  const items = [
    { to: '/', icon: '🏠', label: t('nav.home') },
    { to: '/solo', icon: '🎯', label: t('nav.play') },
    { to: '/friends', icon: '👥', label: t('nav.friends') },
    { to: '/leaderboard', icon: '🏆', label: t('nav.ranks') },
    { to: '/profile', icon: '🙂', label: t('nav.profile') },
  ];
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-5">
        {items.map((it) => {
          const active = it.to === '/' ? path === '/' : path.startsWith(it.to);
          return (
            <button
              key={it.to}
              onClick={() => navigate(it.to)}
              className={cx('flex h-14 flex-col items-center justify-center text-xs', active ? 'font-bold text-brand' : 'text-muted')}
              aria-current={active ? 'page' : undefined}
            >
              <span className="text-xl leading-none" aria-hidden>
                {it.icon}
              </span>
              <span className="mt-0.5 truncate">{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger' | 'accent';

export function Button({
  variant = 'primary', block, loading, className, children, size = 'md', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; loading?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-brand text-brand-ink shadow-card hover:bg-brand-2',
    secondary: 'bg-surface text-ink border border-line shadow-card hover:bg-surface-2',
    ghost: 'bg-transparent text-ink hover:bg-surface-2',
    gold: 'bg-gold text-gold-ink shadow-card hover:brightness-105',
    danger: 'bg-bad text-white hover:brightness-110',
    accent: 'bg-accent text-white shadow-card hover:brightness-110',
  };
  const sizes = { sm: 'min-h-10 px-3 text-sm', md: 'min-h-12 px-4', lg: 'min-h-14 px-5 text-lg' };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        styles[variant], sizes[size], block && 'w-full', className,
      )}
    >
      {loading ? <Spinner small /> : children}
    </button>
  );
}

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('block w-full rounded-3xl border border-line bg-surface p-4 text-left shadow-card', onClick && 'transition active:scale-[0.99]', className)}>
      {children}
    </Tag>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={cx('inline-block animate-spin rounded-full border-current border-r-transparent', small ? 'h-5 w-5 border-2' : 'h-8 w-8 border-[3px]')}
    />
  );
}

export function Loading() {
  return (
    <div className="grid min-h-[50dvh] place-items-center text-brand">
      <Spinner />
    </div>
  );
}

export function Segmented<T extends string | number>({
  options, value, onChange, small,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean; hint?: ReactNode }[]; value: T; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex flex-col items-center justify-center rounded-2xl border px-3 font-semibold transition disabled:opacity-40',
            small ? 'min-h-10 text-sm' : 'min-h-12',
            o.value === value ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-ink',
          )}
        >
          <span>{o.label}</span>
          {o.hint && <span className="text-[11px] font-normal opacity-80">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
      <span>{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-ok' : 'bg-line')}
      >
        <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-6' : 'left-1')} />
      </button>
    </label>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full min-h-12 rounded-2xl border border-line bg-surface px-4 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none';

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function Coin({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="inline-block shrink-0">
      <circle cx="12" cy="12" r="11" fill="#F2B705" />
      <circle cx="12" cy="12" r="8" fill="none" stroke="#C98F00" strokeWidth="1.6" />
      <path d="M13 6 9 13h3l-1 5 4-7h-3z" fill="#8a5a00" />
    </svg>
  );
}

export function CoinChip({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full bg-gold/20 px-2.5 py-1 font-bold tabular-nums text-ink', className)}>
      <Coin /> {value.toLocaleString('en-IN')}
    </span>
  );
}

export function Avatar({
  avatar, size = 44, ring, dim, label, frame,
}: { avatar: string; size?: number; ring?: string; dim?: boolean; label?: string; frame?: string | null }) {
  const a = AVATARS[avatar] ?? SHOP_AVATARS[avatar] ?? AVATARS.a1;
  const face = (
    <span
      role="img"
      aria-label={label ?? 'avatar'}
      className={cx('inline-grid shrink-0 place-items-center rounded-full', dim && 'opacity-40 grayscale')}
      style={{ width: size, height: size, background: a.bg, fontSize: size * 0.55, boxShadow: ring ? `0 0 0 3px ${ring}` : undefined }}
    >
      {a.emoji}
    </span>
  );
  const f = frame ? FRAMES[frame] : undefined;
  if (!f) return face;
  const pad = Math.max(2, Math.round(size * 0.08));
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full"
      style={f.dashed ? { padding: pad - 1, border: `3px dashed ${f.ring}` } : { padding: pad, background: f.ring }}
    >
      {face}
    </span>
  );
}

export function ProgressBar({ pct, color = 'bg-brand' }: { pct: number; color?: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
      <div className={cx('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Empty({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-muted">
      <span className="text-4xl" aria-hidden>
        {icon}
      </span>
      <div className="max-w-xs">{children}</div>
    </div>
  );
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-bad/30 bg-bad-bg p-4 text-sm">
      <p>{text}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button aria-label="close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="safe-bottom anim-rise relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-4 shadow-card">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" />
        {title && <h2 className="mb-3 text-lg font-bold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'bad' | 'coin';
}

const ToastContext = createContext<(text: string, kind?: ToastItem['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((text: string, kind: ToastItem['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-60 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((x) => (
          <div
            key={x.id}
            className={cx(
              'anim-pop max-w-sm rounded-2xl px-4 py-3 text-sm font-semibold shadow-card',
              x.kind === 'bad' && 'bg-bad text-white',
              x.kind === 'ok' && 'bg-ok text-white',
              x.kind === 'coin' && 'bg-gold text-gold-ink',
              x.kind === 'info' && 'bg-ink text-bg',
            )}
          >
            {x.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
