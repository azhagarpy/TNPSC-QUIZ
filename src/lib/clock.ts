// Server clock offset. Match schedules, deadlines and countdowns come from the
// database clock; the phone only converts them to local time for display.

let offset = 0;
let bestRtt = Number.POSITIVE_INFINITY;

export function syncClock(serverIso: string | undefined | null, sentAt: number, receivedAt: number) {
  if (!serverIso) return;
  const server = Date.parse(serverIso);
  if (Number.isNaN(server)) return;
  const rtt = Math.max(0, receivedAt - sentAt);
  const estimate = server + rtt / 2 - receivedAt;
  // Trust low-latency samples most; drift slowly otherwise.
  if (rtt <= bestRtt * 1.5) {
    bestRtt = Math.min(bestRtt, rtt);
    offset = bestRtt === rtt ? estimate : offset * 0.7 + estimate * 0.3;
  }
}

export const serverNow = () => Date.now() + offset;

/** Converts a server timestamp to local epoch ms. */
export const toLocal = (iso: string | null | undefined) => (iso ? Date.parse(iso) - offset : 0);
