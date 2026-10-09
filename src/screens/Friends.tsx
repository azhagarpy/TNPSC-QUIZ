import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { whatsappUrl } from '../lib/platform';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import { isDemo } from '../lib/supabase';
import type { FriendsList, PublicUser } from '../lib/types';
import { districtName } from '../lib/units';
import { Avatar, Button, Empty, ErrorBox, Loading, Screen, Segmented, Sheet, inputClass, useToast } from '../components/ui';

type Tab = 'friends' | 'requests' | 'find';

// Screen 12: friends list, requests, search by username.
export default function Friends() {
  const { t, lang, errorText } = useI18n();
  const { profile } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('friends');
  const [data, setData] = useState<FriendsList | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(PublicUser & { friend_status: string | null })[]>([]);
  const [selected, setSelected] = useState<PublicUser | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.listFriends());
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  }, [errorText]);

  useEffect(() => {
    if (!isDemo) void load();
  }, [load]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(() => {
      api.searchUsers(q).then(setResults).catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };

  if (isDemo) {
    return (
      <Screen title={t('friends.title')} nav>
        <Empty icon="👥">{t('common.needsServer')}</Empty>
      </Screen>
    );
  }

  const inviteLink = `${window.location.origin}/?ref=${profile?.username ?? ''}`;
  const requests = (data?.incoming.length ?? 0);

  return (
    <Screen title={t('friends.title')} nav>
      <div className="space-y-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'friends', label: t('friends.tabFriends') },
            { value: 'requests', label: requests ? `${t('friends.tabRequests')} (${requests})` : t('friends.tabRequests') },
            { value: 'find', label: t('friends.tabFind') },
          ]}
        />
        {error && <ErrorBox text={error} onRetry={load} />}
        {!data && !error && <Loading />}

        {data && tab === 'friends' && (
          <>
            {data.friends.length === 0 ? (
              <Empty icon="👋">{t('friends.none')}</Empty>
            ) : (
              <ul className="space-y-2">
                {data.friends.map((f) => (
                  <li key={f.id}>
                    <button className="flex w-full items-center gap-3 rounded-2xl bg-surface p-2 text-left shadow-card" onClick={() => setSelected(f)}>
                      <Avatar avatar={f.avatar} frame={f.frame} size={44} ring={f.online ? 'var(--ok)' : undefined} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{f.name}</p>
                        <p className="truncate text-xs text-muted">
                          @{f.username} · {t('common.level', { n: f.level })} · {t('home.weekXp', { xp: f.week_xp })}
                        </p>
                      </div>
                      {f.unread > 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-brand px-1.5 text-xs font-bold text-brand-ink">{f.unread}</span>}
                      <span className="text-xs font-semibold text-ok">{f.online ? `● ${t('friends.online')}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <a
              href={whatsappUrl(`${t('friends.inviteText', { username: profile?.username ?? '' })} ${inviteLink}`)}
              target="_blank"
              rel="noopener"
              className="flex min-h-12 items-center justify-center rounded-2xl bg-[#25D366] font-semibold text-white"
            >
              {t('friends.inviteWa')}
            </a>
          </>
        )}

        {data && tab === 'requests' && (
          <div className="space-y-4">
            {data.incoming.length === 0 && data.outgoing.length === 0 && <Empty icon="📭">{t('friends.noRequests')}</Empty>}
            {data.incoming.map((u) => (
              <div key={u.id} className="flex items-center gap-3 rounded-2xl bg-surface p-2 shadow-card">
                <Avatar avatar={u.avatar} frame={u.frame} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{u.name}</p>
                  <p className="text-xs text-muted">{t('friends.incoming')}</p>
                </div>
                <Button size="sm" onClick={() => void run(() => api.respondFriend(u.id, true))}>
                  {t('friends.accept')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void run(() => api.respondFriend(u.id, false))}>
                  ✕
                </Button>
              </div>
            ))}
            {data.outgoing.length > 0 && <h3 className="text-sm font-bold text-muted">{t('friends.outgoing')}</h3>}
            {data.outgoing.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-2">
                <Avatar avatar={u.avatar} frame={u.frame} size={32} />
                <span className="flex-1 truncate">{u.name}</span>
                <span className="text-xs text-muted">{t('friends.requested')}</span>
              </div>
            ))}
            {data.blocked.length > 0 && <h3 className="text-sm font-bold text-muted">{t('friends.blocked')}</h3>}
            {data.blocked.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-2">
                <Avatar avatar={u.avatar} frame={u.frame} size={32} dim />
                <span className="flex-1 truncate">{u.name}</span>
                <Button size="sm" variant="ghost" onClick={() => void run(() => api.unblockUser(u.id))}>
                  {t('friends.unblock')}
                </Button>
              </div>
            ))}
          </div>
        )}

        {tab === 'find' && (
          <div className="space-y-3">
            <input className={inputClass} placeholder={t('friends.search')} value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="none" />
            <ul className="space-y-2">
              {results.map((u) => (
                <li key={u.id} className="flex items-center gap-3 rounded-2xl bg-surface p-2 shadow-card">
                  <Avatar avatar={u.avatar} frame={u.frame} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{u.name}</p>
                    <p className="truncate text-xs text-muted">
                      @{u.username} · {districtName(u.district, lang)}
                    </p>
                  </div>
                  {u.friend_status === 'friends' ? (
                    <span className="text-xs font-semibold text-ok">✓ {t('friends.isFriend')}</span>
                  ) : u.friend_status === 'outgoing' ? (
                    <span className="text-xs text-muted">{t('friends.requested')}</span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() =>
                        void run(async () => {
                          const s = await api.friendRequest(u.id);
                          setResults((xs) => xs.map((x) => (x.id === u.id ? { ...x, friend_status: s } : x)));
                        })
                      }
                    >
                      + {u.friend_status === 'incoming' ? t('friends.accept') : t('friends.add')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <FriendSheet user={selected} onClose={() => setSelected(null)} onChanged={load} onChat={(id) => navigate(`/chat/${id}`)} />
    </Screen>
  );
}

function FriendSheet({ user, onClose, onChanged, onChat }: { user: PublicUser | null; onClose: () => void; onChanged: () => void; onChat: (id: string) => void }) {
  const { t, lang, errorText } = useI18n();
  const toast = useToast();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.publicProfile>> | null>(null);
  useEffect(() => {
    setDetail(null);
    if (user) api.publicProfile(user.id).then(setDetail).catch(() => {});
  }, [user]);
  if (!user) return null;
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
      onClose();
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };
  return (
    <Sheet open onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <Avatar avatar={user.avatar} frame={user.frame} size={72} />
        <p className="mt-2 text-lg font-bold">{user.name}</p>
        <p className="text-sm text-muted">
          @{user.username} · {districtName(user.district, lang)} · {t('common.level', { n: user.level })}
        </p>
        {detail && (
          <>
            <p className="mt-2 text-2xl">{detail.badges.join(' ')}</p>
            {detail.head_to_head.played > 0 && (
              <p className="mt-1 text-sm font-semibold">
                {t('friends.h2h', { w: detail.head_to_head.my_wins, l: detail.head_to_head.played - detail.head_to_head.my_wins })}
              </p>
            )}
            {detail.room_win_streak >= 2 && <p className="text-sm">🔥 × {detail.room_win_streak}</p>}
          </>
        )}
      </div>
      <div className="mt-4 grid gap-2">
        <Button onClick={() => onChat(user.id)}>💬 {t('friends.chat')}</Button>
        <Button variant="secondary" onClick={() => void act(() => api.removeFriend(user.id))}>
          {t('friends.remove')}
        </Button>
        <Button variant="danger" onClick={() => void act(() => api.blockUser(user.id))}>
          {t('chat.block')}
        </Button>
      </div>
    </Sheet>
  );
}
