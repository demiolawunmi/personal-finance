import { localPlatform } from './local-platform';
import { rotateTokens } from '../packages/security/rotation';
const platform = await localPlatform();
try {
  console.log(await rotateTokens(platform.env.DB, platform.env, 'local-operator'));
} finally {
  await platform.dispose();
}
