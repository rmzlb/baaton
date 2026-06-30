import { test, expect, type APIRequestContext } from '@playwright/test';

const API = '/api/v1';
const PROJECT_ID = process.env.BAATON_PROJECT_ID!;

type Status = { key: string; label: string; color: string; hidden: boolean; category?: string; core?: boolean };

async function getProject(req: APIRequestContext) {
  const res = await req.get(`${API}/projects/${PROJECT_ID}`);
  expect(res.ok(), `GET project: ${res.status()}`).toBeTruthy();
  return (await res.json()).data;
}

async function getStatuses(req: APIRequestContext): Promise<Status[]> {
  return (await getProject(req)).statuses;
}

async function putStatuses(req: APIRequestContext, statuses: Status[], reassign?: Record<string, string>) {
  return req.put(`${API}/projects/${PROJECT_ID}/statuses`, { data: { statuses, reassign: reassign ?? {} } });
}

async function createIssue(req: APIRequestContext, title: string, status: string) {
  const res = await req.post(`${API}/issues`, { data: { project_id: PROJECT_ID, title, status } });
  expect(res.ok(), `create issue (${status}): ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data;
}

async function getIssue(req: APIRequestContext, id: string) {
  const res = await req.get(`${API}/issues/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

test.describe.serial('customizable workflow statuses', () => {
  test('baseline: 6 core statuses carry semantic categories', async ({ request }) => {
    const statuses = await getStatuses(request);
    const byKey = Object.fromEntries(statuses.map((s) => [s.key, s]));
    expect(statuses).toHaveLength(6);
    expect(byKey.backlog.category).toBe('backlog');
    expect(byKey.todo.category).toBe('unstarted');
    expect(byKey.in_progress.category).toBe('started');
    expect(byKey.done.category).toBe('completed');
    expect(byKey.cancelled.category).toBe('canceled');
    expect(statuses.every((s) => s.core)).toBeTruthy();
  });

  test('issues get status_category synced by the trigger', async ({ request }) => {
    const a = await createIssue(request, 'open work', 'in_progress');
    const b = await createIssue(request, 'shipped work', 'done');
    expect((await getIssue(request, a.id)).status_category).toBe('started');
    expect((await getIssue(request, b.id)).status_category).toBe('completed');
  });

  test('add a custom mid-flow status (To discuss) + reorder', async ({ request }) => {
    const statuses = await getStatuses(request);
    // insert "to_discuss" between in_progress and in_review
    const idx = statuses.findIndex((s) => s.key === 'in_review');
    const next = [...statuses];
    next.splice(idx, 0, { key: 'to_discuss', label: 'To discuss', color: '#ec4899', hidden: false, category: 'started' });
    const res = await putStatuses(request, next);
    expect(res.ok(), `put: ${res.status()} ${await res.text()}`).toBeTruthy();

    const after = await getStatuses(request);
    const keys = after.map((s) => s.key);
    expect(keys).toContain('to_discuss');
    expect(keys.indexOf('to_discuss')).toBe(keys.indexOf('in_progress') + 1);
    const td = after.find((s) => s.key === 'to_discuss')!;
    expect(td.category).toBe('started');
    expect(td.core).toBeFalsy();
  });

  test('issue moved to custom status is open + categorized', async ({ request }) => {
    const issue = await createIssue(request, 'needs discussion', 'todo');
    const res = await request.patch(`${API}/issues/${issue.id}`, { data: { status: 'to_discuss' } });
    expect(res.ok(), `patch: ${res.status()} ${await res.text()}`).toBeTruthy();
    const updated = await getIssue(request, issue.id);
    expect(updated.status).toBe('to_discuss');
    expect(updated.status_category).toBe('started');

    // it must count as OPEN (not terminal) in the issues list
    const list = (await (await request.get(`${API}/projects/${PROJECT_ID}/issues`)).json()).data;
    const open = list.filter((i: { status_category: string }) => !['completed', 'canceled'].includes(i.status_category));
    expect(open.some((i: { id: string }) => i.id === issue.id)).toBeTruthy();
  });

  test('rename a core status label; key + category stay locked', async ({ request }) => {
    const statuses = await getStatuses(request);
    const next = statuses.map((s) => (s.key === 'todo' ? { ...s, label: 'A faire' } : s));
    const res = await putStatuses(request, next);
    expect(res.ok()).toBeTruthy();
    const todo = (await getStatuses(request)).find((s) => s.key === 'todo')!;
    expect(todo.label).toBe('A faire');
    expect(todo.category).toBe('unstarted'); // locked
    expect(todo.core).toBeTruthy();
  });

  test('delete custom status reassigns its issues to the previous one', async ({ request }) => {
    // find current order, target = status before to_discuss
    const statuses = await getStatuses(request);
    const tdIdx = statuses.findIndex((s) => s.key === 'to_discuss');
    const prevKey = statuses[tdIdx - 1].key;

    const next = statuses.filter((s) => s.key !== 'to_discuss');
    const res = await putStatuses(request, next, { to_discuss: prevKey });
    expect(res.ok(), `delete: ${res.status()} ${await res.text()}`).toBeTruthy();

    expect((await getStatuses(request)).some((s) => s.key === 'to_discuss')).toBeFalsy();
    // no issue should remain on the deleted status
    const list = (await (await request.get(`${API}/projects/${PROJECT_ID}/issues`)).json()).data;
    expect(list.some((i: { status: string }) => i.status === 'to_discuss')).toBeFalsy();
    expect(list.some((i: { status: string }) => i.status === prevKey)).toBeTruthy();
  });

  test('guardrails: cannot remove a core status', async ({ request }) => {
    const statuses = await getStatuses(request);
    const res = await putStatuses(request, statuses.filter((s) => s.key !== 'done'));
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('done');
  });

  test('guardrails: custom status cannot use a terminal category', async ({ request }) => {
    const statuses = await getStatuses(request);
    const res = await putStatuses(request, [
      ...statuses,
      { key: 'shipped_x', label: 'Shipped X', color: '#000000', hidden: false, category: 'completed' },
    ]);
    expect(res.status()).toBe(400);
  });

  test('guardrails: duplicate keys rejected', async ({ request }) => {
    const statuses = await getStatuses(request);
    const res = await putStatuses(request, [
      ...statuses,
      { key: 'todo', label: 'dup', color: '#000000', hidden: false, category: 'started' },
    ]);
    expect(res.status()).toBe(400);
  });

  test('no regression: existing endpoints still 200 after schema change', async ({ request }) => {
    expect((await request.get(`${API}/projects/${PROJECT_ID}/issues`)).ok()).toBeTruthy();
    expect((await request.get(`${API}/triage`)).ok()).toBeTruthy();
    // terminal issue still excluded from open set
    const list = (await (await request.get(`${API}/projects/${PROJECT_ID}/issues`)).json()).data;
    const done = list.find((i: { status: string }) => i.status === 'done');
    expect(done.status_category).toBe('completed');
  });
});
