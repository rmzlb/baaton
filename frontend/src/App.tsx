import { Routes, Route } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Landing } from '@/pages/Landing';
import { Dashboard } from '@/pages/Dashboard';
import { ProjectBoard } from '@/pages/ProjectBoard';
import { ProjectList } from '@/pages/ProjectList';
import { Settings } from '@/pages/Settings';
import { PublicSubmit } from '@/pages/PublicSubmit';

export function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/submit/:slug" element={<PublicSubmit />} />

      {/* Auth redirect */}
      <Route
        path="/sign-in/*"
        element={
          <div className="flex min-h-screen items-center justify-center bg-background">
            <RedirectToSignIn />
          </div>
        }
      />

      {/* Protected routes */}
      <Route
        element={
          <>
            <SignedIn>
              <AppLayout />
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
      </Route>
    </Routes>
  );
}
