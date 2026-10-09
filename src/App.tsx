import { Component, Suspense, lazy, useEffect, type ComponentType, type ReactNode } from 'react';
import { I18nProvider, useI18n } from './lib/i18n';
import { RouterProvider, matchPath, useRouter } from './lib/router';
import { SessionProvider, useSession } from './lib/session';
import { Button, Loading, ToastProvider } from './components/ui';
import { captureError, identify, track } from './lib/telemetry';
import Home from './screens/Home';
import Welcome from './screens/Welcome';

const SoloPlay = lazy(() => import('./screens/SoloPlay'));

// Each screen is its own chunk; Home and sign-in ship in the first load.
const routes: [string, ComponentType<{ params: Record<string, string> }>][] = [
  ['/solo', lazy(() => import('./screens/SoloSetup'))],
  ['/play', SoloPlay],
  ['/daily', lazy(() => import('./screens/Daily'))],
  ['/mock', lazy(() => import('./screens/Mock'))],
  ['/room/new', lazy(() => import('./screens/CreateRoom'))],
  ['/join', lazy(() => import('./screens/JoinRoom'))],
  ['/r/:code', lazy(() => import('./screens/Lobby'))],
  ['/m/:id', lazy(() => import('./screens/LiveMatch'))],
  ['/m/:id/result', lazy(() => import('./screens/MatchResult'))],
  ['/friends', lazy(() => import('./screens/Friends'))],
  ['/chat/:id', lazy(() => import('./screens/Chat'))],
  ['/leaderboard', lazy(() => import('./screens/Leaderboards'))],
  ['/profile', lazy(() => import('./screens/Profile'))],
  ['/admin', lazy(() => import('./screens/Admin'))],
  ['/shop', lazy(() => import('./screens/Shop'))],
  ['/quick', lazy(() => import('./screens/QuickMatch'))],
  ['/bot', lazy(() => import('./screens/BotMatch'))],
];

const Onboarding = lazy(() => import('./screens/Onboarding'));
const DemoQuiz = lazy(() => import('./screens/DemoQuiz'));
const Legal = lazy(() => import('./screens/Legal'));
const OfflineHome = lazy(() => import('./screens/OfflineHome'));

const PENDING = 'g4.pendingPath';

function Gate() {
  const { status, profile, summary, userId } = useSession();
  const { path, navigate } = useRouter();
  const { chosen } = useI18n();

  useEffect(() => identify(userId), [userId]);
  useEffect(() => {
    // Screen views without ids or codes in them (e.g. /r/:code → /r).
    track('screen', { path: path.replace(/\/(r|m|chat)\/[^/]+/, '/$1') });
  }, [path]);

  // Deep links (e.g. a WhatsApp room link) survive sign-in and onboarding.
  useEffect(() => {
    if (path.startsWith('/r/') && (status !== 'ready' || !profile?.signup_bonus_claimed)) {
      localStorage.setItem(PENDING, path);
    }
    if (status === 'ready' && profile?.onboarded && profile.signup_bonus_claimed) {
      const pending = localStorage.getItem(PENDING);
      if (pending) {
        localStorage.removeItem(PENDING);
        if (pending !== path) navigate(pending, { replace: true });
      }
    }
  }, [status, profile?.onboarded, profile?.signup_bonus_claimed, path, navigate]);

  if (path === '/terms' || path === '/privacy') return <Legal params={{ page: path.slice(1) }} />;
  if (!chosen) return <Welcome />; // language first: needs no network, paints immediately
  if (status === 'loading') return <Splash />;
  if (status === 'signedOut') return <Welcome />;
  if (!summary) return path === '/play' ? <SoloPlay /> : <OfflineHome />;
  if (!profile!.onboarded) return <Onboarding />;
  if (!profile!.signup_bonus_claimed) return <DemoQuiz />;

  if (path === '/') return <Home />;
  for (const [pattern, Screen] of routes) {
    const params = matchPath(pattern, path);
    if (params) return <Screen params={params} />;
  }
  return <Home />;
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <img src="/logo.svg" alt="" width={96} height={96} className="anim-bob rounded-3xl shadow-[0_8px_0_rgb(0_0_0/0.3)]" />
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <RouterProvider>
        <ToastProvider>
          <SessionProvider>
            <CrashBoundary>
              <Suspense fallback={<Loading />}>
                <Gate />
              </Suspense>
            </CrashBoundary>
          </SessionProvider>
        </ToastProvider>
      </RouterProvider>
    </I18nProvider>
  );
}

/** Reports render crashes to Sentry and offers a reload instead of a blank screen. */
class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: unknown) {
    captureError(error);
  }
  render() {
    if (!this.state.crashed) return this.props.children;
    return <CrashScreen />;
  }
}

function CrashScreen() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="glass grid h-24 w-24 place-items-center !rounded-full text-5xl">😵</span>
      <p className="text-outline-sm font-display text-lg font-bold">{t('app.crashed')}</p>
      <Button size="lg" variant="gold" onClick={() => window.location.assign('/')}>
        🔁 {t('app.reload')}
      </Button>
    </div>
  );
}
