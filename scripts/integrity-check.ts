import { localPlatform } from './local-platform';
import { reconcile } from '../packages/db/derive';
const platform = await localPlatform();
try {
  const result = await reconcile(platform.env.DB);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await platform.dispose();
}
