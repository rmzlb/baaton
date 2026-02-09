import { Routes, Route } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn, SignIn, SignUp, OrganizationProfile } from '@clerk/clerk-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Landing } from '@/pages/Landing';
import { Dashboard } from '@/pages/Dashboard';
import { ProjectBoard } from '@/pages/ProjectBoard';
import { ProjectList } from '@/pages/ProjectList';
import { Settings } from '@/pages/Settings';
import { PublicSubmit } from '@/pages/PublicSubmit';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';

export function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
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
