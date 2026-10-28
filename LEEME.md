# Reservas de Palcos — sistema interno

Registro y consulta de reservas: 340 palcos de 10 sillas cada uno. Funciona solo dentro de la red de la empresa, con inicio de sesión (usuarios CESAP y CESNE).

## Qué hay en la carpeta

| Archivo / carpeta | Para qué sirve |
|---|---|
| `server.js` | Servidor: página web, API y actualización en tiempo real |
| `db.js` | Base de datos (SQLite) y reglas, por ejemplo que un palco nunca pase de 10 sillas |
| `public/` | La página: `index.html`, `estilos.css`, `app.js` |
| `public/qr.js` | Generador de códigos QR (sin librerías externas) |
| `lib/` | Boleta PDF, correo bonito, envío de correos y archivo de Excel |
| `probar-conexion.bat` / `diagnosticar-red.bat` | Pruebas de la conexión segura con Google, si el envío de correos falla |
| `exportar-certificados.bat` | Hace que el sistema confíe en el certificado de la red (si hay error de certificados al enviar correos) |
| `google-apps-script.gs` | Script para pegar en la cuenta de Gmail que envía las boletas (con instrucciones) |
| `config.ejemplo.json` | Modelo de configuración (correo y carpeta de respaldos); se copia como `config.json` |
| `public/plano.js` | **La planimetría**: ubicación de cada palco, la tarima, la pasarela, los baños, y la disposición en U de las 10 sillas |
| `data/reservas.db` | **La base de datos.** Se crea sola al arrancar por primera vez |
| `iniciar.bat` | Doble clic para arrancar el sistema |
| `restaurar-respaldo.bat` | Restaurar la base de datos desde un respaldo (con el sistema cerrado) |
| `exportar-historial.bat` | Genera el Excel del historial interno de movimientos (solo en el servidor) |
| `restablecer-contrasena.bat` | Devuelve la contraseña de CESAP o CESNE a la de por defecto (si alguien la olvida) |

Todo queda dentro de esta carpeta. No modifica nada más del servidor.

## Instalación en el servidor (una sola vez)

1. **Instalar Node.js** (versión LTS, 22 o superior) desde https://nodejs.org. Es un instalador normal de Windows.
2. **Copiar la carpeta `reservas-palcos`** a un disco local del servidor, por ejemplo `D:\reservas-palcos`.
   > La base de datos debe estar en un disco **del propio servidor**, no en una unidad de red mapeada.
3. **Abrir el puerto 3000 en el firewall** (solo red interna). En PowerShell como administrador:
   ```
   New-NetFirewallRule -DisplayName "Reservas Palcos" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Domain,Private
   ```
4. Hacer doble clic en **`iniciar.bat`**. La ventana muestra la dirección de acceso, por ejemplo:
   ```
   Desde la red:     http://192.168.1.20:3000
   ```

## Uso

Desde cualquier PC o celular conectado a la red de la empresa, abrir en el navegador `http://IP-DEL-SERVIDOR:3000`.
Primero aparece la página de **ingreso** (ver "Inicio de sesión" más abajo).

- **El plano** muestra los 340 palcos. Cada casilla tiene una mini U con 10 puntos, y los puntos rellenos son sillas ocupadas.
- **Clic en un palco**: se abren sus 10 sillas en U mirando a la tarima.
  - Toca sillas libres para seleccionarlas y llena los datos de la persona.
  - Toca una silla ocupada para ver de quién es.
  - Con **Editar** se cambian los datos o las sillas de una reserva.
- **Colorear por**: categoría (colores), empresa u ocupación (vacío, con reservas, lleno).
- **Resaltar**: deja visibles solo los palcos de una empresa, una categoría o un estado (por ejemplo "con sillas libres"). También se puede tocar un elemento de la leyenda.
- **Buscar**: por nombre, documento, teléfono o número de palco. Los palcos encontrados se marcan en el plano. Escribir un número y presionar Enter abre ese palco.
- **Zoom**: − / + y "Ajustar" para ver el plano completo.
- **Exportar a Excel**: descarga todas las reservas con palco, sillas, categoría y empresa.
- Los cambios aparecen **al instante** en todas las pantallas abiertas.

