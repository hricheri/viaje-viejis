// ---------- Constantes ----------
const MOOD_EMOJI = {
  paseo: "🚶", historia: "🏛️", cafecito: "☕", morfi: "🍽️",
  arte: "🎨", shopping: "🛍️", chill: "😌", vistas: "🌆",
  casa: "🏠", cambio_de_look: "💇", medialunas: "🥐", adrenalina: "🎢"
};
const MAX_MOODS = 3;
const LS_KEYS = {
  moods: "vv_selected_moods",
  states: "vv_activity_state",
  custom: "vv_custom_activities",
  tab: "vv_active_tab"
};

// ---------- Estado en memoria ----------
let DATA = { moods: [], activities: [] };
let activityStates = {};
let customActivities = [];
let selectedMoods = [];
let activeTab = "hoy";
let flippedIds = new Set();
let pendingElegirId = null;

// ---------- Utilidades ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("No se pudo guardar en localStorage", e);
  }
}

function allActivities() {
  return [...DATA.activities, ...customActivities];
}

function getState(id) {
  return activityStates[id] || { estado: "nueva", dia: null, orden: null };
}

function setState(id, patch) {
  const current = getState(id);
  activityStates[id] = { ...current, ...patch };
  saveJSON(LS_KEYS.states, activityStates);
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDia(iso) {
  const d = new Date(iso + "T00:00:00");
  const fmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "short" });
  const s = fmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Carga inicial ----------
async function init() {
  try {
    const res = await fetch("data/actividades.json");
    DATA = await res.json();
  } catch (e) {
    DATA = { moods: [], activities: [] };
    console.error("No se pudo cargar actividades.json", e);
  }
  activityStates = loadJSON(LS_KEYS.states, {});
  customActivities = loadJSON(LS_KEYS.custom, []);
  selectedMoods = loadJSON(LS_KEYS.moods, []);
  activeTab = localStorage.getItem(LS_KEYS.tab) || "hoy";

  setupTabBar();
  setupModales();
  playSplash(() => {
    document.body.classList.remove("pre-splash");
    setActiveTab(activeTab, { skipSave: true });
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

// ---------- Splash de entrada ----------
function playSplash(onComplete) {
  const splash = $("#splash-screen");
  const ring = $("#splash-emoji-ring");
  const emojis = Object.values(MOOD_EMOJI);
  const n = emojis.length;
  const half = Math.ceil(n / 2);
  // Dos arcos (arriba y abajo del texto) para que ningún emoji caiga
  // a la altura/los costados del texto central.
  const radius = window.innerWidth * 0.48;
  const arcSpan = (120 * Math.PI) / 180; // 120° de arco
  const topStart = -Math.PI / 2 - arcSpan / 2;
  const bottomStart = Math.PI / 2 - arcSpan / 2;

  emojis.forEach((emoji, i) => {
    const inTop = i < half;
    const groupIndex = inTop ? i : i - half;
    const groupSize = inTop ? half : n - half;
    const start = inTop ? topStart : bottomStart;
    const angle = groupSize > 1 ? start + (groupIndex / (groupSize - 1)) * arcSpan : start + arcSpan / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const span = document.createElement("span");
    span.className = "splash-emoji";
    span.textContent = emoji;
    span.style.left = `calc(50% + ${x}px - 1.15rem)`;
    span.style.top = `calc(50% + ${y}px - 1.15rem)`;
    span.style.setProperty("--pop-delay", `${0.15 + i * 0.06}s`);
    ring.appendChild(span);
  });

  const dismissAt = (0.15 + n * 0.06 + 1.5) * 1000;
  let dismissed = false;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    splash.removeEventListener("click", dismiss);
    splash.classList.add("hidden");
    setTimeout(() => {
      splash.remove();
      onComplete();
    }, 500);
  };

  splash.addEventListener("click", dismiss);
  setTimeout(dismiss, dismissAt);
}

// ---------- Tabs ----------
function setupTabBar() {
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });
}

