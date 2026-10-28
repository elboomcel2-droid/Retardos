'use strict';

// ---------------------------------------------------------------- utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = (s) => (s ? s.split('-').reverse().join('/') : '');
const pct = (v) => (v == null ? '—' : `${v}%`);
const hrs = (min) => `${Math.floor(min / 60)}:${pad(Math.round(min % 60))} h`;
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const REPORT_VIEWS = ['panel', 'empleados', 'detalle'];

// Estados que produce el motor, con su color y explicación.
const ESTADOS = {
  PUNTUAL: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', bar: 'bg-emerald-500', txt: 'Llegó a tiempo' },
  RETARDO: { cls: 'bg-amber-50 text-amber-800 ring-amber-600/25', bar: 'bg-amber-400', txt: 'Después de la tolerancia' },
  FALTA: { cls: 'bg-rose-50 text-rose-700 ring-rose-600/20', bar: 'bg-rose-500', txt: 'Sin checadas en día laborable' },
  INCOMPLETO: { cls: 'bg-orange-50 text-orange-700 ring-orange-600/20', bar: 'bg-orange-400', txt: 'Solo checó salida' },
  JUSTIFICADO: { cls: 'bg-sky-50 text-sky-700 ring-sky-600/20', bar: 'bg-sky-500', txt: 'Autorizado y documentado' },
  'DÍA EXTRA': { cls: 'bg-violet-50 text-violet-700 ring-violet-600/20', bar: 'bg-violet-500', txt: 'Checó en domingo o descanso' },
  'SIN DATOS': { cls: 'bg-slate-50 text-slate-600 ring-slate-400/40', bar: 'bg-slate-300', txt: 'El checador no registró a nadie' },
  DESCANSO: { cls: 'bg-slate-100 text-slate-500 ring-slate-300/40', bar: 'bg-slate-200', txt: 'Día no laborable' },
  FESTIVO: { cls: 'bg-slate-100 text-slate-500 ring-slate-300/40', bar: 'bg-slate-200', txt: 'Día festivo' },
  PENDIENTE: { cls: 'bg-slate-100 text-slate-400 ring-slate-300/40', bar: 'bg-slate-200', txt: 'Aún no ocurre' },
};
const badge = (e) => `<span class="badge ${ESTADOS[e]?.cls || ''}">${esc(e)}</span>`;

const ICONS = {
  panel: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  empleados: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  detalle: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  datos: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-2.82-1.17l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.2 14H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  bitacora: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
};
const icon = (name, cls = 'size-4') =>
  `<svg class="${cls} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const NAV = [
  ['panel', 'Panel'],
  ['empleados', 'Empleados'],
  ['detalle', 'Detalle diario'],
  ['datos', 'Cargar checadas'],
  ['config', 'Configuración'],
  ['bitacora', 'Historial de cambios'],
];

function usuario() {
  return ($('#usuario').value || $('#usuarioMobile').value).trim();
}

async function api(url, opts = {}) {
  const headers = { 'x-usuario': encodeURIComponent(usuario()), ...(opts.headers || {}) };
  let body = opts.body;
  if (body && !(body instanceof ArrayBuffer) && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(url, { ...opts, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg, type = 'ok') {
  const colors = {
    ok: 'border-emerald-200 bg-white text-slate-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
  };
  const dot = { ok: 'bg-emerald-500', error: 'bg-rose-500' };
  const el = document.createElement('div');
  el.className = `pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg transition duration-300 ${colors[type]}`;
  el.innerHTML = `<span class="mt-1.5 size-2 shrink-0 rounded-full ${dot[type]}"></span><div class="whitespace-pre-line">${esc(msg)}</div>`;
  $('#toasts').append(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, type === 'error' ? 7000 : 3500);
}

async function busy(btn, fn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${esc(btn.textContent.trim())}`;
  try {
    await fn();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = html;
  }
}

function openDialog(id, html) {
  $(`#${id}Body`).innerHTML = html;
  if (!$(`#${id}`).open) $(`#${id}`).showModal();
  $$(`#${id}Body [data-close]`).forEach((b) => b.addEventListener('click', () => $(`#${id}`).close()));
}
const closeDialogs = () => ['modal', 'drawer'].forEach((id) => $(`#${id}`).open && $(`#${id}`).close());

const closeBtn = `<button class="btn btn-ghost -mt-1 -mr-2 p-2" data-close aria-label="Cerrar">${icon('x', 'size-5')}</button>`;

function emptyState(title, text) {
  return `<div class="card card-pad flex flex-col items-center gap-3 py-16 text-center">
    <div class="grid size-14 place-items-center rounded-full bg-brand-50 text-brand-700">${icon('datos', 'size-7')}</div>
    <h2 class="text-lg font-semibold text-slate-900">${title}</h2>
    <p class="max-w-md text-sm text-slate-500">${text}</p></div>`;
}

function notice(tone, html) {
  const t = {
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  }[tone];
  return `<div class="flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${t}">${icon('alert', 'size-5 mt-px')}<div>${html}</div></div>`;
}

// ---------------------------------------------------------------- estado
const state = {
  view: 'panel',
  branches: [],
  report: null,
  estadoFilter: new Set(['RETARDO', 'FALTA', 'INCOMPLETO', 'JUSTIFICADO', 'DÍA EXTRA', 'SIN DATOS']),
  search: '',
  sort: { key: 'retardos', dir: -1 },
};

function query() {
  return `from=${$('#from').value}&to=${$('#to').value}&branch=${$('#branch').value}`;
}

// Las nóminas se manejan por quincena: 1–15 y 16–fin de mes.
function applyPreset() {
  const p = $('#preset').value;
  if (p === 'custom') return;
  const t = new Date();
  let a, b;
  const quincena = (d) =>
    d.getDate() <= 15
      ? [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth(), 15)]
      : [new Date(d.getFullYear(), d.getMonth(), 16), new Date(d.getFullYear(), d.getMonth() + 1, 0)];
  if (p === 'q-actual') [a, b] = quincena(t);
  if (p === 'q-anterior') {
    const [s] = quincena(t);
    s.setDate(s.getDate() - 1);
    [a, b] = quincena(s);
  }
  if (p === 'mes-actual') [a, b] = [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0)];
  if (p === 'mes-anterior') [a, b] = [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)];
  if (p === 'semana') [a, b] = [new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6), t];
  $('#from').value = iso(a);
  $('#to').value = iso(b);
}