## Tarifas

| Zona | Palco completo | Cada silla |
|---|---|---|
| Morado | $ 3.000.000 | $ 300.000 |
| Rojo | $ 2.500.000 | $ 250.000 |
| Azul | $ 2.000.000 | $ 200.000 |
| Verde | $ 1.800.000 | $ 180.000 |
| Naranja | $ 1.500.000 | $ 150.000 |

- Cada silla vale el precio del palco dividido entre 10.
- Si la reserva es de **una sola silla**, se cobran **$ 30.000 adicionales**. Desde 2 sillas, el precio por silla es el normal.
- Al seleccionar sillas, el **valor total se calcula solo** y debajo se ve el detalle, por ejemplo "3 sillas × $ 300.000 = $ 900.000".
- Se puede escribir otro valor a mano (descuento, cortesía…). El sistema avisa que es distinto a la tarifa, y con **Usar tarifa** se vuelve al valor normal.
- Los precios se cambian en **Organizar palcos → Categorías**, en el campo de precio de cada zona. El recargo de silla sola se cambia en `RECARGO_SILLA_SOLA` dentro de `public/plano.js`.

## Bloquear palcos

- Dentro de un palco, el botón **Bloquear palco** pide un motivo opcional, por ejemplo "Cortesía organización".
- Para bloquear varios a la vez: **Organizar palcos** → seleccionar → **Bloquear selección** / **Desbloquear selección**.
- Un palco bloqueado **no admite reservas nuevas**, ni siquiera si dos personas lo intentan al tiempo: el servidor lo rechaza.
- Las reservas que ya tenía se conservan y se pueden editar y cobrar.
- En el plano se ve con una **X**, en la Pantalla TV en gris con "BLOQ.", y en "Resaltar" hay un filtro **Bloqueados**.

## Código de reserva, boleta y correo

- Cada reserva recibe un **código** corto, por ejemplo `FA-7K3M`. Sale en la lista del palco y se puede buscar.
- **Boleta PDF**: botón en cada reserva. Abre la boleta con el código, los datos, el dibujo de las sillas, los valores y el QR.
- **Código QR**: es **texto plano** (evento, código, nombre, palco, zona y sillas). Al escanearlo con cualquier celular se ve el texto, sin abrir enlaces ni necesitar internet. No incluye el saldo, porque cambia con los abonos.
- **Correo**: al crear la reserva, si tiene correo y la casilla de **autorización** marcada (Ley 1581), se envía solo un correo con:
  - la información de la reserva en un diseño visual;
  - el QR;
  - la boleta PDF adjunta.
- El envío se hace en segundo plano: registrar no se demora. En la reserva se ve el estado: enviada, enviando o no se pudo enviar (con el motivo).
- **Reenviar correo**: botón en cada reserva. Manda la boleta con los datos actuales, por ejemplo después de un abono.
- Los abonos **no** envían correo automáticamente.

### Configurar el correo (una vez, en el servidor)