function setActiveTab(tab, opts = {}) {
  activeTab = tab;
  if (!opts.skipSave) localStorage.setItem(LS_KEYS.tab, tab);
  $$(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  flippedIds.clear();
  render();
}

function render() {
  const root = $("#view-root");
  root.innerHTML = "";
  if (activeTab === "hoy") renderHoy(root);
  else if (activeTab === "todo") renderTodo(root);
  else if (activeTab === "dias") renderDias(root);
  else if (activeTab === "eliminadas") renderEliminadas(root);
}

// ---------- Tab: Hoy ----------
function renderHoy(root) {
  const intro = document.createElement("h2");
  intro.className = "mood-intro";
  intro.innerHTML = `¿En qué mood estás hoy? <span class="mood-intro-emoji">✨</span>`;
  root.appendChild(intro);

  const moodGrid = document.createElement("div");
  moodGrid.className = "mood-grid";
  DATA.moods.forEach((mood) => {
    const btn = document.createElement("button");
    const isSelected = selectedMoods.includes(mood.id);
    btn.className = "mood-chip" + (isSelected ? " selected" : "");
    btn.disabled = !isSelected && selectedMoods.length >= MAX_MOODS;
    btn.innerHTML = `<span class="emoji">${MOOD_EMOJI[mood.id] || "✨"}</span><span>${escapeHtml(mood.label)}</span>`;
    btn.addEventListener("click", () => toggleMood(mood.id));
    moodGrid.appendChild(btn);
  });
  root.appendChild(moodGrid);

  const hint = document.createElement("p");
  hint.className = "mood-hint";
  hint.textContent = selectedMoods.length === 0
    ? "Elegí de 1 a 3 moods para ver actividades 👆"
    : `Mostrando actividades para: ${selectedMoods.map((m) => DATA.moods.find((x) => x.id === m)?.label).join(" + ")}`;
  root.appendChild(hint);

  if (selectedMoods.length === 0) return;

  const feed = allActivities()
    .filter((a) => getState(a.id).estado === "nueva")
    .map((a) => ({ a, score: a.moods.filter((m) => selectedMoods.includes(m)).length }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.nombre.localeCompare(y.a.nombre));

  if (feed.length === 0) {
    root.appendChild(emptyState("🌱", "No quedan actividades nuevas con ese mood. Probá otra combinación o mirá tus guardadas en To-do."));
    return;
  }

  const list = document.createElement("div");
  list.className = "activity-list";
  feed.forEach(({ a }) => list.appendChild(renderCard(a, "hoy")));
  root.appendChild(list);
}

function toggleMood(id) {
  if (selectedMoods.includes(id)) {
    selectedMoods = selectedMoods.filter((m) => m !== id);
  } else if (selectedMoods.length < MAX_MOODS) {
    selectedMoods = [...selectedMoods, id];
  }
  saveJSON(LS_KEYS.moods, selectedMoods);
  render();
}

// ---------- Tab: To-do (guardadas por barrio) ----------
function renderTodo(root) {
  const guardadas = allActivities().filter((a) => getState(a.id).estado === "guardada");
  if (guardadas.length === 0) {
    root.appendChild(emptyState("🔖", "Todavía no guardaste nada para después. Las actividades que guardes desde 'Hoy' van a aparecer acá, agrupadas por barrio."));
    return;
  }
  const porBarrio = {};
  guardadas.forEach((a) => {
    const key = a.barrio || "Sin barrio";
    (porBarrio[key] = porBarrio[key] || []).push(a);
  });
  Object.keys(porBarrio).sort().forEach((barrio) => {
    const group = document.createElement("div");
    group.className = "barrio-group";
    group.innerHTML = `<h2 class="barrio-heading">📍 ${escapeHtml(barrio)}</h2>`;
    const list = document.createElement("div");
    list.className = "activity-list";
    porBarrio[barrio].forEach((a) => list.appendChild(renderCard(a, "todo")));
    group.appendChild(list);
    root.appendChild(group);
  });
}

// ---------- Tab: Días ----------
function renderDias(root) {
  const elegidas = allActivities().filter((a) => getState(a.id).estado === "elegida");
  if (elegidas.length === 0) {
    root.appendChild(emptyState("🗓️", "Todavía no elegiste actividades para ningún día. Desde 'Hoy' o 'To-do' tocá '✅ Elegir' para sumarlas a un día."));
    return;
  }
  const porDia = {};
  elegidas.forEach((a) => {
    const dia = getState(a.id).dia || "sin-fecha";
    (porDia[dia] = porDia[dia] || []).push(a);
  });
  Object.keys(porDia).sort().forEach((dia) => {
    const group = document.createElement("div");
    group.className = "day-group";
    const heading = document.createElement("div");
    heading.className = "day-heading";
    heading.textContent = dia === "sin-fecha" ? "Sin fecha" : formatDia(dia);
    group.appendChild(heading);

    const list = document.createElement("div");
    list.className = "day-list";
    list.dataset.dia = dia;

    porDia[dia]
      .sort((a, b) => (getState(a.id).orden ?? 0) - (getState(b.id).orden ?? 0))
      .forEach((a) => {
        const item = document.createElement("div");
        item.className = "day-item";
        item.dataset.id = a.id;
        item.innerHTML = `
          <span class="drag-handle">⠿</span>
          <span class="day-item-title">${escapeHtml(a.nombre)}</span>
          <button class="day-item-remove" data-action="quitar-dia" data-id="${a.id}">✖️</button>
        `;
        list.appendChild(item);
      });

    group.appendChild(list);
    root.appendChild(group);

    if (window.Sortable) {
      Sortable.create(list, {
        animation: 150,
        handle: ".drag-handle",
        ghostClass: "sortable-ghost",
        onEnd: () => {
          Array.from(list.children).forEach((el, idx) => {
            setState(el.dataset.id, { orden: idx });
          });
        }
      });
    }
  });
}

// ---------- Tab: Eliminadas ----------
function renderEliminadas(root) {
  const descartadas = allActivities().filter((a) => getState(a.id).estado === "descartada");
  if (descartadas.length === 0) {
    root.appendChild(emptyState("🗑️", "No descartaste ninguna actividad todavía."));
    return;
  }
  const list = document.createElement("div");
  list.className = "activity-list";
  descartadas.forEach((a) => list.appendChild(renderCard(a, "eliminadas")));
  root.appendChild(list);
}

// ---------- Card genérica ----------
function renderCard(a, context) {
  const wrap = document.createElement("div");
  wrap.className = "card-flip" + (flippedIds.has(a.id) ? " flipped" : "");
  wrap.dataset.id = a.id;

  const especiales = (a.categoria_especial || [])
    .map((c) => `<span class="badge special-badge">${escapeHtml(c)}</span>`).join("");
  const moods = (a.moods || [])
    .map((m) => `<span class="badge mood-badge">${MOOD_EMOJI[m] || ""} ${escapeHtml(DATA.moods.find((x) => x.id === m)?.label || m)}</span>`)
    .join("");
  const banoBadge = a.tiene_bano === true ? `<span class="badge">🚻 tiene baño</span>` : "";

  let actionsHtml = "";
  if (context === "hoy") {
    actionsHtml = `
      <button class="icon-btn descartar" data-action="descartar" title="Descartar">✖️</button>
      <button class="icon-btn guardar" data-action="guardar" title="Guardar para después">🔖</button>
      <button class="icon-btn elegir" data-action="elegir" title="Elegir para el recorrido">✅</button>
    `;
  } else if (context === "todo") {
    actionsHtml = `
      <button class="icon-btn descartar" data-action="descartar" title="Descartar">✖️</button>
      <button class="icon-btn elegir" data-action="elegir" title="Elegir para el recorrido">✅</button>
    `;
  } else if (context === "eliminadas") {
    actionsHtml = `<button class="icon-btn guardar" data-action="restaurar" title="Restaurar">↩️ Restaurar</button>`;
  }

  const mapsBtn = a.maps_url ? `<a class="icon-btn" href="${a.maps_url}" target="_blank" rel="noopener" title="Abrir en Maps">🗺️</a>` : "";
  const shareBtn = `<button class="icon-btn" data-action="compartir" title="Compartir">📤</button>`;

  wrap.innerHTML = `
    <div class="card-flip-inner">
      <div class="card-face card-front">
        <div class="card-top">
          <div>
            <h3 class="card-title">${escapeHtml(a.nombre)}</h3>
            <div class="card-barrio">📍 ${escapeHtml(a.barrio || "")}</div>
          </div>
          <button class="icon-btn" data-action="flip" title="Ver dato curioso">ℹ️</button>
        </div>
        <div class="badge-row">${moods}${especiales}${banoBadge}</div>
        <div class="card-actions">${actionsHtml}${mapsBtn}${shareBtn}</div>
      </div>
      <div class="card-face card-back">
        <p>${escapeHtml(a.dato_curioso || "Todavía no tengo un dato curioso para esta actividad.")}</p>
        <button class="btn btn-text" data-action="flip">⬅️ Volver</button>
      </div>
    </div>
  `;

  wrap.addEventListener("click", (e) => handleCardClick(e, a));
  return wrap;
}

function handleCardClick(e, a) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "flip") {
    if (flippedIds.has(a.id)) flippedIds.delete(a.id);
    else flippedIds.add(a.id);
    $(`.card-flip[data-id="${a.id}"]`)?.classList.toggle("flipped");
    return;
  }
  if (action === "descartar") {
    setState(a.id, { estado: "descartada", dia: null, orden: null });
    render();
  }
  if (action === "guardar") {
    setState(a.id, { estado: "guardada", dia: null, orden: null });
    render();
  }
  if (action === "restaurar") {
    setState(a.id, { estado: "nueva", dia: null, orden: null });
    render();
  }
  if (action === "elegir") {
    abrirModalElegir(a.id);
  }
  if (action === "compartir") {
    compartirActividad(a);
  }
}

