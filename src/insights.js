// Lectura de los datos para RH: comparación contra el periodo anterior,
// tendencia por quincena, personas que requieren atención, cuadro de honor,
// qué tan confiables son los datos y un resumen en palabras.
// Son funciones puras: reciben resultados ya calculados por el motor y no leen
// la base, así cada cifra se puede reproducir igual que las del reporte.
const { addDays, eachDay } = require('./engine');

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
// Quincenas que se revisan para la tendencia, los reincidentes y las rachas.
const QUINCENAS = 6;
// Ventana (en quincenas) para buscar patrones: casi 6 semanas.
const VENTANA_PATRONES = 3;

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (s) => (s ? s.split('-').reverse().join('/') : '');
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const keyOf = (x) => `${x.branch_id}|${x.emp_code}`;
const uno = (n) => (Math.round(n * 10) / 10).toString();

// ---------------------------------------------------------------- periodos
// Las nóminas se pagan por quincena: del 1 al 15 y del 16 al fin de mes.
function quincenaDe(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return d <= 15 ? { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-15` } : { from: `${y}-${pad(m)}-16`, to: `${y}-${pad(m)}-${lastDay(y, m)}` };
}

// Las últimas n quincenas (de la más antigua a la que contiene la fecha).
function quincenasHasta(iso, n = QUINCENAS) {
  const out = [quincenaDe(iso)];
  while (out.length < n) out.unshift(quincenaDe(addDays(out[0].from, -1)));
  return out;
}

const etiquetaQuincena = ({ from, to }) => `${Number(from.slice(8))}–${Number(to.slice(8))} ${MESES[Number(from.slice(5, 7)) - 1]}`;

// Con qué se compara: la quincena anterior, el mes anterior o, en fechas
// libres, los mismos días justo antes.
function periodoAnterior(from, to) {
  const q = quincenaDe(from);
  if (q.from === from && q.to === to) return { ...quincenaDe(addDays(from, -1)), tipo: 'quincena' };
  const [y, m] = to.split('-').map(Number);
  if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') && Number(to.slice(8)) === lastDay(y, m)) {
    const fin = addDays(from, -1);
    return { from: `${fin.slice(0, 8)}01`, to: fin, tipo: 'mes' };
  }
  const n = eachDay(from, to).length;
  return { from: addDays(from, -n), to: addDays(from, -1), tipo: 'dias' };
}

// Si el periodo aún no termina, se compara contra el anterior hasta el mismo
// día (ej. del 1 al 8 contra del 16 al 23): si no, los retardos de media
// quincena siempre parecerían "menos".
function rangoComparable(from, to, today) {
  const prev = periodoAnterior(from, to);
  if (to <= today || from > today) return { ...prev, parcial: false };
  const hasta = addDays(prev.from, eachDay(from, today).length - 1);
  return hasta < prev.to ? { ...prev, to: hasta, parcial: true } : { ...prev, parcial: false };
}

const REF = { quincena: 'la quincena anterior', mes: 'el mes anterior', dias: 'el periodo anterior' };
const refTexto = (c) => `${REF[c.tipo]}${c.parcial ? ' a la misma altura' : ''}`;

// ---------------------------------------------------------------- comparativo
// [indicador, ¿es mejor que suba?]
const METRICAS = [
  ['puntualidad', true],
  ['asistencia', true],
  ['retardos', false],
  ['minutos_retardo', false],
  ['personas_con_retardo', false],
  ['faltas', false],
  ['faltas_por_retardos', false],
  ['incompletas', false],
  ['excesos_comida', false],
];

function comparar(K, P) {
  if (!P || !P.empleados) return null;
  const out = {};
  for (const [k, sube] of METRICAS) {
    const a = K[k];
    const b = P[k];
    if (a == null || b == null) {
      out[k] = null;
      continue;
    }
    const delta = Math.round((a - b) * 10) / 10;
    out[k] = { actual: a, anterior: b, delta, mejor: delta === 0 ? null : delta > 0 === sube };
  }
  return out;
}

// ---------------------------------------------------------------- tendencia
function totales(branches) {
  const s = (k) => branches.reduce((n, b) => n + (b[k] || 0), 0);
  const ev = s('puntuales') + s('retardos');
  return {
    puntualidad: ev ? Math.round((s('puntuales') / ev) * 1000) / 10 : null,
    retardos: s('retardos'),
    minutos_retardo: s('minutos_retardo'),
    faltas: s('faltas'),
    empleados: s('empleados'),
  };
}

// hist: [{ from, to, result }] de la quincena más antigua a la más reciente.
// slot: posición fija de cada sucursal (su color no cambia aunque se filtre).
function tendencia(hist, slot = () => 0) {
  return hist.map((h) => ({
    from: h.from,
    to: h.to,
    etiqueta: etiquetaQuincena(h),
    total: totales(h.result.branches),
    sucursales: h.result.branches.map((b) => ({
      branch_id: b.branch_id,
      sucursal: b.sucursal,
      slot: slot(b.branch_id),
      empleados: b.empleados,
      puntualidad: b.puntualidad,
      retardos: b.retardos,
      minutos_retardo: b.minutos_retardo,
      faltas: b.faltas,
    })),
  }));
}

// ---------------------------------------------------------------- casos de atención
const sinJustificar = (d) => d.estado !== 'JUSTIFICADO' && !d.incidencias_justificadas;

// Personas a las que conviene hablarles: reincidentes, las que empeoraron, las
// que están a un retardo de que se les cuente una falta y patrones repetidos.
function casos({ hist, actual, settings, acciones = [] }) {
  const lista = new Map();
  const add = (e, tipo, texto, peso) => {
    const k = keyOf(e);
    if (!lista.has(k)) {
      lista.set(k, { branch_id: e.branch_id, emp_code: e.emp_code, nombre: e.nombre, sucursal: e.sucursal, nombre_incompleto: e.nombre_incompleto, retardos: e.retardos ?? 0, motivos: [], peso: 0 });
    }
    const c = lista.get(k);
    c.motivos.push({ tipo, texto });
    c.peso += peso;
  };
  const Q = hist.map((h) => new Map(h.result.employees.map((e) => [keyOf(e), e])));
  const last = Q.length - 1;
  const enPeriodo = new Map(actual.employees.map((e) => [keyOf(e), e]));

  if (last >= 2) {
    for (const [k, e] of Q[last]) {
      const serie = [Q[last - 2].get(k), Q[last - 1].get(k), e];
      if (serie.every((x) => x && x.retardos > 0)) {
        add(enPeriodo.get(k) || e, 'reincidente', `Llegó tarde en las últimas 3 quincenas seguidas (${serie.map((x) => x.retardos).join(', ')} retardos)`, 3);
      }
    }
  }

  if (last >= 2) {
    for (const [k, e] of Q[last]) {
      const antes = Q.slice(0, last).map((m) => m.get(k)).filter((x) => x && x.dias_laborables >= 5);
      if (antes.length < 2) continue;
      const prom = antes.reduce((n, x) => n + x.retardos, 0) / antes.length;
      if (e.retardos >= 3 && e.retardos >= 2 * prom && e.retardos - prom >= 2) {
        add(enPeriodo.get(k) || e, 'empeoro', `Empeoró: ${e.retardos} retardos en la quincena del ${etiquetaQuincena(hist[last])}; antes promediaba ${uno(prom)}`, 2);
      }
    }
  }

  // Misma regla que el reporte: cada N retardos (sin contar los graves) = 1 falta.
  const rpf = settings.retardos_por_falta || 0;
  if (rpf >= 2) {
    for (const e of actual.employees) {
      const normales = e.retardos - (e.retardos_graves || 0);
      if (normales > 0 && normales % rpf === rpf - 1) add(e, 'cerca_falta', `Lleva ${e.retardos} retardo(s) en el periodo: con 1 más se le cuenta ${e.faltas_por_retardos ? 'otra' : 'una'} falta`, 2);
    }
  }

  // Patrones en las últimas quincenas (unas 6 semanas).
  const porPersona = new Map();
  for (const h of hist.slice(-VENTANA_PATRONES)) {
    for (const d of h.result.days) {
      const k = keyOf(d);
      if (!porPersona.has(k)) porPersona.set(k, []);
      porPersona.get(k).push(d);
    }
  }
  const semanas = `en las últimas ${Math.min(VENTANA_PATRONES, hist.length) * 2} semanas`;
  for (const [k, days] of porPersona) {
    const e = enPeriodo.get(k) || Q[last]?.get(k);
    if (!e) continue;
    const porDia = {};
    for (const d of days) {
      if (!['PUNTUAL', 'RETARDO'].includes(d.estado)) continue;
      const w = weekday(d.fecha);
      porDia[w] = porDia[w] || { ev: 0, tarde: 0 };
      porDia[w].ev++;
      if (d.estado === 'RETARDO') porDia[w].tarde++;
    }
    for (const [w, x] of Object.entries(porDia)) {
      if (x.tarde >= 3 && x.tarde / x.ev >= 0.6) add(e, 'patron_dia', `Suele llegar tarde los ${DIAS_PLURAL[w]} (${x.tarde} de ${x.ev})`, 1);
    }
    const comida = days.filter((d) => d.exceso_comida_min > 0 && sinJustificar(d)).length;
    if (comida >= 3) add(e, 'patron_comida', `Se pasó en la comida ${comida} veces ${semanas}`, 1);
    const antes = days.filter((d) => d.salida_anticipada_min > 0 && sinJustificar(d)).length;
    if (antes >= 3) add(e, 'patron_salida', `Se fue antes de su hora ${antes} veces ${semanas}`, 1);
  }

  // Última plática, acta o compromiso registrado con la persona.
  const ultima = new Map();
  for (const a of acciones) {
    const k = keyOf(a);
    if (!ultima.has(k) || a.fecha > ultima.get(k).fecha) ultima.set(k, { fecha: a.fecha, tipo: a.tipo });
  }
  return [...lista.values()]
    .map((c) => ({ ...c, ultima_accion: ultima.get(keyOf(c)) || null }))
    .sort((a, b) => b.peso - a.peso || b.retardos - a.retardos || a.nombre.localeCompare(b.nombre, 'es'));
}

// ---------------------------------------------------------------- cuadro de honor
// Puntualidad perfecta en el periodo y las rachas de días seguidos a tiempo.
// La racha no se rompe con descansos, festivos, justificados ni días sin datos.
function honor({ hist, actual, minDias = 5 }) {
  const perfectos = actual.employees
    .filter((e) => !e.retardos && !e.faltas && !e.incompletos && !e.sin_salida && e.puntuales >= minDias)
    .map((e) => ({ branch_id: e.branch_id, emp_code: e.emp_code, nombre: e.nombre, sucursal: e.sucursal, puntuales: e.puntuales }))
    .sort((a, b) => b.puntuales - a.puntuales || a.nombre.localeCompare(b.nombre, 'es'));

  const enPeriodo = new Set(actual.employees.map(keyOf));
  const porPersona = new Map();
  for (const h of hist) {
    for (const d of h.result.days) {
      if (!enPeriodo.has(keyOf(d))) continue;
      if (!porPersona.has(keyOf(d))) porPersona.set(keyOf(d), []);
      porPersona.get(keyOf(d)).push(d);
    }
  }
  const rachas = [];
  for (const days of porPersona.values()) {
    days.sort((a, b) => a.fecha.localeCompare(b.fecha));
    let n = 0;
    let desde = null;
    for (let i = days.length - 1; i >= 0; i--) {
      const e = days[i].estado;
      if (e === 'PUNTUAL') {
        n++;
        desde = days[i].fecha;
      } else if (['RETARDO', 'FALTA', 'INCOMPLETO'].includes(e)) break;
    }
    if (n >= 10) {
      const d = days[days.length - 1];
      rachas.push({ branch_id: d.branch_id, emp_code: d.emp_code, nombre: d.nombre, sucursal: d.sucursal, dias: n, desde });
    }
  }
  rachas.sort((a, b) => b.dias - a.dias || a.nombre.localeCompare(b.nombre, 'es'));
  return { perfectos, rachas: rachas.slice(0, 10), quincenas: hist.length };
}

// ---------------------------------------------------------------- confianza en los datos
// Semáforo por sucursal: si el checador dejó de mandar checadas, hubo días en
// que nadie checó o faltan nombres por completar, las cifras pueden estar mal.
function calidad({ branches, coverage, result, duplicados = [], holidays = [], from, to, today }) {
  const fest = new Set(holidays.map((h) => h.fecha));
  const evalTo = to < today ? to : today;
  // Hoy todavía pueden faltar checadas: se cuenta hasta ayer.
  const hasta = evalTo === today ? addDays(today, -1) : evalTo;
  return branches.map((b) => {
    const cov = coverage.get(b.id);
    const ultima = cov?.hasta ? cov.hasta.slice(0, 10) : null;
    const laborables = (a, z) => (a > z ? 0 : eachDay(a, z).filter((d) => b.schedule[weekday(d)]?.laborable && !fest.has(d)).length);
    const sinChecar = ultima ? laborables(addDays(ultima, 1), hasta) : null;
    const sinDatos = new Set(result.days.filter((d) => d.branch_id === b.id && d.estado === 'SIN DATOS').map((d) => d.fecha)).size;
    const nombres = (result.sinNombre || []).filter((x) => x.branch_id === b.id).length;
    const dups = duplicados.filter((g) => g.some((e) => e.branch_id === b.id)).length;
    const motivos = [];
    let nivel = 'verde';
    const sube = (n) => (nivel = n === 'rojo' || nivel === 'rojo' ? 'rojo' : 'amarillo');
    if (!ultima) {
      motivos.push('Nunca se han recibido checadas de este checador');
      sube('rojo');
    } else if (sinChecar >= 2) {
      motivos.push(`No hay checadas desde el ${fmtDate(ultima)} (${sinChecar} días de trabajo)`);
      sube('rojo');
    } else if (sinChecar === 1) {
      motivos.push(`La última checada es del ${fmtDate(ultima)}`);
      sube('amarillo');
    }
    if (sinDatos >= 3) {
      motivos.push(`${sinDatos} días en que nadie checó`);
      sube('rojo');
    } else if (sinDatos) {
      motivos.push(`${sinDatos} día(s) en que nadie checó`);
      sube('amarillo');
    }
    if (nombres) {
      motivos.push(`${nombres} nombre(s) por completar`);
      sube('amarillo');
    }
    if (dups) {
      motivos.push(`${dups} posible(s) persona(s) repetida(s) en dos sucursales`);
      sube('amarillo');
    }
    return {
      branch_id: b.id,
      sucursal: `${b.code} ${b.name}`,
      nivel,
      ultima_checada: ultima,
      ultima_actualizacion: b.last_sync || null,
      dias_sin_checadas: sinChecar,
      dias_sin_datos: sinDatos,
      nombres_incompletos: nombres,
      duplicados: dups,
      motivos,
    };
  });
}

// ---------------------------------------------------------------- resumen en palabras
// Unas cuantas frases para quien solo tiene un minuto (Dirección).
function resumen({ kpis: K, comparativo, sucursales = [], casos: C = [], honor: H, calidad: Q = [] }) {
  const out = [];
  const m = comparativo?.metricas;
  const ref = comparativo ? refTexto(comparativo) : '';
  const cambio = (x, unidad, mas = 'más', menos = 'menos') =>
    x && x.delta ? `, ${uno(Math.abs(x.delta))} ${unidad} ${x.delta > 0 ? mas : menos} que ${ref}` : x && x.delta === 0 ? `, igual que ${ref}` : '';

  if (K.puntualidad == null) out.push('No hubo entradas que evaluar en este periodo.');
  else out.push(`La puntualidad general fue de ${K.puntualidad}%${cambio(m?.puntualidad, 'punto(s)')}.`);

  if (K.retardos) {
    out.push(`Hubo ${K.retardos} retardo(s) de ${K.personas_con_retardo} persona(s), ${K.minutos_retardo} minutos en total${cambio(m?.minutos_retardo, 'min')}.`);
  } else if (K.puntualidad != null) out.push('No hubo retardos.');
  out.push(K.faltas ? `Se registraron ${K.faltas} falta(s) sin justificar${cambio(m?.faltas, 'falta(s)')}.` : 'No hubo faltas sin justificar.');
  if (K.faltas_por_retardos) out.push(`Por juntar retardos se cuentan ${K.faltas_por_retardos} falta(s) más.`);

  if (sucursales.length > 1 && K.retardos >= 5) {
    const top = [...sucursales].sort((a, b) => b.retardos - a.retardos)[0];
    const share = Math.round((top.retardos / K.retardos) * 100);
    if (share >= 40) out.push(`${top.sucursal} concentró el ${share}% de los retardos.`);
  }

  const cuenta = (tipo) => C.filter((c) => c.motivos.some((x) => x.tipo === tipo)).length;
  const cerca = cuenta('cerca_falta');
  const reinc = cuenta('reincidente');
  if (cerca) out.push(`${cerca} persona(s) están a un retardo de que se les cuente una falta.`);
  if (reinc) out.push(`${reinc} persona(s) llegaron tarde en las últimas 3 quincenas seguidas.`);
  if (H?.perfectos?.length) out.push(`${H.perfectos.length} persona(s) tuvieron puntualidad perfecta.`);

  for (const q of Q.filter((x) => x.nivel === 'rojo')) out.push(`Atención: en ${q.sucursal} ${q.motivos[0].charAt(0).toLowerCase()}${q.motivos[0].slice(1)}; sus cifras no son confiables.`);
  return out;
}

module.exports = {
  QUINCENAS,
  quincenaDe,
  quincenasHasta,
  etiquetaQuincena,
  periodoAnterior,
  rangoComparable,
  refTexto,
  comparar,
  tendencia,
  casos,
  honor,
  calidad,
  resumen,
};
