(function(){"use strict";
function one(el){el.style.cssText=el.getAttribute('data-s');el.removeAttribute('data-s');}
function sweep(node){if(node.nodeType!==1)return;if(node.hasAttribute('data-s'))one(node);node.querySelectorAll('[data-s]').forEach(one);}
sweep(document.documentElement);
new MutationObserver(function(list){list.forEach(function(m){m.addedNodes.forEach(sweep);});}).observe(document.documentElement,{childList:true,subtree:true});
})();
(function(){
"use strict";
const D = JSON.parse(document.getElementById('data').textContent);
const P = D.players, W = D.weeks, WK = D.weekly, N = P.length, L = D.lists;
const BY = {}; P.forEach(p => BY[p.name] = p);
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const sgn = n => (n > 0 ? '+' : '') + n;
const f1 = n => Number(n).toFixed(1);
const f2 = n => Number(n).toFixed(2);

/* tooltip */
const tip = $('tip');
function showTip(e, text){
  tip.textContent = text; tip.classList.add('on');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY - h - 8;
  if (x + w > window.innerWidth - 6) x = Math.max(6, e.clientX - w - 14);
  if (y < 6) y = e.clientY + 16;
  tip.style.transform = 'translate(' + x + 'px,' + y + 'px)';
}
function hideTip(){ tip.classList.remove('on'); }
document.addEventListener('pointermove', e => {
  const el = e.target.closest && e.target.closest('[data-t]');
  if (el) showTip(e, el.dataset.t); else if (!e.target.closest || !e.target.closest('[data-custom]')) hideTip();
});
window.addEventListener('scroll', hideTip, {passive:true});

/* theme */
(function(){
  const root = document.documentElement, btn = $('theme');
  let saved = null;
  try { saved = localStorage.getItem('gs-theme'); } catch(e) {}
  if (saved) root.dataset.theme = saved;
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const label = () => { btn.textContent = isDark() ? 'Light mode' : 'Dark mode'; };
  label();
  btn.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('gs-theme', root.dataset.theme); } catch(e) {}
    label();
  });
})();

