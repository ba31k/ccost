"use strict";
const $ = id => document.getElementById(id);
const PERIODS = [["all",0],["month",4],["30 days",3],["7 days",2],["today",1]];
let pi = 0;                                   // index into PERIODS (visual order)
let period = PERIODS[0][1];
let selDay = null;                            // selected day (drill-down)
let LD = [];                                  // last day series (for paging)
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mainEl = document.querySelector("main");

const money = x => "$" + x.toLocaleString("en-US",{minimumFractionDigits:2, maximumFractionDigits:2});
function htok(n){
  if (n >= 999.5e6) return (n/1e9).toFixed(1)+"B";
  if (n >= 999.5e3) return (n/1e6).toFixed(1)+"M";
  if (n >= 1000)    return (n/1e3).toFixed(1)+"K";
  return String(n);
}

/* smooth number roll */
function lerpMoney(el, to, instant){
  const from = +el.dataset.v || 0;
  el.dataset.v = to;
  if (instant || reduced || Math.abs(to-from) < 0.005){ el.textContent = money(to); return; }
  const t0 = performance.now(), dur = 700;
  (function step(t){
    const k = Math.min((t-t0)/dur, 1), e = 1-Math.pow(1-k,3);
    el.textContent = money(from + (to-from)*e);
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}

/* tooltips: content lives on the element (survives live updates) */
const tip = $("tip");
function bindTip(el){
  el.addEventListener("mousemove", e => {
    if (!el._tip) return;
    tip.innerHTML = el._tip; tip.style.display = "block";
    const w = tip.offsetWidth;
    tip.style.left = Math.min(e.clientX+14, innerWidth-w-10)+"px";
    tip.style.top = (e.clientY+16)+"px";
  });
  el.addEventListener("mouseleave", () => tip.style.display = "none");
}
function esc(s){ const d = document.createElement("i"); d.textContent = s; return d.innerHTML; }

/* ------------------------------------------------ period: slider and paging */
const nav = $("periods");
const thumb = document.createElement("div");
thumb.id = "thumb";
nav.appendChild(thumb);
for (let i = 0; i < PERIODS.length; i++){
  const b = document.createElement("button");
  b.textContent = PERIODS[i][0];
  if (i === pi) b.className = "on";
  b.onclick = () => setPeriod(i);
  nav.appendChild(b);
}
function moveThumb(){
  const b = nav.querySelectorAll("button")[pi];
  if (!b) return;
  thumb.style.left = b.offsetLeft + "px";
  thumb.style.width = b.offsetWidth + "px";
}
function setPeriod(i){
  i = Math.max(0, Math.min(PERIODS.length - 1, i));
  if (i === pi) return;
  pi = i; period = PERIODS[i][1];
  setDaySel(null, false);
  nav.querySelectorAll("button").forEach((x, j) => x.className = j === pi ? "on" : "");
  moveThumb();
  mainEl.classList.add("dim");
  tick(true);
}
function setDaySel(day, refetch = true){
  selDay = day;
  document.body.classList.toggle("day-mode", !!day);
  const chip = $("daysel");
  chip.hidden = !day;
  if (day) chip.textContent = "· " + day + " · Esc to reset";
  if (refetch){ mainEl.classList.add("dim"); tick(true); }
}
addEventListener("resize", moveThumb);
addEventListener("keydown", e => {
  if (e.key === "Escape" && document.body.classList.contains("cfgopen")){
    closeDrawer(); return;
  }
  if (e.key === "Escape" && selDay){ setDaySel(null); return; }
  if (selDay){                                // in day mode ←/→ page through days
    const i = LD.findIndex(x => x.d === selDay);
    if (e.key === "ArrowRight" && i >= 0 && i < LD.length - 1) setDaySel(LD[i+1].d);
    if (e.key === "ArrowLeft" && i > 0) setDaySel(LD[i-1].d);
    return;
  }
  if (e.key === "ArrowRight") setPeriod(pi + 1);
  if (e.key === "ArrowLeft") setPeriod(pi - 1);
});
/* horizontal trackpad swipe over the hero pages periods */
let wacc = 0, wlock = 0;
$("hero").addEventListener("wheel", e => {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  const now = Date.now();
  if (now < wlock) return;
  wacc += e.deltaX;
  if (wacc > 60){ setPeriod(pi + 1); wlock = now + 450; wacc = 0; }
  else if (wacc < -60){ setPeriod(pi - 1); wlock = now + 450; wacc = 0; }
}, {passive: false});

/* ------------------------------------------------ static cards */
const CARD_DEFS = [
  ["today", "cToday"], ["month forecast", "cFc"],
  ["cache saved", "cSaved"], ["average day", "cAvg"],
];
const cardRef = {};
for (const [lbl, key] of CARD_DEFS){
  const d = document.createElement("div");
  d.className = "card";
  d.innerHTML = '<div class="lbl"></div><div class="val"></div><div class="sub"></div>';
  d.children[0].textContent = lbl;
  cardRef[key] = {val: d.children[1], sub: d.children[2]};
  $("cards").appendChild(d);
}

/* ------------------------------------------------ render */
const WD = ["mo","tu","we","th","fr","sa","su"];
let lastSig = null;
const R = {days: [], grid: [], heat: [], models: [], chats: [], tools: [], hours: [], year: []};

function sigOf(d){
  if (!d.total) return "empty" + d.period;
  return [d.period, d.day || "", d.days.length, d.models.map(m => m.name).join(","),
          d.tools.map(t => t.name).join(","),
          d.chats.map(c => c.title).join("~")].join("|");
}

function floater(delta){
  const f = document.createElement("div");
  f.className = "float";
  f.textContent = "+" + money(delta);
  $("bigcost").appendChild(f);
  setTimeout(() => f.remove(), 1800);
  const bc = $("bigcost");
  bc.classList.add("burn");
  setTimeout(() => bc.classList.remove("burn"), 900);
}

function stag(el, i, ms){                     // staggered row entrance
  if (reduced) return;
  el.style.animation = "rowin .38s both " + Math.min(i * ms, 500) + "ms";
}

function render(d, fresh){
  const t = d.total;
  if (!t){
    document.body.classList.add("nodata");
    $("herosub").textContent = "no data for this period";
    $("bignum").textContent = "$0.00"; $("bignum").dataset.v = 0;
    const eb = $("emptybox");
    eb.hidden = false;
    eb.replaceChildren();
    const line = (cls, txt) => {
      const el = document.createElement("div");
      el.className = cls; el.textContent = txt;
      eb.appendChild(el);
    };
    if (d.have_any){
      line("e1", "no activity in this period");
      line("e2", "switch periods: ← → or swipe over the counter");
    } else {
      line("e1", "no Claude Code data found");
      line("e2", "looked in: " + (d.root || "~/.claude/projects"));
      line("e2", "if Claude Code lives in WSL, set " +
                 "CCOST_ROOT=\\wsl.localhost\Ubuntu\home\<user>\.claude\projects " +
                 "or run ccost-linux inside WSL");
    }
    for (const id of ["daychart","heat","models","chats","tools","hourchart"])
      $(id).replaceChildren();
    lastSig = null;
    return;
  }
  document.body.classList.remove("nodata");
  $("emptybox").hidden = true;
  /* hero + live "+$" ticks */
  const prev = +$("bignum").dataset.v || 0;
  if (!fresh && prev > 0 && t.cost > prev + 0.004 && !reduced)
    floater(t.cost - prev);
  lerpMoney($("bignum"), t.cost);
  document.title = "ccost · " + money(t.cost);

  const hs = $("herosub");
  hs.replaceChildren();
  const seg = (txt, strong) => {
    const b = document.createElement(strong ? "b" : "span");
    b.textContent = txt; hs.appendChild(b);
  };
  if (d.day){ seg(d.day, true); seg(" · "); }
  seg(htok(t.tok)); seg(" tokens · "); seg(t.msgs.toLocaleString("en-US"));
  seg(" messages · "); seg(String(t.sessions)); seg(" chats");
  if (!d.day){
    seg(" · "); seg(t.first + " … " + t.last);
    seg(" · streak "); seg(t.streak + " days", true);
  }

  const w = $("warn");
  if (d.unknown.length){
    w.hidden = false;
    w.textContent = "no price (counted as $0): " + d.unknown.join(", ");
  } else w.hidden = true;

  /* cards */
  lerpMoney(cardRef.cToday.val, t.today, fresh);
  cardRef.cToday.sub.textContent = "last hour " + money(t.hour_cost);
  lerpMoney(cardRef.cFc.val, t.forecast, fresh);
  cardRef.cFc.sub.textContent = "so far " + money(t.mtd);
  lerpMoney(cardRef.cSaved.val, t.saved, fresh);
  cardRef.cSaved.sub.textContent = "without cache ≈ " + money(t.cost + t.saved);
  lerpMoney(cardRef.cAvg.val, t.avg_day, fresh);
  cardRef.cAvg.sub.textContent = "peak " + t.busiest_day + " · " + money(t.busiest_cost);

  const up = $("upd");
  if (d.update){
    up.hidden = false;
    up.textContent = d.update.tag + " is out";
    up.href = d.update.url;
  } else up.hidden = true;

  renderDays(d, fresh);
  renderHeat(d, fresh);
  renderModels(d, fresh);
  renderChats(d, fresh);
  renderTools(d, fresh);
  renderHours(d, fresh);
  renderYear(d, fresh);
  renderRecs(d, fresh);
}

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
function gotoDay(day){
  if (period !== 0){
    pi = 0; period = 0;
    nav.querySelectorAll("button").forEach((x, j) => x.className = j === 0 ? "on" : "");
    moveThumb();
  }
  setDaySel(day);
}
function renderYear(d, fresh){
  const y = d.year || [];
  if (!y.length) return;
  const mx = Math.max(...y.map(x => x.c), 0.01);
  const first = new Date(y[0].d + "T00:00:00");
  const pad = (first.getDay() + 6) % 7;         // monday = 0
  if (fresh || R.year.length !== y.length){
    const box = $("year");
    box.replaceChildren();
    R.year = [];
    for (let i = 0; i < pad; i++)
      box.appendChild(document.createElement("i"));
    for (const x of y){
      const c = document.createElement("i");
      c.addEventListener("click", () => { if (c._day && c.classList.contains("has")) gotoDay(c._day); });
      bindTip(c);
      box.appendChild(c);
      R.year.push(c);
    }
    const mrow = $("yearmonths");
    mrow.replaceChildren();
    let prev = -1;
    y.forEach((x, i) => {
      const dt = new Date(x.d + "T00:00:00");
      if (dt.getDate() <= 7 && dt.getMonth() !== prev){
        prev = dt.getMonth();
        const s = document.createElement("span");
        s.textContent = MONTHS[prev];
        s.style.left = (Math.floor((i + pad) / 7) * 14) + "px";
        mrow.appendChild(s);
      }
    });
    mrow.style.width = (Math.ceil((y.length + pad) / 7) * 14) + "px";
  }
  y.forEach((x, i) => {
    const c = R.year[i];
    if (!c) return;
    const a = x.c <= 0 ? 0 : 0.16 + 0.84 * Math.pow(x.c / mx, 0.55);
    c.style.background = x.c > 0 ? "rgba(45,212,200," + a.toFixed(3) + ")" : "";
    c.classList.toggle("has", x.c > 0);
    c._day = x.d;
    c._tip = esc(x.d) + " · <b>" + money(x.c) + "</b>";
  });
}
function renderRecs(d, fresh){
  const box = $("recs");
  box.replaceChildren();
  for (const [i, rec] of (d.records || []).entries()){
    const el = document.createElement("div");
    el.className = "rec";
    el.innerHTML = '<div class="rl"></div><div class="rv"></div><div class="rs"></div>';
    el.children[0].textContent = rec.label;
    el.children[1].textContent = rec.value;
    el.children[2].textContent = rec.sub;
    if (fresh) stag(el, i, 30);
    box.appendChild(el);
  }
}

function renderDays(d, fresh){
  LD = d.days;
  const mx = Math.max(...d.days.map(x => x.c), 0.01);
  if (fresh){
    const dc = $("daychart");
    dc.replaceChildren();
    R.grid = [];
    for (const fr of [1, .5]){
      const g = document.createElement("div");
      g.className = "gridline"; g.style.bottom = (fr*100)+"%";
      g.innerHTML = "<span></span>";
      dc.appendChild(g);
      R.grid.push([g.children[0], fr]);
    }
    const bars = document.createElement("div");
    bars.className = "bars";
    R.days = [];
    d.days.forEach((x, i) => {
      const b = document.createElement("div");
      b.className = "b" + (x.d === d.today_str ? " today" : "");
      b.style.height = "0%";
      if (!reduced) b.style.transitionDelay = Math.min(i*14, 500)+"ms";
      b.addEventListener("click", () => setDaySel(b._day === selDay ? null : b._day));
      bindTip(b);
      bars.appendChild(b);
      R.days.push(b);
    });
    dc.appendChild(bars);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      d.days.forEach((x, i) => setDayBar(R.days[i], x, mx, d.today_str));
      setTimeout(() => R.days.forEach(b => b.style.transitionDelay = ""), 1100);
    }));
  } else {
    d.days.forEach((x, i) => R.days[i] && setDayBar(R.days[i], x, mx, d.today_str));
  }
  for (const [span, fr] of R.grid) span.textContent = money(mx*fr);
  const ax = $("dayaxis");
  ax.replaceChildren();
  for (const s of [d.days[0], d.days[d.days.length-1]]){
    const sp = document.createElement("span");
    sp.textContent = s ? s.d : ""; ax.appendChild(sp);
  }
}
function setDayBar(b, x, mx, today){
  b.style.height = Math.max(x.c/mx*100, x.c > 0 ? 1.5 : 0.4) + "%";
  b.classList.toggle("today", x.d === today);
  b.classList.toggle("sel", x.d === selDay);
  b._day = x.d;
  b._tip = esc(x.d) + " · <b>" + money(x.c) + "</b>" +
           (x.d === selDay ? "" : " · click for day details");
}

