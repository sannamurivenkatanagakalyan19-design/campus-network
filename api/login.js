const { createHmac } = require('node:crypto');

const adminCredentials = new Map([
  ['admin001', 'Admin@123'],
  ['securityadmin', 'Secure@123'],
  ['kalyansannamuri', 'kalyan@2007']
]);

function respond(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readForm(body) {
  if (typeof body === 'string') return Object.fromEntries(new URLSearchParams(body));
  return body && typeof body === 'object' ? body : {};
}

function setAdminSession(res, username) {
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ username, expiresAt })).toString('base64url');
  const secret = process.env.SESSION_SECRET || 'campus-network-demo-only';
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  res.setHeader('Set-Cookie', `campus_session=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);
}

module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: 'Method not allowed.' });
  }

  const form = readForm(req.body);
  const role = String(form.role || '').toLowerCase();
  const username = String(form.username || '').trim();
  const password = String(form.password || '');

  if (role === 'admin') {
    if (adminCredentials.get(username) !== password) {
      return respond(res, 401, { error: 'The username or password was not recognized.' });
    }
    setAdminSession(res, username);
    return respond(res, 200, { ok: true, redirect: '/admin' });
  }

  const validAccount = role === 'student'
    ? /^student(?:00[1-9]|0[1-9]\d|100)$/.test(username)
    : role === 'staff' && /^staff(?:00[1-9]|0[1-9]\d|030)$/.test(username);
  if (!validAccount) return respond(res, 400, { error: 'Choose a valid campus portal.' });
  if (password !== 'Campus@123') {
    return respond(res, 401, { error: 'Login unsuccessful. Check your details and try again.' });
  }
  return respond(res, 200, { ok: true, message: 'You are signed in to the synthetic campus portal.' });
};