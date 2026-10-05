'use strict';

// ── CONSTANTS ────────────────────────────────────────────────────
const DC  = {HSE:'#A32D2D',QUAL:'#185FA5',OA:'#7b3fa0',GC:'#3B6D11',ENV:'#177a6a',TOPO:'#BA7517',GEO:'#8b5a2b',SOC:'#B8860B',WX:'#1a4fa8'};
const STC = {nc_critique:{l:'NC critique',b:'b-r',c:'#A32D2D'},nc_majeure:{l:'NC majeure',b:'b-a',c:'#854F0B'},nc_mineure:{l:'NC mineure',b:'b-w',c:'#BA7517'},conforme:{l:'Conforme',b:'b-ok',c:'#3B6D11'},na:{l:'N/A',b:'b-n',c:'#6b7591'}};
const PRC = {critique:'b-r',majeure:'b-a',mineure:'b-w'};
const GRC = {grave:'b-r',modere:'b-a',mineur:'b-w'};
const GRL = {grave:'Grave',modere:'Modéré',mineur:'Mineur'};
const IST = {investigation:'b-r',en_cours:'b-i',cloture:'b-ok',ouvert:'b-w'};
const ISL = {investigation:'Investigation',en_cours:'En cours',cloture:'Clôturé',ouvert:'Ouvert'};
const AST = {ouverte:'b-w',en_cours:'b-i',en_attente:'b-n',cloturee:'b-ok'};
const ASL = {ouverte:'Ouverte',en_cours:'En cours',en_attente:'En attente',cloturee:'Clôturée'};
const RLBL = {admin:'Administrateur',direction:'Direction',resp_qsse:'Resp. QSSE',chef_chantier:'Chef chantier',resp_domaine:'Resp. domaine',metier:'Métier'};
const RBDG = {admin:'b-r',direction:'b-p',resp_qsse:'b-i',chef_chantier:'b-a',resp_domaine:'b-n',metier:'b-n'};
const NDOT = {danger:'#A32D2D',warning:'#BA7517',info:'#185FA5'};
const NBG  = {danger:'var(--crl)',warning:'var(--cal)',info:'var(--c1l)'};

// ── STATE ────────────────────────────────────────────────────────
let IND = [], ACTIONS = [], INCIDENTS = [], USERS = [], NOTIFS = [], TFTG = [], RPT_HIST = [];
let RV_SCORES = {perf:78,risque:66,crit:41,cloture:52,arb:55,stock_prio:60,revue7j:70};
const RV_POIDS = {perf:.25,risque:.20,crit:.15,cloture:.15,arb:.10,stock_prio:.10,revue7j:.05};
const RV_LBLS  = {perf:'Performance',risque:'Risque (inv.)',crit:'Criticité',cloture:'Taux clôture',arb:'Arbitrage imm.',stock_prio:'Stock prioritaire',revue7j:'Revue ≤7j'};
// Seuils de décision 8D (méthodologie QSSE-Wx)
const SEUIL_VERT   = 85;   // MAINTIEN / GO
const SEUIL_ORANGE = 70;   // PILOTAGE RENFORCÉ / GO
const SEUIL_ALERTE = 55;   // ALERTE
// ARBITRAGE DIRECTION si score < SEUIL_ALERTE
// Garde-fous : seuil score individuel déclenchant le rouge automatique
const GF_SEUIL = 30;

// ── API HELPER ───────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {method, credentials:'same-origin', headers:{'Content-Type':'application/json'}};
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch('/api' + path, opts);
    if (res.status === 401) { window.location = '/login'; return null; }
    return await res.json();
  } catch(e) {
    toast('Erreur réseau : ' + e.message, 'danger');
    return null;
  }
}

// ── RECHERCHE GLOBALE ─────────────────────────────────────────────
let _searchT;
function globalSearch(q) {
  clearTimeout(_searchT);
  const box = document.getElementById('GRESULTS');
  if (!q || q.length < 2) { box.style.display = 'none'; return; }
  _searchT = setTimeout(async () => {
    const ql = q.toLowerCase();
    const results = [];
    IND.forEach(i => {
      if (i.id.toLowerCase().includes(ql) || i.libelle.toLowerCase().includes(ql) || i.zone.toLowerCase().includes(ql))
        results.push({type:'Indicateur', icon:'ti-chart-bar', label:`${i.id} — ${i.libelle}`, sub:i.zone, action:`openFiche('${i.id}')`});
    });
    ACTIONS.forEach(a => {
      if (a.id.toLowerCase().includes(ql) || a.libelle.toLowerCase().includes(ql) || a.responsable.toLowerCase().includes(ql))
        results.push({type:'Action', icon:'ti-checkbox', label:`${a.id} — ${a.libelle}`, sub:a.responsable, action:`openFicheAction('${a.id}')`});
    });
    INCIDENTS.forEach(i => {
      if (i.id.toLowerCase().includes(ql) || i.description.toLowerCase().includes(ql) || i.zone.toLowerCase().includes(ql))
        results.push({type:'Incident', icon:'ti-alert-triangle', label:`${i.id} — ${i.description.slice(0,40)}`, sub:i.zone, action:`openFicheIncident('${i.id}')`});
    });
    if (!results.length) {
      box.innerHTML = `<div style="padding:14px;text-align:center;font-size:12px;color:var(--color-text-tertiary)">Aucun résultat pour "${q}"</div>`;
    } else {
      box.innerHTML = results.slice(0,8).map(r =>
        `<div style="padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--color-border-tertiary);display:flex;align-items:center;gap:9px" onclick="${r.action};document.getElementById('GSEARCH').value='';document.getElementById('GRESULTS').style.display='none'" onmouseover="this.style.background='var(--color-background-secondary)'" onmouseout="this.style.background=''">
          <i class="ti ${r.icon}" style="font-size:15px;color:var(--brand);flex-shrink:0"></i>
          <div><div style="font-size:12px;font-weight:500">${r.label}</div><div style="font-size:10px;color:var(--color-text-tertiary)">${r.type} · ${r.sub}</div></div>
        </div>`
      ).join('');
    }
    box.style.display = 'block';
  }, 200);
}

// ── PAGINATION ────────────────────────────────────────────────────
const PAGE_SIZE = 20;
const _pages = {};
function _paginate(rows, key) {
  if (!_pages[key]) _pages[key] = 1;
  _pages[key] = Math.min(_pages[key], Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  const p = _pages[key], total = Math.ceil(rows.length / PAGE_SIZE);
  const slice = rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  return { slice, p, total };
}
function _renderPager(containerId, key, total, current, onChangeFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (total <= 1) { el.innerHTML = ''; return; }
  let btns = '';
  btns += `<button class="btn btn-sm ${current===1?'btn-p':''}" onclick="${onChangeFn}(${1})" ${current===1?'disabled':''}>«</button>`;
  for (let i = Math.max(1, current-2); i <= Math.min(total, current+2); i++)
    btns += `<button class="btn btn-sm ${i===current?'btn-p':''}" onclick="${onChangeFn}(${i})">${i}</button>`;
  btns += `<button class="btn btn-sm ${current===total?'btn-p':''}" onclick="${onChangeFn}(${total})" ${current===total?'disabled':''}>»</button>`;
  el.innerHTML = `<div style="display:flex;gap:4px;align-items:center">${btns}<span style="font-size:11px;color:var(--color-text-tertiary);margin-left:6px">Page ${current}/${total}</span></div>`;
}
function goPageInd(p) { _pages['ind'] = p; renderInd(); }
function goPageAct(p) { _pages['act'] = p; renderAct(); }
function goPageInc(p) { _pages['inc'] = p; renderInc(); }

// ── UTILS ────────────────────────────────────────────────────────
function bdg(cls, txt) { return `<span class="b ${cls}">${txt}</span>`; }

function fmtD(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit',year:'numeric'});
  } catch { return d; }
}

function isRet(d) {
  return d && new Date(d) < new Date();
}

function pbCell(pct) {
  const c = pct < 40 ? '#A32D2D' : pct < 70 ? '#BA7517' : '#3B6D11';
  return `<div class="pb-wrap"><div class="pb"><div class="pb-fill" style="width:${pct}%;background:${c}"></div></div><div class="pb-lbl">${pct}%</div></div>`;
}

function weekNum() {
  const d = new Date(); const jan1 = new Date(d.getFullYear(),0,1);
  return Math.ceil(((d - jan1)/864e5 + jan1.getDay()+1)/7);
}

// ── NAVIGATION ───────────────────────────────────────────────────
let sbMini = false;

function _isMobile() { return window.innerWidth <= 600; }

function setMobNav(btn) {
  document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}
function _initMobNav() {
  const nav = document.getElementById('MOB-NAV');
  if (nav) nav.style.display = _isMobile() ? 'flex' : 'none';
}
window.addEventListener('resize', _initMobNav);

function _getOrCreateOverlay() {
  let ov = document.getElementById('SB-OVERLAY');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'sb-overlay';
    ov.id = 'SB-OVERLAY';
    ov.addEventListener('click', closeSb);
    document.body.appendChild(ov);
  }
  return ov;
}

function closeSb() {
  const sb = document.getElementById('SB');
  sb.classList.remove('sb-open');
  const ov = document.getElementById('SB-OVERLAY');
  if (ov) ov.classList.remove('open');
}

function toggleSb() {
  const sb = document.getElementById('SB');
  if (_isMobile()) {
    const opening = !sb.classList.contains('sb-open');
    sb.classList.toggle('sb-open', opening);
    _getOrCreateOverlay().classList.toggle('open', opening);
  } else {
    sbMini = !sbMini;
    sb.classList.toggle('mini', sbMini);
  }
}

function goTo(id, title) {
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('on'));
  const pg = document.getElementById('pg-' + id);
  if (pg) pg.classList.add('on');
  document.getElementById('PT').textContent = (typeof t === 'function' ? t('page.' + id) : null) || title || id;
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.dataset.page === id) n.classList.add('on');
  });
  document.getElementById('CONTENT').scrollTop = 0;
  if (_isMobile()) closeSb();
}

// ── MODALS ───────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
  if (id === 'M-INC') initImgWidget('INC-PHOTOS-WIDGET', 'inc');
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── CONFIRM MODAL ─────────────────────────────────────────────────
let _confirmResolve = null;
function confirmModal(msg, title = 'Supprimer ?', btnLabel = 'Supprimer') {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('CONFIRM-MSG').textContent = msg;
    document.getElementById('CONFIRM-TITLE').textContent = title;
    document.getElementById('CONFIRM-OK').innerHTML = `<i class="ti ti-trash"></i>${btnLabel}`;
    document.getElementById('CONFIRM-OK').onclick = () => { closeConfirm(); resolve(true); };
    document.getElementById('M-CONFIRM').classList.add('open');
  });
}
function closeConfirm() {
  document.getElementById('M-CONFIRM').classList.remove('open');
  if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
}

// ── SAVE INDICATOR ────────────────────────────────────────────────
let _saveT;
function showSaved(label = 'Enregistré') {
  const bar = document.getElementById('SAVE-BAR');
  document.getElementById('SAVE-TXT').textContent = label + ' · ' + new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
  bar.style.display = 'flex';
  clearTimeout(_saveT);
  _saveT = setTimeout(() => { bar.style.display = 'none'; }, 4000);
}

// ── TOAST ────────────────────────────────────────────────────────
let toastT;
function toast(msg, type) {
  const el = document.getElementById('TOAST');
  el.textContent = msg;
  el.style.background = type === 'danger' ? '#A32D2D' : '#1a1d23';
  el.style.display = 'block';
  clearTimeout(toastT);
  toastT = setTimeout(() => el.style.display = 'none', 3800);
}

// ── THEME ────────────────────────────────────────────────────────
function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
  localStorage.setItem('theme', dark ? 'light' : 'dark');
  _applyThemeIcon();
}
function _applyThemeIcon() {
  const ico = document.getElementById('THEME-ICO');
  if (!ico) return;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  ico.className = dark ? 'ti ti-sun' : 'ti ti-moon';
}

// ── PROFIL DROPDOWN ──────────────────────────────────────────────
function toggleProfile() {
  const drop = document.getElementById('PROFILE-DROP');
  const open = drop.style.display !== 'none';
  drop.style.display = open ? 'none' : 'block';
  if (!open) {
    const cnxEl = document.getElementById('PRF-CNX');
    if (cnxEl) {
      const me = USERS.find(u => u.id === CURRENT_USER_ID);
      const cnx = me?.derniere_cnx ? me.derniere_cnx.slice(0,16) : '—';
      cnxEl.innerHTML = `<span style="font-size:11px;color:var(--color-text-secondary)">Dernière cnx.</span><span style="font-size:11px;font-weight:500;font-family:var(--font-mono);color:var(--color-text-primary)">${cnx}</span>`;
    }
  }
}

document.addEventListener('click', function(e) {
  const drop = document.getElementById('PROFILE-DROP');
  const btn  = document.getElementById('AVA-BTN');
  if (drop && btn && !drop.contains(e.target) && !btn.contains(e.target)) {
    drop.style.display = 'none';
  }
});

// ── LOGOUT ───────────────────────────────────────────────────────
async function doLogout() {
  await api('POST', '/logout');
  window.location = '/login';
}