/* chart helpers */
function widthOf(host){ return Math.max(260, Math.floor(host.clientWidth)); }
function svgOpen(w, h, label){ return '<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(label)+'">'; }
function declutter(items, gap, top, bot){
  items.sort((a,b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) if (items[i].y - items[i-1].y < gap) items[i].y = items[i-1].y + gap;
  const over = items.length ? items[items.length-1].y - bot : 0;
  if (over > 0) for (let k = items.length-1; k >= 0; k--) { items[k].y -= over; if (k && items[k].y - items[k-1].y >= gap) break; }
  if (items.length && items[0].y < top) { const d = top - items[0].y; items.forEach(i => i.y += d); }
  return items;
}
function sparkSvg(p, w, h){
  const v = [p.start_elo].concat(p.wk_cum), lo = Math.min(...v), hi = Math.max(...v), sp = (hi - lo) || 1;
  const X = i => 2 + i / (v.length - 1) * (w - 6), Y = y => 3 + (hi - y) / sp * (h - 6);
  const d = v.map((y,i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(y).toFixed(1)).join('');
  return '<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" aria-hidden="true"><path class="spark" d="'+d+'"/><circle class="sparkd" cx="'+X(v.length-1).toFixed(1)+'" cy="'+Y(v[v.length-1]).toFixed(1)+'" r="2.4"/></svg>';
}
function bestWeekText(p){
  const i = W.indexOf(p.best_week);
  return 'Week ' + p.best_week + ': ' + sgn(p.best_elo) + ' Elo, ' + p.wk_won[i] + ' for ' + p.wk_mp[i] + ', ' + f1(p.wk_ppct[i]) + '% of points';
}
const draws = [];

/* KPIs and podium */
$('seasonNums').innerHTML = D.kpis.map(k => '<div><div class="n">'+esc(k[0])+'</div><div class="k">'+esc(k[1])+'</div></div>').join('');
$('podiumGrid').innerHTML = P.slice(0,3).map((p,i) =>
  '<div class="pod'+(i===0?' first':'')+'"><span class="pos">'+(i+1)+'</span>'+
  '<div class="nm">'+esc(p.name)+'</div><div class="el">'+p.elo+' Elo</div>'+
  '<div class="rw">'+p.W+' wins &nbsp;/&nbsp; '+f1(p.win_pct)+'% &nbsp;/&nbsp; '+f1(p.pt_pct)+'% of points</div>'+
  '<div class="note">'+esc(D.podium_notes[p.name])+'</div></div>').join('');

/* standings */
(function(){
  const dash = v => v === 0 ? '-' : v;
  const cols = [
    {k:'rank',t:'#',dir:1,l:1},
    {k:'name',t:'Player',dir:1,stick:1},
    {k:'spark',t:'Elo trend',ns:1,l:1,r:p=>sparkSvg(p,84,22)},
    {k:'elo',t:'Elo',dir:-1,b:1},
    {k:'elo_gain',t:'Elo gained',dir:-1,r:p=>sgn(p.elo_gain)},
    {k:'level',t:'Level',dir:-1,r:p=>f2(p.level)},
    {k:'box',t:'Box',dir:1,l:1,r:p=>p.sub?'Substitute':'Member'},
    {k:'avg_rank',t:'Avg rank',dir:1,r:p=>f2(p.avg_rank)},
    {k:'days_at_1',t:'Days at #1',dir:-1,r:p=>dash(p.days_at_1)},
    {k:'best_rank',t:'Best rank',dir:1},
    {k:'low_rank',t:'Lowest rank',dir:1},
    {k:'start_rank',t:'Start rank',dir:1},
    {k:'days_idle',t:'Days idle',dir:1,r:p=>dash(p.days_idle)},
    {k:'W',t:'W',dir:-1},{k:'L',t:'L',dir:1},{k:'played',t:'Played',dir:-1},
    {k:'win_pct',t:'Win %',dir:-1,r:p=>f2(p.win_pct)},
    {k:'weeks_played',t:'Weeks',dir:-1}
  ];
  const head = $('thead'), body = $('tbody');
  let sort = cols[0], filter = '';
  head.innerHTML = cols.map((c,i) => '<th data-i="'+i+'" class="'+(c.ns?'ns ':'')+(c.l?'l ':'')+(c.stick?'stick':'')+'"'+(c.ns?'':' tabindex="0"')+'>'+esc(c.t)+'</th>').join('');
  function list(){
    const out = P.filter(p => p.name.toLowerCase().includes(filter));
    out.sort((a,b) => {
      const x = a[sort.k], y = b[sort.k];
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return (sort.dir * c) || (a.rank - b.rank) || a.name.localeCompare(b.name);
    });
    return out;
  }
  function render(){
    const rows = list();
    $('count').textContent = rows.length + ' shown';
    body.innerHTML = rows.map(p => '<tr data-n="'+esc(p.name)+'">' + cols.map(c => {
      const val = c.r ? c.r(p) : esc(p[c.k]);
      return '<td class="'+(c.l?'l ':'')+(c.stick?'stick':'')+'"'+(c.b?' data-s="font-weight:600"':'')+'>'+val+'</td>';
    }).join('') + '</tr>').join('');
    head.querySelectorAll('th').forEach(th => {
      if (cols[+th.dataset.i] === sort) th.setAttribute('aria-sort', sort.dir === 1 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
  }
  function detail(p){
    const cells = W.map((w,i) => '<div class="c"><b>WK '+w+'</b>' + (p.wk_elo[i] === null
      ? '<s>&middot;</s><b>off</b>'
      : '<s>'+sgn(p.wk_elo[i])+'</s><b>'+p.wk_won[i]+'/'+p.wk_mp[i]+' &middot; '+Math.round(p.wk_ppct[i])+'%</b>') + '</div>').join('');
    const kv = [
      ['Elo start to finish', p.start_elo+' to '+p.elo],
      ['Matches', p.W+' of '+p.played+' won'],
      ['Points won', p.pts_won+' of '+p.pts_played+' ('+f1(p.pt_pct)+'%)'],
      ['Best week', 'Week '+p.best_week+' ('+sgn(p.best_elo)+')'],
      ['Best weekly points %', f1(p.ppct_best)+'%'],
      ['Longest run at 50%+', p.win_streak+(p.win_streak===1?' week':' weeks')]
    ];
    const w = $('tblScroll').clientWidth;
    return '<tr class="detail"><td colspan="'+cols.length+'"><div class="dgrid" data-s="max-width:'+w+'px">'+
      '<div><div class="hl-line">'+esc(p.highlight)+'</div><div class="lab">Elo change, matches, points %</div><div class="wkline">'+cells+'</div></div>'+
      '<div><div class="lab">Season card</div><div class="kv">'+kv.map(r => '<span>'+r[0]+'</span><span>'+esc(r[1])+'</span>').join('')+'</div></div>'+
      '</div></td></tr>';
  }
  body.addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr || !tr.dataset.n) return;
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('detail')) { next.remove(); tr.classList.remove('open'); return; }
    const d = body.querySelector('tr.detail');
    if (d) { d.previousElementSibling.classList.remove('open'); d.remove(); }
    tr.classList.add('open'); tr.insertAdjacentHTML('afterend', detail(BY[tr.dataset.n]));
  });
  function choose(th){ const c = cols[+th.dataset.i]; if (c.ns) return; sort = c; render(); }
  head.addEventListener('click', e => { const th = e.target.closest('th'); if (th) choose(th); });
  head.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.tagName === 'TH') { e.preventDefault(); choose(e.target); } });
  $('search').addEventListener('input', e => { filter = e.target.value.toLowerCase().trim(); render(); });
  render();
})();

