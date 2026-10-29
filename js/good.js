(function (root) {
  "use strict";
  const IGNORAR = new Set(["manekin", "manekina"]); // personajes de prueba del juego
  const ELEM = { Wind: "Anemo", Fire: "Pyro", Water: "Hydro", Electric: "Electro", Ice: "Cryo", Rock: "Geo", Grass: "Dendro" };
  const ARMA = { WEAPON_SWORD_ONE_HAND: "Espada", WEAPON_CLAYMORE: "Mandoble", WEAPON_POLE: "Lanza", WEAPON_CATALYST: "Catalizador", WEAPON_BOW: "Arco" };
  const VIAJEROS = ["Anemo", "Geo", "Electro", "Dendro", "Hydro", "Pyro", "Cryo"];

  const num = (v, d) => (v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Identificador canónico: minúsculas, sin espacios ni símbolos. "RaidenShogun" y "Raiden Shogun" -> "raidenshogun"
  function normKey(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  }
  function bonito(key) { return String(key).replace(/([a-z])([A-Z])/g, "$1 $2"); }

  // Lee un archivo GOOD (texto u objeto). Solo toma personajes y armas; ignora artefactos y materiales.
  function parseGood(entrada) {
    let d = entrada;
    if (typeof d === "string") {
      try { d = JSON.parse(d.replace(/^\uFEFF/, "")); } catch (e) { throw new Error("El archivo no es un JSON válido."); }
    }
    if (!d || d.format !== "GOOD") throw new Error("El archivo no tiene formato GOOD.");
    const avisos = [];
    const vistos = new Map();
    for (const c of d.characters || []) {
      if (!c || !c.key || IGNORAR.has(normKey(c.key))) continue;
      const id = normKey(c.key);
      if (vistos.has(id)) avisos.push("Personaje repetido en el archivo: " + c.key);
      vistos.set(id, {
        key: c.key, nivel: clamp(num(c.level, 1), 1, 100), constelacion: clamp(num(c.constellation, 0), 0, 6),
        ascension: num(c.ascension, 0),
        talentos: { ataque: num(c.talent && c.talent.auto, 1), habilidad: num(c.talent && c.talent.skill, 1), explosion: num(c.talent && c.talent.burst, 1) }
      });
    }
    const armas = [];
    (d.weapons || []).forEach((w, i) => {
      if (!w || !w.key) return;
      armas.push({
        id: "w" + (i + 1), key: w.key, nivel: clamp(num(w.level, 1), 1, 90), ascension: num(w.ascension, 0),
        refinamiento: clamp(num(w.refinement, 1), 1, 5), equipadoEn: w.location || ""
      });
    });
    return { personajes: [...vistos.values()], armas, avisos };
  }

  // Convierte la respuesta de la API de Yatta (data.items) en listas simples.
  function parseYatta(resp, tipo) {
    const items = resp && resp.data && resp.data.items;
    if (!items || typeof items !== "object") return [];
    return Object.entries(items).filter(([, v]) => v && v.name).map(([id, v]) => tipo === "avatar"
      ? { id: String(id), nombre: String(v.name), elemento: ELEM[v.element] || v.element || "", rareza: num(v.rank, 0), arma: ARMA[v.weaponType] || v.weaponType || "", lanzamiento: num(v.release, 0) }
      : { id: String(id), nombre: String(v.name), rareza: num(v.rank, 0), tipo: ARMA[v.type] || v.type || "" });
  }

  // Une los nombres en español (nombreEs) a la lista en inglés por id. Si falta la lista en español, se usa el inglés.
  function combinarNombres(listaEn, listaEs) {
    const es = new Map((listaEs || []).map((x) => [x.id, x.nombre]));
    return (listaEn || []).map((x) => (es.has(x.id) ? { ...x, nombreEs: es.get(x.id) } : x));
  }
  function etiqueta(x) { return (x && (x.nombreEs || x.nombre)) || ""; }

  // La API ya incluye personajes que aún no han salido. Sin fecha se asume que ya salió.
  function yaSalio(p, ahora) {
    const t = p && p.lanzamiento;
    if (!t) return true;
    return (t > 1e12 ? t : t * 1000) <= (ahora == null ? Date.now() : ahora);
  }

  // El Viajero se guarda por elemento en GOOD (TravelerCryo); aquí se crean las 7 variantes.
  function catalogoPersonajes(lista) {
    const out = (lista || []).filter((p) => normKey(p.nombre) !== "traveler");
    for (const e of VIAJEROS) out.push({ id: "traveler-" + e.toLowerCase(), nombre: "Traveler " + e, nombreEs: "Viajero " + e, elemento: e, rareza: 5, arma: "Espada" });
    return out;
  }
  function indice(lista) {
    const m = new Map();
    for (const x of lista || []) m.set(normKey(x.nombre), x);
    return m;
  }

  // Une lo importado con el estado guardado: lo importado pisa, lo agregado a mano se conserva.
  function fusionar(estado, imp) {
    const personajes = { ...estado.personajes };
    for (const c of imp.personajes) { const id = normKey(c.key); personajes[id] = { ...c, id, tengo: true }; }
    return { personajes, armas: imp.armas.length ? imp.armas : estado.armas };
  }

  const api = { normKey, bonito, parseGood, parseYatta, combinarNombres, etiqueta, catalogoPersonajes, yaSalio, indice, fusionar };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.GTB = root.GTB || {}; root.GTB.Good = api; }
})(typeof window !== "undefined" ? window : globalThis);
