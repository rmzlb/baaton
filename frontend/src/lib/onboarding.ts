import { driver, type DriveStep, type Config } from 'driver.js';

/**
 * Build and return the onboarding tour driver instance.
 * All strings come from i18n via the passed `t` function.
 */
export function createOnboardingTour(t: (key: string) => string, onComplete?: () => void) {
  const steps: DriveStep[] = [
    // 1. Welcome — centered, no element
    {
      popover: {
        title: t('tour.welcome.title'),
        description: t('tour.welcome.description'),
      },
    },
    // 2. Sidebar Navigation
    {
      element: '[data-tour="sidebar"]',
      popover: {
        title: t('tour.sidebar.title'),
        description: t('tour.sidebar.description'),
        side: 'right',
        align: 'start',
      },
    },
    // 3. Projects list
    {
      element: '[data-tour="projects-list"]',
      popover: {
        title: t('tour.projects.title'),
        description: t('tour.projects.description'),
        side: 'right',
        align: 'center',
      },
    },
    // 4. Create project
    {
      element: '[data-tour="create-project"]',
      popover: {
        title: t('tour.createProject.title'),
        description: t('tour.createProject.description'),
        side: 'bottom',
        align: 'start',
      },
    },
    // 5. Kanban board area
    {
      element: '[data-tour="board-area"]',
      popover: {
        title: t('tour.board.title'),
        description: t('tour.board.description'),
        side: 'top',
        align: 'center',
      },
    },
    // 6. Create issue
    {
      element: '[data-tour="create-issue"]',
      popover: {
        title: t('tour.createIssue.title'),
        description: t('tour.createIssue.description'),
        side: 'bottom',
        align: 'end',
      },
    },
    // 7. View toggle
    {
      element: '[data-tour="view-toggle"]',
      popover: {
        title: t('tour.views.title'),
        description: t('tour.views.description'),
        side: 'bottom',
        align: 'center',
      },
    },
    // 8. My Tasks
    {
      element: '[data-tour="my-tasks"]',
      popover: {
        title: t('tour.myTasks.title'),
        description: t('tour.myTasks.description'),
        side: 'right',
        align: 'center',
      },
    },
    // 9. AI Assistant
    {
      element: '[data-tour="ai-assistant"]',
      popover: {
        title: t('tour.ai.title'),
        description: t('tour.ai.description'),
        side: 'left',
        align: 'end',
      },
    },
    // 10. Settings
    {
      element: '[data-tour="settings"]',
      popover: {
        title: t('tour.settings.title'),
        description: t('tour.settings.description'),
        side: 'right',
        align: 'center',
      },
    },
    // 11. Done — centered, no element
    {
      popover: {
        title: t('tour.done.title'),
        description: t('tour.done.description'),
      },
    },
  ];

  // Filter out steps whose element doesn't exist in the DOM (graceful fallback)
  const validSteps = steps.filter((step) => {
    if (!step.element) return true; // centered popovers are always valid
    const selector = typeof step.element === 'string' ? step.element : null;
    if (!selector) return true;
    return document.querySelector(selector) !== null;
  });

  const config: Config = {
    showProgress: true,
    animate: true,
    smoothScroll: true,
    allowClose: true,
    overlayOpacity: 0.82,
    stagePadding: 14,
    stageRadius: 12,
    popoverClass: 'baaton-tour-popover',
    nextBtnText: t('tour.btn.next'),
    prevBtnText: t('tour.btn.prev'),
    doneBtnText: t('tour.btn.done'),
    progressText: t('tour.btn.progress'),
    steps: validSteps,
    onDestroyStarted: () => {
      onComplete?.();
      tourDriver.destroy();
    },
  };

  const tourDriver = driver(config);
  return tourDriver;
}