/* Elo race */
(function(){
  const host = $('raceChart'), top = P.slice(0,10);
  let selected = null;
  const colorOf = i => i < 3 ? 'var(--c'+(i+1)+')' : 'var(--rest)';
  const series = () => {
    const s = top.map((p,i) => ({p, c:colorOf(i)}));
    if (selected && !top.includes(selected)) s.push({p:selected, c:'var(--text)'});
    return s;
  };
  const vals = p => [p.start_elo].concat(p.wk_cum);
  function setHot(name){
    const active = name || (selected && selected.name);
    host.querySelectorAll('.rg').forEach(g => {
      g.classList.toggle('dim', !!active && g.dataset.n !== active);
      g.classList.toggle('hot', !!active && g.dataset.n === active);
    });
  }
  function draw(){
    const w = widthOf(host), small = w < 560, h = small ? 400 : 520;
    const m = {t:12, r:small ? 74 : 96, b:30, l:42};
    const S = series(), all = [];
    S.forEach(s => all.push(...vals(s.p)));
    const span = Math.max(...all) - Math.min(...all), step = span > 800 ? 200 : 100;
    const lo = Math.floor(Math.min(...all)/step)*step, hi = Math.ceil(Math.max(...all)/step)*step;
    const X = i => m.l + i/W.length*(w-m.l-m.r), Y = v => m.t + (hi-v)/(hi-lo)*(h-m.t-m.b);
    let s = svgOpen(w, h, 'Elo rating across the season for the top ten players');
    for (let v = lo; v <= hi; v += step) s += '<line class="gl" x1="'+m.l+'" x2="'+(w-m.r)+'" y1="'+Y(v)+'" y2="'+Y(v)+'"/><text class="ax" x="'+(m.l-7)+'" y="'+(Y(v)+3.5)+'" text-anchor="end">'+v+'</text>';
    s += '<text class="ax" x="'+X(0)+'" y="'+(h-10)+'" text-anchor="middle">'+(small?'S':'Start')+'</text>';
    W.forEach((wk,i) => { s += '<text class="ax" x="'+X(i+1)+'" y="'+(h-10)+'" text-anchor="middle">'+(small?wk:'W'+wk)+'</text>'; });
    const ends = [];
    S.forEach(sr => {
      const v = vals(sr.p);
      const d = v.map((y,i) => (i?'L':'M')+X(i).toFixed(1)+' '+Y(y).toFixed(1)).join(' ');
      s += '<g class="rg" data-n="'+esc(sr.p.name)+'"><path class="rl" d="'+d+'" data-s="stroke:'+sr.c+'"/>';
      v.forEach((y,i) => { if (i === 0 || sr.p.wk_elo[i-1] !== null) s += '<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(y).toFixed(1)+'" r="2.6" data-s="fill:'+sr.c+'"/>'; });
      s += '</g>';
      ends.push({y:Y(sr.p.elo), y0:Y(sr.p.elo), n:sr.p.name, c:sr.c});
    });
    declutter(ends, 15, m.t+6, h-m.b-4).forEach(l => {
      if (Math.abs(l.y-l.y0) > 1.5) s += '<path d="M'+(w-m.r+2)+' '+l.y0.toFixed(1)+' L'+(w-m.r+8)+' '+l.y.toFixed(1)+'" data-s="stroke:'+l.c+'" fill="none" stroke-width="1"/>';
      s += '<g class="rg" data-n="'+esc(l.n)+'"><text class="rlab" x="'+(w-m.r+11)+'" y="'+(l.y+4.5).toFixed(1)+'">'+esc(l.n)+'</text></g>';
    });
    s += '<line class="xh" id="raceX" visibility="hidden" y1="'+m.t+'" y2="'+(h-m.b)+'" x1="0" x2="0"/><rect data-custom="1" x="'+m.l+'" y="'+m.t+'" width="'+(w-m.l-m.r)+'" height="'+(h-m.t-m.b)+'" fill="transparent" data-s="touch-action:pan-y"/></svg>';
    host.innerHTML = s;
    const svg = host.querySelector('svg'), xh = svg.querySelector('#raceX'), overlay = svg.querySelector('rect[data-custom]');
    overlay.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const i = Math.max(0, Math.min(W.length, Math.round((mx - m.l) / (w-m.l-m.r) * W.length)));
      xh.setAttribute('visibility','visible'); xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i));
      let near = null, dist = 1e9;
      S.forEach(sr => { const d = Math.abs(Y(vals(sr.p)[i]) - my); if (d < dist) { dist = d; near = sr.p.name; } });
      setHot(near);
      const lines = S.map(sr => ({n:sr.p.name, v:vals(sr.p)[i]})).sort((a,b) => b.v - a.v).map(o => String(o.v).padStart(5,' ') + '  ' + o.n);
      showTip(e, (i === 0 ? 'Start' : 'Week ' + W[i-1]) + '\n' + lines.join('\n'));
    });
    overlay.addEventListener('pointerleave', () => { xh.setAttribute('visibility','hidden'); setHot(null); hideTip(); });
    setHot(null);
  }
  function syncUi(){
    $('raceClear').hidden = !selected;
    $('raceStatus').textContent = selected ? 'Showing ' + selected.name : '';
    $('raceChips').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', !!selected && selected.name === b.dataset.n));
  }
  function pick(p){ selected = p; draw(); syncUi(); }
  $('raceChips').innerHTML = top.map((p,i) => '<button type="button" data-n="'+esc(p.name)+'" aria-pressed="false" data-s="border-left-color:'+colorOf(i)+'">'+esc(p.name)+'</button>').join('');
  $('raceChips').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { $('raceSearch').value=''; pick(selected && selected.name === b.dataset.n ? null : BY[b.dataset.n]); } });
  $('raceChips').addEventListener('pointerover', e => { const b = e.target.closest('button'); if (b) setHot(b.dataset.n); });
  $('raceChips').addEventListener('pointerout', () => setHot(null));
  $('raceNames').innerHTML = P.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p => '<option value="'+esc(p.name)+'">').join('');
  $('raceSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) { pick(null); return; }
    const exact = P.filter(p => p.name.toLowerCase() === q);
    const hits = exact.length ? exact : P.filter(p => p.name.toLowerCase().startsWith(q));
    pick(hits.length === 1 ? hits[0] : null);
    if (hits.length !== 1) $('raceStatus').textContent = hits.length ? 'Keep typing' : 'No match';
  });
  $('raceClear').addEventListener('click', () => { $('raceSearch').value=''; pick(null); });
  draws.push(draw);
})();

