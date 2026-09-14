import assert from 'node:assert/strict';
const origin = process.env.FINANCE_TEST_ORIGIN ?? 'http://localhost:8787';
for (const [path, status, cache] of [
  ['/health', 200, 'private, no-store'],
  ['/api/overview', 401, 'private, no-store'],
  ['/api/transactions', 401, 'private, no-store'],
  ['/mcp', 401, 'private, no-store'],
  ['/', 200, 'public, max-age=0, must-revalidate'],
] as const) {
  const response = await fetch(origin + path);
  assert.equal(response.status, status, `${path}: ${await response.clone().text()}`);
  assert.equal(response.headers.get('Cache-Control'), cache);
  console.log(`PASS ${path} → ${status}`);
}
const forged = await fetch(origin + '/webhooks/plaid', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{"item_id":"fake"}',
});
assert.equal(forged.status, 401);
console.log('PASS forged webhook → 401');

const bearer = await fetch(origin + '/mcp', {
  headers: { Authorization: 'Bearer deliberately-invalid-fixture-token' },
});
assert.equal(bearer.status, 401);
console.log('PASS forged bearer token → 401');
