const test = require('node:test');
const assert = require('node:assert/strict');
const { compute } = require('../src/engine');
const { parseTime, parseCsv, matchBranch } = require('../src/importer');
const { DEFAULT_WEEK, DEFAULT_SETTINGS } = require('../src/store');

const branch = { id: 1, code: '01', name: 'ALPUYECA', schedule: DEFAULT_WEEK, tolerancia_min: null };
const settings = { ...DEFAULT_SETTINGS };

// 2026-09-07 es lunes.
function run(punches, extra = {}) {
  return compute({
    from: '2026-09-07',
    to: '2026-09-13',
    today: '2026-10-28',
    branches: [branch],
    settings,
    employees: [{ branch_id: 1, emp_code: '7', first_name: 'Ana', last_name: 'López', activo: true }],
    punches: punches.map((t) => (Array.isArray(t) ? { branch_id: 1, emp_code: t[0], punch_time: t[1] } : { branch_id: 1, emp_code: '7', punch_time: t })),
    holidays: [],
    justifications: [],
    ...extra,
  });
}
const day = (r, fecha, code = '7') => r.days.find((d) => d.fecha === fecha && d.emp_code === code);

// Otro empleado que checa todos los días, para que la sucursal "tenga datos".
const otro = ['07', '08', '09', '10', '11', '12'].map((d) => ['99', `2026-09-${d} 08:50:00`]);

test('puntual dentro de la tolerancia y retardo fuera de ella', () => {
  const r = run([...otro, '2026-09-07 08:40:00', '2026-09-07 18:02:00', '2026-09-08 08:41:00', '2026-09-08 18:00:00']);
  assert.equal(day(r, '2026-09-07').estado, 'PUNTUAL');
  const d = day(r, '2026-09-08');
  assert.equal(d.estado, 'RETARDO');
  assert.equal(d.retardo_min, 11);
  assert.equal(d.horas, '9:19');
});

test('falta solo si la sucursal tuvo actividad ese día', () => {
  const r = run([['99', '2026-09-09 08:55:00'], '2026-09-07 08:59:00']);
  assert.equal(day(r, '2026-09-09').estado, 'FALTA');
  assert.equal(day(r, '2026-09-10').estado, 'SIN DATOS');
});

test('domingo es descanso y no genera falta', () => {
  const r = run([...otro, '2026-09-07 08:29:00']);
  assert.equal(day(r, '2026-09-13').estado, 'DESCANSO');
});

test('checar en domingo cuenta como día extra con sus horas', () => {
  const r = run([...otro, '2026-09-13 08:00:00', '2026-09-13 14:30:00']);
  const d = day(r, '2026-09-13');
  assert.equal(d.estado, 'DÍA EXTRA');
  assert.equal(d.minutos, 390);
  const e = r.employees.find((x) => x.emp_code === '7');
  assert.equal(e.dias_extra, 1);
  assert.equal(e.minutos_extra, 390);
});

test('sábado se evalúa con su propio horario (9:00)', () => {
  const r = run([...otro, '2026-09-12 09:08:00', '2026-09-12 15:00:00']);
  assert.equal(day(r, '2026-09-12').estado, 'PUNTUAL');
});

test('checadas repetidas se ignoran y una sola checada vespertina cuenta como salida', () => {
  const r = run([...otro, '2026-09-07 08:58:00', '2026-09-07 08:59:30', '2026-09-08 17:58:00']);
  const d1 = day(r, '2026-09-07');
  assert.deepEqual(d1.duplicadas, ['08:59:30']);
  assert.equal(d1.salida, null);
  assert.ok(d1.incidencias.includes('Sin checada de salida'));
  const d2 = day(r, '2026-09-08');
  assert.equal(d2.estado, 'INCOMPLETO');
  assert.equal(d2.salida, '17:58:00');
});

test('justificación cambia el estado y conserva el original', () => {
  const r = run([...otro, '2026-09-07 08:59:00'], {
    justifications: [{ id: 1, branch_id: 1, emp_code: '7', fecha: '2026-09-08', tipo: 'Incapacidad', nota: 'IMSS', autor: 'RH', creado: 'x' }],
  });
  const d = day(r, '2026-09-08');
  assert.equal(d.estado, 'JUSTIFICADO');
  assert.equal(d.estado_original, 'FALTA');
});