/* horizontal bars */
function hbar(id, rows){
  const host = $(id);
  draws.push(() => {
    const w = widthOf(host), small = w < 380, rowH = 30;
    const m = {t:4, r:small ? 86 : 104, b:4, l:small ? 78 : 92};
    const h = m.t + m.b + rows.length*rowH, mx = Math.max(...rows.map(r => r.v));
    const X = v => (v/mx)*(w-m.l-m.r);
    let s = svgOpen(w, h, 'Ranked bars');
    s += '<line class="base" x1="'+m.l+'" x2="'+m.l+'" y1="'+m.t+'" y2="'+(h-m.b)+'"/>';
    rows.forEach((r,i) => {
      const y = m.t + i*rowH;
      s += '<g class="row"><rect class="hit" data-t="'+esc(r.tip)+'" x="0" y="'+y+'" width="'+w+'" height="'+rowH+'"/>';
      s += '<rect class="bar" pointer-events="none" x="'+m.l+'" y="'+(y+7)+'" width="'+Math.max(X(r.v),2)+'" height="'+(rowH-14)+'" rx="3"/></g>';
      s += '<text class="nl" pointer-events="none" x="'+(m.l-8)+'" y="'+(y+rowH/2+4)+'" text-anchor="end">'+esc(r.n)+'</text>';
      s += '<text class="vl" pointer-events="none" x="'+(m.l+X(r.v)+7)+'" y="'+(y+rowH/2+4)+'">'+esc(r.label)+'</text>';
    });
    host.innerHTML = s + '</svg>';
  });
}
hbar('gainChart', L.gain.map(n => { const p = BY[n]; return {n, v:p.elo_gain, label:sgn(p.elo_gain), tip:n+'\n'+p.start_elo+' to '+p.elo+' Elo'}; }));
hbar('climbChart', L.climb.map(n => { const p = BY[n]; return {n, v:p.climb, label:'#'+p.start_rank+' to #'+p.rank, tip:n+'\n+'+p.climb+' places, #'+p.start_rank+' to #'+p.rank}; }));

