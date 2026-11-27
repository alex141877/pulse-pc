'use strict';
const q = selector => document.querySelector(selector);
const desktop = window.pulsepcDesktop;
const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const pcs = load('pulsepc.pcs', []);
const state = new Map();
const labels = {green:'Normal', orange:'À surveiller', red:'Critique', offline:'Hors ligne', waiting:'En attente'};
let active = localStorage.getItem('pulsepc.active');
let editing;
let busy = false;
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, action) => {
  const node = el('button', text);
  node.onclick = action;
  return node;
};
const pct = value => value == null ? '—' : value + ' %';
const bytes = value => Number.isFinite(value) ? (value / 1073741824).toLocaleString('fr-FR', {maximumFractionDigits:2}) + ' Gio' : '—';
const ratio = ({used, total}) => total ? Math.round(used * 100 / total) : null;
const date = time => new Date(time * 1000).toLocaleString('fr-FR');
const duration = value => !Number.isFinite(value) || value > Date.now() / 1000 - 946684800
  ? 'Agent à mettre à jour'
  : [Math.floor(value / 86400) + ' j', Math.floor(value % 86400 / 3600) + ' h', Math.floor(value % 3600 / 60) + ' min'].join(' ');
function save() {
  localStorage.setItem('pulsepc.pcs', JSON.stringify(pcs));
  localStorage.setItem('pulsepc.active', active || '');
}
async function api(pc, path, action) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  try {
    const target = new URL(pc.url);
    if (target.protocol !== 'https:' || target.username || target.password) throw Error('Adresse HTTPS requise');
    const options = {headers:{Authorization:'Bearer ' + (action ? pc.control : pc.token)}, signal:ctrl.signal, cache:'no-store'};
    if (action) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(action);
    }
    const reply = await fetch(target.origin + path, options);
    const payload = await reply.json().catch(() => ({}));
    if (!reply.ok) throw Error(payload.error || 'HTTP ' + reply.status);
    return payload;
  } finally { clearTimeout(timer); }
}
const periods = {'1h':{label:'1 h',seconds:3600,bucket:10},'24h':{label:'24 h',seconds:86400,bucket:240},'7d':{label:'7 j',seconds:604800,bucket:1800}};
const readings = [
  {id:'temperature',label:'Température CPU',icon:'♨',unit:'°C',warning:75,critical:90,max:100,value:data=>data?.temperature},
  {id:'ram',label:'Mémoire vive',icon:'▤',unit:'%',warning:80,critical:95,max:100,value:data=>ratio(data?.memory || {})},
  {id:'cpu',label:'Processeur',icon:'▣',unit:'%',warning:75,critical:95,max:100,value:data=>data?.cpu?.usage},
  {id:'disk',label:'Stockage',icon:'▱',unit:'%',warning:85,critical:95,max:100,value:data=>data?.disk?.percent ?? ratio(data?.disk || {})}
];
let view = pcs.length ? 'nodes' : 'overview';
let period = '1h';
let requestId = 0;
let wakePc;