1. Copiar `config.ejemplo.json` como **`config.json`**, en la misma carpeta.
2. Elegir el método en `"metodo"`:

   **a) `"google_script"` — una cuenta de Gmail, enviando por HTTPS. Recomendado para esta red.**
   Úsalo cuando la red bloquea los puertos de correo (465/587); solo necesita el puerto 443, el de las páginas web.
   1. Con la cuenta de Gmail del evento, sigue las instrucciones que están al inicio del archivo **`google-apps-script.gs`**:
      - crear el proyecto en script.google.com y pegar el código;
      - cambiar la `CLAVE`;
      - conceder permisos;
      - publicarlo como "Aplicación web".
   2. Copia la **URL** que termina en `/exec` y la **CLAVE** en la sección `"google_script"` de `config.json`. En `"remitente"` pon el correo de Gmail (solo se muestra en el sistema).
   3. Para comprobar que quedó publicado, abre la URL en el navegador del servidor. Debe mostrar `"Servicio de boletas activo"`.
   - **Límite**: Google permite unos **100 correos al día** con este método en cuentas gratuitas. Si un día se pasa, esas boletas quedan con error y se envían al día siguiente con **Reenviar correo**.

   **b) `"graph"` — correo institucional `@policia.gov.co` (Microsoft 365).**
   Microsoft ya no permite enviar desde programas con usuario y contraseña. Hay que pedirle a **sistemas / Microsoft 365** que:
   - registre una aplicación en **Entra ID** (portal de Azure);
   - le dé el permiso de aplicación **Mail.Send** de Microsoft Graph, con *consentimiento de administrador*;
     - se puede limitar para que solo envíe desde `cesap.gutic-sop@policia.gov.co` (*Application Access Policy* o *RBAC for Applications*);
   - entregue tres datos: **ID de inquilino (tenant_id)**, **ID de aplicación (client_id)** y un **secreto de cliente (client_secret)**.

   Esos tres datos van en la sección `"graph"`.

   **c) `"smtp"` — Gmail u otro servidor (si la red deja salir por el puerto 465 o 587).**
   - **Gmail**: `"servidor": "smtp.gmail.com"`, `"puerto": 465`, con una **contraseña de aplicación**. Requiere la verificación en dos pasos activada en la cuenta.
   - **Outlook institucional por SMTP**: solo funciona si sistemas mantiene habilitado el SMTP AUTH para esa cuenta.
3. Poner `"activo": true` y reiniciar `iniciar.bat`.
4. En **Organizar palcos → Correo de las boletas** se ve si quedó activo. Con **Enviar prueba** llega un correo de ejemplo con boleta.

> `config.json` contiene claves: no lo compartas. Deja la carpeta del sistema con acceso solo para quien administre el servidor.
> El servidor necesita salida a internet: puerto 443 para Google Apps Script y Graph; 465 o 587 para SMTP. Para comprobarlo: `Test-NetConnection script.google.com -Port 443`.

### Error `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` (o "certificado propio de la red")

La red institucional inspecciona las conexiones seguras con un certificado propio. Windows confía en él, pero Node.js no lo conoce. Para solucionarlo:

1. En el servidor, haz doble clic en **`exportar-certificados.bat`**. Guarda en `certificados.pem` los certificados en los que Windows ya confía para conectarse a Google.
2. Cierra y vuelve a abrir **`iniciar.bat`**. El sistema carga `certificados.pem` en cada envío. Además, si la versión de Node lo permite, usa directamente los certificados de Windows.
3. Si aún falla, ejecuta **`probar-conexion.bat`**. Muestra la versión de Node, los certificados cargados y por qué se acepta o se rechaza la conexión.

No desactives la verificación de certificados (`NODE_TLS_REJECT_UNAUTHORIZED=0`): dejaría el envío expuesto.

## Exportar a Excel

El botón **Exportar a Excel** (en Registro y en Finanzas, solo para CESAP y CESNE) descarga un archivo `.xlsx` con 6 hojas:

| Hoja | Contenido |
|---|---|
| **Resumen** | Indicadores generales, y desgloses por zona (con precio), por empresa y por medio de pago |
| **Reservas** | Una fila por reserva: código, palco, zona, empresa, sillas, datos de contacto, correo, afiliación, valor pagado, medio y fecha de pago, estado, estado del correo, notas y fechas |
| **Pagos** | Cada pago con fecha, código de reserva, palco, responsable, medio y valor |
| **Palcos** | Los 340 palcos con zona, precio, empresa, estado (vacío, con reservas, lleno o bloqueado), sillas ocupadas y libres, y recaudado |
| **Asistencia** | Una fila por reserva: personas, cuántas ingresaron, cuántas faltan, estado (completa, parcial, sin llegar) y hora del primer y último ingreso |
| **Ingresos** | Cada ingreso registrado en la puerta: fecha y hora, código, palco, nombre, personas, puerta y usuario |

