(function(){"use strict";
function one(el){el.style.cssText=el.getAttribute('data-s');el.removeAttribute('data-s');}
function sweep(node){if(node.nodeType!==1)return;if(node.hasAttribute('data-s'))one(node);node.querySelectorAll('[data-s]').forEach(one);}
sweep(document.documentElement);
new MutationObserver(function(list){list.forEach(function(m){m.addedNodes.forEach(sweep);});}).observe(document.documentElement,{childList:true,subtree:true});
})();
(function(){
"use strict";
var D = JSON.parse(document.getElementById('data').textContent);
var P = D.players, W = D.weeks, WK = D.weekly, NOTES = D.notes, N = P.length;
var SVGNS = "http://www.w3.org/2000/svg";
var tip = document.getElementById('tip');
function showTip(e,html){ tip.innerHTML = html; tip.classList.add('on');
  var x = e.clientX + 14, y = e.clientY - 10;
  if (x + 200 > window.innerWidth) x = e.clientX - 190;
  tip.style.left = x+'px'; tip.style.top = y+'px'; }
function hideTip(){ tip.classList.remove('on'); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmt(n,d){ return Number(n).toFixed(d===undefined?0:d); }
function sgn(n){ return (n>0?'+':'') + n; }
function declutter(items,gap,top,bot){
  items.sort(function(a,b){return a.y-b.y;});
  for(var i=1;i<items.length;i++){ if(items[i].y-items[i-1].y<gap) items[i].y=items[i-1].y+gap; }
  var over=items.length?items[items.length-1].y-bot:0;
  if(over>0){ for(var k=items.length-1;k>=0;k--){ items[k].y-=over; if(k&&items[k].y-items[k-1].y>=gap) break; } }
  if(items.length&&items[0].y<top){ var d=top-items[0].y; for(var m2=0;m2<items.length;m2++) items[m2].y+=d; }
  return items;
}

/* ---------- season numbers ---------- */
var totalMatches = WK.reduce(function(a,w){return a+w.matches;},0);
var totalPoints  = P.reduce(function(a,p){return a+p.pts_played;},0);
var totalPlayerMatches = P.reduce(function(a,p){return a+p.T;},0);
var nums = [
  [N, 'Players ranked'],
  [W.length, 'Playing weeks'],
  [totalMatches.toLocaleString(), 'Matches contested'],
  [totalPoints.toLocaleString(), 'Points played']
];
document.getElementById('seasonNums').innerHTML = nums.map(function(n){
  return '<div><div class="n">'+n[0]+'</div><div class="k">'+n[1]+'</div></div>'; }).join('');

/* ---------- podium ---------- */
var pod = P.slice(0,3);
function podNote(p,i){
  if(i===0) return 'Held the top spot for '+p.days_at_1+' days and closed the season with a '+sgn(p.elo_delta)+' rating swing.';
  return p.W+' wins from '+p.T+' matches over '+p.weeks+' weeks, taking '+fmt(p.pt_pct,1)+'% of every point contested, and finishing '+(pod[0].elo-p.elo)+' Elo behind the title.';
}
var podNotes = pod.map(podNote);
document.getElementById('podiumGrid').innerHTML = pod.map(function(p,i){
  return '<div class="pod'+(i===0?' first':'')+'"><span class="pos">'+(i+1)+'</span>'+
    '<div class="nm">'+esc(p.name)+'</div>'+
    '<div class="el">'+p.elo+'</div>'+
    '<div class="rw">'+p.W+'W &ndash; '+p.L+'L &nbsp;/&nbsp; '+fmt(p.win_pct,1)+'% &nbsp;/&nbsp; '+fmt(p.pt_pct,1)+'% pts</div>'+
    '<div class="note">'+podNotes[i]+'</div></div>';
}).join('');

/* ---------- form strip ---------- */
function formColor(pct){
  if (pct === null) return 'transparent';
  if (pct >= 99) return 'var(--w100)';
  if (pct >= 60) return 'var(--w67)';
  if (pct >= 45) return 'var(--w50)';
  if (pct >  0)  return 'var(--w33)';
  return 'var(--w0)';
}
function formStrip(p){
  return '<span class="form">' + W.map(function(w){
    var pct = p.wk_mpct[w];
    var st = pct===null
      ? 'background:transparent;border:1px dashed #C4D0CE'
      : 'background:'+formColor(pct);
    var t = pct===null ? 'Week '+w+': did not play'
      : 'Week '+w+': '+p.wk_won[w]+' of '+p.wk_mpl[w]+' matches';
    return '<i data-s="'+st+'" data-t="'+t+'"></i>';
  }).join('') + '</span>';
}

/* ---------- standings table ---------- */
var tbody = document.getElementById('tbody');
var sortKey = 'elo', sortDir = -1, filter = '';
function rows(){
  var list = P.filter(function(p){ return p.name.toLowerCase().indexOf(filter)>-1; });
  list.sort(function(a,b){
    var x=a[sortKey], y=b[sortKey];
    if (typeof x === 'string') return sortDir * x.localeCompare(y);
    return sortDir * (x-y);
  });
  return list;
}
function detailHTML(p){
  var cells = W.map(function(w){
    var played = p.wk_won[w] !== null;
    var el = p.wk_elo[w];
    return '<div class="c"><b>WK '+w+'</b>'+
      (played
        ? '<s data-s="color:'+(el>=0?'var(--w100)':'var(--clay)')+'">'+sgn(el)+'</s>'+
          '<b data-s="margin-top:3px">'+p.wk_won[w]+'/'+p.wk_mpl[w]+' &middot; '+fmt(p.wk_ppct[w],0)+'%</b>'
        : '<s data-s="color:#C4D0CE">&ndash;</s><b data-s="margin-top:3px">out</b>')+
      '</div>';
  }).join('');
  var kv = [
    ['Elo start &rarr; finish', p.start_elo+' &rarr; '+p.elo],
    ['Net rating change', sgn(p.elo_delta)],
    ['Matches', p.W+'W &ndash; '+p.L+'L of '+p.T],
    ['Points won', p.pts_won+' of '+p.pts_played],
    ['Best night', 'Week '+p.best_week+' ('+sgn(p.best_week_elo)+')'],
    ['Weekly points % range', fmt(p.ppct_worst,1)+'% to '+fmt(p.ppct_best,1)+'%'],
    ['Best league rank held', '#'+p.high_rank],
    ['Longest winning-week run', p.hot_streak + (p.hot_streak===1?' week':' weeks')]
  ];
  return '<tr class="detail"><td colspan="12"><div class="dgrid">'+
    '<div><div class="lab">Week by week (Elo change &middot; matches &middot; points won)</div><div class="wkline">'+cells+'</div></div>'+
    '<div><div class="lab">Season card</div><div class="kv">'+
      kv.map(function(r){ return '<span>'+r[0]+'</span><span>'+r[1]+'</span>'; }).join('')+
    '</div></div></div></td></tr>';
}
function render(){
  var list = rows();
  document.getElementById('count').textContent = list.length + ' shown';
  tbody.innerHTML = list.map(function(p,i){
    return '<tr data-n="'+esc(p.name)+'">'+
      '<td class="pos">'+(i+1)+'</td>'+
      '<td class="nm">'+esc(p.name)+'</td>'+
      '<td data-s="text-align:left">'+formStrip(p)+'</td>'+
      '<td data-s="font-weight:600">'+p.elo+'</td>'+
      '<td data-s="color:'+(p.elo_delta>=0?'var(--w100)':'var(--clay)')+'">'+sgn(p.elo_delta)+'</td>'+
      '<td>'+p.W+'</td><td>'+p.L+'</td>'+
      '<td>'+fmt(p.win_pct,1)+'</td>'+
      '<td>'+fmt(p.pt_pct,1)+'</td>'+
      '<td>'+p.pts_won+'</td>'+
      '<td>'+p.weeks+'</td>'+
      '<td>'+p.level.toFixed(2)+'</td></tr>';
  }).join('');
}
tbody.addEventListener('click', function(e){
  var tr = e.target.closest('tr'); if(!tr || !tr.dataset.n) return;
  var next = tr.nextElementSibling;
  if (next && next.classList.contains('detail')){ next.remove(); tr.classList.remove('open'); return; }
  var d = tbody.querySelector('tr.detail'); if(d){ d.previousElementSibling.classList.remove('open'); d.remove(); }
  var p = P.filter(function(x){return x.name===tr.dataset.n;})[0];
  tr.classList.add('open');
  tr.insertAdjacentHTML('afterend', detailHTML(p));
});
tbody.addEventListener('mouseover', function(e){
  if (e.target.dataset && e.target.dataset.t) showTip(e, e.target.dataset.t);
});
tbody.addEventListener('mouseout', hideTip);
document.querySelectorAll('#tbl thead th').forEach(function(th){
  if (th.classList.contains('noSort')) return;
  th.addEventListener('click', function(){
    var k = th.dataset.k;
    if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = Number(th.dataset.dir); }
    document.querySelectorAll('#tbl thead th').forEach(function(t){ t.removeAttribute('aria-sort'); });
    th.setAttribute('aria-sort', sortDir===1?'ascending':'descending');
    render();
  });
});
document.getElementById('search').addEventListener('input', function(e){
  filter = e.target.value.toLowerCase().trim(); render();
});
render();

/* ---------- Elo race ---------- */
(function(){
  var Wd=1000, H=520, m={t:14,r:164,b:34,l:44};
  var series = P.map(function(p){
    var run = p.start_elo, pts = [{x:-1,y:run,played:false}];
    W.forEach(function(w,i){
      if (p.wk_elo[w] !== null) run += p.wk_elo[w];
      pts.push({x:i, y:run, played:p.wk_elo[w]!==null, w:w, d:p.wk_elo[w]});
    });
    return {p:p, pts:pts};
  });
  var all=[]; series.forEach(function(s){ s.pts.forEach(function(q){ all.push(q.y); }); });
  var lo=Math.min.apply(null,all), hi=Math.max.apply(null,all);
  lo = Math.floor((lo-20)/100)*100; hi = Math.ceil((hi+30)/100)*100;
  function X(i){ return m.l + (i+1)/W.length * (Wd-m.l-m.r); }
  function Y(v){ return m.t + (hi-v)/(hi-lo) * (H-m.t-m.b); }
  var PAL=['#0E6E6B','#B44A2E','#1F6F8B','#7A5AA8','#2E8B4A','#C88A18','#4FA39B','#8C3F63','#3A6EA5','#6B7A2E'];
  var s='<svg viewBox="0 0 '+Wd+' '+H+'" role="img" aria-label="Elo rating for every player across the season">';
  for(var v=lo; v<=hi; v+=100){
    s+='<line class="gridline" x1="'+m.l+'" x2="'+(Wd-m.r)+'" y1="'+Y(v)+'" y2="'+Y(v)+'"/>';
    s+='<text x="'+(m.l-8)+'" y="'+(Y(v)+3)+'" text-anchor="end" font-family="IBM Plex Mono,monospace" font-size="10" fill="#5B7480">'+v+'</text>';
  }
  s+='<text x="'+X(-1)+'" y="'+(H-12)+'" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="10" fill="#5B7480">START</text>';
  W.forEach(function(w,i){
    s+='<text x="'+X(i)+'" y="'+(H-12)+'" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="10" fill="#5B7480">W'+w+'</text>';
  });
  function path(pts){ return pts.map(function(q,i){ return (i?'L':'M')+X(q.x).toFixed(1)+' '+Y(q.y).toFixed(1); }).join(' '); }
  series.slice(10).forEach(function(sr){
    s+='<path d="'+path(sr.pts)+'" fill="none" stroke="#C4D0CE" stroke-width="1.2" data-nm="'+esc(sr.p.name)+'" class="ln bg"/>';
  });
  var ends=[];
  series.slice(0,10).forEach(function(sr,i){
    var c=PAL[i%PAL.length];
    s+='<path d="'+path(sr.pts)+'" fill="none" stroke="'+c+'" stroke-width="2.4" stroke-linejoin="round" data-nm="'+esc(sr.p.name)+'" class="ln fg"/>';
    var last=sr.pts[sr.pts.length-1];
    ends.push({y:Y(last.y),y0:Y(last.y),c:c,n:sr.p.name,e:Math.round(last.y)});
    sr.pts.forEach(function(q){
      if(!q.played) return;
      s+='<circle cx="'+X(q.x).toFixed(1)+'" cy="'+Y(q.y).toFixed(1)+'" r="3.2" fill="'+c+'" data-t="'+esc(sr.p.name)+' &middot; Week '+q.w+': '+sgn(q.d)+' to '+Math.round(q.y)+'"/>';
    });
  });
  declutter(ends,15,m.t+6,H-m.b-6).forEach(function(l){
    if(Math.abs(l.y-l.y0)>1.5)
      s+='<path d="M'+(Wd-m.r+1)+' '+l.y0.toFixed(1)+' L'+(Wd-m.r+5)+' '+l.y.toFixed(1)+'" stroke="'+l.c+'" stroke-width="1" fill="none" stroke-opacity=".55"/>';
    s+='<text x="'+(Wd-m.r+8)+'" y="'+(l.y+4).toFixed(1)+'" font-family="Barlow Condensed,Arial Narrow,sans-serif" font-size="13.5" font-weight="700" fill="'+l.c+'">'+esc(l.n)+'</text>';
  });
  s+='</svg>';
  var host=document.getElementById('raceChart'); host.innerHTML=s;
  host.addEventListener('mouseover',function(e){
    if(e.target.dataset && e.target.dataset.t) showTip(e, e.target.dataset.t);
    else if(e.target.dataset && e.target.dataset.nm) showTip(e, esc(e.target.dataset.nm));
  });
  host.addEventListener('mouseout', hideTip);

  var leg=document.getElementById('raceLegend');
  leg.innerHTML = P.map(function(p,i){
    var c = i<10 ? PAL[i%PAL.length] : '#8FA3A1';
    return '<button data-nm="'+esc(p.name)+'" data-s="border-left:4px solid '+c+'">'+esc(p.name)+'</button>';
  }).join('');
  leg.addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b) return;
    var nm=b.dataset.nm, on=b.classList.toggle('on');
    leg.querySelectorAll('button').forEach(function(x){ if(x!==b){x.classList.remove('on');} });
    host.querySelectorAll('path.ln').forEach(function(pt){
      var mine = pt.dataset.nm === nm;
      if (!on){ pt.setAttribute('stroke', pt.classList.contains('fg') ? pt.dataset.orig || pt.getAttribute('stroke') : '#C4D0CE');
                pt.setAttribute('stroke-opacity','1'); pt.setAttribute('stroke-width', pt.classList.contains('fg')?'2.4':'1.2'); return; }
      pt.setAttribute('stroke-opacity', mine ? '1' : '.16');
      if (mine){ pt.setAttribute('stroke','#0B2A33'); pt.setAttribute('stroke-width','3.4'); }
    });
    if(on){ b.style.background='#0B2A33'; } else { b.style.background=''; }
    leg.querySelectorAll('button').forEach(function(x){ if(x!==b) x.style.background=''; });
  });
})();

