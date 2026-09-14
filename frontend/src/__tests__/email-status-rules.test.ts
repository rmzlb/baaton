import { describe, it, expect } from 'vitest';
import { emailStatusUpdate } from '@/components/email/EmailStatusRules';
import type { ProjectSubscription } from '@/lib/types';
const sub: ProjectSubscription = {
  project_id: 'project', project_name: 'Project', project_slug: 'project', org_id: 'org', org_name: 'Org',
  enabled: true, notify_statuses: ['not_ok'], notify_comments: true, notify_issue_created: true,
  channels: ['telegram'], statuses: [], email_notify_statuses: [],
  project_defaults: { notify_statuses: ['backlog'], notify_comments: true, notify_issue_created: false },
};
describe('email-only status updates', () => {
  it('opts into one email status without touching Telegram events/channels', () => {
    expect(emailStatusUpdate(sub, 'in_review')).toEqual({ enabled: true, email_notify_statuses: ['in_review'] });
    expect(sub.notify_statuses).toEqual(['not_ok']);
    expect(sub.channels).toEqual(['telegram']);
  });
  it('removes the last email status without disabling Telegram', () => {
    expect(emailStatusUpdate({ ...sub, email_notify_statuses: ['done'] }, 'done'))
      .toEqual({ enabled: true, email_notify_statuses: [] });
  });
  it('does not create a Telegram subscription for an email-only project', () => {
    expect(emailStatusUpdate({ ...sub, enabled: false }, 'in_review'))
      .toEqual({ enabled: false, email_notify_statuses: ['in_review'] });
  });
  it('does not inherit broad Telegram filters when selecting an email status', () => {
    expect(emailStatusUpdate({ ...sub, email_notify_statuses: undefined }, 'done').email_notify_statuses).toEqual(['done']);
  });
});
