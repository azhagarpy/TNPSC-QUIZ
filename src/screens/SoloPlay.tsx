import { useEffect, useRef, useState } from 'react';
import { demoProfile, demoQuestions, saveDemoProfile } from '../lib/demo';
import { useI18n } from '../lib/i18n';
import { levelForXp } from '../lib/levels';
import { loadPack, recordOfflineSet, syncPending, unusedQuestions } from '../lib/offline';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { startLocal, startRemote, type SoloEngine } from '../lib/solo';
import { subtopicName } from '../lib/units';
import type { SoloSummary } from '../lib/types';
import { SoloResult } from '../components/SoloResult';
import { SoloRunner } from '../components/SoloRunner';
import { ErrorBox, Loading, Screen } from '../components/ui';
import type { PlayConfig } from './SoloSetup';

export default function SoloPlay() {
  const { t, lang, errorText } = useI18n();
  const { state, navigate } = useRouter();
  const { userId, refresh } = useSession();
  const [cfg, setCfg] = useState<PlayConfig | null>((state as PlayConfig | null) ?? null);
  const [engine, setEngine] = useState<SoloEngine | null>(null);
  const [summary, setSummary] = useState<SoloSummary | null>(null);
  const [error, setError] = useState('');
  const helpers = useRef({ errorText, refresh, navigate });
  helpers.current = { errorText, refresh, navigate };

  useEffect(() => {
    const { errorText, refresh, navigate } = helpers.current;
    if (!cfg) {
      navigate('/solo', { replace: true });
      return;
    }
    let alive = true;
    setEngine(null);
    setSummary(null);
    setError('');
    (async () => {
      try {
        let e: SoloEngine;
        if (cfg.mode === 'demo') {
          e = startLocal(await demoQuestions(), {
            mode: 'demo',
            subject: cfg.subject,
            onFinish: async (_results, base) => {
              const p = demoProfile();
              const coins = 5 * base.correct + (base.complete ? 20 : 0);
              const xp = p.xp + base.xp.xp;
              const saved = saveDemoProfile({ coins: p.coins + coins, xp, streak_count: p.streak_count + 1, streak_last_date: new Date().toISOString().slice(0, 10) });
              return { ...base, coins, balance: saved.coins, xp: { ...base.xp, level: saved.level, level_up: levelForXp(xp) > p.level } };
            },
          });
        } else if (cfg.mode === 'offline') {
          const pack = await loadPack(userId!);
          if (!pack) throw new Error('no pack');
          e = startLocal(unusedQuestions(pack), {
            mode: 'offline',
            onFinish: async (results, base) => {
              await recordOfflineSet(userId!, pack.packId, results.map((r) => ({ q: r.q, c: r.c, t: r.t })));
              const synced = navigator.onLine ? await syncPending(userId!) : 0;
              if (synced) void refresh();
              return { ...base, coins: synced || Math.min(100, 5 * base.correct), pending_sync: synced === 0 };
            },
          });
        } else {
          e = await startRemote(cfg.mode, cfg.subject, cfg.level, cfg.subtopic);
        }
        if (alive) setEngine(e);
      } catch (err) {
        if (alive) setError(errorText(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [cfg, userId]);

  const title =
    cfg?.mode === 'revision' ? t('home.revision') : cfg?.mode === 'offline' ? t('solo.offline') : cfg?.subtopic ? subtopicName(cfg.subtopic, lang) : t('solo.title');

  if (summary) {
    return (
      <Screen title={title} back="/solo">
        <SoloResult
          summary={summary}
          onHome={() => navigate('/', { replace: true })}
          onPlayAgain={() => setCfg({ ...cfg! })}
          onPractise={cfg?.mode === 'practice' ? (unit, subtopic) => setCfg({ mode: 'practice', subject: unit, subtopic }) : cfg?.mode === 'demo' ? (unit) => setCfg({ mode: 'demo', subject: unit }) : undefined}
        />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen title={title} back="/solo">
        <ErrorBox text={error} onRetry={() => setCfg({ ...cfg! })} />
      </Screen>
    );
  }
  if (!engine) return <Loading />;
  return (
    <SoloRunner
      engine={engine}
      title={title}
      onQuit={() => navigate('/solo', { replace: true })}
      onFinished={(s) => {
        setSummary(s);
        void refresh();
      }}
    />
  );
}