/* ---------- climbers ---------- */
(function(){
  var list = P.slice().sort(function(a,b){ return b.elo_delta-a.elo_delta; })
              .filter(function(p){ return p.elo_delta>0; }).slice(0,10);
  var Wd=1000, rowH=30, m={t:14,r:70,b:30,l:186};
  var H = m.t+m.b+list.length*rowH;
  var mx = Math.ceil(Math.max.apply(null, list.map(function(p){return p.elo_delta;}))/50)*50;
  function X(v){ return m.l + v/mx*(Wd-m.l-m.r); }
  var s='<svg viewBox="0 0 '+Wd+' '+H+'" role="img" aria-label="Ten largest season-long Elo gains">';
  for(var v=0; v<=mx; v+=50){
    s+='<line x1="'+X(v)+'" x2="'+X(v)+'" y1="'+m.t+'" y2="'+(H-m.b)+'" stroke="'+(v===0?'#0B2A33':'#E2E9E8')+'" stroke-width="'+(v===0?1.6:1)+'"/>';
    s+='<text x="'+X(v)+'" y="'+(H-10)+'" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="10" fill="#5B7480">'+sgn(v)+'</text>';
  }
  list.forEach(function(p,i){
    var y = m.t + i*rowH;
    s+='<rect x="'+m.l+'" y="'+(y+6)+'" width="'+Math.max(X(p.elo_delta)-m.l,1)+'" height="'+(rowH-13)+'" fill="#0E6E6B" data-t="'+esc(p.name)+' &middot; '+p.start_elo+' to '+p.elo+'"/>';
    s+='<text x="'+(m.l-10)+'" y="'+(y+rowH/2+2)+'" text-anchor="end" font-family="Public Sans,sans-serif" font-size="12.5" font-weight="700" fill="#0B2A33">'+esc(p.name)+'</text>';
    s+='<text x="'+(X(p.elo_delta)+8)+'" y="'+(y+rowH/2+2)+'" font-family="IBM Plex Mono,monospace" font-size="11.5" font-weight="600" fill="#0E6E6B">'+sgn(p.elo_delta)+'</text>';
  });
  s+='</svg>';
  var host=document.getElementById('moversChart'); host.innerHTML=s;
  host.addEventListener('mouseover',function(e){ if(e.target.dataset&&e.target.dataset.t) showTip(e,e.target.dataset.t); });
  host.addEventListener('mouseout',hideTip);
})();

