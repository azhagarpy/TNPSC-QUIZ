import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fx } from '../lib/feedback';
import { useI18n } from '../lib/i18n';
import { deviceFingerprint } from '../lib/platform';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { startRemote, type SoloEngine } from '../lib/solo';
import { SoloRunner } from '../components/SoloRunner';
import { Button, Coin, ErrorBox, Loading } from '../components/ui';

// First-time flow: 3-question demo → 500 starter coins → invite a friend or play solo.
export default function DemoQuiz() {
  const { t, errorText } = useI18n();
  const { refresh } = useSession();
  const { navigate } = useRouter();
  const [engine, setEngine] = useState<SoloEngine | null>(null);
  const [bonus, setBonus] = useState<{ coins: number; limited: boolean } | null>(null);
  const [error, setError] = useState('');

  const start = async () => {
    setError('');
    try {
      setEngine(await startRemote('demo'));
    } catch (e) {
      setError(errorText(e));
    }
  };

  useEffect(() => {
    void start();
  }, []); // once, on mount

  const claim = async () => {
    try {
      const r = await api.claimSignupBonus(await deviceFingerprint());
      setBonus({ coins: r.coins, limited: r.limited });
      if (r.coins > 0) fx.win();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const finish = async (to: string) => {
    navigate(to, { replace: true }); // the gate shows it once the refreshed profile has the bonus
    await refresh();
  };

  if (bonus) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="relative">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="absolute left-1/2 top-1/2" style={{ animation: `coin-drop 0.8s ease-out ${i * 0.1}s both`, marginLeft: (i - 4) * 14 }}>
              <Coin size={28} />
            </span>
          ))}
          <Coin size={96} />
        </div>
        <h1 className="text-3xl font-black">{bonus.limited ? '🙂' : t('demo.bonusTitle')}</h1>
        <p className="text-muted">{bonus.limited ? t('demo.bonusLimited') : t('demo.bonusBody')}</p>
        <div className="grid w-full gap-2">
          <Button block size="lg" onClick={() => void finish('/room/new')}>
            ⚔️ {t('demo.invite')}
          </Button>
          <Button block variant="secondary" onClick={() => void finish('/solo')}>
            🎯 {t('demo.solo')}
          </Button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox text={error} onRetry={() => void (engine ? claim() : start())} />
      </div>
    );
  }
  if (!engine) return <Loading />;
  return <SoloRunner engine={engine} title={t('demo.title')} onFinished={() => void claim()} onQuit={() => void claim()} />;
}
