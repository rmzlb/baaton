import { useCallback, useEffect, useState } from 'react';
import { OnboardingProvider, useOnboarding } from '@onboardjs/react';
import type { OnboardingStep } from '@onboardjs/react';
import { OnboardingStepUI } from './OnboardingStep';
import { WelcomeStep } from './steps/WelcomeStep';
import { CreateProjectStep } from './steps/CreateProjectStep';
import { KanbanStep } from './steps/KanbanStep';
import { InviteTeamStep } from './steps/InviteTeamStep';
import { ConnectAgentStep } from './steps/ConnectAgentStep';

/* ── Step definitions ─────────────────────── */

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    type: 'CUSTOM_COMPONENT',
    component: WelcomeStep,
  },
  {
    id: 'create-project',
    type: 'CUSTOM_COMPONENT',
    component: CreateProjectStep,
  },
  {
    id: 'kanban-board',
    type: 'CUSTOM_COMPONENT',
    component: KanbanStep,
  },
  {
    id: 'invite-team',
    type: 'CUSTOM_COMPONENT',
    component: InviteTeamStep,
  },
  {
    id: 'connect-agent',
    type: 'CUSTOM_COMPONENT',
    component: ConnectAgentStep,
  },
];

const STORAGE_KEY = 'baaton_onboarded';

/* ── Inner overlay (consumes context) ─────── */

function OnboardingOverlay() {
  const { state, currentStep, isCompleted, next } = useOnboarding();
  const [visible, setVisible] = useState(true);

  const markComplete = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
  }, []);

  // When the flow completes via the engine
  useEffect(() => {
    if (isCompleted) {
      markComplete();
    }
  }, [isCompleted, markComplete]);

  if (!visible || !state || !currentStep) return null;

  const currentIndex = state.currentStepNumber - 1;
  const totalSteps = state.totalSteps;
  const isLast = state.isLastStep;

  const handleNext = async () => {
    if (isLast) {
      await next();
      markComplete();
    } else {
      await next();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal card */}
      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-2xl shadow-black/50 overflow-hidden flex flex-col min-h-[520px] max-h-[90vh]">
        {/* Ambient glow */}
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-80 h-64 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" />

        {/* Top decorative bar */}
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2 relative z-10">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg text-white uppercase tracking-wide">
              Baaton
            </span>
            <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
          </div>
          <span className="text-xs font-mono text-neutral-600">
            {state.currentStepNumber} / {totalSteps}
          </span>
        </div>

        {/* Step content */}
        <OnboardingStepUI
          currentIndex={currentIndex}
          totalSteps={totalSteps}
          onNext={handleNext}
          onSkip={markComplete}
          isLast={isLast}
        >
          {/* Render the step component directly */}
          <StepRenderer />
        </OnboardingStepUI>
      </div>
    </div>
  );
}

/* ── Renders current step's component ─────── */

function StepRenderer() {
  const { renderStep } = useOnboarding();
  return <>{renderStep()}</>;
}

/* ── Provider wrapper ─────────────────────── */

export function OnboardingFlow({ children }: { children: React.ReactNode }) {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    const alreadyOnboarded = localStorage.getItem(STORAGE_KEY) === 'true';
    if (!alreadyOnboarded) {
      setShouldShow(true);
    }
  }, []);

  if (!shouldShow) {
    return <>{children}</>;
  }

  return (
    <OnboardingProvider
      steps={ONBOARDING_STEPS}
      initialStepId="welcome"
      onFlowComplete={async () => {
        localStorage.setItem(STORAGE_KEY, 'true');
      }}
    >
      {children}
      <OnboardingOverlay />
    </OnboardingProvider>
  );
}