/* ---------- clutch scatter ---------- */
(function(){
  var Wd=1000,H=560,m={t:20,r:24,b:48,l:56};
  var xs=P.map(function(p){return p.pt_pct;}), ys=P.map(function(p){return p.win_pct;});
  var x0=Math.floor(Math.min.apply(null,xs)-1), x1=Math.ceil(Math.max.apply(null,xs)+1);
  var y0=Math.floor(Math.min.apply(null,ys)/5)*5-2, y1=Math.ceil(Math.max.apply(null,ys)/5)*5+2;
  function X(v){ return m.l+(v-x0)/(x1-x0)*(Wd-m.l-m.r); }
  function Y(v){ return m.t+(y1-v)/(y1-y0)*(H-m.t-m.b); }
  var n=P.length, sx=xs.reduce(function(a,b){return a+b;},0)/n, sy=ys.reduce(function(a,b){return a+b;},0)/n;
  var num=0,den=0;
  for(var i=0;i<n;i++){ num+=(xs[i]-sx)*(ys[i]-sy); den+=(xs[i]-sx)*(xs[i]-sx); }
  var slope=num/den, inter=sy-slope*sx;
  var s='<svg viewBox="0 0 '+Wd+' '+H+'" role="img" aria-label="Scatter of points won percentage against matches won percentage">';
  for(var v=Math.ceil(y0/5)*5; v<=y1; v+=5){
    s+='<line class="gridline" x1="'+m.l+'" x2="'+(Wd-m.r)+'" y1="'+Y(v)+'" y2="'+Y(v)+'"/>';
    s+='<text x="'+(m.l-8)+'" y="'+(Y(v)+3)+'" text-anchor="end" font-family="IBM Plex Mono,monospace" font-size="10" fill="#5B7480">'+v+'%</text>';
  }
  for(var v2=Math.ceil(x0/2)*2; v2<=x1; v2+=2){
    s+='<line class="gridline" y1="'+m.t+'" y2="'+(H-m.b)+'" x1="'+X(v2)+'" x2="'+X(v2)+'"/>';
    s+='<text y="'+(H-m.b+18)+'" x="'+X(v2)+'" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="10" fill="#5B7480">'+v2+'%</text>';
  }
  s+='<line x1="'+X(x0)+'" y1="'+Y(slope*x0+inter)+'" x2="'+X(x1)+'" y2="'+Y(slope*x1+inter)+'" stroke="#0B2A33" stroke-width="1.6" stroke-dasharray="7 5"/>';
  s+='<text x="'+(Wd-m.r-6)+'" y="'+(Y(slope*x1+inter)-10)+'" text-anchor="end" font-family="IBM Plex Mono,monospace" font-size="10" fill="#0B2A33" letter-spacing="1.2">EXPECTED WIN RATE FOR YOUR SCORING</text>';
  s+='<text x="'+(Wd/2)+'" y="'+(H-8)+'" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="10" fill="#5B7480" letter-spacing="1.6">SHARE OF POINTS WON</text>';
  s+='<text transform="translate(14,'+(H/2)+') rotate(-90)" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="10" fill="#5B7480" letter-spacing="1.6">SHARE OF MATCHES WON</text>';
  P.forEach(function(p){
    var exp = slope*p.pt_pct+inter, over = p.win_pct-exp;
    var c = over>2.5?'#0E6E6B':(over<-2.5?'#B44A2E':'#5B7480');
    var r = 4+Math.min(p.weeks,8)*0.55;
    s+='<circle cx="'+X(p.pt_pct).toFixed(1)+'" cy="'+Y(p.win_pct).toFixed(1)+'" r="'+r.toFixed(1)+'" fill="'+c+'" fill-opacity=".82" stroke="#fff" stroke-width="1.2" data-t="'+esc(p.name)+' &middot; '+fmt(p.pt_pct,1)+'% pts, '+fmt(p.win_pct,1)+'% matches &middot; '+(over>=0?'+':'')+fmt(over,1)+' vs expected"/>';
  });
  var lbl = P.filter(function(p){ var o=p.win_pct-(slope*p.pt_pct+inter); return Math.abs(o)>5.5; })
    .map(function(p){ return {y:Y(p.win_pct), y0:Y(p.win_pct), x:X(p.pt_pct), n:p.name}; });
  declutter(lbl,13,m.t+8,H-m.b-8).forEach(function(l){
    if(Math.abs(l.y-l.y0)>1.5)
      s+='<path d="M'+(l.x+6).toFixed(1)+' '+l.y0.toFixed(1)+' L'+(l.x+11).toFixed(1)+' '+l.y.toFixed(1)+'" stroke="#8FA3A1" stroke-width="1" fill="none"/>';
    s+='<text x="'+(l.x+13).toFixed(1)+'" y="'+(l.y+4).toFixed(1)+'" font-family="Public Sans,sans-serif" font-size="11" font-weight="700" fill="#0B2A33">'+esc(l.n)+'</text>';
  });
  s+='</svg>';
  var host=document.getElementById('clutchChart'); host.innerHTML=s;
  host.addEventListener('mouseover',function(e){ if(e.target.dataset&&e.target.dataset.t) showTip(e,e.target.dataset.t); });
  host.addEventListener('mouseout',hideTip);
})();