async function loadBranches() {
  state.branches = await api('/api/branches');
  const sel = $('#branch');
  const cur = sel.value;
  sel.innerHTML =
    '<option value="all">Todas las sucursales</option>' +
    state.branches.filter((b) => b.enabled).map((b) => `<option value="${b.id}">${esc(b.code)} ${esc(b.name)}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'all';
}

async function loadReport() {
  state.report = await api(`/api/report?${query()}`);
  const branchName = $('#branch').selectedOptions[0].textContent;
  $('#printHeader').innerHTML = `<h1 class="text-lg font-bold">El Boom Tractopartes · Reporte de asistencia</h1>
    <div class="text-sm">Sucursal: <b>${esc(branchName)}</b> · Periodo: <b>${fmtDate(state.report.from)} al ${fmtDate(state.report.to)}</b> ·
    Generado ${new Date().toLocaleString('es-MX')}${usuario() ? ` por ${esc(usuario())}` : ''}</div>`;
}

async function refresh() {
  try {
    if (REPORT_VIEWS.includes(state.view)) {
      $('#view').classList.add('opacity-60', 'transition');
      await loadReport();
    } else state.report = null;
    await render();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    $('#view').classList.remove('opacity-60');
  }
}

function renderNav() {
  const badge = (v) => (v === 'empleados' && state.pendientes?.length
    ? `<span class="ml-auto rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-brand-900" title="Nombres por completar">${state.pendientes.length}</span>` : '');
  $('#nav').innerHTML = NAV.map(([v, l]) =>
    `<button class="nav-item ${state.view === v ? 'active' : ''}" data-view="${v}">${icon(v, 'size-[18px]')}${l}${badge(v)}</button>`).join('');
  $('#navMobile').innerHTML = NAV.map(([v, l]) =>
    `<button class="rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${state.view === v ? 'bg-white/15 text-white' : 'text-slate-300'}" data-view="${v}">${l}</button>`).join('');
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
}

async function render() {
  renderNav();
  $('#filters').classList.toggle('hidden', !['panel', 'empleados', 'detalle', 'datos'].includes(state.view));
  await VIEWS[state.view]();
}

function pageHeader(title, subtitle, extra = '') {
  return `<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div><h1 class="text-2xl font-bold tracking-tight text-slate-900">${title}</h1>
    ${subtitle ? `<p class="mt-1 text-sm text-slate-500">${subtitle}</p>` : ''}</div>${extra}</div>`;
}

const periodText = () => (state.report ? `${fmtDate(state.report.from)} al ${fmtDate(state.report.to)} · ${esc($('#branch').selectedOptions[0].textContent)}` : '');

const noData = () =>
  emptyState('No hay checadas en este periodo', 'Pulse <b>Actualizar desde checadores</b> (arriba) para traer las checadas, o súbalas desde la sección <b>Cargar checadas</b>.');

// ---------------------------------------------------------------- Panel
function tone(p) {
  if (p == null) return { text: 'text-slate-400', ring: 'ring-slate-200', bg: 'bg-slate-50' };
  if (p >= 90) return { text: 'text-emerald-600', ring: 'ring-emerald-200', bg: 'bg-emerald-50' };
  if (p >= 75) return { text: 'text-amber-600', ring: 'ring-amber-200', bg: 'bg-amber-50' };
  return { text: 'text-rose-600', ring: 'ring-rose-200', bg: 'bg-rose-50' };
}

function stackBar(t, h = 'h-2') {
  const parts = [
    ['PUNTUAL', t.puntuales],
    ['RETARDO', t.retardos],
    ['INCOMPLETO', t.incompletos],
    ['JUSTIFICADO', t.justificados],
    ['FALTA', t.faltas],
  ];
  const total = parts.reduce((n, [, v]) => n + v, 0) || 1;
  return `<div class="flex ${h} w-full overflow-hidden rounded-full bg-slate-100">${parts
    .filter(([, v]) => v)
    .map(([e, v]) => `<div class="${ESTADOS[e].bar}" style="width:${(v / total) * 100}%" title="${e}: ${v}"></div>`)
    .join('')}</div>`;
}

function stat(label, value, sub = '', cls = 'text-slate-900') {
  return `<div class="card card-pad">
    <div class="text-xs font-medium tracking-wide text-slate-500 uppercase">${label}</div>
    <div class="mt-2 text-3xl font-bold tabular-nums ${cls}">${value}</div>
    ${sub ? `<div class="mt-1 text-xs text-slate-500">${sub}</div>` : ''}</div>`;
}

function totals(list) {
  const t = { puntuales: 0, retardos: 0, minutos_retardo: 0, faltas: 0, justificados: 0, dias_extra: 0, minutos_extra: 0 };
  for (const b of list) for (const k of Object.keys(t)) t[k] += b[k] || 0;
  const ev = t.puntuales + t.retardos;
  t.puntualidad = ev ? Math.round((t.puntuales / ev) * 1000) / 10 : null;
  return t;
}

function viewPanel() {
  const r = state.report;
  if (!r.days.length) {
    $('#view').innerHTML = pageHeader('Panel de asistencia', periodText()) + noData() + `<div class="mt-4 space-y-3">${sinNombreNotice(r)}${ausentesNotice(r)}</div>`;
    return bindLinks($('#view'));
  }

  const T = totals(r.branches);
  const sinDatos = r.branches.filter((b) => b.sin_datos > 0);
  const evaluadas = new Set(r.branches.map((b) => b.branch_id));
  const sinChecadas = state.branches.filter((b) => b.enabled && !evaluadas.has(b.id) && ($('#branch').value === 'all' || String(b.id) === $('#branch').value));
  const pendientes = r.days.filter((d) => ['FALTA', 'INCOMPLETO'].includes(d.estado)).length;
  const extras = r.days.filter((d) => d.estado === 'DÍA EXTRA');
  const topRet = [...r.employees].filter((e) => e.retardos).sort((a, b) => b.retardos - a.retardos || b.minutos_retardo - a.minutos_retardo).slice(0, 8);
  const topFal = [...r.employees].filter((e) => e.faltas).sort((a, b) => b.faltas - a.faltas).slice(0, 8);

  $('#view').innerHTML = `
    ${pageHeader('Panel de asistencia', periodText())}
    <div class="mb-6 space-y-3">
      ${sinDatos.length ? notice('warn', `Hay días en que <b>nadie checó</b> en ${sinDatos.map((b) => `<b>${esc(b.sucursal)}</b>`).join(', ')}. Se marcan como <b>SIN DATOS</b> y no cuentan como falta: verifique que el checador esté encendido y que las checadas estén actualizadas.`) : ''}
      ${sinChecadas.map((b) => notice('warn', `<b>${esc(b.code)} ${esc(b.name)}</b> no tiene checadas en este periodo${b.cobertura ? `: la última que hay es del <b>${fmtDate(b.cobertura.hasta.slice(0, 10))}</b>` : ''}.
        Revise que el checador esté encendido y conectado a internet.`)).join('')}
      ${sinNombreNotice(r)}
      ${ausentesNotice(r)}
      ${pendientes ? notice('info', `<b>${pendientes}</b> día(s) con falta o checada incompleta por revisar. <button class="font-semibold underline" data-goto="detalle">Ir al detalle diario →</button>`) : ''}
    </div>

    <div class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${stat('Puntualidad general', pct(T.puntualidad), `${T.puntuales} de ${T.puntuales + T.retardos} entradas a tiempo`, tone(T.puntualidad).text)}
      ${stat('Retardos', T.retardos, `${hrs(T.minutos_retardo)} de retraso en total`, 'text-amber-600')}
      ${stat('Faltas', T.faltas, `${T.justificados} día(s) justificados`, 'text-rose-600')}
      ${stat('Días extra', T.dias_extra, `${hrs(T.minutos_extra)} trabajadas en domingos o festivos`, 'text-violet-600')}
    </div>

    <div class="mb-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      ${r.branches.map((b) => {
        const t = tone(b.puntualidad);
        return `<button class="card card-pad text-left transition hover:-translate-y-0.5 hover:shadow-md" data-pick-branch="${b.branch_id}" title="Ver empleados de esta sucursal">
          <div class="flex items-start justify-between gap-2">
            <div><div class="text-base font-semibold text-slate-900">${esc(b.sucursal)}</div>
              <div class="text-xs text-slate-500">${b.empleados} empleados · ${b.dias_laborables} días laborables</div></div>
            <div class="rounded-full px-2.5 py-1 text-sm font-bold ring-1 ${t.text} ${t.ring} ${t.bg}">${pct(b.puntualidad)}</div>
          </div>
          <div class="mt-4">${stackBar(b)}</div>
          <dl class="mt-4 grid grid-cols-3 gap-2 text-center">
            ${[['Retardos', b.retardos, 'text-amber-600'], ['Faltas', b.faltas, 'text-rose-600'], ['Asistencia', pct(b.asistencia), 'text-slate-900'],
               ['Checadas incompletas', b.incompletos + b.sin_salida, 'text-orange-600'], ['Se pasaron en la comida', b.excesos_comida, 'text-rose-600'], ['No checaron comida', b.comida_sin_checar, 'text-orange-600'],
               ['Justificados', b.justificados, 'text-sky-600'], ['Días extra', b.dias_extra, 'text-violet-600'], ['Tiempo extra al salir', b.dias_tiempo_extra, 'text-slate-700']]
              .map(([l, v, c]) => `<div class="rounded-lg bg-slate-50 py-2"><dd class="text-lg font-bold tabular-nums ${c}">${v}</dd><dt class="text-[11px] text-slate-500">${l}</dt></div>`).join('')}
          </dl>
          <div class="mt-3 text-xs text-slate-500">${b.minutos_retardo} min tarde en total · ${b.faltas_por_retardos ?? 0} falta(s) por juntar retardos</div>
        </button>`;
      }).join('')}
    </div>

    <div class="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
      ${['PUNTUAL', 'RETARDO', 'INCOMPLETO', 'JUSTIFICADO', 'FALTA', 'DÍA EXTRA', 'SIN DATOS'].map((e) => `<span class="inline-flex items-center gap-1.5">${badge(e)} ${ESTADOS[e].txt}</span>`).join('')}
    </div>

    <div class="card mb-6 overflow-hidden">
      <div class="border-b border-slate-100 px-5 py-4"><h2 class="card-title">Comparativo entre sucursales</h2></div>
      <div class="overflow-auto"><table class="tbl">
        <thead><tr><th>Sucursal</th><th class="num">Empleados</th><th class="w-56">Puntualidad</th><th class="num">Asistencia</th>
          <th class="num">Retardos</th><th class="num">Faltas</th>
          <th class="num">Checadas incompletas</th><th class="num">Se pasaron en la comida</th><th class="num">Se fueron antes</th><th class="num">Justificados</th><th class="num">Días extra</th></tr></thead>
        <tbody>${r.branches.map((b) => `<tr>
          <td class="font-medium text-slate-900">${esc(b.sucursal)}</td><td class="num">${b.empleados}</td>
          <td><div class="flex items-center gap-2"><div class="h-1.5 flex-1 rounded-full bg-slate-100"><div class="h-1.5 rounded-full ${b.puntualidad >= 90 ? 'bg-emerald-500' : b.puntualidad >= 75 ? 'bg-amber-400' : 'bg-rose-500'}" style="width:${b.puntualidad ?? 0}%"></div></div>
            <span class="w-12 text-right text-xs font-semibold tabular-nums">${pct(b.puntualidad)}</span></div></td>
          <td class="num">${pct(b.asistencia)}</td><td class="num">${b.retardos}<div class="text-[11px] text-slate-500">${b.minutos_retardo} min</div></td><td class="num">${b.faltas}</td>
          <td class="num">${b.incompletos + b.sin_salida}</td><td class="num">${b.excesos_comida}</td><td class="num">${b.salidas_anticipadas}</td><td class="num">${b.justificados}</td>
          <td class="num">${b.dias_extra}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      ${rankCard('Más retardos', topRet, (e) => e.retardos, (e) => `${e.minutos_retardo} min`, 'bg-amber-100 text-amber-800')}
      ${rankCard('Más faltas', topFal, (e) => e.faltas, (e) => (e.justificados ? `${e.justificados} justificados` : ''), 'bg-rose-100 text-rose-800')}
    </div>

    ${extras.length ? `<div class="card mt-6 overflow-hidden">
      <div class="border-b border-slate-100 px-5 py-4"><h2 class="card-title">Días extra: domingos y festivos laborados</h2>
        <p class="text-xs text-slate-500">Vigilancia, guardias o tiempo extra. Verifique que estén autorizados para su pago.</p></div>
      <div class="max-h-96 overflow-auto"><table class="tbl"><thead><tr><th>Fecha</th><th>Empleado</th><th>Sucursal</th><th>Entrada</th><th>Salida</th><th class="num">Horas</th></tr></thead>
      <tbody>${extras.map((d) => `<tr class="row-link" data-emp="${d.branch_id}|${esc(d.emp_code)}"><td>${d.dia} ${fmtDate(d.fecha)}</td>
        <td class="font-medium">${esc(d.nombre)}</td><td>${esc(d.sucursal)}</td><td>${d.entrada?.slice(0, 5) || '—'}</td><td>${d.salida?.slice(0, 5) || '—'}</td>
        <td class="num">${d.horas || '<span class="text-orange-600">incompleto</span>'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;

  $$('[data-pick-branch]').forEach((el) => el.addEventListener('click', async () => {
    $('#branch').value = el.dataset.pickBranch;
    await go('empleados');
  }));
  bindLinks($('#view'));
}

function ausentesNotice(r) {
  const fuera = (r.ausentes || []).filter((a) => a.excluido);
  const cuentan = (r.ausentes || []).filter((a) => !a.excluido);
  if (!fuera.length && !cuentan.length) return '';
  const lista = (l) => `<ul class="mt-2 divide-y divide-amber-200/70">${l.map((a) =>
    `<li class="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span><b>${esc(a.nombre)}</b> (${esc(a.sucursal)}, No. ${esc(a.emp_code)}): checó por última vez el ${fmtDate(a.ultima)} · ${a.dias} días de trabajo sin checar</span>
      <button class="btn btn-secondary btn-sm" data-baja="${a.branch_id}|${esc(a.emp_code)}|${a.ultima}" title="Ya no trabaja aquí: deja de contar faltas después del ${fmtDate(a.ultima)}">Dar de baja</button></li>`).join('')}</ul>`;
  return notice('warn', `<b>Posibles bajas: personas que dejaron de checar.</b> Si ya no trabajan aquí, pulse <b>Dar de baja</b> y dejarán de aparecer en los reportes.
    ${cuentan.length ? `<details class="mt-2"><summary class="cursor-pointer font-medium">${cuentan.length} dejaron de checar durante este periodo: sí se les cuentan faltas</summary>${lista(cuentan)}</details>` : ''}
    ${fuera.length ? `<details class="mt-2"><summary class="cursor-pointer font-medium">${fuera.length} no checaron en todo el periodo y ya tenían ${r.settings.dias_sin_checar}+ días sin venir: no se les cuentan faltas</summary>${lista(fuera)}</details>` : ''}`);
}

// ---------------------------------------------------------------- Nombres incompletos
// En el checador los nombres se abrevian a propósito (los nombres largos salen
// con símbolos raros). Aquí se registra el nombre completo solo en el sistema.
state.pendientes = [];

async function loadPendientes() {
  try {
    const antes = state.pendientes.length;
    state.pendientes = await api('/api/employees/pendientes');
    renderNav();
    return state.pendientes.length - antes;
  } catch {
    return 0;
  }
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'van', 'von']);

// ¿El nombre escrito corresponde a la abreviatura del checador?
// "Jrb" → "Juan Ramírez Bello" (iniciales en orden) · "Carolina" → "Carolina Pérez López".
function abreviaturaCoincide(abrev, completo) {
  const a = norm(abrev).replace(/[^a-z ]/g, '').trim();
  if (!a) return true;
  const palabras = norm(completo).replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w && !PARTICULAS.has(w));
  if (a.split(/\s+/).every((x) => palabras.includes(x))) return true;
  const letras = a.replace(/\s/g, '');
  let i = 0;
  for (const w of palabras) if (w[0] === letras[i]) i++;
  return i === letras.length;
}

function nombresNotice() {
  const n = state.pendientes.length;
  if (!n) return '';
  return notice('warn', `<b>Falta nombre completo por registrar (${n}).</b> En el checador estas personas solo tienen iniciales o no tienen apellido.
    Registre su nombre completo para que salga en los reportes (el checador no se modifica).
    <div class="mt-2"><button class="btn btn-primary btn-sm" data-nombres>Completar nombres</button></div>`);
}

const completarLink = (branchId, code) =>
  `<button class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200 print:hidden" data-nombres="${branchId}|${esc(code)}" title="En el checador el nombre está abreviado">Completar nombre</button>`;

async function openNamesWizard(startKey) {
  await loadPendientes();
  let lista = state.pendientes.slice();
  if (startKey) {
    const i = lista.findIndex((p) => `${p.branch_id}|${p.emp_code}` === startKey);
    if (i > 0) lista = [...lista.slice(i), ...lista.slice(0, i)];
  }
  if (!lista.length) return toast('No hay nombres pendientes. ¡Todo completo!');
  let pos = 0;
  let guardados = 0;
  const step = () => {
    if (pos >= lista.length) {
      $('#modal').close();
      toast(guardados ? `Listo: ${guardados} nombre(s) registrado(s)` : 'Sin cambios');
      loadPendientes();
      return refresh();
    }
    const p = lista[pos];
    openDialog('modal', `
      <div class="mb-4 flex items-start justify-between gap-4">
        <div><h2 class="text-lg font-bold text-slate-900">Completar nombres</h2>
          <p class="text-sm text-slate-500">Persona ${pos + 1} de ${lista.length} · el nombre solo se guarda en este sistema; el checador no se modifica.</p></div>${closeBtn}
      </div>
      <div class="mb-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div class="h-full bg-brand-700" style="width:${(pos / lista.length) * 100}%"></div></div>
      <div class="my-5 flex flex-wrap items-center gap-4 rounded-xl bg-slate-50 p-4">
        <div class="rounded-lg bg-amber-100 px-4 py-2 font-mono text-2xl font-bold text-amber-900">${esc(p.abreviado || 'sin nombre')}</div>
        <div class="text-sm text-slate-600"><div><b class="text-slate-900">${esc(p.sucursal)}</b> · No. de empleado <b class="text-slate-900">${esc(p.emp_code)}</b></div>
          <div>Checó del ${fmtDate(p.primera)} al ${fmtDate(p.ultima)} (${p.checadas} checadas)</div></div>
      </div>
      <label class="field">Nombre completo (nombre y apellidos)
        <input id="wzNombre" class="input text-base" autocomplete="off" placeholder="Ej. Juan Ramírez Bello"></label>
      <p id="wzCheck" class="mt-2 min-h-5 text-sm"></p>
      <div class="mt-5 flex flex-wrap items-center gap-2">
        <button class="btn btn-ghost btn-sm" id="wzExcluir" title="Cuentas como ADMIN o SISTEMAS: no se evalúan">No es una persona</button>
        <button class="btn btn-ghost btn-sm" id="wzBaja" title="Se da de baja con fecha de su última checada">Ya no trabaja aquí</button>
        <span class="flex-1"></span>
        <button class="btn btn-secondary" id="wzSaltar">Saltar</button>
        <button class="btn btn-primary" id="wzGuardar">Guardar y seguir</button>
      </div>`);
    const input = $('#wzNombre');
    const check = () => {
      const v = input.value.trim();
      const out = $('#wzCheck');
      if (!v) return (out.innerHTML = '');
      if (v.split(/\s+/).length < 2) return (out.innerHTML = '<span class="text-slate-500">Escriba nombre y apellido.</span>');
      out.innerHTML = abreviaturaCoincide(p.abreviado, v)
        ? `<span class="text-emerald-700">✔ Coincide con «${esc(p.abreviado)}».</span>`
        : `<span class="text-amber-700">⚠ Las iniciales no coinciden con «${esc(p.abreviado)}». Revise que sea la persona correcta.</span>`;
    };
    input.addEventListener('input', check);
    input.addEventListener('keydown', (ev) => ev.key === 'Enter' && $('#wzGuardar').click());
    input.focus();
    const next = () => {
      pos++;
      step();
    };
    const url = (accion) => `/api/employees/${p.branch_id}/${encodeURIComponent(p.emp_code)}/${accion}`;
    $('#wzSaltar').addEventListener('click', next);
    $('#wzGuardar').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      const v = input.value.trim();
      if (p.abreviado && v.split(/\s+/).length >= 2 && !abreviaturaCoincide(p.abreviado, v) &&
          !confirm(`«${v}» no coincide con las iniciales «${p.abreviado}». ¿Guardar de todos modos?`)) return;
      await api(url('nombre'), { method: 'POST', body: { alias: v } });
      guardados++;
      next();
    }));
    $('#wzExcluir').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      if (!confirm(`¿«${p.abreviado || p.emp_code}» no es una persona (por ejemplo, una cuenta de administración)? Dejará de aparecer en los reportes. Se puede revertir en Configuración → Empleados.`)) return;
      await api(url('excluir'), { method: 'POST', body: { excluir: true } });
      next();
    }));
    $('#wzBaja').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      if (!confirm(`¿Dar de baja con fecha ${fmtDate(p.ultima)} (su última checada)?`)) return;
      await api(url('baja'), { method: 'POST', body: { fecha_baja: p.ultima } });
      next();
    }));
  };
  step();
}

