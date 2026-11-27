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
const iconPaths = {
  monitor:'M4 4h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM12 19v3m-5 0h10',
  home:'m3 10 9-7 9 7v10H15v-6H9v6H3Z',
  nodes:'M12 7v3m0 0L6 16m6-6 6 6M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM5 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm14 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  gear:'m9 3-.7 2.8-1.5.9-2.7-.8-2 3.5 2.1 2v1.2l-2.1 2 2 3.5 2.7-.8 1.5.9L9 21h4l.7-2.8 1.5-.9 2.7.8 2-3.5-2.1-2v-1.2l2.1-2-2-3.5-2.7.8-1.5-.9L13 3ZM14 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  cpu:'M6 6h12v12H6zm3-3v3m3-3v3m3-3v3M9 18v3m3-3v3m3-3v3M3 9h3m-3 3h3m-3 3h3m12-6h3m-3 3h3m-3 3h3M9 9h6v6H9z',
  ram:'M3 6h18v10H3zM5 16v3m4-3v3m6-3v3m4-3v3M7 10v2m5-2v2m5-2v2',
  thermometer:'M9 14.5V5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0ZM12 8v9m0 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  disk:'M21 6c0 2.2-4 4-9 4S3 8.2 3 6s4-4 9-4 9 1.8 9 4ZM3 6v12c0 2.2 4 4 9 4s9-1.8 9-4V6M3 12c0 2.2 4 4 9 4s9-1.8 9-4',
  gpu:'M2 5h20v13H2zm3 13v3m4-3v3m5-3v3m5-3v3M12 8a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  load:'M2 12h4l3-7 5 14 3-7h5',
  chart:'M4 20v-6m5 6V9m5 11v-7m5 7V4',
  terminal:'m4 6 6 6-6 6m9 0h7',
  plus:'M12 4v16M4 12h16',
  restart:'M4 10a8 8 0 1 1 1.5 7.1M4 4v6h6',
  power:'M12 2v10M7 5a9 9 0 1 0 10 0',
  trash:'M4 7h16m-14 0 1 14h10l1-14M9 7V4h6v3m-5 4v6m4-6v6',
  apps:'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z'
};
function icon(name, extraClass = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  svg.setAttribute('class','icon ' + extraClass);
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('aria-hidden','true');
  const path = document.createElementNS(ns,'path');
  path.setAttribute('d',iconPaths[name]);
  svg.append(path);
  return svg;
}

const button = (text, action, symbol) => {
  const node = el('button', text);
  if (symbol) node.prepend(icon(symbol));
  node.onclick = action;
  return node;
};
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
  const timer = setTimeout(() => ctrl.abort(), action || path.startsWith('/api/programs') ? 30000 : 4500);
  try {
    const target = new URL(pc.url);
    if (target.protocol !== 'https:' || target.username || target.password) throw Error('Adresse HTTPS requise');
    const options = {headers:{Authorization:'Bearer ' + (action || path === '/api/programs/config' ? pc.control : pc.token)}, signal:ctrl.signal, cache:'no-store'};
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
  {id:'temperature',label:'Température CPU',icon:'thermometer',unit:'°C',warning:75,critical:90,max:100,value:data=>data?.temperature},
  {id:'ram',label:'Mémoire vive',icon:'ram',unit:'%',warning:80,critical:95,max:100,value:data=>ratio(data?.memory || {})},
  {id:'cpu',label:'Processeur',icon:'cpu',unit:'%',warning:75,critical:95,max:100,value:data=>data?.cpu?.usage},
  {id:'disk',label:'Stockage',icon:'disk',unit:'%',warning:85,critical:95,max:100,value:data=>data?.disk?.percent ?? ratio(data?.disk || {})}
];
const extraReadings = [
  {id:'load',label:'Charge système',icon:'load',unit:'',value:data=>data?.cpu?.load},
  {id:'gpu',label:'Carte graphique',icon:'gpu',unit:'%',max:100,value:data=>data?.gpu?.usage}
];
let view = 'overview';
let period = '1h';
let requestId = 0;
let wakePc;