/* ---------- range chart ---------- */
(function(){
  var list=P.slice().sort(function(a,b){ return (a.ppct_best-a.ppct_worst)-(b.ppct_best-b.ppct_worst); });
  var Wd=1000, rowH=21, m={t:26,r:26,b:30,l:172};
  var H=m.t+m.b+list.length*rowH;
  var lo=Math.floor(Math.min.apply(null,list.map(function(p){return p.ppct_worst;}))/5)*5;
  var hi=Math.ceil(Math.max.apply(null,list.map(function(p){return p.ppct_best;}))/5)*5;
  function X(v){ return m.l+(v-lo)/(hi-lo)*(Wd-m.l-m.r); }
  var s='<svg viewBox="0 0 '+Wd+' '+H+'" role="img" aria-label="Range of weekly points won percentage for each player">';
  for(var v=lo; v<=hi; v+=5){
    s+='<line class="gridline" x1="'+X(v)+'" x2="'+X(v)+'" y1="'+m.t+'" y2="'+(H-m.b)+'" stroke="'+(v===50?'#0B2A33':'#E2E9E8')+'" stroke-width="'+(v===50?1.6:1)+'"/>';
    s+='<text x="'+X(v)+'" y="'+(m.t-10)+'" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="10" fill="#5B7480">'+v+'%</text>';
    s+='<text x="'+X(v)+'" y="'+(H-10)+'" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="10" fill="#5B7480">'+v+'%</text>';
  }
  list.forEach(function(p,i){
    var y=m.t+i*rowH+rowH/2;
    s+='<line x1="'+X(p.ppct_worst)+'" x2="'+X(p.ppct_best)+'" y1="'+y+'" y2="'+y+'" stroke="#A6BAB8" stroke-width="5" stroke-linecap="round"/>';
    s+='<circle cx="'+X(p.pt_pct)+'" cy="'+y+'" r="4.6" fill="'+(p.pt_pct>=50?'#0E6E6B':'#B44A2E')+'" stroke="#fff" stroke-width="1.4" data-t="'+esc(p.name)+' &middot; season '+fmt(p.pt_pct,1)+'% &middot; low '+fmt(p.ppct_worst,1)+'% &middot; high '+fmt(p.ppct_best,1)+'%"/>';
    s+='<text x="'+(m.l-10)+'" y="'+(y+4)+'" text-anchor="end" font-family="Public Sans,sans-serif" font-size="11.5" font-weight="600" fill="#0B2A33">'+esc(p.name)+'</text>';
  });
  s+='</svg>';
  var host=document.getElementById('rangeChart'); host.innerHTML=s;
  host.addEventListener('mouseover',function(e){ if(e.target.dataset&&e.target.dataset.t) showTip(e,e.target.dataset.t); });
  host.addEventListener('mouseout',hideTip);
})();

