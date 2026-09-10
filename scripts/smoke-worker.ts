import assert from 'node:assert/strict';
const origin = process.env.FINANCE_TEST_ORIGIN ?? 'http://localhost:8787';
for (const [path, status] of [
  ['/health', 200],
  ['/api/overview', 401],
  ['/api/transactions', 401],
  ['/mcp', 401],
  ['/', 200],
] as const) {
  const response = await fetch(origin + path);
  assert.equal(response.status, status, `${path}: ${await response.clone().text()}`);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
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