function compartirActividad(a) {
  const text = `${a.nombre}${a.barrio ? " · " + a.barrio : ""}\n${a.dato_curioso || ""}\n${a.maps_url || ""}`;
  if (navigator.share) {
    navigator.share({ title: a.nombre, text }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text);
    alert("Copiado al portapapeles (tu navegador no soporta compartir directo).");
  }
}

function emptyState(emoji, text) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.innerHTML = `<span class="emoji-lg">${emoji}</span>${escapeHtml(text)}`;
  return div;
}

// ---------- Modal: elegir día ----------
function setupModales() {
  const modalElegir = $("#modal-elegir");
  $("#btn-cerrar-modal").addEventListener("click", () => cerrarModalElegir());
  $("#btn-elegir-hoy").addEventListener("click", () => confirmarElegir(todayISO()));
  $("#btn-elegir-fecha").addEventListener("click", () => {
    const val = $("#input-fecha").value;
    if (val) confirmarElegir(val);
  });
  modalElegir.addEventListener("click", (e) => {
    if (e.target === modalElegir) cerrarModalElegir();
  });

  const modalCrear = $("#modal-crear");
  $("#btn-cerrar-crear").addEventListener("click", () => (modalCrear.hidden = true));
  modalCrear.addEventListener("click", (e) => {
    if (e.target === modalCrear) modalCrear.hidden = true;
  });
  $("#btn-guardar-creada").addEventListener("click", guardarActividadCreada);

  const fab = document.createElement("button");
  fab.className = "fab";
  fab.textContent = "+";
  fab.title = "Crear actividad";
  fab.addEventListener("click", abrirModalCrear);
  document.body.appendChild(fab);

  $("#view-root").addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="quitar-dia"]');
    if (btn) {
      setState(btn.dataset.id, { estado: "guardada", dia: null, orden: null });
      render();
    }
  });
}

