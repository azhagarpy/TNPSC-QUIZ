import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import { Button } from '../components/ui';
import SoloSetup from './SoloSetup';

/** Signed in but the server is unreachable and nothing is cached: offer offline practice. */
export default function OfflineHome() {
  const { t } = useI18n();
  const { refresh } = useSession();
  return (
    <div>
      <div className="mx-auto max-w-md px-4 pt-4">
        <div className="glass flex items-center justify-between gap-3 !border-[var(--red)] p-3">
          <span className="text-sm font-semibold">📴 {t('common.offline')}</span>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      </div>
      <SoloSetup />
    </div>
  );
}