// ── DASHBOARD ────────────────────────────────────────────────────
async function loadDashboard() {
  const data = await api('GET', '/dashboard');
  if (!data) return;

  // Alert banner
  const nc = IND.filter(i => i.statut === 'nc_critique' && i.bloquant).length;
  const alertEl = document.getElementById('D-ALERT');
  if (nc > 0) {
    alertEl.className = 'al al-r';
    alertEl.innerHTML = `<i class="ti ti-alert-octagon"></i><strong>${nc} NC critique${nc>1?'s':''} bloquante${nc>1?'s':''}</strong> — Intervention immédiate<button class="btn btn-sm" style="margin-left:auto;font-size:10px;color:inherit;border-color:inherit;opacity:.8" onclick="goTo('decision','Matrice de décision 8D')">Voir décision →</button>`;
    alertEl.style.display = 'flex';
  } else {
    alertEl.style.display = 'none';
  }

  // KPI cards
  const sc8d = data.score_8d || 0;
  const feu = sc8d >= SEUIL_VERT ? 'vert' : sc8d >= SEUIL_ORANGE ? 'orange' : 'rouge';
  const feuC = feu === 'vert' ? 'var(--cg)' : feu === 'orange' ? 'var(--ca)' : 'var(--cr)';
  const feuBC = feu === 'vert' ? 'var(--cg)' : feu === 'orange' ? '#BA7517' : 'var(--cr)';

  const indice = data.indice_global || 0;
  const risque = data.risque_global || 0;
  const indiceC = indice >= 85 ? 'var(--cg)' : indice >= 70 ? '#BA7517' : 'var(--cr)';
  const nb_ind = Object.values(data.statuts||{}).reduce((a,b)=>a+b,0);
  const nb_na = data.statuts?.na || 0;
  const nb_eval = nb_ind - nb_na;
  const conf_pct = nb_eval > 0 ? Math.round((data.statuts?.conforme||0)/nb_eval*100) : 0;

  const t8d = data.trend_8d || [], tInd = data.trend_indice || [];
  document.getElementById('D-KPIS').innerHTML = `
    <div class="kpi" style="border-top-color:${indiceC}"><div class="kpi-l">Indice QSSE-Wx</div><div class="kpi-v" style="color:${indiceC}" data-val="${indice}">0</div><div class="kpi-s">/100 · Sem. ${weekNum()}</div>${sparkline(tInd, indiceC)}</div>
    <div class="kpi" style="border-top-color:#D97706"><div class="kpi-l">Risque global</div><div class="kpi-v" style="color:#D97706" data-val="${risque}">0</div><div class="kpi-s">pts pondérés</div></div>
    <div class="kpi" style="border-top-color:${feuBC}"><div class="kpi-l">Score 8D</div><div class="kpi-v" style="color:${feuC}" data-val="${sc8d}">0</div><div class="kpi-s">≥${SEUIL_VERT} GO · ≥${SEUIL_ORANGE} Renforcé</div>${sparkline(t8d, feuC)}</div>
    <div class="kpi" style="border-top-color:var(--cg)"><div class="kpi-l">Conformité</div><div class="kpi-v" style="color:var(--cg)" data-val="${conf_pct}">0</div><div class="kpi-s" id="CONF-SUB">${data.statuts?.conforme||0} / ${nb_eval} ind.</div></div>
    <div class="kpi" style="border-top-color:var(--cs)"><div class="kpi-l">Actions ouvertes</div><div class="kpi-v" data-val="${data.actions_ouvertes}">0</div><div class="kpi-s">${data.actions_retard} en retard</div></div>`;
  // Fix conformité display — add % suffix after animation
  setTimeout(() => {
    const cv = document.querySelector('#D-KPIS .kpi:nth-child(4) .kpi-v');
    if (cv) cv.textContent = conf_pct + '%';
  }, 820);

  // Domain bars
  const bars = (data.domains || []).map(d => {
    const col = DC[d.dom] || '#6b7591';
    const fc = d.score >= 85 ? '#3B6D11' : d.score >= 70 ? '#BA7517' : '#A32D2D';
    return `<div class="dom-row"><span class="mono" style="font-size:11px;font-weight:500;width:40px;color:${col}">${d.dom}</span><div class="dom-trk"><div class="dom-fill" style="width:${d.score}%;background:${col}"></div></div><span class="mono" style="font-size:11px;font-weight:500;width:32px;text-align:right;color:${fc}">${d.score}</span></div>`;
  }).join('');
  document.getElementById('DOM-BARS').innerHTML = bars;

  // Status breakdown
  const SRL = [{l:'Conformes',k:'conforme',c:'#3B6D11'},{l:'NC mineures',k:'nc_mineure',c:'#BA7517'},{l:'NC majeures',k:'nc_majeure',c:'#854F0B'},{l:'NC critiques',k:'nc_critique',c:'#A32D2D'},{l:'N/A',k:'na',c:'#6b7591'}];
  document.getElementById('STAT-ROWS').innerHTML = SRL.map(s =>
    `<div class="stat-row"><div class="stat-dot" style="background:${s.c}"></div><span style="flex:1;font-size:11px;color:var(--color-text-secondary)">${s.l}</span><span class="mono" style="font-size:12px;font-weight:500;color:${s.c}">${data.statuts?.[s.k]||0}</span></div>`
  ).join('');

  // Taux clôture
  const tx = data.taux_cloture || 0;
  document.getElementById('D-TAUX').textContent = tx + '%';
  document.getElementById('D-TAUX-BAR').style.width = tx + '%';

  // Decision card
  const decTxt = sc8d < SEUIL_ALERTE ? 'ARBITRAGE DIRECTION' : sc8d < SEUIL_ORANGE ? 'ALERTE — Renforcement requis' : sc8d < SEUIL_VERT ? 'PILOTAGE RENFORCÉ / GO' : 'MAINTIEN / GO';
  document.getElementById('D-DEC-TXT').textContent = decTxt;
  document.getElementById('D-DEC-TXT').style.color = feuC;
  const feuCls = {rouge:'feu-r',orange:'feu-o',vert:'feu-v'}[feu];
  document.getElementById('D-FEU').className = `feu ${feuCls}`;
  document.getElementById('D-FEU').innerHTML = `<div class="feu-dot" style="background:${feuC}"></div>${feu.toUpperCase()}`;
  document.getElementById('D-SC-LBL').textContent = `Score 8D = ${sc8d}`;
  document.getElementById('TB-SCORE').textContent = `8D · ${sc8d}`;
  document.getElementById('SEM-CHIP').textContent = `Sem. ${weekNum()} · ${new Date().getFullYear()}`;

  // Status bar + counter animations
  updateStatusBar(feu);
  animateKpis();

  // Recent actions/incidents + agenda
  renderDashAct();
  renderDashInc(data.incidents_recents || []);
  renderAgenda();
}

function renderAgenda() {
  const now = new Date(); now.setHours(0,0,0,0);
  const limit = new Date(now); limit.setDate(limit.getDate() + 14);
  const items = [];
  ACTIONS.filter(a => a.statut !== 'cloturee' && a.delai).forEach(a => {
    const d = new Date(a.delai);
    if (d >= now && d <= limit) items.push({date: d, type:'action', icon:'ti-checkbox', label:`${a.id} — ${a.libelle}`, sub:a.responsable, color: isRet(a.delai)?'var(--cr)':'var(--ca)', badge: bdg(AST[a.statut]||'b-n', ASL[a.statut]||a.statut)});
  });
  items.sort((a, b) => a.date - b.date);
  const el = document.getElementById('DASH-AGENDA');
  if (!items.length) {
    el.innerHTML = `<div style="text-align:center;padding:22px;color:var(--color-text-tertiary);font-size:12px"><i class="ti ti-calendar-check" style="font-size:22px;display:block;margin-bottom:6px"></i>Aucune échéance dans les 14 prochains jours</div>`;
    return;
  }
  el.innerHTML = items.map(it => {
    const daysLeft = Math.ceil((it.date - now) / 86400000);
    return `<div class="dom-row" style="cursor:pointer" onclick="goTo('actions','Plan d\\'actions')">
      <i class="ti ${it.icon}" style="font-size:14px;color:${it.color};flex-shrink:0"></i>
      <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.label}</div><div style="font-size:10px;color:var(--color-text-tertiary)">${it.sub}</div></div>
      ${it.badge}
      <span class="mono" style="font-size:11px;font-weight:600;color:${it.color};flex-shrink:0">${daysLeft === 0 ? "Auj." : `J+${daysLeft}`}</span>
    </div>`;
  }).join('');
}

function renderDashAct() {
  const h = ACTIONS.slice(0,4).map(a => {
    const r = isRet(a.delai) && a.statut !== 'cloturee';
    return `<tr class="${r?'r-danger':''}"><td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><div style="font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(a.libelle||'').slice(0,28)}${(a.libelle||'').length>28?'…':''}</div>${bdg('b-i',a.domaine)}</td><td style="font-size:11px">${(a.responsable||'').split(' ').pop()}</td><td><span class="mono" style="font-size:11px;${r?'color:#A32D2D;font-weight:500':''}">${(a.delai||'').slice(5).split('-').reverse().join('/')}${r?' ⚠':''}</span></td><td>${pbCell(a.avancement)}</td><td>${bdg(PRC[a.priorite]||'b-n',a.priorite)}</td></tr>`;
  }).join('');
  const el = document.getElementById('DASH-ACT');
  if (el) el.innerHTML = h || '<tr><td colspan="5" style="text-align:center;color:var(--color-text-tertiary);padding:12px">Aucune action</td></tr>';
}

function renderDashInc(incidents) {
  const h = incidents.slice(0,4).map(i =>
    `<tr class="${i.gravite==='grave'?'r-danger':''}"><td class="mono" style="font-size:11px">${fmtD(i.date)}</td><td style="font-size:11px">${i.zone}</td><td>${bdg(GRC[i.gravite]||'b-n',GRL[i.gravite]||i.gravite)}</td><td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${(i.description||'').slice(0,22)}…</td><td>${bdg(IST[i.statut]||'b-n',ISL[i.statut]||i.statut)}</td></tr>`
  ).join('');
  const el = document.getElementById('DASH-INC');
  if (el) el.innerHTML = h || '<tr><td colspan="5" style="text-align:center;color:var(--color-text-tertiary);padding:12px">Aucun incident</td></tr>';
}

// ── INDICATEURS ──────────────────────────────────────────────────
let stFilt = 'all';

function setFilt(f) {
  stFilt = f;
  document.querySelectorAll('[id^="FBT-"]').forEach(b => b.style.fontWeight = '');
  const el = document.getElementById('FBT-' + f);
  if (el) el.style.fontWeight = '600';
  renderInd();
}

function updateFiltCounts() {
  const all = IND.length;
  const counts = {all, nc_critique:0, nc_majeure:0, nc_mineure:0, conforme:0};
  IND.forEach(i => { if (counts[i.statut] !== undefined) counts[i.statut]++; });
  Object.entries(counts).forEach(([k,v]) => {
    const el = document.getElementById('CNT-' + k);
    if (el) el.textContent = v;
  });
  const nb = document.getElementById('nb-nc');
  if (nb) nb.textContent = counts.nc_critique;
}

function renderInd() {
  const df = document.getElementById('DOMF').value;
  const sr = (document.getElementById('SRCH').value || '').toLowerCase();
  const rows = IND.filter(i => {
    if (stFilt !== 'all' && i.statut !== stFilt) return false;
    if (df && i.domaine !== df) return false;
    if (sr && !i.libelle.toLowerCase().includes(sr) && !i.id.toLowerCase().includes(sr)) return false;
    return true;
  });
  document.getElementById('IND-CNT').textContent = rows.length + ' ind.';
  const {slice: indSlice, p: indP, total: indTotal} = _paginate(rows, 'ind');
  const h = indSlice.map(i => {
    const col = DC[i.domaine] || '#6b7591';
    const s = STC[i.statut] || {l:i.statut,b:'b-n'};
    const rc = i.points_risque>=3?'#A32D2D':i.points_risque>=2?'#854F0B':i.points_risque>=1?'#BA7517':'#3B6D11';
    return `<tr class="${i.statut==='nc_critique'?'r-danger':''}">
      <td><span class="mono" style="font-size:10px;font-weight:500;color:${col}">${i.id}</span></td>
      <td><span style="padding:1px 5px;border-radius:3px;background:${col}18;color:${col};font-size:9px;font-weight:500;font-family:var(--font-mono)">${i.domaine}</span></td>
      <td style="font-size:11px;color:var(--color-text-secondary)">${i.zone}</td>
      <td title="${i.libelle}"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.libelle}</div></td>
      <td style="text-align:center">${i.bloquant?'<span style="font-size:10px;font-weight:500;color:#A32D2D">OUI</span>':'<span style="color:var(--color-text-tertiary)">—</span>'}</td>
      <td>${bdg(s.b,s.l)}</td>
      <td class="mono" style="font-weight:500">${i.score!=null?Number(i.score).toFixed(2):'—'}</td>
      <td class="mono" style="font-weight:500;color:${rc}">${i.points_risque}</td>
      <td class="mono" style="font-weight:500;color:${i.rang&&i.rang<=3?'#A32D2D':'var(--color-text-primary)'}">${i.rang?'#'+i.rang:'—'}</td>
      <td><div style="display:flex;gap:4px">
        <button class="btn btn-sm" onclick="openFiche('${i.id}')"><i class="ti ti-eye"></i>Fiche</button>
        <button class="btn btn-p btn-sm" onclick="openSaisie('${i.id}')"><i class="ti ti-pencil"></i></button>
        <button class="btn btn-sm" onclick="deleteInd('${i.id}')" title="Supprimer" style="color:var(--cr);border-color:var(--cr)22"><i class="ti ti-trash" style="font-size:12px"></i></button>
      </div></td>
    </tr>`;
  }).join('');
  document.getElementById('IND-TBODY').innerHTML = h || `<tr><td colspan="10" style="text-align:center;padding:32px 18px"><div style="font-size:28px;margin-bottom:8px">📋</div><div style="font-weight:600;margin-bottom:4px">Aucun indicateur</div><div style="font-size:11px;color:var(--color-text-tertiary)">Ajustez les filtres ou créez un indicateur depuis les paramètres</div></td></tr>`;
  _renderPager('IND-PAGES', 'ind', indTotal, indP, 'goPageInd');
}

async function deleteInd(id) {
  if (!await confirmModal(`Supprimer l'indicateur ${id} et tout son historique d'observations ?`)) return;
  const res = await api('DELETE', `/indicateurs/${id}`);
  if (!res) return;
  if (res.error) { toast(res.error, 'danger'); return; }
  IND = IND.filter(i => i.id !== id);
  renderInd();
  updateFiltCounts();
  await loadDashboard();
  toast(`Indicateur ${id} supprimé`);
}

// ── FICHE ────────────────────────────────────────────────────────
let _ficheIndId = null;

