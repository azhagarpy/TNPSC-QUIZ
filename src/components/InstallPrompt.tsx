import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { setPrefs, usePrefs } from '../lib/prefs';
import { canInstall, isIos, onInstallChange, promptInstall } from '../lib/platform';
import { Button } from './ui';

/** Shown after the first finished set or match, never on first visit (plan: PWA install). */
export function InstallPrompt() {
  const { t } = useI18n();
  const prefs = usePrefs();
  const [available, setAvailable] = useState(canInstall);
  useEffect(() => onInstallChange(() => setAvailable(canInstall())), []);
  if (!available || !prefs.finishedFirst || prefs.installDismissed) return null;
  return (
    <div className="panel anim-rise !border-[var(--blue)] p-4">
      <p className="font-display text-lg font-bold">📲 {t('install.title')}</p>
      <p className="mt-1 text-sm">{isIos() ? t('install.ios') : t('install.body')}</p>
      <div className="mt-3 flex gap-2">
        {!isIos() && (
          <Button variant="accent" size="sm" onClick={() => void promptInstall()}>
            {t('install.btn')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setPrefs({ installDismissed: true })}>
          {t('install.later')}
        </Button>
      </div>
    </div>
  );
}