function severity(value, definition) {
  if (!Number.isFinite(value)) return 'waiting';
  return value >= definition.critical ? 'red' : value >= definition.warning ? 'orange' : 'green';
}
function readingText(value, definition) {
  return Number.isFinite(value) ? value.toLocaleString('fr-FR') + (definition.unit ? ' ' + definition.unit : '') : '—';
}
function badge(level) {
  return el('span', labels[level] || labels.waiting, 'badge ' + level);
}
function go(next, pc) {
  view = next;
  if (pc) {active = pc.id; detailSection = 'metrics'; save();}
  q('#feedback').textContent = '';
  render();
  if (next === 'detail') refreshHistory(pc);
  if (next === 'nodes') for (const node of pcs.filter(item=>item.inTopology === true)) refreshPrograms(node);
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
        if (pcs.includes(pc)) {
          state.set(pc.id, {...previous,data,error:null,level:data.status?.level || 'green'});
          lastSignals[pc.id] = Math.floor(Date.now()/1000);
        }
      } catch (error) {
        if (pcs.includes(pc)) state.set(pc.id, {...state.get(pc.id),level:'offline',
          error:error.name === 'AbortError' || error instanceof TypeError ? 'Agent injoignable. Vérifie Tailscale.' : error.message});
      }
    }));
    localStorage.setItem('pulsepc.lastSignals',JSON.stringify(lastSignals));
    render();
    if (view === 'nodes') for (const node of pcs.filter(item=>item.inTopology === true)) refreshPrograms(node);
    const pc = pcs.find(item => item.id === active);
    if (view === 'detail' && pc) {
      if (detailSection === 'programs') refreshPrograms(pc);
      else refreshHistory(pc);
    }
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
    draw('text',{x:44,y:y(value)+4,'text-anchor':'end'},readingText(value,definition));
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
  const add = button('Ajouter un PC',() => edit(),'plus');
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
  head.append(icon('monitor','device-icon'),title);
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
  actions.append(button('Tableau de bord',() => go('detail',pc),'chart'));
  if (desktop) actions.append(button('Se connecter',() => connect(pc),'terminal'));
  card.append(actions);
  return card;
}
function renderOverview(content) {
  content.append(header('Vue d’ensemble'),summary());
  const grid = el('section',undefined,'grid nodes');
  for (const pc of pcs) grid.append(nodeCard(pc));
  const add = button('Ajouter un PC',() => edit(),'plus');
  add.className = 'card add-card';
  grid.append(add);
  content.append(grid);
}

