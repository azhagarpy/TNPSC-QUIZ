import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { roomLink, shareOrWhatsapp, whatsappUrl } from '../lib/platform';
import { useChannel } from '../lib/realtime';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import type { ChatMessage, FriendRow, RoomState } from '../lib/types';
import { unitName } from '../lib/units';
import { ChatInput, ChatLog, FloatingEmoji, PhraseBar, ReactionBar, useFloatingReactions, type ChatItem } from '../components/chat';
import { TableScene } from '../components/scenes';
import { useRoomCosmetics } from '../lib/cosmeticsHook';
import { track } from '../lib/telemetry';
import { Avatar, Button, Card, ErrorBox, Loading, Screen, Sheet, cx, useToast } from '../components/ui';

export function messageToItem(m: ChatMessage): ChatItem {
  return { key: `m${m.id}`, kind: 'text', userId: m.sender_id, name: m.sender_name ?? '', avatar: m.sender_avatar ?? 'a1', body: m.body, messageId: m.id };
}

/** Room chat + reactions over a room channel; shared by the lobby and the result screen. */
export function useRoomChat(roomId: string | null, me: string, onEvent: (event: string, p: Record<string, unknown>) => void) {
  const [chat, setChat] = useState<ChatItem[]>([]);
  const reactions = useFloatingReactions();
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!roomId) return;
    api.roomChatHistory(roomId).then((h) => setChat(h.map(messageToItem))).catch(() => {});
  }, [roomId]);

  const channel = useChannel(
    roomId ? `room:${roomId}` : null,
    ['lobby', 'match_started', 'match_settled', 'chat', 'emoji', 'phrase', 'answered', 'phase'],
    (event, p) => {
      if (event === 'chat') {
        const m = p as unknown as ChatMessage;
        setChat((xs) => (xs.some((x) => x.key === `m${m.id}`) ? xs : [...xs.slice(-60), messageToItem(m)]));
      } else if (event === 'emoji') {
        reactions.add(String(p.user_id), String(p.emoji));
      } else if (event === 'phrase') {
        setChat((xs) => [...xs.slice(-60), { key: `p${Date.now()}${Math.random()}`, kind: 'phrase', userId: String(p.user_id), name: String(p.name ?? ''), avatar: String(p.avatar ?? 'a1'), body: String(p.id), at: Date.now() }]);
      }
      handler.current(event, p);
    },
    me,
  );

  const react = (emoji: string) => {
    reactions.add(me, emoji);
    channel.send('emoji', { user_id: me, emoji });
  };
  const phrase = (id: string, name: string, avatar: string) => {
    setChat((xs) => [...xs.slice(-60), { key: `p${Date.now()}`, kind: 'phrase', userId: me, name, avatar, body: id, at: Date.now() }]);
    channel.send('phrase', { user_id: me, name, avatar, id });
  };
  const sendText = async (body: string) => {
    if (!roomId) return;
    const m = await api.sendRoomChat(roomId, body);
    setChat((xs) => (xs.some((x) => x.key === `m${m.id}`) ? xs : [...xs.slice(-60), messageToItem(m)]));
  };
  return { chat, reactions, react, phrase, sendText, present: channel.present, connected: channel.connected };
}