function renderHeat(d, fresh){
  const hmax = Math.max(...d.heat.flat(), 0.01);
  let peak = [0,0,0];
  d.heat.forEach((row,i) => row.forEach((v,j) => { if (v > peak[2]) peak = [i,j,v]; }));
  if (fresh){
    const hm = $("heat");
    hm.replaceChildren();
    document.querySelector(".heatdays").replaceChildren(
      ...WD.map(x => { const s = document.createElement("span"); s.textContent = x; return s; }));
    R.heat = [];
    d.heat.forEach((row,i) => row.forEach((v,j) => {
      const c = document.createElement("i");
      if (!reduced){                          // left-to-right scan sweep
        c.style.opacity = "0";
        c.style.transitionDelay = (j*14 + i*6) + "ms";
      }
      bindTip(c);
      hm.appendChild(c);
      R.heat.push(c);
    }));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      R.heat.forEach((c, n) => setHeatCell(c, d.heat[(n/24)|0][n%24], (n/24)|0, n%24, hmax, peak));
      R.heat.forEach(c => c.style.opacity = "1");
      setTimeout(() => R.heat.forEach(c => c.style.transitionDelay = ""), 900);
    }));
  } else {
    R.heat.forEach((c, n) => setHeatCell(c, d.heat[(n/24)|0][n%24], (n/24)|0, n%24, hmax, peak));
  }
}
function setHeatCell(c, v, i, j, hmax, peak){
  const a = v <= 0 ? 0 : 0.14 + 0.86*Math.pow(v/hmax, 0.6);
  c.style.background = v > 0 ? "rgba(45,212,200," + a.toFixed(3) + ")" : "";
  c.classList.toggle("peak", i === peak[0] && j === peak[1] && v > 0);
  c._tip = WD[i] + " " + String(j).padStart(2,"0") + ":00 · <b>" + money(v) + "</b>";
}

