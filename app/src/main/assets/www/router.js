// Buscador de rutas: RAPTOR por rondas con frecuencias (espera = mitad del intervalo entre buses).
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
    // patrones que pasan por cada parada
    this.stopPats = Array.from({ length: N }, () => []);
    this.pats.forEach((p, pi) => {
      p.cum = new Float64Array(p.s.length);
      for (let i = 1; i < p.s.length; i++) p.cum[i] = p.cum[i - 1] + p.t[i - 1];
      p.s.forEach((s, pos) => this.stopPats[s].push(pi, pos));
    });
    // tipo de parada: estación si la sirve una troncal
    this.isStation = new Uint8Array(N);
    this.pats.forEach(p => { if (this.routes[p.r].k === "T") p.s.forEach(s => this.isStation[s] = 1); });
    // rejilla espacial de ~330 m
    this.cell = 0.003; this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const k = this.key(this.lat[i], this.lng[i]);
      let c = this.grid.get(k); if (!c) this.grid.set(k, c = []); c.push(i);
    }
    this.xfer = new Array(N);
  }
  Network.prototype.key = function (la, lo) { return Math.floor(la / this.cell) + ":" + Math.floor(lo / this.cell); };
  Network.prototype.near = function (la, lo, r) {
    const out = [], span = Math.ceil(r / 330) , ci = Math.floor(la / this.cell), cj = Math.floor(lo / this.cell);
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
  Network.prototype.wait = function (pi) {
    const p = this.pats[pi], k = this.routes[p.r].k;
    return Math.min(p.w / 2, 900) + (k === "T" ? 45 : 20);
  };

  // Una pasada de RAPTOR. banned: Set de índices de ruta que no se pueden usar.
  Network.prototype.raptor = function (o, d, banned) {
    const N = this.N, walkT = m => m * DETOUR / WALK;
    let access = this.near(o.lat, o.lng, ACCESS_RADIUS);
    if (access.length < 3) access = this.near(o.lat, o.lng, ACCESS_RADIUS * 2);
    let egress = this.near(d.lat, d.lng, ACCESS_RADIUS);
    if (egress.length < 3) egress = this.near(d.lat, d.lng, ACCESS_RADIUS * 2);
    const egMap = new Map(egress.map(([s, m]) => [s, m]));

    const best = new Float64Array(N).fill(INF);
    const rounds = []; // por ronda: {any, ride, rp, rb, wp}
    const any0 = new Float64Array(N).fill(INF);
    let marked = [];
    for (const [s, m] of access) { any0[s] = walkT(m); best[s] = any0[s]; marked.push(s); }
    rounds.push({ any: any0, accessDist: new Map(access) });

    const results = [];
    for (let k = 1; k <= MAX_RIDES && marked.length; k++) {
      const prev = rounds[k - 1].any;
      const ride = new Float64Array(N).fill(INF), rp = new Int32Array(N).fill(-1), rb = new Int32Array(N);
      // patrones a recorrer y desde qué posición
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
        const p = this.pats[pi], wait = this.wait(pi);
        let boardPos = -1, boardT = INF;
        for (let i = start; i < p.s.length; i++) {
          const s = p.s[i];
          if (boardPos >= 0) {
            const t = boardT + p.cum[i] - p.cum[boardPos];
            if (t < ride[s] && t < best[s]) { ride[s] = t; rp[s] = pi; rb[s] = boardPos; }
          }
          if (prev[s] < INF) {
            const cand = prev[s] + wait + pen;
            const curAt = boardPos >= 0 ? boardT + p.cum[i] - p.cum[boardPos] : INF;
            if (cand < curAt) { boardPos = i; boardT = cand; }
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
      rounds.push({ any, ride, rp, rb, wp });
      marked = [...next];
      // mejor llegada al destino con k viajes
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
      legs.unshift({ kind: "ride", pat: pi, route: p.r, from: bs, to: s, bpos, apos,
        sec: p.cum[apos] - p.cum[bpos], wait: this.wait(pi) });
      // cómo llegó a la parada de abordaje en la ronda anterior
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

  // Opciones variadas: mejores por número de viajes + alternativas sin la ruta principal.
  Network.prototype.plan = function (o, d) {
    const opts = [], seen = new Set();
    const add = it => {
      const sig = it.legs.filter(l => l.kind === "ride").map(l => l.route).join(">");
      if (!sig || seen.has(sig)) return;
      seen.add(sig); opts.push(it);
    };
    const first = this.raptor(o, d, null);
    first.forEach(add);
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
    // caminar si es corto
    const dist = hav(o.lat, o.lng, d.lat, d.lng);
    if (dist < 2200) opts.push({ total: dist * DETOUR / WALK, rides: 0, legs: [{ kind: "walk", meters: dist, sec: dist * DETOUR / WALK, fromPoint: o, toPoint: d }] });
    // quitar opciones claramente peores
    opts.sort((a, b) => score(a) - score(b));
    const bestScore = opts.length ? score(opts[0]) : 0;
    return opts.filter(x => score(x) <= bestScore * 1.35 + 300).slice(0, 4).sort((a, b) => a.total - b.total);
    function score(x) { return x.total + Math.max(0, x.rides - 1) * 240; }
  };

  Network.prototype.coords = function (leg) {
    if (leg.kind === "ride") { const p = this.pats[leg.pat]; return p.s.slice(leg.bpos, leg.apos + 1).map(s => [this.lat[s], this.lng[s]]); }
    const a = leg.fromPoint ? [leg.fromPoint.lat, leg.fromPoint.lng] : [this.lat[leg.from], this.lng[leg.from]];
    const b = leg.toPoint ? [leg.toPoint.lat, leg.toPoint.lng] : [this.lat[leg.to], this.lng[leg.to]];
    return [a, b];
  };

  root.Router = { Network, hav };
})(typeof window !== "undefined" ? window : globalThis);
