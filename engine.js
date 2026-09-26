/* ============================================================
   engine.js — the generic shell
   ------------------------------------------------------------
   Renders whatever workbench definition it is handed. There is
   NO role-specific code in this file: every queue, badge, gate,
   policy string and skill shown here comes from workbenches.js.
   Adding a 7th role = adding a record there.
   ============================================================ */
(function () {
'use strict';

/* ---------------- utils ---------------- */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const clock = () => { const d = new Date(); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); };
const initial = n => n.split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase();
function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8,'0'); }
const plural = (n, s) => n + ' ' + s + (n === 1 ? '' : 's');

/* ---------------- state ---------------- */
const S = {
  appsTab: 'market',                 // the catalogue is the front door; the register is one click away
  wb: null, wbKey: null, view: null, item: null, selRow: null,
  active: null,          // { item, widget, phase, i, steps, after, gate, decision, timer }
  pending: {},           // itemId -> paused run awaiting a human (feeds the approval inbox)
  resolved: {},          // itemId -> decision label
  metrics: {},           // wbKey -> { automated, saved, runs }
  logs: {},              // widgetKey -> chat messages
  extra: [],             // runtime audit events
  chain: [],
  running: false,
  halted: null,          // the fleet halt, armed by a run that declares `halt`: { banner, scope, policy, by, at, resume_label }
  tour: 0, tourSeen: false
};

/* Demo scaffolding: two peer/delegated approvals so the inbox is never empty
   before a run has paused. Presented as seeded demo data, not as our own run. */
const SEED_APPROVALS = [
  { id: 'APR-2210', who: 'peer', title: 'Discount approval — Helios Energy', sub: 'Requested by Sales Lead · delegated to you 40m ago',
    meta: 'Q-88213 · 14% discount · CAD 212,000.00 quote', sla: 'due in 3h', kind: 'peer' },
  { id: 'APR-2214', who: 'delegated', title: 'Access review sign-off — Finance apps', sub: 'Quarterly ISO access review · 2 exceptions',
    meta: '2 of 41 users retain access after role change · requires owner sign-off', sla: 'due tomorrow', kind: 'delegated' }
];

/* ---------------- audit chain (real rolling hash) ---------------- */
function chainPush(cls, actor, meta, sev) {
  const prev = S.chain.length ? S.chain[S.chain.length - 1].hash : '00000000';
  const ev = { seq: S.chain.length + 1, ts: clock(), actor, cls, meta, sev: sev || 'info', prev };
  ev.hash = djb2(prev + '|' + cls + '|' + actor + '|' + meta);
  S.chain.push(ev);
  if (S.view === 'activity') renderCanvas();
  return ev;
}
function chainVerify() {
  let prev = '00000000', ok = true, bad = -1;
  S.chain.forEach((e, i) => {
    if (e.prev !== prev) { ok = false; bad = i; }
    if (djb2(prev + '|' + e.cls + '|' + e.actor + '|' + e.meta) !== e.hash) { ok = false; bad = i; }
    prev = e.hash;
  });
  return { ok, bad, n: S.chain.length };
}
function seedChain() {
  (window.AUDIT_SEED || []).forEach(e => chainPush(e.cls, e.actor, e.meta, e.sev));
}

/* ---------------- the fleet halt ----------------
   A run may declare `halt` in its definition (workbenches.js): { banner, scope, resume_label }.
   Arming it is an ordinary governed run — the gate, the typed attestation and the refusal all
   come from the same machinery as everything else. This file only holds the resulting STATE:
   it refuses every new run while the fleet is halted, and it renders the banner, whose every
   word comes from the record rather than from here. */
function armFleet(h, item) {
  S.halted = {
    banner: h.banner, scope: h.scope, resume_label: h.resume_label || 'Resume automation',
    policy: (item.run.gate && item.run.gate.policy) || 'fleet halt',
    by: user(), at: clock(), id: item.id
  };
  chainPush('policy.fleet.halted', 'user:' + user(),
    'fleet halt armed on ' + item.id + ' · scope=' + S.halted.scope + ' · policy=' + S.halted.policy, 'crit');
}
function liftFleet() {
  const h = S.halted;
  if (!h) return;
  chainPush('policy.fleet.resumed', 'user:' + user(),
    'fleet halt lifted · it was armed by ' + h.by + ' at ' + h.at + ' · runs allowed again · policy=' + h.policy, 'warn');
  S.halted = null;
  save(); renderAll();
  toast('<b>Automation resumed.</b> The halt is lifted and the release is in the chain, exactly like the arm was.', 'ok');
}
function renderHalt() {
  const shell = $('#shell');
  if (shell) shell.className = 'shell' + (S.halted ? ' halted' : '');
  const bar = $('#haltBar');
  if (!bar) return;
  if (!S.halted) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = '<span class="halt-ico">⏻</span>' +
    '<div class="halt-txt"><b>' + esc(S.halted.banner) + '</b>' +
    '<span class="halt-sub">' + esc(S.halted.scope) + ' · armed by ' + esc(S.halted.by) + ' at ' + esc(S.halted.at) +
    ' · policy ' + esc(S.halted.policy) + ' · every workbench is refusing new runs until it is lifted</span></div>' +
    '<div class="halt-actions"><button class="btn sm danger" id="haltResume" data-halt="resume">' +
    esc(S.halted.resume_label) + '</button></div>';
  const b = $('#haltResume');
  if (b) b.addEventListener('click', liftFleet);
}

/* ---------------- toasts ---------------- */
function toast(text, kind) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.innerHTML = text;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, kind === 'warn' ? 6000 : 4200);
}

/* ---------------- persistence ---------------- */
const KEY = 'cockpit-demo-v1';
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ wbKey: S.wbKey, resolved: S.resolved, metrics: S.metrics, extra: S.extra, tourSeen: S.tourSeen, halted: S.halted })); } catch (e) {}
}
function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
function resetDemo() {
  try { localStorage.removeItem(KEY); } catch (e) {}
  S.resolved = {}; S.metrics = {}; S.pending = {}; S.active = null; S.logs = {}; S.extra = []; S.chain = []; S.halted = null;
  seedChain(); save(); renderAll();
  toast('Demo state reset — audit chain rebuilt from the seed.', 'ok');
}

/* ---------------- boot ---------------- */
function boot() {
  const saved = load() || {};
  S.wb = window.WORKBENCHES.filter(w => w.key === saved.wbKey)[0] || window.WORKBENCHES[0];
  S.wbKey = S.wb.key;
  S.resolved = saved.resolved || {};
  S.metrics  = saved.metrics  || {};
  S.halted   = saved.halted   || null;   // a halt is a fleet state, not a session: it outlives the browser
  S.tourSeen = !!saved.tourSeen;
  seedChain();
  $('#boot-sub').textContent = 'Signing in as ' + S.wb.identity.name + ' · Entra ID via trusted header…';
  renderAll();
  $('#shell').hidden = false;
  chainPush('auth.login.success', 'system:entra-sso', S.wb.identity.name.toLowerCase().replace(' ', '.') + '@acme.example · profile ' + S.wb.key + ' bound', 'info');
  setTimeout(() => {
    const b = $('#boot');
    if (!b) return;
    b.style.opacity = '0';
    setTimeout(() => b.remove(), 380);
    if (!S.tourSeen) startTour();
  }, 520);
}

/* ---------------- derived metrics ---------------- */
function M() {
  const m = S.metrics[S.wbKey] || (S.metrics[S.wbKey] = { automated: 0, saved: 0, runs: 0 });
  const base = S.wb.metrics || {};
  return {
    automated: (base.automated || 0) + m.automated,
    saved: (base.saved || 0) + m.saved,
    runs: m.runs,
    waiting: Object.keys(S.pending).length + SEED_APPROVALS.length,
    raw: base
  };
}
function metricValue(w) {
  const m = M(), c = w.config || {};
  const map = { automated: m.automated, saved: m.saved, waiting: m.waiting, close_pct: m.raw.close_pct,
                accounts: m.raw.briefings, briefings: m.raw.briefings, savings_ytd: m.raw.savings_ytd };
  const v = map[c.value_key] != null ? map[c.value_key] : (m.raw[c.value_key] != null ? m.raw[c.value_key] : 0);
  const sub = map[c.saved_key] != null ? map[c.saved_key] : 0;
  return { v, sub, c };
}

/* ---------------- top bar ---------------- */
function renderIdentity() {
  const id = S.wb.identity;
  $('#avatar').textContent = id.initials;
  $('#idName').textContent = id.name;
  $('#idSub').textContent = id.sub;
  $('#roleDot').style.background = 'var(--accent)';
  $('#roleLabel').textContent = S.wb.short;
  document.documentElement.setAttribute('data-accent', S.wb.accent);
  document.documentElement.setAttribute('data-density', S.wb.density || 'comfortable');
  document.title = S.wb.short + ' — Automation Cockpit';
}
function renderRoleMenu() {
  const list = $('#roleMenuList');
  list.innerHTML = window.WORKBENCHES.map(w => {
    const ms = (S.metrics[w.key] && S.metrics[w.key].runs) || 0;
    return '<button class="menu-item" data-wb="' + w.key + '" aria-selected="' + (w.key === S.wbKey) + '">' +
      '<span class="mi-dot" style="background:' + accentOf(w.accent) + '"></span>' +
      '<span><span class="mi-t">' + esc(w.short) + '</span><div class="mi-s">' + esc(w.title) + ' · v' + w.version +
      (ms ? ' · ' + ms + ' runs this session' : '') + '</div></span>' +
      '<span class="mi-roll">' + esc(w.rollout.strategy) + (w.rollout.pct < 100 ? ' ' + w.rollout.pct + '%' : '') + '</span></button>';
  }).join('');
  $$('.menu-item', list).forEach(b => b.addEventListener('click', () => {
    switchWorkbench(b.getAttribute('data-wb'));
    $('#roleMenu').hidden = true;
    $('#roleSwitch').setAttribute('aria-expanded', 'false');
  }));
}
function accentOf(name) {
  const map = { amber:'#e3a008', blue:'#4a9eff', violet:'#a371f7', red:'#f8635c', teal:'#2dd4bf', lime:'#a3e635' };
  return map[name] || '#888';
}
function switchWorkbench(key) {
  if (S.active) { toast('One automation run at a time per workbench — finish or cancel the current run first.', 'warn'); return; }
  const w = window.WORKBENCHES.filter(x => x.key === key)[0];
  if (!w) return;
  S.wb = w; S.wbKey = w.key; S.view = null; S.item = null; S.selRow = null;
  S.logs = { chat: S.logs.chat || [] };
  chainPush('workbench.served', 'system:control-plane',
    'key=' + w.key + ' version=' + w.version + ' rollout=' + w.rollout.strategy + '(' + w.rollout.pct + '%)', 'info');
  save(); renderAll();
  toast('Switched to <b>' + esc(w.short) + '</b> — workbench v' + w.version + ', served from the control plane.', 'ok');
}

/* ---------------- left rail ---------------- */
function viewKey() { return S.view || (S.wb.nav[0] && S.wb.nav[0].key); }
function counts() {
  const c = Object.assign({}, S.wb.counts || {});
  const base = S.wb.widgets.filter(w => w.items)[0];
  if (base) { /* counts come from the definition; live waits are added below */ }
  return c;
}
function renderRail() {
  const c = counts();
  const nav = S.wb.nav.map(n => {
    const live = n.badge === ('exceptions' + '') ? c.exceptions : null;
    const badge = Object.keys(c).indexOf(n.badge) >= 0 ? c[n.badge] : null;
    const isAlert = !!n.alert;
    return '<button class="navitem' + (n.key === viewKey() ? ' active' : '') + '" data-nav="' + n.key + '">' +
      '<span class="ni-ico">' + n.icon + '</span><span class="ni-label">' + esc(n.label) + '</span>' +
      (badge != null ? '<span class="ni-badge' + (isAlert && badge ? ' alert' : '') + '">' + badge + '</span>' : '') +
      '</button>';
  }).join('');
  const universal =
    '<div class="rail-sec">Universal</div>' +
    '<button class="navitem' + (S.view === 'chat' ? ' active' : '') + '" data-nav="chat"><span class="ni-ico">◗</span><span class="ni-label">Chat</span>' +
      '<span class="ni-badge">' + ((S.logs.chat || []).length ? 'live' : 'new') + '</span></button>' +
    '<button class="navitem' + (S.view === 'skills' ? ' active' : '') + '" data-nav="skills"><span class="ni-ico">⌬</span><span class="ni-label">Skill Studio</span></button>' +
    '<button class="navitem' + (S.view === 'automations' ? ' active' : '') + '" data-nav="automations"><span class="ni-ico">\u27f3</span><span class="ni-label">Automations</span>' +
      '<span class="ni-badge">' + ((window.AUTOMATIONS || []).length) + '</span></button>' +
    '<button class="navitem' + (S.view === 'apps' ? ' active' : '') + '" data-nav="apps"><span class="ni-ico">\u2b21</span><span class="ni-label">Connected apps</span>' +
      '<span class="ni-badge">' + ((window.CONNECTORS || []).length) + '</span></button>' +
    '<button class="navitem' + (S.view === 'activity' ? ' active' : '') + '" data-nav="activity"><span class="ni-ico">◉</span><span class="ni-label">Activity &amp; audit</span>' +
      (S.pending.length ? '' : '') + '</button>';
  $('#railMain').innerHTML = nav + universal;
  // Phone: the same five rooms become a thumb bar. We CLONE the rail's buttons rather
  // than define the nav twice, so there is still exactly one place that knows the rooms.
  const bar = $('#mobileBar');
  if (bar) {
    bar.innerHTML = '';
    ['inbox', 'chat', 'automations', 'apps'].forEach(v => {
      const src = document.querySelector('#railMain .navitem[data-nav="' + v + '"]');
      if (src) bar.appendChild(src.cloneNode(true));
    });
    const more = document.createElement('button');
    more.className = 'navitem' + (S.mobileMore ? ' active' : '');
    more.setAttribute('data-act', 'moreSheet');
    more.innerHTML = '<span class="ni-ico">\u22ef</span><span class="ni-label">More</span>';
    bar.appendChild(more);
  }
  const sheet = $('#mobileSheet');
  if (sheet) {
    if (!S.mobileMore) { sheet.innerHTML = ''; sheet.hidden = true; }
    else {
      let h = '<div class="p-sec">Everywhere else</div><div class="sheet-grid">';
      ['skills', 'activity', 'changes', 'estate', 'team'].forEach(v => {
        const src = document.querySelector('#railMain .navitem[data-nav="' + v + '"]');
        if (src) h += src.outerHTML;
      });
      h += '</div><div class="p-sec">Signed in as</div><div class="sheet-grid">';
      document.querySelectorAll('#roleMenuList .menu-item').forEach(mi => {
        h += '<button class="navitem" data-wb="' + mi.getAttribute('data-wb') + '"><span class="ni-label">' + mi.innerText.split('\n')[0] + '</span></button>';
      });
      h += '</div><button class="btn xs" data-act="moreClose">Close</button>';
      sheet.innerHTML = h; sheet.hidden = false;
      $$('#mobileSheet [data-nav]').forEach(b => b.addEventListener('click', () => { S.view = b.getAttribute('data-nav'); S.item = null; S.mobileMore = false; renderAll(); }));
      $$('#mobileSheet [data-wb]').forEach(b => b.addEventListener('click', () => {
        const src = document.querySelector('#roleMenuList .menu-item[data-wb="' + b.getAttribute('data-wb') + '"]');
        S.mobileMore = false; if (src) src.click(); else renderAll();
      }));
      $$('#mobileSheet [data-act="moreClose"]').forEach(b => b.addEventListener('click', () => { S.mobileMore = false; renderAll(); }));
    }
  }
  $$('#mobileBar [data-act="moreSheet"]').forEach(b => b.addEventListener('click', () => { S.mobileMore = !S.mobileMore; renderAll(); }));
  $$('#railMain .navitem, #mobileBar .navitem').forEach(b => b.addEventListener('click', () => {
    if (!b.getAttribute('data-nav')) return;
    S.view = b.getAttribute('data-nav'); S.item = null;
    if (S.view !== 'activity' && S.view !== 'skills') chainPush('workbench.nav.opened', 'user:' + S.wb.identity.name.toLowerCase().replace(' ', '.'), 'nav=' + S.view, 'info');
    renderAll();
  }));
  const p = S.wb.policies;
  const laneLine = !S.lane ? 'probing…'
    : S.lane.live ? 'LIVE via bridge · bsk ' + esc(S.lane.bsk_version) + ' · ' + esc(((S.lane.browsers || [])[0] || {}).name || '') + ' connected'
    : 'offline (served without lane.py)';
  $('#railFoot').innerHTML =
    '<div class="rail-foot-lane">Browser lane <b>bsk</b> · ' + laneLine + '</div>' +
    '<div class="rail-foot-pol">Ceiling <b>' + esc(p.autonomy_ceiling) + '</b> · session <b>' + p.session_max_minutes + 'm</b><br>' +
    plural(p.allowed_domains.length, 'domain') + ' allow-listed · ' + plural(p.requires_confirmation.length, 'confirmation rule') + '</div>';
}

/* ---------------- status strip ---------------- */
const STATUS = { idle: 'Idle', working: 'Working', waiting: 'Waiting on you', stopped: 'Stopped' };
function renderStatus() {
  const st = $('#stState'), last = $('#stLast'), m = M();
  // The fleet halt outranks everything else the strip could be reporting: if the fleet is
  // halted, that is the state of the fleet, whatever one run on one workbench is doing.
  const state = S.halted ? 'stopped'
    : S.active ? (S.active.phase === 'steps' ? 'working' : S.active.phase === 'gate' ? 'waiting' : S.active.phase === 'after' ? 'working' : 'idle')
    : (Object.keys(S.pending).length ? 'waiting' : 'idle');
  st.setAttribute('data-s', state);
  st.innerHTML = '<span class="pulse"></span> <b>' + STATUS[state] + '</b>';
  if (S.halted) {
    last.innerHTML = '<b>' + esc(S.halted.banner) + '</b> · armed by ' + esc(S.halted.by) + ' at ' + esc(S.halted.at) +
      ' · ' + esc(S.halted.scope) + ' · lift it from the banner above the top bar.';
  } else if (S.active) {
    const a = S.active;
    const stepTxt = a.phase === 'gate' ? 'paused at a ' + (a.gate.kind === 'mfa' ? 'sign-in' : a.gate.kind === 'send' ? 'send' : 'release') + ' step'
      : a.phase === 'after' ? 'writing the result' : 'step ' + Math.min(a.i + 1, a.steps.length) + ' of ' + a.steps.length;
    last.innerHTML = '<b>' + esc(a.item.run.label) + '</b> · ' + esc(a.item.id) + ' — ' + esc(stepTxt) + ' · ' + clock();
  } else if (Object.keys(S.pending).length) {
    last.innerHTML = plural(Object.keys(S.pending).length, 'automation run') + ' paused, waiting for a human decision.';
  } else {
    // No active run and nothing pending: say so. Without this the strip keeps the last
    // text it was given and goes on claiming a run is paused that has already stopped.
    last.innerHTML = '<span class="dim">no run in flight \u00b7 nothing paused \u00b7 ' + clock() + '</span>';
  }
  const c = S.wb.metrics || {}, cfgKeys = c.close_pct != null ? c.close_pct + '% close' : null;
  $('#stMetrics').innerHTML =
    '<span>automated today <b>' + m.automated + '</b></span>' +
    '<span>time saved <b>' + Math.round(m.saved / 60) + 'h ' + String(m.saved % 60).padStart(2,'0') + 'm</b></span>' +
    '<span>waiting on you <b style="color:' + (m.waiting ? 'var(--warn)' : 'inherit') + '">' + m.waiting + '</b></span>' +
    (cfgKeys ? '<span>' + esc(cfgKeys) + '</span>' : '') +
    '<span>session runs <b>' + m.runs + '</b></span>';
  const pill = $('#attnPill');
  pill.className = 'iconbtn' + (m.waiting ? ' busy' : '');
  $('#attnCount').textContent = m.waiting;
}