/* scatter */
function scatter(id, cfg){
  const host = $(id);
  draws.push(() => {
    const w = widthOf(host), small = w < 560, h = small ? 340 : 480;
    const m = {t:16, r:16, b:44, l:48};
    const xs = cfg.pts.map(p => p.x), ys = cfg.pts.map(p => p.y);
    const x0 = Math.floor(Math.min(...xs)/cfg.xStep)*cfg.xStep, x1 = Math.ceil(Math.max(...xs)/cfg.xStep)*cfg.xStep;
    const y0 = Math.floor(Math.min(...ys)/cfg.yStep)*cfg.yStep, y1 = Math.ceil(Math.max(...ys)/cfg.yStep)*cfg.yStep;
    const X = v => m.l + (v-x0)/(x1-x0)*(w-m.l-m.r), Y = v => m.t + (y1-v)/(y1-y0)*(h-m.t-m.b);
    let s = svgOpen(w, h, cfg.aria);
    for (let v = y0; v <= y1 + 1e-9; v += cfg.yStep) s += '<line class="gl" x1="'+m.l+'" x2="'+(w-m.r)+'" y1="'+Y(v)+'" y2="'+Y(v)+'"/><text class="ax" x="'+(m.l-7)+'" y="'+(Y(v)+3.5)+'" text-anchor="end">'+cfg.yFmt(v)+'</text>';
    const every = small ? 2 : 1; let tick = 0;
    for (let v = x0; v <= x1 + 1e-9; v += cfg.xStep, tick++) { s += '<line class="gl" y1="'+m.t+'" y2="'+(h-m.b)+'" x1="'+X(v)+'" x2="'+X(v)+'"/>'; if (tick % every === 0) s += '<text class="ax" y="'+(h-m.b+16)+'" x="'+X(v)+'" text-anchor="middle">'+cfg.xFmt(v)+'</text>'; }
    s += '<text class="ax-t" x="'+((m.l+w-m.r)/2)+'" y="'+(h-6)+'" text-anchor="middle">'+esc(cfg.xLab)+'</text>';
    s += '<text class="ax-t" transform="translate(11,'+((m.t+h-m.b)/2)+') rotate(-90)" text-anchor="middle">'+esc(cfg.yLab)+'</text>';
    const a = cfg.fit[0], b = cfg.fit[1];
    const tx0 = Math.max(x0, (y0-b)/a), tx1 = Math.min(x1, (y1-b)/a);
    s += '<line class="trend" x1="'+X(tx0)+'" y1="'+Y(a*tx0+b)+'" x2="'+X(tx1)+'" y2="'+Y(a*tx1+b)+'"/>';
    cfg.pts.filter(p => !p.hl).forEach(p => { s += '<circle class="dot-r" cx="'+X(p.x).toFixed(1)+'" cy="'+Y(p.y).toFixed(1)+'" r="5"/>'; });
    cfg.pts.filter(p => p.hl).forEach(p => { s += '<circle class="dot-a" cx="'+X(p.x).toFixed(1)+'" cy="'+Y(p.y).toFixed(1)+'" r="6"/>'; });
    const labs = cfg.pts.filter(p => p.lab).map(p => ({x:X(p.x), y:Y(p.y), y0:Y(p.y), n:p.n}));
    declutter(labs, 14, m.t+6, h-m.b-6).forEach(l => {
      const left = l.x > w - 90, lx = left ? l.x-10 : l.x+10;
      if (Math.abs(l.y-l.y0) > 2) s += '<line x1="'+l.x.toFixed(1)+'" y1="'+l.y0.toFixed(1)+'" x2="'+lx.toFixed(1)+'" y2="'+l.y.toFixed(1)+'" data-s="stroke:var(--muted)" stroke-width="1"/>';
      s += '<text class="dl" x="'+(left ? lx-2 : lx+2)+'" y="'+(l.y+4).toFixed(1)+'" text-anchor="'+(left?'end':'start')+'">'+esc(l.n)+'</text>';
    });
    s += '<circle class="ring" r="9" visibility="hidden"/><rect data-custom="1" x="0" y="0" width="'+w+'" height="'+h+'" fill="transparent" data-s="touch-action:pan-y"/></svg>';
    host.innerHTML = s;
    const svg = host.querySelector('svg'), ring = svg.querySelector('.ring'), overlay = svg.querySelector('rect[data-custom]');
    overlay.addEventListener('pointermove', e => {
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, dist = 34*34;
      cfg.pts.forEach(p => { const d = (X(p.x)-mx)**2 + (Y(p.y)-my)**2; if (d < dist) { dist = d; best = p; } });
      if (best) { ring.setAttribute('visibility','visible'); ring.setAttribute('cx', X(best.x)); ring.setAttribute('cy', Y(best.y)); showTip(e, best.t); }
      else { ring.setAttribute('visibility','hidden'); hideTip(); }
    });
    overlay.addEventListener('pointerleave', () => { ring.setAttribute('visibility','hidden'); hideTip(); });
  });
}
const topBy = (k, n) => new Set(P.slice().sort((a,b) => b[k] - a[k]).slice(0,n).map(p => p.name));
const clutchLab = topBy('clutch', 6), levelLab = topBy('over_level', 6);
scatter('clutchChart', {
  aria:'Points won percent against matches won percent', xLab:'SHARE OF POINTS WON', yLab:'SHARE OF MATCHES WON', xStep:5, yStep:10,
  xFmt:v=>v+'%', yFmt:v=>v+'%', fit:D.fits.clutch,
  pts:P.map(p => ({n:p.name, x:p.pt_pct, y:p.win_pct, hl:p.clutch>2.5, lab:clutchLab.has(p.name), t:p.name+'\n'+f1(p.pt_pct)+'% of points, '+f1(p.win_pct)+'% of matches'}))
});
scatter('levelChart', {
  aria:'Level against final Elo', xLab:'LEVEL', yLab:'FINAL ELO', xStep:0.5, yStep:200,
  xFmt:v=>f1(v), yFmt:v=>v, fit:D.fits.level,
  pts:P.map(p => ({n:p.name, x:p.level, y:p.elo, hl:p.over_level>75, lab:levelLab.has(p.name), t:p.name+'\nLevel '+f2(p.level)+', '+p.elo+' Elo'}))
});

