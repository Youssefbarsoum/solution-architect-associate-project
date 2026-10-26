const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./server');

test('routes', async () => {
  const notes = [];
  const db = {
    async query(sql, params) {
      if (sql.startsWith('INSERT')) {
        notes.push({ id: notes.length + 1, text: params[0] });
        return [{ insertId: notes.length }];
      }
      if (sql.startsWith('SELECT id')) return [notes];
      return [[]];
    },
  };
  const server = createApp(db, { instanceId: 'i-test', az: 'us-east-1a' }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://localhost:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/health/db`)).status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/info`)).json(), { instanceId: 'i-test', az: 'us-east-1a' });
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ text: 'x'.repeat(501) })).status, 400);
    assert.equal((await post({ text: ' hello ' })).status, 201);
    assert.deepEqual(await (await fetch(`${base}/api/notes`)).json(), [{ id: 1, text: 'hello' }]);

    db.query = async () => { throw new Error('down'); };
    assert.equal((await fetch(`${base}/health/db`)).status, 503);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally {
    server.close();
  }
});