function abrirModalElegir(id) {
  pendingElegirId = id;
  $("#input-fecha").value = "";
  $("#modal-elegir").hidden = false;
}

function cerrarModalElegir() {
  $("#modal-elegir").hidden = true;
  pendingElegirId = null;
}

function confirmarElegir(fechaISO) {
  if (!pendingElegirId) return;
  const dia = fechaISO;
  const yaEnEseDia = allActivities().filter(
    (a) => getState(a.id).estado === "elegida" && getState(a.id).dia === dia
  ).length;
  setState(pendingElegirId, { estado: "elegida", dia, orden: yaEnEseDia });
  cerrarModalElegir();
  render();
}

// ---------- Modal: crear actividad ----------
function abrirModalCrear() {
  $("#input-nombre").value = "";
  $("#input-foto").value = "";
  $("#input-descripcion").value = "";
  $("#input-maps-url").value = "";
  const grid = $("#crear-moods");
  grid.innerHTML = "";
  DATA.moods.forEach((mood) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "mood-check";
    el.dataset.mood = mood.id;
    el.textContent = `${MOOD_EMOJI[mood.id] || ""} ${mood.label}`;
    el.addEventListener("click", () => el.classList.toggle("selected"));
    grid.appendChild(el);
  });
  $("#modal-crear").hidden = false;
}

function guardarActividadCreada() {
  const nombre = $("#input-nombre").value.trim();
  const descripcion = $("#input-descripcion").value.trim();
  const mapsUrl = $("#input-maps-url").value.trim();
  const moods = $$("#crear-moods .mood-check.selected").map((el) => el.dataset.mood);
  const fotoInput = $("#input-foto");

  if (!nombre) { alert("Ponele un título a tu actividad."); return; }
  if (moods.length === 0) { alert("Elegí al menos un mood."); return; }

  const finalize = (fotoDataUrl) => {
    const id = "custom-" + Date.now();
    customActivities.push({
      id,
      nombre,
      moods,
      categoria_especial: ["Creada por vos"],
      barrio: "Mis actividades",
      maps_url: mapsUrl || null,
      dato_curioso: descripcion,
      tiene_bano: null,
      foto: fotoDataUrl || null
    });
    saveJSON(LS_KEYS.custom, customActivities);
    setState(id, { estado: "guardada" });
    $("#modal-crear").hidden = true;
    setActiveTab("todo");
  };

  if (fotoInput.files && fotoInput.files[0]) {
    const reader = new FileReader();
    reader.onload = () => finalize(reader.result);
    reader.readAsDataURL(fotoInput.files[0]);
  } else {
    finalize(null);
  }
}

document.addEventListener("DOMContentLoaded", init);