async function openFiche(id) {
  const data = await api('GET', `/indicateurs/${id}`);
  if (!data) return;
  _ficheIndId = id;
  const ind = data.indicateur;
  const hist = data.historique || [];
  const acts = data.actions || [];
  const modHist = data.mod_history || [];

  const col = DC[ind.domaine] || '#6b7591';
  const s = STC[ind.statut] || {l:ind.statut,b:'b-n',c:'#6b7591'};

  document.getElementById('F-RING').style.borderColor = s.c;
  const scEl = document.getElementById('F-SC');
  scEl.textContent = ind.score!=null ? Number(ind.score).toFixed(2) : 'N/A';
  scEl.style.color = s.c;
  const db = document.getElementById('F-DOM');
  db.textContent = ind.domaine; db.style.background = col+'18'; db.style.color = col;
  document.getElementById('F-ID').textContent = id;
  document.getElementById('F-LIB').textContent = ind.libelle;
  document.getElementById('F-ZN').textContent = ind.zone;
  document.getElementById('F-IMP').textContent = ind.impact;
  document.getElementById('F-PDS').textContent = Number(ind.poids).toFixed(2);
  document.getElementById('F-BL').style.display = ind.bloquant ? '' : 'none';
  document.getElementById('F-RG').style.display = ind.reglementaire ? '' : 'none';
  document.getElementById('F-SAISIR').onclick = () => openSaisie(id);

  const fa = document.getElementById('F-ALERT');
  if (ind.statut === 'nc_critique') {
    fa.className = 'al al-r'; fa.style.display = 'flex';
    fa.innerHTML = `<i class="ti ti-alert-octagon"></i><strong>NC critique${ind.bloquant?' bloquante':''}</strong> — ${ind.bloquant?"Arrêt des travaux requis":'Action corrective J+1'}`;
  } else if (ind.statut === 'nc_majeure') {
    fa.className = 'al al-o'; fa.style.display = 'flex';
    fa.innerHTML = '<i class="ti ti-alert-triangle"></i><strong>NC majeure</strong> — Action corrective requise sous J+3';
  } else if (ind.statut === 'conforme') {
    fa.className = 'al al-g'; fa.style.display = 'flex';
    fa.innerHTML = '<i class="ti ti-circle-check"></i>Indicateur conforme — Maintenir la surveillance.';
  } else {
    fa.style.display = 'none';
  }

  const sc = ind.score != null ? Number(ind.score) : 0;
  const p  = Number(ind.poids) || 1;
  const pa = Number(ind.poids_actif) || 0;
  const bl = ind.bloquant ? 2 : 1;
  const rg = ind.reglementaire ? 2 : 1;
  const sp   = sc * pa;
  const rp   = ind.points_risque * pa;
  const crit = ind.points_risque * bl * rg;
  const pp   = Number(ind.perte_ponderee) || (1 - sc) * pa;
  const ip   = Number(ind.indice_priorite) || crit;
  const rp2  = ind.rang_priorite;

  document.getElementById('F-STATS').innerHTML = [
    {l:'Score',v:ind.score!=null?Number(ind.score).toFixed(2):'N/A',c:s.c},
    {l:'Pts risque',v:ind.points_risque,c:ind.points_risque>=3?'#A32D2D':ind.points_risque>=2?'#854F0B':'#BA7517'},
    {l:'Poids actif',v:pa.toFixed(4),c:'var(--color-text-primary)'},
    {l:'Indice priorité',v:ip.toFixed(1),c:ip>=6?'#A32D2D':ip>=3?'#BA7517':'var(--color-text-primary)'},
  ].map(x => `<div style="background:var(--color-background-secondary);border-radius:var(--border-radius-md);padding:9px 12px;text-align:center"><div style="font-size:10px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">${x.l}</div><div class="mono" style="font-size:17px;font-weight:500;color:${x.c}">${x.v}</div></div>`).join('');

  document.getElementById('F-CALC').innerHTML = [
    `poids_actif = poids / Σpoids_actifs = <strong>${pa.toFixed(4)}</strong>`,
    `score_pondéré = ${sc.toFixed(2)} × ${pa.toFixed(4)} = <strong>${sp.toFixed(4)}</strong>`,
    `perte_pondérée = (1 − ${sc.toFixed(2)}) × ${pa.toFixed(4)} = <strong>${pp.toFixed(4)}</strong>`,
    `indice_priorité = ${ind.points_risque} × ${bl}(bloc) × ${rg}(régl) = <strong>${ip.toFixed(1)}</strong>`,
    rp2 != null ? `rang_priorité = <strong>#${rp2}</strong> (parmi indicateurs actifs)` : null,
  ].filter(Boolean).map(f => `<div style="background:var(--color-background-secondary);border-radius:var(--border-radius-md);padding:8px 11px;font-family:var(--font-mono);font-size:11px;color:var(--color-text-secondary);margin-bottom:7px">${f}</div>`).join('');

  document.getElementById('F-HCNT').textContent = hist.length + ' obs.';
  document.getElementById('F-HIST').innerHTML = hist.map((h, i) => {
    const hs = STC[h.statut] || {l:h.statut,b:'b-n',c:'#6b7591'};
    let photos = [];
    try { photos = JSON.parse(h.photos || '[]'); } catch(e) {}
    return `<div class="hist-item" style="flex-direction:column;align-items:flex-start;gap:6px;${i===0?'background:var(--color-background-secondary)':''}">
      <div style="display:flex;align-items:center;gap:9px;width:100%">
        <div style="width:68px;flex-shrink:0"><div class="mono" style="font-size:11px;font-weight:${i===0?500:400}">${h.date}</div>${i===0?'<div style="font-size:9px;color:var(--brand);font-weight:600">DERNIER</div>':''}</div>
        ${bdg(hs.b,hs.l)}
        <div class="hist-trk"><div class="hist-fill" style="width:${((h.score||0)*100)}%;background:${hs.c}"></div></div>
        <span class="mono" style="font-size:11px;font-weight:500;width:28px;flex-shrink:0;color:${hs.c}">${h.score!=null?Number(h.score).toFixed(2):'—'}</span>
        <div style="flex:1;min-width:0;font-size:11px;color:var(--color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.observateur}${h.commentaire?' — '+h.commentaire.slice(0,22):''}</div>
        ${photos.length ? `<span style="font-size:10px;color:var(--brand);flex-shrink:0"><i class="ti ti-camera" style="font-size:11px"></i> ${photos.length}</span>` : ''}
        <button onclick="deleteObs(${h.id},'${id}')" title="Supprimer cette observation" style="margin-left:auto;flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--color-text-tertiary);padding:2px 4px;border-radius:4px;line-height:1;transition:color .15s" onmouseover="this.style.color='var(--cr)'" onmouseout="this.style.color='var(--color-text-tertiary)'"><i class="ti ti-trash" style="font-size:13px"></i></button>
      </div>
      ${photos.length ? _photoGallery(photos) : ''}
    </div>`;
  }).join('');

  document.getElementById('F-ACTS').innerHTML = acts.length
    ? acts.map(a => `<div style="display:flex;align-items:center;gap:8px;padding:9px 13px;border-bottom:0.5px solid var(--color-border-tertiary)"><span class="mono" style="font-size:10px;font-weight:500;color:var(--color-text-secondary);flex-shrink:0">${a.id}</span><div style="flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.libelle}</div>${pbCell(a.avancement)}${bdg(AST[a.statut]||'b-n',ASL[a.statut]||a.statut)}${bdg(PRC[a.priorite]||'b-n',a.priorite)}</div>`).join('') +
      `<div style="padding:8px 13px"><button class="btn btn-sm" onclick="goTo('actions','Plan d\'actions')">Voir plan d'actions →</button></div>`
    : '<div style="padding:12px 13px;font-size:12px;color:var(--color-text-tertiary)">Aucune action liée</div>';

  // Seuil d'alerte
  const seuilInp = document.getElementById('F-SEUIL-INP');
  const seuilSt  = document.getElementById('F-SEUIL-STATUS');
  if (seuilInp) {
    seuilInp.value = ind.seuil_alerte != null ? ind.seuil_alerte : '';
    if (seuilSt) {
      seuilSt.textContent = ind.seuil_alerte != null
        ? `Alerte active : score < ${Number(ind.seuil_alerte).toFixed(2)}`
        : 'Aucun seuil configuré — pas d\'alerte automatique';
      seuilSt.style.color = ind.seuil_alerte != null ? 'var(--ca)' : 'var(--color-text-tertiary)';
    }
  }

  // Historique des modifications
  const mhEl  = document.getElementById('F-MOD-HIST');
  const mhCnt = document.getElementById('F-MODHCNT');
  if (mhCnt) mhCnt.textContent = modHist.length + ' entrée' + (modHist.length !== 1 ? 's' : '');
  if (mhEl) {
    if (!modHist.length) {
      mhEl.innerHTML = '<div style="padding:18px;text-align:center;font-size:12px;color:var(--color-text-tertiary)">Aucune modification enregistrée — les changements futurs apparaîtront ici.</div>';
    } else {
      const ACST = {observation:'b-i',seuil:'b-w',import:'b-n'};
      const ACSL = {observation:'Observation',seuil:'Seuil',import:'Import'};
      mhEl.innerHTML = '<div style="padding:6px 4px">' + modHist.map(m => {
        const ns = STC[m.nouveau_statut]||{l:m.nouveau_statut,c:'#6b7591'};
        const os = STC[m.ancien_statut]||{l:m.ancien_statut,c:'#6b7591'};
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-bottom:0.5px solid var(--color-border-tertiary);font-size:11px">
          <span class="mono" style="font-size:10px;color:var(--color-text-tertiary);flex-shrink:0;width:112px">${m.date}</span>
          ${bdg(ACST[m.action]||'b-n', ACSL[m.action]||m.action)}
          <span style="color:${os.c}">${os.l}</span>
          <i class="ti ti-arrow-right" style="font-size:10px;color:var(--color-text-tertiary)"></i>
          <span style="color:${ns.c};font-weight:500">${ns.l}</span>
          ${m.ancien_score!=null?`<span class="mono" style="color:var(--color-text-tertiary)">${Number(m.ancien_score).toFixed(2)}→${m.nouveau_score!=null?Number(m.nouveau_score).toFixed(2):'N/A'}</span>`:''}
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-text-secondary)">${m.modif_par}${m.details?' — '+m.details:''}</span>
        </div>`;
      }).join('') + '</div>';
    }
  }

  goTo('fiche', 'Fiche — ' + id);
}

async function deleteObs(obsId, indId) {
  if (!await confirmModal('Supprimer cette observation ?', 'Supprimer l\'observation')) return;
  const res = await api('DELETE', `/observations/${obsId}`);
  if (res && res.ok) openFiche(indId);
}

async function setSeuil(clear = false) {
  if (!_ficheIndId) return;
  const val = clear ? null : document.getElementById('F-SEUIL-INP').value;
  if (!clear && (val === '' || isNaN(parseFloat(val)))) { toast('Valeur invalide (ex: 0.50)', 'danger'); return; }
  const payload = {seuil_alerte: clear ? null : parseFloat(val)};
  const res = await api('PUT', `/indicateurs/${_ficheIndId}/seuil`, payload);
  if (!res || res.error) { toast(res?.error || 'Erreur', 'danger'); return; }
  toast(clear ? 'Seuil d\'alerte désactivé' : `Seuil fixé à ${parseFloat(val).toFixed(2)}`);
  await openFiche(_ficheIndId);
}

async function exportFiltered(type) {
  const labels = {nc_critiques:'NC Critiques', actions_retard:'Actions en retard', incidents_ouverts:'Incidents ouverts'};
  toast(`Génération PDF "${labels[type] || type}" en cours…`);
  try {
    const res = await fetch(`/api/export/filtered?type=${type}`, {credentials: 'same-origin'});
    if (!res.ok) {
      let msg = 'Erreur serveur';
      try { const j = await res.json(); msg = j.error || msg; } catch(e) {}
      toast(msg, 'danger');
      return;
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const cd   = res.headers.get('Content-Disposition') || '';
    const m    = cd.match(/filename="?([^";]+)"?/);
    const name = m ? m[1] : `export_${type}.pdf`;
    const a    = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
    toast(`PDF "${labels[type] || type}" téléchargé`);
    const hist = await api('GET', '/report_history');
    if (hist) { RPT_HIST = hist; renderReportHistory(); }
  } catch(e) {
    toast('Erreur lors de la génération PDF', 'danger');
  }
}

// ── SAISIE ───────────────────────────────────────────────────────
let selStat = 'nc_critique';
const STO_CFG = {conforme:{sc:1,rq:0,dl:'—'},nc_mineure:{sc:0.75,rq:1,dl:'J+14'},nc_majeure:{sc:0.5,rq:2,dl:'J+3'},nc_critique:{sc:0,rq:3,dl:'J+1'},na:{sc:null,rq:0,dl:'—'}};
const STO_COL = {
  conforme:{bc:'var(--color-border-success)',bg:'var(--cgl)',tc:'var(--cg)'},
  nc_mineure:{bc:'var(--color-border-warning)',bg:'var(--cal)',tc:'var(--ca)'},
  nc_majeure:{bc:'#854F0B',bg:'#FAEEDA',tc:'#633806'},
  nc_critique:{bc:'var(--cr)',bg:'var(--crl)',tc:'var(--cr)'},
  na:{bc:'var(--color-border-secondary)',bg:'var(--color-background-secondary)',tc:'var(--color-text-secondary)'},
};

function buildSaisieSelect() {
  const sel = document.getElementById('OBS-IND');
  if (!sel) return;
  sel.innerHTML = IND.filter(i => i.statut !== 'na').map(i =>
    `<option value="${i.id}">${i.id} — ${i.libelle} (${i.zone})</option>`
  ).join('');
  const naSrc = document.getElementById('NA-SRC');
  if (naSrc) {
    naSrc.innerHTML = '<option value="">— Sélectionner —</option>' +
      IND.map(i => `<option value="${i.id}">${i.id} — ${i.libelle}</option>`).join('');
  }
}

function selSt(s) {
  selStat = s;
  ['conforme','nc_mineure','nc_majeure','nc_critique','na'].forEach(k => {
    const el = document.getElementById('SO-' + k);
    if (!el) return;
    const isSel = k === s, c = STO_COL[k];
    el.style.borderColor = isSel ? c.bc : 'var(--color-border-tertiary)';
    el.style.background  = isSel ? c.bg : 'transparent';
    el.style.color       = isSel ? c.tc : 'var(--color-text-primary)';
  });
  const opt = STO_CFG[s];
  document.getElementById('OBS-SC').textContent = opt.sc != null ? opt.sc.toFixed(2) : 'N/A';
  document.getElementById('OBS-SC').style.color = s==='nc_critique'?'#A32D2D':s==='nc_majeure'?'#BA7517':'var(--color-text-primary)';
  document.getElementById('OBS-RQ').textContent = opt.rq;
  document.getElementById('OBS-DL').textContent = opt.dl;
  document.getElementById('OBS-DL').style.color = s==='nc_critique'?'#A32D2D':s==='nc_majeure'?'#BA7517':'var(--color-text-primary)';
  const au = document.getElementById('OBS-AUTO');
  if (s === 'nc_critique') {
    au.style.display = 'flex';
    au.innerHTML = '<i class="ti ti-bolt"></i>Action corrective générée automatiquement sous <strong style="margin-left:3px">J+1</strong>';
  } else if (s === 'nc_majeure') {
    au.style.display = 'flex';
    au.innerHTML = '<i class="ti ti-bolt"></i>Action corrective générée automatiquement sous <strong style="margin-left:3px">J+3</strong>';
  } else if (s === 'nc_mineure') {
    au.style.display = 'flex';
    au.innerHTML = '<i class="ti ti-bolt"></i>Action corrective générée sous <strong style="margin-left:3px">J+14</strong>';
  } else {
    au.style.display = 'none';
  }
}

function updObs() { selSt(selStat); }

function openSaisie(id) {
  const sel = document.getElementById('OBS-IND');
  if (sel) {
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === id) { sel.selectedIndex = i; break; }
    }
  }
  goTo('saisie', 'Saisie terrain');
  selSt('nc_critique');
  document.getElementById('OBS-CMT').value = '';
  initImgWidget('OBS-PHOTOS-WIDGET', 'obs');
}

async function submitObs() {
  const id = document.getElementById('OBS-IND').value;
  const commentaire = document.getElementById('OBS-CMT').value;
  if (!id) { toast('Sélectionner un indicateur', 'danger'); return; }
  const photos = IMG_STATE['obs'] || [];
  const result = await api('POST', `/indicateurs/${id}/observation`, {statut: selStat, commentaire, photos});
  if (!result) return;
  if (result.error) { toast(result.error, 'danger'); return; }
  toast(result.message); showSaved('Observation enregistrée');
  const [inds, acts, notifs] = await Promise.all([
    api('GET', '/indicateurs'), api('GET', '/actions'), api('GET', '/notifications')
  ]);
  if (inds) { IND = inds; renderInd(); updateFiltCounts(); }
  if (acts) { ACTIONS = acts; renderAct(); }
  if (notifs) { NOTIFS = notifs; renderNotifs(); }
  await loadDashboard();
  goTo('indicateurs', 'Indicateurs');
}

// ── ACTIONS ──────────────────────────────────────────────────────
function renderAct() {
  const sf = document.getElementById('A-STF').value;
  const pf = document.getElementById('A-PRF').value;
  const rf = document.getElementById('A-RF').checked;
  const df = parseInt(document.getElementById('A-DF').value) || 0;
  const now = new Date();
  const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
  const cutoff = df ? new Date(now - df * 86400000) : null;

  const rows = ACTIONS.filter(a => {
    if (sf && a.statut !== sf) return false;
    if (pf && a.priorite !== pf) return false;
    if (rf && !(isRet(a.delai) && a.statut !== 'cloturee')) return false;
    if (cutoff && a.date_creation && new Date(a.date_creation) < cutoff) return false;
    return true;
  });

  const tot = ACTIONS.length;
  const cl = ACTIONS.filter(a => a.statut === 'cloturee').length;
  const ret = ACTIONS.filter(a => a.statut !== 'cloturee' && isRet(a.delai)).length;
  const proche7 = ACTIONS.filter(a => a.statut !== 'cloturee' && a.delai && new Date(a.delai) <= in7 && !isRet(a.delai)).length;

  document.getElementById('A-TOT').textContent = tot;
  document.getElementById('A-TAUX').textContent = tot ? Math.round(cl/tot*100)+'%' : '0%';
  document.getElementById('A-RET').textContent = ret;
  document.getElementById('A-7J').textContent = proche7;

  const alertEl = document.getElementById('A-ALERT');
  if (proche7 > 0) {
    alertEl.style.display = 'flex';
    alertEl.innerHTML = `<i class="ti ti-clock"></i>${proche7} action${proche7>1?'s':''} arrivant à échéance dans les 7 prochains jours`;
  } else {
    alertEl.style.display = 'none';
  }

  document.getElementById('nb-ret').textContent = ret;

  const {slice: actSlice, p: actP, total: actTotal} = _paginate(rows, 'act');
  const h = actSlice.map(a => {
    const r = isRet(a.delai) && a.statut !== 'cloturee';
    return `<tr class="${r?'r-danger':''}">
      <td class="mono" style="font-size:10px;font-weight:500">${a.id}</td>
      <td title="${a.libelle}"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.libelle}</div></td>
      <td><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.domaine}">${a.domaine}</div></td>
      <td><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.responsable}">${a.responsable}</div></td>
      <td><span class="mono" style="font-size:11px;${r?'color:#A32D2D;font-weight:500':''}">${fmtD(a.delai)}${r?' ⚠':''}</span></td>
      <td>${pbCell(a.avancement)}</td>
      <td>${bdg(AST[a.statut]||'b-n',ASL[a.statut]||a.statut)}</td>
      <td>${bdg(PRC[a.priorite]||'b-n',a.priorite)}</td>
      <td><div style="display:flex;gap:4px">
        <button class="btn btn-sm btn-icon" onclick="openEditModal('${a.id}')" title="Modifier"><i class="ti ti-edit"></i></button>
        <button class="btn btn-sm btn-icon" onclick="openFicheAction('${a.id}')" title="Détail"><i class="ti ti-eye"></i></button>
        ${CURRENT_USER_ROLE==='admin'?`<button class="btn btn-sm btn-icon" onclick="deleteAction('${a.id}','${a.libelle.replace(/'/g,"\\'")}')" title="Supprimer" style="color:var(--cr)"><i class="ti ti-trash"></i></button>`:''}
      </div></td>
    </tr>`;
  }).join('');
  document.getElementById('A-TBODY').innerHTML = h || `<tr><td colspan="9" style="text-align:center;padding:32px 18px"><div style="font-size:28px;margin-bottom:8px">🎯</div><div style="font-weight:600;margin-bottom:4px">Aucune action</div><div style="font-size:11px;color:var(--color-text-tertiary)">Bonne nouvelle — aucune action ne correspond à ces filtres</div></td></tr>`;
  _renderPager('A-PAGES', 'act', actTotal, actP, 'goPageAct');
}

let editId = null;
function openEditModal(id) {
  const a = ACTIONS.find(x => x.id === id);
  if (!a) return;
  editId = id;
  document.getElementById('EM-TITLE').textContent = 'Modifier ' + id;
  document.getElementById('EM-AV').value = a.avancement;
  document.getElementById('EM-AV-V').textContent = a.avancement + '%';
  document.getElementById('EM-ST').value = a.statut;
  document.getElementById('EM-CMT').value = '';
  openModal('M-EDIT');
}

async function saveEdit() {
  if (!editId) return;
  const avancement = parseInt(document.getElementById('EM-AV').value);
  const statut = document.getElementById('EM-ST').value;
  const result = await api('PUT', `/actions/${editId}`, {avancement, statut});
  if (!result) return;
  closeModal('M-EDIT');
  const acts = await api('GET', '/actions');
  if (acts) { ACTIONS = acts; renderAct(); renderDashAct(); }
  toast(`Action ${editId} mise à jour — ${avancement}% · ${ASL[statut]||statut}`);
}

function openAddAction() {
  const d = new Date(); d.setDate(d.getDate() + 7);
  document.getElementById('NA-DEL').value = d.toISOString().split('T')[0];
  document.getElementById('NA-LIB').value = '';
  openModal('M-ACT');
}

async function submitAction() {
  const libelle = document.getElementById('NA-LIB').value.trim();
  const domaine = document.getElementById('NA-DOM').value;
  const responsable = document.getElementById('NA-RESP').value;
  const delai = document.getElementById('NA-DEL').value;
  if (!libelle || !domaine || !responsable || !delai) {
    toast('Veuillez remplir tous les champs obligatoires', 'danger'); return;
  }
  const result = await api('POST', '/actions', {
    source_id: document.getElementById('NA-SRC').value,
    libelle, domaine, responsable, delai,
    priorite: document.getElementById('NA-PRIO').value,
  });
  if (!result) return;
  if (result.error) { toast(result.error, 'danger'); return; }
  closeModal('M-ACT');
  const acts = await api('GET', '/actions');
  if (acts) { ACTIONS = acts; renderAct(); }
  toast('Action ' + result.id + ' créée avec succès'); showSaved('Action créée');
}

// ── TF/TG ─────────────────────────────────────────────────────────
function renderTfTg() {
  if (!TFTG.length) return;
  const last = TFTG[0]; // most recent (sorted DESC)
  const tf = last ? Number(last.tf).toFixed(1) : '—';
  const tg = last ? Number(last.tg).toFixed(3) : '—';
  const jsa = INCIDENTS.filter(i => i.gravite === 'grave' && i.statut !== 'cloture').length === 0
    ? (() => {
        const dates = INCIDENTS.filter(i => i.jours_arret > 0).map(i => new Date(i.date));
        if (!dates.length) return '—';
        const last_acc = new Date(Math.max(...dates.map(d => d.getTime())));
        const diff = Math.floor((new Date() - last_acc) / 86400000);
        return diff + ' j';
      })()
    : '0 j';
  const tfEl = document.querySelector('#pg-incidents .kpi-v');
  const kpis = document.querySelectorAll('#pg-incidents .kpi-v');
  if (kpis[0]) kpis[0].textContent = tf;
  if (kpis[1]) kpis[1].textContent = tg;
  if (kpis[2]) kpis[2].textContent = jsa;
}

// ── INCIDENTS ────────────────────────────────────────────────────
function renderInc() {
  const gf = document.getElementById('I-GF').value;
  const sf = document.getElementById('I-SF').value;
  const df = parseInt(document.getElementById('I-DF').value) || 0;
  const cutoff = df ? new Date(Date.now() - df * 86400000) : null;
  const rows = INCIDENTS.filter(i => {
    if (gf && i.gravite !== gf) return false;
    if (sf && i.statut !== sf) return false;
    if (cutoff && i.date && new Date(i.date) < cutoff) return false;
    return true;
  });
  document.getElementById('INC-TOT').textContent = INCIDENTS.length;
  const {slice: incSlice, p: incP, total: incTotal} = _paginate(rows, 'inc');
  const h = incSlice.map(i =>
    `<tr class="${i.gravite==='grave'?'r-danger':''}">
      <td class="mono" style="font-size:11px">${fmtD(i.date)}</td>
      <td style="font-size:11px">${i.zone}</td>
      <td>${bdg('b-i',i.type)}</td>
      <td>${bdg(GRC[i.gravite]||'b-n',GRL[i.gravite]||i.gravite)}</td>
      <td class="mono" style="text-align:center;font-weight:500;color:${i.jours_arret>0?'#A32D2D':'var(--color-text-tertiary)'}">${i.jours_arret||'—'}</td>
      <td title="${i.description}"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.description}</div></td>
      <td><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--color-text-secondary)" title="${i.cause}">${i.cause}</div></td>
      <td><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${i.responsable}">${i.responsable}</div></td>
      <td>${bdg(IST[i.statut]||'b-n',ISL[i.statut]||i.statut)}</td>
      <td><div style="display:flex;align-items:center;gap:4px">${(() => { try { const p = JSON.parse(i.photos||'[]'); return p.length ? `<span style="font-size:10px;color:var(--brand);font-weight:600"><i class="ti ti-camera"></i>${p.length}</span>` : ''; } catch(e) { return ''; }})()}<button class="btn btn-sm btn-icon" onclick="openFicheIncident('${i.id}')" title="Détail"><i class="ti ti-eye"></i></button>${CURRENT_USER_ROLE==='admin'?`<button class="btn btn-sm btn-icon" onclick="deleteIncident('${i.id}')" title="Supprimer" style="color:var(--cr)"><i class="ti ti-trash"></i></button>`:''}</div></td>
    </tr>`
  ).join('');
  document.getElementById('I-TBODY').innerHTML = h || `<tr><td colspan="10" style="text-align:center;padding:32px 18px"><div style="font-size:28px;margin-bottom:8px">✅</div><div style="font-weight:600;margin-bottom:4px">Aucun incident</div><div style="font-size:11px;color:var(--color-text-tertiary)">Aucun incident sur cette période — continuez ainsi !</div></td></tr>`;
  _renderPager('I-PAGES', 'inc', incTotal, incP, 'goPageInc');
}

async function submitInc() {
  const desc = document.getElementById('IM-DESC').value.trim();
  if (!desc) { toast('La description est obligatoire', 'danger'); return; }
  const photos = IMG_STATE['inc'] || [];
  const result = await api('POST', '/incidents', {
    date: document.getElementById('IM-DATE').value,
    zone: document.getElementById('IM-ZONE').value,
    type: document.getElementById('IM-TYPE').value,
    gravite: document.getElementById('IM-GRAV').value,
    jours_arret: document.getElementById('IM-JJ').value,
    description: desc,
    cause: document.getElementById('IM-CAUSE').value,
    responsable: document.getElementById('IM-RESP').value,
    photos,
  });
  if (!result) return;
  if (result.error) { toast(result.error, 'danger'); return; }
  closeModal('M-INC');
  const incs = await api('GET', '/incidents');
  if (incs) { INCIDENTS = incs; renderInc(); }
  toast('Incident ' + result.id + ' déclaré'); showSaved('Incident déclaré');
}

// ── DÉCISION 8D ──────────────────────────────────────────────────
async function loadDecision() {
  const data = await api('GET', '/revue');
  if (!data) return;
  RV_SCORES = data.scores || RV_SCORES;

  const sc = calcRvScore();
  const feu = sc >= 65 ? 'vert' : sc >= 50 ? 'orange' : 'rouge';
  const d = calcRvDecision();
  const feuC = d.feu==='vert'?'var(--cg)':d.feu==='orange'?'var(--ca)':'var(--cr)';
  const feuBg = d.feu==='vert'?'var(--cgl)':d.feu==='orange'?'var(--cal)':'var(--crl)';

  const card = document.getElementById('DEC-CARD');
  card.style.background = feuBg; card.style.borderColor = feuC;
  document.getElementById('DEC-HDR').style.color = feuC;
  document.getElementById('DEC-TXT').textContent = d.dec;
  document.getElementById('DEC-TXT').style.color = feuC;
  const feuCls = {rouge:'feu-r',orange:'feu-o',vert:'feu-v'}[d.feu];
  document.getElementById('DEC-FEU').className = `feu ${feuCls}`;
  document.getElementById('DEC-FEU').innerHTML = `<div class="feu-dot" style="background:${feuC}"></div>${d.feu.toUpperCase()}`;
  document.getElementById('DEC-SC').textContent = `Score 8D = ${d.sc} / 100`;
  document.getElementById('DEC-SC').style.color = feuC;
  buildScoreRing('DEC-RING', d.sc, d.feu);

  const derive = moteurDerive();
  const COMPS = Object.keys(RV_POIDS).map(k => ({k,l:RV_LBLS[k],v:RV_SCORES[k]||0,p:Math.round(RV_POIDS[k]*100)}));
  document.getElementById('COMP-8D').innerHTML =
    (d.garde_fou ? `<div style="padding:7px 10px;background:var(--crl);border-left:3px solid var(--cr);color:var(--cr);font-size:11px;font-weight:500;margin-bottom:8px">⚠ ${d.sub}</div>` : '') +
    `<div style="padding:7px 10px;background:var(--c1l);border-left:3px solid var(--c1);color:var(--c1);font-size:11px;margin-bottom:8px">Moteur de dérive principal : <strong>${RV_LBLS[derive.k]}</strong> — score <strong>${derive.v}</strong></div>` +
    COMPS.map(c => {
      const isDerive = c.k === derive.k;
      const col = c.v<55?'#A32D2D':c.v<70?'#BA7517':'#3B6D11';
      return `<div class="comp-bar" style="${isDerive?'border:1px solid '+col+';border-radius:4px;padding:4px 6px;margin-bottom:3px':''}"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;color:var(--color-text-secondary)">${c.l}${isDerive?' ⟵':''}</span><div style="display:flex;align-items:center;gap:8px"><span style="font-size:10px;color:var(--color-text-tertiary)">×${c.p}%</span><span class="mono" style="font-size:12px;font-weight:500;color:${col}">${c.v}</span></div></div><div class="comp-trk"><div class="comp-fill" style="width:${c.v}%;background:${col}"></div></div></div>`;
    }).join('');

  const RECS = [];
  if (d.garde_fou) RECS.push({cls:'r',m:`GARDE-FOU DÉCLENCHÉ — ${d.sub}`});
  else if (d.sc < SEUIL_ALERTE) RECS.push({cls:'r',m:'ARBITRAGE DIRECTION — Présenter le plan de redressement immédiat'});
  else if (d.sc < SEUIL_ORANGE) RECS.push({cls:'o',m:'ALERTE — Mobiliser les équipes sous 48h, renforcer le plan d\'action'});
  else if (d.sc < SEUIL_VERT)   RECS.push({cls:'o',m:'PILOTAGE RENFORCÉ — Maintenir la vigilance, suivre les arbitrages'});
  const nc_crit = IND.filter(i=>i.statut==='nc_critique').length;
  const nc_maj  = IND.filter(i=>i.statut==='nc_majeure').length;
  if (nc_crit) RECS.push({cls:'r',m:`${nc_crit} NC critique(s) — traitement sous 24h`});
  if (nc_maj)  RECS.push({cls:'o',m:`${nc_maj} NC majeure(s) — planifier sous 72h`});
  const ret = ACTIONS.filter(a=>a.statut!=='cloturee'&&isRet(a.delai)).length;
  if (ret) RECS.push({cls:'o',m:`${ret} action(s) en retard — clôturer en priorité`});
  RECS.push({cls:'i',m:`Moteur de dérive : ${RV_LBLS[derive.k]} (${derive.v}/100) — priorité d'amélioration`});

  const RECS_STYLE = {r:{bg:'var(--crl)',bl:'var(--cr)',co:'var(--cr)'},o:{bg:'var(--cal)',bl:'var(--ca)',co:'var(--ca)'},i:{bg:'var(--c1l)',bl:'var(--c1)',co:'var(--c1)'}};
  document.getElementById('RECS-8D').innerHTML = RECS.map((r,i) => {
    const s = RECS_STYLE[r.cls];
    return `<div style="display:flex;gap:7px;padding:8px 10px;border-left:3px solid ${s.bl};background:${s.bg};color:${s.co};font-size:11px;margin-bottom:6px"><strong style="flex-shrink:0">${i+1}.</strong><span>${r.m}</span></div>`;
  }).join('');

  const hist = data.history || [];
  const feuMap = {rouge:'feu-r',orange:'feu-o',vert:'feu-v'};
  const feuDot = {rouge:'var(--cr)',orange:'var(--ca)',vert:'var(--cg)'};
  document.getElementById('DEC-HIST').innerHTML = hist.map(h =>
    `<tr>
      <td class="mono" style="font-size:11px">${h.date}</td>
      <td class="mono" style="font-weight:500">${h.score_8d}</td>
      <td class="mono">${h.indice}</td>
      <td class="mono">${h.risque}</td>
      <td><div class="feu ${feuMap[h.feu]||'feu-r'}"><div class="feu-dot" style="background:${feuDot[h.feu]||'var(--cr)'}"></div>${h.feu||'—'}</div></td>
      <td style="font-size:11px">${h.decision}</td>
      <td style="font-size:11px;color:var(--color-text-secondary)">${h.validateur||'—'}</td>
    </tr>`
  ).join('');
}

