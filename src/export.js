// Reporte en Excel. Abre con un tablero (indicadores y gráficas nativas de
// Excel) y conserva los criterios y las checadas originales para que cualquier
// cifra pueda verificarse contra su origen.
const ExcelJS = require('exceljs');
const { analyze, CAL } = require('./analytics');
const { addCharts } = require('./xlsx-charts');

const NAVY = 'FF1F3A5F';
const INK = 'FF0B0B0B';
const MUTED = 'FF64748B';
// Colores de las gráficas (paleta validada: ver skill de visualización).
const C = {
  serie: '#2A78D6', // una sola serie (cantidades)
  puntual: '#0CA30C',
  retardo: '#FAB219',
  falta: '#D03B3B',
  incompleto: '#EC835A',
  justificado: '#6250D6',
  rangos: ['#86B6EF', '#5598E7', '#2A78D6', '#1C5CAB', '#104281'], // de menos a más minutos tarde
};

// Relleno de cada resultado (Detalle diario y Calendario).
const FILL = {
  PUNTUAL: 'FFDFF3E4',
  RETARDO: 'FFFFF1C2',
  FALTA: 'FFFAD4D4',
  INCOMPLETO: 'FFFFE0C2',
  JUSTIFICADO: 'FFE6E2FA',
  'SIN DATOS': 'FFE5E5E5',
  'DÍA EXTRA': 'FFEDE4FB',
  DESCANSO: 'FFF1F5F9',
  FESTIVO: 'FFF1F5F9',
};

const fmtDate = (s) => (s ? s.split('-').reverse().join('/') : '');
const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin', color: { argb: 'FFE2E8F0' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

