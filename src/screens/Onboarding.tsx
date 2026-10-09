import { useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Link } from '../lib/router';
import { useSession } from '../lib/session';
import { DISTRICTS } from '../lib/units';
import { analyticsAvailable, setAnalytics } from '../lib/telemetry';
import { Button, Field, Screen, Segmented, inputClass } from '../components/ui';

// Name, district and target exam year: the only personal data kept (DPDP Act).
export default function Onboarding() {
  const { t, lang, setLang, errorText } = useI18n();
  const { profile, refresh } = useSession();
  const year = new Date().getFullYear();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(
    () => profile?.username ?? ((profile?.display_name ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 14) || 'aspirant') + Math.floor(Math.random() * 90 + 10),
  );
  const [district, setDistrict] = useState('');
  const [examYear, setExamYear] = useState(year + 1);
  const [referrer, setReferrer] = useState(() => localStorage.getItem('g4.ref') ?? '');
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [analytics, setAnalyticsChoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const valid = name.trim() && /^[a-z0-9_]{3,20}$/.test(username) && district && adult && consent;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.completeOnboarding({ username, name: name.trim(), district, examYear, language: lang, referrer: referrer.trim() || null });
      localStorage.removeItem('g4.ref');
      setAnalytics(analytics);
      await refresh();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Screen
      title={t('onb.title')}
      footer={
        <Button block size="lg" disabled={!valid} loading={busy} onClick={submit}>
          {t('onb.submit')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Segmented options={[{ value: 'ta', label: 'தமிழ்' }, { value: 'en', label: 'English' }]} value={lang} onChange={(v) => setLang(v)} />
        <Field label={t('onb.name')}>
          <input className={inputClass} value={name} maxLength={40} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('onb.username')} hint={t('onb.usernameHint')}>
          <input
            className={inputClass}
            value={username}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          />
        </Field>
        <Field label={t('onb.district')}>
          <select className={inputClass} value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">{t('onb.pickDistrict')}</option>
            {[...DISTRICTS]
              .sort((a, b) => (lang === 'ta' ? a.ta.localeCompare(b.ta, 'ta') : a.key.localeCompare(b.key)))
              .map((d) => (
                <option key={d.key} value={d.key}>
                  {lang === 'ta' ? `${d.ta} (${d.key})` : d.key}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t('onb.examYear')}>
          <Segmented options={[year, year + 1, year + 2].map((y) => ({ value: y, label: String(y) }))} value={examYear} onChange={setExamYear} />
        </Field>
        <Field label={t('onb.referrer')}>
          <input className={inputClass} value={referrer} maxLength={20} autoCapitalize="none" onChange={(e) => setReferrer(e.target.value.toLowerCase())} />
        </Field>
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" className="h-6 w-6 accent-[var(--brand)]" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>{t('onb.adult')}</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-[var(--brand)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="text-sm">
            {t('onb.consent')}{' '}
            <Link to="/terms" className="underline">
              {t('profile.terms')}
            </Link>{' '}
            ·{' '}
            <Link to="/privacy" className="underline">
              {t('profile.privacy')}
            </Link>
          </span>
        </label>
        {analyticsAvailable && (
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-[var(--brand)]" checked={analytics} onChange={(e) => setAnalyticsChoice(e.target.checked)} />
            <span className="text-sm">{t('onb.analytics')}</span>
          </label>
        )}
        {error && <p className="text-sm font-semibold text-bad">{error}</p>}
      </div>
    </Screen>
  );
}
