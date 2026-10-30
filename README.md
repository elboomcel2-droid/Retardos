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
`set HOST=0.0.0.0` antes de iniciar (la conexión no va cifrada: hágalo solo en una red de confianza).

## Usuarios y control de accesos

La primera vez que se abre, el sistema pide crear el **primer usuario**, que será administrador.
Después, en **Usuarios**, el administrador da acceso a cada persona con un usuario
(ej. `luz.samano`) y una contraseña temporal que la persona debe cambiar al entrar.

| Permiso | Administrador (Sistemas) | Recursos Humanos | Gerente | Dueño / Dirección |
|---|:-:|:-:|:-:|:-:|
| Ver panel, empleados y detalle; descargar Excel/PDF e imprimir | ✓ | ✓ | ✓ | ✓ |
| Actualizar las checadas desde los checadores | ✓ | ✓ | ✓ | ✓ |
| Justificar o anotar retardos y faltas | ✓ | ✓ | ✓ | — |
| Nombres completos, bajas, horarios especiales y vincular sucursales | ✓ | ✓ | — | — |
| Reglas de puntualidad, horarios, festivos y ajustes del cálculo | ✓ | ✓ | — | — |
| Cargar checadas desde archivo | ✓ | ✓ | — | — |
| A quién se envía el reporte por correo y enviarlo | ✓ | ✓ | — | — |
| Cerrar la quincena | ✓ | ✓ | — | — |
| Reabrir una quincena cerrada | ✓ | — | — | ✓ |
| Ver el historial | ✓ | ✓ | — | ✓ |
| Usuarios | ✓ | — | — | — |
| Conexión con los checadores y servidor de correo | ✓ | — | — | — |

La tabla vive en `src/auth.js` (`ROLES`) y se muestra igual en la pantalla **Usuarios**.
Quien tenía el acceso anterior "Solo consulta" quedó como **Gerente**.
RH cierra la quincena pero no puede reabrirla: así, lo que se pagó solo cambia si Sistemas o
Dirección lo autorizan (con motivo, que queda en el Historial).

En el **Historial** queda quién hizo qué y cuándo, y se puede filtrar por persona: entradas al
sistema (y los intentos fallidos), descargas de Excel y PDF, impresiones (botón Imprimir o
Ctrl+P), justificaciones y cambios. Los reportes salen con el nombre de quien los generó.
La sesión se cierra sola tras 8 horas sin uso; 5 intentos fallidos bloquean el usuario 5 minutos
(el sistema avisa cuando quedan 2 intentos). El mensaje nunca dice si falló el usuario o la contraseña.
Las contraseñas nuevas deben tener al menos 8 caracteres, letras y números, y no pueden ser obvias
(12345678, elboom123…) ni contener el usuario o el nombre de la persona. Las contraseñas que ya
existen siguen funcionando; la regla se aplica al crear o cambiar una.
Si alguien olvida su contraseña, el administrador le pone una temporal nueva.
Si el que la olvidó es el administrador, en el equipo donde está instalado el sistema abra
`restablecer-clave.bat`, escriba su usuario y entre con la contraseña temporal que aparece.

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

- **Reporte por persona** (Empleados → pestaña *Reporte por persona*): la ficha de cada empleado con
  todos sus días (horario, entrada, comida, salida, horas, resultado, checadas y explicación), una
  hoja por persona con espacio para firmas. Se elige a quién incluir y se descarga en PDF, se
  imprime o se envía por correo.

## Cierre de quincena

Cuando la quincena ya se pagó, RH la cierra en **Cierre de quincena**. Se guarda una copia exacta de
cada día de todas las sucursales: desde ese momento no se puede justificar ni borrar notas de esos
días, y los reportes de esas fechas salen de la copia aunque después cambien horarios, reglas o
checadas. Si hubo un error, Sistemas o Dirección la reabren escribiendo el motivo.

## Envío por correo

Sistemas configura el servidor de salida (Configuración → Opciones avanzadas → Servidor de correo);
con Gmail o Microsoft 365 se usa una *contraseña de aplicación*. RH escribe a quién se envía
(Configuración → Envío por correo). Al cerrar una quincena se envían automáticamente el PDF general
y el PDF por persona; también se puede enviar desde *Reporte por persona*.

## La misma persona en varias sucursales

Cada checador da su propio número, así que quien va a otra sucursal (entregas, o lo mandan unos
días a Acapulco) aparecía como dos personas y con faltas en su sucursal. En la ficha del empleado,
**Vincular otro número** une sus registros: todas sus checadas cuentan como de una sola persona,
el día que checó en otra sucursal no es falta y el reporte dice dónde checó. **Ahora trabaja aquí**
cambia su sucursal cuando se muda. En **Empleados** aparece un aviso con los nombres que están en
dos checadores sin vincular. Si trabajó fuera sin checar en ningún lado, se justifica como
"Trabajó en otra sucursal" o "Entregas o trabajo fuera de la sucursal" (se puede aplicar a varios días).

## Usuario de MySQL de solo lectura (recomendado)

El usuario actual tiene **todos los permisos** sobre las bases de los checadores y también sobre
`refacc29_nomboom`, `refacc29_comercio`, `refacc29_inv_boom` y `refacc29_productos`. El sistema
nunca escribe (cada conexión se abre en modo solo lectura), pero esa contraseña está guardada en
`data/retardos.db`: si el equipo o el archivo se pierden, alguien podría borrar o alterar nómina e
inventario. Con un usuario que solo pueda **leer las 4 bases de checadores** el riesgo desaparece.

En cPanel (el prefijo `refacc29_` indica que el servidor lo usa):
1. **Bases de datos MySQL → Agregar nuevo usuario**: p. ej. `refacc29_checalect` con contraseña larga.
2. **Agregar usuario a la base de datos**: para cada una de `refacc29_check_alp`, `refacc29_check_tizoc_2`,
   `refacc29_check_acapulco` y `refacc29_check_chilpancingo`, marque **solo SELECT**.
3. **MySQL remoto**: permita únicamente la IP pública de la oficina donde corre el sistema.
4. En el sistema: Configuración → Opciones avanzadas → cambie usuario y contraseña, y pulse
   **Guardar y probar** en cada sucursal. La prueba revisa los permisos (`SHOW GRANTS`) y avisa si
   el usuario todavía tiene más de lo necesario.

Equivalente en SQL (lo ejecuta quien administra el servidor, no este sistema):

```sql
CREATE USER 'refacc29_checalect'@'IP_DE_LA_OFICINA' IDENTIFIED BY 'contraseña-larga';
GRANT SELECT ON refacc29_check_alp.* TO 'refacc29_checalect'@'IP_DE_LA_OFICINA';
GRANT SELECT ON refacc29_check_tizoc_2.* TO 'refacc29_checalect'@'IP_DE_LA_OFICINA';
GRANT SELECT ON refacc29_check_acapulco.* TO 'refacc29_checalect'@'IP_DE_LA_OFICINA';
GRANT SELECT ON refacc29_check_chilpancingo.* TO 'refacc29_checalect'@'IP_DE_LA_OFICINA';
```

(Solo se leen las tablas `personnel_employee` e `iclock_transaction`; si quiere ir más fino, el
`GRANT SELECT` puede ser sobre esas dos tablas.) Después, cambie la contraseña del usuario con
todos los permisos, porque ha estado guardada en este equipo.

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

Todo se guarda en `data/retardos.db` (SQLite). Contiene las contraseñas de MySQL y del correo en texto plano:
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