/* ceiling and floor */
(function(){
  const host = $('rangeChart');
  draws.push(() => {
    const w = widthOf(host), small = w < 560, rowH = 20, m = {t:24, r:14, b:6, l:small ? 80 : 110};
    const h = m.t + m.b + P.length*rowH, X = r => m.l + (r-1)/(N-1)*(w-m.l-m.r);
    let s = svgOpen(w, h, 'Highest and lowest ladder rank held by each player');
    const ticks = [1]; for (let t = 10; t <= N; t += 10) ticks.push(t);
    ticks.forEach(t => { s += '<line class="gl" x1="'+X(t)+'" x2="'+X(t)+'" y1="'+m.t+'" y2="'+(h-m.b)+'"/><text class="ax" x="'+X(t)+'" y="'+(m.t-9)+'" text-anchor="middle">#'+t+'</text>'; });
    P.forEach((p,i) => {
      const y = m.t + i*rowH + rowH/2;
      s += '<rect class="hit" data-t="'+esc(p.name+'\nHighest #'+p.best_rank+', lowest #'+p.low_rank+', finished #'+p.rank)+'" x="0" y="'+(y-rowH/2)+'" width="'+w+'" height="'+rowH+'"/>';
      s += '<line pointer-events="none" x1="'+X(p.best_rank)+'" x2="'+X(p.low_rank)+'" y1="'+y+'" y2="'+y+'" data-s="stroke:var(--accent-soft)" stroke-width="6" stroke-linecap="round"/>';
      s += '<circle class="dot-a" pointer-events="none" cx="'+X(p.rank)+'" cy="'+y+'" r="5"/>';
      s += '<text class="nl" pointer-events="none" x="'+(m.l-10)+'" y="'+(y+4)+'" text-anchor="end" data-s="font-size:11.5px">'+esc(p.name)+'</text>';
    });
    host.innerHTML = s + '</svg>';
  });
})();

/* weekly minis */
function mini(id, vals, kind, fmt){
  const host = $(id);
  draws.push(() => {
    const w = widthOf(host), h = 128, m = {t:18, r:8, b:20, l:8};
    const n = vals.length, step = (w-m.l-m.r)/n, cx = i => m.l + step*(i+.5);
    const hi = Math.max(...vals), lo = Math.min(...vals);
    let s = svgOpen(w, h, 'Weekly values');
    W.forEach((wk,i) => { s += '<text class="ax" x="'+cx(i)+'" y="'+(h-5)+'" text-anchor="middle">'+wk+'</text>'; });
    if (kind === 'bar') {
      const Y = v => (v/hi)*(h-m.t-m.b);
      s += '<line class="base" x1="'+m.l+'" x2="'+(w-m.r)+'" y1="'+(h-m.b)+'" y2="'+(h-m.b)+'"/>';
      vals.forEach((v,i) => {
        s += '<rect class="bar" pointer-events="none" x="'+(cx(i)-step*.34)+'" y="'+(h-m.b-Y(v))+'" width="'+(step*.68)+'" height="'+Y(v)+'" rx="2"/>';
        if (v === hi) s += '<text class="vl" x="'+cx(i)+'" y="'+(h-m.b-Y(v)-5)+'" text-anchor="middle">'+fmt(v)+'</text>';
      });
    } else {
      const pad = Math.max((hi-lo)*.2, .5), Y = v => m.t + (hi+pad-v)/((hi-lo)+2*pad)*(h-m.t-m.b);
      s += '<path d="'+vals.map((v,i)=>(i?'L':'M')+cx(i).toFixed(1)+' '+Y(v).toFixed(1)).join(' ')+'" fill="none" data-s="stroke:var(--accent)" stroke-width="2.2"/>';
      vals.forEach((v,i) => { s += '<circle cx="'+cx(i)+'" cy="'+Y(v)+'" r="3" data-s="fill:var(--accent)"/>'; });
      const iHi = vals.indexOf(hi);
      s += '<text class="vl" x="'+Math.min(Math.max(cx(iHi),26),w-26)+'" y="'+(Y(hi)-7)+'" text-anchor="middle">'+fmt(hi)+'</text>';
    }
    vals.forEach((v,i) => { s += '<rect class="hit" data-t="Week '+W[i]+'\n'+esc(fmt(v))+'" x="'+(cx(i)-step/2)+'" y="0" width="'+step+'" height="'+h+'"/>'; });
    host.innerHTML = s + '</svg>';
  });
}
mini('miniPlayers', WK.map(w=>w.players), 'bar', v=>v);
mini('miniPts', WK.map(w=>w.avg_pts_won), 'line', v=>f1(v));
mini('miniWin', WK.map(w=>w.avg_win), 'line', v=>f1(v)+'%');
mini('miniPct', WK.map(w=>w.avg_pt), 'line', v=>f1(v)+'%');