function sinNombreNotice(r) {
  return nombresNotice();
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function rankCard(title, list, val, extra, chip) {
  return `<div class="card overflow-hidden">
    <div class="border-b border-slate-100 px-5 py-4"><h2 class="card-title">${title}</h2></div>
    ${list.length ? `<ul class="divide-y divide-slate-100">${list.map((e, i) => `
      <li class="row-link flex items-center gap-3 px-5 py-2.5" data-emp="${e.branch_id}|${esc(e.emp_code)}">
        <span class="w-4 text-xs font-semibold text-slate-400">${i + 1}</span>
        <span class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">${esc(initials(e.nombre))}</span>
        <div class="min-w-0 flex-1"><div class="text-sm font-medium break-words text-slate-900">${esc(e.nombre)}${e.nombre_incompleto ? completarLink(e.branch_id, e.emp_code) : ''}</div>
          <div class="text-xs text-slate-500">${esc(e.sucursal)}</div></div>
        <span class="shrink-0 text-xs whitespace-nowrap text-slate-500">${esc(extra(e))}</span>
        <span class="min-w-8 shrink-0 rounded-full px-2 py-0.5 text-center text-sm font-bold ${chip}">${val(e)}</span>
      </li>`).join('')}</ul>` : '<p class="px-5 py-8 text-center text-sm text-slate-500">Ninguno en el periodo 🎉</p>'}
  </div>`;
}

function bindLinks(root) {
  $$('[data-emp]', root).forEach((el) => el.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;
    const [b, c] = el.dataset.emp.split('|');
    showEmployee(Number(b), c);
  }));
  $$('[data-emp-link]', root).forEach((b) => b.addEventListener('click', () => {
    const [br, code] = b.dataset.empLink.split('|');
    showEmployee(Number(br), code);
  }));
  $$('[data-goto]', root).forEach((el) => el.addEventListener('click', () => go(el.dataset.goto)));
  $$('[data-justify]', root).forEach((b) => b.addEventListener('click', () => {
    const [br, code, fecha] = b.dataset.justify.split('|');
    showJustify(Number(br), code, fecha);
  }));
  $$('[data-nombres]', root).forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if ($('#drawer').open) $('#drawer').close();
    openNamesWizard(b.dataset.nombres || undefined);
  }));
  $$('[data-baja]', root).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const [br, code, fecha] = b.dataset.baja.split('|');
    if (!confirm(`¿Dar de baja con fecha ${fmtDate(fecha)}? Después de ese día ya no se le contarán faltas. Se puede revertir en Configuración → Empleados.`)) return;
    await api(`/api/employees/${br}/${encodeURIComponent(code)}/baja`, { method: 'POST', body: { fecha_baja: fecha } });
    toast('Baja registrada');
    loadPendientes();
    await refresh();
  })));
}

// ---------------------------------------------------------------- Empleados
const EMP_COLS = [
  ['nombre', 'Empleado'], ['puntualidad', 'Puntualidad', 1], ['asistencias', 'Asistió', 1], ['retardos', 'Retardos', 1],
  ['faltas', 'Faltas', 1], ['incompletas', 'Checadas incompletas', 1],
  ['excesos_comida', 'Se pasó en la comida', 1], ['comida_sin_checar', 'No checó comida', 1], ['salidas_anticipadas', 'Se fue antes', 1],
  ['dias_tiempo_extra', 'Tiempo extra', 1], ['justificados', 'Justificados', 1], ['dias_extra', 'Días extra', 1],
];

const matches = (q, ...fields) => !q || fields.join(' ').toLowerCase().includes(q);

