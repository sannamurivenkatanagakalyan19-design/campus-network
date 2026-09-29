const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const eventById = new Map();
const alertById = new Map();
const dashboardCharts = new Map();

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return payload;
}

function showFormMessage(message, success = false) {
  const target = $('#form-message');
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('success', success);
}

function setupPasswordToggles() {
  $$('[data-toggle-password]').forEach(button => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.togglePassword);
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Hide' : 'Show';
    button.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} password`);
  }));
}

function setupPortal() {
  const role = location.pathname === '/staff-login' ? 'staff' : 'student';
  const isStaff = role === 'staff';
  document.title = `${isStaff ? 'Staff' : 'Student'} Portal | KIET Campus`;
  $('#portal-heading').innerHTML = `${isStaff ? 'Staff' : 'Student'}<br><em>portal.</em>`;
  $('#portal-description').textContent = isStaff
    ? 'A single sign-in for campus teams, research, and operational tools.'
    : 'One sign-in for coursework, campus tools, and library services.';
  $('#username').placeholder = isStaff ? 'staff001' : 'student001';
  $('#username').setAttribute('aria-label', `${isStaff ? 'Staff' : 'Student'} campus username`);
  $('#portal-kicker').textContent = isStaff ? 'STAFF SERVICES' : 'STUDENT SERVICES';
  $('#portal-icon').textContent = isStaff ? 'F' : 'S';
  $('#portal-icon').className = `portal-symbol ${isStaff ? 'staff-symbol' : 'student-symbol'}`;
  $('#credential-prefix').textContent = isStaff ? 'staff001–staff030' : 'student001–student100';
  $('#other-portal-link').href = isStaff ? '/student-login' : '/staff-login';
  $('#other-portal-link').textContent = isStaff ? 'Student ↗' : 'Staff ↗';
  const form = $('#portal-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    showFormMessage('');
    if (!form.reportValidity()) return;
    const submit = $('.submit-button', form);
    submit.disabled = true;
    $('span:first-child', submit).textContent = 'Checking campus access…';
    try {
      const payload = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ role, username: $('#username').value, password: $('#password').value }) });
      showFormMessage(payload.message, true);
      form.reset();
    } catch (error) {
      showFormMessage(error.message || 'Login unsuccessful. Check your details and try again.');
    } finally {
      submit.disabled = false;
      $('span:first-child', submit).textContent = 'Continue to campus';
    }
  });
}

function setupAdminLogin() {
  const form = $('#admin-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    showFormMessage('');
    if (!form.reportValidity()) return;
    const submit = $('.submit-button', form);
    submit.disabled = true;
    $('span:first-child', submit).textContent = 'Verifying admin session…';
    try {
      await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ role: 'admin', username: $('#username').value, password: $('#password').value }) });
      location.assign('/admin');
    } catch (error) {
      showFormMessage(error.message || 'The username or password was not recognized.');
      submit.disabled = false;
      $('span:first-child', submit).textContent = 'Open security console';
    }
  });
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return escapeHtml(value);
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function riskClass(level = 'Low') { return `risk-${String(level).toLowerCase()}`; }
function displayReason(event) { return event.reason || (event.login_status === 'failed' ? 'Unsuccessful sign-in' : 'No rule match'); }

function renderMetrics(totals) {
  const metrics = [
    ['STUDENT LOGINS', totals.student_logins, 'Successful sign-ins'],
    ['STAFF LOGINS', totals.staff_logins, 'Successful sign-ins'],
    ['FAILED LOGINS', totals.failed_logins, 'Across both portals'],
    ['SUSPICIOUS', totals.suspicious_logins, 'Java rule matches'],
    ['HIGH-RISK ALERTS', totals.high_risk_alerts, 'High and critical']
  ];
  $('#metric-grid').innerHTML = metrics.map(([label, value, note]) => `<div class="metric-box"><div class="metric-label">${label}</div><div class="metric-value">${Number(value || 0).toLocaleString()}</div><div class="metric-foot">${note}</div></div>`).join('');
  $('#nav-alert-count').textContent = String(totals.suspicious_logins || 0);
}

function renderEventRows(rows) {
  eventById.clear();
  $('#table-count').textContent = `${rows.length} events`;
  if (!rows.length) {
    $('#events-body').innerHTML = '<tr><td colspan="8" class="empty-state">No login events match these filters.</td></tr>';
    return;
  }
  $('#events-body').innerHTML = rows.slice(0, 100).map(item => {
    eventById.set(item.event_id, item);
    return `<tr data-event-id="${escapeHtml(item.event_id)}" tabindex="0" aria-label="View login details for ${escapeHtml(item.user_id)}">
    <td>${formatDateTime(item.login_time)}</td><td><span class="user-cell">${escapeHtml(item.user_id)}</span><br>${escapeHtml(item.user_name)}</td>
    <td><span class="role-tag ${escapeHtml(item.role)}">${escapeHtml(item.role)}</span></td><td>${escapeHtml(item.device_name)}</td><td>${escapeHtml(item.location)}</td>
    <td title="${escapeHtml(item.conditions || '')}">${escapeHtml(displayReason(item))}</td><td><span class="risk-tag ${riskClass(item.risk_level)}">${escapeHtml(item.risk_level || 'Low')}</span></td>
    <td class="status-${item.login_status === 'success' ? 'success' : 'failed'}">${escapeHtml(item.login_status)}</td></tr>`;
  }).join('');
}

function chartGradient(context, color, topAlpha = 0.9, bottomAlpha = 0.2) {
  const { chart } = context;
  const area = chart.chartArea;
  if (!area) return `rgba(${color}, ${topAlpha})`;
  const gradient = chart.ctx.createLinearGradient(0, area.bottom, 0, area.top);
  gradient.addColorStop(0, `rgba(${color}, ${bottomAlpha})`);
  gradient.addColorStop(1, `rgba(${color}, ${topAlpha})`);
  return gradient;
}

function chartTooltip(context) {
  const { chart, tooltip } = context;
  const parent = chart.canvas.parentElement;
  let element = parent.querySelector('.glass-chart-tooltip');
  if (!element) {
    element = document.createElement('div');
    element.className = 'glass-chart-tooltip';
    parent.append(element);
  }
  if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
    element.dataset.visible = 'false';
    return;
  }
  const title = tooltip.title?.[0] || '';
  const rows = tooltip.dataPoints.map(point => {
    const color = point.dataset.label === 'Staff' ? '#34d399' : ((point.dataset.label === 'Suspicious' || point.label === 'Suspicious') ? '#ef4444' : '#38bdf8');
    return `<span class="glass-chart-tooltip-row"><i style="background:${color}"></i>${escapeHtml(point.dataset.label || point.label)}: ${escapeHtml(point.formattedValue)}</span>`;
  }).join('');
  element.innerHTML = `<strong>${escapeHtml(title)}</strong>${rows}`;
  element.style.left = `${tooltip.caretX}px`;
  element.style.top = `${tooltip.caretY}px`;
  element.dataset.visible = 'true';
}

const chartGlowPlugin = {
  id: 'glassHoverGlow',
  beforeDatasetDraw(chart, args) {
    chart.ctx.save();
    if (chart.getActiveElements().some(item => item.datasetIndex === args.index)) {
      chart.ctx.shadowColor = 'rgba(56, 189, 248, 0.4)';
      chart.ctx.shadowBlur = 14;
    }
  },
  afterDatasetDraw(chart) {
    chart.ctx.restore();
  }
};

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 450 },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false, external: chartTooltip }
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(203, 220, 244, 0.62)', font: { family: 'DM Mono', size: 8 }, maxRotation: 0, autoSkip: true } },
      y: { beginAtZero: true, border: { display: false }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: 'rgba(203, 220, 244, 0.62)', precision: 0, font: { family: 'DM Mono', size: 8 } } }
    }
  };
}
function renderCharts(data) {
  if (typeof Chart === 'undefined') {
    $$('.chart-wrap').forEach(element => { element.innerHTML = '<div class="empty-state">Chart library could not be loaded. Connect to the internet and refresh.</div>'; });
    return;
  }
  const student = [...data.student_frequency].sort((a, b) => b.login_count - a.login_count).slice(0, 10);
  const staff = [...data.staff_frequency].sort((a, b) => b.login_count - a.login_count).slice(0, 8);
  const highRiskUsers = new Set((data.alerts || []).filter(alert => ['High', 'Critical'].includes(alert.risk_level)).map(alert => `${alert.role}:${alert.user_id}`));
  const normalCount = Number(data.normal_vs_suspicious?.[0] || 0);
  const suspiciousCount = Number(data.normal_vs_suspicious?.[1] || 0);
  const healthPercent = normalCount + suspiciousCount ? Math.round(normalCount / (normalCount + suspiciousCount) * 100) : 100;
  $('#health-center strong').textContent = `${healthPercent}%`;
  const shared = chartDefaults();
  const frequencyCanvas = $('#frequency-chart');
  dashboardCharts.get('frequency')?.destroy();
  dashboardCharts.set('frequency', new Chart(frequencyCanvas, {
    type: 'bar',
    data: { labels: [...student.map(row => row.user_id), ...staff.map(row => row.user_id)], datasets: [
      { label: 'Students', data: [...student.map(row => row.login_count), ...staff.map(() => null)], backgroundColor: context => chartGradient(context, highRiskUsers.has(`student:${student[context.dataIndex]?.user_id}`) ? '239, 68, 68' : '56, 189, 248'), hoverBackgroundColor: context => chartGradient(context, '125, 211, 252', 1, 0.5), borderRadius: { topLeft: 6, topRight: 6 }, maxBarThickness: 15 },
      { label: 'Staff', data: [...student.map(() => null), ...staff.map(row => row.login_count)], backgroundColor: context => chartGradient(context, highRiskUsers.has(`staff:${staff[context.dataIndex - student.length]?.user_id}`) ? '239, 68, 68' : '52, 211, 153'), hoverBackgroundColor: context => chartGradient(context, '110, 231, 183', 1, 0.5), borderRadius: { topLeft: 6, topRight: 6 }, maxBarThickness: 15 }
    ] },
    options: { ...shared, scales: { ...shared.scales, x: { ...shared.scales.x, ticks: { ...shared.scales.x.ticks, maxTicksLimit: 12 } } } },
    plugins: [chartGlowPlugin]
  }));
  dashboardCharts.get('hour')?.destroy();
  dashboardCharts.set('hour', new Chart($('#hour-chart'), {
    type: 'bar',
    data: { labels: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`), datasets: [{ data: data.hourly_activity, backgroundColor: context => chartGradient(context, '56, 189, 248'), hoverBackgroundColor: context => chartGradient(context, '125, 211, 252', 1, 0.5), borderRadius: { topLeft: 6, topRight: 6 }, maxBarThickness: 13 }] },
    options: { ...shared, scales: { ...shared.scales, x: { ...shared.scales.x, ticks: { ...shared.scales.x.ticks, maxTicksLimit: 8 } } } },
    plugins: [chartGlowPlugin]
  }));
  dashboardCharts.get('health')?.destroy();
  dashboardCharts.set('health', new Chart($('#health-chart'), {
    type: 'doughnut',
    data: { labels: ['Normal', 'Suspicious'], datasets: [{ data: data.normal_vs_suspicious, backgroundColor: context => chartGradient(context, context.dataIndex === 1 ? '239, 68, 68' : '59, 130, 246', 0.85, 0.3), hoverBackgroundColor: context => context.dataIndex === 1 ? 'rgba(251, 113, 133, 0.98)' : 'rgba(96, 165, 250, 0.98)', borderColor: 'rgba(18, 24, 38, 0.92)', borderWidth: 3, borderRadius: 8, hoverOffset: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '69%', plugins: { legend: { display: false }, tooltip: { enabled: false, external: chartTooltip } } },
    plugins: [chartGlowPlugin]
  }));
}

function renderLogicAlerts(alerts, targetId = 'logic-alerts', full = false) {
  const target = document.getElementById(targetId);
  if (!target) return;
  if (!alerts?.length) { target.innerHTML = '<div class="empty-state">No Java logic-rule alerts are available.</div>'; return; }
  alerts.forEach(alert => alertById.set(alert.event_id, alert));
  target.innerHTML = alerts.map(alert => full ? `<article class="full-alert alert-interactive" data-alert-id="${escapeHtml(alert.event_id)}" tabindex="0" role="button" aria-label="View ${escapeHtml(alert.risk_level)} alert details"><div class="full-alert-head"><b>${escapeHtml(alert.rule_name)}</b><span class="risk-tag ${riskClass(alert.risk_level)}">${escapeHtml(alert.risk_level)}</span></div><p>${escapeHtml(alert.reason)}</p><div class="full-alert-meta"><span>${escapeHtml(alert.user_id)} · ${escapeHtml(alert.role)}</span><span>${formatDateTime(alert.login_time)}</span><span>${escapeHtml(alert.device_name)}</span></div><div class="full-alert-action"><b>Conditions:</b> ${escapeHtml(alert.conditions)}<br><b>Suggested action:</b> ${escapeHtml(alert.suggested_action)}</div></article>` : `<article class="alert-item alert-interactive" data-alert-id="${escapeHtml(alert.event_id)}" tabindex="0" role="button" aria-label="View ${escapeHtml(alert.risk_level)} alert details"><div class="alert-item-top"><strong>${escapeHtml(alert.rule_name)}</strong><span class="risk-tag ${riskClass(alert.risk_level)}">${escapeHtml(alert.risk_level)}</span></div><p>${escapeHtml(alert.reason)}</p><div class="alert-item-meta">${escapeHtml(alert.user_id)} · ${formatDateTime(alert.login_time)}</div></article>`).join('');
}

function ensureDetailDialog() {
  let dialog = $('#security-detail-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'security-detail-dialog';
  dialog.className = 'security-detail-dialog';
  dialog.innerHTML = '<div class="dialog-shell"><header class="dialog-head"><div><p class="eyebrow" id="dialog-kicker">SECURITY EVENT</p><h2 id="dialog-title">Activity details</h2></div><button class="dialog-close" type="button" aria-label="Close details">×</button></header><div class="dialog-body" id="dialog-body"></div></div>';
  document.body.append(dialog);
  $('.dialog-close', dialog).addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  return dialog;
}

function openDetailDialog(record, isAlert = false) {
  const dialog = ensureDetailDialog();
  $('#dialog-kicker', dialog).textContent = isAlert ? 'JAVA RULE ENGINE / ALERT DETAIL' : 'LOGIN EVENT / ACTIVITY DETAIL';
  $('#dialog-title', dialog).textContent = isAlert ? record.rule_name : `${record.user_id} · ${record.login_status}`;
  const fields = isAlert
    ? [['Affected account', `${record.user_name} · ${record.user_id}`], ['Role', record.role], ['Risk level', record.risk_level], ['Rule', record.rule_name], ['Conditions', record.conditions], ['Reason', record.reason], ['Device', record.device_name], ['Location', record.location], ['Time', formatDateTime(record.login_time)], ['Suggested action', record.suggested_action]]
    : [['Event ID', record.event_id], ['Account', `${record.user_name} · ${record.user_id}`], ['Role', record.role], ['Time', formatDateTime(record.login_time)], ['Device', `${record.device_name} · ${record.device_type}`], ['Location', record.location], ['IP address', record.ip_address], ['Login status', record.login_status], ['Risk level', record.risk_level || 'Low'], ['Rule', record.rule_name || 'No rule match'], ['Conditions', record.conditions || '—'], ['Suggested action', record.suggested_action || 'No action required']];
  $('#dialog-body', dialog).innerHTML = fields.map(([label, value]) => `<div class="dialog-field"><span>${escapeHtml(label)}</span><b>${escapeHtml(value || '—')}</b></div>`).join('');
  if (!dialog.open) dialog.showModal();
}

function renderPythonAlerts(alerts, summaryId = 'python-summary', listId = 'python-results', full = false) {
  const summary = document.getElementById(summaryId);
  const list = document.getElementById(listId);
  if (!list) return;
  if (!alerts?.length) {
    if (summary) summary.textContent = 'No statistical anomalies flagged. Run analysis after new events to refresh results.';
    list.innerHTML = '';
    return;
  }
  if (summary) summary.textContent = `${alerts.length} account${alerts.length === 1 ? '' : 's'} flagged by frequency or z-score analysis.`;
  list.innerHTML = alerts.slice(0, full ? 200 : 5).map(alert => full ? `<article class="full-alert"><div class="full-alert-head"><b>${escapeHtml(alert.user_id)} · ${escapeHtml(alert.role)}</b><span class="risk-tag ${riskClass(alert.risk_level)}">${escapeHtml(alert.risk_level)}</span></div><p>${escapeHtml(alert.anomaly_reason)}</p><div class="full-alert-meta"><span>${Number(alert.login_count)} logins</span><span>Mean ${Number(alert.average_login_count).toFixed(2)}</span><span>z = ${Number(alert.z_score).toFixed(2)}</span></div></article>` : `<div class="python-result"><span>${escapeHtml(alert.user_id)} · ${escapeHtml(alert.role)}</span><b class="risk-tag ${riskClass(alert.risk_level)}">${escapeHtml(alert.risk_level)}</b></div>`).join('');
}

function buildEventQuery() {
  const params = new URLSearchParams();
  const role = $('#filter-role')?.value || 'all';
  const date = $('#filter-date')?.value || '';
  const risk = $('#filter-risk')?.value || 'all';
  const device = $('#filter-device')?.value.trim() || '';
  if (role !== 'all') params.set('role', role);
  if (date) params.set('date', date);
  if (risk !== 'all') params.set('risk', risk);
  if (device) params.set('device', device);
  if ($('#filter-suspicious')?.checked) params.set('suspicious', 'true');
  return params.toString();
}
let eventFilterTimer;
async function loadEvents() {
  const query = buildEventQuery();
  try { renderEventRows(await api(`/api/admin/events${query ? `?${query}` : ''}`)); }
  catch (error) { $('#events-body').innerHTML = `<tr><td colspan="8" class="empty-state">${escapeHtml(error.message)}</td></tr>`; }
}

async function runAnalysis() {
  const buttons = $$('[id="run-analysis"]');
  buttons.forEach(button => { button.disabled = true; button.dataset.originalText = button.textContent; button.textContent = 'Analyzing…'; });
  const summary = $('#python-summary');
  if (summary) summary.textContent = 'Calculating account frequency and z-scores…';
  try {
    const result = await api('/api/admin/analyze', { method: 'POST' });
    if (!result.ok) throw new Error(result.message || 'Analysis could not be completed.');
    renderPythonAlerts(result.alerts, 'python-summary', 'python-results');
    renderPythonAlerts(result.alerts, 'python-summary', 'all-python-alerts', true);
    if (summary && !result.alerts.length) summary.textContent = result.message;
  } catch (error) { if (summary) summary.textContent = error.message; }
  finally { buttons.forEach(button => { button.disabled = false; button.textContent = button.dataset.originalText || 'Run analysis'; }); }
}

async function setupDashboard() {
  try {
    const data = await api('/api/admin/dashboard');
    renderMetrics(data.totals);
    $('#updated-at').textContent = `Snapshot ${formatDateTime(data.generated_at)}`;
    renderCharts(data);
    renderLogicAlerts(data.alerts);
    renderPythonAlerts(data.python_alerts);
    await loadEvents();
  } catch (error) {
    $('#metric-grid').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    $('#events-body').innerHTML = `<tr><td colspan="8" class="empty-state">Could not load campus activity: ${escapeHtml(error.message)}</td></tr>`;
  }
  ['filter-role', 'filter-date', 'filter-risk', 'filter-suspicious'].forEach(id => document.getElementById(id)?.addEventListener('change', loadEvents));
  $('#filter-device')?.addEventListener('input', () => { clearTimeout(eventFilterTimer); eventFilterTimer = setTimeout(loadEvents, 250); });
  $('#reset-filters')?.addEventListener('click', () => { $('#filter-role').value = 'all'; $('#filter-date').value = ''; $('#filter-risk').value = 'all'; $('#filter-device').value = ''; $('#filter-suspicious').checked = false; loadEvents(); });
}

let graphInstance;
async function loadGraph() {
  const role = location.pathname.includes('staff-graph') ? 'staff' : 'student';
  const title = role === 'staff' ? 'Staff login graph' : 'Student login graph';
  $('#graph-title').textContent = title;
  $('#student-graph-nav').classList.toggle('active', role === 'student');
  $('#staff-graph-nav').classList.toggle('active', role === 'staff');
  const params = new URLSearchParams({ role });
  const user = $('#graph-user').value.trim();
  const date = $('#graph-date').value;
  const device = $('#graph-device').value.trim();
  if (user) params.set('user', user);
  if (date) params.set('date', date);
  if (device) params.set('device', device);
  if ($('#graph-suspicious').checked) params.set('suspicious', 'true');
  $('#graph-total').textContent = 'Loading relationship data…';
  try {
    const result = await api(`/api/admin/graph?${params}`);
    $('#graph-total').textContent = `${result.event_count} login events shown`;
    if (typeof cytoscape === 'undefined') { $('#network').innerHTML = '<div class="empty-state">Graph library could not be loaded. Connect to the internet and refresh.</div>'; return; }
    graphInstance?.destroy();
    graphInstance = cytoscape({ container: $('#network'), elements: [...result.elements.nodes, ...result.elements.edges], minZoom: .15, maxZoom: 3,
      style: [
        { selector: 'node', style: { 'label': 'data(label)', 'font-family': 'DM Mono', 'font-size': 8, 'color': '#c6d8ef', 'text-wrap': 'wrap', 'text-max-width': 95, 'text-valign': 'bottom', 'text-margin-y': 6, 'width': 24, 'height': 24, 'background-color': '#38bdf8', 'border-width': 1, 'border-color': 'rgba(226,238,255,0.8)', 'overlay-color': '#38bdf8', 'overlay-padding': 5, 'overlay-opacity': 0.12, 'text-outline-color': '#080d17', 'text-outline-width': 2 } },
        { selector: 'node[kind = "user"]', style: { 'shape': 'ellipse', 'background-color': '#3b82f6', 'width': 31, 'height': 31, 'color': '#dbeafe', 'overlay-color': '#3b82f6', 'overlay-padding': 8, 'overlay-opacity': 0.2 } },
        { selector: 'node[kind = "device"]', style: { 'shape': 'round-rectangle', 'background-color': '#14b8a6', 'width': 23, 'height': 23, 'color': '#ccfbf1', 'overlay-color': '#2dd4bf', 'overlay-padding': 6, 'overlay-opacity': 0.17 } },
        { selector: 'node[kind = "event"]', style: { 'shape': 'ellipse', 'background-color': '#fbbf24', 'width': 15, 'height': 15, 'font-size': 7, 'color': '#fef3c7', 'overlay-color': '#fbbf24', 'overlay-padding': 6, 'overlay-opacity': 0.18 } },
        { selector: 'node[kind = "location"]', style: { 'shape': 'diamond', 'background-color': '#818cf8', 'width': 25, 'height': 25, 'color': '#e0e7ff', 'overlay-color': '#818cf8', 'overlay-padding': 7, 'overlay-opacity': 0.16 } },
        { selector: 'node.suspicious', style: { 'background-color': '#ef4444', 'border-color': '#fecaca', 'border-width': 3, 'color': '#ffe4e6', 'overlay-color': '#ef4444', 'overlay-padding': 12, 'overlay-opacity': 0.3 } },
        { selector: 'edge', style: { 'width': 1, 'line-color': 'rgba(148,163,184,0.48)', 'target-arrow-color': 'rgba(148,163,184,0.48)', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': .55, 'opacity': .8 } },
        { selector: 'edge.suspicious', style: { 'line-color': '#fb7185', 'target-arrow-color': '#fb7185', 'width': 2, 'opacity': 1 } },
        { selector: ':selected', style: { 'border-width': 3, 'border-color': '#67e8f9', 'line-color': '#67e8f9', 'target-arrow-color': '#67e8f9', 'overlay-color': '#22d3ee', 'overlay-padding': 11, 'overlay-opacity': 0.28 } }
      ], layout: { name: 'cose', animate: true, animationDuration: 420, fit: true, padding: 36, nodeRepulsion: 5000, idealEdgeLength: 65, gravity: .2, numIter: 550 } });
    $('.graph-loading')?.remove();
    graphInstance.on('tap', 'node', event => renderNodeDetails(event.target.data()));
    graphInstance.on('tap', event => { if (event.target === graphInstance) { $('#inspector-title').textContent = 'Select a node'; $('#inspector-content').innerHTML = '<div class="inspector-empty">Choose a user, device, location, or event on the graph to inspect associated details.</div>'; } });
  } catch (error) {
    $('#graph-total').textContent = error.message;
    $('#network').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}
function renderNodeDetails(data) {
  const kind = data.kind || 'event';
  $('#inspector-title').textContent = kind === 'event' ? (data.event?.event_id || 'Login event') : data.label;
  if (kind === 'event' && data.event) {
    const event = data.event;
    const fields = [['Account', `${event.user_name} · ${event.user_id}`], ['Role', event.role], ['Time', formatDateTime(event.login_time)], ['Device', `${event.device_name} · ${event.device_type}`], ['Location', event.location], ['IP address', event.ip_address], ['Status', event.login_status], ['Risk', event.risk_level], ['Rule', event.rule_name || 'No rule match'], ['Conditions', event.conditions || '—'], ['Reason', event.reason || 'No rule match']];
    $('#inspector-content').innerHTML = fields.map(([label, value]) => `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value)}</span></div>`).join('');
  } else {
    const fields = kind === 'user' ? [['Entity', 'Campus account'], ['Role', data.role], ['Account ID', data.id]] : kind === 'device' ? [['Entity', 'Campus device'], ['Device type', data.device_type], ['Device ID', data.id]] : [['Entity', 'Campus location'], ['Location ID', data.id]];
    $('#inspector-content').innerHTML = fields.map(([label, value]) => `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value)}</span></div>`).join('');
  }
}
function setupGraph() {
  $('#graph-apply').addEventListener('click', loadGraph);
  ['graph-user', 'graph-device'].forEach(id => document.getElementById(id).addEventListener('keydown', event => { if (event.key === 'Enter') loadGraph(); }));
  $('#zoom-in').addEventListener('click', () => graphInstance?.zoom({ level: graphInstance.zoom() * 1.2, renderedPosition: { x: $('#network').clientWidth / 2, y: $('#network').clientHeight / 2 } }));
  $('#zoom-out').addEventListener('click', () => graphInstance?.zoom({ level: graphInstance.zoom() / 1.2, renderedPosition: { x: $('#network').clientWidth / 2, y: $('#network').clientHeight / 2 } }));
  $('#fit-graph').addEventListener('click', () => graphInstance?.fit(undefined, 35));
  loadGraph();
}

let refreshTimer;
let clockTimer;

function updateLiveTime() {
  const time = $('#live-time');
  if (time) time.textContent = new Date().toLocaleTimeString([], { hour12: false });
}

async function refreshDashboard() {
  const refreshButton = $('#refresh-dashboard');
  refreshButton?.classList.add('is-refreshing');
  try {
    const data = await api('/api/admin/dashboard');
    renderMetrics(data.totals);
    renderCharts(data);
    renderLogicAlerts(data.alerts);
    renderPythonAlerts(data.python_alerts);
    $('#updated-at').textContent = `Updated ${formatDateTime(data.generated_at)}`;
    await loadEvents();
  } catch (error) {
    $('#events-body').innerHTML = `<tr><td colspan="8" class="empty-state">Refresh failed: ${escapeHtml(error.message)}</td></tr>`;
  } finally {
    refreshButton?.classList.remove('is-refreshing');
  }
}

function setupDetailInteractions() {
  document.addEventListener('click', event => {
    const row = event.target.closest('#events-body tr[data-event-id]');
    if (row) {
      const record = eventById.get(row.dataset.eventId);
      if (record) openDetailDialog(record);
      return;
    }
    const alertCard = event.target.closest('[data-alert-id]');
    if (alertCard) {
      const alert = alertById.get(alertCard.dataset.alertId);
      if (alert) openDetailDialog(alert, true);
    }
  });
  document.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key)) return;
    const target = event.target.closest('#events-body tr[data-event-id], [data-alert-id]');
    if (!target) return;
    event.preventDefault();
    target.click();
  });
}

async function setupAlerts() {
  try {
    const alerts = await api('/api/admin/alerts');
    $('#alert-count').textContent = `${alerts.length} rule matches`;
    renderLogicAlerts(alerts, 'all-logic-alerts', true);
  } catch (error) { $('#all-logic-alerts').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
  try {
    const dashboard = await api('/api/admin/dashboard');
    renderPythonAlerts(dashboard.python_alerts, 'python-summary', 'all-python-alerts', true);
  } catch (error) { $('#all-python-alerts').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}

async function setupDmgt() {
  try {
    const alerts = await api('/api/admin/alerts');
    $('#dmgt-alert-count').textContent = `${alerts.length} matching events`;
    $('#dmgt-live-count').textContent = `${alerts.length} rule matches`;
    renderLogicAlerts(alerts.slice(0, 30), 'dmgt-live-list');
  } catch (error) {
    $('#dmgt-alert-count').textContent = 'Unavailable';
    $('#dmgt-live-count').textContent = '0 rule matches';
    $('#dmgt-live-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function setupDashboardControls() {
  updateLiveTime();
  clockTimer = setInterval(updateLiveTime, 1000);
  const autoRefresh = $('#auto-refresh');
  const updateRefreshTimer = () => {
    clearInterval(refreshTimer);
    if (autoRefresh.checked) refreshTimer = setInterval(refreshDashboard, 60 * 60 * 1000);
  };
  autoRefresh.addEventListener('change', updateRefreshTimer);
  $('#refresh-dashboard').addEventListener('click', refreshDashboard);
  updateRefreshTimer();
}

function setupLogout() {
  $$('[data-logout]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await api('/api/logout', { method: 'POST' }); } catch { /* Continue to login if the session has already expired. */ }
    location.assign('/admin-login');
  }));
}

setupPasswordToggles();
setupLogout();
const page = document.body.dataset.page;
if (page === 'portal') setupPortal();
if (page === 'admin-login') setupAdminLogin();
if (page === 'dashboard') { setupDashboard(); setupDashboardControls(); }
if (page === 'graph') setupGraph();
if (page === 'alerts') setupAlerts();
if (page === 'dmgt') setupDmgt();
if (page === 'dashboard' || page === 'alerts' || page === 'dmgt') setupDetailInteractions();
$$('[id="run-analysis"]').forEach(button => button.addEventListener('click', runAnalysis));