const svgNamespace = 'http://www.w3.org/2000/svg';
let topology;
let panelPc;
let panelReturn;
let panelSignature;
const lastSignals = load('pulsepc.lastSignals', {});

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(svgNamespace,tag);
  for (const [name,value] of Object.entries(attributes)) element.setAttribute(name,String(value));
  return element;
}
function topologyPrograms(pc) {
  return state.get(pc.id)?.programs?.items || [];
}
function programIcon(program) {
  const symbols = {docker:'apps',systemd:'gear',custom:'terminal'};
  return icon(symbols[program.kind] || 'apps');
}
function showTopologyPrograms(pc, trigger) {
  panelPc = pc.id;
  panelReturn = trigger;
  renderTopologyPanel();
  q('#topology-close').focus();
  refreshPrograms(pc);
}
function closeTopologyPanel(restoreFocus = false) {
  panelPc = null;
  panelSignature = null;
  q('#topology-panel').hidden = true;
  if (restoreFocus && panelReturn?.isConnected) panelReturn.focus();
  panelReturn = null;
}
function renderTopologyPanel() {
  const pc = pcs.find(item => item.id === panelPc && item.inTopology === true);
  if (view !== 'nodes' || !pc) {closeTopologyPanel();return;}
  const panel = q('#topology-panel');
  const record = state.get(pc.id);
  const items = topologyPrograms(pc);
  const signature = JSON.stringify([pc.id,pc.name,pc.control !== '',record?.level,record?.data?.apiVersion,!!record?.programs,record?.programs?.error,items]);
  if (panelSignature === signature && !panel.hidden) return;
  panelSignature = signature;
  q('#topology-panel-pc').textContent = pc.name;
  const list = q('#topology-panel-apps');
  list.replaceChildren();
  const online = record?.level && !['offline','waiting'].includes(record.level);
  const canEdit = online && pc.control && record?.data?.apiVersion >= 5;
  const add = q('#topology-panel-add');
  add.disabled = !canEdit;
  add.onclick = () => programEditor(pc);
  if (!online) list.append(el('p','Le PC est hors ligne ou en attente.','muted'));
  if (record?.programs?.error) list.append(el('p',record.programs.error,'muted'));
  if (!items.length && online && !record?.programs?.error) {
    const message = record?.data?.apiVersion < 4 ? 'L’agent de ce PC ne fournit pas sa liste d’applications.' :
      record?.programs ? 'Aucune application configurée.' : 'Lecture des applications…';
    list.append(el('p',message,'muted'));
  }
  const appStates = {...programLabels,on:'En cours d’exécution',off:'Arrêtée'};
  for (const program of items) {
    const row = el('article',undefined,'topology-app');
    const frame = el('span',undefined,'app-symbol');
    frame.append(programIcon(program));
    const text = el('div');
    const current = online ? program.state : 'unknown';
    const status = el('small',undefined,current === 'on' ? 'green' : current === 'off' ? 'red' : 'offline');
    status.append(el('span',undefined,'dot'),document.createTextNode(appStates[current] || 'Indisponible'));
    text.append(el('strong',program.name),status);
    const gear = button('',()=>programEditor(pc,program.id),'gear');
    gear.className = 'topology-gear';
    gear.disabled = !canEdit;
    gear.setAttribute('aria-label','Paramètres de ' + program.name);
    row.append(frame,text,gear);
    list.append(row);
  }
  panel.hidden = false;
}
function topologyCard(pc, record, programs) {
  const level = record?.level || 'waiting';
  const card = el('article',undefined,'topology-card ' + level);
  card.dataset.pc = pc.id;
  card.onclick = () => go('detail',pc);
  const head = button('',undefined,'monitor');
  head.className = 'topology-card-head';
  const title = el('div');
  title.append(el('strong',pc.name),badge(level));
  head.append(title);
  head.setAttribute('aria-label','Ouvrir la fiche de ' + pc.name);
  card.append(head,el('p',undefined,'topology-signal'));
  if (programs.length || topologyPrograms(pc).length) {
    const apps = el('div',undefined,'topology-apps');
    for (const program of programs.slice(0,3)) {
      const capsule = button(program.name,event=>{
        event.stopPropagation();
        showTopologyPrograms(pc,event.currentTarget);
      });
      capsule.prepend(programIcon(program));
      capsule.className = 'topology-capsule';
      capsule.title = program.name;
      apps.append(capsule);
    }
    card.append(apps);
  }
  const more = button(programs.length > 3 ? 'Afficher plus' : 'Applications',event=>{
    event.stopPropagation();
    showTopologyPrograms(pc,event.currentTarget);
  },'apps');
  more.className='topology-more';
  card.append(more);
  return card;
}
function animateLink(group, path, index) {
  const phase = (index % 8) * -.55;
  const length = path.getTotalLength();
  const point = path.getPointAtLength(length * .48);
  group.append(svgElement('circle',{cx:point.x,cy:point.y,r:3,class:'link-still'}));
  for (let trail = 3; trail >= 0; trail--) {
    const bubble = svgElement('circle',{r:4-trail*.7,class:trail === 0 ? 'link-bubble' : 'link-bubble link-trail'});
    const settings = {dur:'4.3s',begin:(phase+trail*.055)+'s',repeatCount:'indefinite'};
    bubble.append(svgElement('animateMotion',{...settings,path:path.getAttribute('d'),
      keyPoints:'0;1;1',keyTimes:'0;.57;1',calcMode:'linear'}));
    bubble.append(svgElement('animate',{...settings,attributeName:'opacity',
      values:trail === 0 ? '0;1;.9;0;0' : '0;.33;.27;0;0',keyTimes:'0;.08;.48;.57;1'}));
    group.append(bubble);
  }
}
function drawTopologyLinks(board) {
  if (!board.root.isConnected) return;
  const bounds = board.map.getBoundingClientRect();
  const hub = board.hub.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const x = hub.left + hub.width/2 - bounds.left;
  const y = hub.top + hub.height/2 - bounds.top;
  const geometry = [];
  for (const {card} of board.cards.values()) {
    const rect = card.getBoundingClientRect();
    const endX = rect.left + rect.width/2 - bounds.left;
    const upper = rect.top < hub.top;
    const endY = (upper ? rect.bottom : rect.top) - bounds.top;
    const dx = endX - x, dy = endY - y;
    const distance = Math.hypot(dx,dy) || 1;
    const startX = x + dx/distance * hub.width/2;
    const startY = y + dy/distance * hub.height/2;
    const midY = (startY + endY) / 2;
    const coordinates = [startX,startY,midY,endX,endY].map(value=>Math.round(value * 2) / 2);
    geometry.push({id:card.dataset.pc,online:!card.matches('.offline,.waiting'),coordinates});
  }
  const signature = JSON.stringify([Math.round(bounds.width),Math.round(bounds.height),geometry]);
  if (signature === board.linkSignature) return;
  board.linkSignature = signature;
  board.links.setAttribute('viewBox','0 0 ' + bounds.width + ' ' + bounds.height);
  board.links.replaceChildren();
  board.paths.clear();
  geometry.forEach(({id, online, coordinates:[sx,sy,my,ex,ey]},index)=>{
    const group = svgElement('g',{class:'topology-link' + (online ? '' : ' is-offline')});
    const path = svgElement('path',{d:'M ' + sx + ' ' + sy + ' C ' + sx + ' ' + my + ' ' + ex + ' ' + my + ' ' + ex + ' ' + ey});
    group.append(path);
    board.links.append(group);
    board.paths.set(id,group);
    if (online) animateLink(group,path,index);
    if (board.cards.get(id)?.card.matches(':hover,:focus-within')) group.classList.add('highlight');
  });
}
function createTopology(content) {
  const root = el('section',undefined,'topology-page');
  const empty = el('section',undefined,'panel topology-empty');
  empty.append(el('p','Aucun PC sélectionné pour Nœuds.'),button('Choisir les PC',()=>go('settings'),'gear'));
  const map = el('div',undefined,'topology-map');
  const links = svgElement('svg',{class:'topology-links','aria-hidden':'true'});
  const upper = el('div',undefined,'topology-band');
  const lower = el('div',undefined,'topology-band');
  const hub = el('div',undefined,'topology-hub');
  hub.title = 'Coordinateur · représentation visuelle';
  hub.append(icon('disk'),el('strong','DB'));
  map.append(links,upper,hub,lower);
  root.append(header('Nœuds'),empty,map);
  content.append(root);
  const board = {root,empty,map,links,upper,hub,lower,cards:new Map(),paths:new Map()};
  board.observer = new ResizeObserver(()=>drawTopologyLinks(board));
  board.observer.observe(map);
  return board;
}
function renderNodes(content) {
  if (!topology?.root.isConnected) topology = createTopology(content);
  const board = topology;
  const included = pcs.filter(pc=>pc.inTopology === true);
  board.empty.hidden = !!included.length;
  board.map.hidden = !included.length;
  const stillIncluded = new Set(included.map(pc=>pc.id));
  for (const [id,entry] of board.cards) {
    if (stillIncluded.has(id)) continue;
    board.observer.unobserve(entry.card);
    entry.card.remove();
    board.cards.delete(id);
  }
  included.forEach((pc,index)=>{
    const record = state.get(pc.id);
    const online = record?.level && !['waiting','offline'].includes(record.level);
    const programs = online ? topologyPrograms(pc).filter(program=>program.state === 'on') : [];
    const band = index < 2 ? board.upper : board.lower;
    let entry = board.cards.get(pc.id);
    const signature = JSON.stringify([pc.name,record?.level,topologyPrograms(pc).length,programs]);
    if (entry?.signature !== signature) {
      const card = topologyCard(pc,record,programs);
      const highlight = active => board.paths.get(pc.id)?.classList.toggle('highlight',active);
      card.onpointerenter = () => highlight(true);
      card.addEventListener('focusin',()=>highlight(true));
      card.onpointerleave = () => highlight(card.matches(':focus-within'));
      card.addEventListener('focusout',event=>{if (!card.contains(event.relatedTarget)) highlight(card.matches(':hover'));});
      if (entry) {
        board.observer.unobserve(entry.card);
        entry.card.replaceWith(card);
      }
      board.observer.observe(card);
      entry = {card,signature};
      board.cards.set(pc.id,entry);
    }
    if (entry.card.parentElement !== band) band.append(entry.card);
    const lastSignal = lastSignals[pc.id];
    entry.card.querySelector('.topology-signal').textContent = 'Dernier signal · ' +
      (lastSignal ? date(lastSignal) : 'Aucun');
  });
  board.lower.hidden = included.length <= 2;
  drawTopologyLinks(board);
  renderTopologyPanel();
}

