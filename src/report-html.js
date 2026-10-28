// Reporte imprimible (se convierte a PDF). Mismas cifras que el Excel: ambos
// usan analytics.js. Las gráficas son SVG dibujado aquí, sin librerías.
const { analyze } = require('./analytics');

const C = {
  serie: '#2a78d6',
  puntual: '#0ca30c',
  retardo: '#fab219',
  falta: '#d03b3b',
  incompleto: '#ec835a',
  justificado: '#6250d6',
  rangos: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (s) => (s ? s.split('-').reverse().join('/') : '');
const pct = (v) => (v == null ? '—' : `${v}%`);

function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// Barras horizontales (una serie). Etiqueta a la izquierda, valor al final de la barra.
function hbar(items, { color = C.serie, max, unit = '', width = 470, labelW = 170 } = {}) {
  if (!items.length) return '<p class="empty">Sin datos en el periodo.</p>';
  const rowH = 24;
  const h = items.length * rowH + 8;
  const top = max ?? niceMax(Math.max(...items.map((i) => i.value), 1));
  const plotW = width - labelW - 40;
  const rows = items.map((it, i) => {
    const y = 4 + i * rowH;
    const w = Math.max(it.value ? 2 : 0, (it.value / top) * plotW);
    const fillC = it.color || color;
    return `<g><title>${esc(it.label)}: ${it.value}${unit}</title>
      <text x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" class="lbl">${esc(it.label)}</text>
      ${it.value ? `<path d="M${labelW},${y + 4} h${Math.max(w - 3, 0)} a3,3 0 0 1 3,3 v${rowH - 14} a3,3 0 0 1 -3,3 h${-Math.max(w - 3, 0)} z" fill="${fillC}"/>` : ''}
      <text x="${labelW + w + 6}" y="${y + rowH / 2 + 4}" class="val">${it.value}${unit}</text></g>`;
  });
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" role="img">${rows.join('')}
    <line x1="${labelW}" y1="2" x2="${labelW}" y2="${h - 2}" stroke="${C.axis}"/></svg>`;
}

// Columnas verticales: agrupadas o apiladas, con eje Y y líneas guía.
function columns(cats, series, { stacked = false, width = 960, height = 230, hideZeros = false } = {}) {
  if (!cats.length) return '<p class="empty">Sin datos en el periodo.</p>';
  const left = 34, bottom = 34, top = 18;
  const plotW = width - left - 8;
  const plotH = height - top - bottom;
  const totals = cats.map((_, i) => (stacked ? series.reduce((n, s) => n + (s.values[i] || 0), 0) : Math.max(...series.map((s) => s.values[i] || 0))));
  const ymax = niceMax(Math.max(...totals, 1));
  const y = (v) => top + plotH - (v / ymax) * plotH;
  const slot = plotW / cats.length;
  const groupW = Math.min(slot * 0.7, stacked ? 46 : 22 * series.length + 6);
  const barW = stacked ? groupW : (groupW - 2 * (series.length - 1)) / series.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(ymax * t));
  const grid = ticks.map((t) => `<line x1="${left}" x2="${width - 8}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? C.grid : C.axis}"/>
    <text x="${left - 6}" y="${y(t) + 4}" text-anchor="end" class="tick">${t}</text>`).join('');
  const every = Math.ceil(cats.length / 16); // no amontonar las fechas
  const bars = cats.map((cat, i) => {
    const x0 = left + i * slot + (slot - groupW) / 2;
    let acc = 0;
    const marks = series.map((s, k) => {
      const v = s.values[i] || 0;
      if (stacked) {
        const y1 = y(acc + v), y0 = y(acc);
        acc += v;
        if (!v) return '';
        const hh = y0 - y1;
        return `<rect x="${x0}" y="${y1 + 1}" width="${barW}" height="${Math.max(hh - 2, 1)}" fill="${s.color}"><title>${esc(cat)} · ${esc(s.name)}: ${v}</title></rect>
          ${hh >= 14 ? `<text x="${x0 + barW / 2}" y="${y1 + hh / 2 + 4}" text-anchor="middle" class="in ${s.color === C.retardo ? 'dark' : ''}">${v}</text>` : ''}`;
      }
      const bx = x0 + k * (barW + 2);
      if (!v && hideZeros) return '';
      const by = y(v);
      return `<g><title>${esc(cat)} · ${esc(s.name)}: ${v}</title>
        ${v ? `<path d="M${bx},${top + plotH} V${by + 3} a3,3 0 0 1 3,-3 h${barW - 6} a3,3 0 0 1 3,3 V${top + plotH} z" fill="${s.color}"/>` : ''}
        <text x="${bx + barW / 2}" y="${by - 4}" text-anchor="middle" class="val">${v}</text></g>`;
    }).join('');
    const label = i % every === 0 ? `<text x="${x0 + groupW / 2}" y="${height - bottom + 16}" text-anchor="middle" class="tick">${esc(cat)}</text>` : '';
    return marks + label;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img">${grid}${bars}</svg>`;
}

const legend = (items) => `<div class="legend">${items.map(([name, color]) => `<span><i style="background:${color}"></i>${esc(name)}</span>`).join('')}</div>`;

function table(headers, rows, { num = [] } = {}) {
  return `<table><thead><tr>${headers.map((h, i) => `<th class="${num.includes(i) ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td class="${num.includes(i) ? 'n' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function buildReportHtml({ from, to, today, sucursal, result, settings, generadoPor }) {
  const A = analyze(result, { from, to, today, settings });
  const K = A.kpis;
  const tiles = [
    ['Puntualidad', pct(K.puntualidad), 'entradas a tiempo'],
    ['Asistencia', pct(K.asistencia), 'incluye justificados'],
    ['Retardos', K.retardos, `${K.personas_con_retardo} persona(s) con retardo`],
    ['Minutos de retardo', K.minutos_retardo, `promedio ${K.promedio_retardo} min por retardo`],
    ['Retardo más grande', K.retardo_mayor ? `${K.retardo_mayor.minutos} min` : '—', K.retardo_mayor ? `${K.retardo_mayor.nombre} · ${fmtDate(K.retardo_mayor.fecha)}` : ''],
    ['Faltas', K.faltas, 'sin justificar'],
    ['Faltas por retardos', K.faltas_por_retardos, 'por juntar retardos'],
    ['Justificados', K.justificados, `${K.no_justificados} anotado(s) como no justificado`],
    ['Checadas incompletas', K.incompletas, 'falta entrada o salida'],
    ['Se pasaron en la comida', K.excesos_comida, 'días'],
    ['No checaron comida', K.comida_sin_checar, 'días'],
    ['Se fueron antes', K.salidas_anticipadas, 'días'],
    ['Tiempo extra al salir', K.dias_tiempo_extra, 'días'],
    ['Días extra', K.dias_extra, `${K.horas_extra} h en domingo o festivo`],
    ['Empleados evaluados', K.empleados, `${K.dias_laborables} días de trabajo`],
    ['Días sin datos', K.sin_datos, 'checador sin registros'],
  ];
  const short = (p) => `${p.nombre} (${p.sucursal.slice(3)})`;
  const B = result.branches;

  const header = `<header><div><h1>El Boom Tractopartes · Reporte de asistencia</h1>
    <p>Periodo: <b>${fmtDate(from)} al ${fmtDate(to)}</b> · Sucursal: <b>${esc(sucursal)}</b></p></div>
    <p class="gen">Generado el ${new Date().toLocaleString('es-MX')}${generadoPor ? `<br>por ${esc(generadoPor)}` : ''}</p></header>`;

  const pages = [];
  pages.push(`${header}
    <section class="tiles">${tiles.map(([l, v, s]) => `<div class="tile"><div class="tl">${esc(l)}</div><div class="tv">${esc(v)}</div><div class="ts">${esc(s)}</div></div>`).join('')}</section>
    <section class="card"><h2>Retardos y faltas por día</h2><p class="sub">Cuántas personas llegaron tarde y cuántas faltaron cada día.</p>
      ${legend([['Retardos', C.retardo], ['Faltas', C.falta]])}
      ${columns(A.fechas.map((f) => `${f.dia.slice(0, 3)} ${fmtDate(f.fecha).slice(0, 5)}`), [
        { name: 'Retardos', color: C.retardo, values: A.fechas.map((f) => f.retardos) },
        { name: 'Faltas', color: C.falta, values: A.fechas.map((f) => f.faltas) },
      ])}</section>`);

  pages.push(`<section class="grid2">
      <div class="card"><h2>Retardos por sucursal</h2><p class="sub">Cantidad de retardos en el periodo.</p>
        ${hbar(B.map((b) => ({ label: b.sucursal, value: b.retardos })))}</div>
      <div class="card"><h2>Puntualidad por sucursal</h2><p class="sub">Porcentaje de entradas a tiempo.</p>
        ${hbar(B.map((b) => ({ label: b.sucursal, value: b.puntualidad ?? 0 })), { max: 100, unit: '%' })}</div>
      <div class="card"><h2>Las 10 personas con más retardos</h2><p class="sub">Cantidad de días que llegaron tarde.</p>
        ${hbar(A.topRetardos.map((p) => ({ label: short(p), value: p.retardos })), { labelW: 210 })}</div>
      <div class="card"><h2>Retardos por día de la semana</h2><p class="sub">Total de retardos de cada día de la semana en el periodo.</p>
        ${columns(A.diasSemana.map((d) => d.dia), [{ name: 'Retardos', color: C.serie, values: A.diasSemana.map((d) => d.retardos) }], { width: 470, height: 250 })}</div>
    </section>`);

  pages.push(`<section class="grid2">
      <div class="card"><h2>¿Qué tan tarde llegan?</h2><p class="sub">Cantidad de retardos según los minutos de retraso.</p>
        ${hbar(A.rangos.map((r, i) => ({ label: r.rango, value: r.retardos, color: C.rangos[i] })))}</div>
      <div class="card"><h2>Resultado de los días por sucursal</h2><p class="sub">Días de trabajo de todo el personal, según lo que pasó.</p>
        ${legend([['Puntual', C.puntual], ['Retardo', C.retardo], ['Falta', C.falta], ['Justificado', C.justificado], ['Checada incompleta', C.incompleto]])}
        ${columns(B.map((b) => b.sucursal), [
          { name: 'Puntual', color: C.puntual, values: B.map((b) => b.puntuales) },
          { name: 'Retardo', color: C.retardo, values: B.map((b) => b.retardos) },
          { name: 'Falta', color: C.falta, values: B.map((b) => b.faltas) },
          { name: 'Justificado', color: C.justificado, values: B.map((b) => b.justificados) },
          { name: 'Checada incompleta', color: C.incompleto, values: B.map((b) => b.incompletos) },
        ], { stacked: true, width: 470, height: 250 })}</div>
    </section>
    <section class="card"><h2>Comparativo entre sucursales</h2>
      ${table(['Sucursal', 'Empleados', '% Puntualidad', '% Asistencia', 'Retardos', 'Min. de retardo', 'Faltas', 'Justificados', 'Checadas incompletas', 'Se pasaron en comida'],
        A.sucursales.map((s) => [s.sucursal, s.empleados, pct(s.puntualidad), pct(s.asistencia), s.retardos, s.minutos_retardo, s.faltas, s.justificados, s.incompletas, s.excesos_comida]),
        { num: [1, 2, 3, 4, 5, 6, 7, 8, 9] })}</section>`);

  pages.push(`<section class="card"><h2>Retardos por persona</h2><p class="sub">Ordenado de más a menos retardos. "Retardos" es la cantidad de días que llegó tarde.</p>
    ${table(['Empleado', 'No.', 'Sucursal', 'Retardos', 'Min. de retardo', 'Promedio (min)', 'Mayor (min)', 'Día que más llega tarde', 'Faltas', 'Faltas por retardos', 'Justificados', '% Puntualidad'],
      A.personas.map((p) => [p.nombre, p.emp_code, p.sucursal, p.retardos, p.minutos_retardo, p.promedio_retardo, p.retardo_mayor, p.dia_frecuente, p.faltas, p.faltas_por_retardos, p.justificados, pct(p.puntualidad)]),
      { num: [1, 3, 4, 5, 6, 8, 9, 10, 11] })}</section>`);

  pages.push(`<section class="card"><h2>Retardos por día</h2>
    ${table(['Fecha', 'Día', 'Personas evaluadas', 'Puntuales', 'Retardos', 'Min. de retardo', 'Faltas', 'Justificados', 'Checadas incompletas'],
      A.fechas.map((f) => [fmtDate(f.fecha), f.dia, f.evaluados, f.puntual, f.retardos, f.minutos_retardo, f.faltas, f.justificados, f.incompletos]),
      { num: [2, 3, 4, 5, 6, 7, 8] })}
    <h2 style="margin-top:18px">Cómo se calculó</h2>
    <ul class="crit">
      <li>Tolerancia: ${settings.tolerancia_min} min. Los minutos de retardo se cuentan desde ${settings.retardo_desde === 'tolerancia' ? 'que termina la tolerancia' : 'la hora de entrada'}.</li>
      <li>${settings.retardos_por_falta ? `Cada ${settings.retardos_por_falta} retardos se cuenta 1 falta.` : 'Los retardos no se convierten en faltas.'}${settings.retardo_falta_min ? ` Llegar más de ${settings.retardo_falta_min} min tarde cuenta como falta.` : ''}</li>
      <li>4 checadas: entrada, sale a comer, regresa de comer y salida. Comida: ${settings.comida_min} min + ${settings.comida_tolerancia_min} de tolerancia${settings.comida_desde ? `, a partir de las ${settings.comida_desde} entre semana` : ''}.</li>
      <li>Si vuelve a checar a menos de ${settings.duplicado_min} min, solo cuenta la primera checada.</li>
      <li>Falta: no checó en un día de trabajo y el checador de la sucursal sí registró a otras personas ese día.</li>
    </ul></section>`);

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de asistencia ${fmtDate(from)} al ${fmtDate(to)}</title>
<style>
  @page { size: letter landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: ${C.ink}; background: #fff; font-size: 11px; }
  .page { break-after: page; padding: 2px; }
  .page:last-child { break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1f3a5f; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { margin: 0; font-size: 20px; color: #1f3a5f; }
  header p { margin: 4px 0 0; color: ${C.ink2}; font-size: 12px; }
  .gen { text-align: right; font-size: 10px !important; }
  h2 { margin: 0; font-size: 13px; }
  .sub { margin: 2px 0 6px; color: ${C.ink2}; font-size: 10px; }
  .tiles { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; margin-bottom: 10px; }
  .tile { border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 8px; background: #f8fafc; }
  .tl { font-size: 9px; font-weight: 600; color: ${C.ink2}; }
  .tv { font-size: 20px; font-weight: 700; margin: 2px 0; }
  .ts { font-size: 8.5px; color: ${C.ink2}; }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; break-inside: avoid; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .grid2 .card { margin-bottom: 0; }
  .grid2 + .card, .grid2 + .grid2 { margin-top: 10px; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 10px; color: ${C.ink2}; margin-bottom: 2px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
  svg text { font-family: "Segoe UI", system-ui, sans-serif; }
  .lbl { font-size: 11px; fill: ${C.ink2}; }
  .val { font-size: 10.5px; fill: ${C.ink}; font-weight: 600; }
  .tick { font-size: 10px; fill: ${C.muted}; }
  .in { font-size: 10px; fill: #fff; font-weight: 600; }
  .in.dark { fill: ${C.ink}; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  thead { display: table-header-group; }
  th { background: #1f3a5f; color: #fff; text-align: left; padding: 4px 5px; font-weight: 600; }
  td { padding: 3px 5px; border-bottom: 1px solid #edf0f3; }
  tr { break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { color: ${C.muted}; padding: 20px 0; text-align: center; }
  .crit { margin: 6px 0 0; padding-left: 16px; color: ${C.ink2}; line-height: 1.5; }
</style></head><body>${pages.map((p) => `<div class="page">${p}</div>`).join('')}</body></html>`;
}

module.exports = { buildReportHtml };
