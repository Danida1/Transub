// Buscador de rutas: RAPTOR por rondas con frecuencias por hora.
// Solo usa las rutas que están en servicio a la hora en que se tomarían.
(function (root) {
  "use strict";
  const WALK = 1.2;          // m/s caminando
  const DETOUR = 1.25;       // las calles no son línea recta
  const XFER_RADIUS = 500;   // m para cambiar de paradero a pie
  const ACCESS_RADIUS = 1000;
  const MAX_RIDES = 4;
  const XFER_PENALTY = 150;  // s extra por cada transbordo (incomodidad)
  const INF = 1e12;

  function hav(a1, o1, a2, o2) {
    const R = 6371000, t = Math.PI / 180, dA = (a2 - a1) * t, dO = (o2 - o1) * t;
    const s = Math.sin(dA / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(dO / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // ---------- Calendario: festivos de Colombia (Ley Emiliani + Semana Santa) ----------
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  const ymd = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  const holidayCache = {};
  function holidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    const out = new Set(), add = d => out.add(ymd(d));
    const nextMonday = d => { const r = new Date(d); while (r.getDay() !== 1) r.setDate(r.getDate() + 1); return r; };
    [[0, 1], [4, 1], [6, 20], [7, 7], [11, 8], [11, 25]].forEach(([m, d]) => add(new Date(y, m, d)));
    [[0, 6], [2, 19], [5, 29], [7, 15], [9, 12], [10, 1], [10, 11]].forEach(([m, d]) => add(nextMonday(new Date(y, m, d))));
    const e = easter(y), plus = n => { const r = new Date(e); r.setDate(r.getDate() + n); return r; };
    add(plus(-3)); add(plus(-2)); add(plus(43)); add(plus(64)); add(plus(71));
    return (holidayCache[y] = out);
  }

  function Network(raw) {
    const N = raw.stops.n.length;
    this.N = N;
    this.lat = new Float64Array(N); this.lng = new Float64Array(N);
    this.name = new Array(N); this.parent = raw.stops.p;
    for (let i = 0; i < N; i++) {
      this.lat[i] = raw.stops.a[i] / 1e5; this.lng[i] = raw.stops.o[i] / 1e5;
      this.name[i] = raw.names[raw.stops.n[i]];
    }
    this.routes = raw.routes;
    this.pats = raw.pats;
    this.feed = raw.feed || {}; this.generated = raw.generated; this.source = raw.source;
    this.feedHolidays = new Set(raw.hol || []);
    this.stopPats = Array.from({ length: N }, () => []);
    this.pats.forEach((p, pi) => {
      p.cum = new Float64Array(p.s.length);
      for (let i = 1; i < p.s.length; i++) p.cum[i] = p.cum[i - 1] + p.t[i - 1];
      p.s.forEach((s, pos) => this.stopPats[s].push(pi, pos));
    });
    this.isStation = new Uint8Array(N);
    this.pats.forEach(p => { if (this.routes[p.r].k === "T") p.s.forEach(s => this.isStation[s] = 1); });
    this.cell = 0.003; this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const k = this.key(this.lat[i], this.lng[i]);
      let c = this.grid.get(k); if (!c) this.grid.set(k, c = []); c.push(i);
    }
    this.xfer = new Array(N);
    this.setTime(new Date());
  }

  // Tipo de día: L (lunes a viernes), S (sábado), D (domingo o festivo)
  Network.prototype.dayType = function (date) {
    const key = ymd(date), y = date.getFullYear();
    if (this.feedHolidays.has(key) || holidays(y).has(key) || date.getDay() === 0) return "D";
    return date.getDay() === 6 ? "S" : "L";
  };
  Network.prototype.setTime = function (date) {
    this.when = new Date(date);
    const mid = new Date(date); mid.setHours(0, 0, 0, 0);
    const prev = new Date(mid); prev.setDate(prev.getDate() - 1);
    this.dt = this.dayType(mid); this.dtPrev = this.dayType(prev);
    this.t0 = (date - mid) / 1000; // segundos desde la medianoche
  };
  // Frecuencia en minutos de un patrón a una hora (segundos desde la medianoche de hoy). 0 = no pasa.
  Network.prototype.hwAt = function (pi, sec) {
    const p = this.pats[pi];
    if (!p.d) return p.w / 60;
    const pick = (arr, h) => { if (!arr) return 0; const i = h - arr[2]; return i >= 0 && i < arr.length - 3 ? arr[3 + i] : 0; };
    const h = Math.floor(sec / 3600);
    let v = pick(p.d[this.dt], h);
    if (!v && h < 6) v = pick(p.d[this.dtPrev], h + 24);   // servicio que viene de anoche
    return v;
  };
  Network.prototype.activeNow = function (pi) { return this.hwAt(pi, this.t0) > 0; };
  Network.prototype.waitSec = function (pi, hwMin) {
    const k = this.routes[this.pats[pi].r].k;
    return Math.min(hwMin * 30, 900) + (k === "T" ? 45 : 20);
  };
  // Próxima hora en que el patrón vuelve a operar (texto "h:mm" del día que toque) o null
  Network.prototype.nextService = function (pi) {
    const p = this.pats[pi]; if (!p.d) return null;
    for (let add = 0; add < 8; add++) {
      const day = new Date(this.when); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + add);
      const arr = p.d[this.dayType(day)]; if (!arr) continue;
      const first = arr[0] * 60;
      if (add > 0 || first > this.t0) return { day: add, min: arr[0] };
    }
    return null;
  };

  Network.prototype.key = function (la, lo) { return Math.floor(la / this.cell) + ":" + Math.floor(lo / this.cell); };
  Network.prototype.near = function (la, lo, r) {
    const out = [], span = Math.ceil(r / 330), ci = Math.floor(la / this.cell), cj = Math.floor(lo / this.cell);
    for (let i = ci - span; i <= ci + span; i++) for (let j = cj - span; j <= cj + span; j++) {
      const c = this.grid.get(i + ":" + j); if (!c) continue;
      for (const s of c) { const d = hav(la, lo, this.lat[s], this.lng[s]); if (d <= r) out.push([s, d]); }
    }
    return out.sort((a, b) => a[1] - b[1]);
  };
  Network.prototype.transfers = function (s) {
    if (this.xfer[s]) return this.xfer[s];
    const out = [];
    for (const [n, d] of this.near(this.lat[s], this.lng[s], XFER_RADIUS)) {
      if (n === s) continue;
      const same = this.parent[s] >= 0 && this.parent[s] === this.parent[n];
      out.push(n, same ? 90 : 30 + d * DETOUR / WALK);
    }
    return (this.xfer[s] = out);
  };

  // Una pasada de RAPTOR. banned: Set de índices de ruta que no se pueden usar.
  Network.prototype.raptor = function (o, d, banned) {
    const N = this.N, walkT = m => m * DETOUR / WALK, T0 = this.t0;
    let access = this.near(o.lat, o.lng, ACCESS_RADIUS);
    if (access.length < 3) access = this.near(o.lat, o.lng, ACCESS_RADIUS * 2);
    let egress = this.near(d.lat, d.lng, ACCESS_RADIUS);
    if (egress.length < 3) egress = this.near(d.lat, d.lng, ACCESS_RADIUS * 2);
    const egMap = new Map(egress.map(([s, m]) => [s, m]));

    const best = new Float64Array(N).fill(INF);
    const rounds = [];
    const any0 = new Float64Array(N).fill(INF);
    let marked = [];
    for (const [s, m] of access) { any0[s] = walkT(m); best[s] = any0[s]; marked.push(s); }
    rounds.push({ any: any0, accessDist: new Map(access) });

    const results = [];
    for (let k = 1; k <= MAX_RIDES && marked.length; k++) {
      const prev = rounds[k - 1].any;
      const ride = new Float64Array(N).fill(INF), rp = new Int32Array(N).fill(-1), rb = new Int32Array(N), rw = new Float64Array(N);
      const q = new Map();
      for (const s of marked) {
        const sp = this.stopPats[s];
        for (let i = 0; i < sp.length; i += 2) {
          const pi = sp[i], pos = sp[i + 1];
          if (banned && banned.has(this.pats[pi].r)) continue;
          const cur = q.get(pi); if (cur === undefined || pos < cur) q.set(pi, pos);
        }
      }
      const pen = k > 1 ? XFER_PENALTY : 0;
      for (const [pi, start] of q) {
        const p = this.pats[pi];
        let boardPos = -1, boardT = INF, boardWait = 0;
        for (let i = start; i < p.s.length; i++) {
          const s = p.s[i];
          if (boardPos >= 0) {
            const t = boardT + p.cum[i] - p.cum[boardPos];
            if (t < ride[s] && t < best[s]) { ride[s] = t; rp[s] = pi; rb[s] = boardPos; rw[s] = boardWait; }
          }
          if (prev[s] < INF) {
            const hw = this.hwAt(pi, T0 + prev[s]);
            if (!hw) continue;                    // a esa hora la ruta no pasa
            const w = this.waitSec(pi, hw);
            const cand = prev[s] + w + pen;
            const curAt = boardPos >= 0 ? boardT + p.cum[i] - p.cum[boardPos] : INF;
            if (cand < curAt) { boardPos = i; boardT = cand; boardWait = w; }
          }
        }
      }
      const any = Float64Array.from(ride), wp = new Int32Array(N).fill(-1);
      const newly = [];
      for (let s = 0; s < N; s++) if (ride[s] < best[s]) { best[s] = ride[s]; newly.push(s); }
      const next = new Set(newly);
      for (const s of newly) {
        const tr = this.transfers(s);
        for (let i = 0; i < tr.length; i += 2) {
          const n = tr[i], t = ride[s] + tr[i + 1];
          if (t < any[n] && t < best[n]) { any[n] = t; wp[n] = s; best[n] = t; next.add(n); }
        }
      }
      rounds.push({ any, ride, rp, rb, rw, wp });
      marked = [...next];
      let bt = INF, bs = -1;
      for (const [s, m] of egMap) {
        if (ride[s] >= INF) continue;
        const t = ride[s] + walkT(m);
        if (t < bt) { bt = t; bs = s; }
      }
      if (bs >= 0) results.push({ rides: k, total: bt, end: bs, egress: egMap.get(bs) });
    }
    return results.map(r => this.rebuild(r, rounds, o, d));
  };

  Network.prototype.rebuild = function (r, rounds, o, d) {
    const legs = [];
    let s = r.end, k = r.rides;
    legs.unshift({ kind: "walk", meters: r.egress, sec: r.egress * DETOUR / WALK, from: s, toPoint: d });
    while (k >= 1) {
      const R = rounds[k];
      const pi = R.rp[s], bpos = R.rb[s], p = this.pats[pi];
      const apos = p.s.indexOf(s, bpos + 1);
      const bs = p.s[bpos];
      const hw = this.hwAt(pi, this.t0 + rounds[k - 1].any[bs]);
      legs.unshift({ kind: "ride", pat: pi, route: p.r, from: bs, to: s, bpos, apos,
        sec: p.cum[apos] - p.cum[bpos], wait: R.rw[s], hw });
      const P = rounds[k - 1];
      if (k - 1 >= 1 && P.wp[bs] >= 0) {
        const fromS = P.wp[bs];
        const m = hav(this.lat[fromS], this.lng[fromS], this.lat[bs], this.lng[bs]);
        legs.unshift({ kind: "xfer", from: fromS, to: bs, meters: m, sec: P.any[bs] - P.ride[fromS] });
        s = fromS;
      } else s = bs;
      k--;
    }
    const m = rounds[0].accessDist.get(s) || 0;
    legs.unshift({ kind: "walk", meters: m, sec: m * DETOUR / WALK, fromPoint: o, to: s });
    return { total: r.total, rides: r.rides, legs };
  };

  // Opciones variadas para la hora indicada (por defecto, ahora)
  Network.prototype.plan = function (o, d, when) {
    this.setTime(when || new Date());
    const opts = [], seen = new Set();
    const score = x => x.total + Math.max(0, x.rides - 1) * 240;
    const add = it => {
      const sig = it.legs.filter(l => l.kind === "ride").map(l => l.route).join(">");
      if (!sig || seen.has(sig)) return;
      seen.add(sig); opts.push(it);
    };
    this.raptor(o, d, null).forEach(add);
    const banned = new Set();
    for (let attempt = 0; attempt < 2 && opts.length; attempt++) {
      const main = opts.slice().sort((a, b) => score(a) - score(b))[0];
      const longest = main.legs.filter(l => l.kind === "ride").sort((a, b) => b.sec - a.sec)[0];
      if (!longest) break;
      banned.add(longest.route);
      const alt = this.raptor(o, d, banned);
      if (!alt.length) break;
      alt.sort((a, b) => score(a) - score(b)); add(alt[0]);
    }
    const dist = hav(o.lat, o.lng, d.lat, d.lng);
    if (dist < 2200) opts.push({ total: dist * DETOUR / WALK, rides: 0, legs: [{ kind: "walk", meters: dist, sec: dist * DETOUR / WALK, fromPoint: o, toPoint: d }] });
    opts.sort((a, b) => score(a) - score(b));
    const bestScore = opts.length ? score(opts[0]) : 0;
    return opts.filter(x => score(x) <= bestScore * 1.35 + 300).slice(0, 4).sort((a, b) => a.total - b.total);
  };

  Network.prototype.patCoords = function (pi, a, b) {
    const p = this.pats[pi];
    return p.s.slice(a || 0, b === undefined ? p.s.length : b + 1).map(s => [this.lat[s], this.lng[s]]);
  };
  Network.prototype.coords = function (leg) {
    if (leg.kind === "ride") return this.patCoords(leg.pat, leg.bpos, leg.apos);
    const a = leg.fromPoint ? [leg.fromPoint.lat, leg.fromPoint.lng] : [this.lat[leg.from], this.lng[leg.from]];
    const b = leg.toPoint ? [leg.toPoint.lat, leg.toPoint.lng] : [this.lat[leg.to], this.lng[leg.to]];
    return [a, b];
  };

  root.Router = { Network, hav, holidays, ymd };
})(typeof window !== "undefined" ? window : globalThis);