Todas las hojas tienen encabezados con color, valores en pesos, fila de **totales**, **filtros** y la primera fila fija. Este Excel **no** incluye el historial interno.

## Pago de las reservas: siempre completo

- **Sin pago no hay reserva.** Al crearla se elige el **medio de pago** y se registra el pago del **valor total** en la misma operación. No hay abonos ni saldos pendientes.
- Medios de pago: Efectivo, Transferencia, Tarjeta, Nequi, Daviplata y Otro. Se cambian en `MEDIOS_PAGO` dentro de `public/plano.js`.
- **Editar** una reserva pagada:
  - se pueden cambiar nombre, documento, teléfono, correo, afiliación y notas;
  - se puede pasar a **otras sillas**, siempre que sea **la misma cantidad**;
  - el **valor** y la **cantidad de sillas** no se cambian. Para eso se **anula** la reserva y se crea de nuevo.
- **Anular** una reserva libera las sillas y anula su pago. El sistema recuerda devolver el dinero si corresponde. Todo queda en el historial interno.
- **Registros anteriores:** si hay reservas creadas antes de esta regla con pago incompleto, aparecen como "Pago incompleto (registro anterior)" con el botón **Completar pago**.

## Pestaña Finanzas

- **Totales**: total recaudado, reservas pagadas, sillas vendidas, palcos con reservas y promedio por silla.
- **Desgloses**:
  - por zona (color) y por empresa del palco;
  - personas por afiliación;
  - pagos por medio y recaudado por día.
- **Detalle de pagos** y botón **Exportar a Excel**.
- **Pagos incompletos (registros anteriores)**: solo aparece si queda alguno.
- Tocar una fila abre ese palco en Registro.

## Pestaña Pantalla TV

Vista solo para mirar, pensada para un televisor o proyector. Abrir `http://IP-DEL-SERVIDOR:3000/#tv` y presionar **Pantalla completa**.

- El plano muestra los palcos con reservas en oscuro, con "personas / 10". Los palcos libres se ven del color de su zona.
- Al lado aparecen los palcos ocupados y llenos, las personas registradas, las sillas disponibles, el porcentaje de ocupación y barras por zona y por empresa.
- Se actualiza sola en tiempo real.

## Organizar palcos por empresa y categoría

Botón **Organizar palcos**:

1. **Selecciona palcos**. Hay tres formas:
   - tocarlos uno por uno;
   - arrastrar un recuadro sobre el plano;
   - escribir números o rangos, por ejemplo `1-54, 60, 135-152`.
2. Elige una **categoría** y/o una **empresa** y presiona **Aplicar a la selección**.
3. Abajo se crean, renombran, recolorean o eliminan las categorías y empresas. Al eliminar una, sus palcos quedan "sin asignar"; las reservas no se tocan.

Colores (zonas) iniciales:

| Zona | Palcos |
|---|---|
| Morado | 1–38 |
| Rojo | 39–170 |
| Azul | 171–238 |
| Verde | 239–306 |
| Naranja | 307–340 |

Empresas iniciales: **CESAP** y **CESNE**. Para repartir los palcos entre ellas: seleccionar → elegir empresa → Aplicar.

## Que arranque solo al encender el servidor (opcional)

Programador de tareas de Windows → *Crear tarea básica* → Desencadenador: **Al iniciar el equipo** → Acción: *Iniciar un programa* → elegir `iniciar.bat` y en "Iniciar en" poner la carpeta, por ejemplo `D:\reservas-palcos`. Marcar "Ejecutar tanto si el usuario inició sesión como si no".

## Respaldos y restauración

Los respaldos se guardan **fuera de la carpeta del sistema**, en:

`D:\sw\BK\AREA_DE_SERVICIOS\EVENTOS\GRAN FIESTA ANUAL AFILIADOS\2026`

La ruta se puede cambiar en `config.json` → `"respaldos": { "carpeta": "..." }`.

