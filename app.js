'use strict';
const q = selector => document.querySelector(selector);
const desktop = window.pulsepcDesktop;
const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const pcs = load('pulsepc.pcs', []);
const state = new Map();
const labels = {green:'Normal', orange:'Attention', red:'Critique', offline:'Hors ligne', waiting:'En attente'};
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
async function poll() {
  if (busy) return;
  busy = true;
  try {
    await Promise.all(pcs.map(async pc => {
      const previous = state.get(pc.id) || {};
      try {
        const data = await api(pc, '/api/status');
        const history = data.apiVersion >= 2 ? await api(pc, '/api/history').catch(() => previous.history) : null;
        if (pcs.includes(pc)) state.set(pc.id, {data, history, level:data.status?.level || 'waiting'});
      } catch (error) {
        if (pcs.includes(pc)) state.set(pc.id, {...previous, level:'offline',
          error:error.name === 'AbortError' || error instanceof TypeError ? 'Agent injoignable. Vérifie Tailscale et l’adresse.' : error.message});
      }
    }));
    render();
  } finally { busy = false; }
}
function badge(level) {return el('span', labels[level] || labels.waiting, 'badge ' + level);}
function chart(samples, key, maximum) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 180 50');
  svg.setAttribute('class','chart');
  svg.setAttribute('aria-hidden','true');
  svg.setAttribute('preserveAspectRatio','none');
  let part = [];
  const flush = () => {
    if (part.length < 2) {part = []; return;}
    const line = document.createElementNS(ns,'polyline');
    line.setAttribute('points', part.join(' '));
    line.setAttribute('fill','none');
    line.setAttribute('stroke','currentColor');
    line.setAttribute('stroke-width','2');
    svg.append(line);
    part = [];
  };
  samples.forEach((sample, i) => {
    const value = sample[key];
    if (!Number.isFinite(value)) flush();
    else part.push((i * 180 / Math.max(1,samples.length - 1)) + ',' + (48 - 46 * Math.max(0,Math.min(value / maximum,1))));
  });
  flush();
  return svg;
}
function metric(title, value, detail, samples, key, maximum=100) {
  const card = el('article', undefined, 'panel');
  card.append(el('h3', title), el('div', value, 'value'));
  if (detail) card.append(typeof detail === 'string' ? el('small', detail) : detail);
  if (key && samples.length > 1) card.append(chart(samples,key,maximum));
  return card;
}
function render() {
  const cards = q('#devices');
  const detail = q('#detail');
  cards.replaceChildren();
  detail.replaceChildren();
  if (!pcs.length) cards.append(el('p','Ajoute une machine avec son adresse Tailscale et son jeton de suivi.','muted'));
  for (const pc of pcs) {
    const record = state.get(pc.id);
    const card = button('', () => {active=pc.id;save();render();});
    card.className = 'card';
    card.setAttribute('aria-pressed', String(pc.id === active));
    const reason = record?.error || record?.data?.status?.reason || '';
    card.append(el('strong',pc.name),badge(record?.level || 'waiting'),el('p',reason,'muted'));
    cards.append(card);
  }
  const pc = pcs.find(item => item.id === active);
  if (!pc) return;
  const record = state.get(pc.id);
  const data = record?.data;
  const header = el('section', undefined,'panel');
  const title = el('div',undefined,'title');
  title.append(el('h2',pc.name),badge(record?.level || 'waiting'));
  header.append(title);
  if (data) header.append(el('p','Allumé depuis ' + duration(data.uptime) + ' · Mesure du ' + date(data.updated),'muted'));
  const actions = el('div',undefined,'actions');
  actions.append(button('Paramètres', () => edit(pc)));
  if (desktop) actions.append(button('Se connecter', async () => {
    try { await desktop.connect(pc.url, pc.ssh || 'alex'); }
    catch (error) { q('#feedback').textContent = error.message; }
  }));
  if (record?.level !== 'offline' && data?.apiVersion >= 2 && pc.control) {
    actions.append(button('Éteindre',() => send(pc,'poweroff')),button('Redémarrer',() => send(pc,'reboot')));
  }
  if (pc.relay && pc.target) actions.append(button('Wake-on-LAN',() => send(pc,'wake')));
  header.append(actions);
  detail.append(header);
  if (data) {
    const samples = record.history?.samples || [];
    const {cpu={},memory={},disk={},gpu,temperature} = data;
    const grid = el('section',undefined,'grid metrics');
    const ram = el('dl');
    for (const [label,value] of [['Utilisée', memory.used],['Disponible', memory.available],['Libre', memory.free],['Cache', memory.cached],['Totale',memory.total]]) {
      const row = el('div');
      row.append(el('dt',label),el('dd',bytes(value)));
      ram.append(row);
    }
    grid.append(metric('Processeur',pct(cpu.usage),cpu.name,samples,'cpu'),
      metric('Température CPU',temperature == null ? '—' : temperature + ' °C',null,samples,'temperature',110),
      metric('Mémoire vive',pct(ratio(memory)),ram,samples,'ram'),
      metric('Stockage /',pct(disk.percent ?? ratio(disk)),bytes(disk.used) + ' / ' + bytes(disk.total),samples,'disk'),
      metric('Carte graphique',pct(gpu?.usage),gpu?.name || 'Capteur non détecté',samples),
      metric('Charge système',String(cpu.load ?? '—'),'Moyenne sur 1 minute',samples));
    detail.append(grid);
  }
  const history = el('section',undefined,'panel');
  history.append(el('h3','Historique des états'));
  const events = record?.history?.events;
  if (events?.length) {
    const list = el('ul',undefined,'history');
    for (const event of events.slice().reverse()) list.append(el('li',date(event.time) + ' · ' + labels[event.level] + ' · ' + event.reason,event.level));
    history.append(list);
  } else history.append(el('p','Aucun événement disponible.','muted'));
  detail.append(history);
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
function edit(pc) {
  editing = pc;
  const form = q('form');
  form.reset();
  q('#editError').textContent = '';
  q('#sshField').hidden = !desktop;
  const relay = form.elements.relay;
  relay.replaceChildren(new Option('Aucun',''));
  for (const item of pcs.filter(item => item !== pc)) relay.add(new Option(item.name,item.id));
  if (pc) for (const key of ['name','url','token','control','ssh','relay','target']) form.elements[key].value = pc[key] || '';
  q('#editor').showModal();
}
q('form').onsubmit = event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error();
    data.url = url.origin;
  } catch { q('#editError').textContent = 'Utilise une adresse HTTPS sans identifiants dans l’URL.'; return; }
  const pc = {...data,id:editing?.id || crypto.randomUUID()};
  if (editing) pcs.splice(pcs.indexOf(editing),1,pc);
  else pcs.push(pc);
  state.delete(pc.id);
  active = pc.id;
  save();
  q('#editor').close();
  render();
  poll();
};
q('#add').onclick = () => edit();
if (!pcs.some(pc => pc.id === active)) active = pcs[0]?.id;
render();
poll();
setInterval(poll, 5000);