function sheet(wb, name, columns, rows, opts = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: opts.xSplit || 0 }], properties: opts.properties });
  ws.columns = columns.map(([header, key, width]) => ({ header, key, width: width || 14 }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = solid(NAVY);
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 48;
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

// Barras dentro de las celdas, para leer de un vistazo quién tiene más.
function dataBar(ws, col, rows, color = 'FF2A78D6') {
  if (rows < 1) return;
  const letter = ws.getColumn(col).letter;
  ws.addConditionalFormatting({
    ref: `${letter}2:${letter}${rows + 1}`,
    rules: [{ type: 'dataBar', gradient: false, cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: color } }],
  });
}

const SUMMARY_COLS = [
  ['Días laborables', 'dias_laborables'],
  ['Asistencias', 'asistencias'],
  ['Puntuales', 'puntuales'],
  ['Retardos (cantidad)', 'retardos', 12],
  ['Minutos de retardo', 'minutos_retardo'],
  ['Faltas', 'faltas', 10],
  ['Faltas por retardos', 'faltas_por_retardos', 14],
  ['Justificados', 'justificados'],
  ['No checó entrada', 'incompletos', 12],
  ['No checó salida', 'sin_salida', 12],
  ['Se fue antes', 'salidas_anticipadas', 12],
  ['Retardos que cuentan como falta', 'retardos_graves', 16],
  ['Se pasó en la comida (días)', 'excesos_comida', 14],
  ['Min. de más en comida', 'minutos_exceso_comida', 12],
  ['Salió a comer antes de hora (días)', 'comidas_antes', 14],
  ['No checó comida (días)', 'comida_sin_checar', 14],
  ['Tiempo extra al salir (días)', 'dias_tiempo_extra', 14],
  ['Min. después de su salida', 'minutos_tiempo_extra', 12],
  ['Días sin datos', 'sin_datos'],
  ['Días extra (descanso/festivo)', 'dias_extra', 14],
  ['Horas extra', 'horas_extra', 11],
  ['% Puntualidad', 'puntualidad'],
  ['% Asistencia', 'asistencia'],
];

// ---------------------------------------------------------------- Tablero
function buildDashboard(wb, A, ctx) {
  const ws = wb.addWorksheet('Tablero', { views: [{ showGridLines: false }], properties: { tabColor: { argb: NAVY } } });
  const COLS = 16;
  for (let c = 1; c <= COLS; c++) ws.getColumn(c).width = 12;

  ws.mergeCells(1, 1, 1, COLS);
  Object.assign(ws.getCell(1, 1), { value: 'El Boom Tractopartes · Reporte de asistencia' });
  ws.getCell(1, 1).font = { size: 18, bold: true, color: { argb: NAVY } };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, COLS);
  ws.getCell(2, 1).value = `Periodo: ${fmtDate(ctx.from)} al ${fmtDate(ctx.to)} · Sucursal: ${ctx.sucursal} · Generado el ${new Date().toLocaleString('es-MX')}${ctx.generadoPor ? ` por ${ctx.generadoPor}` : ''}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: MUTED } };

  // Indicadores: 2 filas de 8 tarjetas (cada una ocupa 2 columnas).
  const K = A.kpis;
  const pct = (v) => (v == null ? '—' : `${v}%`);
  const tiles = [
    ['Puntualidad', pct(K.puntualidad), 'entradas a tiempo'],
    ['Asistencia', pct(K.asistencia), 'incluye justificados'],
    ['Retardos', K.retardos, `${K.personas_con_retardo} persona(s)`],
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
    ['Días extra', K.dias_extra, `${K.horas_extra} h en domingo/festivo`],
    ['Empleados evaluados', K.empleados, `${K.dias_laborables} días de trabajo`],
    ['Días sin datos', K.sin_datos, 'checador sin registros'],
  ];
  tiles.forEach(([label, value, sub], i) => {
    const row = 4 + Math.floor(i / 8) * 4;
    const col = 1 + (i % 8) * 2;
    for (const [r, txt, font] of [
      [row, label, { size: 9, bold: true, color: { argb: MUTED } }],
      [row + 1, value, { size: 20, bold: true, color: { argb: INK } }],
      [row + 2, sub, { size: 8, color: { argb: MUTED } }],
    ]) {
      ws.mergeCells(r, col, r, col + 1);
      const cell = ws.getCell(r, col);
      cell.value = txt;
      cell.font = font;
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: r === row + 2 };
      for (const c of [col, col + 1]) {
        ws.getCell(r, c).fill = solid('FFF8FAFC');
        ws.getCell(r, c).border = {
          top: r === row ? thin : undefined,
          bottom: r === row + 2 ? thin : undefined,
          left: c === col ? thin : undefined,
          right: c === col + 1 ? thin : undefined,
        };
      }
    }
    ws.getRow(row + 1).height = 30;
    ws.getRow(row + 2).height = 24;
  });

  // Tablas con los datos de cada gráfica (debajo de las gráficas).
  const CHART_ROWS = 18;
  const BANDS = 4;
  let r = 12 + BANDS * (CHART_ROWS + 1) + 1;
  ws.getCell(r, 1).value = 'Datos de las gráficas';
  ws.getCell(r, 1).font = { size: 14, bold: true, color: { argb: NAVY } };
  r += 2;
  const q = (col, row) => `'Tablero'!$${ws.getColumn(col).letter}$${row}`;
  const tables = {};
  // Cada tabla ocupa un bloque de columnas a lo ancho para no hacer la hoja larguísima.
  const placed = [];
  const writeTable = (key, title, headers, rows, col, startRow) => {
    ws.getCell(startRow, col).value = title;
    ws.getCell(startRow, col).font = { bold: true, color: { argb: NAVY } };
    headers.forEach((h, j) => {
      const cell = ws.getCell(startRow + 1, col + j);
      cell.value = h;
      cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.fill = solid(NAVY);
      cell.alignment = { wrapText: true, vertical: 'middle' };
    });
    rows.forEach((row, i) => row.forEach((v, j) => {
      const cell = ws.getCell(startRow + 2 + i, col + j);
      cell.value = v;
      cell.border = box;
      cell.font = { size: 9 };
    }));
    const first = startRow + 2;
    const last = startRow + 1 + Math.max(rows.length, 1);
    tables[key] = {
      cats: { ref: `${q(col, first)}:${q(col, last).split('!')[1]}`, values: rows.map((x) => String(x[0])) },
      col: (j) => ({ ref: `${q(col + j, first)}:${q(col + j, last).split('!')[1]}`, values: rows.map((x) => x[j]) }),
      n: rows.length,
    };
    placed.push(last);
  };
  const S = A.sucursales;
  writeTable('dia', 'Retardos y faltas por día', ['Fecha', 'Retardos', 'Faltas', 'Minutos de retardo'],
    A.fechas.map((f) => [`${f.dia.slice(0, 3)} ${fmtDate(f.fecha).slice(0, 5)}`, f.retardos, f.faltas, f.minutos_retardo]), 1, r);
  writeTable('suc', 'Por sucursal', ['Sucursal', 'Retardos', '% Puntualidad', 'Faltas', 'Puntuales', 'Justificados', 'Incompletos'],
    S.map((s) => {
      const b = ctx.result.branches.find((x) => x.sucursal === s.sucursal);
      return [s.sucursal, s.retardos, s.puntualidad ?? 0, s.faltas, b.puntuales, b.justificados, b.incompletos];
    }), 6, r);
  writeTable('top', 'Personas con más retardos', ['Empleado', 'Retardos', 'Minutos'],
    A.topRetardos.map((p) => [`${p.nombre} (${p.sucursal.slice(3)})`, p.retardos, p.minutos_retardo]), 14, r);
  const r2 = Math.max(...placed) + 3;
  writeTable('semana', 'Retardos por día de la semana', ['Día', 'Retardos', 'Faltas', 'Veces en el periodo', 'Retardos promedio'],
    A.diasSemana.map((d) => [d.dia, d.retardos, d.faltas, d.veces, d.retardos_promedio]), 1, r2);
  writeTable('rangos', 'Retardos según los minutos tarde', ['Minutos tarde', 'Retardos'], A.rangos.map((x) => [x.rango, x.retardos]), 7, r2);
  writeTable('faltas', 'Personas con más faltas', ['Empleado', 'Faltas'],
    A.topFaltas.map((p) => [`${p.nombre} (${p.sucursal.slice(3)})`, p.faltas]), 10, r2);

  // Gráficas (en bandas de dos por fila; la de días ocupa todo el ancho).
  const band = (i) => 12 + i * (CHART_ROWS + 1);
  const at = (i, half) => ({
    from: { col: half === 'right' ? 8 : 0, row: band(i) - 1 },
    to: { col: half === 'left' ? 8 : 16, row: band(i) - 1 + CHART_ROWS },
  });
  const charts = [];
  const add = (cond, def) => cond && charts.push(def);
  const T = tables;
  add(T.dia.n, { title: 'Retardos y faltas por día (cantidad de personas)', dir: 'col', anchor: at(0, 'full'), cats: T.dia.cats,
    series: [{ name: 'Retardos', color: C.retardo, ...T.dia.col(1) }, { name: 'Faltas', color: C.falta, ...T.dia.col(2) }] });
  add(T.suc.n, { title: 'Retardos por sucursal (cantidad)', dir: 'bar', anchor: at(1, 'left'), cats: T.suc.cats,
    series: [{ name: 'Retardos', color: C.serie, ...T.suc.col(1) }] });
  add(T.suc.n, { title: 'Puntualidad por sucursal (%)', dir: 'bar', max: 100, anchor: at(1, 'right'), cats: T.suc.cats,
    series: [{ name: '% Puntualidad', color: C.serie, ...T.suc.col(2) }] });
  add(T.top.n, { title: 'Las 10 personas con más retardos', dir: 'bar', anchor: at(2, 'left'), cats: T.top.cats,
    series: [{ name: 'Retardos', color: C.serie, ...T.top.col(1) }] });
  add(T.semana.n, { title: 'Retardos por día de la semana', dir: 'col', anchor: at(2, 'right'), cats: T.semana.cats,
    series: [{ name: 'Retardos', color: C.serie, ...T.semana.col(1) }] });
  add(T.rangos.n, { title: '¿Qué tan tarde llegan? (cantidad de retardos)', dir: 'col', anchor: at(3, 'left'), cats: T.rangos.cats,
    series: [{ name: 'Retardos', color: C.rangos[2], pointColors: C.rangos, ...T.rangos.col(1) }] });
  add(T.suc.n, { title: 'Resultado de los días por sucursal', dir: 'col', stacked: true, anchor: at(3, 'right'), cats: T.suc.cats,
    series: [
      { name: 'Puntual', color: C.puntual, ...T.suc.col(4) },
      { name: 'Retardo', color: C.retardo, ...T.suc.col(1) },
      { name: 'Falta', color: C.falta, ...T.suc.col(3) },
      { name: 'Justificado', color: C.justificado, ...T.suc.col(5) },
      { name: 'Checada incompleta', color: C.incompleto, ...T.suc.col(6) },
    ] });

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return charts;
}

// ---------------------------------------------------------------- Calendario
function buildCalendar(wb, A) {
  const ws = wb.addWorksheet('Calendario', { views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }] });
  const fechas = A.fechasCal;
  ws.getCell(1, 1).value = 'Leyenda:';
  ws.getCell(1, 1).font = { bold: true };
  const leyenda = ['PUNTUAL', 'RETARDO', 'FALTA', 'JUSTIFICADO', 'INCOMPLETO', 'DÍA EXTRA', 'DESCANSO', 'SIN DATOS'];
  // Cada concepto de la leyenda ocupa 3 columnas de fecha para que el texto quepa.
  const corto = { INCOMPLETO: 'Incompleta', 'SIN DATOS': 'Sin datos' };
  leyenda.forEach((e, i) => {
    const col = 4 + i * 3;
    ws.mergeCells(1, col, 1, col + 2);
    const cell = ws.getCell(1, col);
    cell.value = `${CAL[e].letra} ${corto[e] || CAL[e].nombre}`;
    cell.fill = solid(FILL[e] || 'FFFFFFFF');
    cell.font = { size: 9 };
    cell.alignment = { horizontal: 'center' };
  });
  ws.getCell(2, 1).value = 'El número junto a la R son los minutos de retardo.';
  ws.getCell(2, 1).font = { size: 9, italic: true, color: { argb: MUTED } };

  const head = ['Empleado', 'No.', 'Sucursal', ...fechas.map((f) => `${'DLMMJVS'[new Date(`${f}T00:00:00Z`).getUTCDay()]} ${f.slice(8)}`), 'Retardos', 'Faltas', 'Justif.'];
  head.forEach((h, j) => {
    const cell = ws.getCell(3, j + 1);
    cell.value = h;
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(NAVY);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 7;
  ws.getColumn(3).width = 16;
  fechas.forEach((_, j) => (ws.getColumn(4 + j).width = 6));
  const end = 4 + fechas.length;
  [end, end + 1, end + 2].forEach((c) => (ws.getColumn(c).width = 9));

  A.calendario.forEach((p, i) => {
    const row = 4 + i;
    ws.getCell(row, 1).value = p.nombre;
    ws.getCell(row, 2).value = p.emp_code;
    ws.getCell(row, 3).value = p.sucursal;
    let r = 0, f = 0, jj = 0;
    p.dias.forEach((d, j) => {
      const cell = ws.getCell(row, 4 + j);
      cell.alignment = { horizontal: 'center' };
      cell.border = box;
      cell.font = { size: 9 };
      if (!d) return;
      const info = CAL[d.estado] || { letra: '' };
      cell.value = d.estado === 'RETARDO' ? `R ${d.retardo_min}` : info.letra;
      if (FILL[d.estado]) cell.fill = solid(FILL[d.estado]);
      if (d.estado === 'RETARDO') r++;
      if (d.estado === 'FALTA') f++;
      if (d.estado === 'JUSTIFICADO') jj++;
    });
    [r, f, jj].forEach((v, k) => {
      const cell = ws.getCell(row, end + k);
      cell.value = v;
      cell.font = { bold: !!v };
      cell.alignment = { horizontal: 'center' };
    });
  });
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

// ---------------------------------------------------------------- Libro completo
async function buildWorkbook({ from, to, result, punches, branches, employees, settings, justifications, generadoPor, today, sucursal }) {
  const A = analyze(result, { from, to, today, settings });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Control de Retardos - El Boom Tractopartes';
  wb.created = new Date();

  const charts = buildDashboard(wb, A, { from, to, generadoPor, sucursal, result });

  const porPersona = sheet(wb, 'Retardos por persona', [
    ['Sucursal', 'sucursal', 18], ['No.', 'emp_code', 8], ['Empleado', 'nombre', 32],
    ['Retardos (cantidad de días)', 'retardos', 14], ['Minutos de retardo', 'minutos_retardo', 12], ['Promedio por retardo (min)', 'promedio_retardo', 13],
    ['Retardo más grande (min)', 'retardo_mayor', 13], ['Día que más llega tarde', 'dia_frecuente', 16],
    ['Faltas', 'faltas', 9], ['Faltas por retardos', 'faltas_por_retardos', 11], ['Justificados', 'justificados', 11],
    ['% Puntualidad', 'puntualidad', 11], ['Días de trabajo', 'dias_laborables', 10], ['Asistió', 'asistencias', 9],
    ['Se pasó en la comida (días)', 'excesos_comida', 12], ['Checadas incompletas', 'incompletas', 12],
  ], A.personas, { xSplit: 3 });
  dataBar(porPersona, 4, A.personas.length, 'FFFAB219');
  dataBar(porPersona, 5, A.personas.length, 'FF2A78D6');
  dataBar(porPersona, 9, A.personas.length, 'FFD03B3B');

  const porDia = sheet(wb, 'Retardos por día', [
    ['Fecha', 'f', 12], ['Día', 'dia', 11], ['Personas evaluadas', 'evaluados', 12], ['Puntuales', 'puntual', 10],
    ['Retardos (cantidad)', 'retardos', 12], ['Minutos de retardo', 'minutos_retardo', 12], ['Faltas', 'faltas', 9],
    ['Justificados', 'justificados', 11], ['Checadas incompletas', 'incompletos', 12],
  ], A.fechas.map((f) => ({ ...f, f: fmtDate(f.fecha) })));
  dataBar(porDia, 5, A.fechas.length, 'FFFAB219');
  dataBar(porDia, 7, A.fechas.length, 'FFD03B3B');

  buildCalendar(wb, A);

  const withHours = (list) => list.map((t) => ({ ...t, horas_extra: Math.round((t.minutos_extra / 60) * 100) / 100 }));
  sheet(wb, 'Resumen sucursales', [['Sucursal', 'sucursal', 22], ['Empleados', 'empleados', 11], ...SUMMARY_COLS], withHours(result.branches));
  sheet(wb, 'Resumen empleados', [['Sucursal', 'sucursal', 20], ['No.', 'emp_code', 8], ['Empleado', 'nombre', 32], ...SUMMARY_COLS], withHours(result.employees), { xSplit: 3 });

  const detail = sheet(wb, 'Detalle diario', [
    ['Fecha', 'f', 12], ['Día', 'dia', 11], ['Sucursal', 'sucursal', 18], ['No.', 'emp_code', 8], ['Empleado', 'nombre', 30],
    ['Horario', 'horario', 13], ['Entrada', 'entrada', 10], ['Sale a comer', 'comida_salida', 11], ['Regresa de comer', 'comida_regreso', 11],
    ['Min. de comida', 'comida_min', 10], ['Salida', 'salida', 10], ['Horas trabajadas', 'horas', 10], ['Resultado', 'estado', 13],
    ['Min. de retardo', 'retardo_min', 10], ['Antes era', 'estado_original', 13], ['Justificación / nota', 'just', 40],
    ['Incidencias', 'incid', 34], ['Todas las checadas del día', 'checadas', 34], ['Explicación', 'regla', 60], ['Notas', 'notas', 40],
  ], result.days.map((d) => ({
    ...d,
    f: fmtDate(d.fecha),
    just: d.justificacion
      ? `${d.justificacion.justificado ? 'Justificado' : 'NO justificado'} · ${d.justificacion.tipo}${d.justificacion.hora_permiso ? ` (permiso hasta ${d.justificacion.hora_permiso})` : ''}: ${d.justificacion.nota} (${d.justificacion.autor})`
      : '',
    incid: d.incidencias.join('; '),
    checadas: d.checadas.map((t) => t.slice(0, 5)).join(', '),
    notas: d.notas.join('; '),
  })), { xSplit: 5 });
  detail.eachRow((row, i) => {
    if (i === 1) return;
    const color = FILL[row.getCell(13).value];
    if (color) row.getCell(13).fill = solid(color);
  });

  const bById = new Map(branches.map((b) => [b.id, b]));
  const eByKey = new Map(employees.map((e) => [`${e.branch_id}|${e.emp_code}`, e]));
  const nameOf = (e) => (e ? e.alias || `${e.first_name} ${e.last_name}`.trim() : '');
  sheet(wb, 'Checadas originales', [['Sucursal', 'sucursal', 20], ['No.', 'emp_code', 8], ['Empleado', 'nombre', 32], ['Fecha y hora', 'punch_time', 20], ['Origen', 'source', 12]],
    punches.filter((p) => p.punch_time.slice(0, 10) >= from).map((p) => {
      const b = bById.get(p.branch_id);
      return { ...p, sucursal: `${b.code} ${b.name}`, nombre: nameOf(eByKey.get(`${p.branch_id}|${p.emp_code}`)) };
    }));

  sheet(wb, 'Justificaciones', [['Fecha', 'f', 12], ['Sucursal', 'sucursal', 20], ['No.', 'emp_code', 8], ['Empleado', 'nombre', 28], ['¿Justificado?', 'si', 12],
    ['Tipo', 'tipo', 22], ['Permiso hasta', 'hora_permiso', 12], ['Por qué', 'nota', 40], ['Capturó', 'autor', 18], ['Capturado', 'creado', 18]],
    justifications.map((j) => ({
      ...j,
      f: fmtDate(j.fecha),
      si: j.justificado === 0 ? 'No' : 'Sí',
      sucursal: `${bById.get(j.branch_id).code} ${bById.get(j.branch_id).name}`,
      nombre: nameOf(eByKey.get(`${j.branch_id}|${j.emp_code}`)),
    })));

  const crit = sheet(wb, 'Criterios', [['Parámetro', 'k', 44], ['Valor', 'v', 80]], [
    { k: 'Periodo', v: `${fmtDate(from)} al ${fmtDate(to)}` },
    { k: 'Generado', v: `${new Date().toLocaleString('es-MX')} por ${generadoPor || '—'}` },
    { k: 'Tolerancia general (min)', v: settings.tolerancia_min },
    { k: 'Minutos de retardo', v: settings.retardo_desde === 'tolerancia' ? 'Se cuentan desde que termina la tolerancia' : 'Se cuentan desde la hora de entrada' },
    { k: 'Retardos que equivalen a una falta', v: settings.retardos_por_falta || 'No aplica' },
    { k: 'Retardo que cuenta como falta (min)', v: settings.retardo_falta_min || 'No aplica' },
    { k: 'Checadas repetidas', v: `Si vuelve a checar a menos de ${settings.duplicado_min} min de la anterior, solo cuenta la primera` },
    { k: 'Las 4 checadas', v: '1a entrada, 2a sale a comer, 3a regresa de comer, 4a salida' },
    { k: 'Comida', v: `Se permiten ${settings.comida_min} min + ${settings.comida_tolerancia_min} de tolerancia` },
    { k: 'Horas trabajadas', v: 'De la entrada a la salida, sin contar el tiempo de comida' },
    { k: 'Se fue antes', v: `Si su última checada es más de ${settings.salida_anticipada_min} min antes de su hora de salida` },
    { k: 'Tiempo extra al salir', v: settings.extra_min ? `Si se queda ${settings.extra_min} min o más después de su salida` : 'No se marca' },
    { k: 'Falta', v: 'No checó en un día de trabajo, siempre que el checador de la sucursal sí haya registrado a otras personas ese día' },
    { k: 'Día extra', v: 'Checadas en domingo o festivo (vigilancia, guardias o tiempo extra). No afecta la puntualidad' },
    { k: 'Posible baja', v: `Quien no checó en todo el periodo y ya tenía ${settings.dias_sin_checar}+ días de trabajo sin checar no genera faltas` },
    ...branches.map((b) => ({
      k: `Horario ${b.code} ${b.name}`,
      v: b.schedule.map((d, i) => `${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][i]} ${d.laborable ? `${d.entrada}-${d.salida}` : 'descanso'}`).join(' | ') +
        (b.tolerancia_min != null ? ` · tolerancia ${b.tolerancia_min} min` : ''),
    })),
  ]);
  crit.getColumn(2).alignment = { wrapText: true };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return addCharts(buffer, 1, charts);
}

module.exports = { buildWorkbook };
