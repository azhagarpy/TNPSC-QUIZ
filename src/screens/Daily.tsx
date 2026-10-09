import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { startRemote, type SoloEngine } from '../lib/solo';
import type { DailyBoard, SoloSummary } from '../lib/types';
import { districtName } from '../lib/units';
import { SoloResult } from '../components/SoloResult';
import { SoloRunner } from '../components/SoloRunner';
import { Avatar, Button, Card, Empty, ErrorBox, Loading, Screen, Segmented, cx } from '../components/ui';

export function DailyBoardView() {
  const { t, lang, errorText } = useI18n();
  const [scope, setScope] = useState<'state' | 'district' | 'friends'>('state');
  const [board, setBoard] = useState<DailyBoard | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setBoard(await api.dailyBoard(scope));
    } catch (e) {
      setError(errorText(e));
    }
  }, [scope, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-3">
      <h2 className="font-bold">🏆 {t('daily.board')}</h2>
      <Segmented
        small
        value={scope}
        onChange={setScope}
        options={[
          { value: 'state', label: t('lb.state') },
          { value: 'district', label: t('lb.district') },
          { value: 'friends', label: t('lb.friends') },
        ]}
      />
      {error && <ErrorBox text={error} onRetry={load} />}
      {!board && !error && <Loading />}
      {board && board.top.length === 0 && <Empty icon="🗓️">{t('daily.empty')}</Empty>}
      {board && board.top.length > 0 && (
        <ol className="space-y-2">
          {board.top.map((r) => (
            <li key={r.user.id} className="flex items-center gap-3 rounded-2xl bg-surface p-2 shadow-card">
              <span className={cx('w-8 text-center font-black', r.rank <= 3 && 'text-brand')}>{r.rank}</span>
              <Avatar avatar={r.user.avatar} frame={r.user.frame} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.user.name}</p>
                <p className="truncate text-xs text-muted">{districtName(r.user.district, lang)}</p>
              </div>
              <span className="font-bold tabular-nums">{r.score}</span>
            </li>
          ))}
        </ol>
      )}
      {board?.me && (
        <p className="text-center text-sm font-semibold">
          {t('lb.you')}: #{board.me.rank} · {board.me.score}
        </p>
      )}
    </section>
  );
}

export default function Daily() {
  const { t, errorText } = useI18n();
  const { summary, refresh } = useSession();
  const { navigate } = useRouter();
  const [engine, setEngine] = useState<SoloEngine | null>(null);
  const [result, setResult] = useState<SoloSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const daily = summary?.daily;
  const resumable = daily?.played && !daily.finished ? daily.session_id : null;

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      setEngine(await startRemote('daily', null, null, null, resumable));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (engine && !result) {
    return (
      <SoloRunner
        engine={engine}
        title={t('daily.title')}
        onQuit={() => navigate('/', { replace: true })}
        onFinished={(s) => {
          setResult(s);
          void refresh();
        }}
      />
    );
  }

  return (
    <Screen title={t('daily.title')} back="/">
      <div className="space-y-5">
        {result ? (
          <SoloResult summary={result} onHome={() => navigate('/', { replace: true })} />
        ) : (
          <Card>
            <p className="text-sm">{t('daily.rules')}</p>
            {daily?.finished ? (
              <p className="mt-3 font-bold text-ok">✓ {t('home.dailyDone', { score: daily.score ?? 0 })}</p>
            ) : (
              <Button block size="lg" className="mt-4" loading={busy} onClick={start}>
                ▶ {t('daily.start')}
              </Button>
            )}
            {error && <p className="mt-2 text-sm text-bad">{error}</p>}
          </Card>
        )}
        <DailyBoardView />
      </div>
    </Screen>
  );
}