| Subcarpeta | Qué guarda |
|---|---|
| `frecuentes\` | Una copia **al iniciar** el sistema y **cada 15 minutos** si hubo cambios. Se conservan las últimas 24 horas |
| `diarios\` | La última copia de **cada día**. Se conservan todas |
| `historial\` | Los Excel del historial que genera `exportar-historial.bat` |

- Cada copia se **verifica** automáticamente para confirmar que no quedó dañada.
- Al cerrar el sistema con **Ctrl + C** se hace una última copia. Si se cierra la ventana con la X, queda la copia de los últimos 15 minutos.
- Si esa carpeta no está disponible (disco desconectado o sin permisos), la copia se guarda en `data\respaldos\` y la ventana del sistema lo avisa.

**Para restaurar:**
1. Cierra `iniciar.bat`.
2. Abre **`restaurar-respaldo.bat`**: muestra los respaldos con fecha y hora.
3. Escribe el número del que quieras y confirma con `SI`.
4. La base actual **no se borra**: queda guardada en `data\antes-de-restaurar_<fecha>\`.
5. Vuelve a abrir `iniciar.bat`.

## Historial de movimientos (control interno)

El sistema guarda cada cambio con: fecha y hora, **IP del equipo**, **usuario de la sesión** (CESAP o CESNE), **"Registrado por"** (el nombre que tiene ese equipo en el formulario), acción, palco, código de reserva, un detalle legible (ej. `sillas: "3, 4" → "5, 6"`) y los datos completos de antes y después.

- **Qué se registra:**
  - reservas creadas (con su pago), editadas y anuladas;
  - pagos completados;
  - bloqueos y desbloqueos, asignación de zona y empresa;
  - categorías y empresas (incluidos los cambios de precio);
  - envíos de correo, correos de prueba y descargas del Excel.
  - ingresos, intentos fallidos, bloqueos por intentos, cierres de sesión y cambios o restablecimientos de contraseña.
- **No se ve en la página.** No hay pestaña, botón ni dirección para consultarlo.
- **Para consultarlo, en el servidor:** abre **`exportar-historial.bat`**. Genera un Excel en la carpeta de respaldos (`historial\`) con tres hojas: el historial completo con filtros, un resumen por equipo y un resumen por acción. Se puede usar con el sistema abierto.
- El historial queda dentro de la base de datos, así que también se respalda.

## Cambiar la configuración

- **Plano y palcos**: en `public/plano.js`. Los palcos se numeran en el mismo orden del plano original. Desde la fila del 135, la numeración es consecutiva: se corrigieron el 137 repetido y el 306 que faltaba.
- **Puerto**: editar `PUERTO` en `server.js`.

## Inicio de sesión

Sin iniciar sesión no se ve nada: ni el plano, ni Finanzas, ni la Pantalla TV, ni el Excel, ni las boletas.

| Usuario | Contraseña por defecto |
|---|---|
| `CESAP` | `Cesap2026*` |
| `CESNE` | `Cesne2026*` |
| `INGRESO` | `Ingreso2026*` |

- El usuario se puede escribir en mayúsculas o minúsculas. La contraseña distingue mayúsculas.
- **CESAP y CESNE** tienen los mismos permisos: hacen todo, como siempre. La pestaña **Ingreso** solo la ven (no registran ingresos).
- **INGRESO** es para la puerta del evento: ve todas las pestañas en **modo consulta** (sin formularios, sin Editar/Anular/Bloquear, sin Organizar palcos, sin Excel ni boletas) y es el único que registra ingresos. Al iniciar sesión abre directo la pestaña Ingreso. Varias puertas pueden usar INGRESO al mismo tiempo.
- Estos permisos los controla el servidor, no solo la página.
- **La sesión dura 12 horas** o hasta tocar **Cerrar sesión**. El televisor inicia sesión una vez y queda 12 horas.
- **5 intentos fallidos seguidos** desde un equipo lo bloquean **5 minutos**.
- Las contraseñas no se guardan en texto: la base de datos solo tiene una huella cifrada (scrypt).

### Cambiar la contraseña

Arriba a la derecha: **⚙ Configuración** → contraseña actual, nueva y repetir la nueva (mínimo 8 caracteres). Al cambiarla se cierran las sesiones de ese usuario en los demás equipos; en el equipo donde se cambió sigue abierta.

### Si alguien olvida la contraseña

En el servidor, abre **`restablecer-contrasena.bat`**, escribe el usuario (CESAP, CESNE o INGRESO) y luego **SI**. La contraseña vuelve a la de por defecto y se cierran sus sesiones abiertas. Se puede usar con el sistema abierto y queda en el historial interno.

> La página funciona por `http://` dentro de la red interna, así que la contraseña viaja sin cifrar por la red local. Si sistemas exige HTTPS, se puede agregar con un certificado que ellos entreguen.

