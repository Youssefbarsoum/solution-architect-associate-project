const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mysql = require('mysql2/promise');

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Notes</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <main>
    <h1>Notes</h1>
    <p id="info">Loading instance info…</p>
    <form id="note-form">
      <label for="note-text">New note</label>
      <input id="note-text" maxlength="500" required>
      <button>Add</button>
    </form>
    <ul id="notes"></ul>
  </main>
  <script src="/static/app.js"></script>
</body>
</html>`;

// Instance ID + AZ via IMDSv2, so the page shows which instance served the request.
async function instanceInfo() {
  const imds = 'http://169.254.169.254/latest';
  try {
    const token = await (await fetch(`${imds}/api/token`, {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '300' },
      signal: AbortSignal.timeout(1000),
    })).text();
    const get = async (p) => (await fetch(`${imds}/meta-data/${p}`, {
      headers: { 'X-aws-ec2-metadata-token': token },
      signal: AbortSignal.timeout(1000),
    })).text();
    return { instanceId: await get('instance-id'), az: await get('placement/availability-zone') };
  } catch {
    return { instanceId: 'local', az: 'local' };
  }
}

function createApp(db, info) {
  const app = express();
  app.use(express.json());
  // In AWS, CloudFront serves /static/* from S3; this is for local runs only.
  app.use('/static', express.static(path.join(__dirname, 'public')));

  app.get('/', (req, res) => res.type('html').send(PAGE));

  // ALB health check: liveness only, so an RDS failover doesn't make the ASG replace every instance.
  app.get('/health', (req, res) => res.send('ok'));

  app.get('/health/db', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.send('ok');
    } catch {
      res.status(503).send('database unreachable');
    }
  });

  app.get('/api/info', (req, res) => res.json(info));

  app.get('/api/notes', async (req, res) => {
    const [rows] = await db.query('SELECT id, text, created_at FROM notes ORDER BY id DESC LIMIT 100');
    res.json(rows);
  });

  app.post('/api/notes', async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text || text.length > 500) return res.status(400).json({ error: 'text must be 1-500 characters' });
    const [result] = await db.query('INSERT INTO notes (text) VALUES (?)', [text]);
    res.status(201).json({ id: result.insertId, text });
  });

  app.delete('/api/notes/:id', async (req, res) => {
    await db.query('DELETE FROM notes WHERE id = ?', [Number(req.params.id)]);
    res.status(204).end();
  });

  return app;
}

async function main() {
  // On EC2 the systemd unit fetches the RDS-managed secret from Secrets Manager into DB_SECRET_FILE.
  const { username, password } = process.env.DB_SECRET_FILE
    ? JSON.parse(fs.readFileSync(process.env.DB_SECRET_FILE, 'utf8'))
    : { username: process.env.DB_USER, password: process.env.DB_PASSWORD };

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: username,
    password,
    database: process.env.DB_NAME || 'notes',
    connectionLimit: 10,
  });

  const db = {
    async query(sql, params) {
      try {
        return await pool.query(sql, params);
      } catch (err) {
        // RDS rotates the managed password; exit so systemd restarts us and refetches the secret.
        if (err.code === 'ER_ACCESS_DENIED_ERROR') {
          console.error('Database credentials rejected, exiting to refetch secret');
          process.exit(1);
        }
        throw err;
      }
    },
  };

  await db.query(`CREATE TABLE IF NOT EXISTS notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    text VARCHAR(500) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  const port = Number(process.env.PORT) || 3000;
  createApp(db, await instanceInfo()).listen(port, () => console.log(`Listening on ${port}`));
}

if (require.main === module) main();

module.exports = { createApp };
