import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { useRouter } from '../lib/router';
import { sb } from '../lib/supabase';
import { Button, Coin, Field, cx, inputClass, useToast } from '../components/ui';

type Phase = 'checking' | 'form' | 'expired';

let checking: Promise<boolean> | null = null;

/**
 * Signs in with the emailed reset link, once per page load (StrictMode runs
 * effects twice, and the token only works once). The link carries either a
 * token_hash (our email template: works on any device) or a PKCE code (the
 * default template: only in the browser that asked for the link, which the
 * client exchanges by itself while starting up).
 */
function signInFromLink(): Promise<boolean> {
  checking ??= (async () => {
    const url = new URL(window.location.href);
    const params = new URLSearchParams([...url.searchParams, ...new URLSearchParams(url.hash.slice(1))]);
    if (params.get('error') || params.get('error_code')) return false;
    const client = await sb();
    const tokenHash = params.get('token_hash');
    if (tokenHash) {
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
      if (error) return false;
    }
    // Waits for the client's start-up, which is when a PKCE code is exchanged.
    const { data } = await client.auth.getSession();
    return !!data.session;
  })()
    .catch(() => false)
    // The token works once; drop it from the address bar (only now: the client reads it at start-up).
    .finally(() => window.history.replaceState(window.history.state, '', '/reset'));
  return checking;
}

// Where the "reset your password" email lands: choose a new password.
export default function ResetPassword() {
  const { t, errorText } = useI18n();
  const { navigate } = useRouter();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void signInFromLink().then((ok) => alive && setPhase(ok ? 'form' : 'expired'));
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const { error } = await (await sb()).auth.updateUser({ password });
      if (error) {
        setError(/at least|weak/i.test(error.message) ? t('welcome.weakPassword') : error.message);
        return;
      }
      toast(t('reset.done'), 'ok');
      navigate('/', { replace: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="safe-top mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-8">
      <div className="flex flex-col items-center text-center">
        <img src="/logo.svg" alt="" width={72} height={72} className="anim-bob rounded-3xl shadow-[0_6px_0_rgb(0_0_0/0.3)]" />
        <h1 className="text-outline mt-4 text-3xl font-extrabold leading-tight">🔑 {t('reset.title')}</h1>
      </div>

      {phase === 'checking' && (
        <div className="flex flex-col items-center gap-3 text-center">
          <span role="status" aria-label="loading" className="anim-coin-spin inline-block">
            <Coin size={48} />
          </span>
          <p className="font-semibold text-muted">{t('reset.checking')}</p>
        </div>
      )}

      {phase === 'expired' && (
        <div className="panel space-y-4 p-4 text-center">
          <p className="text-4xl" aria-hidden>
            ⏳
          </p>
          <p className="font-semibold">{t('reset.expired')}</p>
          <Button block size="lg" onClick={() => navigate('/', { replace: true, state: { forgot: true } })}>
            📧 {t('reset.again')}
          </Button>
        </div>
      )}

      {phase === 'form' && (
        <form
          className="panel space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="text-sm text-muted">{t('reset.body')}</p>
          <Field label={t('profile.newPassword')}>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="new-password"
                autoFocus
                className={cx(inputClass, 'pr-16')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-2 my-auto h-9 rounded-xl px-2 text-sm font-semibold text-accent"
                onClick={() => setShow((s) => !s)}
              >
                {show ? t('welcome.hide') : t('welcome.show')}
              </button>
            </div>
          </Field>
          <Button block size="lg" variant="gold" type="submit" loading={busy} disabled={password.length < 8}>
            {t('reset.save')}
          </Button>
          {error && <p className="text-sm font-semibold text-bad">⚠️ {error}</p>}
        </form>
      )}
    </div>
  );
}