$('weeks').innerHTML = WK.map(w =>
  '<div class="wk"><div class="n">WK '+w.week+'</div><div class="m">'+w.players+' players<br>'+w.matches+' matches<br>'+w.points.toLocaleString()+' points</div>'+
  '<div class="topk">Best performer</div><div class="top">'+esc(w.top.join(' and '))+' <span>'+sgn(w.top_elo)+'</span></div></div>').join('');

/* streak grids */
function streaks(id, names, runKey, lenKey){
  const head = '<div></div><div class="cells">'+W.map(w=>'<b>'+w+'</b>').join('')+'</div><div></div>';
  $(id).innerHTML = '<div class="streak-grid">'+head+names.map(n => {
    const p = BY[n], run = p[runKey];
    const cells = W.map((w,i) => '<i class="'+(i>=run[0]&&i<run[0]+run[1]?'on':'')+'"></i>').join('');
    return '<div class="nm">'+esc(n)+'</div><div class="cells">'+cells+'</div><div class="len">'+p[lenKey]+'</div>';
  }).join('')+'</div>';
}
streaks('streakElo', L.elo_hot, 'elo_run', 'elo_streak');
streaks('streakWin', L.win_hot, 'win_run', 'win_streak');

/* histograms */
function hist(id, bins, label){
  const host = $(id);
  draws.push(() => {
    const w = widthOf(host), h = 220, m = {t:20, r:6, b:26, l:6};
    const step = (w-m.l-m.r)/bins.length, mx = Math.max(...bins.map(b=>b.n)), Y = v => v/mx*(h-m.t-m.b);
    let s = svgOpen(w, h, 'Histogram');
    s += '<line class="base" x1="'+m.l+'" x2="'+(w-m.r)+'" y1="'+(h-m.b)+'" y2="'+(h-m.b)+'"/>';
    const every = step < 36 ? 2 : 1;
    bins.forEach((b,i) => {
      const x = m.l + step*i, bw = step-3;
      if (b.n) s += '<rect class="bar" pointer-events="none" x="'+(x+1.5)+'" y="'+(h-m.b-Y(b.n))+'" width="'+bw+'" height="'+Y(b.n)+'" rx="3"/><text class="vl" x="'+(x+step/2)+'" y="'+(h-m.b-Y(b.n)-5)+'" text-anchor="middle">'+b.n+'</text>';
      if (i % every === 0) s += '<text class="ax" x="'+(x+step/2)+'" y="'+(h-9)+'" text-anchor="middle">'+label(b.lo)+'</text>';
      s += '<rect class="hit" data-t="'+esc(label(b.lo)+' to '+label(b.hi)+'\n'+b.n+(b.n===1?' player':' players'))+'" x="'+x+'" y="0" width="'+step+'" height="'+h+'"/>';
    });
    host.innerHTML = s + '</svg>';
  });
}
hist('histElo', D.hist.elo, v=>v);
hist('histWin', D.hist.win, v=>v+'%');

