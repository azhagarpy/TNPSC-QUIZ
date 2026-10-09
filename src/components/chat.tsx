import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { setPrefs, usePrefs } from '../lib/prefs';
import { PHRASES, REACTIONS } from '../lib/units';
import { ALL_PACK_EMOJIS } from '../lib/cosmetics';
import { useOwnedEmojis } from '../lib/owned';
import { Avatar, Button, Sheet, cx, inputClass, useToast } from './ui';

export interface ChatItem {
  key: string;
  kind: 'text' | 'phrase';
  userId: string;
  name: string;
  avatar: string;
  body: string; // text, or phrase id
  messageId?: number;
  at?: number; // local receive time (quick phrases fade after a few seconds)
}

export function ReactionBar({ onReact, disabled }: { onReact: (e: string) => void; disabled?: boolean }) {
  const extra = useOwnedEmojis(); // emoji packs bought in the shop
  return (
    <div className="flex gap-1 overflow-x-auto pb-1" role="toolbar" aria-label="reactions">
      {[...REACTIONS, ...extra].map((e) => (
        <button
          key={e}
          disabled={disabled}
          onClick={() => onReact(e)}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-2xl transition active:scale-90 disabled:opacity-40"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

export function PhraseBar({ onPhrase }: { onPhrase: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {PHRASES.map((p) => (
        <button key={p} onClick={() => onPhrase(p)} className="min-h-10 shrink-0 rounded-full border border-line bg-surface px-3 text-sm font-semibold">
          {t(`phrase.${p}`)}
        </button>
      ))}
    </div>
  );
}

/** Emoji that float up over a player's avatar. */
export function useFloatingReactions() {
  const [items, setItems] = useState<{ id: number; userId: string; emoji: string }[]>([]);
  const add = (userId: string, emoji: string) => {
    if (!REACTIONS.includes(emoji) && !ALL_PACK_EMOJIS.includes(emoji)) return; // only known emoji are ever shown
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-12), { id, userId, emoji }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 1600);
  };
  const forUser = (userId: string) => items.filter((x) => x.userId === userId);
  return { add, forUser };
}

export function FloatingEmoji({ emojis }: { emojis: { id: number; emoji: string }[] }) {
  return (
    <span className="pointer-events-none absolute inset-x-0 -top-2 flex justify-center" aria-hidden>
      {emojis.map((x) => (
        <span key={x.id} className="absolute text-2xl" style={{ animation: 'float-up 1.5s ease-out forwards' }}>
          {x.emoji}
        </span>
      ))}
    </span>
  );
}

export function ChatLog({ items, me, roomId }: { items: ChatItem[]; me: string; roomId?: string }) {
  const { t } = useI18n();
  const prefs = usePrefs();
  const bottom = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<ChatItem | null>(null);
  const visible = items.filter((m) => !prefs.mutedUsers.includes(m.userId));

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [visible.length]);

  return (
    <div className="flex max-h-60 min-h-24 flex-col gap-2 overflow-y-auto rounded-2xl bg-surface-2 p-3" aria-live="polite">
      {visible.length === 0 && <p className="m-auto text-sm text-muted">{t('chat.empty')}</p>}
      {visible.map((m) => (
        <div key={m.key} className={cx('flex items-end gap-2', m.userId === me && 'flex-row-reverse')}>
          <Avatar avatar={m.avatar} size={28} />
          <button
            onClick={() => m.userId !== me && setMenu(m)}
            className={cx(
              'tamil-wrap max-w-[75%] rounded-2xl px-3 py-2 text-left text-sm',
              m.userId === me ? 'bg-brand text-brand-ink' : 'bg-surface',
              m.kind === 'phrase' && 'italic',
            )}
          >
            {m.userId !== me && <span className="block text-xs font-bold opacity-70">{m.name}</span>}
            {m.kind === 'phrase' ? t(`phrase.${m.body as (typeof PHRASES)[number]}`) : m.body}
          </button>
        </div>
      ))}
      <div ref={bottom} />
      <MessageActions item={menu} onClose={() => setMenu(null)} roomId={roomId} />
    </div>
  );
}

export function MessageActions({ item, onClose }: { item: ChatItem | null; onClose: () => void; roomId?: string }) {
  const { t, errorText } = useI18n();
  const toast = useToast();
  const prefs = usePrefs();
  if (!item) return null;
  const muted = prefs.mutedUsers.includes(item.userId);
  return (
    <Sheet open onClose={onClose} title={item.name}>
      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setPrefs({ mutedUsers: muted ? prefs.mutedUsers.filter((u) => u !== item.userId) : [...prefs.mutedUsers, item.userId] });
            onClose();
          }}
        >
          {muted ? t('chat.unmute') : t('chat.mute')}
        </Button>
        {item.messageId && (
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await api.reportMessage(item.messageId!, 'abuse');
                toast(t('chat.reported'), 'ok');
              } catch (e) {
                toast(errorText(e), 'bad');
              }
              onClose();
            }}
          >
            {t('chat.report')}
          </Button>
        )}
        <Button
          variant="danger"
          onClick={async () => {
            try {
              await api.blockUser(item.userId);
              setPrefs({ mutedUsers: [...new Set([...prefs.mutedUsers, item.userId])] });
            } catch (e) {
              toast(errorText(e), 'bad');
            }
            onClose();
          }}
        >
          {t('chat.block')}
        </Button>
      </div>
    </Sheet>
  );
}

export function ChatInput({ onSend, disabled }: { onSend: (text: string) => Promise<void>; disabled?: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const v = text.trim();
    if (!v) return;
    setBusy(true);
    try {
      await onSend(v);
      setText('');
    } catch {
      // The caller already showed why (e.g. a blocked link); keep the text to edit.
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        className={inputClass}
        value={text}
        maxLength={200}
        disabled={disabled}
        placeholder={t('chat.placeholder')}
        onChange={(e) => setText(e.target.value)}
        enterKeyHint="send"
      />
      <Button type="submit" loading={busy} disabled={disabled || !text.trim()} className="shrink-0">
        {t('chat.send')}
      </Button>
    </form>
  );
}