// Screen 9: room code, WhatsApp share, seats, Ready, chat.
export default function Lobby({ params }: { params: Record<string, string> }) {
  const code = params.code.toUpperCase();
  const { t, lang, errorText } = useI18n();
  const { profile, userId } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const me = userId!;

  const apply = useCallback(
    (r: RoomState) => {
      setRoom(r);
      if (r.status === 'playing' && r.current_match_status === 'live' && r.current_match_id) {
        navigate(`/m/${r.current_match_id}`, { replace: true });
      }
    },
    [navigate],
  );

  useEffect(() => {
    api.joinRoom(code).then(apply).catch((e) => setError(errorText(e)));
  }, [code, apply, errorText]);

  const { chat, reactions, react, phrase, sendText, present } = useRoomChat(room?.id ?? null, me, (event, p) => {
    if (event === 'lobby' && room) api.getRoom(room.id).then(apply).catch(() => {});
    if (event === 'match_started') navigate(`/m/${String(p.match_id)}`, { replace: true });
  });

  // Heartbeat keeps the seat and passes hosting on if the host drops for 30 s.
  useEffect(() => {
    if (!room?.id) return;
    const id = setInterval(() => {
      api.heartbeat(room.id).then(apply).catch(() => {});
    }, 15_000);
    return () => clearInterval(id);
  }, [room?.id, apply]);

  const { frames, backdrop } = useRoomCosmetics(room?.players.map((p) => p.user_id) ?? [], room?.id);

  if (error) {
    return (
      <Screen title={t('room.code') + ' ' + code} back="/">
        <ErrorBox text={error} onRetry={() => navigate('/', { replace: true })} />
      </Screen>
    );
  }
  if (!room || !profile) return <Loading />;

  const meP = room.players.find((p) => p.user_id === me);
  const isHost = room.host_id === me;
  const everyoneReady = room.players.length >= 2 && room.players.every((p) => p.ready);
  const link = roomLink(room.code);
  const shareText = t('room.shareText', { code: room.code, stake: room.stake });

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={`${t('room.code')} ${room.code}`}
      back="/"
      backdrop={backdrop}
      footer={
        <div className="grid gap-2">
          {isHost ? (
            <Button block size="lg" variant="gold" disabled={!everyoneReady} loading={busy} onClick={() =>
                void act(async () => {
                  const { match_id } = await api.startMatch(room.id);
                  track('match_started', { players: room.players.length, stake: room.stake, size: room.size });
                  navigate(`/m/${match_id}`, { replace: true });
                })
              }>
              ▶ {t('room.start')}
            </Button>
          ) : (
            <Button block size="lg" variant={meP?.ready ? 'secondary' : 'primary'} loading={busy} onClick={() => void act(async () => apply(await api.setReady(room.id, !meP?.ready)))}>
              {meP?.ready ? t('room.cancelReady') : `✓ ${t('room.imReady')}`}
            </Button>
          )}
          {isHost && !everyoneReady && <p className="text-center text-xs text-muted">{t('room.startHint')}</p>}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Code and sharing */}
        <Card className="text-center">
          <p className="font-display text-sm font-bold text-muted">{t('room.code')}</p>
          <p className="mt-1 flex justify-center gap-1.5" aria-label={room.code}>
            {room.code.split('').map((ch, i) => (
              <span
                key={i}
                className="grid h-13 w-10 place-items-center rounded-xl border-2 border-line bg-chip font-display text-3xl font-extrabold shadow-[inset_0_-3px_0_rgb(0_0_0/0.08)]"
                aria-hidden
              >
                {ch}
              </span>
            ))}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <a href={whatsappUrl(`${shareText} ${link}`)} target="_blank" rel="noopener" className="btn3d btn-green inline-flex min-h-12 items-center justify-center px-2">
              {t('room.shareWa')}
            </a>
            <Button variant="accent" onClick={() => void shareOrWhatsapp(shareText, link)}>
              📤 {t('common.share')}
            </Button>
          </div>
          <button className="mt-2 min-h-11 font-display font-bold text-accent" onClick={() => setInviteOpen(true)}>
            👥 {t('room.inviteFriends')}
          </button>
        </Card>

        <TableScene
          stake={room.stake}
          seats={Array.from({ length: room.size }, (_, seat) => {
            const p = room.players.find((x) => x.seat === seat);
            return { avatar: p?.avatar ?? 'a1', ready: !!p?.ready, present: !!p };
          })}
        />

        {/* Seats */}
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: room.size }, (_, seat) => {
            const p = room.players.find((x) => x.seat === seat);
            if (!p) {
              return (
                <div key={seat} className="grid min-h-32 place-items-center rounded-3xl border-[3px] border-dashed border-line bg-white/5 p-2 text-center font-display text-sm font-bold text-muted">
                  <span>
                    <span className="anim-glow block text-3xl" aria-hidden>
                      ➕
                    </span>
                    {t('room.emptySeat')}
                  </span>
                </div>
              );
            }
            const online = p.online || present.includes(p.user_id);
            return (
              <div key={seat} className={cx('panel relative flex min-h-32 flex-col items-center justify-center p-2', p.ready && '!border-[var(--green)]')}>
                <div className="relative">
                  <FloatingEmoji emojis={reactions.forUser(p.user_id)} />
                  <Avatar avatar={p.avatar} frame={frames[p.user_id]} size={52} dim={!online} />
                  {p.is_host && <span className="absolute -right-2 -top-3 text-xl" title={t('room.host')}>👑</span>}
                </div>
                <p className="mt-1 max-w-full truncate font-display font-bold">{p.name}</p>
                {p.ready ? (
                  <span className="btn3d btn-green anim-pop mt-0.5 px-2.5 py-0.5 text-sm">✓ {t('room.ready')}</span>
                ) : (
                  <p className="text-xs font-semibold text-muted">{online ? t('room.notReady') : t('room.away')}</p>
                )}
                {!p.can_afford && <p className="text-xs font-semibold text-bad">{t('room.cantAfford')}</p>}
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted">
          {room.subject === 'mixed' ? t('solo.mixed') : unitName(room.subject, lang)} · {room.question_count} {t('room.count')} ·{' '}
          {room.language === 'ta' ? 'தமிழ்' : 'English'}
          {room.powerups && ' · 50:50, +10s'}
        </p>
        {room.stake > 0 && (
          <p className="text-center text-xs text-muted">
            {room.size === 2 ? t('room.split2') : room.size === 3 ? t('room.split3') : t('room.split4')} · {t('room.houseCut')}
          </p>
        )}

        {/* Chat */}
        <section className="space-y-2">
          <ReactionBar onReact={react} />
          <PhraseBar onPhrase={(id) => phrase(id, profile.display_name ?? '', profile.avatar)} />
          <ChatLog items={chat} me={me} roomId={room.id} />
          <ChatInput onSend={async (b) => {
            try {
              await sendText(b);
            } catch (e) {
              toast(errorText(e), 'bad');
              throw e;
            }
          }} />
        </section>

        <Button block variant="ghost" onClick={() => void act(async () => {
          await api.leaveRoom(room.id);
          navigate('/', { replace: true });
        })}>
          {t('room.leave')}
        </Button>
      </div>
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} code={room.code} />
    </Screen>
  );
}