function renderAll() { renderIdentity(); renderRoleMenu(); renderRail(); renderCanvas(); renderPanel(); renderStatus(); renderHalt(); }

/* ---------------- canvas ---------------- */
const ALWAYS_ON = ['metric', 'chat', 'approval_inbox'];

function renderCanvas() {
  // Every universal view writes #widgetGrid itself, so each one has to re-bind the
  // handlers for the controls it just created. (Only the workbench path did, which is
  // why an automation's buttons rendered perfectly and did nothing at all.)
  if (S.view === 'chat') { renderChat(); return; }
  if (S.view === 'skills') { renderSkills(); wireCanvas(); return; }
  if (S.view === 'automations') { renderAutomations(); wireCanvas(); return; }
  if (S.view === 'apps') { renderApps(); wireCanvas(); return; }
  if (S.view === 'activity') { renderAudit(); wireCanvas(); return; }
  const wb = S.wb;
  const nav = wb.nav.filter(n => n.key === viewKey())[0] || wb.nav[0];
  // Initial view (no nav click yet) shows the whole workbench; clicking a nav
  // item filters to that section. Keeps the first impression complete while
  // making nav meaningful.
  const focus = S.view ? (nav.focus || []) : [];
  const onlyAlerts = !!nav.alert && focus.length > 0;
  const widgets = wb.widgets.filter(w =>
    focus.length ? (focus.indexOf(w.key) >= 0 || ALWAYS_ON.indexOf(w.kind) >= 0) : true
  ).sort((a, b) => a.position - b.position);

  const id = wb.identity;
  const greeting = (id.greeting || 'Good morning, {{user.first_name}}').replace('{{user.first_name}}', id.first_name);
  $('#wbHead').innerHTML =
    '<div class="wb-title"><span class="wb-greet">' + esc(greeting) + '</span>' +
      '<span class="wb-badge">' + esc(wb.short) + '</span>' +
      (onlyAlerts ? '<span class="badge warn">showing alerted rows only</span>' : '') + '</div>' +
    '<div class="wb-meta">' +
      '<span>' + esc(S.view ? nav.label : 'Overview') + '</span>' +
      '<span>workbench <span class="mono">v' + wb.version + '</span> · ' + esc(wb.status) + '</span>' +
      '<span>rollout <span class="mono">' + esc(wb.rollout.strategy) + (wb.rollout.pct < 100 ? ' ' + wb.rollout.pct + '%' : '') +
        '</span> · ' + esc((wb.rollout.groups && wb.rollout.groups[0]) || 'all employees') + '</span>' +
      '<span>autonomy ceiling <span class="mono">' + esc(wb.policies.autonomy_ceiling) + '</span></span>' +
      (wb.rollout.freeze && wb.rollout.freeze.length ? '<span>change freeze: ' + esc(wb.rollout.freeze.join(', ')) + '</span>' : '') +
    '</div>';

  const grid = $('#widgetGrid');
  grid.innerHTML = widgets.map(w => widgetHTML(w, onlyAlerts)).join('');
  wireCanvas();
}

function widgetHTML(w, onlyAlerts) {
  const auto = w.auto ? '<span class="w-auto lvl-' + w.auto.level + '">' + esc(w.auto.level) + ' · <button class="skilljump" data-skilljump="' + esc(String(w.auto.skill).split('@')[0]) + '" title="open this skill in Skill Studio">' + esc(w.auto.skill) + '</button></span>' : '';
  return '<section class="w" data-size="' + (w.size || 'wide') + '" data-w="' + w.key + '">' +
    '<div class="w-hd"><h3>' + esc(w.title) + '</h3>' + auto + '</div>' +
    '<div class="w-body">' + bodyHTML(w, onlyAlerts) + '</div></section>';
}

function bodyHTML(w, onlyAlerts) {
  switch (w.kind) {
    case 'queue':   return queueHTML(w, onlyAlerts);
    case 'metric':  return metricHTML(w);
    case 'chat':    return chatHTML(w);
    case 'form':    return formHTML(w);
    case 'doc':     return docHTML(w);
    case 'run_button': return runButtonHTML(w);
    case 'approval_inbox': return approvalInboxHTML(w);
    default: return '<div class="qempty">Unknown widget kind: ' + esc(w.kind) + '</div>';
  }
}

/* ---------------- queue ---------------- */
function badgeHTML(pair) {
  const kind = pair[0] ? ' ' + pair[0] : '';
  return '<span class="badge' + kind + '">' + esc(pair[1]) + '</span>';
}
function flagged(it) { return (it.badges || []).some(b => b[0] === 'warn' || b[0] === 'bad'); }
function queueHTML(w, onlyAlerts) {
  let items = w.items || [];
  if (onlyAlerts) items = items.filter(flagged);
  const head = w.note ? '<div class="q-s" style="margin-bottom:8px;color:var(--fg3)">' + esc(w.note) + '</div>' : '';
  if (!items.length) return head + '<div class="qempty">Nothing here right now.</div>';
  const rows = items.map(it => {
    const dec = S.resolved[it.id];
    const run = it.run || (w.run || null);
    const busy = S.active && S.active.item.id === it.id;
    const actionLabel = dec ? 'Decision recorded' : (run ? (run.gate ? 'Review &amp; run' : 'Run') : (it.detail && it.detail.actions ? it.detail.actions[0].label : 'Open'));
    return '<div class="qrow' + (S.selRow === it.id ? ' sel' : '') + '" data-item="' + esc(it.id) + '">' +
      '<div><div class="q-t">' + esc(it.title) + (dec ? ' <span class="badge ok">' + esc(dec) + '</span>' : '') +
        (busy ? ' <span class="badge acc">running</span>' : '') + '</div>' +
        '<div class="q-s">' + (String(it.title).indexOf(it.id) >= 0 ? '' : '<span class="mono dim">' + esc(it.id) + '</span>') +
          esc(it.sub) + (it.badges || []).map(badgeHTML).join('') + '</div>' +
        (it.why ? '<div class="q-why">' + esc(it.why) + '</div>' : '') + '</div>' +
      '<div class="q-act"><button class="btn ' + (dec ? '' : 'pri') + ' sm" data-act="row" data-item="' + esc(it.id) + '"' +
        (dec || busy ? ' disabled' : '') + '>' + actionLabel + '</button></div>' +
    '</div>';
  }).join('');
  return head + rows;
}

/* ---------------- metric ---------------- */
function metricHTML(w) {
  const mv = metricValue(w), c = mv.c;
  const suffix = c.suffix || '';
  const subLabel = c.saved_label || 'min saved';
  const subVal = c.saved_label ? (c.saved_key === 'savings_ytd' ? 'CAD ' + Number(mv.sub).toLocaleString() : mv.sub) : mv.sub;
  return '<div class="metric-v' + (c.value_key === 'automated' ? ' good' : '') + '">' + esc(mv.v) + esc(suffix) + '</div>' +
    '<div class="metric-s">' + esc(c.sub || '') + '</div>' +
    '<div class="metric-s"><span class="mono">' + esc(subVal) + '</span> ' + esc(subLabel) + '</div>';
}

/* ---------------- chat ---------------- */
function chatHTML(w) {
  const log = S.logs[w.key] || [];
  const msgs = log.map(m => '<div class="msg ' + (m.who === 'me' ? 'me' : 'ag') + '">' + esc(m.text) +
    (m.cite ? '<span class="cite">source: ' + esc(m.cite) + '</span>' : '') + '</div>').join('');
  // Three kinds of chip, and the difference matters: a question is answered, a request
  // is worked, and a repeated request becomes a skill. Same box, different consequence.
  const does = (w.tasks || []).map(t => '<button class="chipx do" data-ask="' + esc(t.q) + '">' +
    '<span class="ch-k">do</span>' + esc(t.q) + '</button>').join('');
  const asks = (w.suggested || []).map(s => '<button class="chipx" data-ask="' + esc(s) + '">' +
    '<span class="ch-k">ask</span>' + esc(s) + '</button>').join('');
  const teach = '<button class="chipx teach" data-newskill="1"><span class="ch-k">teach</span>+ New skill</button>';
  return (w.note ? '<div class="q-s" style="margin-bottom:8px;color:var(--fg3)">' + esc(w.note) + '</div>' : '') +
    '<div class="chatlog" data-log="' + w.key + '">' + msgs + '</div>' +
    '<div class="askrow"><input type="text" data-askinput="' + w.key + '" placeholder="Ask a question, or ask for work — answers cite, actions stop at a gate"><button class="btn pri" data-asksend="' + w.key + '">Send</button>' +
      '<button class="btn newsess" data-newsess="' + w.key + '" title="Start a fresh session: the conversation clears, your grant does not">New session</button></div>' +
    '<div class="suggest">' + does + asks + teach + '</div>' +
    '<div class="q-s" style="margin-top:7px;color:var(--fg3)">Every chat-initiated action carries the same grant as a button. Chat is a lane into the workbench, never a way around it.</div>';
}

/* /new — a session is conversational context, not authority.
   Hermes draws the line at the transcript: /new drops the conversation while memory and
   skills persist. The workbench draws the same line around the grant, the ceiling and the
   chain, so a fresh session can never mean a fresh allowance. */
function newSession(widgetKey) {
  const w = widgetOf(widgetKey);
  if (!w) return;
  const before = (S.logs[widgetKey] || []).length;
  S.ses = sesId();
  S.logs[widgetKey] = [{ who: 'ag',
    text: 'New session. I still know your workbench, your grant and your history — I just do not remember this conversation.',
    cite: before + ' exchange(s) dropped from context, grant, ceiling and audit chain unchanged' }];
  chainPush('session.started', 'user:' + user(), 'new session in the ' + (w.title || widgetKey) + ' composer, conversation dropped, grant unchanged', 'info');
  toast('New session. The conversation is gone; the ceiling is not.', 'ok');
  renderRail(); renderCanvas();
}

function newSkillPanel() {
  const A = window.AUTHORING || { paths: [], rules: [] };
  S.item = { id: 'NEW-SKILL', title: 'Draft a new skill from what you just asked',
    why: 'A request that has no skill behind it does not become a silent script. It becomes a draft with a manifest, a named reviewer and a ceiling.',
    detail: {
      kv: A.paths.map(p => [p.n, 'who: ' + p.who + ' \u00b7 ' + p.review]),
      evidence: A.rules.join('\n'),
      actions: []
    } };
  chainPush('skill.draft.opened', 'user:' + user(),
    'authoring paths opened from chat \u00b7 capabilities are derived from the manifest, not declared', 'info');
  renderPanel();
}

/* ---------------- form ---------------- */
function formHTML(w) {
  const fields = (w.fields || []).map(f =>
    '<div class="field"><label>' + esc(f.label) + '</label>' +
      '<div class="fv' + (f.autofilled ? ' autofilled' : '') + '">' + esc(f.value) +
      '<small>' + (f.autofilled ? 'pre-filled · ' : '') + esc(f.src) + '</small></div></div>').join('');
  const acts = (w.run ? [A2(w.run.label, 'run', 'pri')] : []).concat(w.actions || []);
  return (w.note ? '<div class="q-s" style="margin-bottom:9px;color:var(--fg3)">' + esc(w.note) + '</div>' : '') +
    '<div class="fields">' + fields + '</div><div class="strip">' + acts.map(btnHTML).join('') + '</div>';
}
function A2(label, act, cls) { return { label: label, act: act, cls: cls }; }
function btnHTML(a) {
  return '<button class="btn ' + (a.cls || '') + '" data-act="' + esc(a.act) + '">' + a.label + '</button>';
}

/* ---------------- doc ---------------- */
function docHTML(w) {
  const body = (w.body || w.text || '');
  return '<div class="docpreview">' + esc(body) + '</div>';
}

/* ---------------- run_button ---------------- */
function runButtonHTML(w) {
  if (w.lane) {
    const live = S.lane && S.lane.live;
    const rows = (w.buttons || []).map(b =>
      '<div class="qrow" style="cursor:default"><div><div class="q-t">' + esc(b.label) + '</div>' +
      '<div class="q-s">' + esc(b.sub) + '</div></div>' +
      '<div class="q-act"><button class="btn sm ' + (live ? 'pri' : '') + '" data-lane="' + esc(b.act) + '"' + (live ? '' : ' disabled') + '>Run</button></div></div>').join('');
    return '<div class="q-s" style="margin-bottom:9px;color:var(--fg3)">' + esc(w.note || '') + '</div>' +
      '<div class="q-s" style="margin-bottom:6px">' + (live
        ? '<span class="badge ok">bridge live</span> <span class="mono">' + esc((S.lane.browsers || []).map(b => b.name + ' ' + b.version + ' · ext ' + b.extension).join(', ')) + '</span>'
        : '<span class="badge warn">bridge offline</span> start the demo with <span class="mono">python3 lane.py</span> to drive the real lane') + '</div>' + rows;
  }
  const rows = (w.buttons || []).map(b => {
    const tone = b.level === 'release' ? 'warn' : 'ok';
    return '<div class="qrow" style="cursor:default"><div><div class="q-t">' + esc(b.label) + '</div>' +
      '<div class="q-s"><span class="badge ' + tone + '">' + esc(b.level === 'release' ? 'needs release' : 'within grant') + '</span>' +
      esc(b.sub) + '</div></div><div class="q-act"><button class="btn sm" data-act="rb" data-label="' + esc(b.label) + '">Run</button></div></div>';
  }).join('');
  return (w.note ? '<div class="q-s" style="margin-bottom:8px;color:var(--fg3)">' + esc(w.note) + '</div>' : '') + rows;
}

/* ---------------- approval inbox ---------------- */
function approvalInboxHTML(w) {
  const live = Object.keys(S.pending).map(id => S.pending[id]);
  const rows = live.map(p =>
    '<div class="card hot"><div class="card-hd"><span class="spin"></span> waiting on you · agent</div>' +
    '<div class="q-t">' + esc(p.item.run.label) + '</div>' +
    '<div class="q-s">' + esc(p.item.title) + '</div>' +
    '<div class="q-s mono">' + esc(p.gate.kind) + ' · ' + esc(p.item.id) + '</div>' +
    '<div class="card-actions"><button class="btn pri sm" data-act="focusPend" data-item="' + esc(p.item.id) + '">Decide now</button></div></div>').join('');
  const seeds = SEED_APPROVALS.map(s =>
    '<div class="card"><div class="card-hd">' + (s.kind === 'peer' ? 'peer request' : 'delegated to you') + '</div>' +
    '<div class="q-t">' + esc(s.title) + '</div><div class="q-s">' + esc(s.sub) + '</div>' +
    '<div class="q-s mono">' + esc(s.meta) + '</div>' +
    '<div class="card-actions"><button class="btn sm" data-act="seedDecide" data-id="' + esc(s.id) + '">Open</button>' +
    '<span class="badge warn">' + esc(s.sla) + '</span></div></div>').join('');
  return (w.note ? '<div class="q-s" style="margin-bottom:9px;color:var(--fg3)">' + esc(w.note) + '</div>' : '') +
    (live.length ? rows : '') + seeds;
}