const tailOpen = {models: false, chats: false, tools: false};
function tailFinish(box, more, total, visible, key, noun){
  if (total <= visible) return;
  box.appendChild(more);
  const btn = document.createElement("button");
  btn.className = "morebtn";
  const label = () => tailOpen[key]
    ? "− collapse"
    : "+ " + (total - visible) + " more " + noun;
  btn.textContent = label();
  btn.onclick = () => {
    tailOpen[key] = !tailOpen[key];
    more.classList.toggle("open", tailOpen[key]);
    btn.textContent = label();
  };
  box.appendChild(btn);
}
function tailBox(key){
  const more = document.createElement("div");
  more.className = "moretail";
  more.classList.toggle("open", tailOpen[key]);
  return more;
}
function renderModels(d, fresh){
  const mmax = Math.max(...d.models.map(m => m.cost), 0.01);
  if (fresh){
    const box = $("models");
    box.replaceChildren();
    R.models = [];
    const more = tailBox("models");
    d.models.forEach((m, i) => {
      const r = document.createElement("div");
      r.className = "mrow";
      r.innerHTML = '<div class="name"></div><div class="hbar"><i></i></div>' +
                    '<div class="tok"></div><div class="cost"></div>';
      r.children[0].textContent = m.name;
      stag(r, i, 40);
      (i < 3 ? box : more).appendChild(r);   // top 3 visible, rest collapsible
      R.models.push(r);
    });
    tailFinish(box, more, d.models.length, 3, "models", "models");
  }
  d.models.forEach((m, i) => {
    const r = R.models[i]; if (!r) return;
    r.children[1].firstChild.style.width = (m.cost/mmax*100)+"%";
    r.children[2].textContent = htok(m.tok);
    lerpMoney(r.children[3], m.cost, fresh);
  });
}

