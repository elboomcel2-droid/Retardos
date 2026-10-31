const test = require('node:test');
const assert = require('node:assert/strict');
const ins = require('../src/insights');
const { llegadas } = require('../src/analytics');

const emp = (code, extra = {}) => ({ branch_id: 1, emp_code: code, nombre: `Persona ${code}`, sucursal: '01 ALPUYECA', retardos: 0, retardos_graves: 0, faltas: 0, faltas_por_retardos: 0, incompletos: 0, sin_salida: 0, puntuales: 10, dias_laborables: 12, ...extra });
const dia = (code, fecha, estado, extra = {}) => ({ branch_id: 1, emp_code: code, nombre: `Persona ${code}`, sucursal: '01 ALPUYECA', fecha, estado, incidencias: [], exceso_comida_min: 0, salida_anticipada_min: 0, ...extra });
const q = (from, to, employees, days = []) => ({ from, to, result: { employees, days, branches: [] } });

test('quincenas: 1–15 y 16–fin de mes, también en febrero', () => {
  assert.deepEqual(ins.quincenaDe('2026-10-08'), { from: '2026-10-01', to: '2026-10-15' });
  assert.deepEqual(ins.quincenaDe('2026-02-20'), { from: '2026-02-16', to: '2026-02-28' });
  assert.deepEqual(ins.quincenasHasta('2026-01-05', 3).map((x) => x.from), ['2025-12-01', '2025-12-16', '2026-01-01']);
});

test('periodo anterior: quincena, mes o mismos días; a medio periodo compara hasta el mismo día', () => {
  assert.deepEqual(ins.periodoAnterior('2026-10-01', '2026-10-15'), { from: '2026-09-16', to: '2026-09-30', tipo: 'quincena' });
  assert.deepEqual(ins.periodoAnterior('2026-10-01', '2026-10-31'), { from: '2026-09-01', to: '2026-09-30', tipo: 'mes' });
  assert.deepEqual(ins.periodoAnterior('2026-10-10', '2026-10-16'), { from: '2026-10-03', to: '2026-10-09', tipo: 'dias' });
  const r = ins.rangoComparable('2026-10-16', '2026-10-31', '2026-10-20');
  assert.equal(r.from, '2026-10-01');
  assert.equal(r.to, '2026-10-05');
  assert.equal(r.parcial, true);
});

test('comparar: indica si mejoró según el indicador', () => {
  const c = ins.comparar({ puntualidad: 90, retardos: 5, minutos_retardo: 50 }, { empleados: 3, puntualidad: 85, retardos: 8, minutos_retardo: 50 });
  assert.deepEqual(c.puntualidad, { actual: 90, anterior: 85, delta: 5, mejor: true });
  assert.equal(c.retardos.mejor, true);
  assert.equal(c.minutos_retardo.mejor, null);
  assert.equal(ins.comparar({}, { empleados: 0 }), null);
});

test('casos: reincidente, a un retardo de falta y patrón del mismo día', () => {
  const lunes = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];
  const hist = [
    q('2026-09-16', '2026-09-30', [emp('7', { retardos: 1 })]),
    q('2026-10-01', '2026-10-15', [emp('7', { retardos: 2 })], lunes.slice(0, 2).map((f) => dia('7', f, 'RETARDO'))),
    q('2026-10-16', '2026-10-31', [emp('7', { retardos: 2 }), emp('8')], lunes.slice(2).map((f) => dia('7', f, 'RETARDO'))),
  ];
  const actual = hist[2].result;
  const c = ins.casos({ hist, actual, settings: { retardos_por_falta: 3 }, acciones: [{ branch_id: 1, emp_code: '7', fecha: '2026-10-20', tipo: 'Plática verbal' }] });
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].motivos.map((m) => m.tipo).sort(), ['cerca_falta', 'patron_dia', 'reincidente']);
  assert.match(c[0].motivos.find((m) => m.tipo === 'patron_dia').texto, /lunes \(4 de 4\)/);
  assert.deepEqual(c[0].ultima_accion, { fecha: '2026-10-20', tipo: 'Plática verbal' });
});

test('honor: puntualidad perfecta y racha que no se corta con descansos ni justificados', () => {
  const days = [dia('7', '2026-10-01', 'RETARDO')];
  for (let d = 2; d <= 14; d++) days.push(dia('7', `2026-10-${String(d).padStart(2, '0')}`, d === 4 ? 'DESCANSO' : d === 8 ? 'JUSTIFICADO' : 'PUNTUAL'));
  const actual = { employees: [emp('7', { retardos: 1 }), emp('8', { puntuales: 6 })], days };
  const h = ins.honor({ hist: [q('2026-10-01', '2026-10-15', actual.employees, days)], actual });
  assert.deepEqual(h.perfectos.map((p) => p.emp_code), ['8']);
  assert.equal(h.rachas[0].dias, 11);
  assert.equal(h.rachas[0].desde, '2026-10-02');
});

test('calidad: checador sin checadas es rojo; nombres por completar, amarillo', () => {
  const week = [{ laborable: false }, ...Array(6).fill({ laborable: true })];
  const branches = [{ id: 1, code: '01', name: 'A', schedule: week }, { id: 2, code: '02', name: 'B', schedule: week }];
  const coverage = new Map([[1, { hasta: '2026-10-20 18:00:00' }], [2, { hasta: '2026-10-29 18:00:00' }]]);
  const result = { days: [], sinNombre: [{ branch_id: 2 }] };
  const [a, b] = ins.calidad({ branches, coverage, result, from: '2026-10-16', to: '2026-10-31', today: '2026-10-30' });
  assert.equal(a.nivel, 'rojo');
  assert.equal(a.dias_sin_checadas, 8); // 21 al 29 de octubre sin el domingo
  assert.equal(b.nivel, 'amarillo');
});

test('llegadas: agrupa contra la hora de entrada de ese día y deja fuera permisos', () => {
  const base = { horario: '08:30–18:00', tolerancia_min: 10 };
  const L = llegadas([
    dia('7', '2026-10-05', 'PUNTUAL', { ...base, entrada: '08:10:00' }),
    dia('7', '2026-10-06', 'PUNTUAL', { ...base, entrada: '08:38:00' }),
    dia('7', '2026-10-07', 'RETARDO', { ...base, entrada: '08:45:00' }),
    dia('7', '2026-10-10', 'RETARDO', { horario: '09:00–15:00', tolerancia_min: 10, entrada: '09:50:00' }),
    dia('7', '2026-10-08', 'RETARDO', { ...base, entrada: '11:00:00', justificacion: { hora_permiso: '10:30' } }),
  ]);
  assert.deepEqual(L.filas.map((f) => f.total), [1, 0, 1, 1, 0, 1]);
  assert.equal(L.filas[5].valores[5], 1); // sábado
  assert.equal(L.total, 4);
});

test('resumen: frases con la comparación y el aviso de datos no confiables', () => {
  const r = ins.resumen({
    kpis: { puntualidad: 90, retardos: 0, faltas: 2, faltas_por_retardos: 0 },
    comparativo: { tipo: 'quincena', parcial: false, metricas: { puntualidad: { delta: 3 }, faltas: { delta: -1 } } },
    calidad: [{ nivel: 'rojo', sucursal: '04 X', motivos: ['No hay checadas desde el 20/04/2026'] }],
  });
  assert.equal(r[0], 'La puntualidad general fue de 90%, 3 punto(s) más que la quincena anterior.');
  assert.match(r.at(-1), /^Atención: en 04 X no hay checadas desde el 20\/04\/2026; sus cifras no son confiables\.$/);
});
