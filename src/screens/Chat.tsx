import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useChannel } from '../lib/realtime';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import type { ChatMessage, PublicUser } from '../lib/types';
import { REACTIONS } from '../lib/units';
import { Avatar, Button, ErrorBox, Loading, Screen, Sheet, cx, inputClass, useToast } from '../components/ui';

// 1:1 friend chat: text + emoji + room invites, typing indicator, read receipts.
export default function Chat({ params }: { params: Record<string, string> }) {
  const peer = params.id;
  const { t, errorText } = useI18n();
  const { userId } = useSession();
  const { navigate } = useRouter();
  const toast = useToast();
  const me = userId!;
  const [user, setUser] = useState<PublicUser | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastTypingSent = useRef(0);
  const topic = `dm:${[me, peer].sort().join(':')}`;

  useEffect(() => {
    api.publicProfile(peer).then(setUser).catch((e) => setError(errorText(e)));
    api
      .dmHistory(peer)
      .then((m) => {
        setMsgs(m);
        void api.markDmRead(peer).catch(() => {});
      })
      .catch((e) => setError(errorText(e)));
  }, [peer, errorText]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [msgs?.length, typing]);

  const channel = useChannel(topic, ['dm', 'typing', 'read'], (event, p) => {
    if (event === 'dm') {
      const m = p as unknown as ChatMessage;
      setMsgs((xs) => (xs && !xs.some((x) => x.id === m.id) ? [...xs, m] : xs));
      if (m.sender_id === peer) {
        setTyping(false);
        void api.markDmRead(peer).catch(() => {});
      }
    } else if (event === 'typing' && p.user_id === peer) {
      setTyping(true);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 3000);
    } else if (event === 'read' && p.reader === peer) {
      setMsgs((xs) => xs?.map((m) => (m.sender_id === me && !m.read_at ? { ...m, read_at: String(p.at) } : m)) ?? xs);
    }
  });

  const send = async (body: string) => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const m = await api.sendDm(peer, body.trim());
      setMsgs((xs) => (xs && !xs.some((x) => x.id === m.id) ? [...xs, m] : xs));
      setText('');
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const lastMineRead = [...(msgs ?? [])].reverse().find((m) => m.sender_id === me);

  return (
    <Screen
      title={
        user ? (
          <span className="flex items-center gap-2">
            <Avatar avatar={user.avatar} frame={user.frame} size={32} /> <span className="truncate">{user.name}</span>
          </span>
        ) : (
          ''
        )
      }
      back="/friends"
      right={
        <button aria-label="menu" className="btn-round" onClick={() => setMenu(true)}>
          ⋯
        </button>
      }
      footer={
        <div className="space-y-2">
          <div className="flex gap-1 overflow-x-auto">
            {REACTIONS.slice(0, 8).map((e) => (
              <button key={e} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-line bg-chip text-xl shadow-[0_3px_0_rgb(0_0_0/0.2)] active:translate-y-0.5" onClick={() => void send(e)}>
                {e}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <input
              className={inputClass}
              value={text}
              maxLength={200}
              placeholder={t('chat.placeholder')}
              onChange={(e) => {
                setText(e.target.value);
                if (Date.now() - lastTypingSent.current > 2000) {
                  lastTypingSent.current = Date.now();
                  channel.send('typing', { user_id: me });
                }
              }}
            />
            <Button type="submit" loading={busy} disabled={!text.trim()}>
              {t('chat.send')}
            </Button>
          </form>
          <p className="text-right text-xs text-muted">{text.length}/200</p>
        </div>
      }
    >
      {error && <ErrorBox text={error} />}
      {!msgs && !error && <Loading />}
      {msgs && (
        <div className="flex flex-col gap-2">
          {msgs.length === 0 && <p className="py-10 text-center text-muted">{t('chat.empty')}</p>}
          {msgs.map((m) => {
            const mine = m.sender_id === me;
            if (m.kind === 'invite' && m.meta) {
              return (
                <div key={m.id} className={cx('panel max-w-[80%] !border-gold p-3', mine ? 'self-end' : 'self-start')}>
                  <p className="text-sm font-bold">⚔️ {t('chat.invite', { stake: m.meta.stake, size: m.meta.size })}</p>
                  <p className="font-display text-2xl font-extrabold tracking-widest">{m.meta.code}</p>
                  {!mine && (
                    <Button size="sm" variant="gold" className="mt-2" onClick={() => navigate(`/r/${m.meta!.code}`)}>
                      {t('chat.join')}
                    </Button>
                  )}
                </div>
              );
            }
            return (
              <div key={m.id} className={cx('tamil-wrap max-w-[80%] rounded-2xl px-3 py-2', mine ? 'self-end bg-brand text-brand-ink' : 'self-start bg-surface shadow-card')}>
                {m.body}
              </div>
            );
          })}
          {lastMineRead?.read_at && <p className="self-end text-xs text-muted">✓✓ {t('chat.seen')}</p>}
          {typing && <p className="self-start text-sm italic text-muted">{t('chat.typing')}</p>}
          <div ref={bottom} />
        </div>
      )}
      <Sheet open={menu} onClose={() => setMenu(false)} title={user?.name ?? ''}>
        <div className="grid gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await api.reportUser(peer, 'abuse');
                toast(t('chat.reported'), 'ok');
              } catch (e) {
                toast(errorText(e), 'bad');
              }
              setMenu(false);
            }}
          >
            {t('chat.report')}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api.blockUser(peer);
                navigate('/friends', { replace: true });
              } catch (e) {
                toast(errorText(e), 'bad');
              }
            }}
          >
            {t('chat.block')}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
