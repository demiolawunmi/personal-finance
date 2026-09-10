/// <reference path="../worker-configuration.d.ts" />
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
export type AppEnv = Omit<Cloudflare.Env, 'APP_ORIGIN' | 'TOKEN_KEY_VERSION'> & {
  APP_ORIGIN: string;
  TOKEN_KEY_VERSION: string;
  OAUTH_PROVIDER: OAuthHelpers;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  OWNER_GITHUB_ID: string;
  PLAID_CLIENT_ID: string;
  PLAID_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  COOKIE_ENCRYPTION_KEY: string;
  TOKEN_PREVIOUS_KEYS?: string;
};
