(function () {
  "use strict";
  const G = window.GTB.Good;
  const API = "https://gi.yatta.moe/api/v2";
  const K_ESTADO = "gtb.v3.estado", K_CAT = "gtb.v3.catalogo";
  const $ = (s) => document.querySelector(s);
  let estado = leer(K_ESTADO, { personajes: {}, armas: [] });
  let catalogo = leer(K_CAT, { personajes: [], armas: [] });
  let tab = Object.keys(estado.personajes).length ? "recomendar" : "personajes";
  let modo = "mejores", elegido = "", pisoAbismo = 12;
  const R = window.GTB.Recomendador, D = window.GTB.Datos, Pr = window.GTB.Progreso;
  const P = Pr.crear(D);
  let excluidos = [];
  const filtro = { texto: "", elemento: "", solo: false };
  const FILTROS = document.getElementById("filtros");
  const MOVIMIENTO = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function leer(k, def) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch (e) { return def; } }
  function guardar() { try { localStorage.setItem(K_ESTADO, JSON.stringify(estado)); } catch (e) { /* sin almacenamiento */ } }
  function el(t, props, ...hijos) {
    const n = document.createElement(t);
    Object.assign(n, props || {});
    for (const h of hijos) if (h !== null && h !== undefined && h !== "") n.append(h);
    return n;
  }
  function numInput(v, min, max, fn) {
    const i = el("input", { type: "number", min, max, value: v });
    i.onchange = () => { const x = Math.min(max, Math.max(min, Number(i.value) || min)); i.value = x; fn(x); };
    return i;
  }

  // ---------- Imágenes oficiales (Yatta) y paletas ----------
  const IM = D.imagenes || { _meta: { base: "", colores_elemento: {} }, personajes: {}, armas: {}, conjuntos: {}, elementos: {} };
  const url = (n) => (n ? IM._meta.base + n + ".png" : "");
  const idxPj = new Map(Object.entries(IM.personajes).map(([k, v]) => [G.normKey(k), { nombre: k, ...v }]));
  const idxArma = new Map(Object.entries(IM.armas).map(([k, v]) => [G.normKey(k), v]));
  const idxSet = new Map(Object.entries(IM.conjuntos).map(([k, v]) => [G.normKey(k), v]));
  const rarezaArma = new Map((D.catalogo.armas || []).map((a) => [G.normKey(a.nombre), a.rareza]));
  function imgPj(n) {
    const k = G.normKey(n);
    if (idxPj.has(k)) return idxPj.get(k);
    if (k.startsWith("traveler") || k.startsWith("viajer")) return idxPj.get("traveleranemo");
    return null;
  }
  const colorEl = (e) => (IM._meta.colores_elemento || {})[e] || "#A685E2";
  function iconoEl(e, clase) { const n = IM.elementos[e]; return n ? el("img", { src: url(n), alt: e, title: e, className: clase || "elem", loading: "lazy" }) : ""; }
  function lum(hex) { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.04045) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  // Paleta del personaje ordenada de oscuro a claro; si no hay, se usa el color de su elemento
  function paletaDe(n) {
    const i = imgPj(n), r = infoRol(n);
    const p = i && i.paleta && i.paleta.length === 3 ? i.paleta : [colorEl(r && r.elemento), colorEl(r && r.elemento), "#E9E6FF"];
    return [...p].sort((a, b) => lum(a) - lum(b));
  }
  function ponerPaleta(nodo, pal, pre) { pal.forEach((c, k) => nodo.style.setProperty("--" + pre + (k + 1), c)); }

  // Retrato estilo juego: fondo según rareza, elemento, constelación y placa con el nombre
  function retrato(nombreEn, op) {
    op = op || {};
    const i = imgPj(nombreEn), r = infoRol(nombreEn) || {};
    const rareza = op.rareza || (i && i.rareza) || r.rareza || 4;
    const caja = el(op.boton ? "button" : "div", { className: "retrato r" + rareza + (op.tengo === false ? " no-tengo" : ""), type: op.boton ? "button" : undefined });
    const foto = el("div", { className: "foto" });
    if (i) foto.append(el("img", { className: "cara", src: url(i.icono), alt: "", loading: "lazy", decoding: "async" }));
    else foto.append(el("div", { className: "sin-foto", textContent: (op.nombre || nombreEn).slice(0, 1) }));
    const e = op.elemento || r.elemento; if (e) foto.append(iconoEl(e));
    if (op.cons !== undefined && op.tengo !== false) foto.append(el("span", { className: "cons", textContent: "C" + op.cons }));
    const placa = el("div", { className: "placa" }, el("b", { textContent: op.nombre || es(nombreEn) }));
    if (op.pie) placa.append(el("small", { textContent: op.pie }));
    caja.append(foto, placa);
    if (op.boton) caja.setAttribute("aria-label", (op.nombre || es(nombreEn)) + (op.tengo === false ? ", no lo tienes" : ", nivel " + (op.nivel || 1)));
    return caja;
  }
  const miPj = (n) => estado.personajes[G.normKey(n)] || Object.values(estado.personajes).find((s) => G.normKey(s.key) === G.normKey(n));

  async function cargarCatalogo() {
    const aviso = $("#aviso-cat");
    try {
      const pedir = (leng, ruta) => fetch(API + "/" + leng + "/" + ruta).then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP"))));
      const opc = (leng, ruta) => pedir(leng, ruta).catch(() => null); // si falla el español se usa el inglés
      const [a, w, aEs, wEs] = await Promise.all([pedir("en", "avatar"), pedir("en", "weapon"), opc("es", "avatar"), opc("es", "weapon")]);
      catalogo = {
        personajes: G.combinarNombres(G.parseYatta(a, "avatar"), G.parseYatta(aEs, "avatar")),
        armas: G.combinarNombres(G.parseYatta(w, "weapon"), G.parseYatta(wEs, "weapon"))
      };
      try { localStorage.setItem(K_CAT, JSON.stringify(catalogo)); } catch (e) { /* ok */ }
      aviso.textContent = "Catálogo del juego actualizado (" + catalogo.personajes.length + " personajes).";
    } catch (e) {
      aviso.textContent = catalogo.personajes.length ? "Sin conexión con la API: usando el último catálogo guardado." : "Sin conexión con la API del juego: se muestran los personajes de la tabla de roles del proyecto.";
    }
    render();
  }

  // ---------- Personajes ----------
  function filasPersonajes() {
    const filas = new Map();
    const cat = G.catalogoPersonajes(catalogo.personajes);
    for (const p of cat) if (G.yaSalio(p) || estado.personajes[G.normKey(p.nombre)]) filas.set(G.normKey(p.nombre), { id: G.normKey(p.nombre), nombre: G.etiqueta(p), nombreEn: p.nombre, busca: G.normKey(p.nombre) + G.normKey(p.nombreEs), elemento: p.elemento, rareza: p.rareza });
    // Sin catálogo de la API (sin conexión) se usa la tabla de roles del proyecto
    if (!filas.size) for (const r of Object.values(D.roles.personajes)) if (!/^Traveler /.test(r.nombre)) filas.set(G.normKey(r.nombre), { id: G.normKey(r.nombre), nombre: r.nombre_es, nombreEn: r.nombre, busca: G.normKey(r.nombre) + G.normKey(r.nombre_es), elemento: r.elemento, rareza: r.rareza });
    for (const s of Object.values(estado.personajes)) {
      const base = filas.get(s.id) || { id: s.id, nombre: G.bonito(s.key || s.id), nombreEn: s.key || s.id, elemento: (infoRol(s.key || s.id) || {}).elemento || "", rareza: 0 };
      filas.set(s.id, { ...base, ...s, nombre: base.nombre, nombreEn: base.nombreEn });
    }
    return [...filas.values()].sort((a, b) => (b.tengo ? 1 : 0) - (a.tengo ? 1 : 0) || (b.rareza || 0) - (a.rareza || 0) || a.nombre.localeCompare(b.nombre));
  }

  function montarFiltros() {
    const caja = FILTROS;
    const q = el("input", { type: "search", placeholder: "Buscar personaje", value: filtro.texto, ariaLabel: "Buscar personaje" });
    q.oninput = () => { filtro.texto = q.value; render(); };
    const els = el("div", { className: "filtro-el", role: "group", ariaLabel: "Filtrar por elemento" });
    for (const e of ["Pyro", "Hydro", "Anemo", "Electro", "Dendro", "Cryo", "Geo"]) {
      const b = el("button", { type: "button", title: e, ariaLabel: e }, iconoEl(e, "x"));
      b.dataset.e = e;
      b.onclick = () => { filtro.elemento = filtro.elemento === e ? "" : e; render(); };
      els.append(b);
    }
    const solo = el("input", { type: "checkbox", checked: filtro.solo });
    solo.onchange = () => { filtro.solo = solo.checked; render(); };
    caja.append(el("label", { className: "buscador" }, el("span", { textContent: "🔍", ariaHidden: "true" }), q), els, el("label", { className: "interruptor" }, solo, "Solo los que tengo"), el("span", { className: "contador", id: "contador" }));
  }

  function renderPersonajes(cont) {
    const q = G.normKey(filtro.texto);
    FILTROS.querySelectorAll(".filtro-el button").forEach((b) => b.classList.toggle("act", b.dataset.e === filtro.elemento));
    const filas = filasPersonajes().filter((f) => (!filtro.solo || f.tengo) && (!filtro.elemento || f.elemento === filtro.elemento) && (!q || (f.busca || G.normKey(f.nombre)).includes(q)));
    FILTROS.querySelector("#contador").textContent = Object.keys(estado.personajes).length + " tuyos";
    // Los filtros no se vuelven a crear (así la búsqueda no pierde el foco): el título va antes y la rejilla después
    if (FILTROS.parentNode !== cont) cont.prepend(FILTROS);
    cont.prepend(el("div", { className: "cabecera-seccion" }, el("h2", { textContent: "Mis personajes" }), el("p", { className: "mut", textContent: "Toca un personaje para marcarlo y cambiar su nivel, constelación y talentos." })));
    const rej = el("div", { className: "rejilla" });
    for (const f of filas) {
      const b = retrato(f.nombreEn, { boton: true, nombre: f.nombre, rareza: f.rareza, elemento: f.elemento, tengo: !!f.tengo, cons: f.constelacion || 0, nivel: f.nivel, pie: f.tengo ? "Nv. " + (f.nivel || 1) : "No lo tengo" });
      b.onclick = () => abrirFicha(f);
      rej.append(b);
    }
    if (!filas.length) cont.append(el("p", { className: "mut", textContent: "Ningún personaje coincide con la búsqueda." }));
    cont.append(rej);
  }

  // Ficha: se abre al tocar un retrato. Guarda al momento y actualiza la página al cerrarse.
  function abrirFicha(f) {
    const dlg = $("#ficha"); dlg.textContent = "";
    const i = imgPj(f.nombreEn);
    ponerPaleta(dlg, paletaDe(f.nombreEn), "f");
    const cab = el("div", { className: "ficha-cab" });
    if (i && i.splash) cab.append(el("div", { className: "arte", style: "background-image:url('" + url(i.splash) + "')" }));
    const cerrar = el("button", { className: "cerrar", type: "button", textContent: "✕", ariaLabel: "Cerrar" }); cerrar.onclick = () => dlg.close();
    cab.append(iconoEl(f.elemento), el("h2", { textContent: f.nombre }), cerrar);
    const cuerpo = el("div", { className: "ficha-cuerpo" });
    const dibujar = () => {
      cuerpo.textContent = "";
      const s = estado.personajes[f.id];
      const tengo = el("input", { type: "checkbox", checked: !!(s && s.tengo !== false) });
      tengo.onchange = () => {
        if (tengo.checked) estado.personajes[f.id] = s || { id: f.id, key: f.nombreEn || f.nombre, tengo: true, nivel: 1, constelacion: 0, ascension: 0 };
        else delete estado.personajes[f.id];
        guardar(); dibujar();
      };
      cuerpo.append(el("label", { className: "interruptor" }, tengo, "Lo tengo"));
      if (s) {
        const set = (campo, v) => { s[campo] = v; guardar(); };
        const rango = el("input", { type: "range", min: 1, max: 100, value: s.nivel || 1, ariaLabel: "Nivel" });
        const salida = el("output", { textContent: s.nivel || 1 });
        rango.oninput = () => { salida.textContent = rango.value; set("nivel", Number(rango.value)); };
        cuerpo.append(el("div", { className: "campo" }, el("span", { textContent: "Nivel" }), el("div", { className: "rango" }, rango, salida)));
        const seg = el("div", { className: "segmentos", role: "group", ariaLabel: "Constelación" });
        for (let c = 0; c <= 6; c++) {
          const b = el("button", { type: "button", textContent: "C" + c, className: c === (s.constelacion || 0) ? "act" : "" });
          b.setAttribute("aria-pressed", c === (s.constelacion || 0));
          b.onclick = () => { set("constelacion", c); dibujar(); };
          seg.append(b);
        }
        cuerpo.append(el("div", { className: "campo" }, el("span", { textContent: "Constelación" }), seg));
        const tal = el("div", { className: "talentos" });
        for (const [tk, nom] of [["ataque", "Ataque Normal"], ["habilidad", "Elemental"], ["explosion", "Definitiva"]]) {
          const val = (s.talentos && s.talentos[tk]) || 1;
          tal.append(el("label", {}, nom, numInput(val, 1, 10, (v) => { s.talentos = { ataque: 1, habilidad: 1, explosion: 1, ...(s.talentos || {}), [tk]: v }; guardar(); })));
        }
        cuerpo.append(el("div", { className: "campo" }, el("span", { textContent: "Talentos (sin el +3 de las constelaciones)" }), tal));
      }
      const pal = paletaDe(f.nombreEn);
      cuerpo.append(el("div", { className: "ficha-paleta" }, ...pal.map((c) => el("i", { style: "background:" + c, title: c })), "Colores de su retrato oficial"));
    };
    dibujar();
    dlg.append(cab, cuerpo);
    dlg.showModal();
  }

  // ---------- Armas ----------
  function renderArmas(cont) {
    const idx = G.indice(catalogo.armas);
    cont.append(el("div", { className: "cabecera-seccion" }, el("h2", { textContent: "Mis armas" }), el("p", { className: "mut", textContent: estado.armas.length + " armas. La app solo te recomienda armas de esta lista." })));
    const dl = el("datalist", { id: "armas-cat" }, ...(catalogo.armas.length ? catalogo.armas.map((a) => el("option", { value: G.etiqueta(a) })) : D.catalogo.armas.map((a) => el("option", { value: a.nombreEs || a.nombre }))));
    const nuevo = el("input", { type: "text", placeholder: "Agregar arma (nombre en español)", ariaLabel: "Nombre del arma" }); nuevo.setAttribute("list", "armas-cat");
    const btn = el("button", { className: "boton", type: "button", textContent: "Agregar arma" });
    btn.onclick = () => {
      const n = nuevo.value.trim(); if (!n) return;
      const todas = catalogo.armas.length ? catalogo.armas : D.catalogo.armas;
      const hallada = todas.find((a) => G.normKey(a.nombreEs) === G.normKey(n) || G.normKey(a.nombre) === G.normKey(n));
      estado.armas.push({ id: "m" + Date.now(), key: hallada ? hallada.nombre : n, nivel: 1, ascension: 0, refinamiento: 1, equipadoEn: "" }); guardar(); render();
    };
    cont.append(el("div", { className: "agregar" }, nuevo, btn, dl));
    if (!estado.armas.length) { cont.append(el("p", { className: "mut", textContent: "Todavía no hay armas. Importa tu archivo GOOD o agrégalas aquí." })); return; }
    const rej = el("div", { className: "rejilla-armas" });
    const orden = estado.armas.map((a, i) => ({ a, i, r: (idx.get(G.normKey(a.key)) || {}).rareza || rarezaArma.get(G.normKey(G.bonito(a.key))) || rarezaArma.get(G.normKey(a.key)) || 0 }))
      .sort((x, y) => y.r - x.r || String(x.a.key).localeCompare(String(y.a.key)));
    for (const { a, i, r } of orden) {
      const info = idx.get(G.normKey(a.key));
      const nombre = info ? G.etiqueta(info) : Pr.armaEs(P, G.bonito(a.key)) || G.bonito(a.key);
      const ref = el("select", { ariaLabel: "Refinamiento" }, ...[1, 2, 3, 4, 5].map((x) => el("option", { value: x, textContent: "R" + x, selected: x === a.refinamiento })));
      ref.onchange = () => { a.refinamiento = Number(ref.value); guardar(); };
      const eq = el("input", { type: "text", className: "quien", value: a.equipadoEn ? G.bonito(a.equipadoEn) : "", placeholder: "Sin equipar", ariaLabel: "Equipada en" }); eq.onchange = () => { a.equipadoEn = eq.value; guardar(); };
      const del = el("button", { className: "quitar", type: "button", textContent: "✕", ariaLabel: "Quitar " + nombre }); del.onclick = () => { estado.armas.splice(i, 1); guardar(); render(); };
      const ic = idxArma.get(G.normKey(a.key)) || idxArma.get(G.normKey(G.bonito(a.key)));
      const nv = numInput(a.nivel, 1, 90, (v) => { a.nivel = v; guardar(); }); nv.setAttribute("aria-label", "Nivel");
      rej.append(el("div", { className: "arma" }, el("div", { className: "ico r" + (r || 4) }, ic ? el("img", { src: url(ic), alt: "", loading: "lazy" }) : ""),
        el("div", {}, el("b", { textContent: nombre }), el("small", { textContent: (info ? info.tipo + " · " : "") + (r ? "★".repeat(r) : "") }),
          el("div", { className: "ajustes" }, "Nv.", nv, ref, eq)), del));
    }
    cont.append(rej);
  }

  // ---------- Fase 4: recomendar ----------
  const infoRol = (n) => D.roles.personajes[n] || Object.values(D.roles.personajes).find((p) => G.normKey(p.nombre) === G.normKey(n));
  const es = (n) => { const i = infoRol(n); return i ? i.nombre_es : G.bonito(n); };
  const textoRol = (r) => R.ROLES_ES[r] || String(r).replace(/_/g, " ");
  // Nombres de estadísticas en español (los datos de las guías están en inglés)
  const STAT_ES = [[/Energy Recharge|ER%?(?![a-z])/g, "Recarga de Energía"], [/CRIT Rate/g, "Prob. CRIT"], [/CRIT DMG|CRIT Damage/g, "Daño CRIT"], [/Elemental Mastery|\bEM\b/g, "Maestría Elemental"],
    [/Healing Bonus/g, "Bono de curación"], [/(Pyro|Hydro|Anemo|Electro|Dendro|Cryo|Geo|Physical) DMG Bonus/g, (m, e) => "Bono de daño " + (e === "Physical" ? "físico" : e)], [/HP%/g, "Vida%"], [/Flat HP|HP plano/g, "Vida plana"],
    [/Flat ATK|ATK plano/g, "ATK plano"], [/Flat DEF|DEF plano/g, "DEF plana"], [/\(con /g, "(con "]];
  const statEs = (t) => STAT_ES.reduce((x, [a, b]) => x.replace(a, b), String(t));
  // Fila "Etiqueta: valor" en su propia línea
  const linea = (et, val) => el("div", { className: "linea" }, el("span", { className: "et", textContent: et + ": " }), val);
  function tablaKqm(filas) {
    return el("div", { className: "desliza" }, el("table", { className: "mini" }, ...filas.map((f, i) => el("tr", {}, ...f.map((c) => el(i === 0 ? "th" : "td", { textContent: c }))))));
  }
  function bloqueObjetivos(personaje, secundaria) {
    const o = Pr.objetivosDe(P, personaje, secundaria);
    const d = el("details", {}, el("summary", { textContent: "Estadísticas que debe tener" }));
    if (!o.gamesandchill && !o.kqm) { d.append(el("div", { className: "mut", textContent: "Todavía no hay objetivos de estadísticas para este personaje." })); return d; }
    if (o.gamesandchill) {
      d.append(el("div", { className: "mut", textContent: "Totales en la pantalla del personaje, según Games and Chill (" + o.gamesandchill.fecha + "):" }));
      for (const x of o.gamesandchill.objetivos) d.append(linea(x.estadistica, x.valor + (x.condicion ? " (" + x.condicion + ")" : "")));
      for (const n of o.gamesandchill.notas_arma) d.append(el("div", { className: "mut", textContent: "Arma: " + n }));
    }
    if (o.notaArma) d.append(el("div", { className: "encaja", textContent: o.notaArma }));
    if (o.kqm) {
      if (o.kqm.prioridad_subestadisticas) d.append(linea("Prioridad de subestadísticas (KQM)", statEs(o.kqm.prioridad_subestadisticas)));
      for (const tb of o.kqm.recarga_tablas || []) { d.append(el("div", { className: "mut", textContent: "Recarga de Energía según el equipo (tabla de KQM, en inglés, guía " + o.kqm.version_guia + "):" })); d.append(tablaKqm(tb)); }
    }
    if (!o.gamesandchill) d.append(el("div", { className: "mut", textContent: "Sin objetivos de ATK, Vida, Maestría ni CRIT en las fuentes para este personaje: sigue la prioridad de subestadísticas." }));
    return d;
  }
  // Fila con icono (arma o conjunto) y texto
  function pieza(clase, icono, etiqueta, texto) { return el("div", { className: "pieza " + clase }, icono, el("div", {}, el("span", { className: "et", textContent: etiqueta }), texto)); }
  function icoArma(nombre) {
    const ic = nombre && idxArma.get(G.normKey(nombre)), r = (nombre && rarezaArma.get(G.normKey(nombre))) || 4;
    return el("div", { className: "ico r" + r }, ic ? el("img", { src: url(ic), alt: "", loading: "lazy" }) : nombre ? "" : "?");
  }
  function icoSet(conjuntos) {
    const imgs = (conjuntos || []).map((c) => idxSet.get(G.normKey(c))).filter(Boolean);
    return el("div", { className: "ico r5" + (imgs.length > 1 ? " doble" : "") }, ...imgs.slice(0, 2).map((s) => el("img", { src: url(s), alt: "", loading: "lazy" })));
  }
  function tarjeta(eq, ajuste, usadas) {
    const t = el("article", { className: "tarjeta" });
    const pal = paletaDe(eq.dps), arte = imgPj(eq.dps);
    ponerPaleta(t, pal, "t");
    const franja = el("div", { className: "franja" });
    if (arte && arte.splash) franja.style.setProperty("--arte", "url('" + url(arte.splash) + "')");
    const tipo = eq.tipo === "guia" ? el("span", { className: "etq guia" }, "Guía ", el("span", { className: "est", textContent: "★".repeat(eq.calidad || 0) })) : el("span", { className: "etq impro", textContent: "Improvisado" });
    franja.append(el("div", { className: "cab" }, el("h4", { textContent: eq.nombre.replace(eq.dps, es(eq.dps)) }), el("span", { className: "pts", textContent: ajuste ? eq.puntaje + " + " + ajuste.puntos + " por el piso" : eq.puntaje + " pts" })));
    franja.append(el("div", { className: "etiquetas" }, tipo, ...(eq.reacciones || []).slice(0, 4).map((r) => el("span", { className: "etq", textContent: r })), ...eq.bonos.etiquetas.map((b) => el("span", { className: "etq bono", textContent: b }))));
    t.append(franja);
    const cuerpo = el("div", { className: "cuerpo" });
    const equipos = eq.miembros.map((m) => Pr.equipoDe(P, m));
    const asign = Pr.asignarArmas(P, eq.miembros.map((m, i) => ({ personaje: m.personaje, armasGuia: equipos[i].armas })), estado.armas, eq.dps, usadas);
    const artef = Pr.artefactosEquipo(P, eq, asign, estado.personajes, { hexerei: !estado.opciones || estado.opciones.hexerei !== false });
    const ms = el("div", { className: "miembros" });
    eq.miembros.forEach((m, i) => {
      const inf = infoRol(m.personaje) || {}, eqp = equipos[i], a = asign[i], mio = miPj(m.personaje);
      const box = el("div", { className: "miembro" });
      box.style.setProperty("--elc", colorEl(inf.elemento));
      box.append(retrato(m.personaje, { tengo: !!mio, cons: mio ? mio.constelacion || 0 : undefined, pie: mio ? "Nv. " + (mio.nivel || 1) : "" }));
      box.append(el("div", { className: "rol", textContent: textoRol(m.rol) }));
      if (m.sustituto) box.append(el("div", { className: "sub", textContent: "Sustituye a " + es(m.reemplaza) + (m.nota ? ": " + m.nota : "") }));
      box.append(pieza(a.estado === "equipada" && !a.inactiva ? "ok" : a.estado === "ninguna" ? "no" : "mover", icoArma(a.estado === "ninguna" ? null : a.nombre), "Tu arma", Pr.textoAsignada(a)));
      for (const x of a.descartadas || []) box.append(el("div", { className: "aviso", textContent: "No se eligió " + x.nombreEs + ": " + x.motivo + "." }));
      for (const x of a.no_acumulables || []) box.append(el("div", { className: "aviso", textContent: x + ": se eligió otra." }));
      if (eqp.artefactos || artef.opciones[0].miembros[i].conjuntos) {
        const mismo = artef.opciones.length > 1 && (artef.opciones[0].miembros[i].conjuntos || []).join("+") === (artef.opciones[1].miembros[i].conjuntos || []).join("+");
        artef.opciones.forEach((o, k) => {
          const x = o.miembros[i]; if (!x || !x.conjuntos || (mismo && k > 0)) return;
          const et = artef.opciones.length > 1 && !mismo ? "Conjunto, opción " + (k + 1) : artef.opciones.length > 1 ? "Conjunto (las dos opciones)" : "Conjunto";
          box.append(pieza(k === 0 ? "ok" : "op2", icoSet(x.conjuntos), et, x.tipo + " " + x.efectos.map((e) => e.nombreEs).join(" + ")));
          for (const mo of (x.motivos || []).concat(x.avisos || [])) box.append(el("div", { className: "mut", textContent: "· " + mo }));
        });
        const d = el("details", {}, el("summary", { textContent: "Guía: efectos y estadísticas" + (eqp.de ? " (de " + eqp.de + ")" : "") }));
        if (eqp.armas) d.append(linea("Arma de la guía", eqp.armas.map((x) => Pr.armaEs(P, x.nombre) + (x.nota ? " (" + x.nota + ")" : "")).join(" · ")));
        // Efecto oficial de cada conjunto elegido (sin repetir)
        const vistos = new Set();
        artef.opciones.forEach((o) => { const x = o.miembros[i]; if (!x || !x.efectos) return;
          for (const e of x.efectos) { const k = x.tipo + e.conjunto; if (vistos.has(k)) continue; vistos.add(k);
            d.append(el("div", { className: "efecto", textContent: e.nombreEs + (x.tipo === "4pc" ? " (4 piezas): " + (e.cuatro || "") : " (2 piezas): " + (e.dos || "")) })); } });
        if (eqp.artefactos) {
          const ep = eqp.artefactos.estadisticas_principales || {};
          d.append(linea("Arenas", statEs((ep.arenas || []).join(" / "))), linea("Cáliz", statEs((ep.caliz || []).join(" / "))), linea("Tiara", statEs((ep.tiara || []).join(" / "))), linea("Subestadísticas", statEs((eqp.artefactos.subestadisticas || []).join(", "))));
        }
        box.append(d);
      } else if (eqp.armas) {
        const d = el("details", {}, el("summary", { textContent: "Lo que recomienda la guía" }));
        d.append(linea("Arma de la guía", eqp.armas.map((x) => Pr.armaEs(P, x.nombre)).join(" · ")));
        box.append(d);
      }
      box.append(bloqueObjetivos(m.personaje, a.secundaria));
      ms.append(box);
    });
    cuerpo.append(ms);
    cuerpo.append(el("div", { className: "leyenda" }, el("span", { className: "l-ok", textContent: "Listo o primera opción" }), el("span", { className: "l-mover", textContent: "La tienes, hay que moverla" }), el("span", { className: "l-no", textContent: "No tienes ninguna de la guía" }), artef.opciones.length > 1 ? el("span", { className: "l-op2", textContent: "Opción 2 (ayuda al DPS)" }) : ""));
    const dA = el("details", { className: "opciones-art" }, el("summary", { textContent: artef.opciones.length > 1 ? "Artefactos del equipo: 2 opciones" : "Artefactos del equipo" }));
    for (const o of artef.opciones) dA.append(el("div", { className: "opcion-art" }, el("b", { textContent: o.titulo }), el("ul", {}, ...o.miembros.map((x) => el("li", { textContent: es(x.personaje) + ": " + (x.conjuntos ? x.tipo + " " + x.efectos.map((e) => e.nombreEs).join(" + ") : "sin datos") })))));
    dA.append(el("div", { className: "mut", textContent: artef.opciones.length > 1
      ? "La app no calcula daño: la opción 1 sigue a las guías (cada uno sube su daño, también los sub-DPS); la opción 2 pone en los demás un conjunto de sus guías cuyo efecto oficial ayuda al DPS. Prueba las dos y quédate con la que haga más daño. En ambas, un conjunto que no se acumula se usa en un solo personaje."
      : "Con los conjuntos que las guías dan a estos personajes no hay una combinación distinta que ayude más al DPS." }));
    cuerpo.append(dA);
    if (ajuste) {
      for (const r of ajuste.razones) cuerpo.append(el("div", { className: "encaja", textContent: "✔ " + r }));
      for (const f of ajuste.faltas) cuerpo.append(el("div", { className: "aviso", textContent: "✘ " + f }));
      for (const n of ajuste.notas) cuerpo.append(el("div", { className: "nota", textContent: "ℹ " + n }));
    }
    for (const a of eq.avisos) cuerpo.append(el("div", { className: "aviso", textContent: "⚠ " + a }));
    if (eq.rotacion && eq.rotacion.length) {
      cuerpo.append(el("details", {}, el("summary", { textContent: "Rotación" }), el("ol", {}, ...eq.rotacion.map((x) => el("li", { textContent: x }))), ...(eq.rotacion_avisos || []).map((x) => el("div", { className: "aviso", textContent: "⚠ " + x }))));
    }
    t.append(cuerpo);
    return t;
  }
  function renderConstruir(cont, ctx) {
    const equipos = [...R.mejores(ctx, 8)];
    const ab = R.abismo(ctx, { piso: 12 })[0]; if (ab) equipos.unshift(...ab.equipos);
    const lista = Pr.queConstruir(P, estado.personajes, equipos, { max: 15 });
    cont.append(el("p", { className: "mut", textContent: "Personajes de tus mejores equipos y de tu Abismo (piso 12) que más ganan si los mejoras, en orden. La prioridad de talentos sale de las guías de KQM (una sola fuente; algunas guías son de versiones anteriores). Las metas de nivel " + Pr.META.nivelMinimo + " y talentos " + Pr.META.talentoDps + " (DPS) / " + Pr.META.talentoApoyo + " (apoyo) son un criterio del proyecto. Los talentos son los del archivo GOOD, sin el +3 que dan las constelaciones 3 y 5." }));
    if (!lista.length) { cont.append(el("p", { textContent: "Tus personajes de esos equipos ya llegan a las metas." })); return; }
    const rej = el("div", { className: "construir" });
    lista.forEach((x, n) => {
      const t = el("div", { className: "tarea" }, retrato(x.personaje, { cons: x.constelacion, pie: "Nv. " + x.nivel }));
      const txt = el("div", {}, el("h4", {}, el("span", { className: "orden", textContent: n + 1 }), x.nombre_es),
        el("div", { className: "mut", textContent: "C" + x.constelacion + (x.talentos ? ", talentos " + x.talentos.ataque + " / " + x.talentos.habilidad + " / " + x.talentos.explosion : "") }));
      txt.append(el("ul", {}, ...x.tareas.map((k) => el("li", { textContent: k.texto }))));
      if (x.prioridad_guia) txt.append(el("div", { className: "mut", textContent: "Prioridad según KQM (" + x.prioridad_guia.version + "): " + x.prioridad_guia.texto }));
      txt.append(el("div", { className: "mut", textContent: "Aparece en: " + x.equipos.slice(0, 4).join(", ") }));
      t.append(txt); rej.append(t);
    });
    cont.append(rej);
  }
  function vacio(cont, titulo, texto, boton, destino, boton2, destino2) {
    const b = el("button", { className: "boton", type: "button", textContent: boton }); b.onclick = () => { tab = destino; render(); };
    const b2 = boton2 ? el("button", { className: "boton claro", type: "button", textContent: boton2 }) : "";
    if (b2) b2.onclick = () => { tab = destino2; render(); };
    cont.append(el("div", { className: "panel vacio-grande" }, el("h2", { textContent: titulo }), el("p", { textContent: texto }), el("div", { className: "fila centro" }, b, b2)));
  }
  function renderRecomendar(cont) {
    const propios = Object.values(estado.personajes).filter((p) => p.tengo !== false);
    if (!propios.length) { vacio(cont, "Primero, tus personajes", "Importa tu archivo GOOD o marca a mano los personajes que tienes para ver equipos con ellos.", "Importar mi archivo GOOD", "datos", "Marcar a mano", "personajes"); return; }
    estado.opciones = estado.opciones || { hexerei: true };
    const hx = el("input", { type: "checkbox", checked: estado.opciones.hexerei !== false });
    hx.onchange = () => { estado.opciones.hexerei = hx.checked; guardar(); render(); };
    const modos = el("div", { className: "modos", role: "tablist", ariaLabel: "Tipo de recomendación" });
    for (const [k, txt] of [["mejores", "Mejores equipos"], ["personaje", "Por personaje"], ["abismo", "Abismo"], ["construir", "Qué construir"]]) {
      const b = el("button", { type: "button", textContent: txt, className: modo === k ? "act" : "", role: "tab" }); b.setAttribute("aria-selected", modo === k);
      b.onclick = () => { modo = k; render(); }; modos.append(b);
    }
    cont.append(el("div", { className: "barra-modos" }, modos, el("label", { className: "interruptor", title: "Activa Hexerei: Secret Rite" }, hx, "Ya hice las misiones Witch's Homework")));
    const ctx = R.crearContexto(D, estado.personajes, { hexerei: estado.opciones.hexerei !== false, excluir: modo === "abismo" ? excluidos : [] });
    if (modo === "mejores") {
      cont.append(el("p", { className: "mut", textContent: "Equipos de las guías que puedes armar (con sustitutos si hace falta) y, para tus DPS sin guía, un equipo improvisado." }));
      const mej = R.mejores(ctx, 12);
      mej.forEach((e, n) => { const t = tarjeta(e); t.id = "equipo-" + n; cont.append(t); });
      if (!mej.length) {
        const dps = [...new Set(D.plantillas.map((x) => x.dps))].map(es).sort((a, b) => a.localeCompare(b));
        cont.append(el("div", { className: "nota", textContent: "Con los personajes que marcaste todavía no se arma ningún equipo de 4. Hace falta un DPS principal: las guías del proyecto tienen equipos para " + dps.join(", ") + ", y para otros DPS se arma un equipo improvisado. Marca más personajes en Mis personajes." }));
      }
    } else if (modo === "personaje") {
      const lista = propios.map((p) => infoRol(p.key || p.id)).filter(Boolean).sort((a, b) => a.nombre_es.localeCompare(b.nombre_es));
      if (!elegido && lista[0]) elegido = lista[0].nombre;
      const fila = el("div", { className: "elige-pj", role: "listbox", ariaLabel: "Elige un personaje" });
      for (const p of lista) {
        const i = imgPj(p.nombre);
        const b = el("button", { type: "button", className: "r" + (p.rareza || 4) + (p.nombre === elegido ? " act" : ""), title: p.roles_principales.map(textoRol).join(", ") },
          i ? el("img", { src: url(i.icono), alt: "", loading: "lazy" }) : el("span", { className: "sin-foto", textContent: p.nombre_es.slice(0, 1) }), p.nombre_es);
        b.setAttribute("aria-selected", p.nombre === elegido);
        b.onclick = () => { elegido = p.nombre; render(); };
        fila.append(b);
      }
      cont.append(fila);
      const r = R.porPersonaje(ctx, elegido);
      if (r.aviso) cont.append(el("p", { className: "nota", textContent: r.aviso }));
      if (!r.equipos.length) cont.append(el("p", { textContent: "No hay equipos para este personaje con tus personajes actuales." }));
      r.equipos.forEach((e) => cont.append(tarjeta(e)));
      if (r.casi && r.casi.length) {
        cont.append(el("h3", { textContent: "Te falta un personaje para estos equipos" }));
        cont.append(el("div", { className: "panel" }, el("ul", {}, ...r.casi.map((c) => el("li", { textContent: c.nombre + ": falta " + textoRol(c.faltan[0].rol) + " (" + c.faltan[0].opciones.map(es).join(", ") + ")" })))));
      }
    } else if (modo === "abismo") {
      const ab = D.abismo;
      const sel = el("select", { ariaLabel: "Piso del Abismo" }, ...ab.pisos.map((p) => el("option", { value: p.piso, textContent: "Piso " + p.piso + (p.estado === "verificado" ? "" : " (por confirmar)"), selected: p.piso === pisoAbismo })),
        el("option", { value: 0, textContent: "Sin piso: solo los mejores equipos", selected: pisoAbismo === 0 }));
      sel.onchange = () => { pisoAbismo = Number(sel.value); render(); };
      cont.append(el("div", { className: "fila" }, el("b", { textContent: "Abismo de Espiral" }), sel));
      const piso = ab.pisos.find((p) => p.piso === pisoAbismo);
      if (piso) {
        const info = el("div", { className: "info-piso" }, el("h4", { textContent: "Piso " + piso.piso + ", ciclo del " + ab._meta.ciclo.inicio + " al " + ab._meta.ciclo.fin }),
          el("div", { className: "mut", textContent: "Bendición de la Luna Abisal: " + ab.bendicion.nombre + ". " + ab.bendicion.texto }));
        for (const m of piso.mitades) {
          const d = el("details", {}, el("summary", { textContent: (m.mitad === 1 ? "Primera" : "Segunda") + " mitad: " + m.trastorno }),
            el("div", { textContent: m.resumen }), el("ul", {}, ...m.salas.map((x) => el("li", { textContent: "Sala " + piso.piso + "-" + x.sala + ": " + x.enemigos.join(", ") + (x.consejo ? ". " + x.consejo : "") }))));
          d.open = true; info.append(d);
        }
        if (piso.estado !== "verificado") info.append(el("div", { className: "aviso", textContent: "⚠ Los datos de este piso vienen de una sola fuente y pueden ser de un ciclo anterior." }));
        cont.append(info);
      } else cont.append(el("p", { className: "mut", textContent: "Dos equipos sin repetir personajes, ordenados por la suma de puntos." }));
      // Personajes que no quieres usar (por ejemplo, si ya los gastaste en otro piso)
      const nombresPropios = propios.map((p) => infoRol(p.key || p.id)).filter(Boolean).sort((a, b) => a.nombre_es.localeCompare(b.nombre_es));
      const exSel = el("select", { ariaLabel: "Excluir un personaje" }, el("option", { value: "", textContent: "Excluir un personaje…" }), ...nombresPropios.filter((p) => !excluidos.includes(p.nombre)).map((p) => el("option", { value: p.nombre, textContent: p.nombre_es })));
      exSel.onchange = () => { if (exSel.value) { excluidos.push(exSel.value); render(); } };
      const chips = excluidos.map((n) => { const b = el("button", { type: "button", className: "etq", textContent: es(n) + " ✕", ariaLabel: "Volver a usar a " + es(n) }); b.onclick = () => { excluidos = excluidos.filter((x) => x !== n); render(); }; return b; });
      cont.append(el("div", { className: "fila" }, exSel, ...chips));
      const pares = R.abismo(ctx, { piso: pisoAbismo });
      if (!pares.length) cont.append(el("p", { textContent: "No alcanzan los personajes para dos equipos distintos." }));
      pares.forEach((p, i) => {
        const usadas = new Set(); // las dos mitades no pueden usar la misma copia de un arma
        const t1 = tarjeta(p.equipos[0], p.ajustes && p.ajustes[0], usadas), t2 = tarjeta(p.equipos[1], p.ajustes && p.ajustes[1], usadas);
        cont.append(el("section", { className: "par" }, el("h3", {}, el("span", { className: "orden", textContent: i + 1 }), "Opción " + (i + 1) + ", " + p.puntaje + " pts"),
          el("div", { className: "mitad-et", textContent: piso ? "Primera mitad" : "Equipo 1" }), t1, el("div", { className: "mitad-et", textContent: piso ? "Segunda mitad" : "Equipo 2" }), t2));
      });
    }
    if (modo === "construir") renderConstruir(cont, ctx);
    cont.append(el("p", { className: "mut", textContent: "Los puntos solo sirven para ordenar: suman la calidad de la guía y los bonos de equipo (resonancia elemental, Moonsign, Hexerei) y restan por sustitutos, reacciones perdidas y personajes con nivel bajo." }));
  }

  function renderDatos(cont) {
    const msg = el("p", { id: "msg", role: "status" });
    const file = el("input", { type: "file", accept: ".json,application/json" });
    const importar = async (f) => {
      try {
        const texto = await f.text();
        let copia = null; try { copia = JSON.parse(texto.replace(/^\uFEFF/, "")); } catch (e) { /* lo revisa parseGood */ }
        // Copia de seguridad de esta app (personajes y armas marcados a mano): se restaura tal cual
        if (copia && copia.personajes && !Array.isArray(copia.personajes) && Array.isArray(copia.armas) && !copia.format) {
          estado = { personajes: copia.personajes, armas: copia.armas, opciones: copia.opciones }; guardar(); cacheHeroe = null;
          msg.className = "encaja"; msg.textContent = "Copia restaurada: " + Object.keys(estado.personajes).length + " personajes y " + estado.armas.length + " armas.";
          pintarHeroe(); return;
        }
        const imp = G.parseGood(texto);
        estado = G.fusionar(estado, imp); guardar(); cacheHeroe = null;
        msg.className = "encaja";
        msg.textContent = "Importado: " + imp.personajes.length + " personajes y " + imp.armas.length + " armas. Los artefactos del archivo se ignoran." + (imp.avisos.length ? " Avisos: " + imp.avisos.join("; ") : "");
        pintarHeroe();
      } catch (e) { msg.className = "aviso"; msg.textContent = "No se pudo leer el archivo: " + e.message + ". Revisa que sea un archivo GOOD o una copia de esta app (.json)."; }
    };
    file.onchange = () => file.files[0] && importar(file.files[0]);
    const zona = el("label", { className: "soltar" }, el("span", { textContent: "Arrastra aquí tu archivo GOOD (o una copia de esta app) o elígelo" }), file);
    zona.ondragover = (e) => { e.preventDefault(); zona.classList.add("encima"); };
    zona.ondragleave = () => zona.classList.remove("encima");
    zona.ondrop = (e) => { e.preventDefault(); zona.classList.remove("encima"); const f = e.dataTransfer.files[0]; if (f) importar(f); };
    const exp = el("button", { className: "boton", type: "button", textContent: "Descargar copia de mis datos" });
    exp.onclick = () => { const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(estado, null, 2)], { type: "application/json" })), download: "mis-datos-genshin.json" }); a.click(); };
    const borrar = el("button", { className: "boton peligro", type: "button", textContent: "Borrar todo" });
    borrar.onclick = () => { if (confirm("¿Borrar personajes y armas guardados?")) { estado = { personajes: {}, armas: [] }; guardar(); cacheHeroe = null; render(); } };
    cont.append(el("div", { className: "cabecera-seccion" }, el("h2", { textContent: "Importar" })));
    cont.append(el("div", { className: "panel" }, el("h3", { textContent: "Archivo GOOD" }), el("p", { className: "mut", textContent: "Sirve el archivo exportado con Irminsul, Inventory Kamera u otra herramienta que use el formato GOOD. Se guardan tus personajes y armas en este navegador." }), zona, msg));
    cont.append(el("div", { className: "panel" }, el("h3", { textContent: "Copia de seguridad" }), el("p", { className: "mut", textContent: "Tus datos solo viven en este navegador. Descarga una copia y cárgala arriba en otro navegador o en tu celular para pasarlos." }), el("div", { className: "fila" }, exp, borrar)));
  }

  // ---------- Héroe: el DPS de tus mejores equipos, con su arte oficial ----------
  let cacheHeroe = null, claveHeroe = "", idxHeroe = 0, temporizador = null;
  function equiposHeroe() {
    const propios = Object.values(estado.personajes).filter((p) => p.tengo !== false);
    const clave = JSON.stringify([propios.map((p) => [p.id, p.nivel, p.constelacion]), estado.opciones && estado.opciones.hexerei]);
    if (cacheHeroe && clave === claveHeroe) return cacheHeroe;
    claveHeroe = clave; cacheHeroe = [];
    if (propios.length) {
      try {
        const ctx = R.crearContexto(D, estado.personajes, { hexerei: !estado.opciones || estado.opciones.hexerei !== false });
        const vistos = new Set();
        R.mejores(ctx, 12).forEach((e, n) => { if (!vistos.has(e.dps) && cacheHeroe.length < 5) { vistos.add(e.dps); cacheHeroe.push({ eq: e, n }); } });
      } catch (e) { cacheHeroe = []; }
    }
    if (idxHeroe >= cacheHeroe.length) idxHeroe = 0;
    return cacheHeroe;
  }
  function pintarHeroe() {
    const caja = $("#heroe"), lista = equiposHeroe();
    const actual = lista[idxHeroe];
    const nombre = actual ? actual.eq.dps : "Furina";
    const pal = paletaDe(nombre), i = imgPj(nombre), r = infoRol(nombre) || {};
    ponerPaleta(document.documentElement, pal, "c");
    caja.textContent = "";
    const esc = el("div", { className: "escenario" });
    if (i && i.splash) esc.append(el("div", { className: "arte", role: "img", ariaLabel: "Arte oficial de " + es(nombre), style: "background-image:url('" + url(i.splash) + "')" }));
    const tx = el("div", { className: "texto" });
    if (actual) {
      tx.append(el("div", { className: "quien" }, iconoEl(r.elemento, "x"), actual.n === 0 ? "La estrella de tu mejor equipo" : "DPS de tu equipo número " + (actual.n + 1)));
      tx.append(el("h1", { textContent: es(nombre) }), el("div", { className: "equipo-nombre", textContent: actual.eq.nombre.replace(actual.eq.dps, es(actual.eq.dps)) }));
      tx.append(el("div", { className: "caritas" }, ...actual.eq.miembros.map((m) => { const im = imgPj(m.personaje); return im ? el("img", { src: url(im.icono), alt: es(m.personaje), title: es(m.personaje) }) : ""; })));
      const ver = el("button", { className: "boton-heroe", type: "button", textContent: "Ver este equipo" });
      ver.onclick = () => { tab = "recomendar"; modo = "mejores"; render(); const t = document.getElementById("equipo-" + actual.n); if (t) t.scrollIntoView({ behavior: MOVIMIENTO ? "smooth" : "auto", block: "start" }); };
      tx.append(ver);
    } else {
      tx.append(el("div", { className: "quien" }, iconoEl(r.elemento, "x"), "Hola, viajero"));
      tx.append(el("h1", { textContent: "Arma tus equipos" }), el("div", { className: "equipo-nombre", textContent: "Importa tu archivo GOOD y la app te propone equipos con tus personajes y tus armas." }));
      const ir = el("button", { className: "boton-heroe", type: "button", textContent: "Importar mi archivo" }); ir.onclick = () => { tab = "datos"; render(); };
      tx.append(ir);
    }
    tx.append(el("div", { className: "paleta" }, ...pal.map((c) => el("i", { style: "background:" + c })), "Colores de " + es(nombre)));
    esc.append(tx);
    if (lista.length > 1) {
      const mover = (d) => { idxHeroe = (idxHeroe + d + lista.length) % lista.length; pintarHeroe(); reiniciar(); };
      const izq = el("button", { className: "flecha izq", type: "button", textContent: "‹", ariaLabel: "Anterior" }); izq.onclick = () => mover(-1);
      const der = el("button", { className: "flecha der", type: "button", textContent: "›", ariaLabel: "Siguiente" }); der.onclick = () => mover(1);
      const puntos = el("div", { className: "puntos" });
      lista.forEach((x, k) => { const b = el("button", { type: "button", className: k === idxHeroe ? "act" : "", ariaLabel: "Ver a " + es(x.eq.dps) }); b.onclick = () => { idxHeroe = k; pintarHeroe(); reiniciar(); }; puntos.append(b); });
      esc.append(izq, der, puntos);
    }
    caja.append(esc);
  }
  // Cambia de personaje cada 9 segundos; se detiene con el ratón o el foco encima y si se piden menos animaciones
  function reiniciar() {
    clearInterval(temporizador);
    if (!MOVIMIENTO) return;
    temporizador = setInterval(() => {
      const h = $("#heroe"); if (h.matches(":hover") || h.contains(document.activeElement) || document.hidden) return;
      const n = (cacheHeroe || []).length; if (n > 1) { idxHeroe = (idxHeroe + 1) % n; pintarHeroe(); }
    }, 9000);
  }

  function render() {
    const cont = $("#contenido");
    for (const n of [...cont.childNodes]) if (n !== FILTROS) n.remove();
    document.querySelectorAll("nav button").forEach((b) => { b.classList.toggle("act", b.dataset.t === tab); b.setAttribute("aria-current", b.dataset.t === tab ? "page" : "false"); });
    FILTROS.hidden = tab !== "personajes";
    $("#heroe").classList.toggle("compacto", tab !== "recomendar");
    pintarHeroe();
    ({ recomendar: renderRecomendar, personajes: renderPersonajes, armas: renderArmas, datos: renderDatos })[tab](cont);
  }

  document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; render(); }));
  $(".marca").onclick = (e) => { e.preventDefault(); tab = "recomendar"; modo = "mejores"; render(); };
  const dlg = $("#ficha");
  dlg.addEventListener("close", render);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  montarFiltros();
  render(); reiniciar(); cargarCatalogo();
})();
