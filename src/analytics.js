// Indicadores y agregados para los reportes (Excel y PDF). Parte del resultado
// del motor, así ambos reportes muestran exactamente las mismas cifras.
const { DIAS, eachDay } = require('./engine');

const EVALUADOS = ['PUNTUAL', 'RETARDO', 'FALTA', 'INCOMPLETO', 'JUSTIFICADO'];
const DIAS_SEMANA = [1, 2, 3, 4, 5, 6]; // lunes a sábado
// Rangos de minutos de retardo, ordenados de menor a mayor. Empiezan en el
// retardo más chico posible: con 10 min de tolerancia contados desde la hora
// de entrada es 11 min; contados desde el fin de la tolerancia, 1 min.
function rangos(settings) {
  const lo = settings.retardo_desde === 'tolerancia' ? 1 : (settings.tolerancia_min || 0) + 1;
  const cuts = [[lo, lo + 4], [lo + 5, lo + 9], [lo + 10, Math.max(lo + 19, 30)], [Math.max(lo + 20, 31), 60], [61, Infinity]];
  return cuts.filter(([a, b]) => a <= b).map(([a, b]) => [b === Infinity ? 'Más de 60 min' : `${a} a ${b} min`, a, b]);
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const sum = (list, k) => list.reduce((n, x) => n + (x[k] || 0), 0);
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

function analyze(result, { from, to, today, settings = {} }) {
  const days = result.days;
  const ret = days.filter((d) => d.estado === 'RETARDO');
  const T = result.branches;
  const evaluables = sum(T, 'puntuales') + sum(T, 'retardos');
  const peor = ret.reduce((m, d) => (!m || d.retardo_min > m.retardo_min ? d : m), null);

  const kpis = {
    empleados: result.employees.length,
    dias_laborables: sum(T, 'dias_laborables'),
    puntualidad: pct(sum(T, 'puntuales'), evaluables),
    asistencia: pct(sum(T, 'asistencias') + sum(T, 'justificados'), sum(T, 'dias_laborables')),
    retardos: ret.length,
    personas_con_retardo: new Set(ret.map((d) => `${d.branch_id}|${d.emp_code}`)).size,
    minutos_retardo: sum(T, 'minutos_retardo'),
    promedio_retardo: ret.length ? Math.round(sum(T, 'minutos_retardo') / ret.length) : 0,
    retardo_mayor: peor ? { nombre: peor.nombre, minutos: peor.retardo_min, fecha: peor.fecha } : null,
    faltas: sum(T, 'faltas'),
    faltas_por_retardos: sum(T, 'faltas_por_retardos'),
    justificados: sum(T, 'justificados'),
    no_justificados: days.filter((d) => d.justificacion && !d.justificacion.justificado).length,
    incompletas: sum(T, 'incompletos') + sum(T, 'sin_salida'),
    excesos_comida: sum(T, 'excesos_comida'),
    comida_sin_checar: sum(T, 'comida_sin_checar'),
    salidas_anticipadas: sum(T, 'salidas_anticipadas'),
    dias_extra: sum(T, 'dias_extra'),
    horas_extra: Math.round((sum(T, 'minutos_extra') / 60) * 10) / 10,
    dias_tiempo_extra: sum(T, 'dias_tiempo_extra'),
    sin_datos: sum(T, 'sin_datos'),
  };

  const sucursales = T.map((b) => ({
    sucursal: b.sucursal,
    empleados: b.empleados,
    puntualidad: b.puntualidad,
    asistencia: b.asistencia,
    retardos: b.retardos,
    minutos_retardo: b.minutos_retardo,
    faltas: b.faltas,
    justificados: b.justificados,
    incompletas: b.incompletos + b.sin_salida,
    excesos_comida: b.excesos_comida,
  }));

  // Por fecha: cuántas personas tuvieron cada resultado ese día.
  const ultimo = to < today ? to : today;
  const fechas = eachDay(from, ultimo)
    .map((fecha) => {
      const del = days.filter((d) => d.fecha === fecha && EVALUADOS.includes(d.estado));
      const c = (e) => del.filter((d) => d.estado === e).length;
      return {
        fecha,
        dia: DIAS[weekday(fecha)],
        evaluados: del.length,
        puntual: c('PUNTUAL'),
        retardos: c('RETARDO'),
        faltas: c('FALTA'),
        justificados: c('JUSTIFICADO'),
        incompletos: c('INCOMPLETO'),
        minutos_retardo: del.reduce((n, d) => n + (d.estado === 'RETARDO' ? d.retardo_min : 0), 0),
      };
    })
    .filter((f) => f.evaluados > 0);

  // Por día de la semana: total y promedio por cada vez que ocurrió ese día.
  const diasSemana = DIAS_SEMANA.map((w) => {
    const fs = fechas.filter((f) => weekday(f.fecha) === w);
    const r = sum(fs, 'retardos');
    const f = sum(fs, 'faltas');
    return {
      dia: DIAS[w],
      veces: fs.length,
      retardos: r,
      faltas: f,
      retardos_promedio: fs.length ? Math.round((r / fs.length) * 10) / 10 : 0,
    };
  }).filter((d) => d.veces > 0);

  const porRango = rangos(settings).map(([rango, a, b]) => ({ rango, retardos: ret.filter((d) => d.retardo_min >= a && d.retardo_min <= b).length }));

  // Por persona: cantidad de retardos (días con retardo), minutos y el día que más se repite.
  const personas = result.employees
    .map((e) => {
      const mios = ret.filter((d) => d.branch_id === e.branch_id && d.emp_code === e.emp_code);
      const porDia = {};
      for (const d of mios) porDia[d.dia] = (porDia[d.dia] || 0) + 1;
      const frecuente = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0];
      return {
        nombre: e.nombre,
        emp_code: e.emp_code,
        sucursal: e.sucursal,
        dias_laborables: e.dias_laborables,
        asistencias: e.asistencias,
        retardos: e.retardos,
        minutos_retardo: e.minutos_retardo,
        promedio_retardo: e.retardos ? Math.round(e.minutos_retardo / e.retardos) : 0,
        retardo_mayor: mios.reduce((m, d) => Math.max(m, d.retardo_min), 0),
        dia_frecuente: frecuente && frecuente[1] > 1 ? `${frecuente[0]} (${frecuente[1]})` : '',
        faltas: e.faltas,
        faltas_por_retardos: e.faltas_por_retardos || 0,
        justificados: e.justificados,
        puntualidad: e.puntualidad,
        excesos_comida: e.excesos_comida,
        incompletas: e.incompletos + e.sin_salida,
      };
    })
    .sort((a, b) => b.retardos - a.retardos || b.minutos_retardo - a.minutos_retardo || a.nombre.localeCompare(b.nombre, 'es'));

  const topRetardos = personas.filter((p) => p.retardos).slice(0, 10);
  const topFaltas = [...personas].filter((p) => p.faltas).sort((a, b) => b.faltas - a.faltas).slice(0, 10);

  // Calendario: una fila por persona y una columna por fecha.
  const fechasCal = eachDay(from, to);
  const byKey = new Map(days.map((d) => [`${d.branch_id}|${d.emp_code}|${d.fecha}`, d]));
  const calendario = result.employees.map((e) => ({
    nombre: e.nombre,
    emp_code: e.emp_code,
    sucursal: e.sucursal,
    dias: fechasCal.map((f) => byKey.get(`${e.branch_id}|${e.emp_code}|${f}`) || null),
  }));

  return { kpis, sucursales, fechas, diasSemana, rangos: porRango, personas, topRetardos, topFaltas, calendario, fechasCal };
}

// Letra y color de cada resultado en el calendario.
const CAL = {
  PUNTUAL: { letra: '✓', nombre: 'Puntual' },
  RETARDO: { letra: 'R', nombre: 'Retardo' },
  FALTA: { letra: 'F', nombre: 'Falta' },
  JUSTIFICADO: { letra: 'J', nombre: 'Justificado' },
  INCOMPLETO: { letra: 'I', nombre: 'Checada incompleta' },
  'DÍA EXTRA': { letra: 'E', nombre: 'Día extra' },
  DESCANSO: { letra: '·', nombre: 'Descanso' },
  FESTIVO: { letra: 'Fe', nombre: 'Festivo' },
  'SIN DATOS': { letra: '?', nombre: 'Sin datos del checador' },
  PENDIENTE: { letra: '', nombre: 'Aún no ocurre' },
};

module.exports = { analyze, CAL };