function severity(value, definition) {
  if (!Number.isFinite(value)) return 'waiting';
  return value >= definition.critical ? 'red' : value >= definition.warning ? 'orange' : 'green';
}
function readingText(value, definition) {
  return Number.isFinite(value) ? value.toLocaleString('fr-FR') + ' ' + definition.unit : '—';
}
function badge(level) {
  return el('span', labels[level] || labels.waiting, 'badge ' + level);
}
function go(next, pc) {
  view = next;
  if (pc) {active = pc.id; save();}
  q('#feedback').textContent = '';
  render();
  if (next === 'detail') refreshHistory(pc);
}
async function refreshHistory(pc) {
  const record = state.get(pc.id);
  if (!record?.data || record.data.apiVersion < 2 || record.level === 'offline') return;
  const range = period;
  if (record.history?.range === range && Date.now() - record.history.loaded < 45000) return;
  const id = ++requestId;
  try {
    const usePeriod = record.data.apiVersion >= 3;
    const history = await api(pc, '/api/history' + (usePeriod ? '?period=' + range : ''));
    if (id !== requestId || view !== 'detail' || active !== pc.id || range !== period) return;
    const latest = state.get(pc.id);
    if (latest) latest.history = {...history,range,loaded:Date.now(),usePeriod};
    render();
  } catch (error) {
    if (id === requestId && view === 'detail' && active === pc.id) {
      const latest = state.get(pc.id);
      if (latest) latest.history = {range, loaded:Date.now(), error:error.message};
      render();
    }
  }
}
async function poll() {
  if (busy) return;
  busy = true;
  try {
    await Promise.all(pcs.map(async pc => {
      try {
        const data = await api(pc, '/api/status');
        const previous = state.get(pc.id);
        if (pcs.includes(pc)) state.set(pc.id, {data, history:previous?.history,level:data.status?.level || 'green'});
      } catch (error) {
        if (pcs.includes(pc)) state.set(pc.id, {...state.get(pc.id),level:'offline',
          error:error.name === 'AbortError' || error instanceof TypeError ? 'Agent injoignable. Vérifie Tailscale.' : error.message});
      }
    }));
    render();
    const pc = pcs.find(item => item.id === active);
    if (view === 'detail' && pc) refreshHistory(pc);
  } finally {busy = false;}
}

function chart(samples, definition, windowSize, end, bucket) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 460 146');
  svg.setAttribute('class','chart');
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label',definition.label + ' sur la période choisie');
  const start = end - windowSize;
  const x = time => 50 + 396 * (time - start) / windowSize;
  const y = value => 120 - 108 * Math.max(0,Math.min(value / definition.max,1));
  function draw(tag, attributes, text) {
    const item = document.createElementNS(ns,tag);
    for (const [key,value] of Object.entries(attributes)) item.setAttribute(key,String(value));
    if (text !== undefined) item.textContent = text;
    svg.append(item);
  }
  for (let i = 0; i <= 4; i++) {
    const value = i * definition.max / 4;
    draw('line',{x1:50,y1:y(value),x2:446,y2:y(value),class:'gridline'});
    draw('text',{x:44,y:y(value)+4,'text-anchor':'end'},value + ' ' + definition.unit);
    const time = start + i * windowSize / 4;
    const timeLabel = new Date(time * 1000).toLocaleString('fr-FR', windowSize > 86400
      ? {day:'numeric',month:'numeric'} : {hour:'2-digit',minute:'2-digit'});
    draw('line',{x1:x(time),y1:12,x2:x(time),y2:120,class:'gridline'});
    draw('text',{x:x(time),y:140,'text-anchor':'middle'},timeLabel);
  }
  let previous;
  let group = [];
  function flush() {
    if (group.length > 1) draw('polyline',{points:group.map(([px,py])=>px+','+py).join(' '),class:'plot'});
    else if (group.length) draw('circle',{cx:group[0][0],cy:group[0][1],r:2.5,fill:'currentColor'});
    group = [];
  }
  for (const sample of samples) {
    if (sample.time < start || sample.time > end) continue;
    const value = sample[definition.id];
    if (!Number.isFinite(value) || sample.time - previous > bucket * 2.5) flush();
    if (Number.isFinite(value)) group.push([x(sample.time),y(value)]);
    previous = sample.time;
  }
  flush();
  return svg;
}