function viewEmpleados() {
  const r = state.report;
  if (!r.days.length) return ($('#view').innerHTML = pageHeader('Empleados', periodText()) + noData());
  const q = state.search.toLowerCase();
  const { key, dir } = state.sort;
  const list = r.employees
    .map((e) => ({ ...e, incompletas: e.incompletos + e.sin_salida }))
    .filter((e) => matches(q, e.nombre, e.emp_code))
    .sort((a, b) => {
      const x = a[key] ?? -1, y = b[key] ?? -1;
      return (typeof x === 'string' ? x.localeCompare(y, 'es') : x - y) * dir;
    });
  const hl = { retardos: 'text-amber-700', faltas: 'text-rose-700', faltas_por_retardos: 'text-rose-700', dias_extra: 'text-violet-700' };
  const cell = (e, k) => {
    if (k === 'nombre') return `<div class="flex items-center gap-3"><span class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">${esc(initials(e.nombre))}</span>
      <div><div class="font-medium text-slate-900">${esc(e.nombre)}${e.nombre_incompleto ? completarLink(e.branch_id, e.emp_code) : ''}</div><div class="text-xs text-slate-500">${esc(e.sucursal)} · ${esc(e.emp_code)}</div></div></div>`;
    if (k === 'puntualidad') return `<span class="font-semibold ${tone(e.puntualidad).text}">${pct(e.puntualidad)}</span>`;
    if (k === 'faltas' && (e.faltas || e.faltas_por_retardos)) return `<span class="font-semibold text-rose-700">${e.faltas}</span>${e.faltas_por_retardos ? `<div class="text-[11px] text-rose-700">+${e.faltas_por_retardos} por retardos</div>` : ''}`;
    if (k === 'asistencias') return `${e.asistencias}<span class="text-slate-400">/${e.dias_laborables}</span>`;
    if (k === 'retardos' && e.retardos) return `<span class="font-semibold text-amber-700">${e.retardos}</span><div class="text-[11px] text-slate-500">${e.minutos_retardo} min</div>`;
    const v = e[k] ?? 0;
    return v ? `<span class="${hl[k] ? `font-semibold ${hl[k]}` : ''}">${v}</span>` : '<span class="text-slate-300">0</span>';
  };
  $('#view').innerHTML = `
    ${pageHeader('Empleados', periodText())}
    <p class="mb-3 text-sm text-slate-500">${list.length} empleado(s)${q ? ` que coinciden con "${esc(state.search)}"` : ''}. Haga clic en un renglón para ver sus checadas día por día; en los encabezados para ordenar.</p>
    <div class="card overflow-hidden"><div class="max-h-[70vh] overflow-auto"><table class="tbl">
      <thead><tr>${EMP_COLS.map(([k, l, n]) => `<th class="cursor-pointer select-none hover:text-slate-800 ${n ? 'num' : ''}" data-sort="${k}">${l}${key === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
      <tbody>${list.map((e) => `<tr class="row-link" data-emp="${e.branch_id}|${esc(e.emp_code)}">
        ${EMP_COLS.map(([k, , n]) => `<td class="${n ? 'num' : ''}">${cell(e, k)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>`;
  $$('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : k === 'nombre' ? 1 : -1 };
    viewEmpleados();
  }));
  bindLinks($('#view'));
}

// ---------------------------------------------------------------- Detalle diario
function justBox(j) {
  if (!j) return '';
  const quien = `<span class="opacity-75">— ${esc(j.autor)}, ${esc(j.creado)}</span>`;
  return j.justificado
    ? `<div class="mt-1.5 rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-800">✔ Justificado · <b>${esc(j.tipo)}</b>${j.hora_permiso ? ` (permiso hasta las ${esc(j.hora_permiso)})` : ''}: ${esc(j.nota)} ${quien}</div>`
    : `<div class="mt-1.5 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-800">✖ <b>No justificado</b>: ${esc(j.nota)} ${quien}</div>`;
}

function dayRow(d, withEmployee = true) {
  const checadas = d.checadas.length
    ? d.checadas.map((t) => (d.duplicadas.includes(t)
        ? `<span class="text-slate-400 line-through" title="Checada repetida: no se tomó en cuenta">${t.slice(0, 5)}</span>`
        : `<span class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">${t.slice(0, 5)}</span>`)).join(' ')
    : '<span class="text-slate-400">sin checadas</span>';
  const canJustify =
    !['DESCANSO', 'FESTIVO', 'PENDIENTE', 'PUNTUAL', 'DÍA EXTRA'].includes(d.estado) || (d.estado === 'PUNTUAL' && d.incidencias.length > 0);
  const comida = d.comida_salida
    ? `${d.comida_salida.slice(0, 5)}–${d.comida_regreso?.slice(0, 5) || '?'}${d.comida_min != null
        ? `<div class="text-xs ${d.exceso_comida_min ? 'font-semibold text-rose-700' : 'text-slate-500'}">${d.comida_min} min</div>` : ''}`
    : '—';
  return `<tr class="hover:bg-slate-50/70">
    <td class="whitespace-nowrap"><div class="font-medium text-slate-900">${fmtDate(d.fecha)}</div><div class="text-xs text-slate-500">${d.dia}</div></td>
    ${withEmployee ? `<td><button class="text-left font-medium text-brand-700 hover:underline" data-emp-link="${d.branch_id}|${esc(d.emp_code)}">${esc(d.nombre)}</button>${d.nombre_incompleto ? completarLink(d.branch_id, d.emp_code) : ''}
      <div class="text-xs text-slate-500">${esc(d.sucursal)} · ${esc(d.emp_code)}</div></td>` : ''}
    <td><div class="whitespace-nowrap">${esc(d.horario)}</div></td>
    <td class="tabular-nums">${d.entrada?.slice(0, 5) || '—'}</td>
    <td class="whitespace-nowrap tabular-nums">${comida}</td>
    <td class="tabular-nums">${d.salida?.slice(0, 5) || '—'}</td>
    <td class="tabular-nums">${d.horas || '—'}</td>
    <td><div class="flex flex-wrap items-center gap-1">${badge(d.estado)}${d.retardo_min ? `<span class="text-xs font-bold text-amber-700">+${d.retardo_min} min</span>` : ''}</div>
      ${d.estado_original ? `<div class="mt-1 text-[11px] text-slate-500">antes era: ${esc(d.estado_original)}</div>` : ''}
      ${d.incidencias.map((i) => `<div class="mt-1 text-[11px] font-medium text-orange-700">${esc(i)}</div>`).join('')}
      ${canJustify || d.justificacion ? `<button class="btn btn-secondary btn-sm mt-2 print:hidden" data-justify="${d.branch_id}|${esc(d.emp_code)}|${d.fecha}">${d.justificacion ? 'Editar nota' : 'Justificar o anotar'}</button>` : ''}</td>
    <td class="min-w-48"><div class="flex flex-wrap gap-1 font-mono text-xs">${checadas}</div>
      <div class="mt-1.5 text-xs text-slate-500">${esc(d.regla)}${d.notas.length ? ` · ${esc(d.notas.join(' · '))}` : ''}</div>
      ${justBox(d.justificacion)}</td>
  </tr>`;
}

const dayHead = (withEmployee = true) => `<thead><tr><th>Fecha</th>${withEmployee ? '<th>Empleado</th>' : ''}<th>Horario</th><th>Entrada</th><th>Comida</th><th>Salida</th><th>Horas trabajadas</th>
  <th>Resultado</th><th>Checadas del día y explicación</th></tr></thead>`;

// Descanso, festivo y pendiente no requieren revisión: no se ofrecen como filtro.
const FILTROS_DETALLE = ['RETARDO', 'FALTA', 'INCOMPLETO', 'JUSTIFICADO', 'DÍA EXTRA', 'SIN DATOS', 'PUNTUAL'];

function viewDetalle() {
  const r = state.report;
  if (!r.days.length) return ($('#view').innerHTML = pageHeader('Detalle diario', periodText()) + noData());
  const counts = Object.fromEntries(FILTROS_DETALLE.map((e) => [e, r.days.filter((d) => d.estado === e).length]));
  const q = state.search.toLowerCase();
  const list = r.days.filter((d) => state.estadoFilter.has(d.estado) && matches(q, d.nombre, d.emp_code));
  const shown = list.slice(0, 1500);
  $('#view').innerHTML = `
    ${pageHeader('Detalle diario', periodText() + (q ? ` · "${esc(state.search)}"` : ''))}
    <div class="mb-4 flex flex-wrap gap-2 print:hidden">
      <span class="self-center text-xs text-slate-500">Mostrar:</span>
      ${FILTROS_DETALLE.map((e) => `<button class="chip ${state.estadoFilter.has(e) ? 'on' : ''}" data-estado="${e}">${e}
        <span class="rounded-full px-1.5 text-[10px] ${state.estadoFilter.has(e) ? 'bg-white/20' : 'bg-slate-100'}">${counts[e]}</span></button>`).join('')}
    </div>
    <p class="mb-3 text-sm text-slate-500">${list.length} registro(s)${list.length > shown.length ? ` — se muestran los primeros ${shown.length}; filtre por sucursal o empleado, o exporte a Excel para ver todo` : ''}.</p>
    <div class="card overflow-hidden"><div class="max-h-[72vh] overflow-auto"><table class="tbl">${dayHead()}<tbody>${shown.map((d) => dayRow(d)).join('')}</tbody></table></div></div>`;
  $$('[data-estado]').forEach((b) => b.addEventListener('click', () => {
    const e = b.dataset.estado;
    state.estadoFilter.has(e) ? state.estadoFilter.delete(e) : state.estadoFilter.add(e);
    viewDetalle();
  }));
  bindLinks($('#view'));
}

// ---------------------------------------------------------------- Ficha de empleado y justificación
function showEmployee(branchId, code) {
  const r = state.report;
  const s = r.employees.find((e) => e.branch_id === branchId && e.emp_code === code);
  if (!s) return;
  const days = r.days.filter((d) => d.branch_id === branchId && d.emp_code === code);
  openDialog('drawer', `
    <div class="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
      <div class="flex items-center gap-4">
        <span class="grid size-12 place-items-center rounded-full bg-brand-700 text-base font-bold text-white">${esc(initials(s.nombre))}</span>
        <div><h2 class="text-xl font-bold text-slate-900">${esc(s.nombre)}${s.nombre_incompleto ? completarLink(s.branch_id, code) : ''}</h2>
          <p class="text-sm text-slate-500">${esc(s.sucursal)} · código ${esc(code)} · ${fmtDate(r.from)} al ${fmtDate(r.to)}</p></div>
      </div>${closeBtn}
    </div>
    <div class="space-y-6 p-6">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        ${[['Puntualidad', pct(s.puntualidad), tone(s.puntualidad).text], ['Retardos', s.retardos, 'text-amber-600', `${s.minutos_retardo} min`], ['Faltas', s.faltas, 'text-rose-600'],
           ['Faltas por retardos', s.faltas_por_retardos ?? 0, 'text-rose-600'], ['Checadas incompletas', s.incompletos + s.sin_salida, 'text-orange-600'],
           ['Se pasó en la comida', s.excesos_comida, 'text-rose-600', s.minutos_exceso_comida ? `${s.minutos_exceso_comida} min de más` : ''], ['No checó comida', s.comida_sin_checar, 'text-orange-600'],
           ['Justificados', s.justificados, 'text-sky-600'], ['Días extra', s.dias_extra, 'text-violet-600', s.minutos_extra ? hrs(s.minutos_extra) : '']]
          .map(([l, v, c, sub]) => `<div class="rounded-xl border border-slate-200 bg-white p-3"><div class="text-[11px] text-slate-500">${l}</div>
            <div class="text-xl font-bold tabular-nums ${c}">${v}</div>${sub ? `<div class="text-[11px] text-slate-500">${sub}</div>` : ''}</div>`).join('')}
      </div>
      <div>${stackBar(s, 'h-2.5')}</div>
      <div class="card overflow-hidden"><div class="overflow-auto"><table class="tbl">${dayHead(false)}<tbody>${days.map((d) => dayRow(d, false)).join('')}</tbody></table></div></div>
    </div>`);
  bindLinks($('#drawerBody'));
}

async function showJustify(branchId, code, fecha) {
  const d = state.report.days.find((x) => x.branch_id === branchId && x.emp_code === code && x.fecha === fecha);
  const { tipos } = await api(`/api/justifications?from=${fecha}&to=${fecha}`);
  const j = d.justificacion;
  const original = (d.estado_original || d.estado).toLowerCase();
  const esRetardo = (d.estado_original || d.estado) === 'RETARDO' || !!j?.hora_permiso;
  const justificado = j ? j.justificado : true;
  const opt = (val, title, text) => `<label class="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-checked:border-brand-700 has-checked:bg-brand-50">
      <input type="radio" name="jSi" value="${val}" class="mt-1 accent-brand-700" ${String(justificado) === val ? 'checked' : ''}>
      <span><b class="text-sm text-slate-900">${title}</b><span class="block text-xs text-slate-500">${text}</span></span></label>`;
  openDialog('modal', `
    <div class="mb-5 flex items-start justify-between gap-4">
      <div><h2 class="text-lg font-bold text-slate-900">Revisar ${esc(original)}</h2>
        <p class="text-sm text-slate-500">${esc(d.nombre)} · ${esc(d.sucursal)} · ${d.dia} ${fmtDate(fecha)}</p></div>${closeBtn}
    </div>
    <div class="mb-5 rounded-xl bg-slate-50 p-4 text-sm">
      <div class="mb-1 text-xs font-medium text-slate-500 uppercase">Checadas registradas</div>
      <div class="font-mono">${d.checadas.map((t) => t.slice(0, 5)).join(' · ') || 'ninguna'}</div>
      <div class="mt-2 text-xs text-slate-500">${esc(d.regla)}</div>
    </div>
    <div class="mb-4 grid gap-3 sm:grid-cols-2">
      ${opt('true', 'Justificado', 'Tenía permiso, incapacidad, etc. No cuenta en su contra.')}
      ${opt('false', 'No justificado', 'Sigue contando, pero queda anotado el porqué.')}
    </div>
    <div class="grid gap-4 sm:grid-cols-3">
      <label class="field" id="jTipoBox">Tipo <select id="jTipo" class="input">${tipos.map((t) => `<option ${j && j.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="field sm:col-span-2">¿Por qué? <input id="jNota" class="input" value="${esc(j?.nota || '')}" placeholder="Ej. Cita médica, avisó al gerente un día antes"></label>
      ${esRetardo ? `<label class="field sm:col-span-3" id="jHoraBox">Tenía permiso para llegar hasta las… (opcional)
        <input type="time" id="jHora" class="input sm:w-48" value="${esc(j?.hora_permiso || '')}">
        <span class="font-normal">Si llega después de esa hora (más la tolerancia), sigue contando como retardo desde esa hora.</span></label>` : ''}
      ${j ? '' : `<label class="field sm:col-span-3" id="jHastaBox">¿Son varios días? Aplicar también hasta el… (opcional)
        <input type="date" id="jHasta" class="input sm:w-48" min="${fecha}">
        <span class="font-normal">Útil para vacaciones o incapacidades: se guarda la misma justificación en cada día.</span></label>`}
    </div>
    <p class="mt-4 text-xs text-slate-500">Quedará registrado a nombre de <b class="text-slate-700">${esc(usuario() || '(escriba su nombre en el campo Usuario)')}</b> en el historial de cambios.</p>
    <div class="mt-6 flex flex-wrap justify-end gap-2">
      ${j ? '<button class="btn btn-danger sm:mr-auto" id="jDel">Borrar nota</button>' : ''}
      <button class="btn btn-secondary" data-close>Cancelar</button>
      <button class="btn btn-primary" id="jSave">Guardar</button>
    </div>`);
  const sync = () => {
    const si = $('[name=jSi]:checked').value === 'true';
    $('#jTipoBox').classList.toggle('hidden', !si);
    $('#jHoraBox')?.classList.toggle('hidden', !si);
  };
  $$('[name=jSi]').forEach((r) => r.addEventListener('change', sync));
  sync();
  $('#jNota').focus();
  $('#jSave').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const si = $('[name=jSi]:checked').value === 'true';
    await api('/api/justifications', { method: 'POST', body: {
      branch_id: branchId, emp_code: code, fecha, justificado: si, tipo: $('#jTipo').value, nota: $('#jNota').value,
      hora_permiso: si && $('#jHora') ? $('#jHora').value : '',
      hasta: $('#jHasta')?.value || '',
    } });
    await afterJustify(si ? 'Justificación guardada' : 'Nota guardada', branchId, code);
  }));
  $('#jDel')?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    if (!confirm('¿Borrar la nota? El día volverá a como lo marcó el checador.')) return;
    await api(`/api/justifications/${j.id}`, { method: 'DELETE' });
    await afterJustify('Nota borrada', branchId, code);
  }));
}

async function afterJustify(msg, branchId, code) {
  const drawerOpen = $('#drawer').open;
  $('#modal').close();
  toast(msg);
  await refresh();
  if (drawerOpen) showEmployee(branchId, code);
}

// ---------------------------------------------------------------- Datos
function viewDatos() {
  const f = $('#from').value, t = $('#to').value;
  const when = (v) => (v ? `${fmtDate(v.slice(0, 10))} ${v.slice(11, 16)}` : '—');
  $('#view').innerHTML = `
    ${pageHeader('Cargar checadas', 'Traiga las checadas de los relojes checadores. Si una checada ya estaba cargada, no se duplica.')}
    <div class="card mb-6 overflow-hidden">
      <div class="border-b border-slate-100 px-5 py-4"><h2 class="card-title">Checadas que ya están en el sistema</h2></div>
      <div class="overflow-auto"><table class="tbl"><thead><tr><th>Sucursal</th><th>Desde</th><th>Hasta</th><th class="num">Total de checadas</th><th>Última actualización</th></tr></thead>
      <tbody>${state.branches.map((b) => `<tr><td class="font-medium text-slate-900">${esc(b.code)} ${esc(b.name)}${b.enabled ? '' : ' <span class="badge bg-slate-100 text-slate-500 ring-slate-300/40">no incluida en reportes</span>'}</td>
        <td class="whitespace-nowrap">${when(b.cobertura?.desde)}</td><td class="whitespace-nowrap">${when(b.cobertura?.hasta)}</td>
        <td class="num">${(b.cobertura?.total ?? 0).toLocaleString('es-MX')}</td>
        <td class="whitespace-nowrap">${b.last_sync ? when(b.last_sync) : '<span class="text-slate-400">nunca</span>'}</td></tr>`).join('')}</tbody></table></div>
    </div>

    <div class="grid gap-6 xl:grid-cols-2">
      <div class="card card-pad">
        <div class="mb-1 flex items-center gap-2"><span class="grid size-6 place-items-center rounded-full bg-brand-700 text-xs font-bold text-white">1</span>
          <h2 class="card-title">Traer directo de los checadores <span class="font-normal text-slate-500">(recomendado)</span></h2></div>
        <p class="mb-4 text-sm text-slate-500">Trae las checadas de las sucursales del <b>${fmtDate(f)}</b> al <b>${fmtDate(t)}</b>.
          Para cambiar las fechas use el periodo de arriba.</p>
        <button id="syncHere" class="btn btn-primary">Traer checadas</button>
        <div id="syncResult" class="mt-4"></div>
      </div>

      <div class="card card-pad">
        <div class="mb-1 flex items-center gap-2"><span class="grid size-6 place-items-center rounded-full bg-slate-400 text-xs font-bold text-white">2</span>
          <h2 class="card-title">Subir un archivo de Excel</h2></div>
        <p class="mb-4 text-sm text-slate-500">Úselo solo si no se pudieron traer directo. Pida al área de sistemas el archivo de checadas
          (Excel o CSV) y súbalo aquí.</p>
        <label class="field mb-3">Sucursal del archivo <select id="impBranch" class="input"><option value="">El archivo ya indica la sucursal</option>
          ${state.branches.map((b) => `<option value="${b.id}">${esc(b.code)} ${esc(b.name)}</option>`).join('')}</select></label>
        <label id="drop" class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 transition hover:border-brand-500 hover:bg-brand-50/50">
          ${icon('upload', 'size-7 text-slate-400')}
          <span id="dropText"><b class="text-brand-700">Elija un archivo</b> o arrástrelo aquí (Excel o CSV)</span>
          <input type="file" id="impFile" accept=".csv,.txt,.xlsx" class="sr-only">
        </label>
        <div id="impResult" class="mt-4"></div>
      </div>
    </div>`;
  $('#syncHere').addEventListener('click', (ev) => doSync(ev.currentTarget, $('#syncResult')));

  const dropIdle = '<b class="text-brand-700">Elija un archivo</b> o arrástrelo aquí (Excel o CSV)';
  const upload = async (file) => {
    $('#dropText').innerHTML = `<span class="spinner"></span> Subiendo <b>${esc(file.name)}</b>…`;
    try {
      const b = $('#impBranch').value;
      const r = await api(`/api/import${b ? `?branch=${b}` : ''}`, {
        method: 'POST', body: await file.arrayBuffer(), headers: { 'x-filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
      });
      $('#impResult').innerHTML = resultList(r.results.map((x) => ({ ok: true, title: x.sucursal, text: `${x.leidos} checadas en el archivo, ${x.nuevos} nuevas` })))
        + (r.total_errores ? `<div class="mt-3">${notice('warn', `${r.total_errores} renglón(es) del archivo no se pudieron leer:<br>${r.errores.map(esc).join('<br>')}`)}</div>` : '');
      await loadBranches();
      toast('Archivo cargado');
      loadPendientes();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      $('#dropText').innerHTML = dropIdle;
      $('#impFile').value = '';
    }
  };
  $('#impFile').addEventListener('change', (ev) => ev.target.files[0] && upload(ev.target.files[0]));
  const drop = $('#drop');
  const hot = ['border-brand-500', 'bg-brand-50'];
  drop.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    drop.classList.add(...hot);
  });
  drop.addEventListener('dragleave', () => drop.classList.remove(...hot));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    drop.classList.remove(...hot);
    if (ev.dataTransfer.files[0]) upload(ev.dataTransfer.files[0]);
  });
}

function resultList(items) {
  return `<ul class="space-y-2">${items.map((x) => `<li class="flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${x.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}">
    <span class="font-bold">${x.ok ? '✔' : '✖'}</span><div><b>${esc(x.title)}</b>: ${esc(x.text)}</div></li>`).join('')}</ul>`;
}

async function doSync(btn, out) {
  await busy(btn, async () => {
    const r = await api('/api/sync', { method: 'POST', body: { from: $('#from').value, to: $('#to').value, branch: $('#branch').value } });
    const items = r.results.map((x) => ({ ok: x.ok, title: x.sucursal, text: x.ok ? `${x.leidos} checadas encontradas, ${x.nuevos} nuevas` : x.error }));
    if (out) out.innerHTML = resultList(items);
    const failed = items.filter((x) => !x.ok);
    if (failed.length) toast(failed.map((x) => `${x.title}: ${x.text}`).join('\n'), 'error');
    if (failed.length < items.length) toast(`Checadas actualizadas (${items.length - failed.length} sucursal(es))`);
    await loadBranches();
    const nuevos = await loadPendientes();
    if (nuevos > 0) toast(`Hay ${nuevos} nombre(s) abreviado(s) nuevo(s) por completar (aviso en el Panel)`);
    if (state.view !== 'datos') await refresh();
  });
}

// ---------------------------------------------------------------- Configuración
function schedTable(prefix, week) {
  return `<div class="overflow-x-auto"><table class="w-full min-w-[22rem] text-sm"><thead><tr class="text-[11px] tracking-wide text-slate-500 uppercase">
      <th class="py-1.5 text-left font-semibold">Día</th><th class="py-1.5 font-semibold">Labora</th><th class="py-1.5 text-left font-semibold">Entrada</th><th class="py-1.5 text-left font-semibold">Salida</th><th class="py-1.5 font-semibold" title="Checa salida y regreso de comida">Comida</th></tr></thead><tbody>
    ${week.map((d, i) => `<tr class="border-t border-slate-100">
      <td class="py-1.5 pr-2 ${i === 0 ? 'text-violet-700' : ''}">${DIAS[i]}</td>
      <td class="py-1.5 text-center"><input type="checkbox" class="checkbox" name="${prefix}-lab-${i}" ${d.laborable ? 'checked' : ''}></td>
      <td class="py-1.5 pr-2"><input type="time" class="input px-2 py-1" name="${prefix}-ent-${i}" value="${d.entrada}"></td>
      <td class="py-1.5 pr-2"><input type="time" class="input px-2 py-1" name="${prefix}-sal-${i}" value="${d.salida}"></td>
      <td class="py-1.5 text-center"><input type="checkbox" class="checkbox" name="${prefix}-com-${i}" ${hasLunch(d) ? 'checked' : ''}></td></tr>`).join('')}
  </tbody></table></div>`;
}
// Igual que el motor: si el horario no lo dice, hay comida en jornadas de más de 7 horas.
function hasLunch(d) {
  if (d.comida != null) return d.comida;
  const min = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return min(d.salida) - min(d.entrada) > 7 * 60;
}
function readSched(root, prefix) {
  return DIAS.map((_, i) => ({
    laborable: $(`[name=${prefix}-lab-${i}]`, root).checked,
    entrada: $(`[name=${prefix}-ent-${i}]`, root).value || '08:30',
    salida: $(`[name=${prefix}-sal-${i}]`, root).value || '18:00',
    comida: $(`[name=${prefix}-com-${i}]`, root).checked,
  }));
}

// Días de descanso obligatorio (art. 74 LFT).
function feriadosLFT(y) {
  const nthMonday = (m, n) => {
    const d = new Date(y, m, 1);
    const first = 1 + ((8 - d.getDay()) % 7);
    return iso(new Date(y, m, first + 7 * (n - 1)));
  };
  const list = [
    [`${y}-01-01`, 'Año Nuevo'],
    [nthMonday(1, 1), 'Día de la Constitución'],
    [nthMonday(2, 3), 'Natalicio de Benito Juárez'],
    [`${y}-05-01`, 'Día del Trabajo'],
    [`${y}-09-16`, 'Día de la Independencia'],
    [nthMonday(10, 3), 'Día de la Revolución'],
    [`${y}-12-25`, 'Navidad'],
  ];
  if ((y - 2024) % 6 === 0) list.push([`${y}-10-01`, 'Transmisión del Poder Ejecutivo Federal']);
  return list;
}

const section = (title, desc, body) => `<div class="card card-pad mb-6">
  <h2 class="text-base font-semibold text-slate-900">${title}</h2>${desc ? `<p class="mt-1 mb-4 text-sm text-slate-500">${desc}</p>` : '<div class="mb-4"></div>'}${body}</div>`;

async function viewConfig() {
  const [s, holidays, employees] = await Promise.all([api('/api/settings'), api('/api/holidays'), api('/api/employees')]);
  const bName = Object.fromEntries(state.branches.map((b) => [b.id, `${b.code} ${b.name}`]));
  const inp = (name, label, val, type = 'text', extra = '') =>
    `<label class="field">${label}<input class="input" name="${name}" type="${type}" value="${esc(val)}" ${extra}></label>`;

  $('#view').innerHTML = `
    ${pageHeader('Configuración', 'Horarios, reglas de puntualidad, días festivos y empleados.')}

    ${section('Reglas de puntualidad', 'Se aplican a todas las sucursales.',
      `<div id="ruleForm" class="space-y-5">
        <div><h3 class="mb-2 text-sm font-semibold text-slate-700">Llegada</h3>
          <div class="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${inp('tolerancia_min', 'Minutos de tolerancia al llegar', s.tolerancia_min, 'number', 'min="0"')}
            ${inp('retardos_por_falta', 'Cada cuántos retardos se cuenta 1 falta (0 = nunca)', s.retardos_por_falta, 'number', 'min="0"')}
            ${inp('retardo_falta_min', 'Si llega más de estos minutos tarde, cuenta como falta (0 = nunca)', s.retardo_falta_min, 'number', 'min="0"')}
            <label class="field">Los minutos de retardo se cuentan desde…
              <select class="input" name="retardo_desde">
                <option value="entrada" ${s.retardo_desde !== 'tolerancia' ? 'selected' : ''}>La hora de entrada (8:41 = 11 min de retardo)</option>
                <option value="tolerancia" ${s.retardo_desde === 'tolerancia' ? 'selected' : ''}>Que termina la tolerancia (8:41 = 1 min de retardo)</option>
              </select></label>
          </div></div>
        <div><h3 class="mb-2 text-sm font-semibold text-slate-700">Checadas repetidas</h3>
          <div class="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${inp('duplicado_min', 'Si vuelve a checar antes de estos minutos, solo cuenta la primera', s.duplicado_min, 'number', 'min="0"')}
          </div></div>
        <div><h3 class="mb-2 text-sm font-semibold text-slate-700">Comida</h3>
          <div class="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${inp('comida_min', 'Minutos de comida permitidos', s.comida_min, 'number', 'min="0"')}
            ${inp('comida_tolerancia_min', 'Minutos de tolerancia al regresar de comer', s.comida_tolerancia_min, 'number', 'min="0"')}
            ${inp('comida_desde', 'De lunes a viernes, salir a comer a partir de las', s.comida_desde, 'time')}
          </div></div>
        <div><h3 class="mb-2 text-sm font-semibold text-slate-700">Salida</h3>
          <div class="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${inp('salida_anticipada_min', 'Minutos antes de la hora de salida para marcar "se fue antes"', s.salida_anticipada_min, 'number', 'min="0"')}
            ${inp('extra_min', 'Si se queda estos minutos o más después de su salida, marcar tiempo extra (0 = no)', s.extra_min, 'number', 'min="0"')}
          </div></div>
        <button id="saveRules" class="btn btn-primary">Guardar reglas</button></div>`)}

    <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div class="max-w-3xl"><h2 class="text-base font-semibold text-slate-900">Horarios por sucursal</h2>
        <p class="text-sm text-slate-500">El domingo no es día de trabajo: quien cheque ese día aparece como <b>día extra</b>.
        Si alguien trabaja todos los domingos (por ejemplo vigilancia), dele un horario especial en la sección Empleados, más abajo.</p></div>
      <button id="copyAll" class="btn btn-secondary btn-sm">Usar el horario de ${esc(state.branches[0]?.name || '')} en todas</button>
    </div>
    <div class="mb-6 grid gap-4 xl:grid-cols-2">${state.branches.map((b) => `
      <div class="card card-pad" data-branch="${b.id}">
        <div class="mb-3 flex items-center justify-between gap-2"><h3 class="font-semibold text-slate-900">${esc(b.code)} ${esc(b.name)}</h3>
          <label class="flex items-center gap-1.5 text-xs text-slate-600" title="Si la desactiva, no aparece en los reportes"><input type="checkbox" class="checkbox" name="enabled" ${b.enabled ? 'checked' : ''}> Incluir en reportes</label></div>
        <label class="field mb-3">Minutos de tolerancia (solo si son diferentes a la regla general)
          <input class="input" name="tolerancia_min" type="number" min="0" value="${b.tolerancia_min ?? ''}" placeholder="Igual que la regla general (${s.tolerancia_min} min)"></label>
        ${schedTable('b' + b.id, b.schedule)}
        <div class="mt-4"><button class="btn btn-primary btn-sm" data-save-branch>Guardar horario</button></div>
      </div>`).join('')}</div>

    ${section('Actualización automática (en vivo)', 'Mientras el sistema esté abierto, trae solo las checadas del día en los horarios en que la gente checa. Fuera de esos horarios no consulta, para no saturar el servidor de los checadores. El plan se calcula con los horarios de las sucursales.',
      `<label class="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox" id="autoSync" ${s.auto_sync ? 'checked' : ''}> Actualizar automáticamente en horario laboral</label>
      <div id="livePlan" class="text-sm text-slate-500">Cargando plan…</div>`)}

    ${section('Días festivos', 'Esos días nadie tiene falta; quien cheque aparece como día extra.',
      `<div class="grid items-end gap-3 sm:grid-cols-[180px_1fr] lg:grid-cols-[180px_1fr_auto_auto]">
        <label class="field">Fecha<input type="date" id="hFecha" class="input"></label><label class="field">Nombre del día<input id="hDesc" class="input" placeholder="Ej. Día del Trabajo"></label>
        <button id="hAdd" class="btn btn-primary">Agregar</button><button id="hLft" class="btn btn-secondary">Agregar los festivos oficiales de ${new Date().getFullYear()}</button></div>
      <div class="mt-4 flex flex-wrap gap-2">${holidays.map((h) => `<span class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pr-1 pl-3 text-sm">
        <b class="tabular-nums">${fmtDate(h.fecha)}</b> ${esc(h.descripcion)}
        <button class="grid size-6 place-items-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600" data-del-holiday="${h.fecha}" title="Quitar">${icon('x', 'size-3.5')}</button></span>`).join('') || '<span class="text-sm text-slate-400">No hay días festivos registrados.</span>'}</div>`)}

    ${section('Empleados', 'La lista se llena sola con las personas que checan. En el checador los nombres van abreviados (con nombres largos aparecen símbolos raros); escriba aquí el nombre completo para que salga en los reportes. Esto solo se guarda en este sistema: el checador no se modifica. También puede marcar bajas (después de esa fecha ya no se cuentan faltas), corregir la fecha de ingreso o darle un horario especial.',
      `<div class="relative mb-3 w-full max-w-72"><span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400">${icon('search')}</span>
        <input id="empSearch" class="input pl-9" placeholder="Buscar empleado…"></div>
      <div class="max-h-[60vh] overflow-auto rounded-xl border border-slate-200"><table class="tbl"><thead><tr><th>Nombre completo</th><th>Trabaja aquí</th><th>Ingreso / baja</th><th>Horario</th><th>Notas</th><th></th></tr></thead>
      <tbody id="empBody">${employees.map((e) => `<tr data-emp-row="${e.branch_id}|${esc(e.emp_code)}" data-text="${esc(`${e.alias} ${e.first_name} ${e.last_name} ${e.emp_code}`.toLowerCase())}">
        <td class="min-w-56"><input class="input px-2 py-1 font-medium ${!e.alias && `${e.first_name}${e.last_name}`.replace(/\s/g, '').length <= 4 ? 'border-amber-400 bg-amber-50' : ''}" name="alias" value="${esc(e.alias)}" placeholder="${esc(`${e.first_name} ${e.last_name}`.trim() || 'Escriba el nombre')}" title="Nombre completo para los reportes">
          <div class="mt-1 text-xs text-slate-500">${esc(bName[e.branch_id])} · No. ${esc(e.emp_code)}${e.alias ? ` · en el checador: ${esc(`${e.first_name} ${e.last_name}`.trim())}` : ''}</div></td>
        <td class="text-center"><input type="checkbox" class="checkbox" name="activo" ${e.activo ? 'checked' : ''} aria-label="Trabaja aquí">
          <label class="mt-2 flex items-center justify-center gap-1 text-[11px] whitespace-nowrap text-slate-500" title="Cuentas como ADMIN o SISTEMAS: no se evalúan"><input type="checkbox" class="checkbox" name="excluir" ${e.excluir ? 'checked' : ''}> No es persona</label></td>
        <td><label class="field">Ingreso<input type="date" class="input w-36 px-2 py-1" name="fecha_alta" value="${esc(e.fecha_alta || '')}"></label>
          <label class="field mt-1">Baja<input type="date" class="input w-36 px-2 py-1" name="fecha_baja" value="${esc(e.fecha_baja || '')}"></label></td>
        <td><button class="btn btn-sm ${e.schedule ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' : 'btn-secondary'}" data-emp-sched>${e.schedule ? 'Especial ✎' : 'El de su sucursal'}</button></td>
        <td><input class="input min-w-32 px-2 py-1" name="notas" value="${esc(e.notas)}"></td><td><button class="btn btn-primary btn-sm" data-emp-save>Guardar</button></td></tr>`).join('')
        || '<tr><td colspan="6" class="py-8 text-center text-slate-400">Todavía no hay empleados. Aparecerán al cargar las checadas.</td></tr>'}</tbody></table></div>`)}

    <details class="card mb-6 group">
      <summary class="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
        <div><h2 class="text-base font-semibold text-slate-900">Opciones avanzadas</h2>
          <p class="text-sm text-slate-500">Solo para el área de sistemas: conexión con los checadores. Normalmente no hay que tocar nada aquí.</p></div>
        <span class="text-slate-400 transition group-open:rotate-180">▾</span>
      </summary>
      <div class="space-y-6 border-t border-slate-100 p-5">
        <div>
          <h3 class="mb-1 text-sm font-semibold text-slate-900">Servidor de los checadores (MySQL / BioTime)</h3>
          <p class="mb-3 text-xs text-slate-500">El sistema solo lee las checadas; nunca modifica el checador. Se recomienda un usuario con permiso únicamente de lectura (SELECT).</p>
          <div id="connForm" class="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-5">
            ${inp('mysql_host', 'Servidor', s.mysql_host, 'text', 'placeholder="IP o dominio"')}${inp('mysql_port', 'Puerto', s.mysql_port, 'number')}
            ${inp('mysql_user', 'Usuario', s.mysql_user, 'text', 'autocomplete="off"')}${inp('mysql_password', 'Contraseña', s.mysql_password, 'password', 'autocomplete="new-password"')}
            <button id="saveConn" class="btn btn-primary">Guardar conexión</button></div>
        </div>
        <div>
          <h3 class="mb-3 text-sm font-semibold text-slate-900">Base de datos de cada sucursal</h3>
          <div class="space-y-3">${state.branches.map((b) => `
            <div class="grid items-end gap-3 sm:grid-cols-[160px_1fr_auto]" data-db-row="${b.id}">
              <div class="pb-2 text-sm font-medium">${esc(b.code)} ${esc(b.name)}</div>
              <label class="field">Base de datos<input class="input font-mono text-xs" name="db_name" value="${esc(b.db_name)}"></label>
              <button class="btn btn-secondary" data-test-branch>Guardar y probar</button>
              <div data-test-out class="text-xs sm:col-start-2 sm:col-span-2"></div>
            </div>`).join('')}</div>
        </div>
        <div>
          <h3 class="mb-3 text-sm font-semibold text-slate-900">Ajustes del cálculo</h3>
          <div id="advForm" class="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
            ${inp('cerca_salida_min', 'Con 3 checadas, la última se toma como salida si es a menos de estos min de la hora de salida', s.cerca_salida_min, 'number', 'min="0"')}
            ${inp('dias_contexto', 'Días hacia atrás para saber quién sigue activo', s.dias_contexto, 'number', 'min="0"')}
            ${inp('dias_sin_checar', 'Avisar si alguien lleva estos días de trabajo sin checar', s.dias_sin_checar, 'number', 'min="1"')}
            <button id="saveAdv" class="btn btn-primary">Guardar ajustes</button></div>
        </div>
        <details class="text-sm"><summary class="cursor-pointer font-medium text-brand-700">Consulta SQL para exportar checadas a mano</summary>
<pre class="mt-2 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">SELECT ("01 ALPUYECA") AS tienda,
  personnel_employee.emp_code, personnel_employee.first_name,
  personnel_employee.last_name, iclock_transaction.punch_time
FROM personnel_employee, iclock_transaction
WHERE personnel_employee.emp_code = iclock_transaction.emp_code
  AND iclock_transaction.punch_time
  BETWEEN "${$('#from').value} 00:00:00" AND "${$('#to').value} 23:59:59"
ORDER BY iclock_transaction.punch_time ASC;</pre></details>
      </div>
    </details>`;

  const formData = (root) => Object.fromEntries($$('input, select', root).filter((i) => i.name).map((i) => [i.name, i.value]));
  $('#saveConn').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    await api('/api/settings', { method: 'PUT', body: formData($('#connForm')) });
    toast('Conexión guardada');
  }));
  $('#saveRules').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    await api('/api/settings', { method: 'PUT', body: formData($('#ruleForm')) });
    toast('Reglas guardadas');
  }));
  $('#autoSync').addEventListener('change', (ev) => busy(ev.currentTarget, async () => {
    await api('/api/settings', { method: 'PUT', body: { auto_sync: ev.target.checked } });
    toast(ev.target.checked ? 'Actualización automática activada' : 'Actualización automática desactivada');
    pollLive();
  }));
  api('/api/live/semana').then((plan) => {
    const hoy = iso(new Date());
    $('#livePlan').innerHTML = `<div class="overflow-x-auto"><table class="tbl"><thead><tr><th>Día</th><th>Horarios de consulta</th></tr></thead><tbody>${plan.map((d) => `
      <tr class="${d.fecha === hoy ? 'bg-brand-50/60' : ''}"><td class="font-medium whitespace-nowrap capitalize text-slate-900">${d.dia}${d.fecha === hoy ? ' <span class="text-xs font-normal text-brand-700">(hoy)</span>' : ''}</td>
      <td><div class="flex flex-wrap gap-1.5">${d.ventanas.map((w) => `<span class="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs"><b>${w.desde}–${w.hasta}</b> · cada ${w.cada === 60 ? 'hora' : `${w.cada} min`} · ${esc(w.motivo)}</span>`).join('')}</div></td></tr>`).join('')}
      </tbody></table></div><p class="mt-2 text-xs">Fuera de estos horarios no se consulta. Siempre puede usar <b>Actualizar desde checadores</b> para traer las checadas en cualquier momento.</p>`;
  }).catch(() => {});
  $('#saveAdv').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    await api('/api/settings', { method: 'PUT', body: formData($('#advForm')) });
    toast('Ajustes guardados');
  }));
  const saveBranch = (id) => {
    const card = $(`[data-branch="${id}"]`);
    return api(`/api/branches/${id}`, { method: 'PUT', body: {
      db_name: $(`[data-db-row="${id}"] [name=db_name]`).value.trim(),
      tolerancia_min: $('[name=tolerancia_min]', card).value,
      enabled: $('[name=enabled]', card).checked,
      schedule: readSched(card, 'b' + id),
    } });
  };
  $$('[data-branch]').forEach((card) => {
    $('[data-save-branch]', card).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      await saveBranch(card.dataset.branch);
      await loadBranches();
      toast('Horario guardado');
    }));
  });
  $$('[data-db-row]').forEach((row) => {
    $('[data-test-branch]', row).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      const out = $('[data-test-out]', row);
      await saveBranch(row.dataset.dbRow);
      await loadBranches();
      try {
        const r = await api(`/api/branches/${row.dataset.dbRow}/test`, { method: 'POST' });
        out.innerHTML = `<span class="text-emerald-700">✔ Conexión correcta: ${r.empleados} empleados y ${r.marcajes.toLocaleString('es-MX')} checadas guardadas en el checador.</span>`;
      } catch (e) {
        out.innerHTML = `<span class="text-rose-700">✖ ${esc(e.message)}</span>`;
      }
    }));
  });
  $('#copyAll').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const cards = $$('[data-branch]');
    const week = readSched(cards[0], 'b' + cards[0].dataset.branch);
    if (!confirm(`¿Usar el horario de ${state.branches[0].name} en todas las sucursales?`)) return;
    for (const c of cards) {
      week.forEach((d, i) => {
        $(`[name=b${c.dataset.branch}-lab-${i}]`, c).checked = d.laborable;
        $(`[name=b${c.dataset.branch}-ent-${i}]`, c).value = d.entrada;
        $(`[name=b${c.dataset.branch}-sal-${i}]`, c).value = d.salida;
        $(`[name=b${c.dataset.branch}-com-${i}]`, c).checked = d.comida;
      });
      await saveBranch(c.dataset.branch);
    }
    await loadBranches();
    toast('Horario aplicado a todas las sucursales');
  }));
  $('#hAdd').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    await api('/api/holidays', { method: 'POST', body: { fecha: $('#hFecha').value, descripcion: $('#hDesc').value } });
    await viewConfig();
  }));
  $('#hLft').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    for (const [fecha, descripcion] of feriadosLFT(new Date().getFullYear())) {
      await api('/api/holidays', { method: 'POST', body: { fecha, descripcion } });
    }
    toast('Festivos oficiales agregados');
    await viewConfig();
  }));
  $$('[data-del-holiday]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    await api(`/api/holidays/${b.dataset.delHoliday}`, { method: 'DELETE' });
    await viewConfig();
  })));
  $('#empSearch').addEventListener('input', (ev) => {
    const q = ev.target.value.toLowerCase();
    $$('#empBody tr[data-text]').forEach((tr) => (tr.style.display = tr.dataset.text.includes(q) ? '' : 'none'));
  });
  const empByKey = Object.fromEntries(employees.map((e) => [`${e.branch_id}|${e.emp_code}`, e]));
  $$('[data-emp-row]').forEach((tr) => {
    const e = empByKey[tr.dataset.empRow];
    const save = (schedule) =>
      api(`/api/employees/${e.branch_id}/${encodeURIComponent(e.emp_code)}`, { method: 'PUT', body: {
        activo: $('[name=activo]', tr).checked,
        excluir: $('[name=excluir]', tr).checked,
        fecha_alta: $('[name=fecha_alta]', tr).value,
        fecha_baja: $('[name=fecha_baja]', tr).value,
        notas: $('[name=notas]', tr).value,
        alias: $('[name=alias]', tr).value,
        schedule,
      } });
    $('[data-emp-save]', tr).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      await save(e.schedule);
      toast('Empleado guardado');
    }));
    $('[data-emp-sched]', tr).addEventListener('click', () => {
      const branch = state.branches.find((b) => b.id === e.branch_id);
      openDialog('modal', `
        <div class="mb-4 flex items-start justify-between gap-4"><div>
          <h2 class="text-lg font-bold text-slate-900">Horario de ${esc(e.alias || `${e.first_name} ${e.last_name}`)}</h2>
          <p class="text-sm text-slate-500">Si no se le da un horario especial, usa el de ${esc(bName[e.branch_id])}.</p></div>${closeBtn}</div>
        <div class="mb-3 flex flex-wrap items-center gap-2"><span class="text-xs text-slate-500">Atajos:</span>
          <button class="chip" data-preset="domingo">+ Trabaja los domingos</button>
          <button class="chip" data-preset="sucursal">Igual al de su sucursal</button></div>
        <div id="esched">${schedTable('e', e.schedule || branch.schedule)}</div>
        <div class="mt-6 flex flex-wrap justify-end gap-2">
          ${e.schedule ? '<button class="btn btn-danger sm:mr-auto" id="esReset">Quitar horario especial</button>' : ''}
          <button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" id="esSave">Guardar horario especial</button></div>`);
      $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.preset === 'domingo') $('[name=e-lab-0]').checked = true;
        else $('#esched').innerHTML = schedTable('e', branch.schedule);
      }));
      $('#esSave').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        await save(readSched($('#esched'), 'e'));
        closeDialogs();
        toast('Horario guardado');
        await viewConfig();
      }));
      $('#esReset')?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        await save(null);
        closeDialogs();
        await viewConfig();
      }));
    });
  });
}

