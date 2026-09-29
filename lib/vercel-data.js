const { createHmac, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const adminCredentials = new Set(['admin001', 'securityadmin', 'kalyansannamuri']);
const sessionSecret = process.env.SESSION_SECRET || 'campus-network-demo-only';
let cachedDataset;

function respond(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function isAdmin(req) {
  const cookieHeader = req.headers?.cookie || '';
  const cookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith('campus_session='));
  if (!cookie) return false;
  const [payload, signature] = cookie.slice('campus_session='.length).split('.');
  if (!payload || !signature) return false;

  const expected = createHmac('sha256', sessionSecret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return adminCredentials.has(session.username) && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.some(value => value !== '')) rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows.shift().map((header, index) => index === 0 ? header.replace(/^\uFEFF/, '') : header);
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function readCsv(name) {
  return parseCsv(readFileSync(path.join(process.cwd(), 'data', name), 'utf8'));
}

function loadDataset() {
  if (cachedDataset) return cachedDataset;
  const events = readCsv('login_events.csv').map(row => ({
    ...row,
    is_new_device: row.is_new_device === 'true',
    generated: row.generated === 'true',
    suspicious: Boolean(row.rule_name),
    risk_level: row.risk_level || 'Low'
  }));
  const frequency = readCsv('login_frequency.csv').map(row => ({
    user_id: row.user_id,
    role: row.role,
    login_count: Number(row.login_count) || 0
  }));
  const pythonAlerts = readCsv('anomaly_results.csv').map(row => ({
    user_id: row.user_id,
    role: row.role,
    login_count: Number(row.login_count) || 0,
    average_login_count: Number(row.average_login_count) || 0,
    z_score: Number(row.z_score) || 0,
    anomaly_reason: row.anomaly_reason,
    risk_level: row.risk_level
  }));
  cachedDataset = { events, frequency, pythonAlerts };
  return cachedDataset;
}

function sortedNewest(events) {
  return [...events].sort((left, right) => right.login_time.localeCompare(left.login_time));
}

function asAlert(event) {
  return {
    rule_name: event.rule_name,
    conditions: event.conditions,
    risk_level: event.risk_level,
    reason: event.reason,
    suggested_action: event.suggested_action,
    event_id: event.event_id,
    user_id: event.user_id,
    user_name: event.user_name,
    role: event.role,
    device_name: event.device_name,
    location: event.location,
    login_time: event.login_time,
    login_date: event.login_date,
    login_status: event.login_status
  };
}

function getAlerts(events = loadDataset().events) {
  return sortedNewest(events.filter(event => event.suspicious)).map(asAlert);
}

function dashboard() {
  const { events, frequency, pythonAlerts } = loadDataset();
  const alerts = getAlerts(events);
  const studentFrequency = frequency.filter(row => row.role === 'student').map(({ user_id, login_count }) => ({ user_id, login_count }));
  const staffFrequency = frequency.filter(row => row.role === 'staff').map(({ user_id, login_count }) => ({ user_id, login_count }));
  const hourlyActivity = Array(24).fill(0);
  for (const event of events) {
    const hour = Number(event.login_time.slice(11, 13));
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) hourlyActivity[hour]++;
  }

  return {
    totals: {
      student_logins: events.filter(event => event.role === 'student' && event.login_status === 'success').length,
      staff_logins: events.filter(event => event.role === 'staff' && event.login_status === 'success').length,
      failed_logins: events.filter(event => event.login_status === 'failed').length,
      suspicious_logins: alerts.length,
      high_risk_alerts: alerts.filter(alert => ['High', 'Critical'].includes(alert.risk_level)).length,
      events: events.length
    },
    recent_events: sortedNewest(events.filter(event => event.suspicious)).slice(0, 12),
    student_frequency: studentFrequency,
    staff_frequency: staffFrequency,
    hourly_activity: hourlyActivity,
    normal_vs_suspicious: [events.length - alerts.length, alerts.length],
    alerts: alerts.slice(0, 30),
    python_alerts: pythonAlerts,
    generated_at: new Date().toISOString().slice(0, 19)
  };
}

function filteredEvents(params) {
  const { events } = loadDataset();
  const role = params.get('role') || 'all';
  const date = params.get('date') || '';
  const risk = params.get('risk') || 'all';
  const device = (params.get('device') || '').toLowerCase();
  const suspicious = params.get('suspicious') === 'true';
  return sortedNewest(events.filter(event =>
    (role === 'all' || event.role === role) &&
    (!date || event.login_date === date) &&
    (risk === 'all' || event.risk_level.toLowerCase() === risk.toLowerCase()) &&
    (!suspicious || event.suspicious) &&
    (!device || event.device_id.toLowerCase() === device || event.device_name.toLowerCase().includes(device))
  )).slice(0, 500);
}

function graph(params) {
  const role = params.get('role')?.toLowerCase() === 'staff' ? 'staff' : 'student';
  const user = (params.get('user') || '').toLowerCase();
  const date = params.get('date') || '';
  const device = (params.get('device') || '').toLowerCase();
  const suspicious = params.get('suspicious') === 'true';
  const events = sortedNewest(loadDataset().events.filter(event =>
    event.role === role &&
    (!user || event.user_id.toLowerCase().includes(user)) &&
    (!date || event.login_date === date) &&
    (!suspicious || event.suspicious) &&
    (!device || event.device_id.toLowerCase() === device || event.device_name.toLowerCase().includes(device))
  )).slice(0, 180);
  const nodes = new Map();
  const edges = [];

  for (const event of events) {
    nodes.set(event.user_id, { data: { id: event.user_id, label: event.user_id, kind: 'user', role: event.role } });
    nodes.set(event.device_id, { data: { id: event.device_id, label: event.device_name, kind: 'device', device_type: event.device_type } });
    nodes.set(event.event_id, {
      data: { id: event.event_id, label: event.login_status === 'success' ? 'Login' : 'Failed', kind: 'event', suspicious: event.suspicious, event },
      classes: event.suspicious ? 'suspicious' : ''
    });
    edges.push({ data: { id: `u-${event.event_id}`, source: event.user_id, target: event.event_id }, classes: event.suspicious ? 'suspicious' : '' });
    edges.push({ data: { id: `d-${event.event_id}`, source: event.event_id, target: event.device_id }, classes: event.suspicious ? 'suspicious' : '' });
    if (role === 'staff') {
      const locationId = `loc-${event.location.replace(/[^A-Za-z0-9]/g, '')}`;
      nodes.set(locationId, { data: { id: locationId, label: event.location, kind: 'location' } });
      edges.push({ data: { id: `l-${event.event_id}`, source: event.event_id, target: locationId }, classes: event.suspicious ? 'suspicious' : '' });
    }
  }
  return { elements: { nodes: [...nodes.values()], edges }, event_count: events.length, role };
}

function analyze() {
  const frequency = loadDataset().frequency;
  const groups = new Map();
  for (const row of frequency) {
    if (!groups.has(row.role)) groups.set(row.role, []);
    groups.get(row.role).push(row);
  }
  const alerts = [];
  for (const [role, rows] of groups) {
    const average = rows.reduce((sum, row) => sum + row.login_count, 0) / rows.length;
    const deviation = Math.sqrt(rows.reduce((sum, row) => sum + (row.login_count - average) ** 2, 0) / rows.length);
    for (const row of rows) {
      const zScore = deviation ? (row.login_count - average) / deviation : 0;
      const zFlag = zScore > 2.5;
      const thresholdFlag = row.login_count > 12;
      if (!zFlag && !thresholdFlag) continue;
      const reasons = [];
      if (zFlag) reasons.push(`z-score ${zScore.toFixed(2)} exceeds 2.5`);
      if (thresholdFlag) reasons.push(`login count ${row.login_count} exceeds fixed threshold 12`);
      alerts.push({
        user_id: row.user_id,
        role,
        login_count: row.login_count,
        average_login_count: Number(average.toFixed(4)),
        z_score: Number(zScore.toFixed(4)),
        anomaly_reason: reasons.join('; '),
        risk_level: zScore > 4 || row.login_count > 24 ? 'Critical' : 'High'
      });
    }
  }
  alerts.sort((left, right) => left.risk_level.localeCompare(right.risk_level) || right.z_score - left.z_score || right.login_count - left.login_count);
  return { ok: true, message: `Analyzed ${frequency.length} accounts; flagged ${alerts.length}. Vercel uses the bundled CSV snapshot.`, alerts };
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  respond(res, 401, { error: 'Admin session required.' });
  return false;
}

module.exports = { analyze, dashboard, filteredEvents, getAlerts, graph, loadDataset, parseCsv, readCsv, requireAdmin, respond };