import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { isDemo, sb } from './supabase';

// Private Realtime channels ("room:<id>", "dm:<a>:<b>"), authorised by the
// policies on realtime.messages. Opened only on lobby, match and chat screens
// to stay inside the free plan's 200 concurrent connections.

type Handler = (event: string, payload: Record<string, unknown>) => void;

export function useChannel(topic: string | null, events: string[], onEvent: Handler, presenceKey?: string) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [present, setPresent] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const eventsKey = events.join(',');

  useEffect(() => {
    if (!topic || isDemo) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    (async () => {
      const client = await sb();
      await client.realtime.setAuth();
      if (cancelled) return;
      channel = client.channel(topic, {
        config: { private: true, broadcast: { self: false }, presence: presenceKey ? { key: presenceKey } : undefined },
      });
      for (const ev of eventsKey.split(',').filter(Boolean)) {
        channel.on('broadcast', { event: ev }, (msg) => {
          // Server-sent messages wrap the body in `payload`; client broadcasts may not.
          const p = (msg.payload ?? {}) as Record<string, unknown>;
          handlerRef.current(ev, p);
        });
      }
      if (presenceKey) {
        channel.on('presence', { event: 'sync' }, () => {
          setPresent(Object.keys(channel!.presenceState()));
        });
      }
      channel.subscribe(async (status) => {
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED' && presenceKey) await channel!.track({ at: Date.now() });
      });
      channelRef.current = channel;
    })();
    return () => {
      cancelled = true;
      channelRef.current = null;
      setConnected(false);
      if (channel) {
        const ch = channel;
        void sb().then((c) => c.removeChannel(ch));
      }
    };
  }, [topic, eventsKey, presenceKey]);

  const send = (event: string, payload: Record<string, unknown>) => {
    void channelRef.current?.send({ type: 'broadcast', event, payload });
  };

  return { send, present, connected };
}
