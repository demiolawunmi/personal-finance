import { z } from 'zod';
import type { AppEnv } from '../env';
import { requireSession, requireCsrf } from '../../../../packages/security/auth';
import { readBody, invariant } from '../../../../packages/shared/errors';
import { all, first, insert, stmt, auditStatement } from '../../../../packages/db/repository';
import { money, micros } from '../../../../packages/domain/money';
import {
  dateSchema,
  currencySchema,
  validatePeriod,
  monthPeriod,
  today,
} from '../../../../packages/domain/periods';
import * as metrics from '../../../../packages/analytics/service';
import { report } from '../../../../packages/reports/engine';
import { getSetupStatus } from '../../../../packages/security/setup';
import { plaidRoute } from './plaid';
export async function dashboardApi(request: Request, env: AppEnv) {
  const s = await requireSession(request, env),
    url = new URL(request.url),
    path = url.pathname;
  if (!['GET', 'HEAD'].includes(request.method)) requireCsrf(request, env, s);
  const plaid = await plaidRoute(request, env, s);
  if (plaid) return plaid;
  if (request.method === 'GET' && path === '/api/setup')
    return Response.json(await getSetupStatus(env));
  const currency = currencySchema.parse(url.searchParams.get('currency') ?? 'CAD');
  const defaultPeriod = monthPeriod(today(env.TIMEZONE), currency);
  const p = validatePeriod({
    start_date: url.searchParams.get('start_date') ?? defaultPeriod.start_date,
    end_date: url.searchParams.get('end_date') ?? defaultPeriod.end_date,
    currency,
  });
  if (request.method === 'GET') {
    if (path === '/api/oauth/grants') {
      const result = await env.OAUTH_PROVIDER.listUserGrants(s.user_id, { limit: 100 });
      return Response.json(result);
    }
    if (path === '/api/session')
      return Response.json({
        user_id: s.user_id,
        csrf_token: s.csrf_token,
        environment: env.APP_ENV,
        setup_required: (await getSetupStatus(env)).status !== 'ready',
      });
    if (path === '/api/overview') {
      const [
        envelope,
        spending,
        balances,
        categories,
        anomalies,
        attention,
        largest,
        trends,
        deltas,
        recent,
        recurring,
        signals,
      ] = await Promise.all([
        metrics.envelope(env.DB, p),
        metrics.spending(env.DB, p),
        metrics.balances(env.DB, currency),
        metrics.breakdown(env.DB, p, 'category'),
        metrics.anomalies(env.DB, p),
        metrics.periodAttention(env.DB, p),
        metrics.largestTransactions(env.DB, p),
        metrics.trends(env.DB, p, 6),
        metrics.categoryDeltas(env.DB, p),
        metrics.transactions(env.DB, p, { limit: 8 }),
        metrics.recurring(env.DB, currency),
        metrics.openSignals(env.DB, currency),
      ]);
      return Response.json({
        ...envelope,
        ...spending,
        balances,
        categories: categories.map((c) => ({ ...c, delta: deltas[c.name] ?? null })),
        anomalies,
        attention: attention.category_signals,
        pace: attention.pace,
        largest,
        trends,
        transactions: recent.transactions,
        recurring,
        signals,
      });
    }
    if (path === '/api/spending') {
      const [
        envelope,
        spending,
        categories,
        merchants,
        anomalies,
        attention,
        largest,
        deltas,
        signals,
      ] = await Promise.all([
        metrics.envelope(env.DB, p),
        metrics.spending(env.DB, p),
        metrics.breakdown(env.DB, p, 'category'),
        metrics.breakdown(env.DB, p, 'merchant'),
        metrics.anomalies(env.DB, p),
        metrics.periodAttention(env.DB, p),
        metrics.largestTransactions(env.DB, p),
        metrics.categoryDeltas(env.DB, p),
        metrics.openSignals(env.DB, currency),
      ]);
      return Response.json({
        ...envelope,
        ...spending,
        categories: categories.map((c) => ({ ...c, delta: deltas[c.name] ?? null })),
        merchants,
        anomalies,
        attention: attention.category_signals,
        pace: attention.pace,
        largest,
        signals,
      });
    }
    if (path === '/api/transactions') {
      const status = url.searchParams.get('status') ?? '';
      return Response.json({
        ...(await metrics.envelope(env.DB, p)),
        ...(await metrics.transactions(env.DB, p, {
          query: z
            .string()
            .max(100)
            .parse(url.searchParams.get('query') ?? ''),
          cursor: url.searchParams.get('cursor') ?? undefined,
          category_id: url.searchParams.get('category_id') ?? undefined,
          account_id: url.searchParams.get('account_id') ?? undefined,
          limit: Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 50)),
          ...(status === 'unclassified' ? { kind: 'unclassified_inflow' } : {}),
          ...(status === 'pending'
            ? { pending: true }
            : status === 'settled'
              ? { pending: false }
              : status === 'excluded'
                ? { excluded: true }
                : {}),
        })),
      });
    }
    if (/^\/api\/transactions\/[^/]+\/annotation$/.test(path)) {
      const id = path.split('/')[3];
      invariant(
        await first(env.DB, 'SELECT id FROM transactions WHERE id=?', id),
        404,
        'TRANSACTION_NOT_FOUND',
      );
      return Response.json(
        (await first(env.DB, 'SELECT * FROM transaction_annotations WHERE transaction_id=?', id)) ??
          {},
      );
    }
    if (path === '/api/categories')
      return Response.json(
        await all(env.DB, 'SELECT id,display_name,type FROM categories ORDER BY display_name'),
      );
    if (path === '/api/budget')
      return Response.json({
        ...(await metrics.envelope(env.DB, p)),
        ...(await metrics.budget(env.DB, p, today(env.TIMEZONE))),
        saved: await all(env.DB, 'SELECT * FROM budgets WHERE active=1 AND currency=?', currency),
      });
    if (path === '/api/recurring')
      return Response.json({
        ...(await metrics.envelope(env.DB, p)),
        ...(await metrics.recurring(env.DB, currency)),
      });
    if (path === '/api/anomalies' || path === '/api/signals') {
      const [envelope, anomalies, attention, signals] = await Promise.all([
        metrics.envelope(env.DB, p),
        metrics.anomalies(env.DB, p),
        metrics.periodAttention(env.DB, p),
        metrics.openSignals(env.DB, currency),
      ]);
      return Response.json({
        ...envelope,
        anomalies,
        attention: attention.category_signals,
        pace: attention.pace,
        signals,
      });
    }
    if (path === '/api/data-health')
      return Response.json({
        ...(await metrics.dataHealth(env.DB)),
        integrity: await metrics.reconcile(env.DB),
      });
    if (path === '/api/balances') return Response.json(await metrics.balances(env.DB, currency));
    if (path === '/api/connections')
      return Response.json({
        connections: await all(
          env.DB,
          'SELECT id,institution_name,status,last_successful_sync_at,history_complete,disconnected_at FROM plaid_items ORDER BY created_at',
        ),
        data_freshness: await metrics.dataHealth(env.DB),
      });
    if (path === '/api/reports')
      return Response.json(
        await all(
          env.DB,
          'SELECT id,report_type,period_start,period_end,currency,generated_at,calculation_version FROM report_runs WHERE currency=? ORDER BY generated_at DESC LIMIT 50',
          currency,
        ),
      );
    if (path.startsWith('/api/reports/')) {
      const row = await first<{ metrics_json: string }>(
        env.DB,
        'SELECT metrics_json FROM report_runs WHERE id=?',
        path.slice(13),
      );
      invariant(row, 404, 'REPORT_NOT_FOUND');
      return Response.json(JSON.parse(row.metrics_json));
    }
    if (path === '/api/goals') return Response.json(await metrics.goals(env.DB, currency));
    if (path === '/api/rules')
      return Response.json(
        await all(env.DB, 'SELECT * FROM classification_rules ORDER BY priority,id'),
      );
  }
  if (
    request.method === 'POST' &&
    path.startsWith('/api/oauth/grants/') &&
    path.endsWith('/revoke')
  ) {
    const id = path.split('/')[4];
    await env.OAUTH_PROVIDER.revokeGrant(id, s.user_id);
    await auditStatement(env.DB, 'MCP_ACCESS_REVOKED', 'oauth_grant', id, s.user_id).run();
    return Response.json({ saved: true });
  }
  const body = JSON.parse((await readBody(request)) || '{}');
  const review = /^\/api\/anomalies\/([^/]+)\/review$/.exec(path);
  if (request.method === 'POST' && review) {
    const b = z
      .object({
        status: z.enum(['open', 'reviewed', 'dismissed']),
        note: z.string().max(500).nullable().optional(),
      })
      .parse(body ?? {});
    invariant(
      await first(env.DB, 'SELECT id FROM anomalies WHERE id=?', review[1]),
      404,
      'ANOMALY_NOT_FOUND',
    );
    await env.DB.batch([
      insert(
        env.DB,
        'anomaly_reviews',
        {
          anomaly_id: review[1],
          status: b.status,
          note: b.note ?? null,
          reviewed_at: new Date().toISOString(),
        },
        'ON CONFLICT(anomaly_id) DO UPDATE SET status=excluded.status,note=excluded.note,reviewed_at=excluded.reviewed_at',
      ),
      auditStatement(env.DB, 'ANOMALY_REVIEWED', 'anomaly', review[1], s.user_id, {
        status: b.status,
      }),
    ]);
    return Response.json({ saved: true });
  }
  const account = /^\/api\/accounts\/([^/]+)$/.exec(path);
  if (request.method === 'PATCH' && account) {
    const b = z
      .object({ name: z.string().trim().max(100).nullable() })
      .strict()
      .parse(body ?? {});
    invariant(
      await first(env.DB, 'SELECT id FROM accounts WHERE id=?', account[1]),
      404,
      'ACCOUNT_NOT_FOUND',
    );
    await env.DB.batch([
      stmt(
        env.DB,
        'UPDATE accounts SET custom_name=?,updated_at=? WHERE id=?',
        b.name ? b.name : null,
        new Date().toISOString(),
        account[1],
      ),
      auditStatement(env.DB, 'ACCOUNT_RENAMED', 'account', account[1], s.user_id),
    ]);
    return Response.json({ saved: true });
  }
  const annotation = /^\/api\/transactions\/([^/]+)\/annotation$/.exec(path);
  if (request.method === 'PATCH' && annotation) {
    const schema = z
      .object({
        merchant_override: z.string().trim().min(1).max(150).nullable().optional(),
        category_override_id: z.string().max(60).nullable().optional(),
        essentiality_override: z.enum(['essential', 'discretionary']).nullable().optional(),
        exclude_from_spending: z.boolean().optional(),
        exclude_reason: z.string().max(300).nullable().optional(),
        note: z.string().max(2000).nullable().optional(),
      })
      .strict();
    const patch = schema.parse(body);
    invariant(
      await first(env.DB, 'SELECT id FROM transactions WHERE id=?', annotation[1]),
      404,
      'TRANSACTION_NOT_FOUND',
    );
    const existing = await first<Record<string, unknown>>(
      env.DB,
      'SELECT * FROM transaction_annotations WHERE transaction_id=?',
      annotation[1],
    );
    const row = {
      transaction_id: annotation[1],
      merchant_override: null,
      category_override_id: null,
      essentiality_override: null,
      exclude_from_spending: 0,
      exclude_reason: null,
      note: null,
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    row.exclude_from_spending = Number(row.exclude_from_spending);
    await env.DB.batch([
      insert(
        env.DB,
        'transaction_annotations',
        row,
        'ON CONFLICT(transaction_id) DO UPDATE SET ' +
          Object.keys(row)
            .filter((k) => k !== 'transaction_id')
            .map((k) => `${k}=excluded.${k}`)
            .join(','),
      ),
      auditStatement(env.DB, 'MANUAL_CATEGORY_CHANGED', 'transaction', annotation[1], s.user_id, {
        fields: Object.keys(patch),
      }),
    ]);
    await env.JOBS.send({ type: 'REBUILD_AGGREGATES' });
    return Response.json({ saved: true });
  }
  const budget = /^\/api\/budgets\/([^/]+)$/.exec(path);
  if (request.method === 'PUT' && budget) {
    const b = z
      .object({
        name: z.string().min(1).max(100),
        currency: currencySchema,
        start_date: dateSchema,
        lines: z
          .array(
            z.object({ category_id: z.string(), limit: z.string().regex(/^\d+(\.\d{1,6})?$/) }),
          )
          .max(50),
      })
      .parse(body);
    invariant(b.start_date.endsWith('-01'), 400, 'BUDGET_START_MUST_BE_MONTH_START');
    invariant(
      new Set(b.lines.map((l) => l.category_id)).size === b.lines.length,
      400,
      'DUPLICATE_BUDGET_CATEGORY',
    );
    const eligibleCategories = await all<{ id: string }>(
      env.DB,
      "SELECT id FROM categories WHERE type='spending'",
    );
    invariant(
      b.lines.every((l) => eligibleCategories.some((c) => c.id === l.category_id)),
      400,
      'INVALID_BUDGET_CATEGORY',
    );
    await env.DB.batch([
      insert(
        env.DB,
        'budgets',
        { id: budget[1], name: b.name, currency: b.currency, start_date: b.start_date },
        'ON CONFLICT(id) DO UPDATE SET name=excluded.name,currency=excluded.currency,start_date=excluded.start_date',
      ),
      stmt(env.DB, 'DELETE FROM budget_lines WHERE budget_id=?', budget[1]),
      ...b.lines.map((l) =>
        insert(env.DB, 'budget_lines', {
          budget_id: budget[1],
          category_id: l.category_id,
          limit_micros: micros(l.limit),
        }),
      ),
      auditStatement(env.DB, 'BUDGET_CHANGED', 'budget', budget[1], s.user_id),
    ]);
    await env.JOBS.send({ type: 'REBUILD_AGGREGATES' });
    return Response.json({ saved: true });
  }
  if (request.method === 'POST' && path === '/api/reports') {
    const b = z
      .object({
        type: z.enum(['weekly', 'monthly']),
        start_date: dateSchema,
        end_date: dateSchema,
        currency: currencySchema,
      })
      .parse(body);
    validatePeriod(b);
    await env.JOBS.send({ type: 'GENERATE_REPORT', reportType: b.type, period: b });
    return Response.json({ queued: true });
  }
  if (request.method === 'PUT' && path.startsWith('/api/goals/')) {
    const b = z
      .object({
        name: z.string().min(1).max(100),
        type: z.enum(['savings', 'emergency_fund', 'debt_reduction', 'custom']),
        target: z.string(),
        current: z.string(),
        currency: currencySchema,
        target_date: dateSchema.nullable(),
        status: z.enum(['active', 'completed', 'paused']).default('active'),
      })
      .parse(body);
    const row = {
      id: path.slice(11),
      name: b.name,
      type: b.type,
      target_amount_micros: micros(b.target),
      current_amount_micros: micros(b.current),
      currency: b.currency,
      target_date: b.target_date,
      status: b.status,
    };
    invariant(row.target_amount_micros > 0, 400, 'TARGET_MUST_BE_POSITIVE');
    await env.DB.batch([
      insert(
        env.DB,
        'goals',
        row,
        'ON CONFLICT(id) DO UPDATE SET ' +
          Object.keys(row)
            .filter((k) => k !== 'id')
            .map((k) => `${k}=excluded.${k}`)
            .join(','),
      ),
      auditStatement(env.DB, 'GOAL_CHANGED', 'goal', row.id, s.user_id),
    ]);
    await env.JOBS.send({ type: 'REBUILD_AGGREGATES' });
    return Response.json({ saved: true });
  }
  if (request.method === 'PUT' && path.startsWith('/api/rules/')) {
    const b = z
      .object({
        field: z.enum(['merchant', 'description']),
        operator: z.enum(['equals', 'contains']),
        pattern: z.string().min(1).max(100),
        category_id: z.string(),
        priority: z.number().int().min(0).max(1000),
        active: z.boolean(),
      })
      .parse(body);
    const id = path.slice(11);
    await env.DB.batch([
      insert(
        env.DB,
        'classification_rules',
        { id, ...b, active: Number(b.active), updated_at: new Date().toISOString() },
        'ON CONFLICT(id) DO UPDATE SET field=excluded.field,operator=excluded.operator,pattern=excluded.pattern,category_id=excluded.category_id,priority=excluded.priority,active=excluded.active,version=classification_rules.version+1,updated_at=excluded.updated_at',
      ),
      auditStatement(env.DB, 'CLASSIFICATION_RULE_CHANGED', 'rule', id, s.user_id),
    ]);
    await env.JOBS.send({ type: 'REBUILD_AGGREGATES' });
    return Response.json({ saved: true });
  }
  invariant(false, 404, 'NOT_FOUND');
}
