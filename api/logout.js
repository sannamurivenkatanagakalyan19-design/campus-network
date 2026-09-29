module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Method not allowed.' }));
  }
  res.setHeader('Set-Cookie', 'campus_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify({ ok: true }));
};