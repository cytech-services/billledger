// ── State ───────────────────────────────────────────────────────────────
let allBills = [];
let payingBillId = null;
let editingPaymentId = null;
let editingBillId = null;
let customDates = [];
let currentYear = new Date().getFullYear();
let currentSettingsTab = 'methods';
let paymentMethods = [];
let paymentMethodStats = {};
let backups = [];
let backupStatus = null;
const DEFAULT_METHOD_OPTIONS = ['Credit Card','Debit Card','Bank Transfer','Check','Cash','Auto-Pay'];
const VALID_PAGES = ['dashboard','bills','yearview','log','settings'];
const VALID_SETTINGS_TABS = ['methods', 'backups'];

// ── API ─────────────────────────────────────────────────────────────────
async function api(method, url, body) {
  const endpoint = (window.BILLLEDGER_API_BASE || 'http://127.0.0.1:3001') + url;
  const opts = {method, headers:{'Content-Type':'application/json'}};
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(endpoint, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Payment Methods ───────────────────────────────────────────────────────
function uniqueMethods(list) {
  const seen = new Set();
  const result = [];
  list.forEach((name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  });
  return result.sort((a,b)=>a.localeCompare(b));
}

function renderPaymentMethodSuggestions() {
  const options = uniqueMethods([...DEFAULT_METHOD_OPTIONS, ...paymentMethods]);
  const html = options.map((name)=>`<option value="${esc(name)}">`).join('');
  const methodList = document.getElementById('method-suggestions');
  const payMethodList = document.getElementById('pay-method-suggestions');
  if (methodList) methodList.innerHTML = html;
  if (payMethodList) payMethodList.innerHTML = html;
}

async function loadPaymentMethods() {
  try {
    paymentMethods = await api('GET','/api/payment-methods');
  } catch {
    paymentMethods = [...DEFAULT_METHOD_OPTIONS];
  }
  renderPaymentMethodSuggestions();
}

async function loadPaymentMethodStats() {
  try {
    const rows = await api('GET','/api/payment-methods/stats');
    paymentMethodStats = {};
    rows.forEach((row) => {
      paymentMethodStats[String(row.name || '').toLowerCase()] = row;
    });
  } catch {
    paymentMethodStats = {};
  }
}

function getMethodStats(name) {
  return paymentMethodStats[String(name || '').toLowerCase()] || {
    bill_count: 0,
    payment_count: 0,
    total_paid: 0
  };
}

async function refreshPaymentMethodsData() {
  await loadPaymentMethods();
  await loadPaymentMethodStats();
  renderSettingsPaymentMethods();
}

function fmtBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

async function savePaymentMethodOption(methodName) {
  const name = String(methodName || '').trim();
  if (!name) return false;
  await api('POST','/api/payment-methods',{name});
  if (!paymentMethods.some((x)=>x.toLowerCase()===name.toLowerCase())) {
    paymentMethods.push(name);
    renderPaymentMethodSuggestions();
  }
  return true;
}

async function savePaidWithOption() {
  const method = document.getElementById('p-method').value.trim();
  if (!method) { toast('Enter a method first.','err'); return; }
  try {
    await savePaymentMethodOption(method);
    toast('Saved as a permanent option.','ok');
  } catch(e) {
    toast('Error saving method: '+e.message,'err');
  }
}

function renderSettingsPaymentMethods() {
  const el = document.getElementById('st-method-list');
  if (!el) return;
  const options = uniqueMethods(paymentMethods);
  if (!options.length) {
    el.innerHTML = '<div class="none-msg">No payment methods saved yet.</div>';
    return;
  }
  el.innerHTML = options.map((name, i)=>{
    const st = getMethodStats(name);
    return `
      <div class="method-row">
        <div>
          <div class="method-name">${esc(name)}</div>
          <div class="method-meta">${st.bill_count} bill${st.bill_count===1?'':'s'} used · ${fmtMoney(st.total_paid)} total paid</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="removePaymentMethodFromSettingsByIndex(${i})">Remove</button>
      </div>
    `;
  }).join('');
}

async function addPaymentMethodFromSettings() {
  const input = document.getElementById('st-new-method');
  const name = input.value.trim();
  if (!name) { toast('Enter a method name first.','err'); return; }
  try {
    await savePaymentMethodOption(name);
    input.value = '';
    await refreshPaymentMethodsData();
    toast('Payment method added.','ok');
  } catch(e) {
    toast('Error saving method: '+e.message,'err');
  }
}

function parseApiError(err) {
  try {
    return JSON.parse(err.message);
  } catch {
    return { error: err.message || 'Request failed' };
  }
}

async function replaceMethodAndDelete(oldName, details) {
  const choices = uniqueMethods(paymentMethods).filter((x)=>x.toLowerCase()!==String(oldName).toLowerCase());
  if (!choices.length) {
    toast('Add another method first, then replace and delete.','err');
    return;
  }

  const replacement = (prompt(
    `"${oldName}" is used by ${details?.payment_count || 0} payment(s). Enter a replacement method to apply before deleting.`,
    choices[0]
  ) || '').trim();

  if (!replacement) return;
  if (replacement.toLowerCase() === String(oldName).toLowerCase()) {
    toast('Replacement method must be different.','err');
    return;
  }

  await savePaymentMethodOption(replacement);
  const rep = await api('POST','/api/payment-methods/replace',{
    from: oldName,
    to: replacement,
    replace_bill_defaults: true
  });
  await api('DELETE', `/api/payment-methods/${encodeURIComponent(oldName)}`);
  await refreshPaymentMethodsData();
  toast(`Replaced ${rep.paymentsUpdated} payment${rep.paymentsUpdated===1?'':'s'} and removed "${oldName}".`,'ok');
}

async function removePaymentMethodFromSettings(name) {
  if (!confirm(`Remove "${name}" from saved methods?`)) return;
  try {
    await api('DELETE', `/api/payment-methods/${encodeURIComponent(name)}`);
    await refreshPaymentMethodsData();
    toast('Payment method removed.','ok');
  } catch(e) {
    const details = parseApiError(e);
    if (details.requires_replacement) {
      await replaceMethodAndDelete(name, details);
      return;
    }
    toast(details.error || 'Error removing method.','err');
  }
}

function removePaymentMethodFromSettingsByIndex(index) {
  const options = uniqueMethods(paymentMethods);
  const name = options[index];
  if (!name) return;
  removePaymentMethodFromSettings(name);
}

async function loadBackups() {
  const [items, status] = await Promise.all([
    api('GET', '/api/backups'),
    api('GET', '/api/backups/status')
  ]);
  backups = items;
  backupStatus = status;
  renderBackupStatus();
  renderSettingsBackups();
}

function renderBackupStatus() {
  const el = document.getElementById('st-backup-status');
  if (!el) return;
  if (!backupStatus) {
    el.textContent = 'Unable to load backup status.';
    return;
  }
  const last = backupStatus.last_automatic_backup;
  if (!last) {
    el.textContent = `No automatic backup has run yet. Daily backups are enabled. Retention: ${backupStatus.retention_days} days.`;
    return;
  }
  el.textContent = `Last automatic backup: ${fmtDateTime(last.created_at)} (${fmtBytes(last.size)}). Retention: ${backupStatus.retention_days} days.`;
}

function renderSettingsBackups() {
  const el = document.getElementById('st-backup-list');
  if (!el) return;
  if (!backups.length) {
    el.innerHTML = '<div class="none-msg">No backups found yet.</div>';
    return;
  }
  el.innerHTML = backups.map((b, i) => `
    <div class="method-row">
      <div>
        <div class="method-name">${esc(b.filename)}</div>
        <div class="method-meta">${fmtDateTime(b.created_at)} · ${fmtBytes(b.size)}</div>
      </div>
      <div class="backup-actions">
        <button class="btn btn-ghost btn-sm" onclick="downloadBackupByIndex(${i})">Download</button>
        <button class="btn btn-danger btn-sm" onclick="restoreBackupByIndex(${i})">Restore</button>
      </div>
    </div>
  `).join('');
}

async function runManualBackup() {
  const btn = document.getElementById('st-manual-backup-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  try {
    await api('POST', '/api/backups');
    await loadBackups();
    toast('Manual backup created.','ok');
  } catch (e) {
    toast('Backup failed: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Run Manual Backup'; }
  }
}

function downloadBackupByIndex(index) {
  const item = backups[index];
  if (!item) return;
  const base = window.BILLLEDGER_API_BASE || 'http://127.0.0.1:3001';
  const url = `${base}/api/backups/${encodeURIComponent(item.filename)}/download`;
  window.open(url, '_blank');
}

async function restoreBackupByIndex(index) {
  const item = backups[index];
  if (!item) return;
  const ok = confirm(`Restore backup "${item.filename}"?\n\nThis will replace the current database and cannot be undone except by another backup.`);
  if (!ok) return;
  try {
    await api('POST', '/api/backups/restore', { filename: item.filename });
    await Promise.all([loadBackups(), refreshPaymentMethodsData()]);
    toast('Backup restored successfully. Refreshing dashboard...','ok');
    loadDashboard();
    loadBillsTable();
    loadLog();
    loadYearView();
  } catch (e) {
    toast('Restore failed: ' + e.message, 'err');
  }
}

function switchSettingsTab(tab, btn) {
  const safeTab = VALID_SETTINGS_TABS.includes(String(tab || '').toLowerCase()) ? String(tab || '').toLowerCase() : 'methods';
  currentSettingsTab = safeTab;
  document.querySelectorAll('.settings-side button').forEach((b)=>b.classList.remove('active'));
  const activeButton = btn || document.getElementById(`st-tab-${safeTab}`);
  if (activeButton) activeButton.classList.add('active');
  document.querySelectorAll('.settings-pane').forEach((p)=>p.classList.remove('active'));
  const pane = document.getElementById(`st-pane-${safeTab}`);
  if (pane) pane.classList.add('active');
  if (safeTab==='methods') renderSettingsPaymentMethods();
  if (safeTab==='backups') renderSettingsBackups();
}

async function loadSettingsPage() {
  const tabButton = document.getElementById(`st-tab-${currentSettingsTab}`);
  switchSettingsTab(currentSettingsTab, tabButton);
  if (currentSettingsTab === 'methods') {
    await refreshPaymentMethodsData();
  } else if (currentSettingsTab === 'backups') {
    await loadBackups();
  }
}

// ── Navigation ──────────────────────────────────────────────────────────
function normalizePage(page) {
  const p = String(page || '').toLowerCase();
  return VALID_PAGES.includes(p) ? p : 'dashboard';
}

function normalizeSettingsTab(tab) {
  const t = String(tab || '').toLowerCase();
  return VALID_SETTINGS_TABS.includes(t) ? t : 'methods';
}

function currentRouteFromHash() {
  const hashValue = window.location.hash.replace(/^#/, '').trim();
  const [rawPage = 'dashboard', rawSettingsTab = ''] = hashValue.split('/');
  const page = normalizePage(rawPage);
  const settingsTab = page === 'settings' ? normalizeSettingsTab(rawSettingsTab || currentSettingsTab) : currentSettingsTab;
  return { page, settingsTab };
}

function activatePage(route) {
  const targetPage = normalizePage(route?.page || route);
  const targetSettingsTab = normalizeSettingsTab(route?.settingsTab || currentSettingsTab);
  if (targetPage === 'settings') currentSettingsTab = targetSettingsTab;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('pg-'+targetPage).classList.add('active');
  const navBtn = document.querySelector(`nav button[data-page="${targetPage}"]`);
  if (navBtn) navBtn.classList.add('active');
  if (targetPage==='dashboard') loadDashboard();
  if (targetPage==='bills')     loadBillsTable();
  if (targetPage==='yearview')  loadYearView();
  if (targetPage==='log')       loadLog();
  if (targetPage==='settings')  loadSettingsPage();
}

function nav(page) {
  const targetPage = normalizePage(page);
  const targetHash = targetPage === 'settings' ? `#settings/${currentSettingsTab}` : `#${targetPage}`;
  if (window.location.hash === targetHash) {
    activatePage({ page: targetPage, settingsTab: currentSettingsTab });
    return;
  }
  window.location.hash = targetPage === 'settings' ? `settings/${currentSettingsTab}` : targetPage;
}

function navSettingsTab(tab) {
  const targetTab = normalizeSettingsTab(tab);
  currentSettingsTab = targetTab;
  const targetHash = `#settings/${targetTab}`;
  if (window.location.hash === targetHash) {
    activatePage({ page: 'settings', settingsTab: targetTab });
    return;
  }
  window.location.hash = `settings/${targetTab}`;
}

// ── Date helpers ─────────────────────────────────────────────────────────
function today() { return new Date(new Date().toDateString()); }
function estimatedTaxScheduleForYear(year) {
  return [
    new Date(year, 0, 15),
    new Date(year, 3, 15),
    new Date(year, 5, 15),
    new Date(year, 8, 15),
  ];
}
function calcEstimatedTaxNextDue(baseDate = today()) {
  const t = new Date(baseDate);
  const candidates = [
    ...estimatedTaxScheduleForYear(t.getFullYear()),
    ...estimatedTaxScheduleForYear(t.getFullYear() + 1),
  ];
  return candidates.find((d) => d >= t) || null;
}
function calcNextDue(bill) {
  const t = today(), f = bill.frequency;
  if (f==='Monthly') {
    const day = parseInt(bill.due_day); if (!day) return null;
    let d = new Date(t.getFullYear(), t.getMonth(), day);
    if (d<=t) d = new Date(t.getFullYear(), t.getMonth()+1, day);
    return d;
  }
  if (f==='Weekly') {
    const day = bill.due_day; if (day==null) return null;
    const pyDay = ((parseInt(day)-1)%7+7)%7;
    const jsDay = pyDay===6?0:pyDay+1;
    const d = new Date(t);
    d.setDate(d.getDate()+((jsDay-d.getDay()+7)%7||7));
    return d;
  }
  if (f==='Custom') {
    if (!bill._customNextDue) return null;
    return new Date(bill._customNextDue+'T00:00:00');
  }
  if (f==='Estimated Tax (US/NY)') {
    return calcEstimatedTaxNextDue(t);
  }
  if (bill.next_date) {
    const d = new Date(bill.next_date+'T00:00:00');
    return d > t ? d : d;
  }
  return null;
}
function daysUntil(d) { return d ? Math.round((d-today())/86400000) : null; }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d instanceof Date ? d : d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function fmtMoney(n) {
  if (n==null||n==='') return '—';
  return '$'+parseFloat(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function monthName(ym) {
  const [y,m] = ym.split('-');
  return new Date(y,m-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
}

// ── Status ───────────────────────────────────────────────────────────────
function getStatus(bill) {
  const nd = calcNextDue(bill);
  const days = daysUntil(nd);
  const lastPay = bill._lastPay;
  if (lastPay && nd) {
    const payDt = new Date(lastPay.paid_date+'T00:00:00');
    const cycleStart = getCycleStart(bill, nd);
    if (payDt >= cycleStart) return 'paid';
  }
  if (bill.frequency==='Custom') {
    // For custom bills, treat as upcoming unless we can determine otherwise
    return 'upcoming';
  }
  if (days===null) return 'upcoming';
  if (days<0)  return 'overdue';
  if (days<=15) return 'due-soon';
  return 'upcoming';
}
function getCycleStart(bill, nd) {
  const d = new Date(nd);
  const f = bill.frequency;
  if (f==='Estimated Tax (US/NY)') {
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    if (month===1) return new Date(year - 1, 8, 15);
    if (month===4) return new Date(year, 0, 15);
    if (month===6) return new Date(year, 3, 15);
    if (month===9) return new Date(year, 5, 15);
  }
  const m = {Monthly:1,'Bi-Monthly':2,Quarterly:3,'Semi-Annual':6,Annual:12}[f];
  if (m) { d.setMonth(d.getMonth()-m); return d; }
  if (f==='Weekly') { d.setDate(d.getDate()-7); return d; }
  if (f==='Bi-Weekly') { d.setDate(d.getDate()-14); return d; }
  return d;
}

// ── Dashboard ────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [bills, payments] = await Promise.all([
      api('GET','/api/bills'), api('GET','/api/payments')
    ]);
    await Promise.all(
      bills
        .filter(b => b.frequency === 'Custom')
        .map(async (b) => {
          try {
            const details = await api('GET', `/api/bills/${b.id}/details`);
            b._customNextDue = details.upcoming?.[0] || null;
          } catch {
            b._customNextDue = null;
          }
        })
    );
    allBills = bills;
    const lastPayMap = {};
    payments.forEach(p => {
      if (!lastPayMap[p.bill_id]||p.paid_date>lastPayMap[p.bill_id].paid_date) lastPayMap[p.bill_id]=p;
    });
    bills.forEach(b => b._lastPay = lastPayMap[b.id]||null);
    const overdue   = bills.filter(b=>getStatus(b)==='overdue');
    const soon      = bills.filter(b=>getStatus(b)==='due-soon');
    const upcoming  = bills.filter(b=>getStatus(b)==='upcoming').sort((a,b)=>(calcNextDue(a)||new Date(9e15))-(calcNextDue(b)||new Date(9e15)));
    const paid      = bills.filter(b=>getStatus(b)==='paid');
    const t = today();
    const dueThisMonth = bills.filter((b) => {
      if (getStatus(b) === 'paid') return false;
      const nd = calcNextDue(b);
      if (!nd) return false;
      return nd.getFullYear() === t.getFullYear() && nd.getMonth() === t.getMonth();
    });
    const monthKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
    const paidThisMonthPayments = payments.filter((p) => String(p.paid_date || '').startsWith(monthKey));
    document.getElementById('s-overdue').textContent = overdue.length;
    document.getElementById('s-soon').textContent    = soon.length;
    document.getElementById('s-due-month-count').textContent = dueThisMonth.length;
    document.getElementById('s-paid-month-count').textContent = paidThisMonthPayments.length;
    const amtOverdue = overdue.reduce((s,b)=>s+(parseFloat(b.amount)||0),0);
    const amtSoon = soon.reduce((s,b)=>s+(parseFloat(b.amount)||0),0);
    const amtDueThisMonth = dueThisMonth.reduce((s,b)=>s+(parseFloat(b.amount)||0),0);
    const amtPaidThisMonth = paidThisMonthPayments.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
    document.getElementById('s-overdue-amount').textContent  = fmtMoney(amtOverdue);
    document.getElementById('s-soon-amount').textContent  = fmtMoney(amtSoon);
    document.getElementById('s-due-month-amount').textContent = fmtMoney(amtDueThisMonth);
    document.getElementById('s-paid-month-amount').textContent = fmtMoney(amtPaidThisMonth);
    renderGroup('g-overdue',  overdue,  'overdue',  'No overdue bills 🎉');
    renderGroup('g-soon',     soon,     'due-soon', 'Nothing due in the next 15 days');
    renderGroup('g-upcoming', upcoming, 'upcoming', 'No upcoming bills');
    renderGroup('g-paid',     paid,     'paid',     'No payments recorded this month');
    // Seed log filter
    const lf = document.getElementById('lf-bill'), cur=lf.value;
    lf.innerHTML = '<option value="">All Bills</option>' + bills.map(b=>`<option value="${b.id}"${cur==b.id?' selected':''}>${esc(b.name)}</option>`).join('');
    lf.value = cur;
  } catch(e) { toast('Error loading dashboard: '+e.message,'err'); }
}
function renderGroup(elId, list, status, emptyMsg) {
  const el = document.getElementById(elId);
  if (!list.length) { el.innerHTML=`<div class="none-msg">${emptyMsg}</div>`; return; }
  el.innerHTML = list.map(b=>billRowHTML(b,status)).join('');
}
function billRowHTML(bill, status) {
  const nd=calcNextDue(bill), days=daysUntil(nd);
  let daysLabel='';
  if (status==='overdue')   daysLabel=`${Math.abs(days)} day${Math.abs(days)!==1?'s':''} overdue`;
  else if (status==='due-soon') daysLabel=days===0?'Due today!':`In ${days} day${days!==1?'s':''}`;
  else if (status==='upcoming'&&nd) daysLabel=`In ${days} days`;
  else if (status==='paid'&&bill._lastPay) daysLabel=`Paid ${fmtDate(bill._lastPay.paid_date)}`;
  const labels={overdue:'⚠ Overdue','due-soon':'⏰ Due Soon',upcoming:'📅 Upcoming',paid:'✅ Paid'};
  const btn = status==='paid'
    ? `<button class="btn btn-undo btn-sm" onclick="undoPayment(${bill.id})">Undo</button>`
    : `<button class="btn btn-pay btn-sm" onclick="openPay(${bill.id})">Mark Paid</button>`;
  const paidAmount = status==='paid' && bill._lastPay && bill._lastPay.amount!=null
    ? `<div class="b-paid-amt">${fmtMoney(bill._lastPay.amount)}</div>`
    : '';
  return `<div class="brow ${status}">
    <div>
      <div class="b-name" onclick="openDetail(${bill.id})">${esc(bill.name)}</div>
      <div class="b-co">${esc(bill.company||'')}</div>
      <span class="b-freq">${bill.frequency}</span>${bill.autopay==='Yes'?'<span class="autopay-tag">AUTO-PAY</span>':''}
    </div>
    <div><div class="b-due">${nd?fmtDate(nd):'—'}</div><div class="b-days">${daysLabel}</div></div>
    <div class="b-amt-wrap">
      <div class="b-amt">${bill.amount?fmtMoney(bill.amount):'—'}</div>
      ${paidAmount}
    </div>
    <div></div>
    <div><span class="badge ${status}">${labels[status]}</span></div>
    ${btn}
  </div>`;
}

// ── Bills Table ───────────────────────────────────────────────────────────
async function loadBillsTable() {
  try {
    const bills = await api('GET','/api/bills');
    allBills = bills;
    const tbody=document.getElementById('bills-tbody'), empty=document.getElementById('bills-empty');
    if (!bills.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
    empty.style.display='none';
    tbody.innerHTML = bills.map(b=>{
      const dueD = ['Monthly'].includes(b.frequency)&&b.due_day ? `Day ${b.due_day}`
                 : b.frequency==='Weekly'&&b.due_day!=null ? `Weekday ${b.due_day}`
                 : b.frequency==='Estimated Tax (US/NY)' ? 'Jan 15, Apr 15, Jun 15, Sep 15'
                 : b.frequency==='Custom' ? 'Custom dates'
                 : b.next_date ? fmtDate(b.next_date) : '—';
      return `<tr>
        <td><strong class="b-name" style="cursor:pointer" onclick="openDetail(${b.id})">${esc(b.name)}</strong></td>
        <td class="td-muted">${esc(b.company||'—')}</td>
        <td>${b.frequency}</td><td class="td-muted">${dueD}</td>
        <td>${b.amount?fmtMoney(b.amount):'—'}</td>
        <td>${b.autopay==='Yes'?'✅ Yes':'No'}</td>
        <td class="td-muted">${esc(b.method||'—')}</td>
        <td class="td-muted" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.notes||'—')}</td>
        <td><div class="td-actions">
          <button class="btn btn-ghost btn-sm" onclick="openEdit(${b.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBill(${b.id})">Delete</button>
        </div></td>
      </tr>`;
    }).join('');
  } catch(e) { toast('Error: '+e.message,'err'); }
}

// ── Year View ─────────────────────────────────────────────────────────────
async function loadYearView() {
  document.getElementById('year-display').textContent = currentYear;
  document.getElementById('year-content').innerHTML = '<div class="none-msg" style="padding:40px">Loading…</div>';
  try {
    const data = await api('GET',`/api/year-view?year=${currentYear}`);
    const allOccurrences = (data.months || []).flatMap((m)=>m.occurrences || []);
    const overdueOccurrences = allOccurrences.filter((o)=>o.status==='overdue');
    const overdueCount = overdueOccurrences.length;
    const overdueAmount = overdueOccurrences.reduce((sum, o)=>sum + (Number(o.amount) || 0), 0);
    const overdueCards = overdueCount > 0 ? `
      <div class="year-cards-top">
        <div class="card red"><div class="card-label">Overdue</div><div class="card-value">${overdueCount}</div></div>
        <div class="card red"><div class="card-label">Amount Overdue</div><div class="card-value" style="font-size:20px">${fmtMoney(overdueAmount)}</div></div>
      </div>` : '';
    // Summary cards
    document.getElementById('year-summary').innerHTML = `
      ${overdueCards}
      <div class="year-cards-main">
        <div class="card blue"><div class="card-label">Total Bills</div><div class="card-value">${data.count}</div></div>
        <div class="card purple"><div class="card-label">Total Scheduled</div><div class="card-value" style="font-size:20px">${fmtMoney(data.year_total)}</div></div>
        <div class="card amber"><div class="card-label">Unpaid / Upcoming</div><div class="card-value" style="font-size:20px">${fmtMoney(data.year_unpaid)}</div></div>
        <div class="card green"><div class="card-label">Already Paid</div><div class="card-value" style="font-size:20px">${fmtMoney(data.year_paid_total)}</div></div>
      </div>`;
    if (!data.months.length) {
      document.getElementById('year-content').innerHTML = '<div class="none-msg" style="padding:40px">No bills scheduled for this year.</div>';
      return;
    }
    document.getElementById('year-content').innerHTML = data.months.map(m=>`
      <div class="month-section">
        <div class="month-header">
          <div class="month-name">${monthName(m.month)}</div>
          <div class="month-total">${m.occurrences.length} bill${m.occurrences.length!==1?'s':''} · unpaid: <strong>${fmtMoney(m.total_unpaid)}</strong></div>
        </div>
        ${m.occurrences.map(o=>yearRowHTML(o)).join('')}
      </div>`).join('');
  } catch(e) { toast('Error loading year view: '+e.message,'err'); }
}
function yearRowHTML(o) {
  const labels={overdue:'⚠ Overdue','due-soon':'⏰ Due Soon',upcoming:'📅 Upcoming',paid:'✅ Paid'};
  const paidInfo = o.status==='paid' && o.paid_date ? `<span style="font-size:11px;color:var(--green)">Paid ${fmtDate(o.paid_date)}${o.paid_by?' by '+esc(o.paid_by):''}</span>` : '';
  const canPay = o.status==='overdue' || o.status==='upcoming';
  const actionBtn = canPay ? `<button class="btn btn-pay btn-sm" onclick="openPayFromYear(${o.bill_id})">Mark Paid</button>` : '';
  const paidAmount = o.status==='paid' && o.paid_amount!=null
    ? `<div class="y-paid-amt">${fmtMoney(o.paid_amount)}</div>`
    : '';
  return `<div class="yrow ${o.status}">
    <div class="y-date">${fmtDate(o.due_date)}</div>
    <div><div class="y-name" onclick="openDetail(${o.bill_id})">${esc(o.bill_name)}</div>
      <div class="y-co">${esc(o.company)}${o.autopay==='Yes'?' · AUTO-PAY':''}</div>
      ${paidInfo}
    </div>
    <div class="y-amt-wrap">
      <div class="y-amt">${fmtMoney(o.amount)}</div>
      ${paidAmount}
    </div>
    <div><span class="y-freq">${o.frequency}</span></div>
    <div><span class="badge ${o.status}">${labels[o.status]}</span></div>
    <div>${actionBtn}</div>
  </div>`;
}
function changeYear(dir) { currentYear += dir; loadYearView(); }

async function openPayFromYear(billId) {
  if (!allBills.length) {
    allBills = await api('GET','/api/bills');
  }
  openPay(billId);
}

// ── Bill Detail Modal ─────────────────────────────────────────────────────
async function openDetail(billId) {
  try {
    const data = await api('GET',`/api/bills/${billId}/details`);
    const b = data.bill;
    // Header
    let metaParts = [b.frequency];
    if (b.frequency==='Monthly'&&b.due_day) metaParts.push(`Due day ${b.due_day}`);
    else if (b.next_date) metaParts.push(`Next: ${fmtDate(b.next_date)}`);
    if (b.amount) metaParts.push(fmtMoney(b.amount));
    if (b.autopay==='Yes') metaParts.push('AUTO-PAY');
    if (b.method) metaParts.push(b.method);
    document.getElementById('detail-header').innerHTML = `
      <div class="detail-bill-name">${esc(b.name)}</div>
      <div class="detail-meta">
        ${b.company?esc(b.company)+' · ':''}${metaParts.join(' · ')}
        ${b.account?'<br>Account: '+esc(b.account):''}
        ${b.notes?'<br>'+esc(b.notes):''}
      </div>`;
    document.getElementById('detail-edit-btn').onclick = () => { closeM('m-detail'); openEdit(billId); };
    // Upcoming
    const upcomingEl = document.getElementById('detail-upcoming');
    if (!data.upcoming.length) {
      upcomingEl.innerHTML = '<div class="detail-empty">No upcoming dates found.</div>';
    } else {
      const t = today();
      upcomingEl.innerHTML = data.upcoming.map(d=>{
        const dt = new Date(d+'T00:00:00');
        const days = Math.round((dt-t)/86400000);
        let badge='', label='';
        if (days<0)    { badge='overdue'; label='Overdue'; }
        else if (days<=15){ badge='due-soon'; label=days===0?'Today':`In ${days}d`; }
        else           { badge='upcoming'; label=`In ${days}d`; }
        return `<div class="detail-upcoming-row"><span>${fmtDate(d)}</span><span class="badge ${badge}">${label}</span></div>`;
      }).join('');
    }
    // History
    const histEl = document.getElementById('detail-history');
    if (!data.payments.length) {
      histEl.innerHTML = '<div class="detail-empty">No payments recorded yet.</div>';
    } else {
      histEl.innerHTML = data.payments.map(p=>`
        <div class="detail-pay-row">
          <div class="detail-pay-date">${fmtDate(p.paid_date)}<span class="detail-pay-amt">${fmtMoney(p.amount)}</span></div>
          <div class="detail-pay-meta">
            ${p.method?esc(p.method):''}${p.paid_by?' · Paid by: '+esc(p.paid_by):''}
            ${p.confirm_num?'<br>Ref: '+esc(p.confirm_num):''}
            ${p.notes?'<br>'+esc(p.notes):''}
          </div>
        </div>`).join('');
    }
    openM('m-detail');
  } catch(e) { toast('Error loading bill details: '+e.message,'err'); }
}

// ── Add/Edit Bill ─────────────────────────────────────────────────────────
function openAdd() {
  editingBillId = null; customDates = [];
  document.getElementById('m-bill-title').textContent = 'Add Bill';
  ['f-name','f-company','f-amount','f-account','f-notes','f-day','f-method'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('f-freq').value='';
  document.getElementById('f-autopay').value='No';
  document.getElementById('f-hint').style.display='none';
  document.getElementById('fg-day').style.display='flex';
  document.getElementById('custom-dates-section').classList.remove('visible');
  renderCustomDates();
  openM('m-bill');
}
async function openEdit(id) {
  editingBillId = id;
  try {
    const data = await api('GET',`/api/bills/${id}/details`);
    const b = data.bill;
    customDates = data.custom_dates||[];
    document.getElementById('m-bill-title').textContent = 'Edit Bill';
    document.getElementById('f-name').value    = b.name||'';
    document.getElementById('f-company').value = b.company||'';
    document.getElementById('f-freq').value    = b.frequency||'';
    document.getElementById('f-amount').value  = b.amount||'';
    document.getElementById('f-autopay').value = b.autopay||'No';
    document.getElementById('f-method').value  = b.method||'';
    document.getElementById('f-account').value = b.account||'';
    document.getElementById('f-notes').value   = b.notes||'';
    freqChange();
    const needsDate = !['Monthly','Weekly','Custom','Estimated Tax (US/NY)'].includes(b.frequency);
    document.getElementById('f-day').value = needsDate ? (b.next_date||'') : (b.due_day||'');
    renderCustomDates();
    openM('m-bill');
  } catch(e) { toast('Error loading bill: '+e.message,'err'); }
}
function freqChange() {
  const freq = document.getElementById('f-freq').value;
  const hint=document.getElementById('f-hint'), lbl=document.getElementById('day-label');
  const inp=document.getElementById('f-day'), fgDay=document.getElementById('fg-day');
  const cdSection=document.getElementById('custom-dates-section');
  const map={
    Monthly:      {lbl:'Due Day of Month *',hint:'Enter the calendar day (1–31) this bill is due each month.',type:'number',ph:'e.g. 15'},
    Quarterly:    {lbl:'Next Due Date *',hint:'Enter the next upcoming due date. Advances 3 months after each payment.',type:'date',ph:''},
    'Bi-Monthly': {lbl:'Next Due Date *',hint:'Enter the next upcoming due date. Advances 2 months after each payment.',type:'date',ph:''},
    'Semi-Annual':{lbl:'Next Due Date *',hint:'Enter the next upcoming due date. Advances 6 months after each payment.',type:'date',ph:''},
    Annual:       {lbl:'Next Due Date *',hint:'Enter the next upcoming due date. Advances 1 year after each payment.',type:'date',ph:''},
    Weekly:       {lbl:'Day of Week *',hint:'Enter 0=Sunday, 1=Monday, 2=Tuesday … 6=Saturday.',type:'number',ph:'e.g. 1'},
    'Bi-Weekly':  {lbl:'Next Due Date *',hint:'Enter the next upcoming due date. Advances 2 weeks after each payment.',type:'date',ph:''},
    'Estimated Tax (US/NY)': {lbl:'Schedule',hint:'Due dates are fixed to Jan 15, Apr 15, Jun 15, and Sep 15 each year.',type:'text',ph:''},
    Custom:       {lbl:'',hint:'',type:'text',ph:''},
  };
  if (freq==='Custom') {
    fgDay.style.display='none';
    cdSection.classList.add('visible');
  } else if (freq==='Estimated Tax (US/NY)') {
    cdSection.classList.remove('visible');
    fgDay.style.display='none';
  } else {
    cdSection.classList.remove('visible');
    fgDay.style.display='flex';
    if (map[freq]) {
      const h=map[freq]; lbl.textContent=h.lbl; inp.type=h.type; inp.placeholder=h.ph;
      hint.textContent=h.hint; hint.style.display='block';
    } else { hint.style.display='none'; }
  }
}
// Custom dates management
function addCustomDate(val='') {
  customDates.push(val); renderCustomDates();
}
function removeCustomDate(i) {
  if (!confirm('Remove this custom date?')) return;
  customDates.splice(i,1); renderCustomDates();
}
function renderCustomDates() {
  const el = document.getElementById('custom-dates-list');
  el.innerHTML = customDates.map((d,i)=>`
    <div class="custom-date-row">
      <input type="date" value="${d}" onchange="customDates[${i}]=this.value">
      <button type="button" class="btn btn-danger btn-sm" onclick="removeCustomDate(${i})">✕</button>
    </div>`).join('');
}
async function saveBill() {
  const name=document.getElementById('f-name').value.trim();
  const freq=document.getElementById('f-freq').value;
  if (!name) { toast('Please enter a bill name.','err'); return; }
  if (!freq) { toast('Please select a frequency.','err'); return; }
  const needsDate = !['Monthly','Weekly','Custom','Estimated Tax (US/NY)'].includes(freq);
  const day = document.getElementById('f-day').value;
  if (freq==='Monthly'&&!day) { toast('Please enter the due day.','err'); return; }
  if (needsDate&&!day) { toast('Please enter the next due date.','err'); return; }
  if (freq==='Custom'&&!customDates.filter(Boolean).length) { toast('Please add at least one custom date.','err'); return; }
  const body={
    name, frequency:freq,
    company:  document.getElementById('f-company').value.trim(),
    due_day:  freq==='Monthly'||freq==='Weekly' ? parseInt(day)||null : null,
    next_date: needsDate ? day : null,
    amount:   document.getElementById('f-amount').value||null,
    autopay:  document.getElementById('f-autopay').value,
    method:   document.getElementById('f-method').value.trim(),
    account:  document.getElementById('f-account').value.trim(),
    notes:    document.getElementById('f-notes').value.trim(),
    custom_dates: freq==='Custom' ? customDates.filter(Boolean) : [],
  };
  try {
    const btn=document.getElementById('save-btn');
    btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    if (body.method) await savePaymentMethodOption(body.method);
    if (editingBillId) { await api('PUT',`/api/bills/${editingBillId}`,body); toast('Bill updated!','ok'); }
    else               { await api('POST','/api/bills',body);               toast('Bill added!','ok'); }
    closeM('m-bill'); loadBillsTable(); loadDashboard();
  } catch(e) { toast('Error: '+e.message,'err'); }
  finally { const btn=document.getElementById('save-btn'); btn.innerHTML='Save Bill'; btn.disabled=false; }
}
async function deleteBill(id) {
  if (!confirm('Delete this bill and all its payment history?')) return;
  try { await api('DELETE',`/api/bills/${id}`); toast('Bill deleted.'); loadBillsTable(); loadDashboard(); }
  catch(e) { toast('Error: '+e.message,'err'); }
}

// ── Mark Paid ─────────────────────────────────────────────────────────────
function openPay(billId) {
  payingBillId = billId;
  const b = allBills.find(x=>x.id===billId);
  document.getElementById('pay-info').innerHTML=`
    <strong>${esc(b.name)}</strong>${b.company?' — '+esc(b.company):''}<br>
    <span style="color:var(--ink-light);font-size:12px">${b.frequency}${b.amount?' · '+fmtMoney(b.amount):''}</span>`;
  document.getElementById('p-date').value    = new Date().toISOString().slice(0,10);
  document.getElementById('p-amount').value  = b.amount||'';
  document.getElementById('p-method').value  = b.method||'';
  document.getElementById('p-paid-by').value = '';
  document.getElementById('p-confirm').value = '';
  document.getElementById('p-notes').value   = '';
  openM('m-pay');
}
async function confirmPay() {
  const d=document.getElementById('p-date').value;
  const method = document.getElementById('p-method').value.trim();
  if (!d) { toast('Please enter the payment date.','err'); return; }
  try {
    const btn=document.getElementById('confirm-pay-btn');
    btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    if (method) await savePaymentMethodOption(method);
    await api('POST','/api/payments',{
      bill_id: payingBillId, paid_date: d,
      amount:      document.getElementById('p-amount').value||null,
      method,
      paid_by:     document.getElementById('p-paid-by').value.trim(),
      confirm_num: document.getElementById('p-confirm').value.trim(),
      notes:       document.getElementById('p-notes').value.trim(),
    });
    const b=allBills.find(x=>x.id===payingBillId);
    closeM('m-pay'); toast(`✅ ${b?.name||'Bill'} marked as paid!`,'ok');
    loadDashboard();
    if (document.getElementById('pg-yearview')?.classList.contains('active')) loadYearView();
    if (document.getElementById('pg-log')?.classList.contains('active')) loadLog();
  } catch(e) { toast('Error: '+e.message,'err'); }
  finally { const btn=document.getElementById('confirm-pay-btn'); btn.innerHTML='Record Payment'; btn.disabled=false; }
}
async function undoPayment(billId) {
  if (!confirm('Remove the most recent payment for this bill?')) return;
  try {
    const pays = await api('GET',`/api/payments?bill_id=${billId}`);
    if (!pays.length) return;
    await api('DELETE',`/api/payments/${pays[0].id}`);
    toast('Payment undone.'); loadDashboard();
  } catch(e) { toast('Error: '+e.message,'err'); }
}

// ── Payment Log ───────────────────────────────────────────────────────────
async function loadLog() {
  try {
    const bills = await api('GET','/api/bills');
    const lf=document.getElementById('lf-bill'), cur=lf.value;
    lf.innerHTML='<option value="">All Bills</option>'+bills.map(b=>`<option value="${b.id}"${cur==b.id?' selected':''}>${esc(b.name)}</option>`).join('');
    lf.value=cur;
    let url='/api/payments'; const params=[];
    if (cur) params.push('bill_id='+cur);
    const m=document.getElementById('lf-month').value;
    if (m) params.push('month='+m);
    if (params.length) url+='?'+params.join('&');
    const pays=await api('GET',url);
    const billAmountById = new Map(bills.map((b)=>[b.id, b.amount]));
    const list=document.getElementById('log-list'), empty=document.getElementById('log-empty');
    if (!pays.length) { list.innerHTML=''; empty.style.display='block'; return; }
    empty.style.display='none';
    list.innerHTML=pays.map(p=>`
      <div class="lrow">
        <div class="l-date">${fmtDate(p.paid_date)}</div>
        <div><div class="l-name">${esc(p.bill_name||'Unknown')}</div>
          ${p.confirm_num?`<div class="l-sub">Ref: ${esc(p.confirm_num)}</div>`:''}
          ${p.notes?`<div class="l-sub">${esc(p.notes)}</div>`:''}
        </div>
        <div class="l-amt">${fmtMoney(p.amount)}<span class="l-due-amt"> (${fmtMoney(billAmountById.get(p.bill_id))})</span></div>
        <div class="l-meta">
          ${p.method?esc(p.method):''}
          ${p.paid_by?'<br>Paid by: <strong>'+esc(p.paid_by)+'</strong>':''}
        </div>
        <div class="log-actions">
          <button class="btn btn-ghost btn-sm" onclick="openEditPayment(${p.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteLog(${p.id})">Remove</button>
        </div>
      </div>`).join('');
  } catch(e) { toast('Error: '+e.message,'err'); }
}
async function deleteLog(id) {
  if (!confirm('Remove this payment record?')) return;
  try { await api('DELETE',`/api/payments/${id}`); toast('Payment removed.'); loadLog(); }
  catch(e) { toast('Error: '+e.message,'err'); }
}

async function openEditPayment(paymentId) {
  try {
    const pays = await api('GET','/api/payments');
    const p = pays.find((x)=>x.id===paymentId);
    if (!p) { toast('Payment not found.','err'); return; }
    editingPaymentId = paymentId;
    document.getElementById('pe-info').innerHTML = `
      <strong>${esc(p.bill_name||'Unknown Bill')}</strong><br>
      <span style="color:var(--ink-light);font-size:12px">Payment ID: ${p.id}</span>`;
    document.getElementById('pe-date').value = p.paid_date || '';
    document.getElementById('pe-amount').value = p.amount ?? '';
    document.getElementById('pe-method').value = p.method || '';
    document.getElementById('pe-paid-by').value = p.paid_by || '';
    document.getElementById('pe-confirm').value = p.confirm_num || '';
    document.getElementById('pe-notes').value = p.notes || '';
    openM('m-pay-edit');
  } catch(e) {
    toast('Error loading payment: '+e.message,'err');
  }
}

async function savePaymentEdit() {
  if (!editingPaymentId) return;
  const paidDate = document.getElementById('pe-date').value;
  if (!paidDate) { toast('Please enter the payment date.','err'); return; }
  try {
    const btn = document.getElementById('save-pay-edit-btn');
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
    const method = document.getElementById('pe-method').value.trim();
    if (method) await savePaymentMethodOption(method);
    await api('PUT', `/api/payments/${editingPaymentId}`, {
      paid_date: paidDate,
      amount: document.getElementById('pe-amount').value || null,
      method,
      paid_by: document.getElementById('pe-paid-by').value.trim(),
      confirm_num: document.getElementById('pe-confirm').value.trim(),
      notes: document.getElementById('pe-notes').value.trim()
    });
    closeM('m-pay-edit');
    editingPaymentId = null;
    toast('Payment updated.','ok');
    loadDashboard();
    loadLog();
    if (document.getElementById('pg-yearview')?.classList.contains('active')) loadYearView();
  } catch(e) {
    toast('Error updating payment: '+e.message,'err');
  } finally {
    const btn = document.getElementById('save-pay-edit-btn');
    if (btn) {
      btn.innerHTML = 'Save Changes';
      btn.disabled = false;
    }
  }
}

// ── Modals ────────────────────────────────────────────────────────────────
function openM(id) { document.getElementById(id).classList.add('open'); }
function closeM(id) { document.getElementById(id).classList.remove('open'); }

// ── Toast ─────────────────────────────────────────────────────────────────
let _tt;
function toast(msg,type='') {
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast show'+(type?' '+type:'');
  clearTimeout(_tt); _tt=setTimeout(()=>t.classList.remove('show'),3200);
}

// ── Util ──────────────────────────────────────────────────────────────────
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  await refreshPaymentMethodsData();
  document.querySelectorAll('.overlay').forEach(el=>
    el.addEventListener('click',e=>{ if(e.target===el) el.classList.remove('open'); }));
  window.addEventListener('hashchange', () => activatePage(currentRouteFromHash()));
  activatePage(currentRouteFromHash());
}

window.BillLedgerApp = { init };
