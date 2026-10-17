// Buscador de rutas: RAPTOR por rondas con frecuencias por hora.
// Solo usa las rutas que están en servicio a la hora en que se tomarían.
(function (root) {
  "use strict";
  const WALK = 1.2;          // m/s caminando
  const DETOUR = 1.25;       // las calles no son línea recta
  const XFER_RADIUS = 500;   // m para cambiar de paradero a pie
  const ACCESS_RADIUS = 1000;
  const MAX_RIDES = 4;
  const XFER_PENALTY = 300;
  const WALK_WEIGHT = 1.8;  // s extra por cada transbordo (incomodidad)
  const INF = 1e12;
  // Tarifa 2026 (Decreto Distrital, vigente desde el 14 de enero de 2026): igual para troncal, zonal y TransMiCable
  const FARE = 3550;
  const FREE_WINDOW = 125 * 60;     // con TuLlave personalizada: transbordos a $0 durante 125 minutos
  const FREE_XFERS = 2;
  const PESOS_PER_MIN = 150;        // cuánto vale un minuto para comparar tiempo y dinero
  const FARE_SEC = FARE / PESOS_PER_MIN * 60;
  const trunk = k => k === "T" || k === "C" || k === "D" || k === "A";

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
  // Costo extra (en segundos) de subirse a pi en la parada s en la ronda k
  Network.prototype.xferPen = function (rounds, k, s, pi, farePen) {
    if (k === 1) return 0;
    const P = rounds[k - 1];
    let src = s, exited = false;
    if (P.wp[s] >= 0) { src = P.wp[s]; exited = !(this.parent[src] >= 0 && this.parent[src] === this.parent[s]); }
    const ppi = P.rp[src];
    if (ppi < 0) return XFER_PENALTY;
    const pk = this.routes[this.pats[ppi].r].k, nk = this.routes[this.pats[pi].r].k;
    if (trunk(pk) && trunk(nk) && (!exited || pk === "A" || nk === "A")) return 60;   // sin salir de la estación
    return XFER_PENALTY + (k - 1 > FREE_XFERS ? FARE_SEC : farePen);
  };

  Network.prototype.raptor = function (o, d, banned, farePen) {
    farePen = farePen || 0;
    const N = this.N, walkT = m => m * DETOUR / WALK, T0 = this.t0;
    // Caminar más de 400 m pesa más que ir en bus: así se prefiere un alimentador a una caminata larga
    const walkW = m => walkT(Math.min(m, 400)) + walkT(Math.max(0, m - 400)) * WALK_WEIGHT;
    let access = this.near(o.lat, o.lng, ACCESS_RADIUS);
    if (access.length < 3) access = this.near(o.lat, o.lng, ACCESS_RADIUS * 2);
    let egress = this.near(d.lat, d.lng, ACCESS_RADIUS);
    if (egress.length < 3) egress = this.near(d.lat, d.lng, ACCESS_RADIUS * 2);
    const egMap = new Map(egress.map(([s, m]) => [s, m]));

    const best = new Float64Array(N).fill(INF);
    const rounds = [];
    const any0 = new Float64Array(N).fill(INF);
    let marked = [];
    for (const [s, m] of access) { any0[s] = walkW(m); best[s] = any0[s]; marked.push(s); }
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
            const cand = prev[s] + w + this.xferPen(rounds, k, s, pi, farePen);
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
        const t = ride[s] + walkW(m);
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
    const time = legs.reduce((t, l) => t + l.sec + (l.wait || 0), 0);   // tiempo real, sin castigos
    return { total: time, rides: r.rides, legs };
  };

  // Costo del viaje: troncal, alimentador, dual y cable sin salir de la estación = un solo ingreso.
  // Con TuLlave personalizada los dos primeros transbordos dentro de 125 min cuestan $0.
  Network.prototype.fare = function (op, personal) {
    const entries = [];
    let t = 0, prev = null, between = null;
    for (const l of op.legs) {
      if (l.kind !== "ride") { if (prev) between = l; t += l.sec; continue; }
      const k = this.routes[l.route].k, tb = t + (l.wait || 0);
      let cont = false;
      if (prev) {
        const pk = this.routes[prev.route].k;
        const inside = !between || between.kind !== "xfer" || (this.parent[between.from] >= 0 && this.parent[between.from] === this.parent[between.to]) ||
          ((pk === "A" || k === "A") && between.meters < 300);
        cont = trunk(pk) && trunk(k) && inside;
      }
      if (!cont) { entries.push({ t: tb, alim: k === "A", legs: [l] }); }
      else { const e = entries[entries.length - 1]; e.legs.push(l); if (k !== "A") e.alim = false; }
      t = tb + l.sec; prev = l; between = null;
    }
    let cost = 0, full = 0, start = null, used = 0;
    for (const e of entries) {
      let pay;
      if (e.alim) pay = "alim";
      else if (start === null || !personal || used >= FREE_XFERS || e.t - start > FREE_WINDOW) { cost += FARE; full++; start = e.t; used = 0; pay = "full"; }
      else { used++; pay = "free"; }
      e.legs.forEach((l, i) => { l.pay = i === 0 ? pay : "inside"; });
    }
    return { cost, full, entries: entries.length };
  };
  Network.FARE = FARE;

  // Opciones variadas para la hora indicada (por defecto, ahora)
  Network.prototype.plan = function (o, d, when, personal) {
    this.setTime(when || new Date());
    personal = personal !== false;
    const opts = [], seen = new Set();
    // Puntaje: tiempo real + dinero convertido a minutos + incomodidad de cada transbordo
    const score = x => {
      if (x.score === undefined) {
        const f = this.fare(x, personal); x.cost = f.cost; x.fares = f.full;
        x.xfers = Math.max(0, f.entries - 1);   // transbordos que implican salir y volver a validar
        const longWalk = x.legs.reduce((s, l) => s + (l.kind === "ride" ? 0 : Math.max(0, (l.meters || 0) - 400) * DETOUR / WALK), 0);
        x.score = x.total + f.cost / PESOS_PER_MIN * 60 + Math.max(0, x.rides - 1) * XFER_PENALTY + x.xfers * XFER_PENALTY + longWalk * (WALK_WEIGHT - 1);
      }
      return x.score;
    };
    const add = it => {
      const sig = it.legs.filter(l => l.kind === "ride").map(l => l.route).join(">");
      if (!sig || seen.has(sig)) return;
      seen.add(sig); opts.push(it);
    };
    this.raptor(o, d, null, personal ? 0 : FARE_SEC).forEach(add);
    // Variante que evita pagar otro pasaje: privilegia seguir dentro del sistema troncal
    this.raptor(o, d, null, FARE_SEC).forEach(add);
    const banned = new Set();
    for (let attempt = 0; attempt < 2 && opts.length; attempt++) {
      const main = opts.slice().sort((a, b) => score(a) - score(b))[0];
      const longest = main.legs.filter(l => l.kind === "ride").sort((a, b) => b.sec - a.sec)[0];
      if (!longest) break;
      banned.add(longest.route);
      const alt = this.raptor(o, d, banned, personal ? 0 : FARE_SEC);
      if (!alt.length) break;
      alt.sort((a, b) => score(a) - score(b)); add(alt[0]);
    }
    const dist = hav(o.lat, o.lng, d.lat, d.lng);
    if (dist < 2200) opts.push({ total: dist * DETOUR / WALK, rides: 0, legs: [{ kind: "walk", meters: dist, sec: dist * DETOUR / WALK, fromPoint: o, toPoint: d }] });
    opts.sort((a, b) => score(a) - score(b));
    const bestScore = opts.length ? score(opts[0]) : 0;
    return opts.filter(x => score(x) <= bestScore * 1.3 + 300).slice(0, 4);   // la primera es la recomendada
  };

  function decode(str) {
    const out = []; let i = 0, la = 0, lo = 0;
    while (i < str.length) {
      for (let k = 0; k < 2; k++) {
        let shift = 0, res = 0, c;
        do { c = str.charCodeAt(i++) - 63; res |= (c & 0x1f) << shift; shift += 5; } while (c >= 0x20);
        const v = res & 1 ? ~(res >> 1) : res >> 1;
        if (k === 0) la += v; else lo += v;
      }
      out.push([la / 1e5, lo / 1e5]);
    }
    return out;
  }
  // Trazado real por las calles entre dos paradas del patrón (o rectas entre paradas si no hay trazado)
  Network.prototype.patCoords = function (pi, a, b) {
    const p = this.pats[pi];
    a = a || 0; b = b === undefined ? p.s.length - 1 : b;
    if (p.g && p.gi) {
      if (!p.line) p.line = decode(p.g);
      const seg = p.line.slice(p.gi[a], p.gi[b] + 1);
      if (seg.length >= 2) return seg;
    }
    return p.s.slice(a, b + 1).map(s => [this.lat[s], this.lng[s]]);
  };
  Network.prototype.coords = function (leg) {
    if (leg.kind === "ride") return this.patCoords(leg.pat, leg.bpos, leg.apos);
    const a = leg.fromPoint ? [leg.fromPoint.lat, leg.fromPoint.lng] : [this.lat[leg.from], this.lng[leg.from]];
    const b = leg.toPoint ? [leg.toPoint.lat, leg.toPoint.lng] : [this.lat[leg.to], this.lng[leg.to]];
    return [a, b];
  };

  root.Router = { Network, hav, holidays, ymd };
})(typeof window !== "undefined" ? window : globalThis);
