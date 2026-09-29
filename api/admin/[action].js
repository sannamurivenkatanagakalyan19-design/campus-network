const { analyze, dashboard, filteredEvents, getAlerts, graph, requireAdmin, respond } = require('../../lib/vercel-data');

module.exports = function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  const params = new URL(req.url, 'https://vercel.local').searchParams;

  if (action === 'dashboard' && req.method === 'GET') return respond(res, 200, dashboard());
  if (action === 'events' && req.method === 'GET') return respond(res, 200, filteredEvents(params));
  if (action === 'graph' && req.method === 'GET') return respond(res, 200, graph(params));
  if (action === 'alerts' && req.method === 'GET') return respond(res, 200, getAlerts());
  if (action === 'analyze' && req.method === 'POST') return respond(res, 200, analyze());
  if (action === 'download' && req.method === 'GET') {
    res.status(200).setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=synthetic-login-events.csv');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'data', 'login_events.csv')));
  }
  res.setHeader('Allow', 'GET, POST');
  return respond(res, action ? 405 : 404, { error: 'Admin API route not found.' });
};