test('días festivos y fecha de baja', () => {
  const r = compute({
    from: '2026-09-14', to: '2026-09-18', today: '2026-10-28', branches: [branch], settings,
    employees: [{ branch_id: 1, emp_code: '7', first_name: 'A', last_name: 'B', activo: true, fecha_baja: '2026-09-16' }],
    punches: ['14', '15', '16', '17', '18'].map((d) => ({ branch_id: 1, emp_code: '99', punch_time: `2026-09-${d} 08:50:00` }))
      .concat([{ branch_id: 1, emp_code: '7', punch_time: '2026-09-01 09:00:00' }]),
    holidays: [{ fecha: '2026-09-16', descripcion: 'Independencia' }], justifications: [],
  });
  assert.equal(day(r, '2026-09-16').estado, 'FESTIVO');
  assert.equal(day(r, '2026-09-15').estado, 'FALTA');
  assert.equal(day(r, '2026-09-17'), undefined);
});

test('resumen: retardos equivalentes a falta y puntualidad', () => {
  const p = [...otro];
  for (const d of ['07', '08', '09', '10']) p.push(`2026-09-${d} 09:00:00`, `2026-09-${d} 18:00:00`);
  p.push('2026-09-11 08:25:00', '2026-09-11 18:00:00');
  const e = run(p).employees.find((x) => x.emp_code === '7');
  assert.equal(e.retardos, 4);
  assert.equal(e.minutos_retardo, 120);
  assert.equal(e.faltas_por_retardos, 1);
  assert.equal(e.puntualidad, 20);
  assert.equal(e.faltas, 1); // sábado 12 sin checar
});

test('importador: formatos de fecha y CSV', () => {
  assert.equal(parseTime('2026-09-01 08:05:09'), '2026-09-01 08:05:09');
  assert.equal(parseTime('01/09/2026 8:05'), '2026-09-01 08:05:00');
  assert.equal(parseTime('01/09/2026 06:05 p.m.'), '2026-09-01 18:05:00');
  assert.equal(parseTime(new Date(Date.UTC(2026, 8, 1, 8, 5, 0))), '2026-09-01 08:05:00');
  const rows = parseCsv('tienda;emp_code;punch_time\r\n"01 ALPUYECA";7;2026-09-01 08:00:00\r\n');
  assert.deepEqual(rows[1], ['01 ALPUYECA', '7', '2026-09-01 08:00:00']);
  assert.equal(matchBranch([branch], '01 ALPUYECA').id, 1);
  assert.equal(matchBranch([branch], 'alpuyeca').id, 1);
});

test('quien dejó de venir antes del periodo no genera faltas pero se avisa', () => {
  // Checó por última vez el lunes 31/08; el periodo empieza el 07/09.
  const r = run([...otro, '2026-08-31 08:25:00', '2026-08-31 18:00:00']);
  assert.equal(r.days.filter((d) => d.emp_code === '7').length, 0);
  assert.deepEqual(r.ausentes.map((a) => [a.emp_code, a.excluido]), [['7', true]]);
});

test('quien deja de venir durante el periodo sí genera faltas y se avisa', () => {
  const r = run([...otro, '2026-09-07 08:25:00', '2026-09-07 18:00:00']);
  assert.equal(r.employees.find((e) => e.emp_code === '7').faltas, 5);
  assert.deepEqual(r.ausentes.map((a) => [a.emp_code, a.excluido]), [['7', false]]);
});

test('checadas repetidas dentro de 10 min: solo cuenta la primera (08:35, 08:37, 08:44)', () => {
  const r = run([...otro, '2026-09-07 08:35:00', '2026-09-07 08:37:00', '2026-09-07 08:44:00', '2026-09-07 18:00:00']);
  const d = day(r, '2026-09-07');
  assert.equal(d.entrada, '08:35:00');
  assert.deepEqual(d.duplicadas, ['08:37:00', '08:44:00']);
  assert.equal(d.estado, 'PUNTUAL');
});

test('4 checadas: entrada, comida, regreso y salida; horas sin contar la comida', () => {
  const r = run([...otro, '2026-09-07 08:30:00', '2026-09-07 14:00:00', '2026-09-07 14:40:00', '2026-09-07 18:00:00']);
  const d = day(r, '2026-09-07');
  assert.equal(d.comida_salida, '14:00:00');
  assert.equal(d.comida_regreso, '14:40:00');
  assert.equal(d.comida_min, 40);
  assert.equal(d.exceso_comida_min, 0);
  assert.equal(d.horas, '8:50');
  assert.deepEqual(d.incidencias, []);
});

