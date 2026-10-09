import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { isDemo, sb } from '../lib/supabase';
import { Link } from '../lib/router';
import { Button, Field, cx, inputClass } from '../components/ui';

const USERNAME = /^[a-z0-9_]{3,20}$/;

// Screens 1–2: language pick, then an account: register with username, email
// and password; sign in again with username or email plus password.
export default function Welcome() {
  const { t, lang, setLang, chosen, errorText } = useI18n();
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Live username check while registering.
  useEffect(() => {
    setAvailable(null);
    if (mode !== 'signup' || !USERNAME.test(username)) return;
    const id = setTimeout(() => {
      api.usernameAvailable(username).then(setAvailable).catch(() => setAvailable(null));
    }, 400);
    return () => clearTimeout(id);
  }, [username, mode]);

  if (!chosen || isDemo) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
        <img src="/logo.svg" alt="" width={96} height={96} className="anim-pop rounded-3xl shadow-card" />
        <div>
          <h1 className="text-2xl font-black">குரூப் 4 வினாடி வினா</h1>
          <p className="text-muted">Group 4 Quiz Battle</p>
        </div>
        <p className="font-semibold">மொழியைத் தேர்ந்தெடுக்கவும் · Choose your language</p>
        <div className="grid w-full grid-cols-2 gap-3">
          <Button size="lg" variant={lang === 'ta' ? 'primary' : 'secondary'} onClick={() => setLang('ta')}>
            தமிழ்
          </Button>
          <Button size="lg" variant={lang === 'en' ? 'primary' : 'secondary'} onClick={() => setLang('en')}>
            English
          </Button>
        </div>
      </div>
    );
  }

  // Supabase Auth messages → our wording.
  const authError = (message: string) =>
    /already registered|already been registered/i.test(message)
      ? t('welcome.emailTaken')
      : /invalid login|invalid credentials/i.test(message)
        ? t('welcome.wrongLogin')
        : /not confirmed/i.test(message)
          ? t('welcome.confirmOn')
          : /password/i.test(message)
            ? t('welcome.weakPassword')
            : message;

  const signUp = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const client = await sb();
      const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { data: { username } } });
      if (error) setError(authError(error.message));
      else if (!data.session) setInfo(t('welcome.confirmOn')); // "Confirm email" is still on in Supabase
      // With a session, the app moves on to the profile step by itself.
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const value = login.trim();
      // Usernames are turned into the account email only after the password checks out.
      const mail = value.includes('@') ? value : await api.resolveLogin(value, password);
      if (!mail) {
        setError(t('welcome.wrongLogin'));
        return;
      }
      const { error } = await (await sb()).auth.signInWithPassword({ email: mail, password });
      if (error) setError(authError(error.message));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const passwordInput = (
    <Field label={t('welcome.password')} hint={mode === 'signup' ? t('welcome.passwordHint') : undefined}>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          required
          minLength={mode === 'signup' ? 8 : undefined}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
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
  );

  const canSignUp = USERNAME.test(username) && available !== false && email.includes('@') && password.length >= 8;
  const canSignIn = login.trim().length >= 3 && password.length > 0;

  return (
    <div className="safe-top mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-8">
      <div className="flex justify-end pt-3">
        <button className="min-h-11 rounded-full border border-line px-4 text-sm font-semibold" onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}>
          {lang === 'ta' ? 'English' : 'தமிழ்'}
        </button>
      </div>
      <div className="mt-4 flex flex-col items-center text-center">
        <img src="/logo.svg" alt="" width={72} height={72} className="rounded-3xl shadow-card" />
        <h1 className="mt-3 text-2xl font-black">{t('app.name')}</h1>
        <p className="text-muted">{t('app.tagline')}</p>
      </div>
      {mode === 'signup' && (
        <ul className="mt-5 space-y-2">
          {(['welcome.p1', 'welcome.p2', 'welcome.p3'] as const).map((k, i) => (
            <li key={k} className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card">
              <span className="text-2xl" aria-hidden>
                {['🪙', '⚔️', '📚'][i]}
              </span>
              <span className="font-semibold">{t(k)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-3 pt-6">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1" role="tablist">
          {(['signup', 'signin'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={cx('min-h-11 rounded-xl px-2 text-sm font-bold', mode === m ? 'bg-surface text-brand shadow-card' : 'text-muted')}
              onClick={() => {
                setMode(m);
                setError('');
                setInfo('');
              }}
            >
              {m === 'signup' ? t('welcome.signup') : t('welcome.signin')}
            </button>
          ))}
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void (mode === 'signup' ? signUp() : signIn());
          }}
        >
          {mode === 'signup' ? (
            <>
              <Field
                label={t('onb.username')}
                hint={
                  available === false ? (
                    <span className="text-bad">{t('err.username_taken')}</span>
                  ) : available ? (
                    <span className="text-ok">✓ {t('welcome.usernameFree')}</span>
                  ) : (
                    t('onb.usernameHint')
                  )
                }
              >
                <input
                  className={inputClass}
                  value={username}
                  maxLength={20}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                />
              </Field>
              <Field label={t('welcome.emailLabel')}>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  className={inputClass}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              {passwordInput}
              <Button block size="lg" type="submit" loading={busy} disabled={!canSignUp}>
                {t('welcome.createAccount')}
              </Button>
            </>
          ) : (
            <>
              <Field label={t('welcome.loginLabel')}>
                <input
                  className={inputClass}
                  value={login}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  onChange={(e) => setLogin(e.target.value)}
                />
              </Field>
              {passwordInput}
              <Button block size="lg" type="submit" loading={busy} disabled={!canSignIn}>
                {t('welcome.signin')}
              </Button>
              <p className="text-center text-xs text-muted">{t('welcome.forgot')}</p>
            </>
          )}
        </form>
        {error && <p className="text-sm font-semibold text-bad">{error}</p>}
        {info && <p className="rounded-2xl bg-accent-bg p-3 text-sm">{info}</p>}
        <p className="pt-2 text-center text-xs text-muted">{t('welcome.free')}</p>
        <p className="text-center text-xs text-muted">
          {t('welcome.legal')}{' '}
          <Link to="/terms" className="underline">
            {t('profile.terms')}
          </Link>{' '}
          ·{' '}
          <Link to="/privacy" className="underline">
            {t('profile.privacy')}
          </Link>
        </p>
      </div>
    </div>
  );
}
