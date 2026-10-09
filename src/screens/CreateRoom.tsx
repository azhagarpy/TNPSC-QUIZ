import { useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { UNITS } from '../lib/units';
import { track } from '../lib/telemetry';
import { Button, Card, Coin, Field, Screen, Segmented, Toggle, inputClass } from '../components/ui';

// Screen 8: size, subject, entry coins, question count, language, power-ups.
export default function CreateRoom() {
  const { t, lang, errorText } = useI18n();
  const { summary, profile } = useSession();
  const { navigate } = useRouter();
  const [size, setSize] = useState(2);
  const [subject, setSubject] = useState('mixed');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [qLang, setQLang] = useState(lang);
  const [stake, setStake] = useState(50);
  const [powerups, setPowerups] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!summary || !profile) return null;

  const tiers = Object.entries(summary.stake_tiers)
    .map(([s, lvl]) => ({ stake: Number(s), level: lvl }))
    .sort((a, b) => a.stake - b.stake);
  const fourLevel = summary.four_player_level;
  const pot = stake * size;

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const room = await api.createRoom({ size, stake, subject, count, language: qLang, powerups, difficulty });
      track('room_created', { size, stake, count, subject });
      navigate(`/r/${room.code}`, { replace: true });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Screen
      title={t('room.create')}
      back="/"
      footer={
        <Button block size="lg" variant="gold" loading={busy} onClick={create}>
          ⚔️ {t('room.createBtn')}
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label={t('room.size')} hint={profile.level < fourLevel ? t('room.sizeLocked', { n: fourLevel }) : undefined}>
          <Segmented
            value={size}
            onChange={setSize}
            options={[2, 3, 4].map((n) => ({ value: n, label: `${n} 👤`, disabled: n === 4 && profile.level < fourLevel }))}
          />
        </Field>

        <Field label={t('room.stake')}>
          <Segmented
            value={stake}
            onChange={setStake}
            options={tiers.map((tier) => ({
              value: tier.stake,
              label: tier.stake === 0 ? t('room.friendly') : <span className="inline-flex items-center gap-1"><Coin size={14} />{tier.stake}</span>,
              disabled: profile.level < tier.level || summary.available < tier.stake,
              hint: profile.level < tier.level ? `🔒 ${t('room.unlockAt', { n: tier.level })}` : summary.available < tier.stake ? t('room.cantAfford') : undefined,
            }))}
          />
        </Field>

        {stake > 0 && (
          <Card className="!p-3 text-sm">
            <p className="font-bold">{t('room.pot', { pot })}</p>
            <p>{size === 2 ? t('room.split2') : size === 3 ? t('room.split3') : t('room.split4')}</p>
            <p className="mt-1 text-xs text-muted">{t('room.houseCut')}</p>
            <p className="mt-1 text-xs text-muted">{t('room.escrow')}</p>
          </Card>
        )}

        <Field label={t('room.subject')}>
          <select className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="mixed">{t('solo.mixed')}</option>
            {UNITS.map((u) => (
              <option key={u.key} value={u.key}>
                {u[lang]}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('room.count')}>
          <Segmented value={count} onChange={setCount} options={[5, 10, 15].map((n) => ({ value: n, label: String(n) }))} />
        </Field>

        <Field label={t('room.difficulty')}>
          <Segmented
            value={difficulty ?? 0}
            onChange={(v) => setDifficulty(v === 0 ? null : v)}
            options={[
              { value: 0, label: t('solo.auto') },
              { value: 2, label: t('solo.easy') },
              { value: 3, label: t('solo.medium') },
              { value: 4, label: t('solo.hard') },
            ]}
          />
        </Field>

        <Field label={t('room.language')}>
          <Segmented value={qLang} onChange={setQLang} options={[{ value: 'ta', label: 'தமிழ்' }, { value: 'en', label: 'English' }]} />
        </Field>

        <Toggle checked={powerups} onChange={setPowerups} label={t('room.powerups')} />
        {error && <p className="text-sm font-semibold text-bad">{error}</p>}
      </div>
    </Screen>
  );
}