## Ingreso al evento (pestaña Ingreso)

El día del evento, en cada puerta, un equipo con sesión **INGRESO** y la pistola lectora.

**Antes de empezar:** en la pestaña Ingreso, toca **Puerta: sin nombre ✎** y escribe el nombre (por ejemplo `Puerta 1`). Queda guardado en ese equipo.

### Con la pistola (Honeywell Xenon 1900)
1. Conéctala por USB. Funciona como teclado, sin instalar nada.
2. Dispara sobre el QR de la boleta (en el celular o impreso). **No hace falta hacer clic en ningún campo.** La Xenon separa las líneas del QR con "flecha abajo" en vez de Enter, y daña tildes y símbolos: la página lo tiene en cuenta y encuentra el código `FA-XXXX` igual.
3. Aparece la tarjeta:
   - 🟢 **Puede ingresar**: con cuántas personas vienen ya marcado (todas las que faltan). Con las flechas ↑ ↓ o los botones − / + se cambia si llegan menos. **Enter** registra.
   - 🟡 **Ya ingresaron algunas**: muestra cuántas y a qué hora; se registran las que faltan con el mismo QR.
   - 🔴 **Ya ingresó completa**: puede ser un QR repetido. Muestra la hora y la puerta de cada ingreso.
   - ❌ **Código no válido**: el código no existe o la reserva fue anulada.
4. Suena un pitido distinto para cada caso.

**Sin QR:** escribe el código en "Código de reserva" (`FA-WGGU` o solo `WGGU`) y presiona Enter.

**Si se registró por error:** la tarjeta muestra cada ingreso de esa reserva (hora y puerta) con su propio botón **Deshacer**; se puede quitar cualquiera, no solo el último. Para encontrar la reserva, lee el QR otra vez, escribe el código o toca la reserva en "Últimos ingresos". Queda en el historial interno.

**Si la pistola no lee:** abre "¿La pistola no lee? Probar la pistola" (debajo del campo del código): muestra cada tecla que llega y si se encuentra el código. Además, debajo del campo del código aparece **"Última lectura"** con el texto exacto que llegó. Si no aparece nada al disparar, la página no está recibiendo las teclas: haz clic en un espacio vacío de la página (fuera del buscador) y vuelve a disparar.

Nunca se puede registrar más personas de las que tiene la reserva, aunque dos puertas lean el mismo QR al mismo tiempo.

### Lo que se ve en la pestaña
- **Últimos ingresos** de todas las puertas, al instante.
- **Asistencia en vivo**: personas que han ingresado de las esperadas, reservas completas, parciales y sin llegar, el plano con cada palco coloreado (gris: no ha llegado nadie; amarillo: llegaron algunos; verde: completo), asistencia por zona y por empresa, y una gráfica de ingresos cada 15 minutos. **⛶ Pantalla completa** amplía solo esta gráfica.
- En el detalle de cada palco (pestaña Registro) aparece "Ingresaron X de N al evento".
- Si se anula una reserva que ya tenía ingresos, la página avisa y esos ingresos salen del conteo.