test('comida de más: 85 min con 40 permitidos y 10 de tolerancia', () => {
  const r = run([...otro, '2026-09-07 08:30:00', '2026-09-07 14:00:00', '2026-09-07 15:25:00', '2026-09-07 18:00:00']);
  const d = day(r, '2026-09-07');
  assert.equal(d.exceso_comida_min, 45);
  assert.equal(r.employees.find((e) => e.emp_code === '7').excesos_comida, 1);
});

test('3 checadas: detecta si falta la salida o una de la comida', () => {
  const r = run([...otro,
    '2026-09-07 08:30:00', '2026-09-07 14:00:00', '2026-09-07 15:00:00',
    '2026-09-08 08:30:00', '2026-09-08 14:00:00', '2026-09-08 18:00:00']);
  assert.ok(day(r, '2026-09-07').incidencias.includes('Sin checada de salida'));
  assert.ok(day(r, '2026-09-08').incidencias.includes('Le falta una checada de la comida'));
});

test('2 checadas entre semana: avisa que no checó la comida; sábado no', () => {
  const r = run([...otro, '2026-09-07 08:30:00', '2026-09-07 18:00:00', '2026-09-12 09:00:00', '2026-09-12 15:00:00']);
  assert.ok(day(r, '2026-09-07').incidencias.includes('No checó la salida ni el regreso de comer'));
  assert.deepEqual(day(r, '2026-09-12').incidencias, []);
});

test('retardo grave cuenta como falta y tiempo extra al salir', () => {
  const r = compute({
    from: '2026-09-07', to: '2026-09-07', today: '2026-10-28', branches: [branch],
    settings: { ...settings, retardo_falta_min: 30 },
    employees: [{ branch_id: 1, emp_code: '7', first_name: 'Ana', last_name: 'López', activo: true }],
    punches: ['2026-09-07 09:15:00', '2026-09-07 19:00:00'].map((t) => ({ branch_id: 1, emp_code: '7', punch_time: t })),
    holidays: [], justifications: [],
  });
  const d = r.days[0];
  assert.equal(d.retardo_grave, true);
  assert.equal(d.tiempo_extra_min, 60);
  assert.equal(r.employees[0].faltas_por_retardos, 1);
});

test('permiso para llegar a las 13:00: llegó 12:50 justificado; llegó 13:30 retardo de 30 min', () => {
  const just = (fecha) => ({ id: 1, branch_id: 1, emp_code: '7', fecha, tipo: 'Permiso para llegar tarde', nota: 'Cita médica', autor: 'RH', creado: 'x', justificado: 1, hora_permiso: '13:00' });
  const r = run([...otro, '2026-09-07 12:50:00', '2026-09-07 18:00:00', '2026-09-08 13:30:00', '2026-09-08 18:00:00'], {
    justifications: [just('2026-09-07'), just('2026-09-08')],
  });
  assert.equal(day(r, '2026-09-07').estado, 'JUSTIFICADO');
  const d = day(r, '2026-09-08');
  assert.equal(d.estado, 'RETARDO');
  assert.equal(d.retardo_min, 30);
});

test('no justificado: sigue contando como falta pero guarda el porqué', () => {
  const r = run([...otro, '2026-09-07 08:25:00'], {
    justifications: [{ id: 2, branch_id: 1, emp_code: '7', fecha: '2026-09-08', tipo: 'No justificado', nota: 'No avisó', autor: 'RH', creado: 'x', justificado: 0 }],
  });
  const d = day(r, '2026-09-08');
  assert.equal(d.estado, 'FALTA');
  assert.equal(d.justificacion.justificado, false);
  assert.equal(r.employees.find((e) => e.emp_code === '7').faltas, 5);
});

test('retardo contado desde la hora de entrada o desde el fin de la tolerancia', () => {
  const p = [...otro, '2026-09-07 08:41:00', '2026-09-07 18:00:00'];
  assert.equal(day(run(p), '2026-09-07').retardo_min, 11);
  const r = compute({
    from: '2026-09-07', to: '2026-09-07', today: '2026-10-28', branches: [branch],
    settings: { ...settings, retardo_desde: 'tolerancia' },
    employees: [], punches: p.map((t) => (Array.isArray(t) ? { branch_id: 1, emp_code: t[0], punch_time: t[1] } : { branch_id: 1, emp_code: '7', punch_time: t })),
    holidays: [], justifications: [],
  });
  assert.equal(day(r, '2026-09-07').retardo_min, 1);
});

