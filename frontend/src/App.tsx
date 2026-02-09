import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn, SignIn, SignUp, OrganizationProfile, useUser } from '@clerk/clerk-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Landing } from '@/pages/Landing';
import { Dashboard } from '@/pages/Dashboard';
import { ProjectBoard } from '@/pages/ProjectBoard';
import { ProjectList } from '@/pages/ProjectList';
import { Settings } from '@/pages/Settings';
import { MyTasks } from '@/pages/MyTasks';
import { PublicSubmit } from '@/pages/PublicSubmit';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const isAppDomain = window.location.hostname === 'app.baaton.dev';

function RootRoute() {
  const { isSignedIn, isLoaded } = useUser();
  if (isAppDomain) {
    if (!isLoaded) return null;
    return isSignedIn ? <Navigate to="/dashboard" replace /> : <Navigate to="/sign-in" replace />;
  }
  return <Landing />;
}

function ProtectedLayout() {
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
  return (
    <Routes>
      {/* Root: landing on baaton.dev, dashboard redirect on app.baaton.dev */}
      <Route path="/" element={<RootRoute />} />
      <Route path="/submit/:slug" element={<PublicSubmit />} />

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
          <Route path="/projects" element={<ProjectList />} />
          <Route path="/projects/:slug" element={<ProjectBoard />} />
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
  );
}