// ---------------------------------------------------------------- Historial de cambios
const SETTING_LABELS = {
  tolerancia_min: 'tolerancia (min)',
  retardos_por_falta: 'retardos por falta',
  salida_anticipada_min: 'minutos para "se fue antes"',
  duplicado_min: 'checadas repetidas (min)',
  comida_min: 'minutos de comida',
  comida_tolerancia_min: 'tolerancia de comida (min)',
  retardo_falta_min: 'retardo que cuenta como falta (min)',
  extra_min: 'minutos para tiempo extra',
  cerca_salida_min: 'minutos cerca de la salida',
  dias_sin_checar: 'días sin checar para avisar',
  dias_contexto: 'días hacia atrás',
  mysql_host: 'servidor',
  mysql_port: 'puerto',
  mysql_user: 'usuario del servidor',
  mysql_password: 'contraseña del servidor',
};

// Convierte cada registro del historial en una frase que cualquiera entienda.
function describeAudit(r, names, branches) {
  let d;
  try {
    d = JSON.parse(r.detalle);
  } catch {
    return esc(r.detalle);
  }
  const suc = (id) => branches[id] || 'sucursal';
  const who = (id, code) => names[`${id}|${code}`] || `empleado No. ${code}`;
  switch (r.accion) {
    case 'Justificación registrada':
      if (d.justificado === false) return `Anotó como <b>no justificado</b> el día ${fmtDate(d.fecha)} de <b>${esc(who(d.branch_id, d.emp_code))}</b> (${esc(suc(d.branch_id))}): ${esc(d.nota)}`;
      if (d.dias > 1) return `Justificó ${d.dias} días desde el ${fmtDate(d.fecha)} hasta el ${fmtDate(d.hasta)} de <b>${esc(who(d.branch_id, d.emp_code))}</b> como <b>${esc(d.tipo)}</b>: ${esc(d.nota)}`;
      return `Justificó el día ${fmtDate(d.fecha)} de <b>${esc(who(d.branch_id, d.emp_code))}</b> (${esc(suc(d.branch_id))}) como <b>${esc(d.tipo)}</b>: ${esc(d.nota)}`;
    case 'Justificación eliminada':
      return `Quitó la justificación del día ${fmtDate(d.fecha)} de <b>${esc(who(d.branch_id, d.emp_code))}</b> (${esc(d.tipo)})`;
    case 'Sincronización':
    case 'Actualización de checadas':
      return `Actualizó las checadas del ${fmtDate(d.desde)} al ${fmtDate(d.hasta)}:<br>${(d.results || [])
        .map((x) => (x.ok ? `✔ ${esc(x.sucursal)}: ${x.nuevos} checadas nuevas` : `✖ ${esc(x.sucursal)}: ${esc(x.error)}`)).join('<br>')}`;
    case 'Importación de archivo':
      return `Subió el archivo <b>${esc(d.archivo)}</b>: ${(d.results || []).map((x) => `${esc(x.sucursal)} ${x.nuevos} nuevas`).join(', ')}${d.errores ? ` · ${d.errores} renglón(es) con error` : ''}`;
    case 'Configuración':
      return `Cambió ${Object.entries(d).map(([k, v]) => `${esc(SETTING_LABELS[k] || k)}${k === 'mysql_password' ? '' : ` a <b>${esc(v)}</b>`}`).join(', ')}`;
    case 'Sucursal actualizada':
      return `Cambió el horario o los datos de <b>${esc(d.sucursal)}</b>`;
    case 'Empleado actualizado':
      return `Actualizó a <b>${esc(names[`${state.branches.find((b) => `${b.code} ${b.name}` === d.sucursal)?.id}|${d.emp_code}`] || `empleado No. ${d.emp_code}`)}</b> (${esc(d.sucursal)})${d.fecha_baja ? `: baja el ${fmtDate(d.fecha_baja)}` : ''}${d.schedule ? ', con horario especial' : ''}`;
    case 'Cuenta excluida':
      return `Marcó el No. ${esc(d.emp_code)} (${esc(d.sucursal)}) como <b>cuenta que no es una persona</b>`;
    case 'Cuenta incluida':
      return `Volvió a incluir el No. ${esc(d.emp_code)} (${esc(d.sucursal)}) en los reportes`;
    case 'Nombre registrado':
      return `Registró el nombre completo <b>${esc(d.alias)}</b> para el No. ${esc(d.emp_code)} (${esc(d.sucursal)})`;
    case 'Baja registrada':
      return `Dio de baja al No. ${esc(d.emp_code)} (${esc(d.sucursal)}) con fecha ${fmtDate(d.fecha_baja)}`;
    case 'Festivo agregado':
      return `Agregó el día festivo ${fmtDate(d.fecha)} (${esc(d.descripcion)})`;
    case 'Festivo eliminado':
      return `Quitó el día festivo ${fmtDate(d.fecha)}`;
    default:
      return esc(r.accion);
  }
}