// ── REVUE 8D ─────────────────────────────────────────────────────
async function buildRevue() {
  const data = await api('GET', '/revue');
  if (data) RV_SCORES = data.scores || RV_SCORES;

  let sl = '';
  Object.keys(RV_POIDS).forEach(k => {
    const v = RV_SCORES[k] || 0;
    const col = v<55?'#A32D2D':v<70?'#BA7517':'#3B6D11';
    sl += `<div style="margin-bottom:11px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:11px">${RV_LBLS[k]}</span>
        <span id="RV-V-${k}" class="mono" style="font-size:12px;font-weight:500;color:${col}">${v}</span>
      </div>
      <div class="sl-wrap">
        <div class="sl-bg"></div>
        <div class="sl-fill" id="RV-F-${k}" style="width:${v}%;background:${col}"></div>
        <input type="range" min="0" max="100" value="${v}" id="RV-SL-${k}" oninput="updRvScore('${k}',this.value)">
      </div>
      <div style="font-size:9px;color:var(--color-text-tertiary);font-family:var(--font-mono)">Poids : ${Math.round(RV_POIDS[k]*100)}%</div>
    </div>`;
  });
  document.getElementById('REVUE-SLIDERS').innerHTML = sl;
  updateRvUI();
}

function calcRvScore() {
  return Math.round(Object.keys(RV_POIDS).reduce((s,k) => s + (RV_SCORES[k]||0) * RV_POIDS[k], 0) * 10) / 10;
}