function renderChats(d, fresh){
  if (fresh){
    const box = $("chats");
    box.replaceChildren();
    R.chats = [];
    const more = tailBox("chats");
    d.chats.forEach((c, i) => {
      const r = document.createElement("div");
      r.className = "row";
      r.innerHTML = '<div class="name"></div><div class="cost"></div><div class="meta"></div>';
      r.children[0].textContent = c.title;
      stag(r, i, 26);
      (i < 5 ? box : more).appendChild(r);
      R.chats.push(r);
    });
    tailFinish(box, more, d.chats.length, 5, "chats", "chats");
  }
  d.chats.forEach((c, i) => {
    const r = R.chats[i]; if (!r) return;
    lerpMoney(r.children[1], c.cost, fresh);
    const meta = r.children[2];
    meta.replaceChildren();
    for (const chip of [c.project, c.model, c.msgs.toLocaleString("en-US")+" msgs"]){
      const s = document.createElement("span");
      s.className = "chip"; s.textContent = chip;
      meta.appendChild(s);
    }
  });
}

function renderTools(d, fresh){
  const tmax = Math.max(...d.tools.map(x => x.calls), 1);
  if (fresh){
    const box = $("tools");
    box.replaceChildren();
    R.tools = [];
    const more = tailBox("tools");
    d.tools.forEach((x, i) => {
      const r = document.createElement("div");
      r.className = "row";
      r.innerHTML = '<div class="name"></div><div class="cost"></div>' +
                    '<div class="hbar" style="grid-column:1"><i></i></div>';
      stag(r, i, 26);
      (i < 5 ? box : more).appendChild(r);
      R.tools.push(r);
    });
    tailFinish(box, more, d.tools.length, 5, "tools", "tools");
  }
  d.tools.forEach((x, i) => {
    const r = R.tools[i]; if (!r) return;
    r.children[0].textContent = x.name + " · " + x.calls.toLocaleString("ru-RU");
    lerpMoney(r.children[1], x.cost, fresh);
    r.children[2].firstChild.style.width = (x.calls/tmax*100)+"%";
  });
}

