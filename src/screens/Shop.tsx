import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { EMOJI_PACKS, THEMES } from '../lib/cosmetics';
import { fx } from '../lib/feedback';
import { useI18n } from '../lib/i18n';
import { setOwned } from '../lib/owned';
import { useSession } from '../lib/session';
import { isDemo } from '../lib/supabase';
import { track } from '../lib/telemetry';
import type { ShopCatalog, ShopItem, ShopKind } from '../lib/types';
import { Avatar, Button, Coin, CoinChip, Empty, ErrorBox, Loading, Screen, Segmented, cx, useToast } from '../components/ui';

// Cosmetics shop: avatars, frames, emoji packs and room themes, paid with
// game coins only (plan: coin sinks).
export default function Shop() {
  const { t, lang, errorText } = useI18n();
  const { profile, refresh, patchProfile } = useSession();
  const toast = useToast();
  const [cat, setCat] = useState<ShopCatalog | null>(null);
  const [kind, setKind] = useState<ShopKind>('frame');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const apply = useCallback(
    (c: ShopCatalog) => {
      setCat(c);
      setOwned(c.items.filter((i) => i.owned).map((i) => i.key));
      patchProfile({ avatar: c.equipped.avatar, frame: c.equipped.frame, theme: c.equipped.theme });
    },
    [patchProfile],
  );

  useEffect(() => {
    if (!isDemo) api.shopCatalog().then(apply).catch((e) => setError(errorText(e)));
  }, [apply, errorText]);

  if (isDemo) {
    return (
      <Screen title={t('shop.title')} back="/profile">
        <Empty icon="🛍️">{t('common.needsServer')}</Empty>
      </Screen>
    );
  }

  const name = (i: ShopItem) => (lang === 'ta' ? i.name_ta : i.name_en);
  const equipped = (i: ShopItem) =>
    (i.kind === 'avatar' && cat?.equipped.avatar === i.key) ||
    (i.kind === 'frame' && cat?.equipped.frame === i.key) ||
    (i.kind === 'theme' && cat?.equipped.theme === i.key);

  const act = async (key: string, fn: () => Promise<ShopCatalog>, done?: string) => {
    setBusy(key);
    try {
      apply(await fn());
      if (done) {
        fx.coin();
        toast(done, 'coin');
      }
      void refresh();
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title={t('shop.title')} back="/profile" right={cat && <CoinChip value={cat.balance} className="mr-2" />}>
      <div className="space-y-4">
        <p className="glass p-3 text-xs text-muted">🪙 {t('shop.note')}</p>
        <Segmented
          small
          value={kind}
          onChange={setKind}
          options={(['frame', 'avatar', 'emoji_pack', 'theme'] as const).map((k) => ({ value: k, label: t(`shop.${k}`) }))}
        />
        {error && <ErrorBox text={error} />}
        {!cat && !error && <Loading />}
        {cat && (
          <div className="grid grid-cols-2 gap-3">
            {cat.items
              .filter((i) => i.kind === kind)
              .map((i) => {
                const locked = cat.level < i.min_level;
                return (
                  <div key={i.key} className={cx('panel relative flex flex-col items-center p-3 text-center', equipped(i) && '!border-[var(--blue)]')}>
                    {equipped(i) && (
                      <span className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-blue font-bold text-white shadow-[0_2px_0_var(--blue-lip)]" aria-hidden>
                        ✓
                      </span>
                    )}
                    <div className="grid min-h-20 w-full place-items-center rounded-2xl bg-[radial-gradient(circle,rgb(255_198_41/0.35),transparent_70%)] py-1">
                      <Preview item={i} avatar={profile?.avatar ?? 'a1'} />
                    </div>
                    <p className="mt-2 font-display font-bold leading-tight">{name(i)}</p>
                    {i.kind === 'emoji_pack' && <p className="text-xs text-muted">{t('shop.packHint')}</p>}
                    {i.kind === 'theme' && <p className="text-xs text-muted">{t('shop.themeHint')}</p>}
                    <div className="mt-auto w-full pt-2">
                      {!i.owned ? (
                        <Button
                          size="sm"
                          block
                          variant="gold"
                          disabled={locked || cat.balance < i.price}
                          loading={busy === i.key}
                          onClick={() => {
                            if (!confirm(t('shop.confirm', { name: name(i), price: i.price }))) return;
                            track('shop_buy', { item: i.key, price: i.price });
                            void act(i.key, () => api.buyItem(i.key), t('shop.bought', { name: name(i) }));
                          }}
                        >
                          {locked ? `🔒 ${t('shop.locked', { n: i.min_level })}` : (
                            <span className="inline-flex items-center gap-1">
                              <Coin size={14} /> {i.price}
                            </span>
                          )}
                        </Button>
                      ) : i.kind === 'emoji_pack' ? (
                        <p className="text-sm font-semibold text-ok">✓ {t('shop.owned')}</p>
                      ) : equipped(i) ? (
                        <Button
                          size="sm"
                          block
                          variant="secondary"
                          loading={busy === i.key}
                          disabled={i.kind === 'avatar'}
                          onClick={() => void act(i.key, () => api.equipItem(i.kind, null))}
                        >
                          {i.kind === 'avatar' ? `✓ ${t('shop.equipped')}` : t('shop.remove')}
                        </Button>
                      ) : (
                        <Button size="sm" block loading={busy === i.key} onClick={() => void act(i.key, () => api.equipItem(i.kind, i.key))}>
                          {t('shop.equip')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </Screen>
  );
}

function Preview({ item, avatar }: { item: ShopItem; avatar: string }) {
  if (item.kind === 'avatar') return <Avatar avatar={item.key} size={64} />;
  if (item.kind === 'frame') return <Avatar avatar={avatar} size={56} frame={item.key} />;
  if (item.kind === 'emoji_pack') {
    return (
      <div className="grid grid-cols-4 gap-1 text-2xl" aria-hidden>
        {EMOJI_PACKS[item.key]?.map((e) => (
          <span key={e}>{e}</span>
        ))}
      </div>
    );
  }
  return <div className="h-16 w-full rounded-2xl border border-line bg-surface-2" style={{ backgroundImage: THEMES[item.key]?.background }} aria-hidden />;
}
