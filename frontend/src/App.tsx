import { Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn, SignIn, SignUp, OrganizationProfile, useUser } from '@clerk/clerk-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Landing } from '@/pages/Landing';
import { Dashboard } from '@/pages/Dashboard';
import { ProjectBoard } from '@/pages/ProjectBoard';
import { ProjectList } from '@/pages/ProjectList';
import { Settings } from '@/pages/Settings';
import { PublicSubmit } from '@/pages/PublicSubmit';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';

const isAppDomain = window.location.hostname === 'app.baaton.dev';

function RootRoute() {
  const { isSignedIn, isLoaded } = useUser();
  // On app.baaton.dev: always go to dashboard (or sign-in if not logged in)
  if (isAppDomain) {
    if (!isLoaded) return null;
    return isSignedIn ? <Navigate to="/dashboard" replace /> : <Navigate to="/sign-in" replace />;
  }
  // On baaton.dev: show landing
  return <Landing />;
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

      {/* Protected routes — wrapped with onboarding */}
      <Route
        element={
          <>
            <SignedIn>
              <OnboardingFlow>
                <AppLayout />
              </OnboardingFlow>
            </SignedIn>
            <SignedOut>
              <RedirectToSignIn />
            </SignedOut>
          </>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
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
    </Routes>
  );
}
