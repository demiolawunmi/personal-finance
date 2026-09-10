import type { AppEnv } from '../env';
import { all, stmt } from '../../../../packages/db/repository';
import { today, addDays, monthPeriod } from '../../../../packages/domain/periods';
export async function scheduled(event: ScheduledController, env: AppEnv) {
  const date = today(env.TIMEZONE, new Date(event.scheduledTime));
  const items = await all<{ id: string }>(
    env.DB,
    'SELECT id FROM plaid_items WHERE disconnected_at IS NULL',
  );
  for (const item of items) await env.JOBS.send({ type: 'SYNC_ITEM', itemId: item.id });
  await env.JOBS.send({ type: 'RUN_DATA_HEALTH_CHECK' });
  const currencies = await all<{ currency: string }>(
    env.DB,
    "SELECT DISTINCT currency FROM accounts WHERE length(currency)=3 AND currency<>'UNKNOWN'",
  );
  for (const { currency } of currencies) {
    if (new Date(date).getUTCDay() === 0)
      await env.JOBS.send({
        type: 'GENERATE_REPORT',
        reportType: 'weekly',
        period: { start_date: addDays(date, -7), end_date: addDays(date, -1), currency },
      });
    if (date.endsWith('-01'))
      await env.JOBS.send({
        type: 'GENERATE_REPORT',
        reportType: 'monthly',
        period: monthPeriod(addDays(date, -1), currency),
      });
  }
  await env.DB.batch(
    ['oauth_states', 'oauth_consents', 'sessions'].map((t) =>
      stmt(env.DB, `DELETE FROM ${t} WHERE expires_at<?`, new Date().toISOString()),
    ),
  );
}
