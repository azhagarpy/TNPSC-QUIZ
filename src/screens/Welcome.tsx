import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { isDemo, sb } from '../lib/supabase';
import { Link } from '../lib/router';
import { Button, Field, Ribbon, cx, inputClass } from '../components/ui';

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
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-7 px-6 text-center">
        <div className="relative">
          <span className="rays" aria-hidden />
          <img src="/logo.svg" alt="" width={120} height={120} className="anim-bob relative rounded-[30px] shadow-[0_8px_0_rgb(0_0_0/0.3)]" />
        </div>
        <div>
          <h1 className="text-outline text-4xl font-extrabold leading-tight">குரூப் 4 வினாடி வினா</h1>
          <Ribbon color="gold" className="mt-4">
            Group 4 Quiz Battle
          </Ribbon>
        </div>
        <p className="glass px-4 py-2 font-semibold">மொழியைத் தேர்ந்தெடுக்கவும் · Choose your language</p>
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
    <div className="safe-top mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8">
      <div className="flex justify-end pt-3">
        <button className="btn-round !w-auto px-4 font-display text-sm" onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}>
          🌐 {lang === 'ta' ? 'English' : 'தமிழ்'}
        </button>
      </div>
      <div className="mt-1 flex flex-col items-center text-center">
        <img src="/logo.svg" alt="" width={84} height={84} className="anim-bob rounded-3xl shadow-[0_6px_0_rgb(0_0_0/0.3)]" />
        <h1 className="text-outline mt-4 text-3xl font-extrabold leading-tight">{t('app.name')}</h1>
        <p className="mt-2 font-semibold text-muted">{t('app.tagline')}</p>
      </div>
      {mode === 'signup' && (
        <ul className="mt-5 space-y-2">
          {(['welcome.p1', 'welcome.p2', 'welcome.p3'] as const).map((k, i) => (
            <li key={k} className="glass anim-rise flex items-center gap-3 p-2.5" style={{ animationDelay: `${i * 0.08}s` }}>
              <span className={cx('btn3d grid h-11 w-11 shrink-0 place-items-center !rounded-xl text-2xl', ['btn-gold', 'btn-red', 'btn-blue'][i])} aria-hidden>
                {['🪙', '⚔️', '📚'][i]}
              </span>
              <span className="font-semibold">{t(k)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="panel mt-auto space-y-3 p-4">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-chip p-1" role="tablist">
          {(['signup', 'signin'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={cx('min-h-11 rounded-xl px-2 font-display text-sm font-bold', mode === m ? 'btn3d !rounded-xl' : 'text-muted')}
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
        {error && <p className="text-sm font-semibold text-bad">⚠️ {error}</p>}
        {info && <p className="rounded-2xl bg-accent-bg p-3 text-sm">{info}</p>}
      </div>
      <div className="space-y-1 pt-4">
        <p className="text-center text-xs text-muted">{t('welcome.free')}</p>
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
