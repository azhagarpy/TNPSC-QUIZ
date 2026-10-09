import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from '../lib/router';
import { useI18n } from '../lib/i18n';
import { fx } from '../lib/feedback';
import { AVATARS } from '../lib/units';
import { FRAMES, SHOP_AVATARS } from '../lib/cosmetics';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  title, back, right, children, footer, nav = false, wide = false, backdrop, hud,
}: {
  title?: ReactNode; back?: string | true; right?: ReactNode; children: ReactNode; footer?: ReactNode; nav?: boolean; wide?: boolean;
  /** CSS background-image, e.g. a room theme */
  backdrop?: string;
  /** Custom top bar (replaces the title row), e.g. the player HUD on Home */
  hud?: ReactNode;
}) {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col" style={backdrop ? { backgroundImage: backdrop } : undefined}>
      {hud && (
        <header className="hud-bar safe-top sticky top-0 z-20">
          <div className={cx('mx-auto px-3 py-2', wide ? 'max-w-3xl' : 'max-w-md')}>{hud}</div>
        </header>
      )}
      {!hud && (title || back || right) && (
        <header className="hud-bar safe-top sticky top-0 z-20">
          <div className={cx('mx-auto flex h-16 items-center gap-3 px-3', wide ? 'max-w-3xl' : 'max-w-md')}>
            {back ? (
              <button aria-label={t('common.back')} onClick={() => router.back(typeof back === 'string' ? back : '/')} className="btn-round">
                <BackIcon />
              </button>
            ) : (
              <span className="w-1" />
            )}
            <h1 className="text-outline-sm min-w-0 flex-1 truncate text-xl font-extrabold">{title}</h1>
            {right}
          </div>
        </header>
      )}
      <main className={cx('mx-auto w-full flex-1 px-4 pt-4', wide ? 'max-w-3xl' : 'max-w-md', nav ? 'pb-32' : 'pb-6')}>{children}</main>
      {footer && (
        <div className="safe-bottom sticky bottom-0 z-20 bg-linear-to-b from-transparent to-[var(--hud)] to-40%">
          <div className={cx('mx-auto px-4 pt-6', wide ? 'max-w-3xl' : 'max-w-md')}>{footer}</div>
        </div>
      )}
      {nav && <BottomNav />}
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5 8 12l7 7" />
    </svg>
  );
}