function connect(pc) {
  const host = pc.sshHost || new URL(pc.url).hostname;
  desktop.connect('https://' + host, pc.ssh || 'alex').catch(error => {q('#feedback').textContent = error.message;});
}
function header(titleText, action) {
  const title = el('header',undefined,'title');
  title.append(el('h1',titleText));
  if (action) title.append(action);
  return title;
}
function addButton() {
  const add = button('＋ Ajouter un PC',() => edit());
  add.className = 'primary';
  return add;
}
function summary() {
  const box = el('section',undefined,'summary');
  const counts = {};
  for (const pc of pcs) {
    const level = state.get(pc.id)?.level || 'waiting';
    counts[level] = (counts[level] || 0) + 1;
  }
  for (const level of Object.keys(labels)) {
    if (['offline','waiting'].includes(level) && !counts[level]) continue;
    const item = el('div',undefined,'summary-item ' + level);
    item.append(el('span',undefined,'dot'),el('b',counts[level] || 0),el('small',labels[level]));
    box.append(item);
  }
  return box;
}
function nodeCard(pc) {
  const record = state.get(pc.id);
  const level = record?.level || 'waiting';
  const card = el('article',undefined,'card ' + level);
  const head = el('div',undefined,'card-title');
  const title = el('div');
  title.append(el('h2',pc.name),badge(level));
  head.append(el('span','▣','device-icon'),title);
  card.append(head);
  if (record?.error) card.append(el('p',record.error,'muted'));
  const rows = el('div',undefined,'readings');
  for (const definition of readings) {
    const value = definition.value(level === 'offline' ? null : record?.data);
    const row = el('div',undefined,'reading ' + severity(value,definition));
    const meter = el('meter');
    meter.max = definition.max;
    meter.value = Number.isFinite(value) ? Math.min(definition.max, value) : 0;
    meter.setAttribute('aria-hidden','true');
    row.append(el('span',undefined,'dot'),el('span',definition.label),meter,el('strong',readingText(value,definition)));
    rows.append(row);
  }
  card.append(rows);
  const actions = el('div',undefined,'actions');
  actions.append(button('Tableau de bord',() => go('detail',pc)));
  if (desktop) actions.append(button('Se connecter',() => connect(pc)));
  card.append(actions);
  return card;
}
function renderOverview(content) {
  content.append(header('Vue d’ensemble',addButton()),summary());
  if (!pcs.length) {
    content.append(el('p','Ajoute un PC pour afficher ses mesures.','muted'));
    return;
  }
  const list = el('section',undefined,'panel');
  for (const pc of pcs) {
    const row = el('div',undefined,'settings-row');
    row.append(el('strong',pc.name),badge(state.get(pc.id)?.level || 'waiting'),button('Tableau de bord',()=>go('detail',pc)));
    list.append(row);
  }
  content.append(list);
}
function renderNodes(content) {
  content.append(header('Nœuds',addButton()),summary());
  const grid = el('section',undefined,'grid nodes');
  for (const pc of pcs) grid.append(nodeCard(pc));
  if (!pcs.length) grid.append(el('p','Aucun PC ajouté.','muted'));
  content.append(grid);
}
function renderSettings(content) {
  content.append(header('Paramètres',addButton()));
  const panel = el('section',undefined,'panel');
  if (!pcs.length) panel.append(el('p','Aucun PC configuré.','muted'));
  for (const pc of pcs) {
    const row = el('div',undefined,'settings-row');
    const actions = el('div',undefined,'actions');
    actions.append(button('Modifier',()=>edit(pc)),button('Wake-on-LAN',()=>editWake(pc)));
    row.append(el('strong',pc.name),actions);
    panel.append(row);
  }
  content.append(panel);
}
function renderDetail(content,pc) {
  const record = state.get(pc.id);
  const data = record?.data;
  const crumbs = el('div',undefined,'crumbs');
  crumbs.append(button('Nœuds',()=>go('nodes')),el('span','/','muted'),el('span',pc.name));
  const title = el('header',undefined,'title');
  const identity = el('div');
  const name = el('div',undefined,'title-group');
  name.append(el('h1',pc.name),badge(record?.level || 'waiting'));
  identity.append(name);
  if (data) identity.append(el('p','Allumé depuis ' + duration(data.uptime),'uptime'));
  if (record?.error) identity.append(el('p',record.error,'muted'));
  title.append(identity);
  if (desktop) {
    const ssh = button('Se connecter',()=>connect(pc));
    ssh.className = 'primary';
    title.append(ssh);
  }
  const actions = el('section',undefined,'panel action-strip');
  const restart = button('Redémarrer',()=>send(pc,'reboot'));
  const stop = button('Éteindre',()=>send(pc,'poweroff'));
  restart.disabled = stop.disabled = !(data?.apiVersion >= 2 && pc.control && record?.level !== 'offline');
  if (restart.disabled) restart.title = stop.title = 'PC en ligne et jeton de commande requis';
  actions.append(el('h2','Actions'),restart,stop,button('Paramètres',()=>edit(pc)));
  if (pc.relay && pc.target) actions.append(button('Wake-on-LAN',()=>send(pc,'wake')));
  content.append(crumbs,title,actions);

  const panel = el('section',undefined,'panel');
  const bar = el('div',undefined,'pane-heading');
  const segments = el('div',undefined,'segments');
  segments.setAttribute('aria-label','Période des graphiques');
  for (const [id, config] of Object.entries(periods)) {
    const tab = button(config.label,()=>{period=id;render();refreshHistory(pc);});
    tab.setAttribute('aria-pressed',String(id === period));
    segments.append(tab);
  }
  bar.append(el('h2','Mesures'),segments);
  panel.append(bar);
  const grid = el('div',undefined,'grid metrics');
  const history = record?.history;
  const range = periods[period];
  const samples = history?.range === period ? history.samples || [] : [];
  const end = Math.floor(Date.now()/1000);
  for (const definition of [readings[2],readings[0],readings[1],readings[3]]) {
    const value = definition.value(data);
    const metric = el('article',undefined,'panel metric ' + severity(value,definition));
    const label = el('h3');
    label.append(el('span',definition.icon),document.createTextNode(definition.label));
    metric.append(label,el('div',readingText(value,definition),'value'));
    if (samples.some(point => Number.isFinite(point[definition.id]))) {
      metric.append(chart(samples,definition,range.seconds,end,history.usePeriod ? range.bucket : 5));
    } else {
      metric.append(el('small', history?.error || 'Aucune mesure disponible sur cette période.','chart-empty muted'));
    }
    if (definition.id === 'ram' && data?.memory) {
      const list = el('dl');
      for (const [key,labelText] of Object.entries({used:'Utilisée',available:'Disponible',free:'Libre',cached:'Cache',total:'Totale'})) {
        const row = el('div');
        row.append(el('dt',labelText),el('dd',bytes(data.memory[key])));
        list.append(row);
      }
      metric.append(list);
    } else if (definition.id === 'cpu' && data?.cpu?.name) metric.append(el('small',data.cpu.name));
    else if (definition.id === 'disk' && data?.disk) metric.append(el('small',bytes(data.disk.used) + ' / ' + bytes(data.disk.total) + ' · /'));
    grid.append(metric);
  }
  panel.append(grid);
  if (data) {
    const extra = el('div',undefined,'details-extra');
    extra.append(el('small','Charge système (1 min) · ' + (data.cpu?.load ?? '—')),
      el('small','GPU · ' + (data.gpu?.name || '—') + (data.gpu?.usage == null ? '' : ' · ' + pct(data.gpu.usage))));
    panel.append(extra);
  }
  content.append(panel);
  const logs = el('section',undefined,'panel log-panel');
  logs.append(el('h2','Historique des états'));
  const events = history?.events || [];
  if (events.length) {
    const list = el('ul',undefined,'history');
    for (const event of events.slice().reverse()) list.append(el('li',date(event.time) + ' · ' + labels[event.level] + ' · ' + event.reason,event.level));
    logs.append(list);
  } else logs.append(el('small','Aucun événement disponible.'));
  content.append(logs);
}
function render() {
  if (document.querySelector('dialog[open]')) return;
  const content = q('#content');
  const focused = content.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON'
    ? Array.from(content.querySelectorAll('button')).indexOf(document.activeElement) : -1;
  content.replaceChildren();
  for (const item of document.querySelectorAll('nav button')) {
    if (item.dataset.view === (view === 'detail' ? 'nodes' : view)) item.setAttribute('aria-current','page');
    else item.removeAttribute('aria-current');
  }
  const pc = pcs.find(item => item.id === active);
  if (view === 'detail' && pc) renderDetail(content,pc);
  else if (view === 'settings') renderSettings(content);
  else if (view === 'nodes') renderNodes(content);
  else renderOverview(content);
  if (focused >= 0) content.querySelectorAll('button')[focused]?.focus({preventScroll:true});
}

