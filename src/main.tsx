import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/noto-sans-tamil/tamil-400.css';
import '@fontsource/noto-sans-tamil/tamil-600.css';
import '@fontsource/noto-sans-tamil/tamil-700.css';
import '@fontsource/noto-sans-tamil/latin-400.css';
import '@fontsource/noto-sans-tamil/latin-600.css';
import '@fontsource/noto-sans-tamil/latin-700.css';
import './index.css';
import App from './App';
import { captureInstallPrompt } from './lib/platform';
import { measureTierOnce } from './lib/device';
import { initTelemetry } from './lib/telemetry';

captureInstallPrompt();
initTelemetry();

// Referral links: /?ref=username (credited after the friend finishes 3 room matches).
const ref = new URLSearchParams(window.location.search).get('ref');
if (ref && /^[a-z0-9_]{3,20}$/i.test(ref)) localStorage.setItem('g4.ref', ref.toLowerCase());
registerSW({ immediate: true });

// Decide the 3D tier once, when the phone is idle (never during first paint).
const idle = (cb: () => void) =>
  'requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 5000 }) : setTimeout(cb, 3000);
idle(() => void measureTierOnce());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