function calcRvDecision() {
  const sc = calcRvScore();
  // Garde-fous non négociables
  const gf_risque = (RV_SCORES.risque || 100) < GF_SEUIL;
  const gf_arb    = (RV_SCORES.arb    || 100) < GF_SEUIL;
  if (gf_risque || gf_arb) {
    return {
      sc, feu: 'rouge',
      dec: 'ARBITRAGE DIRECTION',
      sub: gf_risque ? 'Garde-fou déclenché — Risque résiduel trop élevé' : 'Garde-fou déclenché — Trop d\'arbitrages immédiats ouverts',
      garde_fou: true
    };
  }
  if (sc >= SEUIL_VERT)   return {sc, feu:'vert',   dec:'MAINTIEN / GO',            sub:'Performance conforme aux objectifs', garde_fou:false};
  if (sc >= SEUIL_ORANGE) return {sc, feu:'orange',  dec:'PILOTAGE RENFORCÉ / GO',   sub:'Renforcer le pilotage — objectifs atteignables', garde_fou:false};
  if (sc >= SEUIL_ALERTE) return {sc, feu:'orange',  dec:'ALERTE — Plan d\'action renforcé requis', sub:'Seuil critique approché — mobilisation sous 48h', garde_fou:false};
  return                         {sc, feu:'rouge',   dec:'ARBITRAGE DIRECTION',      sub:'Score critique — Intervention direction requise', garde_fou:false};
}

function moteurDerive() {
  return Object.entries(RV_SCORES)
    .filter(([k]) => RV_POIDS[k] !== undefined)
    .reduce((a,[k,v]) => (v < a.v ? {k,v} : a), {k:'perf',v:101});
}

function updRvScore(k, v) {
  v = parseInt(v);
  RV_SCORES[k] = v;
  const col = v<55?'#A32D2D':v<70?'#BA7517':'#3B6D11';
  document.getElementById('RV-V-'+k).textContent = v;
  document.getElementById('RV-V-'+k).style.color = col;
  document.getElementById('RV-F-'+k).style.width = v + '%';
  document.getElementById('RV-F-'+k).style.background = col;
  updateRvUI();
}

function updateRvUI() {
  const d = calcRvDecision();
  const feuC = d.feu==='vert'?'var(--cg)':d.feu==='orange'?'var(--ca)':'var(--cr)';
  const feuBg = d.feu==='vert'?'var(--cgl)':d.feu==='orange'?'var(--cal)':'var(--crl)';
  const feuCls = {rouge:'feu-r',orange:'feu-o',vert:'feu-v'}[d.feu];

  document.getElementById('RV-SCORE').textContent = d.sc;
  document.getElementById('RV-SCORE').style.color = feuC;
  document.getElementById('RV-BOX').style.background = feuBg;
  ['RV-FEU','RV-FEU2'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `feu ${feuCls}`;
    el.innerHTML = `<div class="feu-dot" style="background:${feuC}"></div>${d.feu.toUpperCase()}`;
  });
  document.getElementById('TB-SCORE').textContent = `8D · ${d.sc}`;
  const decEl = document.getElementById('RV-DEC');
  if (decEl) { decEl.textContent = d.dec; decEl.style.color = feuC; }
  const card = document.getElementById('RV-DEC-CARD');
  if (card) { card.style.background = feuBg; card.style.borderColor = feuC; }
  renderRvComp(); renderRvRecs();
}

function renderRvComp() {
  const derive = moteurDerive();
  const h = Object.keys(RV_POIDS).map(k => {
    const v = RV_SCORES[k] || 0, col = v<55?'#A32D2D':v<70?'#BA7517':'#3B6D11';
    const isD = k === derive.k;
    return `<div class="comp-bar" style="${isD?'border:1px solid '+col+';border-radius:4px;padding:3px 5px':''}"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;color:var(--color-text-secondary)">${RV_LBLS[k]}${isD?' ⟵':''}</span><span class="mono" style="font-size:12px;font-weight:500;color:${col}">${v}</span></div><div class="comp-trk"><div class="comp-fill" style="width:${v}%;background:${col}"></div></div></div>`;
  }).join('');
  const el = document.getElementById('RV-COMP');
  if (el) el.innerHTML = h;
}

function renderRvRecs() {
  const d = calcRvDecision(), recs = [];
  if (d.garde_fou) {
    recs.push({bg:'var(--crl)',bl:'var(--cr)',co:'var(--cr)',m:`GARDE-FOU DÉCLENCHÉ — ${d.sub}`});
  } else if (d.sc < SEUIL_ALERTE) {
    recs.push({bg:'var(--crl)',bl:'var(--cr)',co:'var(--cr)',m:'ARBITRAGE DIRECTION — Présenter le plan de redressement immédiatement'});
  } else if (d.sc < SEUIL_ORANGE) {
    recs.push({bg:'var(--cal)',bl:'var(--ca)',co:'var(--ca)',m:'ALERTE — Mobiliser les responsables domaine sous 48h'});
  } else if (d.sc < SEUIL_VERT) {
    recs.push({bg:'var(--cal)',bl:'var(--ca)',co:'var(--ca)',m:'PILOTAGE RENFORCÉ — Suivi hebdomadaire systématique'});
  }
  const derive = moteurDerive();
  recs.push({bg:'var(--c1l)',bl:'var(--c1)',co:'var(--c1)',m:`Moteur de dérive : ${RV_LBLS[derive.k]} (${derive.v}/100) — action prioritaire`});
  const ret = ACTIONS.filter(a=>a.statut!=='cloturee'&&isRet(a.delai)).length;
  if (ret) recs.push({bg:'var(--cal)',bl:'var(--ca)',co:'var(--ca)',m:`${ret} action(s) en retard — clôturer avant la prochaine revue`});
  if ((RV_SCORES.cloture||0) < 80) recs.push({bg:'var(--cal)',bl:'var(--ca)',co:'var(--ca)',m:'Porter le taux de clôture ≥ 80% (cible méthodologique)'});
  recs.push({bg:'var(--c1l)',bl:'var(--c1)',co:'var(--c1)',m:'Prochaine revue hebdomadaire : Vendredi 16h00'});
  const el = document.getElementById('RV-RECS');
  if (el) el.innerHTML = recs.map((r,i) => `<div style="display:flex;gap:7px;padding:8px 10px;border-left:3px solid ${r.bl};background:${r.bg};color:${r.co};font-size:11px;margin-bottom:6px"><strong>${i+1}.</strong><span>${r.m}</span></div>`).join('');
}

async function validerRevue() {
  const d = calcRvDecision();
  const result = await api('POST', '/revue', {scores: RV_SCORES});
  if (!result) return;
  toast(`Revue Sem. ${weekNum()} validée — Score 8D : ${d.sc} · ${d.dec} ✓`); showSaved('Revue 8D enregistrée');
  goTo('decision', 'Matrice de décision 8D');
  loadDecision();
}

