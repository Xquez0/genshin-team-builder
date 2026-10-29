// Fase 4: recomendador de equipos.
// 1) Plantillas de guías (data/equipos) que el jugador puede armar con sus personajes, usando sustitutos si hace falta.
// 2) Si no hay plantilla, equipo "improvisado" armado por roles y sinergias (data/roles_sinergias.json).
// Los bonos de equipo (resonancia elemental, Moonsign y Hexerei) se calculan con data/mecanicas_verificadas.json.
(function (root) {
  "use strict";
  const esNode = typeof module !== "undefined" && module.exports;
  const Good = esNode ? require("./good.js") : root.GTB.Good;
  const Equipos = esNode ? require("./equipos.js") : root.GTB.Equipos;
  const norm = (n) => Good.normKey(String(n).replace(/^Viajer[oa]\s*/i, "Traveler "));

  // Puntos para ordenar equipos. Son una escala del proyecto, no datos del juego.
  const PUNTOS = {
    calidad: 10, sustituto: -3, pierdeReaccion: -12, sinHabilitador: -15, moonsignBajo: -5,
    nivelMuyBajo: -6, nivelBajo: -3, nivelMedio: -1.5, detallePendiente: -1,
    resonancia: { alto: 3, medio: 2, bajo: 1, muy_bajo: 0.5 }, moonsignNivel: 1.5, secretRite: 2,
    elementoEstorba: -2, improvisadoBase: 15, sinergiaMax: 10, faltaSustento: -4, faltaApoyo: -3, dpsDeMas: -6, reaccionHabilitada: 4
  };
  const ROLES_ES = { dps_principal: "DPS principal", sub_dps: "Sub-DPS", soporte: "Soporte", sustento: "Sustento" };
  const PARES = [ // reacciones estándar por par de elementos (la Geo y la Anemo reaccionan con Pyro, Hydro, Electro y Cryo)
    ["Pyro", "Hydro", "Vaporize"], ["Pyro", "Cryo", "Melt"], ["Pyro", "Electro", "Overload"], ["Hydro", "Electro", "Electro-Charged"],
    ["Hydro", "Cryo", "Freeze"], ["Electro", "Cryo", "Superconduct"], ["Dendro", "Pyro", "Burning"], ["Dendro", "Hydro", "Bloom"],
    ["Dendro", "Electro", "Aggravate"]
  ];
  const PHEC = ["Pyro", "Hydro", "Electro", "Cryo"];

  // ---------- Contexto ----------
  // datos: { mecanicas, plantillas: [...], roles: {_meta, personajes} }
  // personajes: estado.personajes de la app (o la lista de parseGood). opciones: { hexerei: true|false, excluir: [] }
  function crearContexto(datos, personajes, opciones) {
    const info = new Map(Object.values(datos.roles.personajes).map((p) => [norm(p.nombre), p]));
    const tengo = new Map();
    for (const p of Object.values(personajes || {})) {
      if (!p || p.tengo === false) continue;
      tengo.set(norm(p.key || p.id || p.nombre), { nivel: p.nivel || 1, constelacion: p.constelacion || 0 });
    }
    const op = { hexerei: true, ...(opciones || {}) };
    const excluir = new Set((op.excluir || []).map(norm));
    return { m: datos.mecanicas, plantillas: datos.plantillas, abismo: datos.abismo || null, info, tengo, op, excluir };
  }
  const lo = (ctx, n) => ctx.tengo.has(norm(n)) && !ctx.excluir.has(norm(n));
  const datosDe = (ctx, n) => ctx.info.get(norm(n));
  const nombreDe = (ctx, n) => { const i = datosDe(ctx, n); return i ? i.nombre : n; };

  // ---------- Bonos de equipo ----------
  function bonosEquipo(ctx, nombres) {
    const m = ctx.m, out = { resonancias: [], moonsign: 0, hexerei: { miembros: [], secretRite: false }, puntos: 0, etiquetas: [] };
    const elems = nombres.map((n) => (datosDe(ctx, n) || {}).elemento).filter(Boolean);
    const res = m.resonancia_elemental;
    if (res && nombres.length >= (res.minimo_miembros || 4) && elems.length === nombres.length) {
      const c = {}; elems.forEach((e) => (c[e] = (c[e] || 0) + 1));
      for (const [e, k] of Object.entries(c)) if (k >= 2 && res.resonancias[e]) {
        const r = res.resonancias[e];
        out.resonancias.push({ elemento: e, nombre: r.nombre, efecto: r.efecto });
        out.puntos += PUNTOS.resonancia[r.valor_para_recomendar] || 0;
        out.etiquetas.push("Resonancia " + e + " (" + r.nombre + ")");
      }
      if (Object.keys(c).length === nombres.length && res.cuatro_elementos_distintos) {
        const r = res.cuatro_elementos_distintos;
        out.resonancias.push({ elemento: "4 distintos", nombre: r.nombre, efecto: r.efecto });
        out.puntos += PUNTOS.resonancia[r.valor_para_recomendar] || 0;
        out.etiquetas.push("Resonancia de 4 elementos (" + r.nombre + ")");
      }
    }
    out.moonsign = Equipos.nivelMoonsign(m, nombres);
    if (out.moonsign > 0) out.etiquetas.push("Moonsign nivel " + out.moonsign + (out.moonsign === 2 ? " (Ascendant Gleam)" : " (Nascent Gleam)"));
    const hx = m.hexerei;
    if (hx) {
      const lista = new Set(hx.personajes.map(norm));
      out.hexerei.miembros = nombres.filter((n) => lista.has(norm(n))).map((n) => nombreDe(ctx, n));
      out.hexerei.secretRite = ctx.op.hexerei !== false && out.hexerei.miembros.length >= (hx.minimo_para_secret_rite || 2);
      if (out.hexerei.secretRite) { out.puntos += PUNTOS.secretRite; out.etiquetas.push("Hexerei: Secret Rite (" + out.hexerei.miembros.join(", ") + ")"); }
    }
    return out;
  }

  // Reacciones que puede provocar el equipo según sus elementos y habilitadores.
  function reaccionesPosibles(ctx, nombres) {
    const m = ctx.m, elems = new Set(nombres.map((n) => (datosDe(ctx, n) || {}).elemento).filter(Boolean));
    const out = [], reemplazadas = new Set();
    for (const grupo of [m.reacciones_lunares, m.reacciones_estelares]) {
      for (const [r, d] of Object.entries(grupo || {})) {
        if (!d || !d.elementos || !d.elementos.every((e) => elems.has(e))) continue;
        if (Equipos.evaluarEquipo(m, r, nombres).reaccionActiva) { out.push(r); if (d.reemplaza_a) reemplazadas.add(d.reemplaza_a); }
      }
    }
    const nombreEs = { "Electro-Charged": "Electrocargado", Bloom: "Florecimiento" };
    for (const [a, b, r] of PARES) if (elems.has(a) && elems.has(b) && !reemplazadas.has(nombreEs[r] || r)) out.push(r);
    if (elems.has("Anemo") && PHEC.some((e) => elems.has(e))) out.push("Swirl");
    if (elems.has("Geo") && PHEC.some((e) => elems.has(e))) out.push("Crystallize");
    return out;
  }

  function penalNivel(ctx, nombres, avisos) {
    let p = 0;
    for (const n of nombres) {
      const t = ctx.tengo.get(norm(n)); if (!t) continue;
      if (t.nivel < 50) { p += PUNTOS.nivelMuyBajo; avisos.push(nombreDe(ctx, n) + " está en nivel " + t.nivel + "."); }
      else if (t.nivel < 70) { p += PUNTOS.nivelBajo; avisos.push(nombreDe(ctx, n) + " está en nivel " + t.nivel + "."); }
      else if (t.nivel < 80) p += PUNTOS.nivelMedio;
    }
    return p;
  }

  // ---------- Plantillas de guías ----------
  // Elige la opción del hueco que menos resta: la base si está construida; si no, un sustituto con mejor nivel.
  function costeNivel(ctx, n) {
    const t = ctx.tengo.get(norm(n)); if (!t) return 0;
    return t.nivel < 50 ? PUNTOS.nivelMuyBajo : t.nivel < 70 ? PUNTOS.nivelBajo : t.nivel < 80 ? PUNTOS.nivelMedio : 0;
  }
  // Elementos que reaccionan con los de la reacción del equipo y pueden consumir sus auras (criterio del proyecto).
  // Ej.: en Stellar-Conduct (Electro + Cryo) un Pyro provoca Melt/Overload y gasta el Cryo o el Electro.
  const REACCIONA = { Pyro: ["Hydro", "Cryo", "Electro", "Dendro"], Hydro: ["Pyro", "Cryo", "Electro", "Dendro"], Electro: ["Pyro", "Hydro", "Cryo", "Dendro"], Cryo: ["Pyro", "Hydro", "Electro"], Dendro: ["Pyro", "Hydro", "Electro"] };
  function elementosDe(ctx, reaccion) {
    for (const g of [ctx.m.reacciones_lunares, ctx.m.reacciones_estelares]) if (g && g[reaccion] && g[reaccion].elementos) return g[reaccion].elementos;
    const par = PARES.find((x) => x[2] === reaccion);
    return par ? [par[0], par[1]] : null;
  }
  function estorba(ctx, reaccion, personaje) {
    const els = elementosDe(ctx, reaccion), e = (datosDe(ctx, personaje) || {}).elemento;
    if (!els || !e || els.includes(e) || !REACCIONA[e]) return null;
    const con = els.filter((x) => REACCIONA[e].includes(x));
    return con.length ? { elemento: e, consume: con } : null;
  }
  function mejorOpcion(ctx, opciones, usados, reaccion) {
    let mejor = -1, valor = -Infinity;
    opciones.forEach((o, i) => {
      if (!lo(ctx, o.personaje) || usados.has(norm(o.personaje))) return;
      const v = (i > 0 ? PUNTOS.sustituto : 0) + (o.pierde_reaccion ? PUNTOS.pierdeReaccion : 0) + costeNivel(ctx, o.personaje) - i * 0.01
        + (i > 0 && estorba(ctx, reaccion, o.personaje) ? PUNTOS.elementoEstorba : 0);
      if (v > valor) { valor = v; mejor = i; }
    });
    return mejor;
  }
  function evaluarPlantilla(ctx, p, forzar) {
    const fz = forzar ? norm(forzar) : null;
    const huecoForzado = fz ? p.huecos.findIndex((h) => h.opciones.some((o) => norm(o.personaje) === fz)) : -1;
    if (fz && huecoForzado < 0) return null;
    const usados = new Set(fz ? [fz] : []), miembros = [], faltan = [], avisos = [];
    p.huecos.forEach((h, i) => {
      const idx = i === huecoForzado
        ? (lo(ctx, forzar) ? h.opciones.findIndex((o) => norm(o.personaje) === fz) : -1)
        : mejorOpcion(ctx, h.opciones, usados, p.reaccion);
      if (idx < 0) { faltan.push({ rol: h.rol, opciones: (i === huecoForzado ? [{ personaje: forzar }] : h.opciones).map((o) => nombreDe(ctx, o.personaje)) }); return; }
      const o = h.opciones[idx]; usados.add(norm(o.personaje));
      miembros.push({ personaje: nombreDe(ctx, o.personaje), rol: h.rol, sustituto: idx > 0, reemplaza: idx > 0 ? nombreDe(ctx, h.opciones[0].personaje) : null,
        nota: o.nota || null, pierde_reaccion: !!o.pierde_reaccion, armas: o.armas || null, artefactos: o.artefactos || null });
    });
    const res = { tipo: "guia", id: p.id, nombre: p.nombre, dps: nombreDe(ctx, p.dps), reaccion: p.reaccion, calidad: p.calidad,
      descripcion: p.descripcion, rotacion: adaptarRotacion(ctx, p, miembros), rotacion_avisos: p.rotacion_avisos || [] };
    if (faltan.length) return { ...res, disponible: false, faltan };
    const nombres = miembros.map((x) => x.personaje);
    let puntaje = p.calidad * PUNTOS.calidad;
    const subs = miembros.filter((x) => x.sustituto);
    puntaje += subs.length * PUNTOS.sustituto;
    for (const s of subs) if (s.pierde_reaccion) { puntaje += PUNTOS.pierdeReaccion; avisos.push("Con " + s.personaje + " en lugar de " + s.reemplaza + " el equipo pierde " + p.reaccion + "."); }
    for (const s of subs) {
      const x = estorba(ctx, p.reaccion, s.personaje);
      if (x) {
        puntaje += PUNTOS.elementoEstorba;
        const h = p.huecos.find((hh) => hh.rol === s.rol);
        const otros = h ? h.opciones.slice(1).filter((o) => norm(o.personaje) !== norm(s.personaje) && !estorba(ctx, p.reaccion, o.personaje))
          .map((o) => { const t = ctx.tengo.get(norm(o.personaje)); return nombreDe(ctx, o.personaje) + (t ? " (lo tienes en nivel " + t.nivel + ")" : " (no lo tienes)"); }) : [];
        avisos.push(s.personaje + " es " + x.elemento + ": puede gastar el " + x.consume.join(" o el ") + " que necesita " + p.reaccion + " (criterio del proyecto)." + (otros.length ? " Sustitutos que no estorban: " + otros.join(", ") + "." : ""));
      }
    }
    const estandar = (ctx.m.reacciones_sin_habilitador || []).includes(p.reaccion) || ((ctx.m.equipos_sin_reaccion || {}).tipos || []).includes(p.reaccion);
    if (!estandar) {
      const ev = Equipos.evaluarEquipo(ctx.m, p.reaccion, nombres);
      if (!ev.reaccionActiva && !subs.some((s) => s.pierde_reaccion)) { puntaje += PUNTOS.sinHabilitador; avisos.push("Con estos sustitutos no queda ningún habilitador de " + p.reaccion + "."); }
      if ((p.moonsign_minimo || 0) > ev.moonsign) { puntaje += PUNTOS.moonsignBajo; avisos.push("Moonsign nivel " + ev.moonsign + "; la plantilla pide " + p.moonsign_minimo + "."); }
    }
    if (p.detalle_pendiente) { puntaje += PUNTOS.detallePendiente; avisos.push("A esta plantilla le faltan datos de la guía (armas o sustitutos)."); }
    const bonos = bonosEquipo(ctx, nombres);
    if (bonos.moonsign && /^Lunar/.test(p.reaccion)) puntaje += bonos.moonsign * PUNTOS.moonsignNivel;
    puntaje += bonos.puntos + penalNivel(ctx, nombres, avisos);
    return { ...res, disponible: true, miembros, bonos, reacciones: reaccionesPosibles(ctx, nombres), avisos, puntaje: Math.round(puntaje * 10) / 10 };
  }

  // La rotación de la guía nombra a los personajes base. Si usas un sustituto, se cambia el nombre y se avisa;
  // si nombra a alguien que no está en tu equipo, se marca el paso.
  function adaptarRotacion(ctx, p, miembros) {
    const enEquipo = new Set(miembros.map((m) => norm(m.personaje)));
    const todos = [...ctx.info.values()].map((x) => x.nombre).filter((n) => n.length > 3).sort((a, b) => b.length - a.length);
    return (p.rotacion || []).map((linea) => {
      let t = linea, avisos = [];
      for (const m of miembros) if (m.sustituto && m.reemplaza) {
        const re = new RegExp("\\b" + m.reemplaza.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
        if (re.test(t)) { t = t.replace(re, m.personaje); avisos.push("la guía lo hace con " + m.reemplaza); }
      }
      for (const n of todos) {
        if (enEquipo.has(norm(n)) || !new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(t)) continue;
        // De los huecos donde la guía admite a ese personaje, el que ocupa alguien que la rotación no nombra
        const huecos = p.huecos.map((hh, i) => i).filter((i) => p.huecos[i].opciones.some((o) => norm(o.personaje) === norm(n)) && miembros[i]);
        const nombrado = (i) => (p.rotacion || []).some((l) => l.includes(miembros[i].personaje));
        const h = huecos.find((i) => !nombrado(i)) ?? huecos[0];
        const quien = h != null && miembros[h] ? miembros[h].personaje : null;
        avisos.push(n + " no está en tu equipo" + (quien ? ": este paso hazlo con " + quien : ""));
      }
      return avisos.length ? t + " (" + avisos.join("; ") + ")" : t;
    });
  }

  // ---------- Equipo improvisado por roles ----------
  const rolesDe = (ctx, n) => new Set((datosDe(ctx, n) || {}).roles_principales || []);
  // Sustento (curación o escudo): casi nunca llega a "verificado" porque Game8 no tiene esa categoría,
  // así que aquí basta con que lo diga una fuente.
  const daSustento = (ctx, n) => ((datosDe(ctx, n) || {}).roles || []).some((r) => r.rol === "sustento");
  function cuenta(ctx, a, b) {
    const pa = datosDe(ctx, a), nb = norm(b);
    const x = pa && (pa.companeros_frecuentes || []).find((c) => norm(c.personaje) === nb);
    return x ? x.equipos : 0;
  }
  function sinergia(ctx, dps, nombres) {
    let s = 0;
    for (let i = 0; i < nombres.length; i++) for (let j = i + 1; j < nombres.length; j++) {
      const a = nombres[i], b = nombres[j], peso = norm(a) === norm(dps) || norm(b) === norm(dps) ? 2 : 1;
      s += peso * Math.min(10, (cuenta(ctx, a, b) + cuenta(ctx, b, a)) / 2);
    }
    return Math.min(PUNTOS.sinergiaMax, s / 6); // 6 pares en un equipo de 4
  }
  function puntuarImprovisado(ctx, dps, nombres, final) {
    let p = PUNTOS.improvisadoBase + sinergia(ctx, dps, nombres);
    const otros = nombres.filter((n) => norm(n) !== norm(dps));
    const roles = otros.map((n) => rolesDe(ctx, n));
    if (final) {
      if (!otros.some((n) => daSustento(ctx, n))) p += PUNTOS.faltaSustento;
      if (!roles.some((r) => r.has("soporte") || r.has("sub_dps"))) p += PUNTOS.faltaApoyo;
    }
    for (const r of roles) if (r.has("dps_principal") && !r.has("sub_dps") && !r.has("soporte") && !r.has("sustento")) p += PUNTOS.dpsDeMas;
    const posibles = reaccionesPosibles(ctx, nombres);
    if (posibles.some((r) => /^(Lunar|Stellar)/.test(r))) p += PUNTOS.reaccionHabilitada;
    if (final) { const b = bonosEquipo(ctx, nombres); p += b.puntos + (b.moonsign && posibles.some((r) => /^Lunar/.test(r)) ? b.moonsign * PUNTOS.moonsignNivel : 0); }
    return p;
  }
  function improvisado(ctx, dps, forzados) {
    const base = [dps, ...(forzados || [])].map((n) => nombreDe(ctx, n));
    if (base.some((n) => !lo(ctx, n))) return null;
    const cand = [...ctx.tengo.keys()].filter((k) => !ctx.excluir.has(k) && ctx.info.has(k) && !base.some((b) => norm(b) === k)).map((k) => ctx.info.get(k).nombre);
    let haz = [base];
    while (haz[0].length < 4) {
      const sig = [];
      for (const eq of haz) for (const c of cand) if (!eq.includes(c)) { const e = [...eq, c]; sig.push({ e, p: puntuarImprovisado(ctx, dps, e, e.length === 4) }); }
      if (!sig.length) return null;
      sig.sort((a, b) => b.p - a.p);
      const vistos = new Set(); haz = [];
      for (const s of sig) { const k = s.e.map(norm).sort().join("|"); if (!vistos.has(k)) { vistos.add(k); haz.push(s.e); } if (haz.length >= 6) break; }
    }
    const nombres = haz[0], avisos = [];
    const bonos = bonosEquipo(ctx, nombres);
    const puntaje = puntuarImprovisado(ctx, dps, nombres, true) + penalNivel(ctx, nombres, avisos);
    const reacciones = reaccionesPosibles(ctx, nombres);
    const miembros = nombres.map((n) => {
      const r = [...rolesDe(ctx, n)];
      return { personaje: n, rol: norm(n) === norm(dps) ? "dps_principal" : r.filter((x) => x !== "dps_principal")[0] || r[0] || "flexible", roles: r, sustituto: false };
    });
    if (!miembros.slice(1).some((x) => daSustento(ctx, x.personaje))) avisos.push("No hay ningún personaje de sustento (curación o escudo).");
    avisos.push("Equipo improvisado: no sale de una guía; se armó por roles y por los compañeros más frecuentes en GenshinBuilds.");
    return { tipo: "improvisado", id: "improvisado-" + norm(dps) + "-" + nombres.slice(1).map(norm).sort().join("-"), nombre: "Equipo improvisado de " + nombreDe(ctx, dps),
      dps: nombreDe(ctx, dps), reaccion: reacciones[0] || null, reacciones, calidad: null, disponible: true, miembros, bonos, avisos, puntaje: Math.round(puntaje * 10) / 10 };
  }

  // ---------- Modos ----------
  const clave = (eq) => eq.miembros.map((x) => norm(x.personaje)).sort().join("|");
  function unicos(lista) {
    const v = new Set(), out = [];
    for (const e of lista.sort((a, b) => b.puntaje - a.puntaje)) { const k = clave(e); if (!v.has(k)) { v.add(k); out.push(e); } }
    return out;
  }
  const dpsPropios = (ctx) => [...ctx.tengo.keys()].filter((k) => !ctx.excluir.has(k) && ctx.info.has(k) && rolesDe(ctx, k).has("dps_principal")).map((k) => ctx.info.get(k).nombre);

  // Todas las opciones: plantillas que se pueden armar + un improvisado por cada DPS propio sin plantilla disponible.
  function candidatos(ctx) {
    const guias = ctx.plantillas.map((p) => evaluarPlantilla(ctx, p)).filter((e) => e && e.disponible);
    const conGuia = new Set(guias.map((e) => norm(e.dps)));
    const imp = dpsPropios(ctx).filter((d) => !conGuia.has(norm(d))).map((d) => improvisado(ctx, d)).filter(Boolean);
    return unicos([...guias, ...imp]);
  }
  function mejores(ctx, n) { return candidatos(ctx).slice(0, n || 10); }

  // Equipos para un personaje elegido (DPS o apoyo).
  function porPersonaje(ctx, personaje, n) {
    if (!lo(ctx, personaje)) return { equipos: [], faltan: [], aviso: nombreDe(ctx, personaje) + " no está marcado como tuyo." };
    const guias = ctx.plantillas.map((p) => evaluarPlantilla(ctx, p, personaje)).filter(Boolean);
    const disponibles = guias.filter((e) => e.disponible);
    const lista = [...disponibles];
    if (rolesDe(ctx, personaje).has("dps_principal")) { const i = improvisado(ctx, personaje); if (i) lista.push(i); }
    else {
      const info = datosDe(ctx, personaje) || {};
      const dpsCompa = (info.companeros_frecuentes || []).map((c) => c.personaje).filter((c) => lo(ctx, c) && rolesDe(ctx, c).has("dps_principal")).slice(0, 3);
      for (const d of dpsCompa) { const i = improvisado(ctx, d, [personaje]); if (i) lista.push(i); }
    }
    // Plantillas que casi se pueden armar: le falta un solo hueco
    const casi = guias.filter((e) => !e.disponible && e.faltan.length === 1).slice(0, 5);
    return { equipos: unicos(lista).slice(0, n || 6), casi };
  }

  // ---------- Abismo ----------
  // Cuánto encaja un equipo en una mitad de un piso, según lo que pide (data/abismo_actual.json).
  function ajusteMitad(ctx, eq, mitad) {
    const pide = mitad.pide || {}, out = { puntos: 0, razones: [], faltas: [], notas: [] };
    const reacs = new Set([...(eq.reacciones || []), eq.reaccion].filter(Boolean));
    const elem = (n) => (datosDe(ctx, n) || {}).elemento;
    const miembros = eq.miembros.map((x) => x.personaje), otros = miembros.filter((n) => norm(n) !== norm(eq.dps));
    const suma = (p, txt) => { out.puntos += p; out.razones.push(txt); };
    if (pide.reacciones) {
      const r = pide.reacciones.lista.filter((x) => reacs.has(x));
      if (r.length) suma(pide.reacciones.puntos, r.join(" / ") + ": " + pide.reacciones.motivo);
      else out.faltas.push("No provoca " + pide.reacciones.lista.join(" ni ") + " (" + pide.reacciones.motivo + ").");
    }
    if (pide.elemento_dps) {
      if (elem(eq.dps) === pide.elemento_dps.elemento) suma(pide.elemento_dps.puntos, "DPS " + pide.elemento_dps.elemento + ": " + pide.elemento_dps.motivo);
      else out.faltas.push("El DPS no es " + pide.elemento_dps.elemento + " (" + pide.elemento_dps.motivo + ").");
    }
    if (pide.elemento_equipo) {
      const k = otros.filter((n) => elem(n) === pide.elemento_equipo.elemento).length;
      if (k) suma(k * pide.elemento_equipo.puntos, k + " personaje(s) " + pide.elemento_equipo.elemento + " más: " + pide.elemento_equipo.motivo);
    }
    if (pide.elementos_utiles) {
      const e = miembros.filter((n) => pide.elementos_utiles.lista.includes(elem(n)));
      if (e.length) suma(pide.elementos_utiles.puntos, "Tiene " + pide.elementos_utiles.lista.join("/") + " (" + e.join(", ") + "): " + pide.elementos_utiles.motivo);
      else out.faltas.push("Sin " + pide.elementos_utiles.lista.join("/") + ": " + pide.elementos_utiles.motivo);
    }
    if (pide.reacciones_utiles) {
      const r = pide.reacciones_utiles.lista.filter((x) => reacs.has(x));
      if (r.length) suma(pide.reacciones_utiles.puntos, r.join(" / ") + ": " + pide.reacciones_utiles.motivo);
      else out.faltas.push("Sin " + pide.reacciones_utiles.lista.join(" ni ") + ": " + pide.reacciones_utiles.motivo);
    }
    if (pide.sanador) {
      const s = miembros.filter((n) => daSustento(ctx, n));
      if (s.length) out.razones.push("Sustento: " + s.join(", ") + " (comprueba que cure: " + pide.sanador.motivo + ")");
      else { out.puntos += pide.sanador.puntos; out.faltas.push("Sin sanador. " + pide.sanador.motivo); }
    }
    if (pide.escudo_desaconsejado) out.notas.push(pide.escudo_desaconsejado.motivo);
    const b = ctx.abismo && ctx.abismo.bendicion;
    if (b) {
      const conCryo = miembros.some((n) => elem(n) === "Cryo");
      const r = b.reacciones.filter((x) => reacs.has(x));
      if (reacs.has("Swirl") && conCryo && b.torbellino_de === "Cryo") r.push("torbellino Cryo");
      if (r.length) suma(1.5, "Activa la bendición " + b.nombre + " (" + r.join(", ") + ")");
    }
    out.puntos = Math.round(out.puntos * 10) / 10;
    return out;
  }

  // Abismo: dos equipos sin repetir personajes. Con datos del piso, cada equipo se puntúa para su mitad.
  function abismo(ctx, opciones) {
    const op = opciones || {};
    const piso = ctx.abismo && ctx.abismo.pisos.find((p) => p.piso === (op.piso || 12));
    // Más variedad que en "mejores": también un improvisado por cada DPS propio
    const lista = unicos([...candidatos(ctx), ...dpsPropios(ctx).map((d) => improvisado(ctx, d)).filter(Boolean)]);
    if (!piso) {
      const pares = [], top = lista.slice(0, 60);
      for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
        const a = new Set(top[i].miembros.map((x) => norm(x.personaje)));
        if (top[j].miembros.some((x) => a.has(norm(x.personaje)))) continue;
        pares.push({ equipos: [top[i], top[j]], puntaje: Math.round((top[i].puntaje + top[j].puntaje) * 10) / 10 });
      }
      return pares.sort((a, b) => b.puntaje - a.puntaje).slice(0, op.n || 3);
    }
    const [m1, m2] = piso.mitades;
    const conAjuste = (m) => lista.map((e) => { const aj = ajusteMitad(ctx, e, m); return { e, aj, total: e.puntaje + aj.puntos }; }).sort((a, b) => b.total - a.total).slice(0, 40);
    const l1 = conAjuste(m1), l2 = conAjuste(m2), pares = [];
    for (const a of l1) {
      const usa = new Set(a.e.miembros.map((x) => norm(x.personaje)));
      for (const b of l2) {
        if (b.e.miembros.some((x) => usa.has(norm(x.personaje)))) continue;
        pares.push({ piso: piso.piso, equipos: [a.e, b.e], ajustes: [a.aj, b.aj], puntaje: Math.round((a.total + b.total) * 10) / 10 });
      }
    }
    pares.sort((a, b) => b.puntaje - a.puntaje);
    const out = [], vistos = new Set();
    for (const p of pares) { const k = clave(p.equipos[0]) + "#" + clave(p.equipos[1]); if (!vistos.has(k)) { vistos.add(k); out.push(p); } if (out.length >= (op.n || 3)) break; }
    return out;
  }

  const api = { PUNTOS, ROLES_ES, crearContexto, bonosEquipo, reaccionesPosibles, evaluarPlantilla, improvisado, candidatos, mejores, porPersonaje, ajusteMitad, abismo };
  if (esNode) module.exports = api;
  else { root.GTB = root.GTB || {}; root.GTB.Recomendador = api; }
})(typeof window !== "undefined" ? window : globalThis);
