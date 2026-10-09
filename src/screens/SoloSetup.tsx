import { useEffect, useState } from 'react';
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
              <h2 className="mb-2 font-bold">{t('solo.subject')}</h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSubject('mixed')}
                  className={cx('col-span-2 min-h-14 rounded-2xl border-2 px-3 text-left font-semibold', subject === 'mixed' ? 'border-brand bg-brand/10' : 'border-line bg-surface')}
                >
                  🎲 {t('solo.mixed')}
                </button>
                {UNITS.map((u) => (
                  <button
                    key={u.key}
                    onClick={() => setSubject(u.key)}
                    className={cx('tamil-wrap min-h-14 rounded-2xl border-2 px-3 py-2 text-left text-sm font-semibold', subject === u.key ? 'border-brand bg-brand/10' : 'border-line bg-surface')}
                  >
                    <span className="mr-1" aria-hidden>
                      {unitIcon(u.key)}
                    </span>
                    {u[lang]}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <h2 className="mb-2 font-bold">{t('solo.level')}</h2>
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
              <Button block size="lg" onClick={() => play({ mode: isDemo ? 'demo' : 'practice', subject: subject === 'mixed' ? null : subject, level: level === 'auto' ? null : level })}>
                ▶ {t('solo.start')}
              </Button>
              <p className="mt-2 text-center text-xs text-muted">{t('solo.rules')}</p>
            </div>

            {!isDemo && (
              <Card>
                <p className="font-bold">📚 {t('solo.revisionStart')}</p>
                <p className="mb-3 text-sm text-muted">{t('solo.revisionBody')}</p>
                <Button variant="secondary" size="sm" onClick={() => play({ mode: 'revision' })}>
                  {t('home.revisionDue', { n: summary?.revision_due ?? 0 })} →
                </Button>
              </Card>
            )}
          </>
        )}

        {!isDemo && (
          <Card className={cx(isOffline && 'border-accent')}>
            <p className="font-bold">📴 {t('solo.offline')}</p>
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