/* ---------- weeks ---------- */
document.getElementById('weeks').innerHTML = WK.map(function(w){
  return '<div class="wk"><div class="n">WK '+w.week+'</div>'+
    '<div class="m">'+w.players+' players<br>'+w.matches+' matches<br>'+w.pts.toLocaleString()+' points</div>'+
    '<div class="topk" data-s="margin-top:9px">Night&rsquo;s biggest gain</div>'+
    '<div class="top">'+esc(w.top)+' <span class="mono" data-s="color:var(--w100)">'+sgn(w.topelo)+'</span></div></div>';
}).join('');

/* ---------- awards ---------- */
function best(k,dir){ return P.slice().sort(function(a,b){ return dir*(b[k]-a[k]); })[0]; }
var champ=P[0];
var mostW=P.slice().sort(function(a,b){ return (b.W-a.W)||(b.win_pct-a.win_pct); })[0];
var bestWin=best('win_pct',1), bestPts=best('pt_pct',1);
var mostWTie=P.filter(function(p){ return p.W===mostW.W; });
function others(arr,me){ return arr.filter(function(p){return p.name!==me.name;}).map(function(p){return p.name;}); }
var mover=best('elo_delta',1), steady=best('ppct_sd',-1);
var streak=P.slice().sort(function(a,b){ return (b.hot_streak-a.hot_streak)||(b.win_pct-a.win_pct); })[0];
var streakTie=P.filter(function(p){ return p.hot_streak===streak.hot_streak; });
var iron=P.slice().sort(function(a,b){ return (b.T-a.T)||(b.weeks-a.weeks); })[0];
var ironTie=P.filter(function(p){ return p.T===iron.T; });
var bigNight=P.slice().sort(function(a,b){ return b.best_week_elo-a.best_week_elo; })[0];
var sweeps={}; P.forEach(function(p){ var c=0; W.forEach(function(w){ if(p.wk_mpct[w]===100) c++; }); sweeps[p.name]=c; });
var sweeper=P.slice().sort(function(a,b){ return (sweeps[b.name]-sweeps[a.name])||(b.win_pct-a.win_pct); })[0];
var sweepTie=P.filter(function(p){ return sweeps[p.name]===sweeps[sweeper.name]; });
var awards=[
  ['hl','League champion',champ.name,champ.elo+' Elo','Finished on top of the ladder after '+champ.weeks+' weeks, '+champ.W+' wins, and '+champ.days_at_1+' days holding the number one spot.'],
  ['','Most improved',mover.name,sgn(mover.elo_delta)+' Elo','Started the season rated '+mover.start_elo+' and finished at '+mover.elo+', the largest climb in the league.'],
  ['','Best win rate',bestWin.name,fmt(bestWin.win_pct,1)+'%',bestWin.W+' wins from '+bestWin.T+' matches across '+bestWin.weeks+' weeks.'],
  ['','Most wins',mostW.name,mostW.W+' wins',
   (mostWTie.length>1
     ? 'Level with '+others(mostWTie,mostW).join(' and ')+' on '+mostW.W+' wins, and ahead on win rate at '+fmt(mostW.win_pct,1)+'%.'
     : 'Turned volume into results with '+mostW.T+' matches played over '+mostW.weeks+' weeks.')],
  ['','Highest scoring rate',bestPts.name,fmt(bestPts.pt_pct,1)+'% of points','Won '+bestPts.pts_won+' of the '+bestPts.pts_played+' points contested in their matches.'],
  ['','Most consistent',steady.name,'&plusmn;'+fmt(steady.ppct_sd,1)+' pts%','Weekly scoring rate never strayed far from '+fmt(steady.pt_pct,1)+'%, the steadiest form in the league.'],
  ['','Iron paddle',ironTie.length>1?ironTie.map(function(p){return p.name;}).join(', '):iron.name,iron.T+' matches',
   ironTie.length>1
     ? 'Nobody logged more court time. '+ironTie.length+' players tied on '+iron.T+' matches across the season.'
     : 'Logged more court time than anyone else, playing '+iron.weeks+' of the '+W.length+' weeks.'],
  ['','Best single night',bigNight.name,sgn(bigNight.best_week_elo)+' in week '+bigNight.best_week,'The largest one-week rating jump anyone recorded all season.'],
  ['','Most clean sweeps',sweeper.name,sweeps[sweeper.name]+' perfect weeks','Won every match on the card on '+sweeps[sweeper.name]+' separate nights'+
   (sweepTie.length>1 ? ', level with '+others(sweepTie,sweeper).join(' and ')+'.' : '.')],
  ['','Longest hot run',streak.name,streak.hot_streak+' straight weeks',
   'Posted a winning record in '+streak.hot_streak+' consecutive weeks of play'+
   (streakTie.length>1 ? ', matched by '+others(streakTie,streak).join(' and ')+'.' : '.')]
];
document.getElementById('awardsGrid').innerHTML = awards.map(function(a){
  return '<div class="aw '+a[0]+'"><div class="t">'+a[1]+'</div><div class="w">'+esc(a[2])+'</div>'+
    '<div class="v">'+a[3]+'</div><div class="d">'+a[4]+'</div></div>';
}).join('');

/* ---------- notes ---------- */
document.getElementById('notesList').innerHTML = NOTES.map(function(n){ return '<li>'+n+'</li>'; }).join('');
})();