async function send(pc, action) {
  const name = {poweroff:'Éteindre',reboot:'Redémarrer',wake:'Réveiller'}[action];
  const host = action === 'wake' ? pcs.find(item => item.id === pc.relay) : pc;
  if (!host?.control) { q('#feedback').textContent = 'Un jeton de commande est requis sur l’agent qui reçoit la demande.'; return; }
  if (!window.confirm(name + ' ' + pc.name + ' ?')) return;
  try {
    await api(host,'/api/action',{action,target:pc.target});
    q('#feedback').textContent = name + ' · demande acceptée par ' + host.name;
  } catch (error) {q('#feedback').textContent = error.message;}
}
function decodePairing(value) {
  const match = /^ppc1\.([A-Za-z0-9_-]{1,2048})$/.exec(value);
  if (!match) throw Error('Colle le jeton complet commençant par ppc1.');
  try {
    const raw = atob(match[1].replace(/-/g,'+').replace(/_/g,'/'));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
    const url = new URL(payload.url);
    if (url.protocol !== 'https:' || url.username || url.password || typeof payload.token !== 'string' || !payload.token
        || typeof payload.control !== 'string') throw Error();
    return {url:url.origin,token:payload.token,control:payload.control};
  } catch {throw Error('Jeton d’appairage invalide. Copie-le à nouveau depuis Debian.');}
}
function edit(pc) {
  editing = pc;
  const form = q('#pc-form');
  form.reset();
  q('#editor-title').textContent = pc ? 'Paramètres du PC' : 'Ajouter un PC';
  q('#edit-error').textContent = '';
  q('#ssh-field').hidden = !desktop;
  q('#pair-help').textContent = pc ? 'Laisse le jeton vide pour garder la connexion actuelle.' : 'Colle le jeton généré sur Debian.';
  form.elements.pairing.required = !pc;
  if (pc) {
    form.elements.name.value = pc.name;
    form.elements.ssh.value = (pc.ssh || 'alex') + '@' + (pc.sshHost || new URL(pc.url).hostname);
  }
  q('#editor').showModal();
}
q('#pc-form').onsubmit = event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const name = form.elements.name.value.trim();
    if (!name) throw Error('Indique le nom du PC.');
    const key = form.elements.pairing.value.trim();
    const connection = key ? decodePairing(key) : editing;
    if (!connection) throw Error('Colle le jeton d’appairage.');
    const sshInput = desktop ? form.elements.ssh.value.trim() : '';
    const login = sshInput ? /^([a-z_][a-z0-9_-]*)@([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i.exec(sshInput) : null;
    if (sshInput && !login) throw Error('Adresse SSH attendue au format alex@debian-machine.');
    const pc = {...editing,name,url:connection.url,token:connection.token,control:connection.control,
      ssh:login?.[1] || editing?.ssh || 'alex',sshHost:login?.[2] || editing?.sshHost || '',
      id:editing?.id || crypto.randomUUID()};
    if (editing) pcs.splice(pcs.indexOf(editing),1,pc);
    else pcs.push(pc);
    state.delete(pc.id);
    active = pc.id;
    save();
    q('#editor').close();
    if (!editing) go('nodes');
    else render();
    poll();
  } catch (error) {q('#edit-error').textContent = error.message;}
};
function editWake(pc) {
  wakePc = pc;
  const {relay,target} = q('#wake-form').elements;
  relay.replaceChildren(new Option('Aucun',''));
  for (const item of pcs.filter(item => item !== pc)) relay.add(new Option(item.name,item.id));
  relay.value = pc.relay || '';
  target.value = pc.target || '';
  q('#wake-editor').showModal();
}
q('#wake-form').onsubmit = event => {
  if (event.submitter?.value !== 'save') return;
  const {relay,target} = event.currentTarget.elements;
  wakePc.relay = relay.value;
  wakePc.target = target.value.trim();
  save();
};
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close',render);
for (const item of document.querySelectorAll('nav button')) item.addEventListener('click',()=>go(item.dataset.view));
render();
poll();
setInterval(poll,5000);