async function viewBitacora() {
  const [rows, employees] = await Promise.all([api('/api/audit'), api('/api/employees')]);
  const names = Object.fromEntries(employees.map((e) => [`${e.branch_id}|${e.emp_code}`, e.alias || `${e.first_name} ${e.last_name}`.trim()]));
  const branches = Object.fromEntries(state.branches.map((b) => [b.id, `${b.code} ${b.name}`]));
  $('#view').innerHTML = `
    ${pageHeader('Historial de cambios', 'Quién hizo qué y cuándo: actualizaciones de checadas, justificaciones y cambios de configuración.')}
    <div class="card overflow-hidden"><div class="max-h-[75vh] overflow-auto"><table class="tbl"><thead><tr><th>Fecha y hora</th><th>Persona</th><th>Qué hizo</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="whitespace-nowrap tabular-nums text-slate-500">${fmtDate(r.fecha.slice(0, 10))} ${r.fecha.slice(11, 16)}</td>
      <td class="font-medium whitespace-nowrap">${esc(r.autor)}</td>
      <td class="text-slate-700">${describeAudit(r, names, branches)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="py-8 text-center text-slate-400">Todavía no hay cambios registrados.</td></tr>'}</tbody></table></div></div>`;
}

const VIEWS = { panel: viewPanel, empleados: viewEmpleados, detalle: viewDetalle, datos: viewDatos, config: viewConfig, bitacora: viewBitacora };