// ── UTILISATEURS ─────────────────────────────────────────────────
function renderUsers() {
  const sr = (document.getElementById('U-SRCH').value || '').toLowerCase();
  const rf = document.getElementById('U-ROLE').value;
  const sf = document.getElementById('U-STAT').value;
  const rows = USERS.filter(u => {
    if (sr && !(u.prenom+' '+u.nom+' '+u.email).toLowerCase().includes(sr)) return false;
    if (rf && u.role !== rf) return false;
    if (sf === 'actif' && !u.actif) return false;
    if (sf === 'inactif' && u.actif) return false;
    return true;
  });
  document.getElementById('U-CNT').textContent = rows.length + ' utilisateur' + (rows.length>1?'s':'');
  const h = rows.map(u => {
    const init = (u.prenom[0]||'') + (u.nom[0]||'');
    return `<tr style="${u.actif?'':'opacity:.55'}">
      <td><div style="display:flex;align-items:center;gap:9px"><div class="ava" style="width:30px;height:30px;background:${u.avatar_color};font-size:10px">${init}</div><div><div style="font-weight:500">${u.prenom} ${u.nom}</div></div></div></td>
      <td style="font-size:11px;color:var(--color-text-secondary)">${u.email}</td>
      <td>${bdg(RBDG[u.role]||'b-n',RLBL[u.role]||u.role)}</td>
      <td><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--color-text-secondary)" title="${u.domaine||''}">${u.domaine||'—'}</div></td>
      <td class="mono" style="font-size:11px">${u.derniere_cnx?u.derniere_cnx.slice(0,10).split('-').reverse().join('/'):'—'}</td>
      <td>${u.actif?bdg('b-ok','Actif'):bdg('b-n','Inactif')}</td>
      <td><div style="display:flex;gap:4px">
        <button class="btn btn-sm btn-icon" onclick="toggleUser('${u.id}')" title="${u.actif?'Désactiver':'Activer'}"><i class="ti ti-${u.actif?'user-off':'user-check'}"></i></button>
        <button class="btn btn-sm btn-icon" onclick="toast('Mot de passe réinitialisé : ${u.prenom} ${u.nom}')" title="Reset MDP"><i class="ti ti-key"></i></button>
        ${CURRENT_USER_ROLE === 'admin' ? `<button class="btn btn-sm btn-icon" onclick="deleteUser('${u.id}','${u.prenom} ${u.nom}')" title="Supprimer" style="color:var(--cr)"><i class="ti ti-trash"></i></button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
  document.getElementById('U-TBODY').innerHTML = h || '<tr><td colspan="7" style="text-align:center;color:var(--color-text-tertiary);padding:18px">Aucun utilisateur</td></tr>';
}

async function deleteUser(id, nom) {
  if (!await confirmModal(`Supprimer définitivement le compte de ${nom} ?`, 'Supprimer l\'utilisateur')) return;
  const result = await api('DELETE', `/users/${id}`);
  if (!result) return;
  if (result.error) { toast(result.error, 'danger'); return; }
  const users = await api('GET', '/users');
  if (users) { USERS = users; renderUsers(); }
  toast(`Compte supprimé : ${nom}`);
}

async function toggleUser(id) {
  const u = USERS.find(x => x.id === id);
  if (!u) return;
  const result = await api('PUT', `/users/${id}`, {actif: !u.actif});
  if (!result) return;
  const users = await api('GET', '/users');
  if (users) { USERS = users; renderUsers(); }
  toast((u.actif ? 'Compte désactivé' : 'Compte activé') + ' : ' + u.prenom + ' ' + u.nom);
}

function genPwd() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  let p = '';
  for (let i = 0; i < 10; i++) p += c[Math.floor(Math.random()*c.length)];
  document.getElementById('U-PWD').value = p;
}

async function submitUser() {
  const prenom = document.getElementById('U-PREN').value.trim();
  const nom = document.getElementById('U-NOM').value.trim();
  const email = document.getElementById('U-EMAIL').value.trim();
  const role = document.getElementById('U-ROLE-SEL').value;
  const password = document.getElementById('U-PWD').value;
  if (!prenom || !nom || !email || !role || !password || password.length < 8) {
    toast('Remplissez tous les champs (MDP min. 8 caractères)', 'danger'); return;
  }
  const result = await api('POST', '/users', {prenom, nom, email, role, password});
  if (!result) return;
  if (result.error) { toast(result.error, 'danger'); return; }
  closeModal('M-USER');
  document.getElementById('U-PREN').value = '';
  document.getElementById('U-NOM').value = '';
  document.getElementById('U-EMAIL').value = '';
  document.getElementById('U-PWD').value = '';
  const users = await api('GET', '/users');
  if (users) { USERS = users; renderUsers(); }
  toast('Utilisateur créé : ' + prenom + ' ' + nom + ' (' + (RLBL[role]||role) + ')');
}

// ── NOTIFICATIONS ────────────────────────────────────────────────
function renderNotifs() {
  const unread = NOTIFS.filter(n => !n.lue).length;
  const cntEl = document.getElementById('N-CNT');
  if (cntEl) cntEl.textContent = unread;
  const nbEl = document.getElementById('nb-notif');
  if (nbEl) { nbEl.textContent = unread; nbEl.style.display = unread > 0 ? '' : 'none'; }
  const delAllBtn = document.getElementById('BTN-DEL-ALL-NOTIFS');
  if (delAllBtn) delAllBtn.style.display = (CURRENT_USER_ROLE === 'admin' && NOTIFS.length) ? 'inline' : 'none';

  const h = NOTIFS.map(n =>
    `<div class="notif-item" style="background:${n.lue?'transparent':NBG[n.niveau]}" onclick="markRead(${n.id})">
      <div class="notif-dot" style="background:${n.lue?'var(--color-border-tertiary)':NDOT[n.niveau]}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:${n.lue?400:500};color:var(--color-text-primary);margin-bottom:1px">${n.titre}</div>
        <div style="font-size:11px;color:var(--color-text-secondary)">${n.message}</div>
        <div style="font-size:10px;color:var(--color-text-tertiary);margin-top:2px;font-family:var(--font-mono)">${n.time_label}</div>
      </div>
      ${n.lue?'':'<div style="width:6px;height:6px;border-radius:50%;background:'+NDOT[n.niveau]+';flex-shrink:0;margin-top:5px"></div>'}
      ${CURRENT_USER_ROLE==='admin'?`<button class="btn btn-sm btn-icon" onclick="event.stopPropagation();deleteNotif(${n.id})" title="Supprimer" style="color:var(--cr);flex-shrink:0"><i class="ti ti-trash"></i></button>`:''}
    </div>`
  ).join('');
  const el = document.getElementById('N-LIST');
  if (el) el.innerHTML = h || '<div style="padding:18px;text-align:center;color:var(--color-text-tertiary);font-size:12px">Aucune notification</div>';
}

async function markRead(id) {
  await api('PUT', `/notifications/${id}/read`);
  NOTIFS = NOTIFS.map(n => n.id === id ? {...n, lue:1} : n);
  renderNotifs();
}

async function markAllRead() {
  await api('PUT', '/notifications/read-all');
  NOTIFS = NOTIFS.map(n => ({...n, lue:1}));
  renderNotifs();
  toast('Toutes les notifications marquées comme lues');
}

async function deleteNotif(id) {
  const res = await api('DELETE', `/notifications/${id}`);
  if (!res || res.error) { toast(res?.error || 'Erreur', 'danger'); return; }
  NOTIFS = NOTIFS.filter(n => n.id !== id);
  renderNotifs();
}

async function deleteAllNotifs() {
  if (!confirm('Supprimer toutes les notifications ? Cette action est irréversible.')) return;
  const res = await api('DELETE', '/notifications');
  if (!res || res.error) { toast(res?.error || 'Erreur', 'danger'); return; }
  NOTIFS = [];
  renderNotifs();
  toast('Toutes les notifications supprimées');
}

async function deleteAction(id, libelle) {
  if (!await confirmModal(`Supprimer l'action ${id} — "${libelle}" ?`, 'Supprimer l\'action')) return;
  const res = await api('DELETE', `/actions/${id}`);
  if (!res || res.error) { toast(res?.error || 'Erreur', 'danger'); return; }
  ACTIONS = ACTIONS.filter(a => a.id !== id);
  renderAct();
  toast(`Action ${id} supprimée`);
}

async function deleteIncident(id) {
  if (!await confirmModal(`Supprimer définitivement l'incident ${id} ?`, 'Supprimer l\'incident')) return;
  const res = await api('DELETE', `/incidents/${id}`);
  if (!res || res.error) { toast(res?.error || 'Erreur', 'danger'); return; }
  INCIDENTS = INCIDENTS.filter(i => i.id !== id);
  renderInc();
  toast(`Incident ${id} supprimé`);
}

// ── PARAMÈTRES — ONGLETS ─────────────────────────────────────────
function switchParamTab(tab) {
  const isAdmin = tab === 'admin';
  document.getElementById('TAB-ADMIN').style.display  = isAdmin ? '' : 'none';
  document.getElementById('TAB-PROFIL').style.display = isAdmin ? 'none' : '';
  const btnAdmin  = document.getElementById('TAB-BTN-ADMIN');
  const btnProfil = document.getElementById('TAB-BTN-PROFIL');
  btnAdmin.style.background  = isAdmin ? 'var(--color-background-primary)' : 'transparent';
  btnAdmin.style.color       = isAdmin ? 'var(--color-text-primary)' : 'var(--color-text-secondary)';
  btnAdmin.style.boxShadow   = isAdmin ? '0 1px 3px rgba(0,0,0,.08)' : 'none';
  btnProfil.style.background = isAdmin ? 'transparent' : 'var(--color-background-primary)';
  btnProfil.style.color      = isAdmin ? 'var(--color-text-secondary)' : 'var(--color-text-primary)';
  btnProfil.style.boxShadow  = isAdmin ? 'none' : '0 1px 3px rgba(0,0,0,.08)';
}

async function savePassword() {
  const old_password     = document.getElementById('PWD-OLD').value;
  const new_password     = document.getElementById('PWD-NEW').value;
  const confirm_password = document.getElementById('PWD-CFM').value;
  const msgEl = document.getElementById('PWD-MSG');

  const showMsg = (txt, ok) => {
    msgEl.textContent = txt;
    msgEl.style.display = 'block';
    msgEl.style.background = ok ? 'var(--cgl)' : 'var(--crl)';
    msgEl.style.color = ok ? 'var(--cg)' : 'var(--cr)';
    msgEl.style.borderLeft = `3px solid ${ok ? 'var(--cg)' : 'var(--cr)'}`;
  };

  if (!old_password || !new_password || !confirm_password) { showMsg('Tous les champs sont obligatoires.', false); return; }
  if (new_password !== confirm_password) { showMsg('Les mots de passe ne correspondent pas.', false); return; }
  if (new_password.length < 8) { showMsg('Le nouveau mot de passe doit faire au moins 8 caractères.', false); return; }

  const res = await fetch('/api/me', {
    method: 'PUT', credentials: 'same-origin',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({old_password, new_password, confirm_password})
  });
  const d = await res.json();
  if (!res.ok || d.error) { showMsg(d.error || 'Erreur serveur', false); return; }
  showMsg('Mot de passe mis à jour avec succès.', true);
  document.getElementById('PWD-OLD').value = '';
  document.getElementById('PWD-NEW').value = '';
  document.getElementById('PWD-CFM').value = '';
  showSaved('Mot de passe mis à jour');
}

// ── PARAMÈTRES ───────────────────────────────────────────────────
function initParams() {
  const scores = [{l:'Conforme',id:'PS-conf',v:'1.00'},{l:'NC mineure',id:'PS-min',v:'0.75'},{l:'NC majeure',id:'PS-maj',v:'0.50'},{l:'NC critique',id:'PS-crit',v:'0.00'}];
  document.getElementById('P-SCORES').innerHTML = scores.map(s =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="flex:1;font-size:12px;color:var(--color-text-secondary)">${s.l}</span><input type="number" id="${s.id}" value="${s.v}" step="0.01" style="width:68px;height:29px;font-size:12px;padding:0 7px;border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);background:var(--color-background-primary);color:var(--color-text-primary)"></div>`
  ).join('');
  const poids = [{l:'Performance',id:'PW1',v:25},{l:'Risque (inv.)',id:'PW2',v:20},{l:'Criticité',id:'PW3',v:15},{l:'Taux clôture',id:'PW4',v:15},{l:'Arbitrage imm.',id:'PW5',v:10},{l:'Stock prioritaire',id:'PW6',v:10},{l:'Revue ≤7j',id:'PW7',v:5}];
  document.getElementById('P-POIDS').innerHTML = poids.map(p =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="flex:1;font-size:12px;color:var(--color-text-secondary)">${p.l}</span><input type="number" id="${p.id}" value="${p.v}" onchange="checkPoids()" style="width:58px;height:29px;font-size:12px;padding:0 7px;border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);background:var(--color-background-primary);color:var(--color-text-primary)"><span style="font-size:10px;color:var(--color-text-tertiary)">%</span></div>`
  ).join('');

  // Static alert rules
  const RULES = [{niv:'danger',l:'NC critique bloquante',c:'email · inapp · webhook',cr:'immédiat'},{niv:'danger',l:'Incident grave',c:'email · inapp · webhook',cr:'immédiat'},{niv:'warning',l:'Actions en retard',c:'email · inapp',cr:'0 8 * * *'},{niv:'warning',l:'Score 8D sous seuil',c:'email · inapp',cr:'0 8,17 * * *'},{niv:'info',l:'Revue hebdomadaire',c:'email',cr:'0 16 * * 5'}];
  const NBBDG = {danger:'b-r',warning:'b-w',info:'b-i'};
  const rl = document.getElementById('RULES-LIST');
  if (rl) rl.innerHTML = RULES.map(r =>
    `<div style="display:flex;align-items:center;gap:8px;padding:8px 13px;border-bottom:0.5px solid var(--color-border-tertiary)">${bdg(NBBDG[r.niv],r.niv)}<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500">${r.l}</div><div style="font-size:10px;color:var(--color-text-secondary)">${r.c} · <span class="mono">${r.cr}</span></div></div></div>`
  ).join('');

  const JOBS = [
    {id:'retard',    n:'Actions en retard',   cr:'0 8 * * *',    s:'ok'},
    {id:'score8d',   n:'Score 8D (×2/j)',      cr:'0 8,17 * * *', s:'alerte'},
    {id:'revue_hebdo',n:'Revue hebdo',         cr:'0 16 * * 5',   s:'ok'},
    {id:'cloture',   n:'Taux clôture',         cr:'0 8 * * 1',    s:'warning'},
    {id:'echeances', n:'Rappels échéances',    cr:'0 9 * * *',    s:'ok'},
  ];
  const JST = {ok:'b-ok',alerte:'b-r',warning:'b-w'}; const JSL={ok:'OK',alerte:'Alerte',warning:'Avert.'};
  const jl = document.getElementById('JOBS-LIST');
  if (jl) jl.innerHTML = JOBS.map(j =>
    `<tr><td style="font-size:12px;font-weight:500">${j.n}</td><td class="mono" style="font-size:10px">${j.cr}</td><td>${bdg(JST[j.s],JSL[j.s])}</td><td><button class="btn btn-sm btn-icon" id="JOB-BTN-${j.id}" onclick="runJob('${j.id}',this)" title="Déclencher"><i class="ti ti-player-play"></i></button></td></tr>`
  ).join('');

  // Restreindre la modification aux admins
  const isAdmin = CURRENT_USER_ROLE === 'admin';
  const lockBanner = document.getElementById('P-LOCK');
  const actionsDiv = document.getElementById('P-ACTIONS');
  if (lockBanner) lockBanner.style.display = isAdmin ? 'none' : 'flex';
  if (actionsDiv) actionsDiv.style.display = isAdmin ? 'flex' : 'none';
  document.querySelectorAll('#pg-parametres input, #pg-parametres select').forEach(el => {
    el.disabled = !isAdmin;
    if (!isAdmin) el.style.opacity = '0.6';
  });
}

async function runJob(jobId, btn) {
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>';
  const result = await api('POST', `/jobs/${jobId}`);
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-player-play"></i>';
  if (!result) return;
  if (result.error) { toast(result.error, 'danger'); return; }
  toast(result.message);
  const notifs = await api('GET', '/notifications');
  if (notifs) { NOTIFS = notifs; renderNotifs(); }
}

function checkPoids() {
  const tot = ['PW1','PW2','PW3','PW4','PW5','PW6','PW7'].reduce((s,id) => s+(parseInt(document.getElementById(id).value)||0), 0);
  const el = document.getElementById('P-CHECK');
  if (tot === 100) {
    el.style.cssText = 'margin-top:10px;padding:7px 10px;background:var(--cgl);border-left:3px solid var(--cg);font-size:11px;color:var(--cg)';
    el.textContent = 'Total poids : 100% ✓';
  } else {
    el.style.cssText = 'margin-top:10px;padding:7px 10px;background:var(--crl);border-left:3px solid var(--cr);font-size:11px;color:var(--cr)';
    el.textContent = `Total poids : ${tot}% — doit être 100%`;
  }
}

function recalcParams() {
  const sv = parseFloat(document.getElementById('P-SV').value)||85;
  const so = parseFloat(document.getElementById('P-SO').value)||70;
  const feu = 78.4>=sv?'VERT':78.4>=so?'ORANGE':'ROUGE';
  document.getElementById('P-FEU').textContent = feu;
}

async function saveParams() {
  const tot = ['PW1','PW2','PW3','PW4','PW5','PW6','PW7'].reduce((s,id) => s+(parseInt(document.getElementById(id).value)||0), 0);
  if (tot !== 100) { toast('La somme des poids doit être 100%', 'danger'); return; }
  const result = await api('PUT', '/settings', {
    seuils: {vert:parseFloat(document.getElementById('P-SV').value)||85, orange:parseFloat(document.getElementById('P-SO').value)||70},
    poids_8d: {
      perf:parseInt(document.getElementById('PW1').value),
      risque:parseInt(document.getElementById('PW2').value),
      crit:parseInt(document.getElementById('PW3').value),
      cloture:parseInt(document.getElementById('PW4').value),
      arb:parseInt(document.getElementById('PW5').value),
      stock_prio:parseInt(document.getElementById('PW6').value),
      revue7j:parseInt(document.getElementById('PW7').value),
    },
    baremes: {conforme:parseFloat(document.getElementById('PS-conf').value),nc_mineure:parseFloat(document.getElementById('PS-min').value),nc_majeure:parseFloat(document.getElementById('PS-maj').value),nc_critique:parseFloat(document.getElementById('PS-crit').value)},
  });
  if (result && result.ok) toast('Paramètres enregistrés avec succès ✓');
}

function resetParams() {
  ['PW1','PW2','PW3','PW4','PW5','PW6','PW7'].forEach((id,i) => {
    document.getElementById(id).value = [25,20,15,15,10,10,5][i];
  });
  checkPoids();
  toast('Paramètres réinitialisés');
}

// ── FICHE ACTION ─────────────────────────────────────────────────
let ficheActId = null;

async function openFicheAction(id) {
  const data = await api('GET', `/actions/${id}`);
  if (!data) return;
  ficheActId = id;
  const a = data.action;
  const reviews = data.reviews || [];

  const pCol = {critique:'#A32D2D',majeure:'#854F0B',mineure:'#BA7517'};
  const pBdg = {critique:'b-r',majeure:'b-a',mineure:'b-w'};
  const col = DC[a.domaine] || '#6b7591';
  const pct = a.avancement || 0;
  const barcol = pct < 40 ? '#A32D2D' : pct < 70 ? '#BA7517' : '#3B6D11';

  document.getElementById('FA-ID').textContent = id;
  document.getElementById('FA-LIB').textContent = a.libelle || '—';
  document.getElementById('FA-RESP').textContent = a.responsable || '—';
  document.getElementById('FA-DELAI').textContent = fmtD(a.delai);
  document.getElementById('FA-DATE').textContent = fmtD(a.date_creation);
  document.getElementById('FA-SRC').textContent = a.source_id || '—';
  document.getElementById('FA-AV-NUM').textContent = pct + '%';
  document.getElementById('FA-AV-NUM').style.color = barcol;
  document.getElementById('FA-AV-BAR').style.width = pct + '%';
  document.getElementById('FA-AV-BAR').style.background = barcol;
  document.getElementById('FA-PRIO-BDG').innerHTML = bdg(pBdg[a.priorite]||'b-n', a.priorite||'—');
  document.getElementById('FA-DOM-BDG').innerHTML = `<span style="padding:1px 6px;border-radius:3px;background:${col}18;color:${col};font-size:9px;font-weight:500;font-family:var(--font-mono)">${a.domaine}</span>`;
  document.getElementById('FA-STATUT-BDG').innerHTML = bdg(AST[a.statut]||'b-n', ASL[a.statut]||a.statut);

  document.getElementById('FA-AV-SL').value = pct;
  document.getElementById('FA-AV-SL-V').textContent = pct + '%';
  document.getElementById('FA-ST-SEL').value = a.statut || 'ouverte';
  document.getElementById('FA-NEXT-REV').value = a.prochaine_revue || '';
  document.getElementById('FA-CMT').value = '';

  document.getElementById('FA-RCNT').textContent = reviews.length + ' revue(s)';
  document.getElementById('FA-REVIEWS').innerHTML = reviews.length
    ? reviews.map(r => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 13px;border-bottom:0.5px solid var(--color-border-tertiary)">
          <div style="flex-shrink:0;min-width:80px">
            <div class="mono" style="font-size:11px;font-weight:500">${fmtD(r.date)}</div>
            ${bdg(AST[r.statut]||'b-n',ASL[r.statut]||r.statut)}
          </div>
          <div style="flex:1;min-width:0">
            ${r.commentaire ? `<div style="font-size:11px;color:var(--color-text-secondary)">${r.commentaire}</div>` : ''}
            <div style="font-size:10px;color:var(--color-text-tertiary);margin-top:2px">${r.reviewer} · ${r.avancement}%</div>
          </div>
          <span class="mono" style="font-size:12px;font-weight:500;color:${r.avancement<40?'#A32D2D':r.avancement<70?'#BA7517':'#3B6D11'}">${r.avancement}%</span>
        </div>`).join('')
    : '<div style="padding:14px 13px;font-size:12px;color:var(--color-text-tertiary)">Aucune revue enregistrée</div>';

  goTo('fiche-action', `Fiche action — ${id}`);
}

async function saveActionRevue() {
  if (!ficheActId) return;
  const avancement = parseInt(document.getElementById('FA-AV-SL').value);
  const statut = document.getElementById('FA-ST-SEL').value;
  const prochaine_revue = document.getElementById('FA-NEXT-REV').value;
  const commentaire_pilote = document.getElementById('FA-CMT').value.trim();
  const result = await api('POST', `/actions/${ficheActId}/revue`, {
    avancement, statut, prochaine_revue, commentaire_pilote,
    commentaire: commentaire_pilote,
  });
  if (!result) return;
  toast(`Revue enregistrée : ${ficheActId} — ${avancement}% · ${ASL[statut]||statut}`);
  const acts = await api('GET', '/actions');
  if (acts) { ACTIONS = acts; renderAct(); }
  await openFicheAction(ficheActId);
}

// ── FICHE INCIDENT ───────────────────────────────────────────────
let ficheIncId = null;

async function openFicheIncident(id) {
  const data = await api('GET', `/incidents/${id}`);
  if (!data || !data.incident) return;
  ficheIncId = id;
  const inc = data.incident;

  document.getElementById('FI-ID').textContent = id;
  document.getElementById('FI-DESC').textContent = inc.description || '—';
  document.getElementById('FI-DATE').textContent = fmtD(inc.date);
  document.getElementById('FI-ZONE').textContent = inc.zone || '—';
  document.getElementById('FI-TYPE').textContent = inc.type || '—';
  document.getElementById('FI-JA').textContent = inc.jours_arret > 0 ? inc.jours_arret + ' j.' : '0';
  document.getElementById('FI-RESP').textContent = inc.responsable || '—';
  document.getElementById('FI-GRAV-BDG').innerHTML = bdg(GRC[inc.gravite]||'b-n', GRL[inc.gravite]||inc.gravite);
  document.getElementById('FI-STATUT-BDG').innerHTML = bdg(IST[inc.statut]||'b-n', ISL[inc.statut]||inc.statut);

  document.getElementById('FI-CAUSE-INP').value = inc.cause || '';
  document.getElementById('FI-AI-INP').value = inc.action_immediate || '';
  document.getElementById('FI-ST-SEL').value = inc.statut || 'ouvert';

  // Closure block
  const isClo = inc.statut === 'cloture';
  document.getElementById('FI-CLOTURE-BLOCK').style.display = isClo ? '' : 'none';
  if (inc.date_cloture) document.getElementById('FI-CLO-DATE').value = inc.date_cloture;
  else document.getElementById('FI-CLO-DATE').value = new Date().toISOString().slice(0,10);
  document.getElementById('FI-CLO-PAR').value = inc.cloture_par || '';

  const gravCol = {grave:'#A32D2D',modere:'#854F0B',mineur:'#3B6D11'}[inc.gravite]||'#6b7591';
  const tfEst = inc.jours_arret > 0 ? '> 0' : '0';
  document.getElementById('FI-CALC').innerHTML = [
    {l:'Gravité', v:GRL[inc.gravite]||inc.gravite, c:gravCol},
    {l:'Jours arrêt travail', v:inc.jours_arret > 0 ? inc.jours_arret+' jour(s)' : 'Sans arrêt', c:inc.jours_arret>0?'#A32D2D':'#3B6D11'},
    {l:'Impact TF estimé', v:inc.jours_arret>0?'Accident avec arrêt':'Accident sans arrêt', c:'var(--color-text-primary)'},
    {l:'Statut investigation', v:ISL[inc.statut]||inc.statut, c:'var(--color-text-primary)'},
  ].map(x => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--color-background-secondary);border-radius:var(--border-radius-md)">
      <span style="font-size:11px;color:var(--color-text-secondary)">${x.l}</span>
      <span style="font-size:12px;font-weight:500;color:${x.c}">${x.v}</span>
    </div>`).join('');

  // Photos
  let incPhotos = [];
  try { incPhotos = JSON.parse(inc.photos || '[]'); } catch(e) {}
  const photosCard = document.getElementById('FI-PHOTOS-CARD');
  const photosEl   = document.getElementById('FI-PHOTOS');
  if (incPhotos.length && photosCard && photosEl) {
    photosCard.style.display = '';
    photosEl.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px">${
      incPhotos.map(u => `<img src="${u}" onclick="openLightbox('${u}')"
        style="width:90px;height:90px;border-radius:8px;object-fit:cover;cursor:pointer;border:1px solid var(--color-border-tertiary)">`).join('')
    }</div>`;
  } else if (photosCard) {
    photosCard.style.display = 'none';
  }

  goTo('fiche-incident', `Fiche incident — ${id}`);
}

function toggleCloBlock(val) {
  document.getElementById('FI-CLOTURE-BLOCK').style.display = val === 'cloture' ? '' : 'none';
  if (val === 'cloture') {
    const d = document.getElementById('FI-CLO-DATE');
    if (!d.value) d.value = new Date().toISOString().slice(0,10);
  }
}

async function saveIncidentUpdate() {
  if (!ficheIncId) return;
  const cause = document.getElementById('FI-CAUSE-INP').value.trim();
  const action_immediate = document.getElementById('FI-AI-INP').value.trim();
  const statut = document.getElementById('FI-ST-SEL').value;
  const payload = {cause, action_immediate, statut};
  if (statut === 'cloture') {
    payload.date_cloture = document.getElementById('FI-CLO-DATE').value;
    payload.cloture_par = document.getElementById('FI-CLO-PAR').value.trim();
  }
  const result = await api('PUT', `/incidents/${ficheIncId}`, payload);
  if (!result) return;
  toast(`Incident ${ficheIncId} mis à jour — ${ISL[statut]||statut}`);
  const incs = await api('GET', '/incidents');
  if (incs) { INCIDENTS = incs; renderInc(); }
  await openFicheIncident(ficheIncId);
}

// ── HISTORIQUE EXPORTS ───────────────────────────────────────────
function renderReportHistory() {
  const tbody = document.getElementById('RPT-HIST');
  const cnt   = document.getElementById('RPT-CNT');
  if (!tbody) return;
  if (!RPT_HIST.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:22px;color:var(--color-text-tertiary)">Aucun export pour le moment</td></tr>';
    if (cnt) cnt.textContent = '—';
    return;
  }
  if (cnt) cnt.textContent = RPT_HIST.length + ' export' + (RPT_HIST.length > 1 ? 's' : '');
  const FILTRE_TYPE = {filtre_nc:'nc_critiques', filtre_act:'actions_retard', filtre_inc:'incidents_ouverts'};
  const fmtBadge = t => {
    if (t === 'pdf')      return '<span class="b b-r"><i class="ti ti-file-type-pdf" style="font-size:10px"></i> PDF</span>';
    if (t === 'xlsx')     return '<span class="b b-ok"><i class="ti ti-table" style="font-size:10px"></i> Excel</span>';
    if (t === 'filtre_nc')  return '<span class="b b-r"><i class="ti ti-alert-octagon" style="font-size:10px"></i> NC</span>';
    if (t === 'filtre_act') return '<span class="b b-a"><i class="ti ti-clock-exclamation" style="font-size:10px"></i> Retard</span>';
    if (t === 'filtre_inc') return '<span class="b b-i"><i class="ti ti-alert-triangle" style="font-size:10px"></i> Incidents</span>';
    return `<span class="b b-n">${t}</span>`;
  };
  const fmtRegenBtn = r => {
    if (r.type === 'pdf' || r.type === 'xlsx')
      return `<button class="btn btn-sm btn-icon" onclick="genRapport('${r.type}')" title="Regénérer"><i class="ti ti-download"></i></button>`;
    if (FILTRE_TYPE[r.type])
      return `<button class="btn btn-sm btn-icon" onclick="exportFiltered('${FILTRE_TYPE[r.type]}')" title="Regénérer"><i class="ti ti-download"></i></button>`;
    return '';
  };
  tbody.innerHTML = RPT_HIST.map(r => {
    const dt = r.generated_at ? r.generated_at.replace('T',' ').slice(0,16) : '—';
    const delBtn = CURRENT_USER_ROLE === 'admin'
      ? `<button class="btn btn-sm btn-icon" onclick="deleteReportEntry(${r.id})" title="Supprimer" style="color:var(--cr)"><i class="ti ti-trash"></i></button>`
      : '';
    return `<tr>
      <td style="font-weight:500">${r.label}</td>
      <td class="mono" style="font-size:11px;color:var(--color-text-secondary)">${r.filename}</td>
      <td>${r.generated_by}</td>
      <td class="mono" style="font-size:11px">${dt}</td>
      <td>${fmtBadge(r.type)}</td>
      <td style="display:flex;gap:4px">
        ${fmtRegenBtn(r)}
        ${delBtn}
      </td>
    </tr>`;
  }).join('');
}

async function deleteReportEntry(id) {
  if (!confirm('Supprimer cette entrée de l\'historique ?')) return;
  const res = await api('DELETE', `/report_history/${id}`);
  if (!res || res.error) { toast(res?.error || 'Erreur', 'danger'); return; }
  RPT_HIST = RPT_HIST.filter(r => r.id !== id);
  renderReportHistory();
  toast('Entrée supprimée');
}

// ── REPORTING ────────────────────────────────────────────────────
async function genRapport(type) {
  const btnId = type === 'pdf' ? 'BTN-PDF' : 'BTN-XLSX';
  const icId  = type === 'pdf' ? 'IC-PDF'  : 'IC-XLSX';
  const btn = document.getElementById(btnId);
  const ic  = document.getElementById(icId);
  if (btn) btn.disabled = true;
  if (ic)  ic.style.display = 'inline-block';
  toast('Génération en cours…');
  try {
    const res = await fetch(`/api/rapport/${type}`, {credentials: 'same-origin'});
    if (!res.ok) { toast('Erreur lors de la génération', 'danger'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const cd   = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    a.href     = url;
    a.download = match ? match[1] : `QSSE-Wx_Rapport.${type}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`${type.toUpperCase()} téléchargé : ${a.download} ✓`);
    const hist = await api('GET', '/report_history');
    if (hist) { RPT_HIST = hist; renderReportHistory(); }
  } catch(e) {
    toast('Erreur : ' + e.message, 'danger');
  } finally {
    if (btn) btn.disabled = false;
    if (ic)  ic.style.display = 'none';
  }
}

