import type { AppEnv } from '../env';
import { jobSchema } from './messages';
import { syncItem } from '../../../../packages/plaid/sync';
import { PlaidClient } from '../../../../packages/plaid/client';
import { rebuild, reconcile } from '../../../../packages/db/derive';
import { insert, stmt } from '../../../../packages/db/repository';
import { report } from '../../../../packages/reports/engine';
export async function consume(batch: MessageBatch<unknown>, env: AppEnv) {
  for (const message of batch.messages) {
    try {
      const job = jobSchema.parse(message.body);
      if (job.type === 'SYNC_ITEM' || job.type === 'REFRESH_ACCOUNTS')
        await syncItem(env.DB, new PlaidClient(env), env, job.itemId);
      if (
        [
          'SYNC_ITEM',
          'REFRESH_ACCOUNTS',
          'REBUILD_AGGREGATES',
          'DETECT_RECURRING',
          'RUN_DATA_HEALTH_CHECK',
          'GENERATE_REPORT',
        ].includes(job.type)
      )
        await rebuild(env.DB, env.TIMEZONE);
      if (job.type === 'GENERATE_REPORT') await report(env.DB, job.period, job.reportType, true);
      if (job.type === 'RUN_DATA_HEALTH_CHECK') {
        const result = await reconcile(env.DB);
        if (!result.ok)
          await insert(env.DB, 'data_health_events', {
            id: crypto.randomUUID(),
            kind: 'aggregate_mismatch',
            severity: 'error',
            message: 'Financial reconciliation failed.',
            created_at: new Date().toISOString(),
          }).run();
        else
          await stmt(
            env.DB,
            "UPDATE data_health_events SET resolved_at=? WHERE kind='aggregate_mismatch' AND resolved_at IS NULL",
            new Date().toISOString(),
          ).run();
      }
      message.ack();
    } catch {
      console.error(
        JSON.stringify({ event: 'JOB_FAILED', message_id: message.id, attempt: message.attempts }),
      );
      message.retry({ delaySeconds: Math.min(300, 30 * message.attempts) });
    }
  }
}