function setupSearch() {
  const input = $('#gsearch');
  const box = $('#gsugg');
  let items = [];
  const close = () => box.classList.add('hidden');
  const pick = (i) => {
    const e = items[i];
    if (!e) return;
    close();
    showEmployee(e.branch_id, e.emp_code);
  };
  const show = () => {
    const q = input.value.trim().toLowerCase();
    const list = state.report?.employees || [];
    items = q ? list.filter((e) => matches(q, e.nombre, e.emp_code, e.sucursal)).slice(0, 8) : [];
    box.innerHTML = items.length
      ? items.map((e, i) => `<button class="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-50 focus:bg-brand-50 focus:outline-none" data-i="${i}">
          <span class="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700">${esc(initials(e.nombre))}</span>
          <span class="min-w-0 flex-1"><span class="block text-sm font-medium text-slate-900">${esc(e.nombre)}</span>
          <span class="block text-xs text-slate-500">No. ${esc(e.emp_code)} · ${esc(e.sucursal)}</span></span></button>`).join('')
      : q ? `<div class="px-3 py-3 text-sm text-slate-500">${state.report ? 'Nadie coincide en este periodo y sucursal.' : 'Abra Panel, Empleados o Detalle para buscar.'}</div>` : '';
    box.classList.toggle('hidden', !q);
    $$('[data-i]', box).forEach((b) => b.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      pick(Number(b.dataset.i));
    }));
  };
  input.addEventListener('input', () => {
    state.search = input.value.trim();
    show();
    if (['empleados', 'detalle'].includes(state.view) && state.report) VIEWS[state.view]();
  });
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') pick(0);
    if (ev.key === 'Escape') { input.value = ''; state.search = ''; close(); if (['empleados', 'detalle'].includes(state.view)) VIEWS[state.view](); }
    if (ev.key === 'ArrowDown' && items.length) { ev.preventDefault(); $('[data-i]', box).focus(); }
  });
  box.addEventListener('keydown', (ev) => {
    const btns = $$('[data-i]', box);
    const i = btns.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); btns[Math.min(i + 1, btns.length - 1)].focus(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); i <= 0 ? input.focus() : btns[i - 1].focus(); }
    if (ev.key === 'Enter') { ev.preventDefault(); pick(i); }
  });
}