test('de lunes a viernes la comida es después de las 14:00', () => {
  const r = run([...otro, '2026-09-07 08:30:00', '2026-09-07 13:20:00', '2026-09-07 14:00:00', '2026-09-07 18:00:00']);
  const d = day(r, '2026-09-07');
  assert.equal(d.comida_temprano, true);
  assert.ok(d.incidencias.includes('Salió a comer a las 13:20, antes de las 14:00'));
  assert.equal(r.employees.find((e) => e.emp_code === '7').comidas_antes, 1);
});

const { windowsFor, currentWindow } = require('../src/live');
const liveBranches = [{ ...branch, enabled: true }];
const at = (iso, hhmm) => new Date(`${iso}T${hhmm}:00`);

test('en vivo: horarios de consulta de lunes a viernes', () => {
  const w = windowsFor(at('2026-09-07', '10:00'), liveBranches, [], settings).map((x) => `${x.desde}-${x.hasta}/${x.cada}`);
  assert.deepEqual(w, ['08:00-09:30/5', '09:30-14:00/30', '14:00-15:20/10', '15:20-17:30/30', '17:30-19:00/5']);
});

test('en vivo: sábado sin comida, domingo solo vigilancia, de noche nada', () => {
  const sab = windowsFor(at('2026-09-12', '10:00'), liveBranches, [], settings).map((x) => `${x.desde}-${x.hasta}/${x.cada}`);
  assert.deepEqual(sab, ['08:30-10:00/5', '10:00-14:30/30', '14:30-16:00/5']);
  const dom = windowsFor(at('2026-09-13', '10:00'), liveBranches, [], settings).map((x) => `${x.desde}-${x.hasta}/${x.cada}`);
  assert.deepEqual(dom, ['08:00-16:00/60']);
  assert.equal(currentWindow(at('2026-09-07', '22:00'), liveBranches, [], settings), null);
  assert.equal(currentWindow(at('2026-09-07', '08:45'), liveBranches, [], settings).cada, 5);
});

test('en vivo: solo consulta en horario, con alguien viendo y respetando la frecuencia', async () => {
  const { createLive } = require('../src/live');
  let calls = 0;
  let cfg = { ...settings, mysql_host: 'servidor', auto_sync: true };
  const db = { getSettings: () => cfg, branches: () => liveBranches, holidays: () => [] };
  const live = createLive({ db, syncToday: async () => { calls++; return [{ ok: true, nuevos: 1 }]; } });

  await live.tick(at('2026-09-07', '08:40'));
  assert.equal(calls, 0, 'sin nadie viendo no consulta');

  live.status(at('2026-09-07', '08:40')); // alguien abrió el sistema
  await live.tick(at('2026-09-07', '08:40'));
  assert.equal(calls, 1, 'en horario de entrada consulta');
  await live.tick(at('2026-09-07', '08:42'));
  assert.equal(calls, 1, 'respeta la frecuencia de 5 min');
  await live.tick(at('2026-09-07', '08:45'));
  assert.equal(calls, 2);
  assert.equal(live.state.version, 2, 'avisa que hay checadas nuevas');

  await live.tick(at('2026-09-07', '22:00'));
  assert.equal(calls, 2, 'de noche no consulta');

  cfg = { ...cfg, auto_sync: false };
  await live.tick(at('2026-09-07', '18:00'));
  assert.equal(calls, 2, 'apagado no consulta');
});

test('QA: justificar un día puntual no le quita la puntualidad', () => {
  const r = run([...otro, '2026-09-07 08:30:00', '2026-09-07 14:00:00', '2026-09-07 15:30:00', '2026-09-07 18:00:00'], {
    justifications: [{ id: 9, branch_id: 1, emp_code: '7', fecha: '2026-09-07', tipo: 'Permiso con goce', nota: 'Trámite', autor: 'RH', creado: 'x', justificado: 1 }],
  });
  const d = day(r, '2026-09-07');
  assert.equal(d.estado, 'PUNTUAL');
  assert.equal(d.incidencias_justificadas, true);
  const e = r.employees.find((x) => x.emp_code === '7');
  assert.equal(e.excesos_comida, 0, 'la comida larga quedó justificada');
  assert.equal(e.puntuales, 1);
});

test('QA: si se va antes de la hora de comida no se reclama la comida', () => {
  const r = run([...otro, '2026-09-07 08:30:00', '2026-09-07 12:00:00']);
  const d = day(r, '2026-09-07');
  assert.ok(!d.incidencias.includes('No checó la salida ni el regreso de comer'));
  assert.ok(d.incidencias.some((i) => i.startsWith('Se fue')));
});