function renderSettings(content) {
  content.append(header('Paramètres',addButton()));
  const panel = el('section',undefined,'panel');
  if (!pcs.length) panel.append(el('p','Aucun PC configuré.','muted'));
  for (const pc of pcs) {
    const row = el('div',undefined,'settings-row');
    const actions = el('div',undefined,'actions');
    const remove = button('Supprimer',()=>removePc(pc),'trash');
    remove.className = 'danger';
    actions.append(button('Modifier',()=>edit(pc),'gear'),button('Wake-on-LAN',()=>editWake(pc)),remove);
    const title = el('div',undefined,'node-setting');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = pc.inTopology === true;
    check.onchange = () => {
      pc.inTopology = check.checked;
      save();
    };
    const label = el('label',undefined,'node-check');
    label.append(check,document.createTextNode('Afficher dans Nœuds'));
    title.append(el('strong',pc.name),label);
    row.append(title,actions);
    panel.append(row);
  }
  content.append(panel);
}
function removePc(pc) {
  if (!window.confirm('Supprimer « ' + pc.name + ' » de cette application ?')) return;
  const index = pcs.indexOf(pc);
  if (index === -1) return;
  pcs.splice(index,1);
  state.delete(pc.id);
  delete lastSignals[pc.id];
  localStorage.setItem('pulsepc.lastSignals',JSON.stringify(lastSignals));
  if (active === pc.id) active = pcs[0]?.id;
  for (const item of pcs) {
    if (item.relay === pc.id) {item.relay = ''; item.target = '';}
  }
  save();
  render();
}

const programRequests = new Set();
const programActions = new Set();
const programLabels = {on:'ON',off:'OFF',pending:'En cours',missing:'Introuvable',unknown:'Indisponible'};
let detailSection = 'metrics';

