#!/usr/bin/env node
/**
 * @baaton/mcp — MCP server bridge for Baaton REST API
 *
 * Exposes Baaton's project management API as MCP tools.
 * Thin bridge: all logic lives in the Baaton API, this just translates MCP ↔ REST.
 *
 * Usage:
 *   BAATON_URL=https://api.baaton.dev/api/v1 BAATON_API_KEY=baa_... npx @baaton/mcp
 *
 * Or in MCP config:
 *   { "command": "npx", "args": ["-y", "@baaton/mcp"], "env": { "BAATON_URL": "...", "BAATON_API_KEY": "..." } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BASE = process.env.BAATON_URL || 'https://api.baaton.dev/api/v1';
const KEY = process.env.BAATON_API_KEY;

if (!KEY) {
  console.error('Error: BAATON_API_KEY is required. Get one at https://app.baaton.dev');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function api(method, path, body) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
  return data;
}

// ─── Tool definitions ────────────────────────────────────────

const TOOLS = [
  {
    name: 'baaton_list_projects',
    description: 'List all projects in the organization',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'baaton_get_project_context',
    description: 'Get project context (stack, conventions, constraints). Call once per project per session.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'Project UUID' } },
      required: ['project_id'],
    },
  },
  {
    name: 'baaton_list_issues',
    description: 'List issues with optional filters (status, priority, assignee, search)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        status: { type: 'string' },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        search: { type: 'string' },
        limit: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'baaton_get_issue',
    description: 'Get a single issue by ID or display_id (e.g. BAT-42)',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Issue UUID or display_id' } },
      required: ['id'],
    },
  },
  {
    name: 'baaton_create_issue',
    description: 'Create a new issue',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        status: { type: 'string' },
        issue_type: { type: 'string', enum: ['bug', 'feature', 'improvement', 'question'] },
      },
      required: ['project_id', 'title'],
    },
  },
  {
    name: 'baaton_update_issue',
    description: 'Update an issue (status, priority, title, description, assignee)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Issue UUID' },
        status: { type: 'string' },
        priority: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'baaton_post_tldr',
    description: 'Post a work summary (TLDR) on an issue — what was done, files changed, test status',
    inputSchema: {
      type: 'object',
      properties: {
        issue_id: { type: 'string' },
        summary: { type: 'string' },
        files_changed: { type: 'array', items: { type: 'string' } },
        tests_status: { type: 'string', enum: ['passed', 'failed', 'skipped', 'none'] },
      },
      required: ['issue_id', 'summary'],
    },
  },
  {
    name: 'baaton_search',
    description: 'Full-text search across issues, comments, TLDRs',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query' },
        limit: { type: 'number', default: 10 },
      },
      required: ['q'],
    },
  },
  {
    name: 'baaton_add_comment',
    description: 'Add a comment to an issue',
    inputSchema: {
      type: 'object',
      properties: {
        issue_id: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['issue_id', 'body'],
    },
  },
  {
    name: 'baaton_my_issues',
    description: 'Get issues assigned to the current agent/user',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── Tool handlers ───────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case 'baaton_list_projects':
      return api('GET', '/projects');

    case 'baaton_get_project_context':
      return api('GET', `/projects/${args.project_id}/context`);

    case 'baaton_list_issues': {
      const params = new URLSearchParams();
      if (args.project_id) params.set('project_id', args.project_id);
      if (args.status) params.set('status', args.status);
      if (args.priority) params.set('priority', args.priority);
      if (args.search) params.set('search', args.search);
      params.set('limit', String(args.limit || 20));
      return api('GET', `/issues?${params}`);
    }

    case 'baaton_get_issue':
      return api('GET', `/issues/${args.id}`);

    case 'baaton_create_issue': {
      const { project_id, title, description, priority, status, issue_type } = args;
      return api('POST', '/issues', { project_id, title, description, priority, status, issue_type });
    }

    case 'baaton_update_issue': {
      const { id, ...updates } = args;
      return api('PATCH', `/issues/${id}`, updates);
    }

    case 'baaton_post_tldr': {
      const { issue_id, ...tldr } = args;
      return api('POST', `/issues/${issue_id}/tldr`, tldr);
    }

    case 'baaton_search': {
      const params = new URLSearchParams({ q: args.q, limit: String(args.limit || 10) });
      return api('GET', `/search?${params}`);
    }

    case 'baaton_add_comment':
      return api('POST', `/issues/${args.issue_id}/comments`, { body: args.body });

    case 'baaton_my_issues':
      return api('GET', '/issues/mine');

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── MCP Server setup ────────────────────────────────────────

const server = new Server(
  { name: 'baaton', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