// ---------------------------------------------------------------- En vivo
// Pregunta al servidor cada minuto si llegaron checadas nuevas; si sí y la
// pantalla muestra el periodo de hoy, la vuelve a cargar.
let liveVersion = null;
async function pollLive() {
  if (document.hidden) return;
  let s;
  try {
    s = await api('/api/live');
  } catch (e) {
    // Un servidor de una versión anterior no conoce esta ruta.
    if (/404/.test(e.message)) $('#restartBanner').classList.remove('hidden');
    return;
  }
  $('#restartBanner').classList.toggle('hidden', !s.reiniciar);
  const pill = $('#livePill');
  pill.classList.remove('hidden');
  pill.classList.add('inline-flex');
  const set = (cls, dot, text, title) => {
    pill.className = `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${cls}`;
    pill.innerHTML = `<span class="size-2 rounded-full ${dot}"></span>${text}`;
    pill.title = title;
  };
  if (!s.configurado) set('border-slate-200 bg-white text-slate-500', 'bg-slate-300', 'En vivo: sin conexión configurada', 'Configure la conexión con los checadores en Configuración → Opciones avanzadas.');
  else if (!s.habilitado) set('border-slate-200 bg-white text-slate-500', 'bg-slate-300', 'En vivo: apagado', 'Puede activarlo en Configuración → Actualización automática.');
  else if (s.errores.length) set('border-rose-200 bg-rose-50 text-rose-800', 'bg-rose-500', 'En vivo: con problemas', s.errores.join('\n'));
  else if (s.activo) set('border-emerald-200 bg-emerald-50 text-emerald-800', 'bg-emerald-500 animate-pulse',
    `En vivo · cada ${s.ventana.cada === 60 ? 'hora' : `${s.ventana.cada} min`}${s.ultima ? ` · ${s.ultima}` : ''}`,
    `${s.ventana.motivo}: se consulta de ${s.ventana.desde} a ${s.ventana.hasta}.${s.ultima ? ` Última actualización: ${s.ultima}.` : ''}`);
  else set('border-slate-200 bg-white text-slate-500', 'bg-slate-300',
    `En vivo en pausa${s.reanuda ? ` · vuelve ${s.reanuda.dia} ${s.reanuda.hora}` : ''}`,
    'Fuera del horario laboral no se consulta el checador, para no saturar el servidor.');
  const changed = liveVersion !== null && s.version !== liveVersion;
  liveVersion = s.version;
  const hoy = iso(new Date());
  const muestraHoy = $('#from').value <= hoy && $('#to').value >= hoy;
  const ocupado = $('#modal').open || $('#drawer').open || document.activeElement?.id === 'gsearch';
  if (changed && muestraHoy && REPORT_VIEWS.includes(state.view) && !ocupado) {
    await refresh();
    toast('Llegaron checadas nuevas: datos actualizados');
  }
}

async function go(view) {
  state.view = view;
  history.replaceState(null, '', `#${view}`);
  await refresh();
}

// ---------------------------------------------------------------- arranque
async function init() {
  // El nombre se captura en la barra lateral (computadora) o arriba (celular).
  const userInputs = [$('#usuario'), $('#usuarioMobile')];
  try {
    for (const i of userInputs) i.value = localStorage.getItem('usuario') || '';
  } catch {}
  for (const input of userInputs) {
    input.addEventListener('change', () => {
      for (const i of userInputs) i.value = input.value;
      try {
        localStorage.setItem('usuario', usuario());
      } catch {}
    });
  }
  $('#preset').addEventListener('change', () => {
    applyPreset();
    refresh();
  });
  for (const id of ['from', 'to']) $(`#${id}`).addEventListener('change', () => {
    $('#preset').value = 'custom';
    refresh();
  });
  $('#branch').addEventListener('change', refresh);
  $('#btnSync').addEventListener('click', (ev) => doSync(ev.currentTarget));
  $('#btnExcel').addEventListener('click', () => {
    location.href = `/api/export.xlsx?${query()}&usuario=${encodeURIComponent(usuario())}`;
  });
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnPdf').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    // Se descarga con fetch para poder mostrar el aviso si algo falla.
    const res = await fetch(`/api/reporte.pdf?${query()}&usuario=${encodeURIComponent(usuario())}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo crear el PDF.');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'reporte.pdf',
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Reporte PDF descargado');
  }));
  setupSearch();
  pollLive();
  setInterval(pollLive, 60000);
  document.addEventListener('visibilitychange', () => !document.hidden && pollLive());
  for (const id of ['modal', 'drawer']) $(`#${id}`).addEventListener('click', (ev) => ev.target.id === id && $(`#${id}`).close());

  applyPreset();
  const fromHash = location.hash.slice(1);
  if (VIEWS[fromHash]) state.view = fromHash;
  try {
    await loadBranches();
    await loadPendientes();
  } catch (e) {
    toast(e.message, 'error');
  }
  await refresh();
}

init();