/* ---------------- canvas wiring ---------------- */
function wireCanvas() {
  $$('#widgetGrid [data-item]').forEach(row => {
    const open = e => { if (e.target.closest('button')) return; openItem(row.getAttribute('data-item')); };
    row.addEventListener('click', open);
  });
  $$('#widgetGrid [data-act="row"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openItem(b.getAttribute('data-item')); }));
  $$('#widgetGrid [data-act="run"]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const w = widgetOf(b.closest('.w').getAttribute('data-w'));
    if (!w) return;
    if (w.items) startRun(pickItem(w, S.item && S.item.id));
    else startRun(formRunnable(w));
  }));
  $$('#widgetGrid [data-ask]').forEach(b => b.addEventListener('click', () => sendAsk(b.closest('.w').getAttribute('data-w'), b.getAttribute('data-ask'))));
  $$('#widgetGrid [data-asksend]').forEach(b => b.addEventListener('click', () => {
    const k = b.getAttribute('data-asksend');
    const inp = $('[data-askinput="' + k + '"]:not([data-bound])', $('#widgetGrid')) || $('#widgetGrid [data-askinput="' + k + '"]');
    sendAsk(k, inp ? inp.value : '');
  }));
  $$('#widgetGrid [data-askinput]').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') sendAsk(i.getAttribute('data-askinput'), i.value); }));
  $$('#widgetGrid [data-newskill]').forEach(b => b.addEventListener('click', () => newSkillPanel()));
  $$('#widgetGrid [data-newsess]').forEach(b => b.addEventListener('click', () => newSession(b.getAttribute('data-newsess'))));
  $$('#widgetGrid [data-act="sessOpen"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openSession(b.getAttribute('data-sess')); }));
  $$('#widgetGrid [data-act="sessDel"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); deleteSession(b.getAttribute('data-sess')); }));
  $$('#widgetGrid [data-act="autoToggle"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); autoToggle(b.getAttribute('data-auto')); }));
  $$('#widgetGrid [data-act="autoRetire"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); autoRetire(b.getAttribute('data-auto')); }));
  $$('#widgetGrid [data-act="autoHist"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); autoHistory(b.getAttribute('data-auto')); }));
  $$('#widgetGrid [data-act="autoRun"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); autoRunNow(b.getAttribute('data-auto')); }));
  $$('#widgetGrid [data-act="appsTab"], #wbHead [data-act="appsTab"]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); S.appsTab = b.getAttribute('data-tab'); S.connInstall = null; renderCanvas(); }));
  $$('#widgetGrid [data-act="connInstall"]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const id = b.getAttribute('data-app');
    const a = (((window.CONNECTOR_MARKET || {}).apps) || []).filter(x => x.id === id)[0] || {};
    S.connInstall = id; renderCanvas();
    if ((a.rule || 'self') !== 'self') {
      chainPush('connector.refused', 'user:' + user(), 'refused: ' + id + ' is not self-installable (' + a.rule + ')', 'warn');
      toast('<b>Not yours to install.</b> ' + esc(a.name) + ' \u2014 ' + esc(a.why || ''), 'warn');
    } }));
  $$('#widgetGrid [data-act="connRequest"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); requestConnector(b.getAttribute('data-app')); }));
  $$('#widgetGrid [data-act="connCancel"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S.connInstall = null; renderCanvas(); }));
  $$('#widgetGrid [data-auto-what]').forEach(i => i.addEventListener('input', () => { S.autoWhat = i.value; }));
  $$('#widgetGrid [data-auto-time]').forEach(i => i.addEventListener('input', () => { S.autoTime = i.value; }));
  $$('#widgetGrid [data-auto-skill]').forEach(s => s.addEventListener('change', () => { S.autoPrefill = s.value || null; }));
  $$('#widgetGrid [data-act="autoOpen"], #wbHead [data-act="autoOpen"]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); S.addAuto = true; S.autoPrefill = null; S.autoFreq = S.autoFreq || 'weekdays'; renderCanvas(); }));
  $$('#widgetGrid [data-act="autoCreate"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); createAutomation(); }));
  $$('#widgetGrid [data-act="autoCancel"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S.addAuto = false; S.autoPrefill = null; renderCanvas(); }));
  $$('#widgetGrid [data-auto-freq]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const wEl = $('[data-auto-what]'), tEl = $('[data-auto-time]'), sEl = $('[data-auto-skill]');
    S.autoWhat = (wEl && wEl.value) || ''; S.autoTime = (tEl && tEl.value) || '07:30';
    if (sEl && sEl.value) S.autoPrefill = sEl.value;
    S.autoFreq = b.getAttribute('data-auto-freq'); renderCanvas(); }));
  $$('#widgetGrid [data-act="autoSched"]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); S.autoSched = b.getAttribute('data-auto'); S.schedFreq = null; S.schedTime = null; renderCanvas(); }));
  $$('#widgetGrid [data-sched-freq]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); const tEl = $('[data-sched-time]'); S.schedTime = (tEl && tEl.value) || '07:30';
    S.schedFreq = b.getAttribute('data-sched-freq'); renderCanvas(); }));
  $$('#widgetGrid [data-act="autoSchedSave"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); saveSchedule(b.getAttribute('data-auto')); }));
  $$('#widgetGrid [data-act="autoSchedCancel"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S.autoSched = null; renderCanvas(); }));
  $$('#widgetGrid [data-act="scheduleIt"]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    S.view = 'automations'; S.addAuto = true; S.autoPrefill = b.getAttribute('data-skill'); S.item = null; renderAll(); }));
  $$('#widgetGrid [data-act="skillFork"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); forkSkill(b.getAttribute('data-skill')); }));
  $$('#widgetGrid [data-act="skillArchive"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); archiveSkill(b.getAttribute('data-skill')); }));
  $$('#widgetGrid [data-act="skillRestore"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); restoreSkill(b.getAttribute('data-skill')); }));
  $$('#widgetGrid [data-act="skillRemove"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); removeSkill(b.getAttribute('data-skill')); }));
  $$('#widgetGrid [data-act="skillSubmit"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); submitDraft(b.getAttribute('data-skill')); }));
  $$('#widgetGrid [data-act="skillWithdraw"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); withdrawDraft(b.getAttribute('data-skill')); }));
  $$('#widgetGrid [data-act="addSkill"], #wbHead [data-act="addSkill"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S.adding = true; S.skillQ = ''; renderCanvas(); }));
  $$('#widgetGrid [data-act="addPropose"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); proposeSkill(); }));
  $$('#widgetGrid [data-act="addCancel"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S.adding = false; renderCanvas(); }));
  $$('#widgetGrid [data-act="skillAmend"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S.amending = b.getAttribute('data-skill'); S.adding = false; renderCanvas(); }));
  $$('#widgetGrid [data-act="skillAmendAsk"]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const s2 = ((S.wb.widgets || []).length, (window.SKILLS.concat((window.SKILL_LIBRARY || {}).corporate || [], S.forks || []).filter(x => x.key === b.getAttribute('data-skill'))[0] || {}));
    toast('<b>Not yours to edit.</b> ' + esc(s2.owner || 'its owner') + ' owns this one. Ask them to amend it, or fork it and change your own copy.', 'warn');
  }));
  $$('#widgetGrid [data-act="amendSame"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); amendSkill(b.getAttribute('data-skill'), 'same'); }));
  $$('#widgetGrid [data-act="amendNarrow"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); amendSkill(b.getAttribute('data-skill'), 'narrow'); }));
  $$('#widgetGrid [data-act="amendWiden"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); amendSkill(b.getAttribute('data-skill'), 'widen'); }));
  $$('#widgetGrid [data-act="amendCancel"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S.amending = null; renderCanvas(); }));
  $$('#widgetGrid [data-goto], #widgetGrid [data-skilljump]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    if (b.getAttribute('data-skilljump')) { S.skillFocus = b.getAttribute('data-skilljump'); S.skillQ = b.getAttribute('data-skilljump'); S.view = 'skills'; }
    else { S.view = b.getAttribute('data-goto'); }
    S.item = null; renderAll();
  }));
  const qIn = $('#wbHead [data-skillq], #widgetGrid [data-skillq]');  // the header is where the filter lives
  if (qIn) {
    qIn.addEventListener('input', () => { S.skillQ = qIn.value; renderAll(); });
    if (S.skillQ) { const n = $('#wbHead [data-skillq], #widgetGrid [data-skillq]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
  }
  const ac = $('#widgetGrid [data-addcard]'), mc = $('#widgetGrid [data-amendcard]');
  if (ac) { ac.scrollIntoView({ block: 'center' }); const f = $('[data-add-what]'); if (f) f.focus(); }
  if (mc) { mc.scrollIntoView({ block: 'center' }); const f = $('[data-amend-what]'); if (f) f.focus(); }
  if (S.skillFocus) {
    const el = document.querySelector('[data-skill-card="' + S.skillFocus + '"]');
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('focused'); }
    S.skillFocus = null;
  }
  $$('#widgetGrid [data-lane]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const act = b.getAttribute('data-lane');
    b.disabled = true;
    if (act === 'seq') await laneSequence();
    else if (act === 'help') await laneHelp();
    else if (act === 'stop') { const r = await laneCall('/api/lane/session/stop'); toast('Lane session stopped: <span class="mono">' + esc(JSON.stringify(r).slice(0, 90)) + '</span>', 'warn'); await laneProbe(); }
    b.disabled = false;
  }));
  $$('#widgetGrid [data-act="rb"]').forEach(b => b.addEventListener('click', () => {
    const label = b.getAttribute('data-label');
    chainPush('runbook.selected', 'user:' + user(), 'runbook="' + label + '" · grant checked before execution', 'info');
    toast('<b>' + esc(label) + '</b> — the engine checks the grant first. Out-of-scope runs stop at the first step that exceeds the ceiling.', 'ok');
  }));
  $$('#widgetGrid [data-act="seedDecide"]').forEach(b => b.addEventListener('click', () => {
    const s = SEED_APPROVALS.filter(x => x.id === b.getAttribute('data-id'))[0];
    chainPush('approval.opened', 'user:' + user(), 'approval=' + s.id + ' source=' + s.who, 'info');
    toast('Seeded demo approval <b>' + esc(s.id) + '</b> — ' + esc(s.meta) + '. In production this opens the same decision card the automation uses.', 'ok');
  }));
  $$('#widgetGrid [data-act="focusPend"]').forEach(b => b.addEventListener('click', () => {
    const p = S.pending[b.getAttribute('data-item')];
    if (p) { S.active = p; S.item = p.item; renderAll(); }
  }));
}
function widgetOf(key) { return key === 'chat' ? chatWidget() : (S.wb.widgets || []).filter(w => w.key === key)[0]; }

/* The universal tab is the same widget with the same machinery: one session, the workbench's
   grant, plus the questions that are about the assistant itself. */
function chatWidget() {
  const U = window.CHAT || {};
  const wbChat = (S.wb.widgets || []).filter(w => w.kind === 'chat')[0] || {};
  // The lane's grant IS the workbench's chat grant. A synthetic key here would cite
  // something no employee can look up — the whole surface would be lying about its own ceiling.
  return { key: 'chat', kind: 'chat', size: 'wide', title: U.title || 'Chat',
    note: U.note, auto: wbChat.auto || null,
    suggested: wbChat.suggested || [], tasks: wbChat.tasks || [],
    answers: (U.answers || []).concat(wbChat.answers || []) };
}
function sesId() { return 'ses-' + Math.random().toString(36).slice(2, 6) + '-' + Date.now().toString(36).slice(-4); }
function sessionCardHTML() {
  if (!S.ses) S.ses = sesId();
  const auto = ((S.wb.widgets || []).filter(w => w.kind === 'chat')[0] || {}).auto || {};
  const tail = S.chain.slice(-4).reverse().map(ev => '<tr><td class="mono dim">' + ev.seq + '</td><td class="mono">' +
    esc(ev.cls) + '</td><td>' + esc((ev.meta || '').slice(0, 52)) + '</td></tr>').join('');
  return '<section class="w" data-size="md"><div class="w-hd"><h3>This session</h3>' +
    '<span class="w-auto">' + esc(S.ses) + '</span></div><div class="w-body">' +
    '<div class="p-sec">Who you are here</div><div class="q-s" style="margin-bottom:9px">' + esc(S.wb.identity.name) + ' · ' +
    esc(S.wb.title) + ' ' + '·' + ' profile <b>' + esc(S.wb.key) + '</b></div>' +
    '<div class="p-sec">A new session drops the conversation. It does not touch:</div>' +
    '<div class="q-s" style="margin-bottom:9px">your <b>grant</b>' + (auto.skill ? ' (' + esc(auto.skill) + ' at <b>' + esc(auto.level) + '</b>)' : '') +
    ', your <b>skills</b>, your <b>memory</b>, or the <b>audit chain</b> below. Authority here is structural, not conversational.</div>' +
    '<div class="p-sec">The last four events, kept outside the session</div>' +
    '<table class="aud"><tbody>' + tail + '</tbody></table>' +
    '<div class="q-s" style="margin-top:8px;color:var(--fg3)">Start over as often as you like. The record does not start over with you.</div>' +
    '</div></section>';
}
function sesHistory() { if (!S.sesHist) S.sesHist = (window.SESSIONS || { items: [] }).items.slice(); return S.sesHist; }
function sessionsCardHTML() {
  const H = window.SESSIONS || {};
  const rows = sesHistory().map(x => '<tr class="qrow" data-sess="' + esc(x.id) + '">' +
    '<td class="mono">' + esc(x.id) + '</td><td>' + esc(x.when) + '</td><td class="dim">' + esc(x.wb) + '</td>' +
    '<td>' + x.exchanges + '</td><td>' + (x.ran.length ? x.ran.map(r => '<span class="badge info">' + esc(r) + '</span>').join(' ') : '<span class="dim">' + '—' + '</span>') + '</td>' +
    '<td style="text-align:right"><button class="btn xs" data-sess="' + esc(x.id) + '" data-act="sessOpen">open</button> ' +
    '<button class="btn xs" data-sess="' + esc(x.id) + '" data-act="sessDel">delete</button></td></tr>').join('');
  return '<section class="w" data-size="wide"><div class="w-hd"><h3>Session history</h3>' +
    '<span class="w-auto">' + sesHistory().length + ' kept ' + '·' + ' the current one is live</span></div><div class="w-body">' +
    '<div class="q-s" style="margin-bottom:9px">' + esc(H.policy || '') + '</div>' +
    '<table class="aud"><thead><tr><th>session</th><th>when</th><th>workbench</th><th>exchanges</th><th>runs it produced</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<div class="q-s" style="margin-top:8px;color:var(--fg3)">Deleting a transcript removes the conversation and nothing else. The runs stay in the chain, and so does the fact that you deleted this.</div>' +
    '</div></section>';
}
function openSession(id) {
  const x = sesHistory().filter(s => s.id === id)[0];
  if (!x) return;
  S.item = { id: x.id, title: 'Session ' + x.id + ' ' + '·' + ' ' + x.wb,
    why: x.note,
    detail: { kv: [['When', x.when], ['Workbench', x.wb + ' (profile ' + S.wb.key + ')'], ['Exchanges', String(x.exchanges)],
        ['Runs it produced', x.ran.length ? x.ran.join(', ') : 'none ' + '—' + ' this session only answered questions'],
        ['Transcript', 'kept 90 days, then it expires on its own']],
      evidence: x.transcript, actions: [] } };
  renderPanel();
  toast('Transcript opened. The runs it produced are in the chain, not in the transcript.', 'ok');
}
function deleteSession(id) {
  const before = sesHistory().length;
  S.sesHist = sesHistory().filter(s => s.id !== id);
  if (S.sesHist.length === before) return;
  chainPush('session.transcript.deleted', 'user:' + user(), 'transcript ' + id + ' deleted ' + '·' + ' chain entries for its runs are untouched', 'info');
  toast('Transcript deleted. <b>The run record is not.</b>', 'ok');
  renderRail(); renderCanvas();
}
function renderChat() {
  $('#widgetGrid').innerHTML = widgetHTML(chatWidget(), false) + sessionCardHTML() + sessionsCardHTML();
  wireCanvas();
}
function pickItem(w, preferId) {
  const items = w.items || [];
  const found = preferId && items.filter(i => i.id === preferId)[0];
  return found || items.filter(i => i.run && !S.resolved[i.id])[0] || items[0];
}
function formRunnable(w) { return { id: w.key, title: w.title, run: w.run, detail: { kv: [], evidence: '', actions: w.actions || [] } }; }
function user() { return S.wb.identity.name.toLowerCase().replace(' ', '.'); }

/* ---------------- open an item into the context panel ---------------- */
function openItem(id) {
  const found = findItem(id);
  if (!found) return;
  S.item = found.it;
  S.selRow = id;
  chainPush('workbench.record.opened', 'user:' + user(), 'item=' + id + ' widget=' + found.w.key, 'info');
  renderCanvas(); renderPanel();
}
function findItem(id) {
  let out = null;
  S.wb.widgets.forEach(w => (w.items || []).forEach(it => { if (it.id === id) out = { w: w, it: it }; }));
  if (!out) S.wb.widgets.forEach(w => { if (w.key === id && w.run) out = { w: w, it: formRunnable(w) }; });
  if (!out && S.item && S.item.id === id) out = { w: widgetOf(S.item.widget || ''), it: S.item };
  return out;
}

/* ---------------- right panel ---------------- */
function renderPanel() {
  const active = S.active;
  const gateOpen = active && active.phase === 'gate';
  $('#panelTitle').textContent = gateOpen ? 'Decision required' : S.item ? 'Record' : 'Context';
  let html = '';
  if (gateOpen) html = gateHTML(active);
  else if (S.item) html = contextHTML(S.item);
  else html = '<div class="p-empty">Select a row to see the record, the evidence behind it, and the automation\u2019s reasoning.<br><br>When a run needs a person, the decision card appears here \u2014 never in a modal, so the record stays visible.</div>';
  $('#panelBody').innerHTML = html;
  wirePanel();
  $('#panel').className = 'panel' + (S.item || gateOpen ? ' open' : '');
}

function contextHTML(it) {
  const d = it.detail || {};
  const res = S.resolved[it.id];
  const run = it.run;
  const kv = (d.kv || []).map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('');
  const acts = res
    ? '<div class="policy" style="color:var(--ok);border-color:rgba(63,185,80,.4);background:rgba(63,185,80,.08)">Decision recorded: ' + esc(res) + '</div>'
    : (d.actions || []).map(a => '<button class="btn ' + (a.cls || '') + '" data-pact="' + esc(a.act) + '">' + a.label + '</button>').join('');
  return '<div class="p-sec">' + esc(it.title) + '</div>' +
    (it.why ? '<p class="p-note">' + esc(it.why) + '</p>' : '') +
    (kv ? '<dl class="kv">' + kv + '</dl>' : '') +
    (d.evidence ? '<div class="p-sec">Evidence</div><div class="evidence">' + esc(d.evidence) + '</div>' : '') +
    (run && (S.active && S.active.item.id === it.id) ? '<hr class="p-hr">' + timelineHTML(S.active) : '') +
    (acts ? '<div class="card-actions">' + acts + '</div>' : '');
}

function timelineHTML(a) {
  const rows = (a.steps || []).map((s, i) => {
    const cls = i < a.i ? 'done' : (i === a.i && a.phase === 'steps' ? 'run' : '');
    return rowStep(s, cls);
  }).join('');
  const gateRow = a.phase === 'gate' ? rowStep({ t: a.gate.kind === 'mfa' ? 'Waiting for you to sign in' : a.gate.kind === 'send' ? 'Waiting for you to approve the wording' : 'Waiting for your release', note: 'human decision required' }, 'wait') : '';
  const afterRows = (a.phase === 'after' || a.phase === 'done' && a.decision === 'approve') ? (a.after || []).map((s, i) => rowStep(s, i < a.i ? 'done' : (i === a.i ? 'run' : ''))).join('') : '';
  const pct = a.phase === 'gate' ? 100 : a.phase === 'after' ? 50 : Math.round(((a.i) / Math.max(1, a.steps.length)) * 100);
  return '<div class="p-sec">' + esc(a.item.run.label) + ' <span class="mono dim">' + esc(a.item.run.skill) + '</span></div>' +
    '<div class="stepbar"><i style="width:' + pct + '%"></i></div>' +
    '<div class="steps">' + rows + gateRow + afterRows + '</div>';
}
function rowStep(s, cls) {
  const ico = cls === 'done' ? '✓' : cls === 'run' ? '▸' : cls === 'wait' ? '⏸' : '·';
  return '<div class="step ' + cls + '"><span class="s-ico">' + ico + '</span><span>' + esc(s.t) +
    (s.note ? ' <span class="s-note">' + esc(s.note) + '</span>' : '') + '</span></div>';
}

/* ---------------- the decision card (the human boundary) ---------------- */
function gateHTML(a) {
  const g = a.gate;
  const cls = g.kind === 'send' ? 'help' : (g.kind === 'typeconfirm' ? 'danger' : 'hot');
  const head = g.kind === 'mfa' ? 'waiting on you · sign-in' : g.kind === 'send' ? 'waiting on you · nothing sent yet' : 'waiting on you · release required';
  const kv = (g.kv || []).map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('');
  let extra = '';
  if (g.kind === 'mfa' && S.lane && S.lane.live) {
    extra = '<div class="p-sec">Live lane available</div>' +
      '<div class="q-s" style="margin-bottom:9px">The bridge is connected to the real bsk daemon. Run this handoff for real: a session, an allow-listed tab, a live accessibility observation, and a request-help overlay that waits for you in your browser.</div>' +
      '<div class="card-actions"><button class="btn pri" data-lane="seq">Run it for real (live lane)</button>' +
      '<button class="btn" data-lane="help">Open a real human handoff</button></div>' +
      '<hr class="p-hr"><div class="p-sec">Your browser</div>' +
      '<div class="evidence">tab: ' + esc(g.tab) + '\n\n' + esc(g.prompt) + '\n\nautomation sees: page text only, after you authenticate\ncredentials: never read, never stored' +
      '\nborrow: confirmed by you · will be returned on completion</div>';
  }
  if (g.kind === 'send') extra = '<div class="p-sec">Draft awaiting your approval</div><div class="docpreview">' + esc(g.draft || '') + '</div>';
  let input = '';
  if (g.kind === 'typeconfirm') {
    input = '<div class="typeconfirm"><input id="tconfirm" placeholder="type ' + esc(g.word) + ' to release" autocomplete="off"><span class="badge bad" style="align-self:center">typed confirmation</span></div>';
  }
  const opts = (g.options || [{ label: 'Approve', act: 'approve', cls: 'pri' }, { label: 'Reject', act: 'reject', cls: 'danger' }]);
  const buttons = opts.map(o => '<button class="btn ' + (o.cls || '') + '" data-gate="' + esc(o.act) + '">' + o.label + '</button>').join('');
  return '<div class="card ' + cls + '">' +
    '<div class="card-hd"><span class="spin"></span> ' + esc(head) + '</div>' +
    '<div class="p-sec">' + esc(g.title) + '</div>' +
    (kv ? '<dl class="kv">' + kv + '</dl>' : '') +
    '<div class="policy">policy: ' + esc(g.policy) + '</div>' +
    extra + input +
    '<div class="card-actions">' + buttons + '</div>' +
    '<div class="card-actions"><button class="btn gho sm" data-gate="cancel">Stop this run</button></div>' +
    '</div>' +
    '<hr class="p-hr">' + timelineHTML(a);
}

function wirePanel() {
  $$('#panelBody [data-pact]').forEach(b => b.addEventListener('click', () => panelAction(b.getAttribute('data-pact'))));
  $$('#panelBody [data-gate]').forEach(b => b.addEventListener('click', () => decide(b.getAttribute('data-gate'))));
}

function panelAction(act) {
  const it = S.item;
  if (!it || !it.run) {
    if (act === 'ask') { S.view = null; toast('Use the scoped assistant widget to ask about this record.', 'ok'); }
    if (act === 'doc') toast('Source document is not part of this demo — the evidence block above is the extracted content.', 'ok');
    if (act === 'close') { S.resolved[it.id] = 'accepted'; save(); renderAll(); toast('Recommendation accepted and recorded.', 'ok'); }
    return;
  }
  if (act === 'run') { startRun(it); return; }
  if (act === 'doc') { toast('Source document is not part of this demo — the evidence block above is the extracted content.', 'ok'); return; }
  if (act === 'ask') { toast('Scoped assistant: ask in the widget on this workbench.', 'ok'); return; }
}

/* ---------------- run engine ---------------- */
function startRun(it) {
  if (!it || !it.run) { toast('This row has no automation attached — it is a human task.', 'warn'); return; }
  if (S.halted) {
    toast('The fleet is halted — <b>' + esc(S.halted.banner) + '</b>. No run starts in any workbench until it is lifted; use <b>' +
      esc(S.halted.resume_label) + '</b> on the halt banner.', 'warn');
    return;
  }
  if (S.active) { toast('One automation run at a time per workbench. Finish or stop the current run first.', 'warn'); return; }
  if (S.resolved[it.id]) { toast('A decision was already recorded for <b>' + esc(it.id) + '</b>.', 'warn'); return; }
  S.item = it;
  S.active = { item: it, phase: 'steps', i: 0, steps: it.run.steps || [], after: it.run.after || [], gate: it.run.gate, decision: null };
  chainPush('run.started', 'agent:' + it.run.skill, 'run started on ' + it.id + ' · ' + (it.run.label || ''), 'info');
  renderAll();
  tick();
}
function tick() {
  const a = S.active;
  if (!a) return;
  clearTimeout(a.timer);
  const list = a.phase === 'after' ? a.after : a.steps;
  if (a.i >= list.length) {
    if (a.phase === 'steps') { toGate(); return; }
    finishRun('approve'); return;
  }
  renderPanel(); renderStatus();
  a.timer = setTimeout(() => {
    if (!S.active) return;
    a.i++;
    if (a.i >= list.length) { if (a.phase === 'steps') { toGate(); return; } finishRun('approve'); return; }
    tick();
  }, 720);
}
function toGate() {
  const a = S.active;
  a.phase = 'gate';
  S.pending[a.item.id] = a;
  chainPush(a.gate.kind === 'mfa' ? 'run.paused.mfa' : 'run.paused.approval', 'agent:' + a.item.run.skill,
    'run paused on ' + a.item.id + ' · kind=' + a.gate.kind + ' · policy=' + a.gate.policy, 'warn');
  S.running = false;
  renderAll();
  toast('<b>Waiting on you.</b> ' + esc(a.gate.title) + ' — the run is paused, nothing has been written.', 'warn');
}
function decide(act) {
  const a = S.active;
  if (!a || a.phase !== 'gate') return;
  if (act === 'cancel') { stopRun(); return; }
  if (a.gate.kind === 'typeconfirm' && act === 'approve') {
    const inp = $('#tconfirm');
    if (!inp || inp.value.trim().toUpperCase() !== String(a.gate.word).toUpperCase()) {
      toast('Typed confirmation does not match. Type <b>' + esc(a.gate.word) + '</b> exactly to release.', 'warn');
      if (inp) { inp.focus(); inp.style.borderColor = 'var(--bad)'; }
      return;
    }
    chainPush('approval.attested', 'user:' + user(), 'typed attestation "' + a.gate.word + '" on ' + a.item.id + ' · policy=' + a.gate.policy, 'crit');
  }
  a.decision = act;
  delete S.pending[a.item.id];
  if (act === 'approve') {
    chainPush('approval.granted', 'user:' + user(), 'decision=approve on ' + a.item.id + ' · policy=' + a.gate.policy, 'warn');
    a.phase = 'after'; a.i = 0;
    renderAll();
    toast('Released. The automation is completing the remaining steps.', 'ok');
    tick();
  } else {
    chainPush(act === 'reject' ? 'approval.rejected' : 'approval.held', 'user:' + user(), 'decision=' + act + ' on ' + a.item.id, 'warn');
    finishRun(act);
  }
}
function stopRun() {
  const a = S.active;
  if (!a) return;
  delete S.pending[a.item.id];
  chainPush('run.stopped', 'user:' + user(), 'run stopped by the employee at ' + a.item.id + ' — nothing written', 'warn');
  const label = a.phase === 'gate' ? 'stopped at the decision point' : 'stopped';
  S.resolved[a.item.id] = 'stopped';
  S.active = null;
  save(); renderAll();
  toast('Run <b>' + esc(label) + '</b>. Nothing was written to any system of record.', 'warn');
}
function finishRun(act) {
  const a = S.active;
  if (!a) return;
  const id = a.item.id;
  const approved = act === 'approve';
  const m = S.metrics[S.wbKey] || (S.metrics[S.wbKey] = { automated: 0, saved: 0, runs: 0 });
  m.runs++;
  if (approved) { m.automated++; m.saved += 6 + (a.after || []).length * 3; }
  S.resolved[id] = approved ? 'resolved' : (act === 'hold' ? 'held' : 'rejected');
  chainPush(approved ? 'run.completed' : 'run.held', 'agent:' + a.item.run.skill,
    'run ' + (approved ? 'completed' : 'held') + ' on ' + id + ' · writes=' + (approved ? (a.after || []).length : 0), approved ? 'info' : 'warn');
  const outcome = approved ? (a.item.run.outcome || 'Completed by the automation within its grant.')
    : (act === 'reject' ? 'Rejected. Nothing was written to any system of record.' : 'Held. Nothing was written — the record is unchanged and the decision is logged.');
  const detail = approved ? (a.after || []).map(s => s.t).join(' · ')
    : 'Writes blocked. ' + (a.gate.kv || []).filter(r => r[0] === 'Object').map(r => r[1]).join('');
  // A run that declares `halt` arms the fleet halt by completing — the arm is the run,
  // with the same gate and the same attestation as every other governed write in the demo.
  if (approved && a.item.run.halt) armFleet(a.item.run.halt, a.item);
  S.active = null;
  save(); renderAll();
  toast('<b>' + esc(outcome) + '</b><br><span class="dim">' + esc(detail) + '</span>', approved ? 'ok' : 'warn');
}

/* ---------------- Skill Studio ---------------- */
function renderSkills() {
  // declared before the header uses them (a const read above its declaration throws in TDZ)
  const L = window.SKILL_LIBRARY || { corporate: [], rules: [], roles: [], legend: '' };
  const all = window.SKILLS.concat(L.corporate || [], S.forks || [], S.added || []).filter(s => !(S.skillGone || {})[s.key]);
  const company = all.filter(s => libraryOf(s) === 'company').length;
  const idx = window.SKILL_INDEX || { scaffolded: 0, full: all.length };
  const q = (S.skillQ || '').toLowerCase();
  $('#wbHead').innerHTML =
    '<div class="wb-title"><span class="wb-greet">Skill Studio</span><span class="wb-badge">' + esc(S.wb.short) + '</span></div>' +
    '<div class="wb-meta"><span><b>' + esc(L.legend) + '</b></span></div>' +
    '<div class="wb-meta"><span>' + all.length + ' skills indexed \u00b7 <b>' + all.filter(s => !s.abridged).length + ' with a full record</b> \u00b7 ' + idx.scaffolded +
      ' indexed from use' + (company ? ' \u00b7 ' + company + ' company baselines' : '') + '</span></div>' +
    '<div class="wb-meta"><span>You can <b>add</b>, <b>fork narrower</b> or <b>archive</b> \u00b7 nothing that is in use can be removed, and nothing cited can be unlookable.</span></div>' +
    '<div class="wb-meta" style="margin-top:8px;display:flex;gap:8px;align-items:center"><input class="skillq" data-skillq placeholder="filter ' + all.length + ' skills by name, key or owner" value="' + esc(S.skillQ || '') + '"><button class="btn xs nowrap" data-act="addSkill">+ Add a skill</button></div>' +
    '<div class="wb-meta"><span>Capability lists are <b>derived from the manifest by the platform</b> \u2014 an author cannot describe their own permissions. Nobody can raise their own autonomy ceiling.</span></div>';
  const skills = all.filter(s => !q || (s.key + ' ' + s.name + ' ' + s.owner).toLowerCase().indexOf(q) >= 0)
    .sort((a, b) => (libraryOf(a) === 'company' ? 0 : 1) - (libraryOf(b) === 'company' ? 0 : 1) ||
    (a.abridged ? 1 : 0) - (b.abridged ? 1 : 0) ||
    (mineSkill(b) ? 1 : 0) - (mineSkill(a) ? 1 : 0));
  // Whatever you just asked for goes first: a form that opens below two explainer cards
  // looks exactly like a button that did nothing.
  const composer = addSkillHTML() + amendHTML();
  $('#widgetGrid').innerHTML = composer + (q ? '' : authoringHTML() + libraryHTML()) + skills.map(s => {
    const g = s.grant;
    const caps = s.capabilities.map(c =>
      '<div class="step ' + (c.t.indexOf('NOT permitted') === 0 ? 'wait' : 'done') + '"><span class="s-ico">' +
      (c.t.indexOf('NOT permitted') === 0 ? '\u2715' : '\u2713') + '</span><span>' + esc(c.t) +
      ' <span class="s-note mono">' + esc(c.e) + '</span></span></div>').join('');
    const refused = s.requested_ceiling ?
      '<div class="card danger" style="margin-top:10px"><div class="card-hd">\u2715 refused by the platform</div>' +
      '<div class="q-s">' + esc(s.ceiling_note) + '</div>' +
      '<div class="policy">requested_ceiling = <b>' + esc(s.requested_ceiling) + '</b> \u00b7 workbench ceiling = <b>' +
      esc(S.wb.policies.autonomy_ceiling) + '</b> \u00b7 request denied, author notified</div></div>' : '';
    return '<section class="w" data-skill-card="' + esc(s.key) + '"' + (s.abridged ? ' data-abridged="1"' : '') + ' data-size="wide"><div class="w-hd"><h3>' + esc(s.name) +
      ' <span class="mono dim">' + esc(s.key) + '@' + esc(s.version) + '</span></h3>' +
      '<span class="w-auto lvl-' + (g.ceiling === 'auto' ? 'auto' : g.ceiling === 'approve' ? 'approve' : 'suggest') + '">ceiling: ' + esc(g.ceiling || 'not restated \u2014 the grant that cites it holds it') + '</span>' +
      (mineSkill(s) ? '<span class="w-auto" style="border-color:var(--accent);color:var(--accent)">yours</span>' : '') + '</div>' +
      '<div class="w-body"><div class="wb-meta" style="margin:0 0 10px">' +
        '<span>owner <b>' + esc(s.owner) + '</b></span><span>status <b>' + esc(skillStatus(s)) + '</b></span>' +
        '<span>environment <b>' + esc(g.environment) + '</b></span><span>approved by <b>' + esc(g.approved_by) + '</b></span>' +
        '<span>grant expires <b>' + esc(g.expires) + '</b></span></div>' +
      '<div class="p-sec">What it can and cannot do</div><div class="steps">' + caps + '</div>' +
      '<hr class="p-hr"><div class="wb-meta" style="margin:0">' +
        '<span>runs <b>' + s.metrics.runs + '</b></span><span>human approvals <b>' + s.metrics.approvals + '</b></span>' +
        '<span>rollbacks <b>' + s.metrics.rollbacks + '</b></span><span>last used <b>' + esc(s.metrics.last_used) + '</b></span></div>' +
      '<div class="wb-meta" style="margin-top:8px"><span>scope <span class="mono">' + esc(g.scope) + '</span></span></div>' +
      lifecycleHTML(s) + amendBlock(s) + invokedByHTML(s) + citedByHTML(s) + provenanceHTML(s) + refused + '</div></section>';
  }).join('');
}

/* ---------------- skill authoring + provenance ---------------- */

function authoringHTML() {
  const A = window.AUTHORING || { paths: [], rules: [] };
  const paths = A.paths.map(p =>
    '<div class="step done"><span class="s-ico">+</span><span><b>' + esc(p.n) + '</b> ' +
    '<span class="mono dim">' + esc(p.who) + '</span><br>' + esc(p.d) +
    '<br><span class="s-note">' + esc(p.review) + '</span></span></div>').join('');
  const rules = A.rules.map(r => '<div class="step wait"><span class="s-ico">\u2715</span><span>' + esc(r) + '</span></div>').join('');
  return '<section class="w" data-size="wide"><div class="w-hd"><h3>How a skill gets created</h3>' +
    '<span class="w-auto lvl-approve">authoring</span></div><div class="w-body">' +
    '<div class="p-sec">Three paths in</div><div class="steps">' + paths + '</div>' +
    '<hr class="p-hr"><div class="p-sec">Platform rules that apply to all three</div><div class="steps">' + rules + '</div>' +
    '</div></section>';
}

function amendBlock(s) {
  const a = (S.amends || {})[s.key];
  if (!a) return '';
  if (a.draft) {
    return '<hr class="p-hr"><div class="p-sec">Draft edit</div>' +
      '<div class="q-s"><b>v' + esc(a.ver) + '</b> (from v' + esc(a.from) + ') — ' + esc(a.what) + '<br>' +
      '<span class="dim">ceiling ' + esc(a.to) + ' \u00b7 status ' + esc(a.status) + '</span></div>' +
      '<div class="q-s" style="margin-top:6px;color:var(--fg3)">Nothing has run this skill, so there is no version history to preserve — ' +
      'which is exactly why a draft can be edited and a published skill cannot.</div>';
  }
  return '<hr class="p-hr"><div class="p-sec">Amendment in review</div>' +
    '<div class="q-s"><b>v' + esc(a.ver) + '</b> (from v' + esc(a.from) + ') — ' + esc(a.what) + '<br>' +
    '<span class="dim">ceiling ' + esc(a.to) + ' \u00b7 status ' + esc(a.status) + '</span></div>' +
    '<div class="q-s" style="margin-top:6px;color:var(--fg3)">v' + esc(a.from) + ' stays the version in use until a reviewer publishes v' + esc(a.ver) +
    '. Every run on record still points at the version it actually ran, so the history does not move when the skill does.</div>';
}
function skillPrefix() {
  const wbChat = (S.wb.widgets || []).filter(x => x.kind === 'chat')[0] || {};
  return ((wbChat.auto && String(wbChat.auto.skill).split('/')[0]) || S.wb.key);
}
function addSkillHTML() {
  if (!S.adding) return '';
  return '<section class="w" data-addcard="1" data-size="wide"><div class="w-hd"><h3>Propose a skill</h3>' +
    '<span class="w-auto lvl-suggest">draft</span></div><div class="w-body">' +
    '<div class="q-s" style="margin-bottom:9px;color:var(--fg3)">Say what it should do, and which systems it needs that your workbench does not already hold. ' +
    'You cannot grant yourself anything here: the ceiling is capped at what this workbench already runs at, and <b>a proposal is not a grant</b>.</div>' +
    '<input class="skillq" data-add-what placeholder="what should it do? e.g. reindex the vendor master overnight" style="margin-bottom:7px">' +
    '<input class="skillq" data-add-needs placeholder="new systems it would need? e.g. itsm.cmdb write   (leave empty if none)">' +
    '<div class="autoc" style="margin-top:9px">' +
      '<button class="btn xs" data-act="addPropose">Propose it</button>' +
      '<button class="btn xs" data-act="addCancel">Cancel</button>' +
    '</div></div></section>';
}
function amendHTML() {
  if (!S.amending) return '';
  const s = window.SKILLS.concat((window.SKILL_LIBRARY || {}).corporate || [], S.forks || [], S.added || []).filter(x => x.key === S.amending)[0] || {};
  return '<section class="w" data-amendcard="1" data-size="wide"><div class="w-hd"><h3>Amend <span class="mono">' + esc(s.key) + '</span></h3>' +
    '<span class="w-auto lvl-approve">amendment</span></div><div class="w-body">' +
    (s.draft
      ? '<div class="q-s" style="margin-bottom:9px;color:var(--fg3)">Nothing has run this yet, so it is <b>yours to change</b>: the edit lands as the next draft version. ' +
        'It still cannot run, and it still cannot exceed <b>' + esc((s.grant || {}).ceiling || '') + '</b>.</div>'
      : '<div class="q-s" style="margin-bottom:9px;color:var(--fg3)">A published skill is never edited in place. An amendment becomes the <b>next version, in review</b> — ' +
        'while the version in use keeps running. One thing an amendment can never do: <b>raise the ceiling</b> is not an author\u2019s to sign.</div>') +
    '<input class="skillq" data-amend-what placeholder="what should change? e.g. stop before the second signature too" style="margin-bottom:9px">' +
    '<div class="autoc">' +
      '<button class="btn xs" data-act="amendSame" data-skill="' + esc(s.key) + '">Keep the ceiling (' + esc((s.grant || {}).ceiling || '') + ')</button>' +
      '<button class="btn xs" data-act="amendNarrow" data-skill="' + esc(s.key) + '">Narrow it to suggest</button>' +
      '<button class="btn xs danger" data-act="amendWiden" data-skill="' + esc(s.key) + '">Raise it to auto</button>' +
      '<button class="btn xs" data-act="amendCancel">Cancel</button>' +
    '</div></div></section>';
}
function nextVersion(v) {
  const p = String(v || '1.0.0').split('.').map(Number);
  return p[0] + '.' + p[1] + '.' + ((p[2] || 0) + 1);
}
function amendSkill(key, mode) {
  const s = window.SKILLS.concat((window.SKILL_LIBRARY || {}).corporate || [], S.forks || [], S.added || []).filter(x => x.key === key)[0] || {};
  const wEl = $('[data-amend-what]');
  const what = ((wEl && wEl.value) || '').trim() || 'amendment proposed by ' + S.wb.identity.name;
  if (mode === 'widen') {
    chainPush('skill.amend.refused', 'user:' + user(), key + ' \u00b7 asked to raise the ceiling to auto', 'warn');
    toast('<b>Refused.</b> An amendment can narrow a grant; it can never widen one. A raise needs the control owner\u2019s signature, and you cannot sign your own.', 'warn');
    renderCanvas(); return;
  }
  const isDraft = !!s.draft;
  S.amends = S.amends || {};
  S.amends[key] = { ver: nextVersion(s.version), from: s.version, what: what, draft: isDraft,
    to: mode === 'narrow' ? 'suggest' : (s.grant || {}).ceiling, status: isDraft ? 'draft — edited in place' : 'in review' };
  S.skillSt = S.skillSt || {};
  if (!isDraft) S.skillSt[key] = 'amendment in review';
  chainPush(isDraft ? 'skill.amend.draft' : 'skill.amend.proposed', 'user:' + user(),
    key + ' \u00b7 v' + S.amends[key].ver + ' from v' + s.version + ', ceiling ' + S.amends[key].to + (isDraft ? ' (unpublished, so edited in place)' : ' (in review)'), 'info');
  S.amending = null;
  toast(isDraft
    ? '<b>Draft updated to v' + esc(S.amends[key].ver) + '.</b> A draft is yours to change — nothing has run it, so nothing can break. It still cannot run until a reviewer publishes it.'
    : '<b>v' + esc(S.amends[key].ver) + ' is in review.</b> v' + esc(s.version) + ' stays the version in use until a reviewer publishes the new one, so nothing that runs today changes underneath you.', 'ok');
  renderCanvas();
}
function proposeSkill() {
  const wEl = $('[data-add-what]'), nEl = $('[data-add-needs]');
  const what = ((wEl && wEl.value) || '').trim(), needs = ((nEl && nEl.value) || '').trim();
  if (!what) { toast('Say what the skill should do first \u2014 an unnamed skill cannot be reviewed.', 'warn'); return; }
  const wbChat = (S.wb.widgets || []).filter(x => x.kind === 'chat')[0] || {};
  const cap = (wbChat.auto && wbChat.auto.level) || 'suggest';
  const slug = (what.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 4).join('-') || 'new-skill');
  const key = skillPrefix() + '/' + slug;
  S.added = S.added || [];
  S.added.push({ key: key, version: '0.0.1', draft: true, library: 'personal',
    name: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    owner: S.wb.identity.name + ' (you, as proposer)', status: 'draft — awaiting a reviewer',
    grant: { scope: needs ? 'asks for: ' + needs : 'nothing new — uses what this workbench already holds', environment: 'prod',
      ceiling: cap, domains: needs ? [needs] : [], approved_by: 'nobody yet — this is a proposal', expires: 'review due when published' },
    capabilities: [ { t: what, e: 'proposed by you — not yet reviewed' },
      { t: 'NOT permitted until a reviewer publishes it: nothing above ' + cap, e: 'a proposal is not a grant' } ],
    metrics: { runs: 0, approvals: 0, rollbacks: 0, last_used: 'never' },
    reviewer: needs ? 'the workbench owner and Group Security, because it asks for ' + needs : 'the workbench owner' });
  chainPush('skill.proposed', 'user:' + user(), key + ' proposed \u00b7 ceiling capped at ' + cap + ' (what this workbench already runs at)', 'info');
  S.adding = false;
  toast('<b>Draft created.</b> <span class="mono">' + esc(key) + '</span> is yours alone until a reviewer publishes it, capped at <b>' + cap + '</b>.', 'ok');
  renderCanvas();
}
function submitDraft(key) {
  const s = (S.added || []).filter(x => x.key === key)[0];
  if (!s) return;
  S.skillSt = S.skillSt || {}; S.skillSt[key] = 'in review — with a named reviewer';
  chainPush('skill.submitted', 'user:' + user(), key + ' sent for review \u00b7 ' + (s.reviewer || 'the workbench owner'), 'info');
  toast('<b>Sent for review.</b> It goes to ' + esc(s.reviewer || 'your workbench owner') + '. It still cannot run, and it still cannot exceed <b>' + esc(s.grant.ceiling) + '</b>.', 'ok');
  renderCanvas();
}
function withdrawDraft(key) {
  S.added = (S.added || []).filter(x => x.key !== key);
  chainPush('skill.withdrawn', 'user:' + user(), key + ' withdrawn before review', 'info');
  toast('Draft withdrawn. Nothing had been published, so there was nothing to undo.', 'ok');
  renderCanvas();
}
function libraryOf(s) { return s.library === 'company' ? 'company' : 'personal'; }
function widgetsCiting(key) {
  const out = [];
  (S.wb.widgets || []).forEach(w => { if (w.auto && String(w.auto.skill).split('@')[0] === key) out.push(w.title || w.key); });
  return out;
}
function citedByHTML(s) {
  const w = widgetsCiting(s.key), a = autosUsing(s.key);
  const rows = [];
  w.forEach(t => rows.push('workbench button · ' + t));
  a.forEach(x => rows.push('automation · ' + x.name + ' (' + x.cadence + ')'));
  (s.cited_by || []).forEach(t => { if (rows.indexOf('workbench button · ' + t) < 0) rows.push('cited in · ' + t); });
  return '<hr class="p-hr"><div class="p-sec">Where it is cited</div>' +
    (rows.length ? '<div class="q-s">' + rows.map(r => '• ' + esc(r)).join('<br>') + '</div>'
                 : '<div class="q-s dim">Nothing cites it yet.</div>') +
    '<div class="q-s" style="margin-top:6px;color:var(--fg3)">A citation is a grant: the thing that cites it holds the ceiling, and citing a skill can never widen it.</div>';
}
function mineSkill(s) { return (s.owner || '').indexOf(S.wb.identity.name.split(' ')[0]) >= 0; }
function skillStatus(s) { if (!S.skillSt) S.skillSt = {}; return S.skillSt[s.key] || s.status; }
function autosUsing(key) { return (window.AUTOMATIONS || []).filter(a => String(a.skill || '').split('@')[0] === key); }
function invokedByHTML(s) {
  const autos = autosUsing(s.key);
  const row = autos.length
    ? autos.map(a => '<b>' + esc(a.name) + '</b> <span class="dim">' + esc(a.cadence) +
        (autoSt(a) === 'enabled' ? '' : ' \u00b7 ' + esc(autoSt(a))) + '</span>').join('<br>')
    : '<span class="dim">No automation invokes it \u2014 it runs by hand, on purpose.</span>' +
      (!s.abridged && String(skillStatus(s)).indexOf('published') === 0
        ? ' <button class="btn xs" data-act="scheduleIt" data-skill="' + esc(s.key) + '">Schedule it</button>'
        : '');
  return '<hr class="p-hr"><div class="p-sec">When it happens</div><div class="q-s">' + row + '</div>' +
    '<div class="q-s" style="margin-top:6px;color:var(--fg3)">This skill decides <b>what is allowed</b>; an automation decides <b>when</b>. An automation invokes a skill and can never widen it.</div>';
}
function lifecycleHTML(s) {
  const st = skillStatus(s), lib = libraryOf(s);
  if (s.draft) {
    return '<hr class="p-hr"><div class="p-sec">What you can do with it</div>' +
      '<div class="autoc">' +
        '<button class="btn xs" data-act="skillSubmit" data-skill="' + esc(s.key) + '">Submit for review</button>' +
        '<button class="btn xs" data-act="skillAmend" data-skill="' + esc(s.key) + '">Amend it</button>' +
        '<button class="btn xs danger" data-act="skillWithdraw" data-skill="' + esc(s.key) + '">Withdraw</button>' +
      '</div>' +
      '<div class="q-s" style="margin-top:7px;color:var(--fg3)"><b>A proposal is not a grant.</b> Nothing can run it until a reviewer publishes it. ' +
      'It is capped at <b>' + esc(s.grant.ceiling) + '</b> — the ceiling this workbench already holds, because you cannot raise your own. It goes to ' + esc(s.reviewer || 'your workbench owner') + '.</div>';
  }
  const autos = autosUsing(s.key);
  const runs = (s.metrics && s.metrics.runs) || 0;
  const cites = widgetsCiting(s.key).length + (s.cited_by || []).length;
  const canRemove = !autos.length && !runs && !cites;
  const why = autos.length ? (autos.length + ' automation' + (autos.length > 1 ? 's' : '') + ' invoke it')
    : (runs ? runs + ' runs on record' : (cites ? 'it is cited in ' + cites + ' place' + (cites > 1 ? 's' : '') + ' in this estate' : ''));
  return '<hr class="p-hr"><div class="p-sec">What you can do with it</div>' +
    '<div class="autoc">' +
      '<button class="btn xs" data-act="skillFork" data-skill="' + esc(s.key) + '">Fork it narrower</button>' +
      (st === 'archived'
        ? '<button class="btn xs" data-act="skillRestore" data-skill="' + esc(s.key) + '">Restore</button>'
        : '<button class="btn xs" data-act="skillArchive" data-skill="' + esc(s.key) + '">' + (lib === 'company' ? 'Ask to archive' : 'Archive') + '</button>') +
      (mineSkill(s) || s.draft
        ? '<button class="btn xs" data-act="skillAmend" data-skill="' + esc(s.key) + '">Amend it</button>'
        : '<button class="btn xs" data-act="skillAmendAsk" data-skill="' + esc(s.key) + '">Ask the owner to amend</button>') +
      '<button class="btn xs danger" data-act="skillRemove" data-skill="' + esc(s.key) + '"' + (canRemove ? '' : ' disabled') + '>Remove</button>' +
    '</div>' +
    '<div class="q-s" style="margin-top:7px;color:var(--fg3)">' + (canRemove
      ? 'Nothing invokes it and it has never run, so removal is allowed.'
      : 'Removal is refused here: ' + esc(why) + '. <b>Archive it instead</b> \u2014 archiving keeps every run, and it is reversible.') + '</div>' +
    (lib === 'company' ? '<div class="q-s" style="margin-top:6px;color:var(--fg3)">Company skill: you can use it and fork it. Editing it is not an employee action.</div>'
      : '') +
    (s.forked_from ? '<div class="q-s" style="margin-top:6px;color:var(--fg3)">Your fork of <span class="mono">' + esc(s.forked_from) + '</span> \u2014 a fork never inherits a wider grant than its parent.</div>' : '');
}
function libraryHTML() {
  const L = window.SKILL_LIBRARY || { roles: [], rules: [] };
  const rows = (L.roles || []).map(r => '<tr><td><b>' + esc(r.who) + '</b></td><td>' + esc(r.may) + '</td><td class="dim">' + esc(r.may_not) + '</td></tr>').join('');
  const rules = (L.rules || []).map(r => '<div class="step wait"><span class="s-ico">\u2715</span><span>' + esc(r) + '</span></div>').join('');
  return '<section class="w" data-size="wide"><div class="w-hd"><h3>Who may do what</h3>' +
    '<span class="w-auto">three verbs, not a permission system</span></div><div class="w-body">' +
    '<table class="aud"><thead><tr><th>role</th><th>may</th><th>may not</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<hr class="p-hr"><div class="p-sec">Rules the platform enforces, whichever verb you use</div><div class="steps">' + rules + '</div>' +
    '</div></section>';
}
function forkSkill(key) {
  const s = window.SKILLS.concat((window.SKILL_LIBRARY || {}).corporate || [], S.forks || []).filter(x => x.key === key)[0];
  if (!s) return;
  const lower = s.grant.ceiling === 'approve' ? 'suggest' : s.grant.ceiling === 'auto' ? 'approve' : 'suggest';
  S.forks = S.forks || [];
  const fk = s.key + '/fork-' + (S.forks.length + 1);
  S.forks.push({ key: fk, version: '0.1.0', name: s.name + ' (my fork)', owner: S.wb.identity.name + ' (you)', library: 'personal',
    status: 'draft \u2014 your copy', forked_from: s.key + '@' + s.version, grant: Object.assign({}, s.grant, { ceiling: lower }),
    capabilities: s.capabilities.concat([{ t: 'NOT permitted: anything the original could do above ' + lower, e: 'fork ceiling is a lower bound, never a raise' }]),
    metrics: { runs: 0, approvals: 0, rollbacks: 0, last_used: 'never' } });
  chainPush('skill.forked', 'user:' + user(), fk + ' forked from ' + key + '@' + s.version + ' \u00b7 ceiling lowered to ' + lower, 'info');
  toast('Forked to <b>' + esc(fk) + '</b> with the ceiling lowered to <b>' + lower + '</b>. A fork can never inherit a wider grant.', 'ok');
  renderCanvas();
}
function archiveSkill(key) {
  const s = window.SKILLS.concat((window.SKILL_LIBRARY || {}).corporate || [], S.forks || []).filter(x => x.key === key)[0];
  if (!s) return;
  if (s.abridged) {
    toast('This is an <b>index entry</b>, not a full record — there is nothing to archive yet. The grant lives with whatever cites it.', 'warn');
    renderCanvas(); return;
  }
  if (libraryOf(s) === 'company' && !mineSkill(s)) {
    chainPush('skill.archive.refused', 'user:' + user(), key + ' \u00b7 company skill, archiving is the owner\u2019s call', 'warn');
    toast('<b>Not yours to archive.</b> ' + esc(s.owner) + ' owns this one \u2014 ask them, or fork it into your own copy.', 'warn');
    renderCanvas(); return;
  }
  S.skillSt = S.skillSt || {}; S.skillSt[key] = 'archived';
  const paused = autosUsing(key).filter(a => autoSt(a) === 'enabled');
  paused.forEach(a => { S.autoSt = S.autoSt || {}; S.autoSt[a.key] = 'paused'; });
  chainPush('skill.archived', 'user:' + user(), key + ' archived \u00b7 ' + (paused.length ? paused.map(a => a.key).join(', ') + ' paused rather than left to fail' : 'no automation invokes it'), 'warn');
  toast('<b>' + esc(s.name) + '</b> archived.' + (paused.length ? ' The ' + paused.length + ' automation(s) that invoke it are now paused \u2014 they cannot run a skill that is not published.' : ' Its run history is untouched.'), 'ok');
  renderCanvas();
}
function restoreSkill(key) {
  S.skillSt = S.skillSt || {}; S.skillSt[key] = 'published';
  chainPush('skill.restored', 'user:' + user(), key + ' restored; paused automations stay paused until a human resumes them', 'info');
  toast('Restored. Automations that were paused by the archive stay paused until you resume them.', 'ok');
  renderCanvas();
}
function removeSkill(key) {
  const s = window.SKILLS.concat((window.SKILL_LIBRARY || {}).corporate || [], S.forks || []).filter(x => x.key === key)[0];
  if (!s) return;
  const autos = autosUsing(key), runs = (s.metrics && s.metrics.runs) || 0;
  if (autos.length || runs) {
    toast('<b>Refused.</b> ' + (autos.length ? autos.length + ' automation(s) invoke it' : '') + (autos.length && runs ? ' and ' : '') + (runs ? runs + ' runs are on record' : '') + '. Archive it instead.', 'warn');
    renderCanvas(); return;
  }
  S.skillGone = S.skillGone || {}; S.skillGone[key] = true;
  chainPush('skill.removed', 'user:' + user(), key + ' removed \u00b7 nothing invoked it and it had never run', 'info');
  toast('<b>' + esc(s.name) + '</b> removed. Nothing depended on it.', 'ok');
  renderCanvas();
}
function provenanceHTML(s) {
  const p = (window.SKILL_PROVENANCE || {})[s.key];
  if (!p) return '';
  const hist = (p.history || []).map(h =>
    '<div class="step ' + (h.state === 'current' ? 'done' : 'wait') + '"><span class="s-ico">' +
    (h.state === 'current' ? '\u2713' : '\u00b7') + '</span><span><span class="mono">' + esc(h.v) + '</span> ' +
    '<span class="dim">' + esc(h.state) + ' \u00b7 ' + esc(h.at) + '</span><br>' + esc(h.note) + '</span></div>').join('');
  return '<hr class="p-hr"><div class="p-sec">Where it came from</div>' +
    '<div class="wb-meta" style="margin:0 0 8px"><span>created by <b>' + esc(p.how) + '</b></span>' +
    '<span>' + esc(p.by) + ' \u00b7 ' + esc(p.when) + '</span></div>' +
    '<div class="q-s" style="margin-bottom:8px">' + esc(p.source) + '</div>' +
    '<div class="p-sec">Version line \u2014 immutable, every entry pinned to the audit chain</div>' +
    '<div class="steps">' + hist + '</div>';
}

/* ---------------- automations: the trigger layer ---------------- */

function autoSt(a) { if (!S.autoSt) S.autoSt = {}; return S.autoSt[a.key] || a.state; }
function autoRuns(key) { return ((window.AUTO_RUNS || {})[key] || { runs: [] }); }
function autoByKey(key) { return (window.AUTOMATIONS || []).filter(x => x.key === key)[0]; }
function autoHistLine(key) {
  const h = autoRuns(key);
  return (h.summary || 'No runs recorded yet.') + (h.note ? ' ' + h.note : '');
}
function autoToggle(key) {
  const a = autoByKey(key); if (!a) return;
  const cur = autoSt(a);
  const next = cur === 'paused' ? 'enabled' : 'paused';
  S.autoSt = S.autoSt || {}; S.autoSt[key] = next;
  chainPush('automation.' + (next === 'paused' ? 'paused' : 'resumed'), 'user:' + user(),
    key + ' \u00b7 ' + (next === 'paused' ? 'starts nothing new; a run already in flight finishes and stops at its gate' : 'next tick ' + a.cadence), 'info');
  toast(next === 'paused' ? '<b>' + esc(a.name) + '</b> paused. A run already in flight finishes and stops at its gate.' :
    '<b>' + esc(a.name) + '</b> resumed. Next tick: ' + esc(a.cadence) + '.', 'ok');
  renderRail(); renderCanvas();
}
function autoRetire(key) {
  const a = autoByKey(key); if (!a) return;
  if (S.autoArmed !== key) {
    S.autoArmed = key;
    toast('Retire <b>' + esc(a.name) + '</b>? Press again. The schedule stops; its ' + a.runs_30d + ' recorded runs stay.', 'warn');
    renderCanvas(); return;
  }
  S.autoArmed = null; S.autoSt = S.autoSt || {}; S.autoSt[key] = 'retired';
  chainPush('automation.retired', 'user:' + user(), key + ' \u00b7 schedule retired; ' + a.runs_30d + ' recorded runs and their chain entries are untouched', 'warn');
  toast('<b>' + esc(a.name) + '</b> retired. Its recorded runs are still in the record.', 'ok');
  renderRail(); renderCanvas();
}
function autoHistory(key) {
  const a = autoByKey(key); if (!a) return;
  const h = autoRuns(key);
  S.item = { id: key, title: 'Run history · ' + a.name,
    why: h.note || 'Every run of this automation, with what invoked it and how it ended.',
    detail: {
      kv: [['State', autoSt(a) + (autoSt(a) === 'paused' ? ' · a pause stops new runs, not running ones' : '')],
        ['Runs, 30 days', String(a.runs_30d)], ['Summary', h.summary || '—'],
        ['Skill invoked', a.skill], ['Ceiling', a.ceiling], ['Human touches', String(a.human_touches)],
        ['History is not erasable here', 'these runs are chain entries; retiring the schedule does not remove them']],
      evidence: (h.runs || []).map(r => r.t + '  |  ' + r.trig + '  |  ' + r.out + '  |  ' + r.skill + '  |  ' + r.dur + '\n     ' + (r.why || '')).join('\n'),
      actions: [] } };
  renderPanel();
  toast('Run history opened. Deletions do not exist here — a retired automation keeps every run it ever did.', 'ok');
}
function autoRunNow(key) {
  const a = autoByKey(key); if (!a) return;
  const m = (window.AUTO_MANUAL || {})[key];
  if (!m) { toast('This automation has no manual trigger, on purpose.', 'warn'); return; }
  if (m.refused) {
    chainPush('automation.refused', 'agent:' + a.skill, key + ' \u00b7 manual run refused: ' + m.refused, 'warn');
    toast('<b>Refused.</b> ' + esc(String(m.refused).replace(/^Refused before it started: /, '')), 'warn'); renderCanvas(); return;
  }
  if (m.completes) {
    chainPush('run.completed', 'agent:' + a.skill, key + ' \u00b7 manual run completed inside the grant, no gate crossed', 'ok');
    toast(esc(m.does || 'Completed inside the grant.'), 'ok'); renderCanvas(); return;
  }
  const it = { id: key + '#manual-' + (S.runSeq = (S.runSeq || 1) + 1), title: a.name + ' (run now)',
    sub: 'manual trigger · ' + m.skill,
    run: { label: m.label || a.name, skill: m.skill, steps: m.steps, gate: m.gate, after: m.after, outcome: m.outcome } };
  startRun(it);
}
function schedEditor(a) {
  if (S.autoSched !== a.key) return '';
  const FREQ = [['daily', 'every day'], ['weekdays', 'every weekday'], ['weekly', 'every week'], ['monthly', 'every month']];
  const freq = S.schedFreq || 'weekdays';
  return '<div data-schededit="1" style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:9px 0 2px">' +
    '<span class="q-s" style="color:var(--fg3)">Run</span>' +
    FREQ.map(f => '<button class="btn xs' + (freq === f[0] ? ' pri' : '') + '" data-sched-freq="' + f[0] + '">' + f[1] + '</button>').join('') +
    '<input class="skillq" data-sched-time value="' + esc(S.schedTime || ((a.cadence || '').match(/[0-9][0-9]:[0-9][0-9]/) || ['07:30'])[0]) + '" style="width:88px;flex:0 0 88px">' +
    '<button class="btn xs" data-act="autoSchedSave" data-auto="' + esc(a.key) + '">Save schedule</button>' +
    '<button class="btn xs" data-act="autoSchedCancel">Cancel</button>' +
    '<span class="q-s" style="color:var(--fg3)">this changes <b>when</b>, never <b>what may be done</b> \u2014 the ceiling belongs to the skill</span></div>';
}
function saveSchedule(key) {
  const a = (window.AUTOMATIONS || []).filter(x => x.key === key)[0];
  if (!a) return;
  const tEl = $('[data-sched-time]');
  const time = ((tEl && tEl.value) || '07:30').trim();
  const before = a.cadence;
  a.cadence = freqWords(S.schedFreq || 'weekdays') + ' ' + time;
  a.next_run = 'next ' + a.cadence;
  chainPush('automation.rescheduled', 'user:' + user(), key + ' \u00b7 ' + before + ' \u2192 ' + a.cadence + (autoSt(a) === 'paused' ? ' \u00b7 still paused' : ''), 'info');
  S.autoSched = null; S.schedFreq = null; S.schedTime = null;
  toast('<b>' + esc(a.name) + '</b> now runs <b>' + esc(a.cadence) + '</b>. The change is in the record' +
    (autoSt(a) === 'paused' ? ', and it stays paused \u2014 rescheduling is not resuming.' : '. Runs already queued are not recalled.'), 'ok');
  renderCanvas();
}
function freqWords(f) { return { daily: 'every day', weekdays: 'every weekday', weekly: 'every week', monthly: 'every month' }[f] || 'every day'; }
function gateWords(ceiling) {
  if (ceiling === 'auto') return 'It runs unattended at auto \u2014 and that ceiling came from the skill, not from the schedule.';
  if (ceiling === 'approve') return 'It runs on time, but anything above approve queues and waits for a person \u2014 nobody online at 07:30 does not make an approval.';
  return 'It suggests and stops. Every run ends with a human deciding what happens next.';
}
function myTasks() {
  const out = [];
  (S.wb.widgets || []).forEach(w => (w.items || []).forEach(it => { if (it.id && !(it.id in out)) out.push({ id: it.id, title: it.title || '' }); }));
  return out.slice(0, 12);
}
function effCeiling(a, b) { const R = { suggest: 0, approve: 1, auto: 2 }; return (R[a] <= R[b] ? a : b); }
function publishedSkills() {
  const L = window.SKILL_LIBRARY || {};
  return window.SKILLS.concat(L.corporate || [], S.forks || [], S.added || [])
    .filter(s => !s.draft && String(skillStatus(s)).indexOf('published') === 0);
}
function newAutoHTML() {
  if (!S.addAuto) return '';
  const FREQ = [['daily', 'every day'], ['weekdays', 'every weekday'], ['weekly', 'every week'], ['monthly', 'every month']];
  const picks = publishedSkills();
  const opts = ['<option value="">\u2014 no skill attached \u2014</option>'].concat(picks.map(s =>
    '<option value="' + esc(s.key) + '"' + (S.autoPrefill === s.key ? ' selected' : '') + '>' + esc(s.key) + ' @ ' + esc(s.grant.ceiling) + ' — ' + esc(s.name) + '</option>')).join('');
  return '<section class="w" data-newauto="1" data-size="wide"><div class="w-hd"><h3>New automation</h3>' +
    '<span class="w-auto lvl-suggest">you are writing the trigger</span></div><div class="w-body">' +
    '<div class="q-s" style="margin-bottom:9px;color:var(--fg3)">Describe what should happen regularly, when, and <b>which skill does it</b>. ' +
    'The trigger never invents capability: the skill you attach carries its own ceiling, and an automation that would widen it is refused rather than approved.</div>' +
    '<input class="skillq" data-auto-what placeholder="what should happen? e.g. sweep the invoice queue before the morning huddle" value="' + esc(S.autoWhat || '') + '" style="margin-bottom:9px">' +
    '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:9px">' +
      '<span class="q-s" style="color:var(--fg3)">When</span>' +
      FREQ.map(f => '<button class="btn xs' + ((S.autoFreq || 'weekdays') === f[0] ? ' pri' : '') + '" data-auto-freq="' + f[0] + '">' + f[1] + '</button>').join('') +
      '<input class="skillq" data-auto-time value="' + esc(S.autoTime || '07:30') + '" style="width:88px;flex:0 0 88px">' +
    '</div>' +
    '<div style="display:flex;gap:7px;align-items:center;margin-bottom:8px"><span class="q-s" style="color:var(--fg3);min-width:78px">Does it with</span>' +
      '<select class="skillq" data-auto-skill>' + opts + '</select></div>' +
    '<div style="display:flex;gap:7px;align-items:center;margin-bottom:8px"><span class="q-s" style="color:var(--fg3);min-width:78px">Repeats task</span>' +
      '<select class="skillq" data-auto-task><option value="">\u2014 nothing, it starts fresh \u2014</option>' +
      myTasks().map(t => '<option value="' + esc(t.id) + '">' + esc(t.id) + ' — ' + esc(t.title) + '</option>').join('') + '</select></div>' +
    '<div style="display:flex;gap:7px;align-items:center;margin-bottom:10px"><span class="q-s" style="color:var(--fg3);min-width:78px">Chains into</span>' +
      '<select class="skillq" data-auto-chain><option value="">\u2014 nothing \u2014</option>' +
      (window.AUTOMATIONS || []).map(a => '<option value="' + esc(a.key) + '">' + esc(a.key) + ' — invokes ' + esc(a.skill) + ' at ' + esc(a.ceiling) + '</option>').join('') + '</select></div>' +
    '<div class="q-s" style="margin-bottom:9px;color:var(--fg3)">A <b>task</b> is a snapshot of intent \u2014 the steps still run as the skill, so repeating one cannot exceed the skill\u2019s ceiling. ' +
    'Chaining an <b>automation</b> runs it under <i>its</i> ceiling; the pair inherits the lower of the two, and chaining is not a way to reach a capability you were not granted.</div>' +
    '<div class="autoc">' +
      '<button class="btn xs" data-act="autoCreate">Create this automation</button>' +
      '<button class="btn xs" data-act="autoCancel">Cancel</button>' +
    '</div></div></section>';
}
function createAutomation() {
  const whatEl = $('[data-auto-what]'), timeEl = $('[data-auto-time]'), skEl = $('[data-auto-skill]');
  const what = ((whatEl && whatEl.value) || '').trim();
  const time = ((timeEl && timeEl.value) || '07:30').trim();
  const selKey = (skEl && skEl.value) || '';
  if (!what) { toast('Say what should happen first \u2014 an automation with no stated purpose cannot be reviewed.', 'warn'); return; }
  if (!selKey) {
    chainPush('automation.refused', 'user:' + user(), 'refused: no skill attached — an unattached schedule is a script holding your grant, not an automation', 'warn');
    toast('<b>Refused.</b> An automation must invoke a skill. An unattached schedule is just a script wearing your name, and that is exactly what this cockpit exists to prevent.', 'warn');
    renderCanvas(); return;
  }
  const sk = publishedSkills().filter(s => s.key === selKey)[0];
  if (!sk) {
    const any = window.SKILLS.concat((window.SKILL_LIBRARY || {}).corporate || [], S.forks || [], S.added || []).filter(s => s.key === selKey)[0] || {};
    chainPush('automation.refused', 'user:' + user(), 'refused: ' + selKey + ' is ' + skillStatus(any) + ' — an automation cannot invoke a skill that cannot run', 'warn');
    toast('<b>Refused.</b> <span class="mono">' + esc(selKey) + '</span> is <b>' + esc(skillStatus(any)) + '</b>. An automation cannot invoke a skill that cannot run.', 'warn');
    renderCanvas(); return;
  }
  const taskEl = $('[data-auto-task]'), chainEl = $('[data-auto-chain]');
  const taskId = (taskEl && taskEl.value) || '';
  const chainKey = (chainEl && chainEl.value) || '';
  let chain = null;
  if (chainKey) {
    chain = (window.AUTOMATIONS || []).filter(a => a.key === chainKey)[0];
    if (!chain) {
      chainPush('automation.refused', 'user:' + user(), 'refused: no automation called ' + chainKey + ' to chain into', 'warn');
      toast('<b>Refused.</b> There is no automation called <span class="mono">' + esc(chainKey) + '</span> to chain into. A chain that resolves to nothing is dropped silently, so this one stops here instead.', 'warn');
      renderCanvas(); return;
    }
    if (chain) {
      const reach = (S.wb.widgets || []).some(w => w.auto && String(w.auto.skill).split('@')[0] === String(chain.skill).split('@')[0]);
      if (!reach) {
        chainPush('automation.refused', 'user:' + user(), 'refused: chaining ' + chainKey + ' would reach ' + chain.skill + ', which this workbench is not granted', 'warn');
        toast('<b>Refused.</b> That automation runs <span class="mono">' + esc(chain.skill) + '</span>, which this workbench is not granted. Chaining it would reach that capability sideways \u2014 <b>a chain is not a grant</b>.', 'warn');
        renderCanvas(); return;
      }
      if (autoSt(chain) !== 'enabled') {
        chainPush('automation.refused', 'user:' + user(), 'refused: ' + chainKey + ' is ' + autoSt(chain) + ' \u2014 a paused dependency is not a step', 'warn');
        toast('<b>Refused.</b> <span class="mono">' + esc(chainKey) + '</span> is <b>' + esc(autoSt(chain)) + '</b>. Chaining a paused automation would leave your run waiting on something that is not running.', 'warn');
        renderCanvas(); return;
      }
    }
  }
  const cadence = freqWords(S.autoFreq || 'weekdays') + ' ' + time;
  const slug = (what.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 4).join('-') || 'new-automation');
  const key = 'user/' + slug;
  if ((window.AUTOMATIONS || []).some(a => a.key === key)) { toast('You already have an automation with that name \u2014 give this one a distinct purpose.', 'warn'); return; }
  window.AUTOMATIONS.push({ key: key, name: what.charAt(0).toUpperCase() + what.slice(1), trigger: 'schedule', cadence: cadence,
    next_run: cadence, skill: sk.key + '@' + sk.version, workbench: S.wb.short, owner: S.wb.identity.name,
    env: 'prod', ceiling: chain ? effCeiling(sk.grant.ceiling, chain.ceiling) : sk.grant.ceiling, state: 'enabled', runs_30d: 0, human_touches: 0, mine: true,
    task: taskId || null, chain: chain ? chain.key : null,
    last: 'has not run yet — first run ' + cadence,
    on_gate: gateWords(sk.grant.ceiling) });
  chainPush('automation.created', 'user:' + user(), key + ' \u00b7 ' + cadence + ' \u00b7 invokes ' + sk.key + '@' + sk.version + ' at ' + sk.grant.ceiling +
    (taskId ? ' \u00b7 repeats task ' + taskId : '') + (chain ? ' \u00b7 chains ' + chain.key + ', effective ceiling ' + effCeiling(sk.grant.ceiling, chain.ceiling) : ''), 'info');
  S.addAuto = false; S.autoPrefill = null; S.autoWhat = '';
  toast('<b>Created.</b> It invokes <span class="mono">' + esc(sk.key) + '</span>, so it carries that skill\u2019s ceiling of <b>' + esc(sk.grant.ceiling) + '</b>. Attaching a skill that is already reviewed cannot widen anything, so no new approval was needed \u2014 the record shows it anyway.', 'ok');
  renderCanvas();
}
function renderAutomations() {
  const A = window.AUTOMATIONS || [];
  const mineK = S.wb.short;
  const on = A.filter(x => autoSt(x) === 'enabled').length;
  const touches = A.reduce((n, a) => n + (a.human_touches || 0), 0);
  $('#wbHead').innerHTML =
    '<div class="wb-title"><span class="wb-greet">Automations</span><span class="wb-badge">' + esc(S.wb.short) + '</span></div>' +
    '<div class="wb-meta"><span>Triggers, not capabilities. A schedule or an event <b>invokes</b> a skill; it never widens one.</span></div>' +
    '<div class="wb-meta"><span>Every run is recorded before it is forgotten: what invoked it, which skill version answered, and how it ended \u2014 completed, stopped at a gate, or refused. A refusal is not a failure; it is the ceiling working.</span></div>' +
    '<div class="wb-meta"><span>' + on + ' of ' + A.length + ' enabled \u00b7 ' + touches + ' human touches in 30 days. ' +
    'An unattended run carries the <b>same ceiling</b> as a manual one, and a gate <b>queues for a human</b> instead of resolving itself.</span></div>' +
    '<div class="wb-meta" style="margin-top:8px;display:flex;gap:8px;align-items:center">' +
      '<span class="q-s" style="color:var(--fg3)">Say what should happen regularly, and attach the skill that does it \u2014 the same way you would describe it in chat.</span>' +
      '<button class="btn xs nowrap" data-act="autoOpen" style="margin-left:auto;flex:0 0 auto;font-weight:650;border-color:var(--accent);color:var(--accent)">+ New automation</button></div>';
  $('#widgetGrid').innerHTML = newAutoHTML() + A.slice().sort((a, b) =>
      (b.workbench === mineK ? 1 : 0) - (a.workbench === mineK ? 1 : 0)).map(a => {
    const trig = a.trigger === 'schedule' ? '\u23f1' : a.trigger === 'event' ? '\u26a1' : '\u2318';
    return '<section class="w" data-size="wide" data-trigger="' + esc(a.trigger) + '"><div class="w-hd"><h3>' + esc(a.name) +
      ' <span class="mono dim">' + esc(a.key) + '</span></h3>' +
      '<span class="w-auto lvl-' + (a.ceiling === 'auto' ? 'auto' : a.ceiling === 'approve' ? 'approve' : 'suggest') + '">ceiling: ' + esc(a.ceiling || 'not restated \u2014 the grant that cites it holds it') + '</span>' +
      '<span class="w-auto' + (autoSt(a) === 'enabled' ? '' : ' lvl-suggest') + '">' + esc(autoSt(a)) + '</span>' +
      (a.workbench === mineK ? '<span class="w-auto" style="border-color:var(--accent);color:var(--accent)">yours</span>' : '') +
      '</div><div class="w-body"><div class="wb-meta" style="margin:0 0 10px">' +
      '<span>' + trig + ' <b>' + esc(a.trigger) + '</b></span><span>cadence <b>' + esc(a.cadence) + '</b></span>' +
      '<span>next <b>' + esc(a.next_run) + '</b></span><span>runs 30d <b>' + a.runs_30d + '</b></span>' +
      '<span>human touches <b>' + a.human_touches + '</b></span><span>owner <b>' + esc(a.owner) + '</b></span>' +
      (a.pinned ? '<span class="badge warn">version pinned</span>' : '') + '</div>' +
      (a.task || a.chain
        ? '<div class="q-s" style="margin:0 0 8px;color:var(--fg3)">' +
            (a.task ? 'repeats the task <span class="mono">' + esc(a.task) + '</span> \u00b7 a snapshot of intent, and its steps still run as the skill \u00b7 ' : '') +
            (a.chain ? 'chains <span class="mono">' + esc(a.chain) + '</span> \u00b7 effective ceiling <b>' + esc(a.ceiling) + '</b> (the lower of the two, because neither side may be widened by the other)' : '') +
          '</div>'
        : '') +
      '<div class="wb-meta" style="margin:0 0 10px"><span>invokes <button class="btn xs" data-goto="skills" style="padding:2px 7px"><span class="mono">' + esc(a.skill) + '</span></button></span>' +
      '<span>workbench <b>' + esc(a.workbench) + '</b></span><span>environment <b>' + esc(a.env) + '</b></span></div>' +
      '<div class="p-sec">What happens when it hits a gate</div><div class="q-s">' + esc(a.on_gate) + '</div>' +
      '<div class="autoc">' +
        '<button class="btn xs" data-act="autoToggle" data-auto="' + esc(a.key) + '">' + (autoSt(a) === 'paused' ? 'Resume' : autoSt(a) === 'retired' ? 'Reinstate' : 'Pause') + '</button>' +
      (autoSt(a) === 'retired' ? '' : '<button class="btn xs" data-act="autoSched" data-auto="' + esc(a.key) + '">Change schedule</button>') +
        (window.AUTO_MANUAL && window.AUTO_MANUAL[a.key] ? '<button class="btn xs" data-act="autoRun" data-auto="' + esc(a.key) + '">Run now</button>' : '') +
        '<button class="btn xs" data-act="autoHist" data-auto="' + esc(a.key) + '">History' + (autoRuns(a.key).runs && autoRuns(a.key).runs.length ? ' (' + autoRuns(a.key).runs.length + ')' : '') + '</button>' +
        (autoSt(a) === 'retired' ? '<span class="badge warn">retired · history kept</span>' :
          '<button class="btn xs danger" data-act="autoRetire" data-auto="' + esc(a.key) + '">' + (S.autoArmed === a.key ? 'Confirm retire' : 'Retire') + '</button>' + schedEditor(a)) +
      '</div>' +
      '<div class="q-s" style="margin-top:7px;color:var(--fg3)">' + esc(autoHistLine(a.key)) + '</div>' +
      '<hr class="p-hr"><div class="wb-meta" style="margin:0"><span>last run <b>' + esc(a.last) + '</b></span></div>' +
      '</div></section>';
  }).join('');
}

/* ---------------- connected apps: the access layer ---------------- */

function marketHTML() {
  const M = window.CONNECTOR_MARKET || { categories: [], apps: [] };
  const held = (window.CONNECTORS || []).map(c => c.key);
  const LABEL = { self: '+ Request', admin: '+ Admin only', service: '+ Needs a service identity', lane: '+ Vendor ToS gate' };
  const CATS = M.categories.map(cat => {
    const apps = M.apps.filter(a => a.cat === cat.key);
    if (!apps.length) return '';
    return '<div class="p-sec">' + esc(cat.name) + '</div><div style="display:flex;flex-wrap:wrap;gap:10px;margin:0 0 15px">' +
      apps.map(a => {
        const rule = a.rule || 'self';
        const has = held.some(k => k.indexOf(a.id) === 0);
        const btn = has ? '<span class="w-auto" style="border-color:var(--accent);color:var(--accent)">connected</span>'
          : '<button class="btn xs" data-act="connInstall" data-app="' + esc(a.id) + '"' + (rule === 'self' ? ' style="border-color:var(--accent);color:var(--accent)"' : '') + '>' + esc(LABEL[rule]) + '</button>';
        return '<div data-app="' + esc(a.id) + '" data-rule="' + esc(rule) + '" style="flex:1 1 310px;max-width:430px;border:1px solid var(--border);border-radius:9px;padding:10px 11px">' +
          '<div style="display:flex;gap:8px;align-items:baseline"><b>' + esc(a.name) + '</b><span class="q-s" style="color:var(--fg3);margin-left:auto">' + esc(a.auth) + '</span></div>' +
          '<div class="q-s" style="color:var(--fg3);margin:4px 0 8px">' + esc(a.line) + '</div>' +
          '<div style="display:flex;gap:8px;align-items:center"><span class="q-s" style="color:var(--fg3)">' + (a.scopes || []).length + ' scopes \u00b7 ' + esc((a.classes || []).join(', ')) + '</span>' + btn + '</div>' +
          (rule === 'self' ? '' : '<div class="q-s" style="color:var(--fg3);margin-top:7px">' + esc(a.why || '') + '</div>') +
        '</div>';
      }).join('') + '</div>';
  }).join('');
  return '<section class="w" data-market="1" data-size="wide"><div class="w-hd"><h3>Connector market</h3>' +
    '<span class="w-auto lvl-suggest">' + M.apps.length + ' enterprise connectors</span></div><div class="w-body">' +
    '<div class="q-s" style="margin-bottom:11px;color:var(--fg3)">Requesting one does not connect it. It creates a <b>grant</b> with a named owner, the scopes it asked for, the data classes it touches and a review date \u2014 ' +
    'and the credential goes into the vault, never into the agent. Some of these are not yours to install at all, and the catalogue says so instead of hiding them.</div>' +
    CATS + '</div></section>';
}
function connReqHTML() {
  const a = (((window.CONNECTOR_MARKET || {}).apps) || []).filter(x => x.id === S.connInstall)[0];
  if (!a || S.appsTab !== 'market') return '';
  const rule = a.rule || 'self';
  const verdict = rule === 'self'
    ? 'You may request this. It lands in the register as <b>pending</b> \u2014 no run can touch it until ' + esc(a.approver) + ' signs it.'
    : 'You cannot install this yourself. ' + esc(a.why || '');
  return '<section class="w" data-connreq="1" data-size="wide"><div class="w-hd"><h3>Install ' + esc(a.name) + '</h3>' +
    '<span class="w-auto lvl-' + (rule === 'self' ? 'suggest' : 'auto') + '">' + (rule === 'self' ? 'you may request this' : 'not yours to install') + '</span></div><div class="w-body">' +
    '<div class="q-s" style="margin-bottom:9px">' + verdict + '</div>' +
    '<div class="p-sec">What the grant would carry</div><div class="q-s" style="margin-bottom:9px">scopes <span class="mono">' + esc((a.scopes || []).join(' ')) + '</span> \u00b7 data classes <span class="mono">' + esc((a.classes || []).join(', ')) + '</span> \u00b7 auth <span class="mono">' + esc(a.auth) + '</span> \u00b7 owner ' + esc(a.approver) + ' \u00b7 first review 12 months after approval</div>' +
    '<div class="p-sec">Where the credential goes</div><div class="q-s" style="margin-bottom:9px">Into the credential vault, bound to this origin and this grant. The agent can <b>call</b> it and can never <b>read</b> it \u2014 not in a prompt, not in a log, not in this screen.</div>' +
    '<div style="display:flex;gap:7px;align-items:center"><' + (rule === 'self' ? 'button class="btn xs" data-act="connRequest" data-app="' + esc(a.id) + '">Request this connector</button>' : 'span class="q-s" style="color:var(--fg3)">ask ' + esc(a.approver)) + '</' + (rule === 'self' ? 'button' : 'span') + '>' +
    '<button class="btn xs" data-act="connCancel">Cancel</button></div></div></section>';
}
function requestConnector(id) {
  const a = (((window.CONNECTOR_MARKET || {}).apps) || []).filter(x => x.id === id)[0];
  if (!a) return;
  const key = id + '.corp.internal';
  if ((window.CONNECTORS || []).some(c => c.key === key)) { toast('That connector is already in the register.', 'warn'); return; }
  window.CONNECTORS.push({ key: key, name: a.name, what: a.line, auth: a.auth,
    auth_detail: 'no secret stored yet \u2014 the grant is pending; on approval the secret is written to the vault and never read by the agent',
    owner: a.approver, scopes: a.scopes, data_classes: a.classes, status: 'requested',
    review: 'first review 12 months after approval',
    note: 'Requested by ' + user() + ' from the connector market. Nothing may use this grant until it is approved \u2014 not a chat turn, not an automation.' });
  window.CONNECTOR_ACCESS[key] = { model: 'service identity', last_used: 'never', unattended: 'not yet',
    why_unattended: 'Pending: whether this may run unattended is the approver\u2019s decision, not the requester\u2019s.',
    attribution: 'Will be tagged with the skill and the run id, like every other grant.' };
  chainPush('connector.requested', 'user:' + user(), key + ' \u00b7 ' + (a.scopes || []).join(' ') + ' \u00b7 awaiting ' + a.approver, 'info');
  S.connInstall = null;
  toast('<b>Requested.</b> <span class="mono">' + esc(key) + '</span> is <b>pending</b> in the register. No run can touch it until <b>' + esc(a.approver) + '</b> signs it \u2014 and a new session does not change that.', 'ok');
  renderCanvas();
}
function renderApps() {
  const C = window.CONNECTORS || [];
  const lane = C.filter(c => c.status === 'lane only').length;
  const due = C.filter(c => c.status === 'review due').length;
  const A = window.CONNECTOR_ACCESS || {};
  const modelOf = c => (A[c.key] || {}).model || 'unknown';
  const svc = C.filter(c => modelOf(c) === 'service identity').length;
  const usr = C.filter(c => modelOf(c) === 'user session').length;
  const brw = C.filter(c => modelOf(c) === 'browser lane').length;
  const tos = C.filter(c => c.status === 'tos review').length;
  $('#wbHead').innerHTML =
    '<div class="wb-title"><span class="wb-greet">Connected apps</span><span class="wb-badge">' + esc(S.wb.short) + '</span></div>' +
    '<div class="wb-meta"><span>What the agents may reach, with which scopes, under whose name, and until when.</span></div>' +
    '<div class="wb-meta"><span>' + C.length + ' grants \u00b7 <b>' + svc + ' service identities</b> \u00b7 ' + usr + ' reached as the employee (SSO) \u00b7 ' + brw + ' through the <b>browser lane</b> \u00b7 ' + due + ' review due' + (tos ? ' \u00b7 ' + tos + ' blocked on a vendor terms-of-service answer' : '') + '</span></div>' +
    '<div class="wb-meta"><span>Only a <b>service identity</b> can work unattended. Anything reached as the employee cannot run at 03:00 \u2014 those runs queue for a human instead. ' +
    'Secrets live in the vault and are <b>never readable by the agent</b>.</span></div>' +
    '<div class="wb-meta" style="display:flex;gap:8px;align-items:center">' +
      '<button class="btn xs' + (S.appsTab === 'market' ? ' pri' : '') + '" data-act="appsTab" data-tab="market">Marketplace \u00b7 ' + (((window.CONNECTOR_MARKET || {}).apps || []).length) + '</button>' +
      '<button class="btn xs' + (S.appsTab === 'market' ? '' : ' pri') + '" data-act="appsTab" data-tab="installed">Installed \u00b7 ' + C.length + '</button>' +
      '<span class="q-s" style="color:var(--fg3)">a catalogue is how you <b>ask</b>; this register is how it is <b>governed</b></span>' +
    '</div>';
  $('#widgetGrid').innerHTML = connReqHTML() + (S.appsTab === 'market' ? marketHTML() : C.map(c => {
    const scopes = c.scopes.map(s => '<span class="badge info">' + esc(s) + '</span>').join(' ');
    const dc = c.data_classes.map(d => '<span class="badge warn">' + esc(d) + '</span>').join(' ');
    const st = c.status === 'granted' ? 'ok' : (c.status === 'review due' || c.status === 'tos review') ? 'warn' : 'info';
    const a = A[c.key] || {};
    const mcls = a.model === 'service identity' ? 'ok' : a.model === 'browser lane' ? 'warn' : 'info';
    const canRun = a.unattended === 'yes';
    return '<section class="w" data-size="wide"><div class="w-hd"><h3>' + esc(c.name) +
      ' <span class="mono dim">' + esc(c.key) + '</span></h3>' +
      '<span class="badge ' + st + '">' + esc(c.status) + '</span>' +
      '<span class="badge ' + mcls + '">' + esc(a.model || c.auth) + '</span>' +
      '<span class="w-auto">' + (canRun ? 'unattended: yes' : 'unattended: no') + '</span></div><div class="w-body">' +
      '<div class="wb-meta" style="margin:0 0 10px"><span>reads <b>' + esc(c.what) + '</b></span>' +
      '<span>owner <b>' + esc(c.owner) + '</b></span><span>last used <b>' + esc(a.last_used || '\u2014') + '</b></span></div>' +
      '<div class="p-sec">Scopes</div><div style="margin-bottom:9px">' + scopes + '</div>' +
      '<div class="p-sec">Data classes</div><div style="margin-bottom:9px">' + dc + '</div>' +
      '<div class="wb-meta" style="margin:0 0 10px"><span>granted <b>' + esc(c.granted) + '</b></span>' +
      '<span>last review <b>' + esc(c.last_review) + '</b></span><span>next review <b>' + esc(c.next_review) + '</b></span></div>' +
      '<div class="p-sec">How it authenticates</div><div class="q-s" style="margin-bottom:9px">' + esc(c.auth_detail) + '</div>' +
      '<div class="p-sec">Can it work unattended?</div><div class="q-s" style="margin-bottom:9px">' + esc(a.why_unattended || '') + '</div>' +
      '<div class="p-sec">How actions are attributed</div><div class="q-s" style="margin-bottom:9px">' + esc(a.attribution || '') + '</div>' +
      (a.recommend ? '<div class="p-sec">Where this model falls short</div><div class="q-s" style="margin-bottom:9px">' + esc(a.recommend) + '</div>' : '') +
      '<div class="q-s">' + esc(c.note) + '</div>' +
      '</div></section>';
  }).join(''));
}

/* ---------------- Auditor console (read-only shell mode) ---------------- */
function renderAudit() {
  const q = (S.auditQ || '').toLowerCase(), cls = S.auditCls || 'all', sev = S.auditSev || 'all';
  const tab = S.auditTab || 'events';
  $('#wbHead').innerHTML =
    '<div class="audbar"><b>Auditor mode</b> \u00b7 read-only \u00b7 query and export only \u00b7 your query is itself an audited event \u00b7 admin actions are unavailable in this shell</div>' +
    '<div class="wb-title"><span class="wb-greet">Activity &amp; audit</span><span class="wb-badge">' + esc(S.wb.short) + '</span></div>';
  const rows = S.chain.filter(e =>
    (cls === 'all' || e.cls.indexOf(cls) === 0) &&
    (sev === 'all' || e.sev === sev) &&
    (!q || (e.cls + ' ' + e.actor + ' ' + e.meta).toLowerCase().indexOf(q) >= 0)
  );
  const v = chainVerify();
  const chain = '<span class="' + (v.ok ? 'chainok' : 'chainbad') + '">' + (v.ok ? '\u2713 chain intact' : '\u2717 broken at #' + (v.bad + 1)) + ' \u00b7 ' + v.n + ' events \u00b7 each hash chains the previous</span>';
  const filter = '<div class="filterbar">' +
    '<input id="audQ" placeholder="filter events\u2026" value="' + esc(S.auditQ || '') + '">' +
    '<select id="audCls">' + ['all','auth','workbench','run','approval','policy','skill','browser','runbook','audit'].map(c =>
      '<option value="' + c + '"' + (c === cls ? ' selected' : '') + '>' + (c === 'all' ? 'all classes' : c + '.*') + '</option>').join('') + '</select>' +
    '<select id="audSev">' + ['all','info','warn','crit'].map(s =>
      '<option value="' + s + '"' + (s === sev ? ' selected' : '') + '>' + (s === 'all' ? 'any severity' : s) + '</option>').join('') + '</select>' +
    '<button class="btn sm" id="audVerify">Verify chain</button>' +
    '<button class="btn sm" id="audExport">Export JSON</button>' +
    '<span class="dim" style="margin-left:auto">' + rows.length + ' of ' + S.chain.length + ' events</span></div>';
  const tabs = '<div class="filterbar"><button class="btn sm ' + (tab === 'events' ? 'pri' : '') + '" data-audtab="events">Events</button>' +
    '<button class="btn sm ' + (tab === 'apps' ? 'pri' : '') + '" data-audtab="apps">App allow-list &amp; ToS gate</button>' +
    '<span class="dim" style="margin-left:auto">' + chain + '</span></div>';
  const body = tab === 'apps' ? appTable() :
    '<table class="aud"><thead><tr><th>#</th><th>time</th><th>actor</th><th>event</th><th>detail</th><th>hash</th></tr></thead><tbody>' +
    rows.map(e => '<tr><td class="mono dim">' + e.seq + '</td><td class="mono">' + esc(e.ts) + '</td><td>' + esc(e.actor) +
      '</td><td class="mono">' + esc(e.cls) + '</td><td>' + esc(e.meta) + '</td>' +
      '<td><span class="hash">' + esc(e.prev) + ' \u2192 ' + esc(e.hash) + '</span> ' +
      '<span class="sev ' + (e.sev === 'crit' ? 'crit' : e.sev === 'warn' ? 'warn' : 'info') + '">' + esc(e.sev) + '</span></td></tr>').join('') +
    '</tbody></table>';
  $('#widgetGrid').innerHTML = '<section class="w" data-size="wide"><div class="w-body">' + tabs + filter + body + '</div></section>';
  wireAudit();
}
function appTable() {
  return '<table class="aud"><thead><tr><th>application</th><th>domain</th><th>env</th><th>terms-of-service position</th><th>approved by</th><th>status</th></tr></thead><tbody>' +
    window.APP_ALLOWLIST.map(a => '<tr><td>' + esc(a.app) + '</td><td class="mono">' + esc(a.domain) + '</td><td class="mono">' + esc(a.env) +
      '</td><td>' + esc(a.tos) + '</td><td>' + esc(a.approved_by) + '</td>' +
      '<td><span class="badge ' + (a.status === 'approved' ? 'ok' : a.status === 'blocked' ? 'bad' : 'warn') + '">' + esc(a.status) + '</span></td></tr>').join('') +
    '</tbody></table>' +
    '<div class="policy" style="margin-top:12px">An app cannot be allow-listed for automation until its terms-of-service review is recorded. The bank portal is blocked: the bank requires named-user access. LinkedIn is pending a decision.</div>';
}
function wireAudit() {
  const qi = $('#audQ');
  if (qi) { qi.addEventListener('input', () => { S.auditQ = qi.value; renderAudit(); const n = $('#audQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }
  const c = $('#audCls'); if (c) c.addEventListener('change', () => { S.auditCls = c.value; renderAudit(); });
  const s = $('#audSev'); if (s) s.addEventListener('change', () => { S.auditSev = s.value; renderAudit(); });
  const v = $('#audVerify');
  if (v) v.addEventListener('click', () => {
    chainPush('audit.query.executed', 'user:' + user(), 'chain verification requested \u00b7 ' + S.chain.length + ' events \u00b7 read-only', 'info');
    const r = chainVerify();
    toast(r.ok ? 'Chain intact across <b>' + r.n + ' events</b> — every hash matches its predecessor-hash.' : 'Chain BROKEN at event #' + (r.bad + 1), r.ok ? 'ok' : 'bad');
  });
  const x = $('#audExport');
  if (x) x.addEventListener('click', () => {
    chainPush('audit.export.created', 'user:' + user(), 'export requested \u00b7 format=json \u00b7 contains no credential material', 'warn');
    const blob = new Blob([JSON.stringify(S.chain, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'audit-events.json'; a.click();
    toast('Exported ' + S.chain.length + ' events. The export itself is now an audited event.', 'ok');
  });
  $$('[data-audtab]').forEach(b => b.addEventListener('click', () => { S.auditTab = b.getAttribute('data-audtab'); renderAudit(); }));
}

/* ---------------- scoped assistant: grounded, or it refuses ---------------- */
function sendAsk(widgetKey, text) {
  text = (text || '').trim();
  if (!text) return;
  const w = widgetOf(widgetKey);
  if (!w) return;
  const log = S.logs[widgetKey] || (S.logs[widgetKey] = []);
  log.push({ who: 'me', text: text });
  const toks = t => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(x => x.length > 3);
  const qt = toks(text);
  const score = (cand) => { const ct = toks(cand); return qt.filter(x => ct.indexOf(x) >= 0).length; };

  // A short question is not a weak one: "what can you not do?" has a single long
  // token, and demanding two overlaps would answer it with a refusal. Match on the
  // share of the shorter side's words that line up, not on a raw count.
  const fit = (cand) => { const ct = toks(cand); const s = score(cand);
    return { s: s, ratio: ct.length ? s / Math.min(qt.length || 1, ct.length) : 0 }; };

  // 1 · a question the workbench can answer from a source
  let best = null, bestScore = 0, bestRatio = 0;
  (w.answers || []).forEach(a => { const f = fit(a.q);
    if (f.s > bestScore || (f.s >= bestScore && f.ratio > bestRatio)) { bestScore = f.s; bestRatio = f.ratio; best = a; } });
  // 2 · a request to DO something: same matcher, different consequence
  let task = null, taskScore = 0;
  (w.tasks || []).forEach(t => {
    const keys = (t.keys || []).filter(k => text.toLowerCase().indexOf(k) >= 0).length * 3;
    const s = Math.max(score(t.q), keys);
    if (s > taskScore) { taskScore = s; task = t; }
  });

  if (task && taskScore >= 3 && taskScore >= bestScore) {
    chainPush('chat.intent', 'agent:' + (w.auto ? w.auto.skill : 'assistant'),
      'widget=' + widgetKey + ' intent=act task=' + task.id, 'info');
    doTask(widgetKey, w, task);
    return;
  }

  if (best && (bestScore >= 2 || (bestScore >= 1 && bestRatio >= 0.5))) {
    log.push({ who: 'ag', text: best.a, cite: best.cite });
    chainPush('chat.answered', 'agent:' + (w.auto ? w.auto.skill : 'assistant'),
      'widget=' + widgetKey + ' matched=yes · cite=' + best.cite, 'info');
  } else {
    // Refuse rather than improvise — and if it SOUNDS like work, offer the teach path.
    const workish = /\b(export|send|create|match|rotate|update|reclaim|close|schedule|draft|wipe|revoke|delete|book|order|reindex|sync|fix|clean|archive|merge|import|migrate|provision|grant|onboard|offboard|refresh|rebuild|recalc)\b/.test(text.toLowerCase());
    log.push({ who: 'ag',
      text: workish
        ? 'No skill is behind that yet, so I will not improvise it — an unreviewed script with my grant is exactly what this workbench exists to prevent. I can draft one from what you just asked and take it through review: a manifest derived from the steps, a named control owner, and a ceiling that cannot exceed this workbench.'
        : 'I do not have a source for that, and I will not answer from intuition. What I checked: this workbench record set, the policy library, and my grant. Nothing authoritative matched. Try one of the chips, or ask your human partner.',
      cite: workish ? 'no skill matched \u00b7 teach path offered' : 'grounding rule: refuse rather than guess' });
    chainPush('chat.refused', 'agent:' + (w.auto ? w.auto.skill : 'assistant'),
      'widget=' + widgetKey + ' \u00b7 no match \u00b7 refused rather than improvised' + (workish ? ' \u00b7 authoring offered' : ''), 'warn');
  }
  renderCanvas();
  const lg = $('.chatlog');
  if (lg) lg.scrollTop = lg.scrollHeight;
}

function doTask(widgetKey, w, task) {
  const log = S.logs[widgetKey] || (S.logs[widgetKey] = []);
  const sk = (task.run && task.run.skill) || (w.auto && w.auto.skill) || 'workbench/skill@0';

  // (a) read-only: the workbench answers without touching anything
  if (!task.run && !task.completes) {
    log.push({ who: 'ag', text: task.does, cite: task.cite });
    chainPush('chat.answered', 'agent:' + sk, 'widget=' + widgetKey + ' intent=read \u00b7 no state changed', 'info');
    renderCanvas(); return;
  }
  // (b) completes inside the grant: an autonomous completion, still written to the chain
  if (task.completes) {
    log.push({ who: 'ag', text: task.does, cite: task.cite || 'completed inside the grant \u00b7 logged' });
    chainPush('run.completed', 'agent:' + sk,
      'chat-initiated \u00b7 widget=' + widgetKey + ' \u00b7 inside grant, no gate crossed', 'info');
    toast('<b>' + esc(task.q) + '</b> \u2014 completed inside the grant, logged.', 'ok');
    renderCanvas(); return;
  }
  // (c) work that crosses a gate: it becomes the SAME gate card, from chat
  if (S.active) {
    log.push({ who: 'ag',
      text: 'One automation run at a time in this workbench. ' + (S.active.item ? ('Run ' + S.active.item.id) : 'A run') +
        ' is in flight \u2014 finish or stop it and I will take this next.',
      cite: 'rule: one run per workbench' });
    renderCanvas(); return;
  }
  log.push({ who: 'ag', text: task.does, cite: 'chat-initiated run \u00b7 ' + sk });
    // A chat request is a new run of a repeatable skill, not a re-open of a resolved
  // queue row: give it its own run id so asking twice is allowed and legible.
  const it = { id: (task.id || 'CHAT') + '-' + (S.runSeq = (S.runSeq || 1) + 1), title: task.q, sub: task.sub || 'chat-initiated', run: task.run };
  renderCanvas();
  startRun(it);
}

/* ---------------- global search ---------------- */
function filterRows(q) {
  q = (q || '').toLowerCase();
  $$('#widgetGrid .qrow').forEach(r => {
    const hit = !q || r.innerText.toLowerCase().indexOf(q) >= 0;
    r.style.display = hit ? '' : 'none';
  });
}

/* ---------------- guided tour ---------------- */
const TOUR = [
  { h: 'A workbench is data, not code', p: 'This cockpit has no role-specific frontend. Six roles, one generic engine \u2014 switch workbench in the top bar and the whole room changes: queues, badges, policies, accent. Definitions live in <span class="mono">workbenches.js</span>. Add a seventh record and it is served.',
    a: () => {} },
  { h: 'Every row was already worked by the automation', p: 'On the AP workbench, INV-40218 has been matched three ways, tolerance-checked, and narrated \u2014 with the evidence the agent used. The human got the exception, not the homework.',
    a: () => { switchWorkbench('ap_clerk'); const it = findItem('INV-40218'); if (it) openItem('INV-40218'); } },
  { h: 'It stops at the human boundary', p: 'Press <b>Review &amp; run</b> and watch: the automation works, then pauses for a release it is not allowed to give itself. The card names the object, the blast radius and the policy that requires you.',
    a: () => { const it = findItem('INV-40218'); if (it) startRun(it.it); } },
  { h: 'Every action is answerable', p: 'Open <b>Activity &amp; audit</b>: hash-chained events, a real chain verification, and an auditor shell that cannot take admin actions. Its own queries are audited too.',
    a: () => { S.view = 'activity'; S.item = null; renderAll(); } }
];
function startTour() {
  S.tour = 0;
  renderTour();
}
function renderTour() {
  const t = TOUR[S.tour];
  if (!t) { endTour(); return; }
  const el = $('#tour');
  el.hidden = false;
  el.style.display = '';
  el.innerHTML = '<div class="tour-card"><div class="tour-k">Guided demo \u00b7 ' + (S.tour + 1) + ' of ' + TOUR.length + '</div>' +
    '<div class="tour-h">' + t.h + '</div><p class="tour-p">' + t.p + '</p>' +
    '<div class="tour-dots">' + TOUR.map((_, i) => '<i class="' + (i <= S.tour ? 'on' : '') + '"></i>').join('') + '</div>' +
    '<div class="tour-a"><button class="btn gho" data-tour="skip">Skip the tour</button>' +
    '<button class="btn pri" data-tour="next">' + (S.tour === TOUR.length - 1 ? 'Start exploring' : 'Next') + '</button></div></div>';
  $$('#tour [data-tour]').forEach(b => b.addEventListener('click', () => {
    const act = b.getAttribute('data-tour');
    if (act === 'skip') { endTour(); return; }
    try { t.a(); } catch (e) {}
    S.tour++;
    renderTour();
  }));
}
function endTour() {
  S.tourSeen = true; save();
  const t = $('#tour');
  t.hidden = true;          // CSS also enforces [hidden] now, belt and braces
  t.style.display = 'none';
  t.innerHTML = '';
}


/* ---------------- browser lane: the real bsk bridge ----------------
   When the demo is served by lane.py, /api/lane/* is backed by the actual
   `bsk` daemon: real session, real accessibility observation with @eN refs,
   real request-help handoff. When it is opened from file:// there is no
   bridge, and every lane affordance degrades to "offline" instead of failing. */
async function laneProbe() {
  try {
    const r = await fetch('/api/lane/status', { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    S.lane = Object.assign({ live: true }, j.daemon);
  } catch (e) {
    S.lane = { live: false, error: String(e && e.message || e) };
  }
  renderRail(); renderCanvas();
}
async function laneCall(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
function laneChip() {
  if (!S.lane) return '<span class="w-auto">probing lane…</span>';
  if (!S.lane.live) return '<span class="w-auto" style="border-color:var(--fg3)">lane offline</span>';
  const b = (S.lane.browsers || [])[0] || {};
  return '<span class="w-auto lvl-auto">LIVE · bsk ' + esc(S.lane.bsk_version) + ' · ' + esc(b.name || '') + ' ' + esc(b.version || '') + '</span>';
}
function showLane(title, why, kv, evidence) {
  S.item = { id: 'lane', title: title, why: why, detail: { kv: kv, evidence: evidence, actions: [] } };
  S.selRow = null;
  renderPanel();
}
/* The live sequence: real session → allow-listed tab → real observation → screenshot. */
async function laneSequence() {
  const steps = [];
  showLane('Live lane — contacting the real bsk daemon', 'Every line below is real output from the `bsk` CLI on this machine.',
    [['Bridge', '/api/lane (localhost only)'], ['Allow-list', 'example.com · 127.0.0.1 · localhost']], 'working…');
  const st = await (async () => { try { return await (await fetch('/api/lane/status')).json(); } catch (e) { return { error: String(e) }; } })();
  steps.push(st.daemon
    ? '1 · daemon        bsk ' + st.daemon.bsk_version + ' · protocol ' + st.daemon.protocol + ' · ' + st.daemon.browsers.length + ' browser connected · sessions=' + st.daemon.sessions
    : '1 · daemon        unreachable: ' + JSON.stringify(st).slice(0, 120));
  const s1 = await laneCall('/api/lane/session/start');
  steps.push('2 · session       ' + (s1.session_id ? 'id=' + s1.session_id + ' · Agent Window opened with --no-focus' : JSON.stringify(s1).slice(0, 160)));
  const s2 = await laneCall('/api/lane/open', { url: 'https://example.com' });
  steps.push('3 · tab           ' + (s2.ok ? 'created in the Agent Window (host allow-listed)' : JSON.stringify(s2).slice(0, 160)));
  const s3 = await laneCall('/api/lane/observe');
  steps.push('4 · observation   ' + (s3.ok ? s3.observation.ref_count + ' ref(s) in ' + s3.observation.attempts +
    ' attempt(s) — ' + s3.observation.excerpt.split('\n').filter(Boolean).slice(2, 5).join(' / ') : JSON.stringify(s3).slice(0, 160)));
  const s4 = await laneCall('/api/lane/screenshot');
  steps.push('5 · screenshot    ' + (s4.ok ? s4.path + ' (open shots/lane-live.png)' : JSON.stringify(s4).slice(0, 160)));
  showLane('Live lane — real session, real observation',
    'These are actual results from the bsk daemon, not fixtures. The re-observe rule from §9.5 is implemented: navigation invalidates refs, so the bridge retries rather than failing.',
    [['Session', (s1.session_id || '—')], ['Browser', (S.lane && S.lane.browsers && S.lane.browsers[0] && (S.lane.browsers[0].name + ' ' + S.lane.browsers[0].version)) || '—'],
     ['Allow-list', 'example.com · 127.0.0.1 · localhost'], ['Borrowed user tabs', 'never — the bridge only creates tabs in the Agent Window']],
    steps.join('\n'));
  await laneProbe();
}
/* The real request-help round trip: an overlay waits for you in your browser. */
async function laneHelp() {
  const r = await laneCall('/api/lane/help', { prompt: 'Cockpit demo: complete the step in the page, then press Continue.', title: 'Human handoff — cockpit demo', timeout_s: 120 });
  if (!r.pending) { showLane('Handoff could not start', '', [['Result', JSON.stringify(r).slice(0, 200)]], ''); return; }
  showLane('Waiting on you — in your browser',
    'The overlay is live in the Agent Window. This is the real bsk request-help path: the automation stops, a human acts, and the run resumes with the outcome.',
    [['Session', r.session_id], ['Timeout', '120s'], ['What the agent sees', 'nothing until you act']],
    'request-help dispatched… polling /api/lane/help');
  const t0 = Date.now();
  const poll = async () => {
    const h = await (await fetch('/api/lane/help')).json();
    if (h.pending) {
      const el = document.getElementById('panelBody');
      if (el) el.querySelector('.evidence').textContent = 'request-help dispatched… waiting for a human (' + Math.round((Date.now() - t0) / 1000) + 's)';
      setTimeout(poll, 1500);
      return;
    }
    const res = h.result || {};
    showLane('Handoff complete — the run resumed',
      'The human completed the in-page step and the automation continued. Nothing was assumed: the outcome came back from the browser.',
      [['Outcome', res.status], ['Exit code', String(res.rc)], ['Elapsed', res.elapsed_s + 's']],
      (res.raw || '') + '\n\n' + (res.err ? 'stderr: ' + res.err : ''));
    toast('Human handoff returned: <b>' + esc(res.status || 'done') + '</b> after ' + esc(String(res.elapsed_s || '?')) + 's — the automation resumed.', 'ok');
  };
  poll();
}

/* ---------------- init ---------------- */
function init() {
  $('#roleSwitch').addEventListener('click', e => {
    e.stopPropagation();
    const m = $('#roleMenu');
    m.hidden = !m.hidden;
    $('#roleSwitch').setAttribute('aria-expanded', String(!m.hidden));
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#roleMenu') && !e.target.closest('#roleSwitch')) {
      $('#roleMenu').hidden = true;
      $('#roleSwitch').setAttribute('aria-expanded', 'false');
    }
  });
  $('#panelClose').addEventListener('click', () => { S.item = null; renderPanel(); renderCanvas(); });
  $('#resetBtn').addEventListener('click', resetDemo);
  $('#attnPill').addEventListener('click', () => {
    const first = Object.keys(S.pending)[0];
    if (first) { S.active = S.pending[first]; S.item = S.active.item; renderAll(); return; }
    toast('Nothing is waiting on you. Run an automation from any queue to see a decision arrive here.', 'ok');
  });
  const gs = $('#globalSearch');
  gs.addEventListener('input', () => filterRows(gs.value));
  gs.addEventListener('keydown', e => { if (e.key === 'Escape') { gs.value = ''; filterRows(''); } });
  $('#tour').addEventListener('click', e => { if (e.target === $('#tour')) endTour(); });   // backdrop click
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#tour').hidden) { endTour(); return; }
    if (e.key === '/' && document.activeElement !== gs && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); gs.focus(); }
    if (e.key === 'Escape' && S.active && S.active.phase === 'gate') { S.item = S.active.item; renderAll(); }
  });
  boot();
  laneProbe();          // async: live bridge if the demo is served by lane.py
}
init();

})();
