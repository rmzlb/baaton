import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn, SignIn, SignUp, OrganizationProfile, useUser } from '@clerk/clerk-react';
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
  useVersionCheck();

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Root: landing on baaton.dev, dashboard redirect on app.baaton.dev */}
        <Route path="/" element={<RootRoute />} />
        <Route path="/submit/:slug" element={<PublicSubmit />} />
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
  );
}