/* consistency strip */
(function(){
  const host = $('steadyChart'), rows = L.steady.map(n => BY[n]);
  draws.push(() => {
    const w = widthOf(host), small = w < 560, rowH = 36, m = {t:22, r:small?64:86, b:6, l:small?78:100};
    const h = m.t+m.b+rows.length*rowH, lo = 30, hi = 80, X = v => m.l+(v-lo)/(hi-lo)*(w-m.l-m.r);
    let s = svgOpen(w, h, 'Weekly points won percent for the most consistent players');
    for (let v = lo; v <= hi; v += 10) s += '<line class="'+(v===50?'base':'gl')+'" x1="'+X(v)+'" x2="'+X(v)+'" y1="'+m.t+'" y2="'+(h-m.b)+'"/><text class="ax" x="'+X(v)+'" y="'+(m.t-9)+'" text-anchor="middle">'+v+'%</text>';
    rows.forEach((p,i) => {
      const y = m.t + i*rowH + rowH/2;
      s += '<text class="nl" x="'+(m.l-10)+'" y="'+(y+4)+'" text-anchor="end">'+esc(p.name)+'</text>';
      p.wk_ppct.forEach((v,k) => { if (v !== null) s += '<circle class="dot-a" pointer-events="none" cx="'+X(v).toFixed(1)+'" cy="'+y+'" r="5.5" data-s="fill-opacity:.8;stroke-width:1.2"/>'; });
      s += '<text class="vl" x="'+(w-m.r+10)+'" y="'+(y+4)+'">&plusmn;'+f1(p.ppct_sd)+'</text>';
      s += '<rect class="hit" data-t="'+esc(p.name+'\nStandard deviation '+f2(p.ppct_sd)+'\nSeason '+f1(p.pt_pct)+'% of points')+'" x="0" y="'+(y-rowH/2)+'" width="'+w+'" height="'+rowH+'"/>';
    });
    host.innerHTML = s + '</svg>';
  });
})();

/* attendance, subs, awards */
$('attendanceSub').textContent = L.attendance.length + ' players showed up for every single week. Rain, work, sore knees, did not matter. The league is what it is because of these names.';
$('roll').innerHTML = L.attendance.map(n => '<span>'+esc(n)+'</span>').join('');
$('subGrid').innerHTML = L.subs.map(n => { const p = BY[n];
  return '<div class="aw"><div class="t">Substitute shout out</div><div class="w">'+esc(n)+'</div><div class="v">'+p.W+' wins over '+p.weeks_played+' weeks</div><div class="d">'+esc(p.highlight)+'. '+esc(bestWeekText(p))+'.</div></div>';
}).join('');
function awardHTML(a, i){
  return '<div class="aw'+(a.tier==='leader'&&i===0?' hl':'')+'"><div class="t">'+esc(a.title)+'</div><div class="w">'+esc(a.winners.join(' and ').replace(/ and (?=.* and )/g, ', '))+'</div><div class="v">'+esc(a.value)+'</div><div class="d">'+esc(a.desc)+'</div></div>';
}
$('awardsLead').innerHTML = D.awards.filter(a=>a.tier==='leader').map(awardHTML).join('');
$('awardsEncore').innerHTML = D.awards.filter(a=>a.tier==='encore').map(awardHTML).join('');

/* player cards */
(function(){
  const list = P.slice().sort((a,b) => a.name.localeCompare(b.name));
  function card(p){
    return '<article class="pc"><div class="top"><div class="nm">'+esc(p.name)+'</div><div class="rk">#'+p.rank+(p.sub?' &middot; Sub':'')+'</div></div>'+
      '<div class="sp"><div class="line"><b>'+p.elo+'</b> Elo &middot; <b>'+p.W+'</b> wins</div>'+sparkSvg(p,72,26)+'</div>'+
      '<div class="line"><b>'+f1(p.win_pct)+'%</b> matches &middot; <b>'+f1(p.pt_pct)+'%</b> points</div>'+
      '<div class="bw"><b>Best week.</b> '+esc(bestWeekText(p))+'</div><div class="h">'+esc(p.highlight)+'</div></article>';
  }
  function render(q){
    const shown = list.filter(p => p.name.toLowerCase().includes(q));
    $('cards').innerHTML = shown.map(card).join('') || '<div class="empty">Nobody by that name yet.</div>';
    $('cardCount').textContent = shown.length + ' shown';
  }
  $('cardSearch').addEventListener('input', e => render(e.target.value.toLowerCase().trim()));
  render('');
})();

$('notesList').innerHTML = D.notes.map(n => '<li>'+esc(n)+'</li>').join('');

/* draw and keep charts fitted to their containers */
function drawAll(){ draws.forEach(fn => fn()); }
drawAll();
let lastWidth = $('main').clientWidth, timer = null;
new ResizeObserver(() => {
  const now = $('main').clientWidth;
  if (now === lastWidth) return;
  lastWidth = now; clearTimeout(timer); timer = setTimeout(drawAll, 80);
}).observe($('main'));
})();
