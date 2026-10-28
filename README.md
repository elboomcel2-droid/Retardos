# Retardos — Control de asistencia El Boom Tractopartes

Sistema que convierte los marcajes de los checadores biométricos (ZKTeco / BioTime sobre MySQL)
de **Alpuyeca, Tizoc, Acapulco y Chilpancingo** en un reporte de retardos, faltas, incidencias y
días extra que se puede verificar marcaje por marcaje. Pensado para Recursos Humanos, gerencia
regional, encargados de sucursal y nómina.

## Iniciar

Requisito: [Node.js](https://nodejs.org) 22.5 o superior.

- **Windows:** doble clic en `iniciar.bat` (instala dependencias la primera vez y abre el navegador).
- **Manual:** `npm install` y luego `npm start`; abrir <http://localhost:3000>.

La aplicación escucha solo en el propio equipo. Para que otros equipos de la red la usen:
`set HOST=0.0.0.0` antes de iniciar (no tiene inicio de sesión: hágalo solo en una red de confianza).

## Primer uso

1. **Configuración → Conexión:** servidor, puerto, usuario y contraseña de MySQL donde están
   las bases `refacc29_check_*`. Use un usuario con permiso solo de `SELECT`.
   Pruebe cada sucursal con **Probar conexión**.
2. **Configuración → Sucursales y horarios:** horario de entrada/salida por día y tolerancia.
   Por defecto: lunes a viernes 08:30–18:00, sábado 09:00–15:00, domingo descanso,
   tolerancia 10 minutos. Para vigilancia o personal fijo en domingo, defina un horario
   especial en **Configuración → Empleados** (atajo “+ Labora domingo”).
3. **Configuración → Días festivos:** botón para cargar los descansos obligatorios de la LFT.
4. Elija el periodo (quincena actual/anterior, mes o fechas libres) y pulse
   **⟳ Actualizar desde checadores**.

Sin acceso al servidor, ejecute la consulta de `Lista de asistencia.sql` (sección “BUENA”) en
phpMyAdmin/Workbench, exporte a CSV o Excel e impórtelo en **Datos → Importar archivo**.

## Qué calcula y cómo (reglas verificables)

| Concepto | Regla |
|---|---|
| 4 checadas | 1ª entrada, 2ª sale a comer, 3ª regresa de comer, 4ª salida. Con 3 checadas se deduce cuál falta por la hora |
| Checada repetida | Si vuelve a checar a menos de 10 min de la anterior válida, solo cuenta la primera (ej. 8:35 y 8:37 → 8:35) |
| Comida | 40 min permitidos + 10 de tolerancia; si se pasa se marca "se pasó en la comida". Entre semana, sin checadas de comida se marca "no checó comida" |
| Horas trabajadas | De la entrada a la salida, sin contar la comida |
| Retardo | Entrada > hora de entrada + tolerancia. Los minutos se cuentan desde la hora de entrada o, si se configura, desde que termina la tolerancia |
| Retardo grave | Opcional: llegar más de X min tarde cuenta como falta |
| Tiempo extra al salir | Se marca si se queda 30 min o más después de su hora de salida |
| No justificado | Se anota el porqué, pero el retardo o la falta sigue contando |
| Permiso de llegada | "Tenía permiso hasta las 13:00": si llega antes queda justificado; si llega después, el retardo cuenta desde esa hora |
| Posible baja | Quien no checó en todo el periodo y ya llevaba 5+ días de trabajo sin venir no genera faltas y se avisa con un botón "Dar de baja" |
| Nombre incompleto | En el checador los nombres se abrevian a propósito. Si tiene 4 letras o menos, o no tiene apellido, se pide el nombre completo con un asistente que revisa que coincida con las iniciales (se guarda solo en este sistema) |
| No es una persona | Cuentas genéricas (ADMIN, SISTEMAS) se pueden excluir y dejan de aparecer en los reportes |
| Justificar varios días | Vacaciones o incapacidades: la misma justificación se aplica a un rango de fechas |
| Justificar un día puntual | Sigue contando como puntual; solo se perdonan sus incidencias (comida larga, salida antes) |
| Falta | Día laborable sin checadas **y** el checador de la sucursal sí registró a alguien ese día |
| Sin datos | Nadie checó en la sucursal ese día: probable falla o falta de sincronización. No cuenta como falta |
| Incompleto | Solo existe la checada de salida (no se puede evaluar puntualidad) |
| Sin salida | Solo existe la checada de entrada (se marca como incidencia) |
| Salida anticipada | Última checada más de 5 min antes de la hora de salida |
| Faltas por retardos | Cada 3 retardos = 1 falta (configurable; 0 la desactiva) |
| Día extra | Checadas en día de descanso (domingo) o festivo: vigilancia, guardias o tiempo extra. No afecta la puntualidad; se reportan las horas |
| Justificado | Se capturó permiso, incapacidad, vacaciones, etc. Se conserva el estado original |

| Comida antes de hora | De lunes a viernes la comida es a partir de las 14:00 (configurable); salir antes se marca |

Cada renglón del **Detalle diario** muestra todas las checadas del biométrico y la regla exacta
aplicada.

## Reportes

- **Excel**: hoja **Tablero** con 16 indicadores y 7 gráficas nativas de Excel (retardos y faltas por
  día, por sucursal, puntualidad, las 10 personas con más retardos, por día de la semana, minutos
  tarde por rango y resultado de los días por sucursal). Además: retardos por persona y por día (con
  barras de color), **Calendario** (persona × día con R/F/J), resúmenes, detalle diario, checadas
  originales, justificaciones y **Criterios**.
- **PDF**: las mismas cifras y gráficas en hojas tamaño carta horizontal, listo para imprimir o
  enviar. Se genera con Edge/Chrome del propio equipo (sin internet).

## Actualización automática (en vivo)

Mientras alguien tenga el sistema abierto, trae solo las checadas del día, únicamente en horario
laboral, para no saturar el servidor de los checadores. Con los horarios actuales:

| Día | Horarios de consulta |
|---|---|
| Lunes a viernes | 08:00–09:30 cada 5 min · 09:30–14:00 cada 30 · 14:00–15:20 cada 10 (comida) · 15:20–17:30 cada 30 · 17:30–19:00 cada 5 |
| Sábado | 08:30–10:00 cada 5 min · 10:00–14:30 cada 30 · 14:30–16:00 cada 5 |
| Domingo y festivos | 08:00–16:00 cada hora (vigilancia o tiempo extra) |

Fuera de esos horarios no consulta. El plan se recalcula solo si cambian los horarios y se puede
apagar en **Configuración → Actualización automática**.

Los empleados se consideran activos si checaron en el periodo o en los 31 días previos.
En **Configuración → Empleados** se registran altas, bajas (dejan de generar faltas) y horarios especiales.

Toda sincronización, importación, justificación y cambio de configuración queda en la **Bitácora**
con fecha y el nombre capturado en “Usuario”.

## Datos

Todo se guarda en `data/retardos.db` (SQLite). Contiene la contraseña de MySQL en texto plano:
no lo comparta. Cada día se guarda automáticamente una copia en `data/respaldos/` (se conservan
las 14 más recientes); para restaurar, cierre el sistema y copie el respaldo como `data/retardos.db`.

## Desarrollo

```
npm test            # pruebas del motor de cálculo e importador
npm run build:css   # recompila la interfaz (Tailwind) tras cambiar clases en public/
npm run dev:css     # recompila automáticamente mientras se edita
```

`public/app.css` ya va compilado, así que para usar el sistema no hace falta compilar nada.

- `src/engine.js` — reglas de asistencia (función pura)
- `src/biotime.js` — lectura de MySQL/BioTime (solo SELECT)
- `src/importer.js` — importación CSV/Excel
- `src/analytics.js` — indicadores y agregados de los reportes
- `src/export.js` — reporte Excel (tablero, hojas y formato)
- `src/xlsx-charts.js` — gráficas nativas de Excel
- `src/report-html.js` / `src/pdf.js` — reporte PDF
- `src/live.js` — actualización automática por horario
- `src/store.js` — base local SQLite
- `src/server.js` — API HTTP
- `src/ui.css` — estilos fuente (Tailwind CSS v4)
- `public/` — interfaz web
