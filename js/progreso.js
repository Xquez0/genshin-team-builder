// Fase 5 (armas y artefactos) y Fase 6 (qué seguir construyendo).
// Fase 5: compara las armas del jugador con las recomendadas por las guías. Los artefactos no se cargan: solo se muestra qué buscar.
// Fase 6: con nivel, talentos (del archivo GOOD) y constelaciones, dice qué mejorar primero en los personajes de los equipos recomendados.
(function (root) {
  "use strict";
  const esNode = typeof module !== "undefined" && module.exports;
  const Good = esNode ? require("./good.js") : root.GTB.Good;
  const norm = (n) => Good.normKey(String(n).replace(/^Viajer[oa]\s*/i, "Traveler "));
  const TIPO_PJ = { "Espada ligera": "Espada", Mandoble: "Mandoble", Lanza: "Lanza", Arco: "Arco", Catalizador: "Catalizador" };
  const TALENTO_ES = { ataque: "Ataque Normal", habilidad: "Elemental", explosion: "Definitiva" };
  // Metas del proyecto (no vienen de las guías): talentos importantes a 9 en DPS principal y a 8 en el resto; nivel 80 mínimo.
  const META = { talentoDps: 9, talentoApoyo: 8, nivelMinimo: 80, nivelPrioritario: 90 };

  function crear(datos) {
    const cat = datos.catalogo || { armas: [], conjuntos: {} };
    const armas = new Map(cat.armas.map((a) => [norm(a.nombre), a]));
    // Para sustitutos sin equipo en la plantilla: primera plantilla donde ese personaje sí trae arma y artefactos
    const equipoDe = new Map();
    for (const p of datos.plantillas || []) for (const h of p.huecos) for (const o of h.opciones)
      if (o.armas && o.artefactos && !equipoDe.has(norm(o.personaje))) equipoDe.set(norm(o.personaje), { armas: o.armas, artefactos: o.artefactos, plantilla: p.nombre });
    const ranking = new Map(Object.entries((datos.armasPorPersonaje && datos.armasPorPersonaje.personajes) || {}).map(([n, v]) => [norm(n), v.armas]));
    const setsPj = new Map(Object.entries((datos.conjuntosPorPersonaje && datos.conjuntosPorPersonaje.personajes) || {}).map(([n, v]) => [norm(n), v.conjuntos]));
    const objetivos = new Map(Object.entries((datos.objetivos && datos.objetivos.personajes) || {}).map(([n, v]) => [norm(n), v]));
    const ef = datos.efectos || { personajes: {}, armas: {}, conjuntos: {} };
    const efPj = new Map(Object.entries(ef.personajes).map(([n, v]) => [norm(n), v]));
    const efArma = new Map(Object.entries(ef.armas).map(([n, v]) => [norm(n), v]));
    const efSet = new Map(Object.entries(ef.conjuntos).map(([n, v]) => [norm(n), v]));
    const hexerei = new Set(((datos.mecanicas && datos.mecanicas.hexerei && datos.mecanicas.hexerei.personajes) || []).map(norm));
    return { hexerei, setsPj, efPj, efArma, efSet, armas, conjuntos: cat.conjuntos || {}, talentos: (datos.talentos && datos.talentos.personajes) || {}, roles: datos.roles.personajes, equipoDe, ranking, objetivos };
  }
  // Arma y artefactos de un miembro: los de la plantilla o, si es sustituto sin datos, los de otra plantilla
  function equipoDe(P, miembro) {
    if (miembro.armas || miembro.artefactos) return { armas: miembro.armas, artefactos: miembro.artefactos, de: null };
    const e = P.equipoDe.get(norm(miembro.personaje));
    return e ? { armas: e.armas, artefactos: e.artefactos, de: e.plantilla } : { armas: null, artefactos: null, de: null };
  }
  const armaEs = (P, n) => { const a = P.armas.get(norm(n)); return a ? a.nombreEs : n; };
  const conjuntoEs = (P, n) => P.conjuntos[n] || n;

  // ---------- Fase 5 ----------
  // misArmas: estado.armas de la app [{key, nivel, refinamiento, equipadoEn}]
  function revisarArma(P, personaje, recomendadas, misArmas) {
    const info = Object.values(P.roles).find((p) => norm(p.nombre) === norm(personaje)) || {};
    const tipo = TIPO_PJ[info.arma] || null;
    const mias = (misArmas || []).map((w) => ({ ...w, k: norm(w.key) }));
    const out = { personaje, recomendadas: (recomendadas || []).map((a) => ({ nombre: a.nombre, nombreEs: armaEs(P, a.nombre), nota: a.nota || null })) };
    for (let i = 0; i < out.recomendadas.length; i++) {
      const r = out.recomendadas[i], copias = mias.filter((w) => w.k === norm(r.nombre));
      if (!copias.length) continue;
      copias.sort((a, b) => (norm(b.equipadoEn) === norm(personaje)) - (norm(a.equipadoEn) === norm(personaje)) || b.refinamiento - a.refinamiento || b.nivel - a.nivel);
      const w = copias[0], equipada = norm(w.equipadoEn) === norm(personaje);
      return { ...out, estado: equipada ? "equipada" : "la_tienes", opcion: i + 1, arma: r, tuya: { nivel: w.nivel, refinamiento: w.refinamiento, equipadaEn: w.equipadoEn || null }, copias: copias.length };
    }
    // No tiene ninguna recomendada: armas propias del mismo tipo, sin juzgar si encajan (eso no está verificado)
    const mismoTipo = tipo ? mias.filter((w) => { const a = P.armas.get(w.k); return a && a.tipo === tipo && a.rareza >= 4; })
      .map((w) => ({ ...w, a: P.armas.get(w.k) })).sort((x, y) => y.a.rareza - x.a.rareza || y.nivel - x.nivel || y.refinamiento - x.refinamiento) : [];
    const vistas = new Set(), alternativas = [];
    for (const w of mismoTipo) { if (vistas.has(w.k)) continue; vistas.add(w.k); alternativas.push({ nombre: w.a.nombre, nombreEs: w.a.nombreEs, rareza: w.a.rareza, nivel: w.nivel, refinamiento: w.refinamiento }); if (alternativas.length >= 3) break; }
    return { ...out, estado: "no_la_tienes", tipo, alternativas };
  }
  function textoArma(r) {
    if (!r.recomendadas.length) return null;
    if (r.estado === "equipada") return "✔ Lleva " + r.arma.nombreEs + " R" + r.tuya.refinamiento + " (nivel " + r.tuya.nivel + ")" + (r.opcion > 1 ? ", opción " + r.opcion + " de la guía" : "");
    if (r.estado === "la_tienes") return "↻ Tienes " + r.arma.nombreEs + " R" + r.tuya.refinamiento + " (nivel " + r.tuya.nivel + ")" + (r.tuya.equipadaEn ? ", la lleva " + Good.bonito(r.tuya.equipadaEn) : ", sin equipar");
    return "✘ No tienes " + r.recomendadas.map((a) => a.nombreEs).join(" ni ") + (r.alternativas.length ? ". Tus armas de " + r.tipo.toLowerCase() + " de 4★ o más: " + r.alternativas.map((a) => a.nombreEs + " R" + a.refinamiento + " nv" + a.nivel).join(", ") + " (no verificado si sirven)" : "");
  }
  // Lista de armas para un personaje en un equipo: primero las de la guía del equipo y luego el orden general (KQM + GameWith).
  function listaArmas(P, personaje, armasGuia, eqx) {
    const out = [], visto = new Set();
    for (const a of armasGuia || []) if (!visto.has(norm(a.nombre))) { visto.add(norm(a.nombre)); out.push({ nombre: a.nombre, fuentes: ["guía del equipo"], nota: a.nota || null }); }
    for (const a of P.ranking.get(norm(personaje)) || []) {
      const k = norm(a.nombre);
      if (visto.has(k)) { const x = out.find((y) => norm(y.nombre) === k); x.fuentes = [...new Set([...x.fuentes, ...a.fuentes])]; continue; }
      visto.add(k); out.push({ nombre: a.nombre, fuentes: a.fuentes, nota: a.nota_kqm || null });
    }
    if (!eqx) return out;
    // Las armas cuya pasiva no se activa en este equipo pasan al final (se mantiene el orden entre ellas)
    for (const a of out) a.inactiva = pasivaNoActiva(P, a.nombre, personaje, eqx);
    return [...out.filter((a) => !a.inactiva), ...out.filter((a) => a.inactiva)];
  }
  // ---------- Condiciones de pasivas y conjuntos dentro de un equipo ----------
  // Lo que el equipo ofrece: escudo, cambios de vida (p. ej. Furina), Nightsoul del portador.
  function contextoEquipo(P, nombres) {
    const pj = (n) => P.efPj.get(norm(n)) || {};
    return { nombres, escudo: nombres.filter((n) => pj(n).da_escudo), cambiaVida: nombres.filter((n) => pj(n).cambia_vida_del_equipo), nightsoul: (n) => !!pj(n).nightsoul };
  }
  // ¿Se activa la pasiva del arma en este equipo con este portador? Devuelve null si sí, o el motivo si no.
  function pasivaNoActiva(P, arma, portador, eqx) {
    const et = (P.efArma.get(norm(arma)) || {}).etiquetas || [];
    if (et.includes("necesita_escudo") && !eqx.escudo.length) return "su pasiva necesita un escudo y en este equipo nadie lo da";
    if (et.includes("sin_escudo") && eqx.escudo.length) return "su pasiva funciona sin escudo y aquí hay escudo (" + eqx.escudo.join(", ") + ")";
    if (et.includes("necesita_cambio_vida") && !eqx.cambiaVida.length) return "su pasiva necesita que la vida suba o baje y nadie del equipo la cambia";
    if (et.includes("nightsoul") && !eqx.nightsoul(portador)) return "su pasiva usa Nightsoul y " + portador + " no lo tiene";
    return null;
  }
  // Reparte tus armas entre los miembros de un equipo: el DPS elige primero y no se usa la misma copia dos veces.
  // miembros: [{personaje, armasGuia}], dps: nombre del DPS.
  // usadas: copias ya repartidas (para repartir entre dos equipos del Abismo sin repetir).
  function asignarArmas(P, miembros, misArmas, dps, usadas) {
    const copias = new Map();
    (misArmas || []).forEach((w, i) => { const k = norm(w.key); copias.set(k, [...(copias.get(k) || []), { ...w, i }]); });
    usadas = usadas || new Set();
    const orden = miembros.map((m, i) => ({ m, i })).sort((a, b) => (norm(b.m.personaje) === norm(dps)) - (norm(a.m.personaje) === norm(dps)) || a.i - b.i);
    const res = new Array(miembros.length);
    const eqx = contextoEquipo(P, miembros.map((m) => m.personaje));
    const nombresUsados = new Map(), noAcu = {};
    for (const { m, i } of orden) {
      const lista = listaArmas(P, m.personaje, m.armasGuia, eqx);
      let elegido = null;
      for (let j = 0; j < lista.length && !elegido; j++) {
        const etA = (P.efArma.get(norm(lista[j].nombre)) || {}).etiquetas || [];
        if (etA.includes("no_acumulable") && nombresUsados.has(norm(lista[j].nombre))) { (noAcu[i] = noAcu[i] || []).push(armaEs(P, lista[j].nombre) + " no se acumula y ya la lleva " + nombresUsados.get(norm(lista[j].nombre))); continue; }
        const libres = (copias.get(norm(lista[j].nombre)) || []).filter((w) => !usadas.has(w.i));
        if (!libres.length) continue;
        libres.sort((a, b) => (norm(b.equipadoEn) === norm(m.personaje)) - (norm(a.equipadoEn) === norm(m.personaje)) || b.refinamiento - a.refinamiento || b.nivel - a.nivel);
        const w = libres[0]; usadas.add(w.i); nombresUsados.set(norm(lista[j].nombre), m.personaje);
        const cat = P.armas.get(norm(lista[j].nombre)) || {};
        elegido = { estado: norm(w.equipadoEn) === norm(m.personaje) ? "equipada" : "la_tienes", nombre: lista[j].nombre, nombreEs: armaEs(P, lista[j].nombre), puesto: j + 1, total: lista.length,
          fuentes: lista[j].fuentes, nota: lista[j].nota, secundaria: cat.secundaria || null, rareza: cat.rareza || null, inactiva: lista[j].inactiva || null,
          // Armas tuyas que la guía pone más arriba pero cuya pasiva no se activa en este equipo
          descartadas: lista.filter((x) => x.inactiva && x !== lista[j] && (copias.get(norm(x.nombre)) || []).length).map((x) => ({ nombreEs: armaEs(P, x.nombre), motivo: x.inactiva })),
          tuya: { nivel: w.nivel, refinamiento: w.refinamiento, equipadaEn: w.equipadoEn || null } };
      }
      if (!elegido) {
        const r = revisarArma(P, m.personaje, [], (misArmas || []).filter((w, k) => !usadas.has(k)));
        elegido = { estado: "ninguna", total: lista.length, mejores: lista.slice(0, 3).map((a) => armaEs(P, a.nombre)), alternativas: r.alternativas || [], tipo: r.tipo };
      }
      res[i] = { personaje: m.personaje, ...elegido, no_acumulables: noAcu[i] || [] };
    }
    return res;
  }
  function textoAsignada(a) {
    const fu = (x) => x.fuentes.map((f) => (f === "kqm" ? "KQM" : f === "gamewith" ? "GameWith" : f)).join(" + ");
    if (a.estado === "ninguna") {
      if (!a.total) return "Sin lista de armas para este personaje.";
      return "No tienes ninguna de sus armas recomendadas (las mejores: " + a.mejores.join(", ") + ")." + (a.alternativas.length ? " De tus armas de " + a.tipo.toLowerCase() + ": " + a.alternativas.map((x) => x.nombreEs + " R" + x.refinamiento).join(", ") + " (no están en las guías)." : "");
    }
    const base = a.nombreEs + " R" + a.tuya.refinamiento + ", nivel " + a.tuya.nivel + " — puesto " + a.puesto + " de " + a.total + " (" + fu(a) + ")" + (a.inactiva ? ". ⚠ En este equipo " + a.inactiva + ": solo te da sus estadísticas base" : "");
    if (a.estado === "equipada") return "Ya la lleva: " + base;
    return base + (a.tuya.equipadaEn ? ". Ahora la lleva " + Good.bonito(a.tuya.equipadaEn) : ". Está sin equipar");
  }
  // Conjuntos para un miembro dentro de su equipo: aplica las condiciones de la guía y, en los apoyos,
  // pone primero un conjunto de la guía cuyo efecto ayude al equipo. ctx: {esDps, nombres, arma (nombre EN), constelacion}
  const ayudaAlEquipo = (P, nombreSet) => { const e = (P.efSet.get(norm(nombreSet)) || {}).etiquetas || []; return e.includes("para_el_equipo") || e.includes("reduce_resistencia"); };
  function conjuntosPara(P, artefactos, ctx) {
    if (!artefactos) return [];
    const eqx = contextoEquipo(P, ctx.nombres || []);
    const sec = ctx.arma ? ((P.armas.get(norm(ctx.arma)) || {}).secundaria || "") : "";
    const opciones = [{ ...artefactos.recomendado, origen: "recomendado" }, ...(artefactos.alternativa || []).map((a) => ({ ...a, origen: "alternativa" }))];
    for (const o of opciones) {
      o.efectos = o.conjuntos.map((c) => { const e = P.efSet.get(norm(c)) || {}; return { conjunto: c, nombreEs: conjuntoEs(P, c), dos: e.dos || null, cuatro: e.cuatro || null, etiquetas: e.etiquetas || [] }; });
      o.puntos = o.origen === "recomendado" ? 1 : 0; o.motivos = [];
      const c = o.condicion;
      if (c) {
        const cumple = (!c.equipo_incluye || c.equipo_incluye.every((n) => (ctx.nombres || []).some((x) => norm(x) === norm(n))))
          && (!c.arma_sin_crit || !/CRIT/.test(sec)) && (c.constelacion_menor_que == null || (ctx.constelacion || 0) < c.constelacion_menor_que);
        if (cumple) { o.puntos += 3; o.motivos.push("Se cumple la condición de la guía: " + (o.cuando || "")); }
      }
      if (o.constelacion_minima && (ctx.constelacion || 0) < o.constelacion_minima) { o.puntos -= 2; o.motivos.push("Necesita C" + o.constelacion_minima + " y tienes C" + (ctx.constelacion || 0)); }
      if (o.tipo === "4pc") {
        const et = o.efectos[0].etiquetas;
        if (et.includes("necesita_cambio_vida") && !eqx.cambiaVida.length) { o.puntos -= 2; o.motivos.push("Su efecto de 4 piezas necesita que la vida suba o baje y nadie del equipo la cambia"); }
        if (et.includes("necesita_cambio_vida") && eqx.cambiaVida.length) o.motivos.push("Su efecto de 4 piezas se activa porque " + eqx.cambiaVida.join(", ") + " cambia la vida del equipo");
        if (!ctx.esDps && ayudaAlEquipo(P, o.conjuntos[0])) { o.puntos += 2; o.motivos.push("Su efecto de 4 piezas ayuda a todo el equipo (más daño para el DPS)"); }
        if (!ctx.esDps && !ayudaAlEquipo(P, o.conjuntos[0])) o.motivos.push("Su efecto solo sube el daño de quien lo lleva");
        if (ctx.esDps && et.includes("fuera_del_campo")) o.motivos.push("Parte de su efecto es para cuando no está en el campo");
      }
    }
    return opciones.sort((a, b) => b.puntos - a.puntos);
  }

  // ---------- Artefactos de todo el equipo: dos opciones ----------
  // Opción 1 "cada uno potencia su daño": lo que recomiendan las guías para cada personaje.
  // Opción 2 "todos potencian al DPS": los que no son el DPS llevan, si lo hay entre los conjuntos que las guías les dan,
  // uno cuyo efecto oficial ayuda al DPS (ATK, Maestría, bono de daño o reducción de resistencia compatibles con él).
  // En las dos se respeta que un conjunto "no acumulable" solo funcione en uno de los miembros.
  const ESCALA = { "ATK%": "atk", "HP%": "vida", "DEF%": "def", "Elemental Mastery": "em" };
  const infoPj = (P, n) => Object.values(P.roles).find((x) => norm(x.nombre) === norm(n)) || {};
  function candidatosSet(P, miembro, eqp) {
    const out = [], visto = new Set();
    const add = (o, origen, fuentes) => {
      const k = o.tipo + ":" + o.conjuntos.map(norm).sort().join("+");
      if (visto.has(k)) { const y = out.find((x) => x.k === k); if (origen === "guía del equipo") y.origen = origen; return; }
      visto.add(k);
      const efectos = o.conjuntos.map((c) => { const e = P.efSet.get(norm(c)) || {}; return { conjunto: c, nombreEs: conjuntoEs(P, c), dos: e.dos || null, cuatro: e.cuatro || null, etiquetas: e.etiquetas || [] }; });
      out.push({ k, tipo: o.tipo, conjuntos: o.conjuntos, efectos, origen, fuentes: fuentes || [], cuando: o.cuando || null, condicion: o.condicion || null, constelacion_minima: o.constelacion_minima || null, nota: o.nota || o.nota_kqm || null, orden: out.length });
    };
    const a = eqp && eqp.artefactos;
    if (a) { add(a.recomendado, "guía del equipo"); for (const alt of a.alternativa || []) add(alt, "guía del equipo"); }
    for (const x of P.setsPj.get(norm(miembro)) || []) add(x, "guías del personaje", x.fuentes);
    return out;
  }
  function artefactosEquipo(P, eq, armas, personajes, extra) {
    const op = { hexerei: true, ...(extra || {}) };
    const nombres = eq.miembros.map((m) => m.personaje), eqx = contextoEquipo(P, nombres);
    const dpsM = eq.miembros.find((m) => norm(m.personaje) === norm(eq.dps)) || eq.miembros[0];
    const eqDps = equipoDe(P, dpsM);
    const escala = ESCALA[((eqDps.artefactos && eqDps.artefactos.estadisticas_principales && eqDps.artefactos.estadisticas_principales.arenas) || [])[0]] || "atk";
    const elemDps = infoPj(P, eq.dps).elemento;
    const moonsign = (eq.bonos && eq.bonos.moonsign) || 0;
    const mios = new Map(Object.values(personajes || {}).map((p) => [norm(p.key || p.id), p]));
    const reacs = (eq.reacciones || []).concat(eq.reaccion ? [eq.reaccion] : []);
    const hayGeo = nombres.some((n) => infoPj(P, n).elemento === "Geo");
    const esDpsM = (m) => norm(m.personaje) === norm(eq.dps) || /^dps/.test(m.rol || "");
    function requisitos(et, m, inf) {
      const r = [];
      if (et.includes("necesita_moonsign") && !moonsign) r.push("necesita Moonsign y el equipo no tiene");
      if (et.includes("necesita_lunar") && !reacs.some((x) => /^Lunar/.test(x))) r.push("necesita reacciones lunares y el equipo no las hace");
      if (et.includes("necesita_estelar") && !reacs.some((x) => /^Stellar/.test(x))) r.push("necesita reacciones estelares y el equipo no las hace");
      if (et.includes("necesita_cristalizar") && !hayGeo && !reacs.includes("Lunar-Crystallize")) r.push("necesita Cristalización y no hay personaje Geo");
      if (et.includes("necesita_hexerei") && (!P.hexerei.has(norm(m.personaje)) || op.hexerei === false)) r.push("necesita que " + m.personaje + " sea del Aquelarre (Witch's Homework)");
      if (et.includes("necesita_curar") && !(inf.roles || []).some((x) => x.rol === "sustento")) r.push("se activa curando y este personaje no es sanador");
      if (et.includes("necesita_torbellino") && inf.elemento !== "Anemo") r.push("se activa con Torbellino y este personaje no es Anemo");
      if (et.includes("necesita_cambio_vida") && !eqx.cambiaVida.length) r.push("necesita que la vida suba o baje y nadie del equipo la cambia");
      return r;
    }
    function valorar(c, m, i, modo) {
      const esDps = esDpsM(m), inf = infoPj(P, m.personaje);
      const roles = new Set(inf.roles_principales || []), haceDano = roles.has("sub_dps") || roles.has("dps_principal");
      const et = c.tipo === "4pc" ? c.efectos[0].etiquetas : [];
      const arma = armas && armas[i] && armas[i].nombre, sec = arma ? ((P.armas.get(norm(arma)) || {}).secundaria || "") : "";
      const cons = (mios.get(norm(m.personaje)) || {}).constelacion || 0;
      let v = c.origen === "guía del equipo" ? 3 - c.orden * 0.5 : 2 - c.orden * 0.2;
      if ((c.fuentes || []).length >= 2) v += 0.3;
      const motivos = [];
      if (c.condicion) {
        const x = c.condicion;
        const ok = (!x.equipo_incluye || x.equipo_incluye.every((n) => nombres.some((y) => norm(y) === norm(n)))) && (!x.arma_sin_crit || !/CRIT/.test(sec)) && (x.constelacion_menor_que == null || cons < x.constelacion_menor_que);
        if (ok) { v += 4; motivos.push("Se cumple la condición de la guía: " + c.cuando); } else v -= 1;
      }
      if (c.constelacion_minima && cons < c.constelacion_minima) { v -= 3; motivos.push("La guía lo pide con C" + c.constelacion_minima + " y tienes C" + cons); }
      const faltan = c.tipo === "4pc" ? requisitos(et, m, inf) : [];
      if (faltan.length) { v -= 4; motivos.push("Su efecto de 4 piezas " + faltan.join("; ")); }
      if (et.includes("necesita_cambio_vida") && eqx.cambiaVida.length) motivos.push("Se activa porque " + eqx.cambiaVida.join(", ") + " cambia la vida del equipo");
      // ¿Su efecto ayuda al DPS?
      const res = et.find((x) => /^res_/.test(x));
      const elemOk = !et.includes("bono_elemento_portador") || inf.elemento === elemDps;
      const ayudaDps = !esDps && !faltan.length && elemOk && ((et.includes("sube_atk_equipo") && escala === "atk") || (et.includes("sube_em_equipo") && (escala === "em" || (eq.reacciones || []).length))
        || et.includes("sube_dano_equipo") || (et.includes("reduce_resistencia") && (!res || res === "res_" + String(elemDps).toLowerCase())));
      const ayudaPocoDps = !esDps && !ayudaDps && !faltan.length && (et.includes("sube_atk_equipo") || et.includes("para_el_equipo"));
      if (modo === "dps") {
        if (ayudaDps) { v += 5; motivos.push("Su efecto de 4 piezas ayuda al DPS (" + eq.dps + ")" + (et.includes("sube_em_equipo") && escala !== "em" && !et.includes("sube_dano_equipo") && !et.includes("sube_atk_equipo") ? ": sube Maestría Elemental, que sirve para el daño de reacciones" : "")); }
        else if (ayudaPocoDps) motivos.push("Ayuda al equipo, pero " + eq.dps + " escala con " + { atk: "ATK", vida: "Vida", def: "DEF", em: "Maestría Elemental" }[escala] + " y le sirve poco");
        else if (!esDps && c.tipo === "4pc") motivos.push("Solo sube el daño de quien lo lleva");
      } else {
        if (!esDps && c.tipo === "4pc" && !ayudaDps && !haceDano && (et.includes("para_el_equipo"))) v += 1;
        if (!esDps && haceDano && c.tipo === "4pc" && !et.includes("para_el_equipo")) motivos.push("Sube su propio daño (es " + (roles.has("sub_dps") ? "sub-DPS" : "DPS") + ")");
        if (ayudaDps) motivos.push("Además ayuda al DPS (" + eq.dps + ")");
      }
      return { v, motivos, ayudaDps };
    }
    function opcion(modo) {
      const usados = new Map(), res = new Array(eq.miembros.length);
      // El DPS elige primero; luego el resto en el orden del equipo
      const orden = eq.miembros.map((m, i) => i).sort((a, b) => esDpsM(eq.miembros[b]) - esDpsM(eq.miembros[a]) || a - b);
      for (const i of orden) {
        const m = eq.miembros[i], cands = candidatosSet(P, m.personaje, equipoDe(P, m));
        if (!cands.length) { res[i] = { personaje: m.personaje, sin_datos: true }; continue; }
        const vals = cands.map((c) => ({ c, ...valorar(c, m, i, modo) })).sort((a, b) => b.v - a.v);
        const avisos = [];
        let elegido = vals.find((x) => {
          const noAcu = x.c.tipo === "4pc" && x.c.efectos[0].etiquetas.includes("no_acumulable");
          const quien = noAcu && usados.get(norm(x.c.conjuntos[0]));
          if (quien) { avisos.push(x.c.efectos[0].nombreEs + " no se acumula y ya lo lleva " + quien + ": se usa otro conjunto"); return false; }
          return true;
        }) || vals[0];
        if (elegido.c.tipo === "4pc") usados.set(norm(elegido.c.conjuntos[0]), m.personaje);
        res[i] = { personaje: m.personaje, tipo: elegido.c.tipo, conjuntos: elegido.c.conjuntos, efectos: elegido.c.efectos, origen: elegido.c.origen, fuentes: elegido.c.fuentes,
          motivos: elegido.motivos, avisos, ayudaDps: elegido.ayudaDps };
      }
      return res;
    }
    const propio = opcion("propio"), dps = opcion("dps");
    const iguales = propio.every((x, i) => (x.conjuntos || []).join("+") === (dps[i].conjuntos || []).join("+"));
    return { escalaDps: escala, opciones: [{ id: "propio", titulo: "Opción 1: cada uno potencia su propio daño (lo que recomiendan las guías)", miembros: propio },
      ...(iguales ? [] : [{ id: "dps", titulo: "Opción 2: todos potencian al DPS (" + eq.dps + ")", miembros: dps }])], iguales };
  }

  // Objetivos de estadísticas del personaje y cómo influye el arma elegida.
  const SEC_A_OBJ = { "Prob. CRIT": "Prob. CRIT", "Daño CRIT": "Daño CRIT", "Recarga de Energía": "Recarga de Energía", "Maestría Elemental": "Maestría Elemental", "ATK%": "ATK", "Vida%": "Vida", "DEF%": "DEF" };
  function objetivosDe(P, personaje, secundaria) {
    const o = P.objetivos.get(norm(personaje)) || null;
    const notaArma = secundaria && SEC_A_OBJ[secundaria]
      ? "Tu arma da " + secundaria + " como estadística secundaria: cuenta para el objetivo de " + SEC_A_OBJ[secundaria] + ", así que necesitas menos en los artefactos."
      : null;
    return { gamesandchill: o && o.gamesandchill, kqm: o && o.kqm, notaArma };
  }

  // Varias recomendaciones del mismo equipo pueden pedir la misma arma: se avisa si no hay copias suficientes.
  function conflictosDeArmas(revisiones) {
    const uso = new Map();
    for (const r of revisiones) if (r.estado !== "no_la_tienes") { const k = norm(r.arma.nombre); uso.set(k, [...(uso.get(k) || []), r]); }
    return [...uso.values()].filter((rs) => rs.length > rs[0].copias).map((rs) => rs[0].arma.nombreEs + ": la recomiendan para " + rs.map((r) => r.personaje).join(" y ") + ", pero solo tienes " + rs[0].copias);
  }

  // ---------- Fase 6 ----------
  // personajes: estado.personajes de la app. equipos: lista de equipos recomendados (de Recomendador).
  function queConstruir(P, personajes, equipos, opciones) {
    const op = { max: 12, ...(opciones || {}) };
    const mios = new Map(Object.values(personajes || {}).map((p) => [norm(p.key || p.id), p]));
    const peso = new Map(), usos = new Map(), constReq = new Map();
    for (const [i, eq] of (equipos || []).entries()) {
      const w = Math.max(1, 10 - i); // los primeros equipos pesan más
      for (const m of eq.miembros) {
        const k = norm(m.personaje), esDps = norm(m.personaje) === norm(eq.dps);
        peso.set(k, (peso.get(k) || 0) + w * (esDps ? 2 : 1));
        usos.set(k, [...(usos.get(k) || []), { equipo: eq.nombre, dps: esDps }]);
        const c = m.artefactos && m.artefactos.recomendado && m.artefactos.recomendado.constelacion_minima;
        if (c) constReq.set(k, { c, nota: m.artefactos.recomendado.nota || "", equipo: eq.nombre });
      }
    }
    const lista = [];
    for (const [k, w] of peso) {
      const p = mios.get(k); if (!p) continue;
      const info = Object.values(P.roles).find((x) => norm(x.nombre) === k) || { nombre: k, nombre_es: k };
      const esDps = usos.get(k).some((u) => u.dps);
      const tareas = [], prio = P.talentos[info.nombre];
      const nivel = p.nivel || 1;
      if (nivel < META.nivelMinimo) tareas.push({ tipo: "nivel", texto: "Subir de nivel " + nivel + " a " + META.nivelMinimo + " como mínimo", urgencia: 3 });
      else if (nivel < META.nivelPrioritario && prio && prio.orden && prio.orden[0] && prio.orden[0].includes("nivel")) tareas.push({ tipo: "nivel", texto: "Subir a nivel 90: la guía lo pone primero (" + prio.texto + ")", urgencia: 2 });
      if (p.talentos && prio) {
        const meta = esDps ? META.talentoDps : META.talentoApoyo;
        for (const t of prio.importantes) {
          const v = p.talentos[t] || 1;
          if (v < meta) tareas.push({ tipo: "talento", texto: TALENTO_ES[t] + ": " + v + " → " + meta, urgencia: v < 6 ? 2 : 1 });
        }
      }
      if (!p.talentos) tareas.push({ tipo: "dato", texto: "Sin datos de talentos: importa tu archivo GOOD para ver qué talentos subir", urgencia: 0 });
      const cr = constReq.get(k);
      if (cr && (p.constelacion || 0) < cr.c) tareas.push({ tipo: "constelacion", texto: "La guía pide C" + cr.c + " para su conjunto en " + cr.equipo + " (tienes C" + (p.constelacion || 0) + "). " + cr.nota, urgencia: 1 });
      if (!tareas.some((t) => t.urgencia > 0)) continue;
      const puntos = w * (1 + tareas.reduce((s, t) => s + t.urgencia, 0) / 4);
      lista.push({ personaje: info.nombre, nombre_es: info.nombre_es, nivel, constelacion: p.constelacion || 0, talentos: p.talentos || null, prioridad_guia: prio ? { texto: prio.texto, version: prio.version_guia, url: prio.url } : null,
        equipos: [...new Set(usos.get(k).map((u) => u.equipo))], tareas: tareas.sort((a, b) => b.urgencia - a.urgencia), puntos: Math.round(puntos * 10) / 10 });
    }
    return lista.sort((a, b) => b.puntos - a.puntos).slice(0, op.max);
  }

  const api = { META, crear, equipoDe, contextoEquipo, candidatosSet, artefactosEquipo, pasivaNoActiva, conjuntosPara, listaArmas, asignarArmas, textoAsignada, objetivosDe, armaEs, conjuntoEs, revisarArma, textoArma, conflictosDeArmas, queConstruir };
  if (esNode) module.exports = api;
  else { root.GTB = root.GTB || {}; root.GTB.Progreso = api; }
})(typeof window !== "undefined" ? window : globalThis);