async function refreshPrograms(pc, force = false) {
  const record = state.get(pc.id);
  if (record?.level === 'offline' || !(record?.data?.apiVersion >= 4) || programRequests.has(pc.id)) return;
  if (!force && Date.now() - (record.programs?.loaded || 0) < (view === 'nodes' ? 12000 : 4500)) return;
  programRequests.add(pc.id);
  let result;
  try {
    const response = await api(pc,'/api/programs');
    result = {items:response.programs};
  } catch (error) {
    result = {error:error.message};
  } finally {
    programRequests.delete(pc.id);
  }
  const latest = state.get(pc.id);
  if (!pcs.includes(pc) || !latest) return;
  latest.programs = {...result,loaded:Date.now()};
  if ((view === 'detail' && detailSection === 'programs' && active === pc.id) || (view === 'nodes' && pc.inTopology === true)) render();
}
async function toggleProgram(pc, program) {
  const key = pc.id + ':' + program.id;
  if (programActions.has(key)) return;
  const operation = program.state === 'on' ? 'stop' : 'start';
  programActions.add(key);
  render();
  try {
    await api(pc,'/api/action',{action:'program-' + operation,target:program.id});
    q('#feedback').textContent = 'Commande envoyée à ' + program.name + '.';
  } catch (error) {
    q('#feedback').textContent = error.message;
  } finally {
    programActions.delete(key);
    await refreshPrograms(pc,true);
    render();
  }
}
function dialogBody(title) {
  const dialog = q('#program-dialog');
  const body = q('#program-dialog-body');
  body.replaceChildren(el('h2',title));
  dialog.showModal();
  return body;
}
function dialogCloseButton() {
  const close = button('Fermer',()=>q('#program-dialog').close());
  close.type = 'button';
  return close;
}
async function withProgramConfig(pc,title,prepare) {
  const body = dialogBody(title);
  const loading = el('p','Lecture de la liste…','muted');
  body.append(loading);
  try {
    const config = await api(pc,'/api/programs/config');
    if (q('#program-dialog').open && body.contains(loading)) {
      loading.remove();
      prepare(body,config);
    }
  } catch (error) {
    loading.textContent = error.message;
    body.append(dialogCloseButton());
  }
}
async function savePrograms(pc, config, programs) {
  await api(pc,'/api/programs/config',{revision:config.revision,programs});
  q('#program-dialog').close();
  await refreshPrograms(pc,true);
  render();
}
function setupForm(body) {
  const form = el('form');
  form.noValidate = false;
  const error = el('p',undefined,'program-dialog-error');
  error.setAttribute('role','alert');
  body.append(form);
  return {form,error};
}
function field(parent,labelText,input) {
  const label = el('label');
  label.append(document.createTextNode(labelText),input);
  parent.append(label);
  return label;
}
function programEditor(pc, id) {
  withProgramConfig(pc,id ? 'Modifier le programme' : 'Ajouter un programme',(body,config)=>{
    const existing = config.programs.find(entry=>entry.id === id);
    if (id && !existing) {body.append(el('p','Ce programme a été supprimé.'),dialogCloseButton());return;}
    const {form,error} = setupForm(body);
    const name = el('input');
    name.maxLength=80;
    name.required=true;
    name.value=existing?.name || '';
    field(form,'Nom à afficher',name);
    const kind = el('select');
    for (const [key,label] of Object.entries({systemd:'Service Debian (systemd)',docker:'Conteneur Docker',custom:'Commandes personnalisées'})) {
      kind.add(new Option(label,key));
    }
    kind.value=existing?.kind || 'systemd';
    field(form,'Type de programme',kind);
    const target = el('input');
    target.value=existing?.target || '';
    target.maxLength=128;
    target.spellcheck=false;
    const targetField = field(form,'Nom du service ou conteneur sur Debian',target);
    const advanced = el('details',undefined,'program-advanced');
    advanced.append(el('summary','Options avancées'));
    const note = el('textarea');
    note.value=existing?.note || '';
    note.maxLength=300;
    note.rows=2;
    field(advanced,'Note',note);
    const commandFields = el('div');
    commandFields.append(el('p','Choisis des profils approuvés sur ce Debian. Le dossier de travail est défini dans chaque profil.','muted'));
    const selectors = {};
    for (const [operation,label] of Object.entries({start:'Commande ON',stop:'Commande OFF',status:'Vérification de l’état'})) {
      const select = el('select');
      select.add(new Option('Choisir un profil',''));
      for (const profile of config.profiles.filter(profile=>profile.operation===operation)) {
        select.add(new Option(profile.name + ' · ' + profile.cwd,profile.id));
      }
      const old = existing?.[operation];
      if (old && !Array.from(select.options).some(option=>option.value===old)) {
        select.add(new Option(old + ' · profil introuvable',old));
      }
      select.value=old || '';
      selectors[operation] = select;
      field(commandFields,label,select);
    }
    const commandPreview = el('pre',undefined,'program-command-preview');
    advanced.append(commandFields,commandPreview);
    form.append(advanced);
    function updateFields() {
      const custom = kind.value === 'custom';
      targetField.hidden = target.disabled = custom;
      target.required = !custom;
      target.placeholder = kind.value === 'docker' ? 'nom-du-conteneur' : 'mon-programme.service';
      commandFields.hidden = !custom;
      commandPreview.hidden = custom;
      for (const select of Object.values(selectors)) {
        select.disabled = !custom;
        select.required = custom;
      }
      if (custom) advanced.open = true;
      const name = target.value.trim() || target.placeholder;
      const commands = kind.value === 'docker'
        ? ['docker start ','docker stop ','docker inspect ']
        : ['systemctl start ','systemctl stop ','systemctl is-active '];
      commandPreview.textContent=commands.map(command=>command+name).join('\n');
    }
    kind.onchange=updateFields;
    target.oninput=updateFields;
    updateFields();
    const actions = el('div',undefined,'actions');
    const save = el('button','Enregistrer','primary');
    save.type='submit';
    actions.append(dialogCloseButton(),save);
    form.append(error,actions);
    form.onsubmit=async event=>{
      event.preventDefault();
      save.disabled=true;
      error.textContent='';
      const entry = {id:existing?.id || 'p-' + crypto.randomUUID(),name:name.value.trim(),kind:kind.value,note:note.value.trim()};
      if (entry.kind === 'custom') for (const [operation, select] of Object.entries(selectors)) entry[operation]=select.value;
      else entry.target=target.value.trim();
      const programs=existing ? config.programs.map(item=>item.id===id ? entry : item) : [...config.programs,entry];
      try {await savePrograms(pc,config,programs);}
      catch (failure) {error.textContent=failure.message;save.disabled=false;}
    };
  });
}
function removeProgram(pc,id) {
  withProgramConfig(pc,'Retirer le programme',(body,config)=>{
    const entry=config.programs.find(item=>item.id===id);
    if (!entry) {body.append(el('p','Programme introuvable.'),dialogCloseButton());return;}
    const error=el('p',undefined,'program-dialog-error');
    const remove=button('Retirer',async()=>{
      remove.disabled=true;
      try {await savePrograms(pc,config,config.programs.filter(item=>item.id!==id));}
      catch (failure) {error.textContent=failure.message;remove.disabled=false;}
    },'trash');
    remove.className='danger';
    const actions=el('div',undefined,'actions');
    actions.append(dialogCloseButton(),remove);
    body.append(el('p','Retirer « ' + entry.name + ' » de la liste PulsePC ? Le programme conserve son état.'),error,actions);
  });
}
function checklist(container,entries,defaultChecked) {
  const list=el('div',undefined,'program-checklist');
  const controls=entries.map(entry=>{
    const input=el('input');
    input.type='checkbox';
    input.checked=defaultChecked(entry);
    const label=el('label',undefined,'program-check');
    const identity=el('span');
    identity.append(el('strong',entry.name),el('small',entry.detail || entry.kind));
    label.append(input,identity);
    list.append(label);
    return {input,entry};
  });
  container.append(list);
  return controls;
}
function exportPrograms(pc) {
  withProgramConfig(pc,'Exporter des programmes',(body,config)=>{
    if (!config.programs.length) {body.append(el('p','La liste de ce PC est vide.'),dialogCloseButton());return;}
    body.append(el('p','Coche les programmes à inclure.','muted'));
    const controls=checklist(body,config.programs,()=>true);
    const feedback=el('p',undefined,'program-dialog-error');
    const copy=button('Copier le JSON',async()=>{
      try {await navigator.clipboard.writeText(json());feedback.textContent='Copié.';}
      catch {output.hidden=false;output.value=json();output.select();}
    });
    const download=button('Enregistrer le fichier',()=>{
      const data=json();
      if (window.pulsepcFiles?.postMessage) {window.pulsepcFiles.postMessage(data);return;}
      const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
      const link=el('a');
      link.href=url;
      link.download='PulsePC-programmes.json';
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    });
    const output=el('textarea');
    output.readOnly=true;
    output.rows=5;
    output.hidden=true;
    const json=()=>JSON.stringify({format:'pulsepc-programs',version:1,programs:controls.filter(item=>item.input.checked).map(item=>item.entry)},null,2);
    function refreshSelection() {
      copy.disabled=download.disabled=!controls.some(item=>item.input.checked);
      output.hidden=true;
    }
    for (const item of controls) item.input.onchange=refreshSelection;
    const actions=el('div',undefined,'actions');
    actions.append(dialogCloseButton(),copy,download);
    body.append(output,feedback,actions);
  });
}
function parsePrograms(text) {
  if (new TextEncoder().encode(text).length > 65536) throw Error('Le fichier dépasse 64 Kio.');
  const document=JSON.parse(text);
  if (document?.format !== 'pulsepc-programs' || document.version !== 1 || !Array.isArray(document.programs)
      || !document.programs.length || document.programs.length > 40) throw Error('Ce fichier ne contient pas une liste PulsePC valide.');
  const idPattern=/^[a-z0-9][a-z0-9_-]{0,39}$/;
  const ids=new Set();
  return document.programs.map(entry=>{
    if (!entry || typeof entry.id !== 'string' || !idPattern.test(entry.id) || ids.has(entry.id)
        || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 80
        || !['systemd','docker','custom'].includes(entry.kind)) throw Error('Un programme du fichier est invalide.');
    ids.add(entry.id);
    const data={id:entry.id,name:entry.name,kind:entry.kind,note:typeof entry.note === 'string' ? entry.note : ''};
    if (entry.kind === 'custom') {
      for (const operation of ['start','stop','status']) {
        if (typeof entry[operation] !== 'string' || !idPattern.test(entry[operation])) throw Error('Profil personnalisé invalide.');
        data[operation]=entry[operation];
      }
    } else {
      if (typeof entry.target !== 'string') throw Error('Nom de service ou de conteneur manquant.');
      data.target=entry.target;
    }
    return data;
  });
}
function importPrograms(pc) {
  withProgramConfig(pc,'Importer des programmes',(body,config)=>{
    const input=el('input');
    input.type='file';
    input.accept='.json,application/json';
    field(body,'Fichier PulsePC',input);
    const source=el('textarea');
    source.rows=4;
    field(body,'Ou colle le JSON',source);
    const preview=el('section');
    const error=el('p',undefined,'program-dialog-error');
    error.setAttribute('role','alert');
    const save=button('Importer la sélection',async()=>{
      save.disabled=true;
      const result=new Map(config.programs.map(entry=>[entry.id,entry]));
      for (const item of controls.filter(item=>item.input.checked)) {
        const {detail,...entry}=item.entry;
        result.set(entry.id,entry);
      }
      try {await savePrograms(pc,config,[...result.values()]);}
      catch (failure) {error.textContent=failure.message;save.disabled=false;}
    });
    let controls=[];
    save.disabled=true;
    function refresh() {
      preview.replaceChildren();
      error.textContent='';
      save.disabled=true;
      controls=[];
      if (!source.value.trim()) return;
      try {
        const existing=new Set(config.programs.map(entry=>entry.id));
        const profiles=new Set(config.profiles.map(profile=>profile.id + ':' + profile.operation));
        const entries=parsePrograms(source.value).map(entry=>{
          const notes=[entry.kind];
          if (existing.has(entry.id)) notes.push('remplace une entrée');
          if (entry.kind==='custom' && ['start','stop','status'].some(operation=>!profiles.has(entry[operation]+':'+operation))) {
            notes.push('profils à approuver sur ce Debian');
          }
          return {...entry,detail:notes.join(' · ')};
        });
        controls=checklist(preview,entries,entry=>!existing.has(entry.id));
        const update=()=>{save.disabled=!controls.some(item=>item.input.checked);};
        for (const item of controls) item.input.onchange=update;
        update();
      } catch (failure) {error.textContent=failure instanceof SyntaxError ? 'JSON invalide.' : failure.message;}
    }
    source.oninput=refresh;
    input.onchange=async()=>{
      const file=input.files[0];
      if (!file) return;
      if (file.size>65536) {error.textContent='Le fichier dépasse 64 Kio.';return;}
      try {source.value=await file.text();refresh();}
      catch {error.textContent='Impossible de lire ce fichier.';}
    };
    const actions=el('div',undefined,'actions');
    actions.append(dialogCloseButton(),save);
    body.append(preview,error,actions);
  });
}


