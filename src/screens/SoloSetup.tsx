import { useEffect, useState } from 'react';
import { fx } from '../lib/feedback';
import { useI18n } from '../lib/i18n';
import { downloadPack, loadPack, unusedQuestions, type StoredPack } from '../lib/offline';
import { isStandalone } from '../lib/platform';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { isDemo } from '../lib/supabase';
import { UNITS, unitIcon } from '../lib/units';
import { Button, Card, Screen, Segmented, cx, useToast } from '../components/ui';

export interface PlayConfig {
  mode: 'practice' | 'revision' | 'offline' | 'demo';
  subject?: string | null;
  level?: string | null;
  subtopic?: string | null;
}

/** A pickable subject: a cream tile that turns gold with a check badge when chosen. */
function SubjectTile({ icon, label, on, wide, onClick }: { icon: string; label: string; on: boolean; wide?: boolean; onClick: () => void }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      onClick={() => {
        fx.click();
        onClick();
      }}
      className={cx(
        'btn3d relative flex min-h-16 gap-2.5 px-3 py-2.5 text-left text-sm leading-snug wrap-break-word',
        on ? 'btn-gold' : 'btn-cream',
        wide ? 'col-span-2 items-center text-base' : 'flex-col items-start',
      )}
    >
      <span
        className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl font-display text-xl font-extrabold shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)]', on ? 'bg-white/45' : 'bg-chip')}
        aria-hidden
      >
        {icon}
      </span>
      <span className="w-full min-w-0 flex-1">{label}</span>
      {on && (
        <span className="anim-pop absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-green text-sm text-white" aria-hidden>
          ✓
        </span>
      )}
    </button>
  );
}

// Screen 4: subject/unit picker, mixed mode, difficulty.
export default function SoloSetup() {
  const { t, lang, errorText } = useI18n();
  const { navigate } = useRouter();
  const { summary, userId, offline } = useSession();
  const toast = useToast();
  const [subject, setSubject] = useState<string>('mixed');
  const [level, setLevel] = useState<'auto' | 'easy' | 'medium' | 'hard'>('auto');
  const [pack, setPack] = useState<StoredPack | null>(null);
  const [downloading, setDownloading] = useState(false);
  const isOffline = offline || !navigator.onLine;

  useEffect(() => {
    if (!userId || isDemo) return;
    void loadPack(userId).then(async (p) => {
      setPack(p);
      // Installed apps keep a pack ready automatically (plan: offline solo practice).
      if (!p && isStandalone() && navigator.onLine) {
        try {
          setPack(await downloadPack(userId));
        } catch {
          /* try again next time */
        }
      }
    });
  }, [userId]);

  const play = (cfg: PlayConfig) => navigate('/play', { state: cfg });
  const left = pack ? unusedQuestions(pack).length : 0;

  return (
    <Screen title={t('solo.title')} back="/" nav>
      <div className="space-y-5">
        {!isOffline && (
          <>
            <section>
              <h2 className="text-outline-sm mb-3 text-xl font-extrabold">📚 {t('solo.subject')}</h2>
              <div className="grid grid-cols-2 gap-3" role="radiogroup">
                <SubjectTile wide icon="🎲" label={t('solo.mixed')} on={subject === 'mixed'} onClick={() => setSubject('mixed')} />
                {UNITS.map((u) => (
                  <SubjectTile key={u.key} icon={unitIcon(u.key)} label={u[lang]} on={subject === u.key} onClick={() => setSubject(u.key)} />
                ))}
              </div>
            </section>
            <section>
              <h2 className="text-outline-sm mb-3 text-xl font-extrabold">⚔️ {t('solo.level')}</h2>
              <Segmented
                value={level}
                onChange={setLevel}
                options={[
                  { value: 'auto', label: t('solo.auto') },
                  { value: 'easy', label: t('solo.easy') },
                  { value: 'medium', label: t('solo.medium') },
                  { value: 'hard', label: t('solo.hard') },
                ]}
              />
            </section>
            <div>
              <Button
                block
                size="lg"
                variant="gold"
                className="shine !min-h-16 !text-xl"
                onClick={() => play({ mode: isDemo ? 'demo' : 'practice', subject: subject === 'mixed' ? null : subject, level: level === 'auto' ? null : level })}
              >
                ▶ {t('solo.start')}
              </Button>
              <p className="glass mt-3 px-3 py-2 text-center text-xs font-semibold text-muted">⏱ {t('solo.rules')}</p>
            </div>

            {!isDemo && (
              <Card>
                <h2 className="text-lg font-extrabold">🔁 {t('solo.revisionStart')}</h2>
                <p className="mb-3 text-sm text-muted">{t('solo.revisionBody')}</p>
                <Button variant="accent" size="sm" onClick={() => play({ mode: 'revision' })}>
                  {t('home.revisionDue', { n: summary?.revision_due ?? 0 })} ›
                </Button>
              </Card>
            )}
          </>
        )}

        {!isDemo && (
          <Card className={cx(isOffline && '!border-[var(--blue)]')}>
            <h2 className="text-lg font-extrabold">📴 {t('solo.offline')}</h2>
            <p className="mb-3 text-sm text-muted">{t('solo.offlineBody')}</p>
            {pack && <p className="mb-2 text-sm font-semibold">{t('solo.offlineReady', { n: left })}</p>}
            <div className="flex flex-wrap gap-2">
              {pack && left > 0 && (
                <Button size="sm" variant="accent" onClick={() => play({ mode: 'offline' })}>
                  {t('solo.offlineStart')}
                </Button>
              )}
              {!isOffline && (!pack || left < 10) && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={downloading}
                  onClick={async () => {
                    setDownloading(true);
                    try {
                      setPack(await downloadPack(userId!));
                    } catch (e) {
                      toast(errorText(e), 'bad');
                    } finally {
                      setDownloading(false);
                    }
                  }}
                >
                  ⬇ {t('solo.offlineDownload')}
                </Button>
              )}
            </div>
          </Card>
        )}
      </div>
    </Screen>
  );
}