test('QA: las cuentas marcadas como "no es una persona" no se evalúan', () => {
  const r = run([...otro, '2026-09-07 08:30:00'], {
    employees: [{ branch_id: 1, emp_code: '7', first_name: 'ADMIN', last_name: '', activo: true, excluir: true }],
  });
  assert.equal(r.days.filter((d) => d.emp_code === '7').length, 0);
});

test('QA: detecta nombres incompletos (iniciales o sin apellido)', () => {
  const { isShortName } = require('../src/engine');
  assert.equal(isShortName({ first_name: 'Jrb', last_name: '' }), true);
  assert.equal(isShortName({ first_name: 'Carolina', last_name: '' }), true);
  assert.equal(isShortName({ first_name: '', last_name: '' }), true);
  assert.equal(isShortName({ first_name: 'PERLA', last_name: 'ANGEL FLORES' }), false);
  assert.equal(isShortName({ first_name: 'Ana Luz', last_name: '' }), false);
});

// ---------------------------------------------------------------- misma persona en dos sucursales
const aca = { id: 3, code: '03', name: 'ACAPULCO', schedule: DEFAULT_WEEK, tolerancia_min: null };
const linked = (principal = '1|7') => [
  { branch_id: 1, emp_code: '7', first_name: 'Ana', last_name: 'López', activo: true },
  { branch_id: 3, emp_code: '45', first_name: 'Ana', last_name: 'L', activo: true, principal },
];
const punchAt = (b, code, t) => ({ branch_id: b, emp_code: code, punch_time: t });

test('vinculada: los días que checó en otra sucursal no son falta y se dice dónde', () => {
  const r = compute({
    from: '2026-09-07', to: '2026-09-08', today: '2026-10-28', branches: [branch], allBranches: [branch, aca], settings,
    employees: linked(), holidays: [], justifications: [],
    punches: [
      ...otro.map(([c, t]) => punchAt(1, c, t)),
      punchAt(1, '7', '2026-09-07 08:30:00'),
      punchAt(3, '45', '2026-09-08 08:31:00'), punchAt(3, '45', '2026-09-08 18:00:00'),
    ],
  });
  const d = day(r, '2026-09-08');
  assert.equal(d.estado, 'PUNTUAL');
  assert.deepEqual(d.checadas_lugar, ['03 ACAPULCO', '03 ACAPULCO']);
  assert.ok(d.notas.includes('Checó en 03 ACAPULCO'));
  // Su número de Acapulco no aparece como otra persona.
  assert.equal(r.employees.length, 2);
  assert.ok(!r.days.some((x) => x.emp_code === '45'));
  assert.equal(r.vinculos[0].otros[0].emp_code, '45');
});

test('vinculada: sin vínculo cuenta como dos personas (comportamiento anterior)', () => {
  const r = compute({
    from: '2026-09-08', to: '2026-09-08', today: '2026-10-28', branches: [branch, aca], settings,
    employees: linked(null), holidays: [], justifications: [],
    punches: [punchAt(1, '99', '2026-09-08 08:50:00'), punchAt(1, '7', '2026-09-07 08:30:00'), punchAt(3, '45', '2026-09-08 08:31:00')],
  });
  assert.equal(day(r, '2026-09-08').estado, 'FALTA');
  assert.equal(day(r, '2026-09-08', '45').estado, 'PUNTUAL');
});

test('vinculada: la justificación capturada con el otro número sigue valiendo', () => {
  const r = compute({
    from: '2026-09-08', to: '2026-09-08', today: '2026-10-28', branches: [branch], settings,
    employees: linked(), holidays: [],
    justifications: [{ id: 1, branch_id: 3, emp_code: '45', fecha: '2026-09-08', tipo: 'Comisión de trabajo', nota: 'x', autor: 'RH', creado: '' }],
    punches: [punchAt(1, '99', '2026-09-08 08:50:00'), punchAt(1, '7', '2026-09-07 08:30:00')],
  });
  assert.equal(day(r, '2026-09-08').estado, 'JUSTIFICADO');
});

test('resúmenes recalculados a partir de días (quincena cerrada) dan lo mismo', () => {
  const { summaries } = require('../src/engine');
  const r = run([...otro, '2026-09-07 08:50:00', '2026-09-08 08:30:00']);
  assert.deepEqual(summaries(r.days, settings), { employees: r.employees, branches: r.branches });
});