// ── IMAGE WIDGET ──────────────────────────────────────────────────

const IMG_STATE = {};

function initImgWidget(containerId, stateKey) {
  IMG_STATE[stateKey] = [];
  _renderImgWidget(containerId, stateKey);
}

function _renderImgWidget(containerId, stateKey) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const urls = IMG_STATE[stateKey] || [];
  const thumbsHtml = urls.map((u, i) => `
    <div style="position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:1px solid var(--color-border-tertiary);flex-shrink:0;cursor:pointer" onclick="openLightbox('${u}')">
      <img src="${u}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
      <button onclick="event.stopPropagation();_removeImg('${containerId}','${stateKey}',${i})"
        style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.72);border:none;color:#fff;cursor:pointer;font-size:12px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center">×</button>
    </div>`).join('');
  el.innerHTML = `
    <input type="file" id="${stateKey}-finput" accept="image/*" multiple style="display:none" onchange="_handleImgSelect('${containerId}','${stateKey}',this)">
    ${urls.length ? `<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:9px">${thumbsHtml}</div>` : ''}
    <button class="btn btn-sm" type="button"
      onclick="document.getElementById('${stateKey}-finput').click()"
      style="border-style:dashed;color:var(--color-text-secondary);width:100%;justify-content:center;padding:8px">
      <i class="ti ti-camera-plus"></i>
      ${urls.length ? `Ajouter d'autres photos (${urls.length} sélectionnée${urls.length>1?'s':''})` : 'Ajouter des photos'}
    </button>`;
}

async function _handleImgSelect(containerId, stateKey, input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  const btn = document.querySelector(`#${containerId} button`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Envoi en cours…'; }
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) { toast(`${file.name} trop lourd (max 10 Mo)`, 'danger'); continue; }
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/upload/media', {method:'POST', body:fd, credentials:'same-origin'});
      const data = await res.json();
      if (data.ok) { (IMG_STATE[stateKey] = IMG_STATE[stateKey] || []).push(data.url); }
      else toast(data.error || 'Erreur upload', 'danger');
    } catch(e) { toast('Erreur réseau', 'danger'); }
  }
  input.value = '';
  _renderImgWidget(containerId, stateKey);
}

function _removeImg(containerId, stateKey, idx) {
  if (IMG_STATE[stateKey]) { IMG_STATE[stateKey].splice(idx, 1); _renderImgWidget(containerId, stateKey); }
}

// Lightbox
function openLightbox(url) {
  let lb = document.getElementById('LIGHTBOX');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'LIGHTBOX';
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;backdrop-filter:blur(4px)';
    lb.onclick = () => lb.remove();
    lb.innerHTML = '<img id="LB-IMG" style="max-width:92vw;max-height:88vh;border-radius:10px;box-shadow:0 24px 64px rgba(0,0,0,.6);object-fit:contain"><button style="position:absolute;top:18px;right:18px;background:rgba(255,255,255,.12);border:none;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center" onclick="document.getElementById(\'LIGHTBOX\').remove()">×</button>';
    document.body.appendChild(lb);
  }
  document.getElementById('LB-IMG').src = url;
}

function _photoGallery(photos) {
  if (!photos || !photos.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${
    photos.map(u => `<img src="${u}" onclick="openLightbox('${u}')"
      style="width:52px;height:52px;border-radius:6px;object-fit:cover;cursor:pointer;border:1px solid var(--color-border-tertiary);transition:transform .12s"
      onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform=''">`).join('')
  }</div>`;
}

// ── STATUS BAR & ANIMATIONS ───────────────────────────────────────

function updateStatusBar(feu) {
  const bar = document.getElementById('STATUS-BAR');
  if (!bar) return;
  bar.className = feu || 'vert';
}

function animateCounter(el, target, duration) {
  if (!el) return;
  const start = performance.now();
  const from  = 0;
  const isFloat = String(target).includes('.');
  function step(now) {
    const p = Math.min((now - start) / (duration || 700), 1);
    const ease = 1 - Math.pow(1 - p, 3);
    const val = from + (target - from) * ease;
    el.textContent = isFloat ? val.toFixed(1) : Math.round(val);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = isFloat ? target.toFixed(1) : target;
  }
  requestAnimationFrame(step);
}

function animateKpis() {
  document.querySelectorAll('.kpi-v[data-val]').forEach((el, i) => {
    const v = parseFloat(el.dataset.val);
    if (!isNaN(v)) setTimeout(() => animateCounter(el, v, 650), i * 60);
  });
}

function sparkline(values, color) {
  if (!values || values.length < 2) return '';
  const W = 80, H = 28, pad = 2;
  const mn = Math.min(...values), mx = Math.max(...values);
  const range = mx - mn || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - mn) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = values[values.length - 1], prev = values[values.length - 2];
  const trend = last >= prev ? '↑' : '↓';
  const trendC = last >= prev ? 'var(--cg)' : 'var(--cr)';
  return `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="flex-shrink:0">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>
      <circle cx="${pts.split(' ').pop().split(',')[0]}" cy="${pts.split(' ').pop().split(',')[1]}" r="2.5" fill="${color}"/>
    </svg>
    <span style="font-size:10px;color:${trendC};font-weight:700">${trend}</span>
  </div>`;
}

function buildScoreRing(containerId, score, feu) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const r = 38, cx = 44, cy = 44, circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const offset = circ * (1 - pct);
  const color = feu === 'vert' ? '#16A34A' : feu === 'orange' ? '#D97706' : '#DC2626';
  el.innerHTML = `
    <div class="score-ring-wrap" style="width:88px;height:88px">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle class="score-ring-track" cx="${cx}" cy="${cy}" r="${r}"
          stroke="var(--color-background-tertiary)" stroke-width="7"/>
        <circle class="score-ring-fill" cx="${cx}" cy="${cy}" r="${r}"
          stroke="${color}" stroke-width="7"
          stroke-dasharray="${circ}"
          stroke-dashoffset="${circ}"
          id="${containerId}-arc"/>
      </svg>
      <div class="score-ring-label">
        <span style="font-size:22px;font-weight:800;color:${color};letter-spacing:-.04em;font-family:var(--font-mono)">${score}</span>
        <span style="font-size:9px;color:var(--color-text-tertiary);font-weight:600;letter-spacing:.05em;text-transform:uppercase">score</span>
      </div>
    </div>`;
  requestAnimationFrame(() => {
    setTimeout(() => {
      const arc = document.getElementById(`${containerId}-arc`);
      if (arc) arc.style.strokeDashoffset = offset;
    }, 80);
  });
}

// ── PHOTO UPLOAD ──────────────────────────────────────────────────

async function uploadAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Fichier trop lourd (max 5 Mo)', 'danger'); return; }
  const fd = new FormData();
  fd.append('file', file);
  toast('Envoi de la photo…');
  try {
    const res = await fetch('/api/upload/avatar', {method:'POST', body:fd, credentials:'same-origin'});
    const data = await res.json();
    if (!res.ok || !data.ok) { toast(data.error || 'Erreur upload', 'danger'); return; }
    // Update all avatar elements in the page
    const url = data.url + '?t=' + Date.now();
    _setAvatarImg(url);
    toast('Photo de profil mise à jour ✓');
  } catch(e) {
    toast('Erreur : ' + e.message, 'danger');
  }
  input.value = '';
}

function _setAvatarImg(url) {
  // Topbar button
  const avaBtn = document.getElementById('AVA-BTN');
  if (avaBtn) {
    if (avaBtn.tagName === 'IMG') {
      avaBtn.src = url;
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.id = 'AVA-BTN';
      img.style.cssText = 'width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:pointer;border:1.5px solid var(--color-border-secondary)';
      img.onclick = toggleProfile;
      img.title = 'Mon profil';
      avaBtn.replaceWith(img);
    }
  }
  // Profile dropdown large avatar
  const pImg = document.getElementById('PRF-AVA-IMG');
  const pTxt = document.getElementById('PRF-AVA-TXT');
  if (pImg) { pImg.src = url; }
  else if (pTxt) {
    const img = document.createElement('img');
    img.id = 'PRF-AVA-IMG';
    img.src = url;
    img.style.cssText = 'width:40px;height:40px;border-radius:50%;object-fit:cover;border:1.5px solid var(--color-border-secondary);display:block';
    pTxt.replaceWith(img);
  }
  // Sidebar footer
  const sbImg = document.getElementById('SB-AVA-IMG');
  const sbTxt = document.getElementById('SB-AVA-TXT');
  if (sbImg) { sbImg.src = url; }
  else if (sbTxt) {
    const img = document.createElement('img');
    img.id = 'SB-AVA-IMG';
    img.src = url;
    img.style.cssText = 'width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid rgba(255,255,255,.15)';
    sbTxt.replaceWith(img);
  }
  // Paramètres panel
  const pw = document.getElementById('P-AVA-WRAP');
  if (pw) {
    pw.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover';
    pw.appendChild(img);
  }
}

// ── Carousel photos chantier ──────────────────────────────────────────────────
let _sitePhotos  = [];
let _carouselIdx = 0;
let _carouselTimer = null;

async function loadSitePhotos() {
  const data = await api('GET', '/site-photos');
  if (data) {
    _sitePhotos = data.urls || [];
    _carouselIdx = 0;
    renderDashCarousel();
    renderSitePhotosGrid();
  }
}

function renderDashCarousel() {
  const card = document.getElementById('DASH-SITE-CARD');
  const ph   = document.getElementById('DASH-SITE-PH');
  const ov   = document.getElementById('DASH-SITE-OV');
  const prev = document.getElementById('DASH-PREV');
  const next = document.getElementById('DASH-NEXT');
  const dots = document.getElementById('DASH-DOTS');
  const ctr  = document.getElementById('DASH-CTR');
  if (!card) return;

  // Remove old slides
  card.querySelectorAll('.dash-slide').forEach(s => s.remove());
  if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }

  if (!_sitePhotos.length) {
    ph.style.display  = 'flex';
    ov.style.display  = 'none';
    if (prev) prev.style.display = 'none';
    if (next) next.style.display = 'none';
    if (dots) dots.innerHTML = '';
    if (ctr)  ctr.style.display = 'none';
    return;
  }

  ph.style.display = 'none';
  ov.style.display = 'flex';

  const ts = Date.now();
  _sitePhotos.forEach((url, i) => {
    const img = document.createElement('img');
    img.src = url + '?t=' + ts;
    img.className = 'dash-slide';
    img.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:${i === _carouselIdx ? 1 : 0};transition:opacity .6s ease;z-index:0`;
    card.insertBefore(img, ph);
  });

  const multi = _sitePhotos.length > 1;
  if (prev) prev.style.display = multi ? '' : 'none';
  if (next) next.style.display = multi ? '' : 'none';

  if (dots) _renderDots();
  if (ctr) {
    if (multi) { ctr.textContent = `${_carouselIdx + 1}/${_sitePhotos.length}`; ctr.style.display = ''; }
    else ctr.style.display = 'none';
  }

  const dateEl = document.getElementById('DASH-SITE-DATE');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('fr-FR', {day:'2-digit', month:'long', year:'numeric'});

  if (multi) _startCarouselTimer();
}

