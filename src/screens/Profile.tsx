import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useTier, notifyTierChange } from '../lib/device';
import { useI18n } from '../lib/i18n';
import { levelProgress, levelTitle } from '../lib/levels';
import { canInstall, isIos, promptInstall } from '../lib/platform';
import { setPrefs, usePrefs } from '../lib/prefs';
import { Link, useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { isDemo, sb } from '../lib/supabase';
import type { LedgerRow, MyStats } from '../lib/types';
import { AVATARS, DISTRICTS, districtName, subtopicName, unitName } from '../lib/units';
import type { StringKey } from '../lib/strings';
import { SHOP_AVATARS } from '../lib/cosmetics';
import { useOwnedItems } from '../lib/owned';
import { disablePush, enablePush, pushConfigured, pushEnabled } from '../lib/push';
import { analyticsAvailable, setAnalytics, track } from '../lib/telemetry';
import { Avatar, Button, Card, CoinChip, Field, ProgressBar, Screen, Segmented, Sheet, Toggle, cx, inputClass, useToast } from '../components/ui';

// Screen 14: level, badges, accuracy per unit, coin history, settings.
export default function Profile() {
  const { t, lang, setLang, errorText } = useI18n();
  const { profile, summary, refresh, signOut, patchProfile } = useSession();
  const { navigate } = useRouter();
  const prefs = usePrefs();
  const tier = useTier();
  const toast = useToast();
  const [stats, setStats] = useState<MyStats | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof api.recentMatches>>>([]);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const owned = useOwnedItems();

  useEffect(() => {
    if (!isDemo && pushConfigured) void pushEnabled().then(setPushOn);
  }, []);

  useEffect(() => {
    if (isDemo) return;
    api.myStats().then(setStats).catch(() => {});
    api.recentMatches().then(setRecent).catch(() => {});
    void sb().then((client) =>
      client
      .from('coin_ledger')
      .select('id, amount, balance_after, reason, created_at')
      .order('id', { ascending: false })
      .limit(30)
      .then(({ data }) => setLedger((data as LedgerRow[]) ?? [])),
    );
  }, []);

  if (!profile || !summary) return null;
  const lp = levelProgress(profile.xp);

  const update = async (changes: Record<string, unknown>) => {
    try {
      const p = await api.updateProfile(changes);
      patchProfile(p);
    } catch (e) {
      toast(errorText(e), 'bad');
      throw e;
    }
  };

  return (
    <Screen title={profile.display_name ?? ''} nav>
      <div className="space-y-4">
        <Card className="flex items-center gap-4">
          <button onClick={() => !isDemo && setAvatarOpen(true)} aria-label={t('profile.avatar')}>
            <Avatar avatar={profile.avatar} frame={profile.frame} size={72} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-muted">
              @{profile.username} · {districtName(profile.district, lang)}
            </p>
            <p className="font-bold">
              {t('common.level', { n: lp.level })} · {levelTitle(lp.level, lang)}
            </p>
            <ProgressBar pct={lp.pct} color="bg-accent" />
            <p className="mt-1 text-xs text-muted">{lp.toNext > 0 && t('profile.nextLevel', { xp: lp.toNext, n: lp.level + 1 })}</p>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card className="!p-3">
            <CoinChip value={summary.available} />
            <p className="mt-2 text-xs text-muted">{t('profile.coinsRule')}</p>
          </Card>
          <Card className="!p-3">
            <p className="font-bold">🔥 {profile.streak_count}</p>
            <p className="text-xs text-muted">{t('profile.shields', { n: profile.shields })}</p>
            {!isDemo && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                disabled={profile.shields >= 3 || summary.available < 150}
                onClick={async () => {
                  try {
                    await api.buyShield();
                    await refresh();
                  } catch (e) {
                    toast(errorText(e), 'bad');
                  }
                }}
              >
                🛡️ {t('profile.buyShield')}
              </Button>
            )}
          </Card>
        </div>

        {stats && (
          <>
            <p className="text-center text-sm text-muted">
              {t('profile.matches', { m: stats.matches, w: stats.wins })} · {t('profile.soloSets', { n: stats.solo_sets })} ·{' '}
              {t('profile.revision', { n: stats.revision_cards })}
            </p>

            <Card>
              <h2 className="mb-3 font-bold">🏅 {t('profile.badges')}</h2>
              <div className="grid grid-cols-3 gap-2">
                {stats.achievements.map((a) => (
                  <div key={a.key} className={cx('rounded-2xl p-2 text-center', a.earned_at ? 'bg-gold/20' : 'bg-surface-2 opacity-50')} title={lang === 'ta' ? a.desc_ta : a.desc_en}>
                    <p className="text-2xl">{a.icon}</p>
                    <p className="text-[11px] font-semibold leading-tight">{lang === 'ta' ? a.name_ta : a.name_en}</p>
                    {!a.earned_at && <p className="mt-0.5 text-[10px] leading-tight">{lang === 'ta' ? a.desc_ta : a.desc_en}</p>}
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="mb-3 font-bold">🎯 {t('profile.accuracy')}</h2>
              <ul className="space-y-2">
                {stats.units
                  .filter((u) => u.answered > 0)
                  .map((u) => (
                    <li key={u.unit}>
                      <div className="flex justify-between text-sm">
                        <span className="truncate">{unitName(u.unit, lang)}</span>
                        <span className="font-semibold tabular-nums">
                          {Math.round((u.correct / u.answered) * 100)}% · {u.answered}
                        </span>
                      </div>
                      <ProgressBar pct={(u.correct / u.answered) * 100} color="bg-ok" />
                    </li>
                  ))}
              </ul>
              {stats.weak.length > 0 && (
                <>
                  <h3 className="mb-1 mt-4 text-sm font-bold">{t('profile.weak')}</h3>
                  <ul className="text-sm">
                    {stats.weak.map((w) => (
                      <li key={w.unit + w.subtopic} className="flex justify-between">
                        <button className="truncate text-left text-accent underline" onClick={() => navigate('/play', { state: { mode: 'practice', subject: w.unit, subtopic: w.subtopic } })}>
                          {subtopicName(w.subtopic, lang)}
                        </button>
                        <span className="tabular-nums text-muted">
                          {w.correct}/{w.total}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </>
        )}

        {recent.length > 0 && (
          <Card>
            <h2 className="mb-2 font-bold">⚔️ {t('profile.recentRooms')}</h2>
            <ul className="space-y-1 text-sm">
              {recent.slice(0, 8).map((m) => (
                <li key={m.id}>
                  <button className="flex w-full justify-between" onClick={() => navigate(`/m/${m.id}/result`)}>
                    <span>
                      {new Date(m.started_at).toLocaleDateString(lang === 'ta' ? 'ta-IN' : 'en-IN')} · {m.players}👤
                    </span>
                    <span className={cx('font-semibold', m.rank === 1 ? 'text-ok' : 'text-muted')}>
                      #{m.rank ?? '–'} · {m.score}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {ledger.length > 0 && (
          <Card>
            <h2 className="mb-2 font-bold">🪙 {t('profile.coinHistory')}</h2>
            <ul className="space-y-1 text-sm">
              {ledger.map((l) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span className="truncate">{(`reason.${l.reason}` as StringKey) in reasonKeys ? t(`reason.${l.reason}` as StringKey) : l.reason}</span>
                  <span className={cx('font-semibold tabular-nums', l.amount >= 0 ? 'text-ok' : 'text-bad')}>
                    {l.amount >= 0 ? '+' : ''}
                    {l.amount}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <h2 className="mb-2 font-bold">⚙️ {t('profile.settings')}</h2>
          <Field label={t('profile.language')}>
            <Segmented
              value={lang}
              onChange={(l) => {
                setLang(l);
                if (!isDemo) void update({ language: l }).catch(() => {});
              }}
              options={[{ value: 'ta', label: 'தமிழ்' }, { value: 'en', label: 'English' }]}
            />
          </Field>
          <Toggle checked={prefs.sound} onChange={(v) => setPrefs({ sound: v })} label={t('profile.sound')} />
          <Toggle checked={prefs.haptics} onChange={(v) => setPrefs({ haptics: v })} label={t('profile.haptics')} />
          <Toggle
            checked={prefs.batterySaver}
            onChange={(v) => {
              setPrefs({ batterySaver: v });
              notifyTierChange();
            }}
            label={
              <span>
                {t('profile.batterySaver')}
                <span className="block text-xs text-muted">
                  {t('profile.graphics')}: {t(`tier.${tier}`)}
                </span>
              </span>
            }
          />
          {!isDemo && (
            <Toggle checked={profile.allow_stranger_chat} onChange={(v) => void update({ allow_stranger_chat: v }).catch(() => {})} label={t('profile.strangers')} />
          )}
          {!isDemo && pushConfigured && (
            <Toggle
              checked={pushOn}
              label={t('push.toggle')}
              onChange={async (v) => {
                if (!v) {
                  await disablePush();
                  setPushOn(false);
                  return;
                }
                try {
                  const r = await enablePush();
                  if (r === 'on') {
                    setPushOn(true);
                    toast(t('push.on'), 'ok');
                    track('push_enabled');
                  } else toast(t(r === 'install' ? 'push.install' : r === 'denied' ? 'push.denied' : 'push.unsupported'), 'bad');
                } catch (e) {
                  toast(errorText(e), 'bad');
                }
              }}
            />
          )}
          {analyticsAvailable && (
            <Toggle checked={prefs.analytics} onChange={setAnalytics} label={t('profile.analytics')} />
          )}
          {canInstall() && (
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => (isIos() ? toast(t('install.ios')) : void promptInstall())}>
              📲 {t('profile.install')}
            </Button>
          )}
        </Card>

        <div className="grid gap-2">
          {!isDemo && (
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              ✏️ {t('profile.edit')}
            </Button>
          )}
          {!isDemo && (
            <Button variant="secondary" onClick={() => navigate('/shop')}>
              🛍️ {t('profile.shop')}
            </Button>
          )}
          {profile.is_admin && (
            <Button variant="accent" onClick={() => navigate('/admin')}>
              🛠️ {t('profile.admin')}
            </Button>
          )}
          <p className="flex justify-center gap-4 text-sm">
            <Link to="/terms" className="underline">
              {t('profile.terms')}
            </Link>
            <Link to="/privacy" className="underline">
              {t('profile.privacy')}
            </Link>
          </p>
          {!isDemo && (
            <>
              <Button variant="secondary" onClick={() => setPasswordOpen(true)}>
                🔑 {t('profile.changePassword')}
              </Button>
              <Button variant="ghost" onClick={() => void signOut()}>
                {t('profile.signOut')}
              </Button>
              <Button variant="ghost" className="text-bad" onClick={() => setDeleteOpen(true)}>
                {t('profile.delete')}
              </Button>
            </>
          )}
        </div>
      </div>

      <Sheet open={avatarOpen} onClose={() => setAvatarOpen(false)} title={t('profile.avatar')}>
        <div className="grid grid-cols-4 gap-3">
          {[...Object.keys(AVATARS), ...Object.keys(SHOP_AVATARS).filter((k) => owned.includes(k))].map((a) => (
            <button
              key={a}
              className={cx('grid place-items-center rounded-2xl p-2', a === profile.avatar && 'bg-accent-bg')}
              onClick={async () => {
                if (a in SHOP_AVATARS) {
                  await api.equipItem('avatar', a).then((c) => patchProfile({ avatar: c.equipped.avatar })).catch((e) => toast(errorText(e), 'bad'));
                } else await update({ avatar: a }).catch(() => {});
                setAvatarOpen(false);
              }}
            >
              <Avatar avatar={a} size={56} />
            </button>
          ))}
        </div>
      </Sheet>
      <EditSheet open={editOpen} onClose={() => setEditOpen(false)} onSave={update} />
      <DeleteSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} onDeleted={signOut} />
      <PasswordSheet open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </Screen>
  );
}

const reasonKeys: Record<string, true> = Object.fromEntries(
  ['signup_bonus', 'solo', 'streak', 'daily_rank', 'mock', 'achievement', 'level_up', 'referral', 'refill', 'room_stake', 'room_win', 'powerup', 'shield', 'report_reward'].map((r) => [`reason.${r}`, true]),
);

function EditSheet({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (c: Record<string, unknown>) => Promise<void> }) {
  const { t, lang } = useI18n();
  const { profile } = useSession();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [district, setDistrict] = useState(profile?.district ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={t('profile.edit')}>
      <div className="space-y-3">
        <Field label={t('onb.name')}>
          <input className={inputClass} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('onb.username')} hint={t('onb.usernameHint')}>
          <input className={inputClass} value={username} maxLength={20} autoCapitalize="none" onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
        </Field>
        <Field label={t('onb.district')}>
          <select className={inputClass} value={district} onChange={(e) => setDistrict(e.target.value)}>
            {DISTRICTS.map((d) => (
              <option key={d.key} value={d.key}>
                {lang === 'ta' ? d.ta : d.key}
              </option>
            ))}
          </select>
        </Field>
        <Button
          block
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({ display_name: name, username, district });
              onClose();
            } catch {
              /* toast shown */
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('common.save')}
        </Button>
      </div>
    </Sheet>
  );
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={t('profile.changePassword')}>
      <Field label={t('profile.newPassword')}>
        <input type="password" autoComplete="new-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button
        block
        className="mt-3"
        disabled={password.length < 8}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          const { error } = await (await sb()).auth.updateUser({ password });
          setBusy(false);
          if (error) toast(error.message, 'bad');
          else {
            toast(t('profile.passwordChanged'), 'ok');
            setPassword('');
            onClose();
          }
        }}
      >
        {t('common.save')}
      </Button>
    </Sheet>
  );
}

function DeleteSheet({ open, onClose, onDeleted }: { open: boolean; onClose: () => void; onDeleted: () => Promise<void> }) {
  const { t, errorText } = useI18n();
  const toast = useToast();
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={t('profile.delete')}>
      <p className="text-sm">{t('profile.deleteConfirm')}</p>
      <input className={`${inputClass} mt-3`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
      <Button
        block
        variant="danger"
        className="mt-3"
        disabled={confirmText !== 'DELETE'}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.deleteAccount();
            localStorage.clear();
            await onDeleted();
          } catch (e) {
            toast(errorText(e), 'bad');
            setBusy(false);
          }
        }}
      >
        {t('profile.delete')}
      </Button>
    </Sheet>
  );
}
