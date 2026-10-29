(function (root) {
  "use strict";
  const Good = typeof module !== "undefined" && module.exports ? require("./good.js") : root.GTB.Good;
  // "Viajero Cryo" y "Traveler Cryo" son el mismo personaje
  const norm = (n) => Good.normKey(String(n).replace(/^Viajer[oa]\s*/i, "Traveler "));
  const conjunto = (l) => new Set((l || []).map(norm));

  // Personajes que habilitan una reacción (lunar o estelar), según data/mecanicas_verificadas.json
  function habilitadores(m, reaccion) {
    const r = (m.reacciones_lunares && m.reacciones_lunares[reaccion]) || (m.reacciones_estelares && m.reacciones_estelares[reaccion]);
    return r ? conjunto(r.habilitadores || r.habilitadores_confirmados) : null;
  }
  // Nivel de Moonsign del equipo (cada personaje Moonsign suma 1, máximo 2)
  function nivelMoonsign(m, nombres) {
    const ms = new Set([...conjunto(m.moonsign.personajes_5_estrellas), ...conjunto(m.moonsign.personajes_4_estrellas)]);
    return Math.min(2, nombres.map(norm).filter((n) => ms.has(n)).length);
  }
  function evaluarEquipo(m, reaccion, nombres) {
    const h = habilitadores(m, reaccion);
    const habil = h ? nombres.filter((n) => h.has(norm(n))) : [];
    return { reaccionActiva: habil.length > 0, habilitadores: habil, moonsign: nivelMoonsign(m, nombres) };
  }

  // Revisa que una plantilla de equipo esté completa y que sea coherente con las mecánicas verificadas:
  // el equipo base y cada sustituto (cambiado de a uno) deben seguir activando la reacción.
  function validarPlantilla(p, m) {
    const e = [], id = p.id || "(sin id)";
    for (const c of ["id", "nombre", "dps", "reaccion", "calidad", "huecos"]) if (p[c] == null) e.push(id + ": falta el campo " + c);
    if (!Array.isArray(p.huecos) || p.huecos.length !== 4) { e.push(id + ": debe tener 4 huecos"); return e; }
    if (p.huecos.some((h) => !h.opciones || !h.opciones[0] || !h.opciones[0].personaje)) { e.push(id + ": cada hueco necesita al menos una opción"); return e; }
    const base = p.huecos.map((h) => h.opciones[0].personaje);
    if (new Set(base.map(norm)).size !== 4) e.push(id + ": personajes repetidos en el equipo base");
    const estandar = (m.reacciones_sin_habilitador || []).includes(p.reaccion) || ((m.equipos_sin_reaccion && m.equipos_sin_reaccion.tipos) || []).includes(p.reaccion);
    if (!estandar && !habilitadores(m, p.reaccion)) { e.push(id + ": reacción desconocida " + p.reaccion); return e; }
    const min = p.moonsign_minimo || 0;
    const revisar = (nombres, etq) => {
      if (estandar) return;
      const r = evaluarEquipo(m, p.reaccion, nombres);
      if (!r.reaccionActiva) e.push(id + ": " + etq + " no tiene habilitador de " + p.reaccion);
      if (r.moonsign < min) e.push(id + ": " + etq + " tiene Moonsign " + r.moonsign + " (mínimo " + min + ")");
    };
    revisar(base, "el equipo base");
    p.huecos.forEach((h, i) => h.opciones.slice(1).forEach((o) => {
      const alt = base.slice(); alt[i] = o.personaje;
      // pierde_reaccion: la fuente avisa que este sustituto deja el equipo sin la reacción (la app debe advertirlo)
      if (new Set(alt.map(norm)).size !== 4) { e.push(id + ": sustituto repetido " + o.personaje); return; }
      if (o.pierde_reaccion) return;
      revisar(alt, "el equipo con " + o.personaje + " en lugar de " + base[i]);
    }));
    return e;
  }

  const api = { habilitadores, nivelMoonsign, evaluarEquipo, validarPlantilla };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.GTB = root.GTB || {}; root.GTB.Equipos = api; }
})(typeof window !== "undefined" ? window : globalThis);