function _renderDots() {
  const dots = document.getElementById('DASH-DOTS');
  if (!dots) return;
  dots.innerHTML = _sitePhotos.map((_, i) =>
    `<span onclick="carouselGo(${i})" style="width:7px;height:7px;border-radius:50%;background:${i === _carouselIdx ? '#fff' : 'rgba(255,255,255,.4)'};cursor:pointer;transition:background .3s;display:inline-block"></span>`
  ).join('');
}

function carouselGo(idx) {
  const slides = document.querySelectorAll('.dash-slide');
  if (!slides.length) return;
  slides[_carouselIdx].style.opacity = '0';
  _carouselIdx = ((idx % _sitePhotos.length) + _sitePhotos.length) % _sitePhotos.length;
  slides[_carouselIdx].style.opacity = '1';
  _renderDots();
  const ctr = document.getElementById('DASH-CTR');
  if (ctr && _sitePhotos.length > 1) ctr.textContent = `${_carouselIdx + 1}/${_sitePhotos.length}`;
  _startCarouselTimer();
}

function carouselNav(dir) { carouselGo(_carouselIdx + dir); }

function _startCarouselTimer() {
  if (_carouselTimer) clearInterval(_carouselTimer);
  if (_sitePhotos.length < 2) return;
  _carouselTimer = setInterval(() => carouselNav(1), 5000);
}

function renderSitePhotosGrid() {
  const grid = document.getElementById('SITE-PHOTOS-GRID');
  const cnt  = document.getElementById('SITE-CNT');
  if (cnt) cnt.textContent = `${_sitePhotos.length} / 8`;
  if (!grid) return;
  if (!_sitePhotos.length) {
    grid.innerHTML = `<div style="color:var(--color-text-tertiary);font-size:11px;padding:16px 0;width:100%;text-align:center"><i class="ti ti-photo" style="font-size:20px;display:block;margin:0 auto 6px;opacity:.4"></i>Aucune photo — cliquez sur "Ajouter"</div>`;
    return;
  }
  const ts = Date.now();
  grid.innerHTML = _sitePhotos.map((url, i) => `
    <div style="position:relative;width:110px;height:78px;border-radius:var(--border-radius-md);overflow:hidden;border:2px solid ${i===0?'var(--brand)':'var(--color-border-secondary)'};flex-shrink:0">
      <img src="${url}?t=${ts}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
      ${i===0 ? `<div style="position:absolute;bottom:3px;left:3px;background:var(--brand);color:#fff;font-size:8px;font-weight:600;padding:1px 5px;border-radius:3px;letter-spacing:.03em">PRINCIPALE</div>` : ''}
      <button onclick="deleteSitePhoto('${url}')" title="Supprimer" style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,.55);border:none;border-radius:4px;color:#fff;width:20px;height:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1"><i class="ti ti-x" style="font-size:11px"></i></button>
    </div>
  `).join('');
}

async function importCSV(input) {
  const file = input.files[0]; if (!file) return;
  const el = document.getElementById('CSV-RESULT');
  el.innerHTML = `<div style="font-size:11px;color:var(--color-text-tertiary)"><i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i> Importation en cours…</div>`;
  const fd = new FormData(); fd.append('file', file);
  try {
    const res = await fetch('/api/indicateurs/import_csv', {method:'POST', body:fd, credentials:'same-origin'});
    const d = await res.json();
    if (d.error) { el.innerHTML = `<div style="color:var(--cr);font-size:11px"><i class="ti ti-x"></i> ${d.error}</div>`; return; }
    el.innerHTML = `<div style="color:var(--cg);font-size:11px;font-weight:600"><i class="ti ti-check"></i> ${d.created} créés · ${d.updated} mis à jour${d.errors.length ? ` · ${d.errors.length} erreurs` : ''}</div>${d.errors.map(e=>`<div style="font-size:10px;color:var(--cr);margin-top:2px">${e}</div>`).join('')}`;
    const inds = await api('GET', '/indicateurs');
    if (inds) { IND = inds; renderInd(); updateFiltCounts(); }
    showSaved('Import CSV terminé');
  } catch(e) { el.innerHTML = `<div style="color:var(--cr);font-size:11px"><i class="ti ti-x"></i> Erreur réseau</div>`; }
  input.value = '';
}

function downloadCSVTemplate() {
  const header = 'id,domaine,zone,libelle,bloquant,reglementaire,poids,points_risque';
  const example = 'IND-EX01,HSE,Zone A,Vérification EPI,oui,oui,1.0,3';
  const blob = new Blob([header + '\n' + example], {type:'text/csv'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'modele_indicateurs.csv'; a.click();
}

// ── Crop helpers ─────────────────────────────────────────────────────────────
let _cropper      = null;
let _cropQueue    = [];
let _cropQueueIdx = 0;
let _cropResolve  = null;
let _cropFlipH    = 1;
let _cropFlipV    = 1;

async function uploadSitePhoto(input) {
  const files = Array.from(input.files);
  input.value = '';
  if (!files.length) return;
  const available = 8 - _sitePhotos.length;
  if (available <= 0) { toast('Maximum 8 photos atteint', 'danger'); return; }
  _cropQueue    = files.slice(0, available);
  _cropQueueIdx = 0;
  await _processCropQueue();
}

async function _processCropQueue() {
  if (_cropQueueIdx >= _cropQueue.length) return;
  const file = _cropQueue[_cropQueueIdx];
  if (file.size > 10 * 1024 * 1024) {
    toast(`"${file.name}" trop lourd (max 10 Mo)`, 'danger');
    _cropQueueIdx++;
    await _processCropQueue();
    return;
  }
  const blob = await _showCropModal(file, _cropQueueIdx + 1, _cropQueue.length);
  if (blob) await _uploadBlob(blob, file.name);
  _cropQueueIdx++;
  await _processCropQueue();
}

function _showCropModal(file, current, total) {
  return new Promise(resolve => {
    _cropResolve = resolve;
    _cropFlipH   = 1;
    _cropFlipV   = 1;
    const reader = new FileReader();
    reader.onload = e => {
      const modal = document.getElementById('CROP-MODAL');
      const img   = document.getElementById('CROP-IMG');
      document.getElementById('CROP-PROGRESS').textContent = total > 1 ? `${current} / ${total}` : '';
      if (_cropper) { _cropper.destroy(); _cropper = null; }
      img.src = '';
      modal.style.display = 'flex';
      img.onload = () => {
        _cropper = new Cropper(img, {
          aspectRatio: 16 / 9,
          viewMode: 1,
          dragMode: 'move',
          autoCropArea: 0.75,
          responsive: true,
          background: false,
          ready() {
            _highlightRatioBtn('CROP-R-169');
            // Zoom out to show the full image with surrounding context
            const cd = this.cropper.getContainerData();
            const id = this.cropper.getImageData();
            const fitRatio = Math.min(cd.width / id.naturalWidth, cd.height / id.naturalHeight);
            this.cropper.zoomTo(fitRatio * 0.82);
          }
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function confirmCrop() {
  if (!_cropper) return;
  const canvas = _cropper.getCroppedCanvas({maxWidth: 2560, maxHeight: 1440, imageSmoothingQuality: 'high'});
  canvas.toBlob(blob => {
    _closeCropModal();
    if (_cropResolve) { _cropResolve(blob); _cropResolve = null; }
  }, 'image/jpeg', 0.88);
}

function skipCrop() {
  _closeCropModal();
  const file = _cropQueue[_cropQueueIdx];
  if (_cropResolve) { _cropResolve(file || null); _cropResolve = null; }
}

function _closeCropModal() {
  document.getElementById('CROP-MODAL').style.display = 'none';
  if (_cropper) { _cropper.destroy(); _cropper = null; }
}

function setCropRatio(ratio) {
  if (!_cropper) return;
  _cropper.setAspectRatio(isNaN(ratio) ? NaN : ratio);
  const map = {[NaN]:'CROP-R-FREE', [16/9]:'CROP-R-169', [4/3]:'CROP-R-43', [1]:'CROP-R-11'};
  _highlightRatioBtn(isNaN(ratio) ? 'CROP-R-FREE' : map[ratio]);
}

function rotateCrop(deg) { if (_cropper) _cropper.rotate(deg); }

function flipCrop(axis) {
  if (!_cropper) return;
  if (axis === 'h') { _cropFlipH *= -1; _cropper.scale(_cropFlipH, _cropFlipV); }
  else              { _cropFlipV *= -1; _cropper.scale(_cropFlipH, _cropFlipV); }
}

function _highlightRatioBtn(id) {
  ['CROP-R-FREE','CROP-R-169','CROP-R-43','CROP-R-11'].forEach(bid => {
    const b = document.getElementById(bid);
    if (b) b.className = 'btn btn-sm' + (bid === id ? ' btn-p' : '');
  });
}

async function _uploadBlob(blob, originalName) {
  const ext = (originalName.match(/\.(jpe?g|png|webp)$/i) || [])[1] || 'jpg';
  const fd  = new FormData();
  fd.append('file', blob, `site.${ext.replace('jpeg','jpg')}`);
  toast('Envoi en cours…');
  try {
    const res  = await fetch('/api/upload/site', {method:'POST', body:fd, credentials:'same-origin'});
    const data = await res.json();
    if (!res.ok || !data.ok) { toast(data.error || 'Erreur upload', 'danger'); return; }
    _sitePhotos = data.urls;
    _carouselIdx = 0;
    renderDashCarousel();
    renderSitePhotosGrid();
    toast('Photo ajoutée ✓');
  } catch(e) { toast('Erreur : ' + e.message, 'danger'); }
}

async function deleteSitePhoto(url) {
  if (!confirm('Supprimer cette photo ?')) return;
  const res = await api('POST', '/upload/site/delete', {url});
  if (res) {
    _sitePhotos = res.urls || [];
    _carouselIdx = 0;
    renderDashCarousel();
    renderSitePhotosGrid();
    toast('Photo supprimée');
  }
}

function _initPhotoHovers() {
  const prf = document.getElementById('PRF-AVA-HOVER');
  const pwa = document.querySelector('#PROFILE-DROP [onclick*="AVA-INPUT"]');
  if (prf && pwa) {
    pwa.addEventListener('mouseenter', () => prf.style.opacity = '1');
    pwa.addEventListener('mouseleave', () => prf.style.opacity = '0');
  }
  const pav = document.getElementById('P-AVA-HOVER');
  const pawrap = document.getElementById('P-AVA-WRAP');
  if (pav && pawrap) {
    pawrap.parentElement.addEventListener('mouseenter', () => pav.style.opacity = '1');
    pawrap.parentElement.addEventListener('mouseleave', () => pav.style.opacity = '0');
  }
  const sov = document.getElementById('SITE-OVERLAY');
  const spre = document.getElementById('SITE-PREVIEW');
  if (sov && spre) {
    spre.addEventListener('mouseenter', () => { if (sov.style.display !== 'none') sov.style.opacity = '1'; });
    spre.addEventListener('mouseleave', () => { if (sov.style.display !== 'none') sov.style.opacity = '0'; });
  }
}

function _initParamsAvatar() {
  const wrap = document.getElementById('P-AVA-WRAP');
  if (!wrap) return;
  const avaBtn = document.getElementById('AVA-BTN');
  const sbImg  = document.getElementById('SB-AVA-IMG');
  if (sbImg) {
    const img = document.createElement('img');
    img.src = sbImg.src;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover';
    wrap.appendChild(img);
    wrap.style.background = 'transparent';
  } else if (avaBtn && avaBtn.tagName === 'IMG') {
    const img = document.createElement('img');
    img.src = avaBtn.src;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover';
    wrap.appendChild(img);
    wrap.style.background = 'transparent';
  } else {
    // Show initials with avatar color
    const avaDiv = document.getElementById('AVA-BTN');
    if (avaDiv) {
      wrap.style.background = avaDiv.style.background || '#185FA5';
      wrap.textContent = avaDiv.textContent.trim();
    }
  }
}

// ── INIT ─────────────────────────────────────────────────────────
async function init() {
  _applyThemeIcon();
  document.getElementById('IM-DATE').value = new Date().toISOString().split('T')[0];

  const [inds, acts, incs, users, notifs, tftg, rptHist] = await Promise.all([
    api('GET', '/indicateurs'),
    api('GET', '/actions'),
    api('GET', '/incidents'),
    api('GET', '/users'),
    api('GET', '/notifications'),
    api('GET', '/tf_tg'),
    api('GET', '/report_history'),
  ]);

  if (inds)    IND       = inds;
  if (acts)    ACTIONS   = acts;
  if (incs)    INCIDENTS = incs;
  if (users)   USERS     = users;
  if (notifs)  NOTIFS    = notifs;
  if (tftg)    TFTG      = tftg;
  if (rptHist) RPT_HIST  = rptHist;

  buildSaisieSelect();
  updateFiltCounts();
  renderTfTg();
  renderInd();
  setFilt('all');
  selSt('nc_critique');
  renderAct();
  renderInc();
  renderUsers();
  renderNotifs();
  renderReportHistory();
  initParams();
  await loadDashboard();
  await buildRevue();
  await loadDecision();
  if (typeof applyLang === 'function') { applyLang(); _applyLangBtn(); }
  _initMobNav();
  _initPhotoHovers();
  _initParamsAvatar();
  await loadSitePhotos();
  initImgWidget('OBS-PHOTOS-WIDGET', 'obs');
  initImgWidget('INC-PHOTOS-WIDGET', 'inc');
}

init();