function renderHours(d, fresh){
  const mx = Math.max(...d.hours.map(x => x.c), 0.01);
  if (fresh){
    const hc = $("hourchart");
    hc.replaceChildren();
    const bars = document.createElement("div");
    bars.className = "bars";
    R.hours = [];
    d.hours.forEach((x, i) => {
      const b = document.createElement("div");
      b.className = "b";
      b.style.height = "0%";
      if (!reduced) b.style.transitionDelay = (i*16)+"ms";
      bindTip(b);
      bars.appendChild(b);
      R.hours.push(b);
    });
    hc.appendChild(bars);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      d.hours.forEach((x, i) => setHourBar(R.hours[i], x, i, mx));
      setTimeout(() => R.hours.forEach(b => b.style.transitionDelay = ""), 900);
    }));
  } else {
    d.hours.forEach((x, i) => R.hours[i] && setHourBar(R.hours[i], x, i, mx));
  }
}
function setHourBar(b, x, i, mx){
  b.style.height = Math.max(x.c/mx*100, x.c > 0 ? 2 : 0.6) + "%";
  b._tip = String(i).padStart(2,"0") + ":00 · <b>" + money(x.c) + "</b> · " + x.m + " msgs";
}

/* ------------------------------------------------ live loop */
function renderLoading(l){
  $("herosub").textContent = "reading sessions… " + l.done + " / " + l.total + " files";
  const lb = $("loadbar");
  lb.hidden = false;
  lb.firstElementChild.style.width = (l.total ? l.done / l.total * 100 : 0) + "%";
}
async function tick(force){
  try{
    const r = await fetch("/data?period=" + period + (selDay ? "&day=" + selDay : ""));
    const d = await r.json();
    if (d.loading){
      renderLoading(d.loading);
      $("livedot").classList.remove("off");
      $("livelbl").textContent = "loading";
      mainEl.classList.remove("dim");
      setTimeout(() => tick(true), 400);
      return;
    }
    $("loadbar").hidden = true;
    const sig = sigOf(d);
    render(d, force || sig !== lastSig);
    lastSig = sig;
    $("livedot").classList.remove("off");
    $("livelbl").textContent = "live";
    $("conn").hidden = true;
    document.body.classList.remove("offline");
  }catch(e){
    $("livedot").classList.add("off");
    $("livelbl").textContent = "offline";
    $("conn").hidden = false;
    document.body.classList.add("offline");
  }
  mainEl.classList.remove("dim");
}
/* --------------------------------------- custom window chrome (mac / windows) */
(function chrome(){
  const header = document.querySelector("header");
  const wk = window.webkit && window.webkit.messageHandlers
          && window.webkit.messageHandlers.ccost;
  if (wk){                                    // ccost.app: drag via performDrag
    document.body.classList.add("chrome-mac");
    header.addEventListener("mousedown", e => {
      if (e.target.closest("button, nav, a")) return;
      wk.postMessage("drag");
    });
    header.addEventListener("dblclick", e => {
      if (e.target.closest("button, nav, a")) return;
      wk.postMessage("zoom");
    });
  }
  addEventListener("pywebviewready", () => {  // Windows: frameless + custom buttons
    document.body.classList.add("chrome-win");
    const strip = document.createElement("div");
    strip.className = "pywebview-drag-region";
    strip.id = "dragstrip";
    strip.addEventListener("dblclick", () => window.pywebview.api.toggle_max());
    header.prepend(strip);
    const ctl = document.createElement("div");
    ctl.id = "winctl";
    for (const [glyph, fn, cls] of [["–","minimize",""],["▢","toggle_max",""],["✕","close","x"]]){
      const b = document.createElement("button");
      b.textContent = glyph;
      if (cls) b.className = cls;
      b.onclick = () => window.pywebview.api[fn]();
      ctl.appendChild(b);
    }
    header.appendChild(ctl);
    moveThumb();
  });
})();
/* --------------------------------------------- settings drawer */
let cfgCache = null;
let timer = null;
function setRefresh(ms){
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick(false), ms);
}
async function fetchCfg(){
  cfgCache = await (await fetch("/config")).json();
  return cfgCache;
}
function chipRow(opts, cur, fn){
  const box = document.createElement("div");
  box.className = "chips";
  for (const [label, val] of opts){
    const b = document.createElement("button");
    b.textContent = label;
    b.className = "chipbtn" + (val === cur ? " on" : "");
    b.onclick = () => fn(val);
    box.appendChild(b);
  }
  return box;
}
function renderCfg(){
  const c = cfgCache.config, meta = cfgCache.meta;
  const body = $("cfgbody");
  body.replaceChildren();
  const head = t => {
    const e = document.createElement("div");
    e.className = "cfg-h"; e.textContent = t;
    body.appendChild(e);
  };
  head("sources");
  for (const [key, name] of [["claude","Claude Code"],["codex","Codex · OpenAI"]]){
    const m = meta[key];
    const row = document.createElement("label");
    row.className = "srcrow";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!c.sources[key];
    cb.onchange = () => postCfg({sources: {[key]: cb.checked}});
    const tgl = document.createElement("span");
    tgl.className = "tgl";
    const info = document.createElement("div");
    info.className = "srcinfo";
    const n1 = document.createElement("div");
    n1.textContent = name;
    const n2 = document.createElement("div");
    n2.className = "dim2";
    n2.textContent = m.files
      ? m.files + " files · " + m.records.toLocaleString("en-US") + " records"
      : "not found";
    const n3 = document.createElement("div");
    n3.className = "dim2";
    n3.textContent = m.root;
    info.append(n1, n2, n3);
    row.append(cb, tgl, info);
    body.appendChild(row);
  }
  head("refresh");
  body.appendChild(chipRow([["2 s",2000],["5 s",5000],["10 s",10000]],
                           c.refresh_ms, v => postCfg({refresh_ms: v})));
  head("default period");
  body.appendChild(chipRow(PERIODS.map(p => [p[0], p[1]]),
                           c.default_period, v => postCfg({default_period: v})));
  head("app");
  for (const [key, label] of [["menubar","menu bar counter (mac)"],
                              ["check_updates","check for updates"]]){
    const row = document.createElement("label");
    row.className = "srcrow";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!c[key];
    cb.onchange = () => postCfg({[key]: cb.checked});
    const tgl = document.createElement("span");
    tgl.className = "tgl";
    const info = document.createElement("div");
    info.className = "srcinfo";
    const n1 = document.createElement("div");
    n1.textContent = label;
    info.append(n1);
    row.append(cb, tgl, info);
    body.appendChild(row);
    if (key === "menubar" && c.menubar){
      const sel = new Set(c.menubar_metrics || ["today"]);
      const box = document.createElement("div");
      box.className = "chips mbm";
      for (const [label, val] of [["$ today","today"],["$/hour","hour"],
                                  ["$ month","month"],["messages","msgs"],
                                  ["tokens","tok"]]){
        const b = document.createElement("button");
        b.textContent = label;
        b.className = "chipbtn" + (sel.has(val) ? " on" : "");
        b.onclick = () => {
          sel.has(val) ? sel.delete(val) : sel.add(val);
          postCfg({menubar_metrics: [...sel]});
        };
        box.appendChild(b);
      }
      body.appendChild(box);
    }
  }
  head("prices · $ per 1M tokens");
  const defaults = {};
  for (const [n, p] of Object.entries(cfgCache.prices.anthropic))
    defaults[n] = [p[0], p[1]];
  for (const [n, p] of Object.entries(cfgCache.prices.openai))
    defaults[n] = [p[0], p[1]];
  const ov = c.prices || {};
  const inputs = {};
  const tbl = document.createElement("div");
  tbl.className = "pricetbl";
  for (const t of ["model", "in", "out"]){
    const e = document.createElement("div");
    e.className = "ph"; e.textContent = t;
    tbl.appendChild(e);
  }
  const commit = () => {
    const out = {};
    for (const [name, def] of Object.entries(defaults)){
      const vin = parseFloat(inputs[name][0].value);
      const vout = parseFloat(inputs[name][1].value);
      if (isFinite(vin) && isFinite(vout) && (vin !== def[0] || vout !== def[1]))
        out[name] = [vin, vout];
    }
    postCfg({prices: out});
  };
  for (const [name, def] of Object.entries(defaults)){
    const eff = ov[name] || def;
    const nm = document.createElement("div");
    nm.className = ov[name] ? "pn ovr" : "pn";
    nm.textContent = name.replace("claude-", "");
    tbl.appendChild(nm);
    inputs[name] = [];
    for (const i of [0, 1]){
      const inp = document.createElement("input");
      inp.type = "number"; inp.step = "0.01"; inp.min = "0";
      inp.value = eff[i];
      inp.onchange = commit;
      inputs[name].push(inp);
      tbl.appendChild(inp);
    }
  }
  body.appendChild(tbl);
  const note = document.createElement("div");
  note.className = "cfg-note";
  note.textContent = "edit a number to reprice the whole history instantly; " +
                     "teal model = custom price";
  body.appendChild(note);
  if (Object.keys(ov).length){
    const rb = document.createElement("button");
    rb.className = "chipbtn";
    rb.style.marginTop = "10px";
    rb.textContent = "reset to list prices";
    rb.onclick = () => postCfg({prices: {}});
    body.appendChild(rb);
  }
}
async function postCfg(partial){
  cfgCache = await (await fetch("/config",
    {method: "POST", body: JSON.stringify(partial)})).json();
  renderCfg();
  setRefresh(cfgCache.config.refresh_ms);
  mainEl.classList.add("dim");
  tick(true);
}
function closeDrawer(){
  $("shade").hidden = true;
  document.body.classList.remove("cfgopen");
}
$("gear").onclick = () => {
  $("shade").hidden = false;
  document.body.classList.add("cfgopen");
  fetchCfg().then(renderCfg)
    .catch(() => { $("cfgbody").textContent = "failed to load config"; });
};
$("shade").onclick = closeDrawer;

moveThumb();
addEventListener("load", moveThumb);
(async () => {
  try{
    const c = await fetchCfg();
    const i = PERIODS.findIndex(p => p[1] === c.config.default_period);
    if (i > 0){
      pi = i; period = PERIODS[i][1];
      nav.querySelectorAll("button").forEach((x, j) =>
        x.className = j === pi ? "on" : "");
      moveThumb();
    }
    setRefresh(c.config.refresh_ms);
  }catch(e){
    setRefresh(3000);
  }
  tick(true);
})();