function renderPrograms(content, pc, record) {
  const panel = el('section',undefined,'panel programs');
  const toolbar=el('div',undefined,'pane-heading programs-toolbar');
  toolbar.append(el('h2','Programmes'));
  const editable=pc.control && record?.data?.apiVersion >= 5 && record?.level !== 'offline';
  if (editable) {
    const actions=el('div',undefined,'actions');
    const add=button('Ajouter un programme',()=>programEditor(pc),'plus');
    add.className='primary';
    actions.append(add,button('Importer',()=>importPrograms(pc)),button('Exporter',()=>exportPrograms(pc)));
    toolbar.append(actions);
  }
  panel.append(toolbar);
  if (record?.level === 'offline') {
    panel.append(el('p','Le PC est hors ligne.','muted'));
  } else if (!(record?.data?.apiVersion >= 4)) {
    panel.append(el('p','Mets à jour l’agent PulsePC sur ce Debian pour gérer ses programmes.','muted'));
  } else if (record.programs?.error) {
    panel.append(el('p',record.programs.error,'muted'));
  } else if (!record.programs) {
    panel.append(el('p','Lecture de l’état des programmes…','muted'));
  } else if (!record.programs.items?.length) {
    panel.append(el('p','Aucun programme configuré pour ce PC.','muted'));
  } else {
    if (!pc.control) panel.append(el('p','Ajoute un jeton d’appairage avec les droits de commande pour démarrer ou arrêter les programmes.','muted'));
    for (const program of record.programs.items) {
      const row = el('div',undefined,'program-row program-' + program.state);
      const identity = el('div',undefined,'program-name');
      const info = el('div');
      const type = {docker:'Docker',systemd:'Service Debian',custom:'Commandes personnalisées'};
      info.append(el('strong',program.name),el('small',type[program.kind] || program.kind));
      if (program.note) info.append(el('small',program.note));
      identity.append(icon('apps'),info);
      const pending = programActions.has(pc.id + ':' + program.id);
      const toggle = button(program.state === 'on' ? 'Arrêter' : 'Démarrer',()=>toggleProgram(pc,program));
      toggle.disabled = !pc.control || pending || !['on','off'].includes(program.state);
      const status = el('span',pending ? 'En cours' : programLabels[program.state] || 'Indisponible','program-status');
      const controls=el('div',undefined,'actions program-controls');
      controls.append(toggle);
      if (editable) controls.append(button('Modifier',()=>programEditor(pc,program.id),'gear'),
        button('Retirer',()=>removeProgram(pc,program.id),'trash'));
      row.append(identity,status,controls);
      panel.append(row);
    }
  }
  content.append(panel);
}

