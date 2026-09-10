import { getPlatformProxy } from 'wrangler';
import type { AppEnv } from '../apps/finance-worker/src/env';
export async function localPlatform() {
  return getPlatformProxy<AppEnv>({
    configPath: 'apps/finance-worker/wrangler.jsonc',
    persist: { path: 'apps/finance-worker/.wrangler/state/v3' },
    environment: undefined,
  });
}
