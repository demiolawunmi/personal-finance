import { it, expect } from 'vitest';
import { database, seedAccounts } from '../fixtures/database';
import { createFinanceServer } from '../../apps/finance-worker/src/mcp/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AppEnv } from '../../apps/finance-worker/src/env';
import { TOOL_SCOPES } from '../../apps/finance-worker/src/mcp/scopes';
it('registers only read-only purpose-built tools for granted scopes', async () => {
  const { db, close } = database();
  try {
    const env = { DB: db, OWNER_GITHUB_ID: 'owner' } as AppEnv;
    const server = createFinanceServer(env, {
      userId: 'owner',
      clientId: 'test',
      scopes: ['finance:summary'],
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport as any);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(
      tools.some((t) =>
        ['search_transactions', 'get_financial_report', 'get_net_worth', 'get_anomalies'].includes(
          t.name,
        ),
      ),
    ).toBe(false);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    expect(Object.keys(TOOL_SCOPES)).toHaveLength(13);
    await client.close();
    await server.close();
  } finally {
    close();
  }
});
it('returns exact money and freshness through a real MCP call; denies excessive date ranges', async () => {
  const { db, close } = database();
  try {
    await seedAccounts(db);
    const env = { DB: db, OWNER_GITHUB_ID: 'owner' } as AppEnv;
    const server = createFinanceServer(env, {
      userId: 'owner',
      clientId: 'test',
      scopes: ['finance:summary'],
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st as any);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(ct);
    const result = await client.callTool({
      name: 'get_spending_summary',
      arguments: { start_date: '2026-09-01', end_date: '2026-09-30', currency: 'CAD' },
    });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.data.spending).toEqual({ amount: '0.000000', currency: 'CAD' });
    expect(parsed.data_freshness.institutions).toHaveLength(1);
    const bad = await client.callTool({
      name: 'get_spending_summary',
      arguments: { start_date: '2020-01-01', end_date: '2026-09-30', currency: 'CAD' },
    });
    expect(bad.isError).toBe(true);
    await client.close();
    await server.close();
  } finally {
    close();
  }
});