function InviteSheet({ open, onClose, code }: { open: boolean; onClose: () => void; code: string }) {
  const { t, errorText } = useI18n();
  const toast = useToast();
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  useEffect(() => {
    if (open) api.listFriends().then((f) => setFriends(f.friends)).catch(() => setFriends([]));
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={t('room.inviteFriends')}>
      {!friends ? (
        <Loading />
      ) : friends.length === 0 ? (
        <p className="text-sm text-muted">{t('friends.none')}</p>
      ) : (
        <ul className="space-y-2">
          {[...friends].sort((a, b) => Number(b.online) - Number(a.online)).map((f) => (
            <li key={f.id} className="flex items-center gap-3">
              <Avatar avatar={f.avatar} size={40} ring={f.online ? 'var(--ok)' : undefined} />
              <span className="flex-1 truncate font-semibold">{f.name}</span>
              <Button
                size="sm"
                variant={sent.includes(f.id) ? 'ghost' : 'primary'}
                disabled={sent.includes(f.id)}
                onClick={async () => {
                  try {
                    await api.sendDm(f.id, code, 'invite');
                    setSent((s) => [...s, f.id]);
                    toast(t('room.invited'), 'ok');
                  } catch (e) {
                    toast(errorText(e), 'bad');
                  }
                }}
              >
                {sent.includes(f.id) ? '✓' : t('room.inviteFriends')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
