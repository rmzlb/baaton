import { lazy, Suspense, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn, SignIn, SignUp, OrganizationProfile, useUser, useAuth } from '@clerk/clerk-react';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { useVersionCheck } from '@/hooks/useVersionCheck';
import { AppLayout } from '@/components/layout/AppLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PageLoader } from '@/components/shared/PageLoader';

// Lazy-loaded page components (code splitting)
const Landing = lazy(() => import('./pages/Landing'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ProjectBoard = lazy(() => import('./pages/ProjectBoard'));
const ProjectList = lazy(() => import('./pages/ProjectList'));
const MyTasks = lazy(() => import('./pages/MyTasks'));
const AllIssues = lazy(() => import('./pages/AllIssues'));
const Settings = lazy(() => import('./pages/Settings'));
const PublicSubmit = lazy(() => import('./pages/PublicSubmit'));
const Docs = lazy(() => import('./pages/Docs'));
const Milestones = lazy(() => import('./pages/Milestones'));
const AllMilestones = lazy(() => import('./pages/AllMilestones'));
const Sprints = lazy(() => import('./pages/Sprints'));
const Triage = lazy(() => import('./pages/Triage'));
const RoadmapTimeline = lazy(() => import('./pages/RoadmapTimeline'));
const AnalyticsPM = lazy(() => import('./pages/AnalyticsPM'));

const isAppDomain = window.location.hostname === 'app.baaton.dev';

function RootRoute() {
  const { isSignedIn, isLoaded } = useUser();
  if (isAppDomain) {
    if (!isLoaded) return null;
    return isSignedIn ? <Navigate to="/dashboard" replace /> : <Navigate to="/sign-in" replace />;
  }
  return (
    <Suspense fallback={<PageLoader />}>
      <Landing />
    </Suspense>
  );
}

function ProtectedLayout() {
  const { isReady } = useOrgGuard();

  // Wait until org is resolved before rendering (ensures JWT has org_id)
  if (!isReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-accent" />
      </div>
    );
  }

  return (
    <SignedIn>
      <ErrorBoundary>
        <AppLayout />
      </ErrorBoundary>
    </SignedIn>
  );
}

/**
 * Detects when a Clerk session expires/invalidates and forces a clean
 * sign-out. Without this, Clerk's internal token refresh retries the
 * stale session in a loop, spamming 404s in the console.
 */
function SessionMonitor() {
  const { isSignedIn, signOut } = useAuth();
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (isSignedIn) {
      wasSignedIn.current = true;
    } else if (wasSignedIn.current && isSignedIn === false) {
      // Session expired while user was signed in → clean sign out
      console.info('[auth] session expired, signing out');
      wasSignedIn.current = false;
      signOut({ redirectUrl: '/sign-in' });
    }
  }, [isSignedIn, signOut]);

  return null;
}

function AuthGate() {
  return (
    <>
      <SignedIn>
        <Outlet />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

export function App() {
  const { updateAvailable, reload } = useVersionCheck();

  const host = window.location.hostname;
  const isAppHost = host === 'app.baaton.dev';
  const path = window.location.pathname;
  const isPublicPath = path === '/' || path.startsWith('/docs') || path.startsWith('/submit/') || path.startsWith('/s/');

  if (!isAppHost && !isPublicPath) {
    const target = `https://app.baaton.dev${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(target);
    return null;
  }

  return (
    <>
      <SessionMonitor />
      {updateAvailable && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200 flex items-center gap-2 shadow-lg">
          <span>Nouvelle version disponible</span>
          <button
            onClick={reload}
            className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-black hover:bg-amber-300"
          >
            Mettre à jour
          </button>
        </div>
      )}
      <Suspense fallback={<PageLoader />}>
        <Routes>
        {/* Root: landing on baaton.dev, dashboard redirect on app.baaton.dev */}
        <Route path="/" element={<RootRoute />} />
        <Route path="/submit/:slug" element={<PublicSubmit />} />
        <Route path="/s/:token" element={<PublicSubmit />} />
        <Route path="/docs" element={<Docs />} />

        {/* Auth routes */}
        <Route
          path="/sign-in/*"
          element={
            <div className="flex min-h-screen items-center justify-center bg-neutral-950">
              <SignIn routing="path" path="/sign-in" />
            </div>
          }
        />
        <Route
          path="/sign-up/*"
          element={
            <div className="flex min-h-screen items-center justify-center bg-neutral-950">
              <SignUp routing="path" path="/sign-up" />
            </div>
          }
        />

        {/* Protected routes — wrapped in auth gate + layout */}
        <Route element={<AuthGate />}>
          <Route element={<ProtectedLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/my-tasks" element={<MyTasks />} />
            <Route path="/all-issues" element={<AllIssues />} />
            <Route path="/triage" element={<Triage />} />
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/projects/:slug" element={<ProjectBoard />} />
            <Route path="/milestones" element={<AllMilestones />} />
            <Route path="/roadmap" element={<RoadmapTimeline />} />
            <Route path="/analytics" element={<AnalyticsPM />} />
            <Route path="/projects/:slug/milestones" element={<Milestones />} />
            <Route path="/projects/:slug/sprints" element={<Sprints />} />
            <Route path="/settings" element={<Settings />} />
            <Route
              path="/org/*"
              element={
                <div className="flex min-h-screen items-center justify-center bg-neutral-950">
                  <OrganizationProfile routing="path" path="/org" />
                </div>
              }
            />
          </Route>
        </Route>
        </Routes>
      </Suspense>
    </>
  );
}
