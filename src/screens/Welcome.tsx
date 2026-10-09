import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { isDemo, sb } from '../lib/supabase';
import { Link } from '../lib/router';
import { Button, Field, inputClass } from '../components/ui';

// Screens 1–2: language pick, then email sign-in (magic link or 6-digit code).
export default function Welcome() {
  const { t, lang, setLang, chosen } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'email' | 'code' | null>(null);
  const [error, setError] = useState('');

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

  const sendLink = async () => {
    setBusy('email');
    setError('');
    const { error } = await (await sb()).auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    setBusy(null);
    if (error) setError(error.message);
    else setSent(true);
  };

  // The email carries a 6-digit code as well as the link: typing the code works
  // inside an installed app, where tapping the link would open the browser instead.
  const verifyCode = async () => {
    setBusy('code');
    setError('');
    const { error } = await (await sb()).auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(null);
    if (error) setError(t('welcome.badCode'));
  };

  return (
    <div className="safe-top mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-8">
      <div className="flex justify-end pt-3">
        <button className="min-h-11 rounded-full border border-line px-4 text-sm font-semibold" onClick={() => setLang(lang === 'ta' ? 'en' : 'ta')}>
          {lang === 'ta' ? 'English' : 'தமிழ்'}
        </button>
      </div>
      <div className="mt-6 flex flex-col items-center text-center">
        <img src="/logo.svg" alt="" width={80} height={80} className="rounded-3xl shadow-card" />
        <h1 className="mt-4 text-2xl font-black">{t('app.name')}</h1>
        <p className="text-muted">{t('app.tagline')}</p>
      </div>
      <ul className="mt-6 space-y-2">
        {(['welcome.p1', 'welcome.p2', 'welcome.p3'] as const).map((k, i) => (
          <li key={k} className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card">
            <span className="text-2xl" aria-hidden>
              {['🪙', '⚔️', '📚'][i]}
            </span>
            <span className="font-semibold">{t(k)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-3 pt-8">
        {sent ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void verifyCode();
            }}
          >
            <p className="rounded-2xl bg-ok-bg p-4 text-sm font-semibold">{t('welcome.linkSent', { email })}</p>
            <Field label={t('welcome.code')}>
              <input
                className={`${inputClass} text-center font-mono text-2xl tracking-[0.4em]`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Button block type="submit" loading={busy === 'code'} disabled={code.length !== 6}>
              {t('welcome.verify')}
            </Button>
            <button type="button" className="w-full text-sm text-muted underline" onClick={() => { setSent(false); setCode(''); }}>
              {t('welcome.changeEmail')}
            </button>
          </form>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sendLink();
            }}
          >
            <Field label={t('welcome.email')}>
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
            <Button block type="submit" loading={busy === 'email'} disabled={!email.includes('@')}>
              {t('welcome.email')}
            </Button>
          </form>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
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