function renderDetail(content,pc) {
  const record = state.get(pc.id);
  const data = record?.data;
  const crumbs = el('div',undefined,'crumbs');
  crumbs.append(button('Vue d’ensemble',()=>go('overview')),el('span','/','muted'),el('span',pc.name));
  const title = el('header',undefined,'title');
  const identity = el('div');
  const name = el('div',undefined,'title-group');
  name.append(el('h1',pc.name),badge(record?.level || 'waiting'));
  identity.append(name);
  if (data) identity.append(el('p','Allumé depuis ' + duration(data.uptime),'uptime'));
  if (record?.error) identity.append(el('p',record.error,'muted'));
  title.append(identity);
  if (desktop) {
    const ssh = button('Se connecter',()=>connect(pc),'terminal');
    ssh.className = 'primary';
    title.append(ssh);
  }
  const actions = el('section',undefined,'panel action-strip');
  const restart = button('Redémarrer',()=>send(pc,'reboot'),'restart');
  const stop = button('Éteindre',()=>send(pc,'poweroff'),'power');
  restart.disabled = stop.disabled = !(data?.apiVersion >= 2 && pc.control && record?.level !== 'offline');
  if (restart.disabled) restart.title = stop.title = 'PC en ligne et jeton de commande requis';
  actions.append(el('h2','Actions'),restart,stop,button('Paramètres',()=>edit(pc),'gear'));
  if (pc.relay && pc.target) actions.append(button('Wake-on-LAN',()=>send(pc,'wake')));
  content.append(crumbs,title,actions);
  const sections = el('div',undefined,'segments detail-tabs');
  sections.setAttribute('aria-label','Tableau de bord du PC');
  const measures = button('Mesures',()=>{detailSection='metrics';render();refreshHistory(pc);},'chart');
  const programs = button('Programmes',()=>{detailSection='programs';render();refreshPrograms(pc,true);},'apps');
  measures.setAttribute('aria-pressed',String(detailSection === 'metrics'));
  programs.setAttribute('aria-pressed',String(detailSection === 'programs'));
  sections.append(measures,programs);
  content.append(sections);
  if (detailSection === 'programs') {
    renderPrograms(content,pc,record);
    return;
  }

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
  for (const definition of [readings[2],readings[0],readings[1],readings[3],...extraReadings]) {
    const value = definition.value(data);
    const metric = el('article',undefined,'panel metric ' + severity(value,definition));
    const label = el('h3');
    label.append(icon(definition.icon),document.createTextNode(definition.label));
    metric.append(label,el('div',readingText(value,definition),'value'));
    if (samples.some(point => Number.isFinite(point[definition.id]))) {
      const max = definition.max ?? Math.max(1,Math.ceil(Math.max(value ?? 0,...samples.map(sample=>sample.load ?? 0))));
      metric.append(chart(samples,{...definition,max},range.seconds,end,history.usePeriod ? range.bucket : 5));
    } else {
      const empty = definition.id === 'gpu' && value == null ? 'Aucune utilisation GPU exposée par le pilote.' : 'Aucune mesure disponible sur cette période.';
      metric.append(el('small', history?.error || empty,'chart-empty muted'));
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
    if (definition.id === 'load') metric.append(el('small','Moyenne sur 1 min'));
    if (definition.id === 'gpu' && data?.gpu?.name) metric.append(el('small',data.gpu.name));
    grid.append(metric);
  }
  panel.append(grid);
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
  for (const item of document.querySelectorAll('nav button')) {
    if (item.dataset.view === (view === 'detail' ? 'overview' : view)) item.setAttribute('aria-current','page');
    else item.removeAttribute('aria-current');
  }
  if (view === 'nodes') {
    if (!topology?.root.isConnected) content.replaceChildren();
    renderNodes(content);
    return;
  }
  if (topology) {
    topology.observer.disconnect();
    topology = null;
  }
  closeTopologyPanel();
  const focused = content.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON'
    ? Array.from(content.querySelectorAll('button')).indexOf(document.activeElement) : -1;
  content.replaceChildren();
  const pc = pcs.find(item => item.id === active);
  if (view === 'detail' && pc) renderDetail(content,pc);
  else if (view === 'settings') renderSettings(content);
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
function showSetup(showInstall) {
  q('#debian-setup').hidden = !showInstall;
  q('#pc-form').hidden = showInstall;
  q('#setup-tab').setAttribute('aria-pressed',String(showInstall));
  q('#connect-tab').setAttribute('aria-pressed',String(!showInstall));
  q('#setup-feedback').textContent = '';
}
async function copySetup(selector) {
  try {
    await navigator.clipboard.writeText(q(selector).textContent);
    q('#setup-feedback').textContent = 'Copié.';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(q(selector));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    q('#setup-feedback').textContent = 'Commande sélectionnée, tu peux la copier.';
  }
}
q('#setup-tab').onclick = () => showSetup(true);
q('#connect-tab').onclick = q('#setup-next').onclick = () => showSetup(false);
q('#setup-cancel').onclick = () => q('#editor').close();
q('#copy-install').onclick = () => copySetup('#install-code');
q('#copy-pair').onclick = () => copySetup('#pair-code');

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
  q('.setup-tabs').hidden = !!pc;
  showSetup(!pc);
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
    if (!editing) go('overview');
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
q('#topology-close').onclick = () => closeTopologyPanel(true);
document.addEventListener('keydown',event=>{
  if (event.key === 'Escape' && !q('#topology-panel').hidden && !document.querySelector('dialog[open]')) closeTopologyPanel(true);
});
const navIcons = {overview:'home',nodes:'nodes',settings:'gear'};
for (const item of document.querySelectorAll('nav button')) {
  item.prepend(icon(navIcons[item.dataset.view]));
  item.addEventListener('click',()=>go(item.dataset.view));
}
render();
poll();
setInterval(poll,5000);
