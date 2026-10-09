import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { isDemo } from '../lib/supabase';
import { track } from '../lib/telemetry';
import { Avatar, Button, ErrorBox, Screen } from '../components/ui';

const BOT_OFFER_S = 30;

// Quick Match: random online opponent near your level, fixed 50-coin entry.
// After 30 s with nobody around, offer the practice bot (no stakes).
export default function QuickMatch() {
  const { t, errorText } = useI18n();
  const { profile } = useSession();
  const { navigate } = useRouter();
  const [waited, setWaited] = useState(0);
  const [searching, setSearching] = useState(0);
  const [error, setError] = useState('');
  const matched = useRef(false);
  const started = useRef(Date.now());

  useEffect(() => {
    if (isDemo) {
      navigate('/bot', { replace: true });
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api.quickMatch();
        if (!alive) return;
        if (r.status === 'matched' && r.match_id) {
          matched.current = true;
          track('quick_match', { result: 'matched', waited_s: Math.round((Date.now() - started.current) / 1000) });
          navigate(`/m/${r.match_id}`, { replace: true });
          return;
        }
        setSearching(r.searching ?? 0);
        timer = setTimeout(tick, 2000);
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    };
    void tick();
    const clock = setInterval(() => setWaited(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(clock);
      if (!matched.current) {
        // A match made in the last instant shows up on Home as "rejoin".
        void api.quickMatchCancel().catch(() => {});
      }
    };
  }, [navigate, errorText]);

  return (
    <Screen title={t('quick.title')} back="/">
      {error ? (
        <ErrorBox text={error} onRetry={() => navigate('/', { replace: true })} />
      ) : (
        <div className="flex flex-col items-center gap-6 pt-6 text-center">
          <div className="relative grid h-48 w-48 place-items-center">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute inset-0 rounded-full border-4 border-accent/40"
                style={{ animation: `radar 2.4s ease-out ${i * 0.8}s infinite` }}
                aria-hidden
              />
            ))}
            <Avatar avatar={profile?.avatar ?? 'a1'} frame={profile?.frame} size={88} />
          </div>
          <div>
            <p className="text-lg font-bold">{t('quick.searching')}</p>
            <p className="text-3xl font-black tabular-nums">{waited}s</p>
            <p className="text-sm text-muted">{t('quick.entry')}</p>
            {searching > 1 && <p className="text-sm text-ok">{t('quick.online', { n: searching })}</p>}
          </div>
          {waited >= BOT_OFFER_S && (
            <div className="anim-rise w-full space-y-2 rounded-3xl bg-surface p-4 shadow-card">
              <p className="text-sm">{t('quick.nobody')}</p>
              <Button
                block
                variant="accent"
                onClick={() => {
                  track('quick_match', { result: 'bot', waited_s: waited });
                  navigate('/bot', { replace: true });
                }}
              >
                🤖 {t('quick.bot')}
              </Button>
              <p className="text-xs text-muted">{t('quick.keep')}…</p>
            </div>
          )}
          <Button variant="ghost" onClick={() => navigate('/', { replace: true })}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </Screen>
  );
}