// Game tab bar: Play is the big raised button in the middle.
function BottomNav() {
  const { path, navigate } = useRouter();
  const { t } = useI18n();
  const items = [
    { to: '/', icon: '🏠', label: t('nav.home') },
    { to: '/leaderboard', icon: '🏆', label: t('nav.ranks') },
    { to: '/solo', icon: '🎯', label: t('nav.play'), center: true },
    { to: '/friends', icon: '👥', label: t('nav.friends') },
    { to: '/profile', icon: '🙂', label: t('nav.profile') },
  ];
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-2 border-white/10 bg-[var(--hud)] shadow-[0_-6px_18px_rgb(0_0_0/0.25)]">
      <div className="mx-auto grid max-w-md grid-cols-5 items-end px-1">
        {items.map((it) => {
          const active = it.to === '/' ? path === '/' : path.startsWith(it.to);
          return (
            <button
              key={it.to}
              onClick={() => {
                fx.click();
                navigate(it.to);
              }}
              className="flex min-w-0 flex-col items-center justify-end pt-1.5"
              aria-current={active ? 'page' : undefined}
            >
              {it.center ? (
                <span className={cx('btn3d btn-gold -mt-7 grid h-16 w-16 place-items-center rounded-full text-3xl', active && 'outline-4 outline-offset-2 outline-white/60')} aria-hidden>
                  {it.icon}
                </span>
              ) : (
                <span
                  className={cx(
                    'grid h-9 w-12 place-items-center rounded-xl text-2xl leading-none transition',
                    active ? 'scale-105 bg-pink shadow-[0_3px_0_var(--pink-lip)]' : 'opacity-70 grayscale-[35%]',
                  )}
                  aria-hidden
                >
                  {it.icon}
                </span>
              )}
              <span className={cx('mt-1 w-full truncate px-0.5 text-center font-display text-xs font-bold', active ? 'text-white' : 'text-muted')}>{it.label}</span>
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

type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger' | 'accent' | 'success' | 'violet';

const variantClass: Record<Variant, string> = {
  primary: 'btn3d',
  secondary: 'btn3d btn-cream',
  ghost: 'btn-ghost',
  gold: 'btn3d btn-gold',
  danger: 'btn3d btn-red',
  accent: 'btn3d btn-blue',
  success: 'btn3d btn-green',
  violet: 'btn3d btn-violet',
};

export function Button({
  variant = 'primary', block, loading, className, children, size = 'md', onPointerDown, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; loading?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'min-h-11 px-3.5 text-sm', md: 'min-h-12 px-4 text-base', lg: 'min-h-14 px-5 text-lg' };
  return (
    <button
      {...rest}
      onPointerDown={(e) => {
        fx.click();
        onPointerDown?.(e);
      }}
      disabled={rest.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 leading-tight', variantClass[variant], sizes[size], block && 'w-full', className)}
    >
      {loading ? <Spinner small /> : children}
    </button>
  );
}

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cx('panel block w-full p-4 text-left', onClick && 'transition-transform active:translate-y-1', className)}
    >
      {children}
    </Tag>
  );
}

/** Notched title banner. */
export function Ribbon({ children, color = 'pink', className }: { children: ReactNode; color?: 'pink' | 'gold' | 'blue' | 'violet' | 'green'; className?: string }) {
  const style = {
    '--rib': `var(--${color})`,
    '--rib-lip': `var(--${color}-lip)`,
    '--rib-ink': color === 'gold' ? 'var(--gold-ink)' : '#fff',
  } as CSSProperties;
  return (
    <span className={cx('ribbon-wrap', className)} style={style}>
      <span className={cx('ribbon block text-xl', color === 'gold' && '[text-shadow:0_1px_0_rgb(255_255_255/0.5)]')}>{children}</span>
    </span>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={cx('inline-block animate-spin rounded-full border-current border-r-transparent', small ? 'h-5 w-5 border-[3px]' : 'h-8 w-8 border-4')}
    />
  );
}

export function Loading() {
  return (
    <div className="grid min-h-[50dvh] place-items-center">
      <span role="status" aria-label="loading" className="anim-coin-spin inline-block drop-shadow-[0_6px_0_rgb(0_0_0/0.25)]">
        <Coin size={56} />
      </span>
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
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => {
              fx.click();
              onChange(o.value);
            }}
            className={cx(
              'flex min-h-11 flex-col items-center justify-center rounded-2xl px-3.5 font-display font-bold leading-tight disabled:opacity-40',
              small ? 'text-sm' : 'min-h-12 text-base',
              on ? 'btn3d !rounded-2xl' : 'border-2 border-line bg-chip text-ink transition-transform active:translate-y-0.5',
            )}
          >
            <span>{o.label}</span>
            {o.hint && <span className="text-xs font-normal opacity-85">{o.hint}</span>}
          </button>
        );
      })}
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
        onClick={() => {
          fx.click();
          onChange(!checked);
        }}
        className={cx(
          'relative h-8 w-14 shrink-0 rounded-full border-2 transition-colors',
          checked ? 'border-[var(--green-lip)] bg-green' : 'border-line bg-line',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 grid h-6 w-6 place-items-center rounded-full bg-white text-xs font-black text-[var(--green-lip)] shadow-[0_2px_0_rgb(0_0_0/0.25)] transition-[left]',
            checked ? 'left-[26px]' : 'left-0.5',
          )}
          aria-hidden
        >
          {checked ? '✓' : ''}
        </span>
      </button>
    </label>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-display text-base font-bold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass = 'field-input';

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function Coin({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="inline-block shrink-0">
      <circle cx="12" cy="12.8" r="11" fill="#B37400" />
      <circle cx="12" cy="11.6" r="11" fill="#FFC629" />
      <circle cx="12" cy="11.6" r="8" fill="#FFD95C" stroke="#D99200" strokeWidth="1.6" />
      <path d="M13 5.6 9 12.6h3l-1 5 4-7h-3z" fill="#9A5F00" />
      <path d="M5.5 8.5a7.5 7.5 0 0 1 5-4" stroke="#fff" strokeOpacity=".7" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** HUD counter: coin icon and balance. */
export function CoinChip({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx('hud-pill', className)}>
      <Coin size={24} /> {value.toLocaleString('en-IN')}
    </span>
  );
}

export function Avatar({
  avatar, size = 44, ring, dim, label, frame,
}: { avatar: string; size?: number; ring?: string; dim?: boolean; label?: string; frame?: string | null }) {
  const a = AVATARS[avatar] ?? SHOP_AVATARS[avatar] ?? AVATARS.a1;
  const depth = `inset 0 -${Math.max(2, Math.round(size * 0.07))}px 0 rgb(0 0 0 / 0.16)`;
  const face = (
    <span
      role="img"
      aria-label={label ?? 'avatar'}
      className={cx('inline-grid shrink-0 place-items-center rounded-full', dim && 'opacity-40 grayscale')}
      style={{ width: size, height: size, background: a.bg, fontSize: size * 0.55, boxShadow: ring ? `0 0 0 3px ${ring}, ${depth}` : depth }}
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

/** Round level badge that sits on the corner of an avatar. */
export function LevelBadge({ level, className }: { level: number; className?: string }) {
  return (
    <span
      className={cx(
        'grid h-7 min-w-7 place-items-center rounded-full border-2 border-[var(--blue-lip)] bg-blue px-1 font-display text-sm font-extrabold leading-none text-white [text-shadow:0_1px_0_rgb(0_0_0/0.3)]',
        className,
      )}
    >
      {level}
    </span>
  );
}

// Medal colours for ranks 1–3: face, rim, number.
const MEDALS: Record<number, [string, string, string]> = {
  1: ['#FFC629', '#C78300', '#4A2C00'],
  2: ['#DCE1EC', '#9AA1B6', '#2B2F3C'],
  3: ['#E8A266', '#A3622E', '#3D1F08'],
};

/** Rank number; the top three sit on a medal (the number stays, so it is not colour alone). */
export function RankBadge({ rank }: { rank: number | null }) {
  const m = rank ? MEDALS[rank] : undefined;
  if (!m) return <span className="w-8 shrink-0 text-center font-display text-lg font-extrabold tabular-nums">{rank ?? '–'}</span>;
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 font-display text-base font-extrabold"
      style={{ background: m[0], borderColor: m[1], color: m[2], boxShadow: `0 2px 0 ${m[1]}` }}
    >
      {rank}
    </span>
  );
}

export function ProgressBar({ pct, color = 'bg-brand' }: { pct: number; color?: string }) {
  return (
    <div className="bar">
      <div className={cx('bar-fill', color)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Empty({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center text-muted">
      <span className="glass anim-bob grid h-20 w-20 place-items-center !rounded-full text-4xl" aria-hidden>
        {icon}
      </span>
      <div className="max-w-xs font-semibold">{children}</div>
    </div>
  );
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="panel !border-[var(--red)] p-4 text-sm">
      <p className="flex gap-2">
        <span aria-hidden>⚠️</span>
        <span>{text}</span>
      </p>
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
      <button aria-label="close" className="absolute inset-0 bg-[rgb(8_2_30/0.7)]" onClick={onClose} />
      <div className="panel safe-bottom anim-rise relative max-h-[85dvh] w-full max-w-md overflow-y-auto !rounded-b-none !rounded-t-[28px] px-4 pt-3">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line" />
        {title && <h2 className="mb-3 text-center text-xl font-extrabold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts: game notification banners, at most three at once.
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'bad' | 'coin';
}

const ToastContext = createContext<(text: string, kind?: ToastItem['kind']) => void>(() => {});

const toastStyle: Record<ToastItem['kind'], { cls: string; icon: ReactNode }> = {
  bad: { cls: 'btn-red', icon: '⚠️' },
  ok: { cls: 'btn-green', icon: '✅' },
  coin: { cls: 'btn-gold', icon: <Coin size={22} /> },
  info: { cls: 'btn-violet', icon: 'ℹ️' },
};

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
      <div className="safe-top pointer-events-none fixed inset-x-0 top-3 z-60 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((x) => (
          <div key={x.id} className={cx('btn3d anim-drop flex max-w-sm items-center gap-2 px-4 py-2.5 text-base', toastStyle[x.kind].cls)}>
            <span className="shrink-0 text-lg leading-none" aria-hidden>
              {toastStyle[x.kind].icon}
            </span>
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
