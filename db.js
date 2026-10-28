'use strict';
// Base de datos SQLite (módulo nativo de Node, sin dependencias).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const PLANO = require('./public/plano.js');
const CLAVES = require('./lib/claves');

const ESQUEMA = 9;
const HORAS_SESION = 12;

const DIR_DATOS = path.join(__dirname, 'data');
fs.mkdirSync(DIR_DATOS, { recursive: true });

class ErrorHttp extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

const db = new DatabaseSync(path.join(DIR_DATOS, 'reservas.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const versionAnterior = db.prepare('PRAGMA user_version').get().user_version;

// La versión 1 guardaba solo cantidad de sillas. Si existe sin datos, se reemplaza.
if (versionAnterior < 2) {
  const viejas = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reservas'").get();
  if (viejas && db.prepare('SELECT COUNT(*) AS n FROM reservas').get().n > 0) {
    throw new Error('data/reservas.db tiene reservas de la versión anterior. Haz una copia del archivo, bórralo y vuelve a iniciar.');
  }
  db.exec('DROP TABLE IF EXISTS reservas; DROP TABLE IF EXISTS palcos;');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS categorias (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    color  TEXT NOT NULL,
    precio INTEGER NOT NULL DEFAULT 0  -- valor del palco completo
  );

  CREATE TABLE IF NOT EXISTS empresas (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    color  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS palcos (
    numero       INTEGER PRIMARY KEY,
    capacidad    INTEGER NOT NULL,
    categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
    empresa_id   INTEGER REFERENCES empresas(id) ON DELETE SET NULL,
    bloqueado    INTEGER NOT NULL DEFAULT 0,
    motivo_bloqueo TEXT  NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS reservas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    palco          INTEGER NOT NULL REFERENCES palcos(numero),
    nombre         TEXT    NOT NULL,
    documento      TEXT    NOT NULL DEFAULT '',
    telefono       TEXT    NOT NULL DEFAULT '',
    notas          TEXT    NOT NULL DEFAULT '',
    registrado_por TEXT    NOT NULL DEFAULT '',
    creado_en      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    actualizado_en TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    valor          INTEGER NOT NULL DEFAULT 0,
    afiliacion     TEXT    NOT NULL DEFAULT '',
    codigo         TEXT,                          -- código de reserva, ej. FA-7K3M
    correo         TEXT    NOT NULL DEFAULT '',
    autoriza_datos INTEGER NOT NULL DEFAULT 0,    -- autorizó el envío de información (Ley 1581)
    correo_estado  TEXT    NOT NULL DEFAULT '',   -- '' | pendiente | enviado | error
    correo_detalle TEXT    NOT NULL DEFAULT '',
    correo_enviado_en TEXT NOT NULL DEFAULT ''
  );

  -- Abonos de cada reserva. Sin borrado en cascada: una reserva con pagos no se puede eliminar.
  CREATE TABLE IF NOT EXISTS pagos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reserva_id     INTEGER NOT NULL REFERENCES reservas(id),
    valor          INTEGER NOT NULL CHECK (valor > 0),
    medio          TEXT    NOT NULL,
    registrado_por TEXT    NOT NULL DEFAULT '',
    fecha          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_pagos_reserva ON pagos(reserva_id);

  -- Una silla solo puede pertenecer a una reserva: la llave primaria lo garantiza.
  CREATE TABLE IF NOT EXISTS reserva_sillas (
    palco      INTEGER NOT NULL,
    silla      INTEGER NOT NULL,
    reserva_id INTEGER NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
    PRIMARY KEY (palco, silla)
  );

  CREATE INDEX IF NOT EXISTS idx_reservas_palco ON reservas(palco);
  CREATE INDEX IF NOT EXISTS idx_sillas_reserva ON reserva_sillas(reserva_id);

  -- Historial de movimientos (control interno: no se muestra en la página).
  CREATE TABLE IF NOT EXISTS historial (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    ip             TEXT    NOT NULL DEFAULT '',
    registrado_por TEXT    NOT NULL DEFAULT '',
    accion         TEXT    NOT NULL,
    palco          INTEGER,
    codigo         TEXT    NOT NULL DEFAULT '',
    detalle        TEXT    NOT NULL DEFAULT '',
    antes          TEXT    NOT NULL DEFAULT '',
    despues        TEXT    NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_historial_fecha ON historial(fecha);

  -- Usuarios del inicio de sesión (la contraseña se guarda como huella, nunca en texto).
  CREATE TABLE IF NOT EXISTS usuarios (
    usuario     TEXT PRIMARY KEY COLLATE NOCASE,
    clave       TEXT NOT NULL,
    cambiada_en TEXT NOT NULL DEFAULT ''
  );

  -- Sesiones abiertas: token = resumen sha256 del valor de la cookie. expira_en en milisegundos.
  CREATE TABLE IF NOT EXISTS sesiones (
    token     TEXT    PRIMARY KEY,
    usuario   TEXT    NOT NULL,
    ip        TEXT    NOT NULL DEFAULT '',
    creada_en TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    expira_en INTEGER NOT NULL
  );

  -- Ingreso al evento: cada lectura confirmada (puede haber varias por reserva si llegan por partes).
  -- Guarda código, palco y nombre tal como estaban, para el reporte.
  CREATE TABLE IF NOT EXISTS ingresos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    reserva_id INTEGER NOT NULL,
    codigo     TEXT    NOT NULL DEFAULT '',
    palco      INTEGER,
    nombre     TEXT    NOT NULL DEFAULT '',
    personas   INTEGER NOT NULL CHECK (personas > 0),
    puerta     TEXT    NOT NULL DEFAULT '',
    usuario    TEXT    NOT NULL DEFAULT '',
    ip         TEXT    NOT NULL DEFAULT '',
    fecha      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_ingresos_reserva ON ingresos(reserva_id);
`);

// Columnas nuevas en tablas que ya existían (se revisa la tabla para no repetirlas).
function agregarColumna(tabla, columna, definicion) {
  if (!db.prepare(`PRAGMA table_info(${tabla})`).all().some(c => c.name === columna)) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  }
}
// Versión 7 → 8: el historial guarda también el usuario de la sesión.
agregarColumna('historial', 'usuario', "TEXT NOT NULL DEFAULT ''");
// Versión 8 → 9: rol de cada usuario (admin | ingreso).
agregarColumna('usuarios', 'rol', "TEXT NOT NULL DEFAULT 'admin'");

// Usuarios iniciales (solo los que falten; nunca cambia una contraseña existente).
{
  const existe = db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?');
  const insertar = db.prepare('INSERT INTO usuarios (usuario, clave, rol) VALUES (?, ?, ?)');
  const ponerRol = db.prepare('UPDATE usuarios SET rol = ? WHERE usuario = ?');
  for (const u of CLAVES.USUARIOS_INICIALES) {
    if (!existe.get(u.usuario)) insertar.run(u.usuario, CLAVES.huella(u.clave), u.rol);
    else ponerRol.run(u.rol, u.usuario);
  }
}

// Actualizaciones de bases existentes (las nuevas ya se crean completas arriba).
// Versión 2 → 3: valor de la reserva y afiliación (los pagos van en tabla nueva).
if (versionAnterior === 2) {
  db.exec(`
    ALTER TABLE reservas ADD COLUMN valor INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE reservas ADD COLUMN afiliacion TEXT NOT NULL DEFAULT '';
  `);
}
// Versión 3 → 4: precio por zona y bloqueo de palcos.
if (versionAnterior >= 2 && versionAnterior < 4) {
  db.exec(`
    ALTER TABLE categorias ADD COLUMN precio INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE palcos ADD COLUMN bloqueado INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE palcos ADD COLUMN motivo_bloqueo TEXT NOT NULL DEFAULT '';
  `);
}
// Versión 4 → 5: código de reserva, correo y estado del envío.
if (versionAnterior >= 2 && versionAnterior < 5) {
  db.exec(`
    ALTER TABLE reservas ADD COLUMN codigo TEXT;
    ALTER TABLE reservas ADD COLUMN correo TEXT NOT NULL DEFAULT '';
    ALTER TABLE reservas ADD COLUMN autoriza_datos INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE reservas ADD COLUMN correo_estado TEXT NOT NULL DEFAULT '';
    ALTER TABLE reservas ADD COLUMN correo_detalle TEXT NOT NULL DEFAULT '';
    ALTER TABLE reservas ADD COLUMN correo_enviado_en TEXT NOT NULL DEFAULT '';
  `);
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reservas_codigo ON reservas(codigo);
  PRAGMA user_version = ${ESQUEMA};
`);

// Códigos de reserva: "FA-" + 4 caracteres sin letras que se confundan (0/O, 1/I/L).
const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const existeCodigo = db.prepare('SELECT 1 FROM reservas WHERE codigo = ?');
function nuevoCodigo() {
  for (;;) {
    let c = 'FA-';
    for (let i = 0; i < 4; i++) c += ALFABETO_CODIGO[crypto.randomInt(ALFABETO_CODIGO.length)];
    if (!existeCodigo.get(c)) return c;
  }
}
// Las reservas que ya existían reciben su código.
{
  const ponerCodigo = db.prepare('UPDATE reservas SET codigo = ? WHERE id = ?');
  for (const { id } of db.prepare("SELECT id FROM reservas WHERE codigo IS NULL OR codigo = ''").all()) ponerCodigo.run(nuevoCodigo(), id);
}

function transaccion(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Crea los palcos del plano. Al crear la base (o al actualizar a esta versión)
// aplica los colores por rango y agrega las empresas, sin borrar las que ya existan.
transaccion(() => {
  const insertarPalco = db.prepare('INSERT OR IGNORE INTO palcos (numero, capacidad) VALUES (?, ?)');
  for (const n of PLANO.palcos) insertarPalco.run(n, PLANO.SILLAS_POR_PALCO);

  if (versionAnterior >= ESQUEMA) return;

  const buscarPorNombre = tabla => db.prepare(`SELECT id FROM ${tabla} WHERE lower(nombre) = lower(?)`);

  // Precios de cada zona (solo donde todavía no hay precio).
  if (versionAnterior < 4) {
    const ponerPrecio = db.prepare('UPDATE categorias SET precio = ? WHERE lower(nombre) = lower(?) AND precio = 0');
    for (const c of PLANO.categoriasIniciales) ponerPrecio.run(c.precio, c.nombre);
  }

  // Repartición de palcos entre CESAP y CESNE (public/plano.js). Se aplica una vez:
  // al crear la base o al actualizar a esta versión. Después se cambia en "Organizar palcos".
  if (versionAnterior < 7) {
    const empresaExistente = buscarPorNombre('empresas');
    const nuevaEmpresa = db.prepare('INSERT INTO empresas (nombre, color) VALUES (?, ?)');
    const asignar = db.prepare('UPDATE palcos SET empresa_id = ? WHERE numero = ?');
    const yaAsignados = new Set();
    const expandir = texto => texto.split(',').flatMap(parte => {
      const [a, b = a] = parte.trim().split('-').map(Number);
      return Array.from({ length: b - a + 1 }, (_, i) => a + i);
    });
    for (const e of PLANO.empresasIniciales) {
      const id = empresaExistente.get(e.nombre)?.id ?? Number(nuevaEmpresa.run(e.nombre, e.color).lastInsertRowid);
      const palcos = e.palcos === 'resto' ? PLANO.palcos.filter(n => !yaAsignados.has(n)) : expandir(e.palcos || '');
      for (const n of palcos) {
        asignar.run(id, n);
        yaAsignados.add(n);
      }
    }
  }
  if (versionAnterior >= 3) return; // colores y empresas ya se aplicaron antes

  const categoriaExistente = buscarPorNombre('categorias');
  const cambiarColor = db.prepare('UPDATE categorias SET color = ?, precio = ? WHERE id = ?');
  const nuevaCategoria = db.prepare('INSERT INTO categorias (nombre, color, precio) VALUES (?, ?, ?)');
  const asignarRango = db.prepare('UPDATE palcos SET categoria_id = ? WHERE numero BETWEEN ? AND ?');
  for (const c of PLANO.categoriasIniciales) {
    const existente = categoriaExistente.get(c.nombre);
    let id;
    if (existente) {
      id = existente.id;
      cambiarColor.run(c.color, c.precio, id);
    } else {
      id = Number(nuevaCategoria.run(c.nombre, c.color, c.precio).lastInsertRowid);
    }
    asignarRango.run(id, c.desde, c.hasta);
  }

  const empresaExistente = buscarPorNombre('empresas');
  const nuevaEmpresa = db.prepare('INSERT INTO empresas (nombre, color) VALUES (?, ?)');
  for (const e of PLANO.empresasIniciales) {
    if (!empresaExistente.get(e.nombre)) nuevaEmpresa.run(e.nombre, e.color);
  }
});

// ── Consultas ───────────────────────────────────────────────────────────
const LISTA_SILLAS = `(SELECT GROUP_CONCAT(silla, ', ') FROM
  (SELECT silla FROM reserva_sillas WHERE reserva_id = r.id ORDER BY silla))`;
const MEDIO_Y_FECHA = `(SELECT GROUP_CONCAT(DISTINCT medio) FROM pagos WHERE reserva_id = r.id) AS medio_pago,
           (SELECT MAX(fecha) FROM pagos WHERE reserva_id = r.id) AS fecha_pago`;

const sql = {
  palcos: db.prepare(`
    SELECT p.numero, p.capacidad, p.categoria_id, p.empresa_id, p.bloqueado, p.motivo_bloqueo,
           (SELECT COUNT(*) FROM reservas r WHERE r.palco = p.numero) AS reservas
    FROM palcos p ORDER BY p.numero`),
  sillasOcupadasTodas: db.prepare('SELECT palco, silla FROM reserva_sillas ORDER BY palco, silla'),
  palco: db.prepare('SELECT numero, capacidad, categoria_id, empresa_id, bloqueado, motivo_bloqueo FROM palcos WHERE numero = ?'),
  bloquear: db.prepare('UPDATE palcos SET bloqueado = ?, motivo_bloqueo = ? WHERE numero = ?'),
  sillasDePalco: db.prepare('SELECT silla, reserva_id FROM reserva_sillas WHERE palco = ? ORDER BY silla'),
  sillasOcupadas: db.prepare('SELECT silla FROM reserva_sillas WHERE palco = ? AND reserva_id <> ?'),
  reservasDePalco: db.prepare(`
    SELECT r.*, (SELECT COALESCE(SUM(personas), 0) FROM ingresos WHERE reserva_id = r.id) AS ingresados
    FROM reservas r WHERE r.palco = ? ORDER BY r.id`),
  reserva: db.prepare('SELECT * FROM reservas WHERE id = ?'),
  insertar: db.prepare(`
    INSERT INTO reservas (palco, nombre, documento, telefono, notas, registrado_por, valor, afiliacion, codigo, correo, autoriza_datos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  actualizar: db.prepare(`
    UPDATE reservas
    SET nombre = ?, documento = ?, telefono = ?, notas = ?, registrado_por = ?, valor = ?, afiliacion = ?,
        correo = ?, autoriza_datos = ?, actualizado_en = datetime('now', 'localtime')
    WHERE id = ?`),
  marcarCorreo: db.prepare(`
    UPDATE reservas SET correo_estado = ?1, correo_detalle = ?2,
      correo_enviado_en = CASE WHEN ?1 = 'enviado' THEN datetime('now', 'localtime') ELSE correo_enviado_en END
    WHERE id = ?3`),
  boleta: db.prepare(`
    SELECT r.*, p.capacidad, c.nombre AS categoria_nombre, c.color AS categoria_color, e.nombre AS empresa_nombre,
           (SELECT COALESCE(SUM(valor), 0) FROM pagos WHERE reserva_id = r.id) AS pagado,
           ${MEDIO_Y_FECHA}
    FROM reservas r
    JOIN palcos p ON p.numero = r.palco
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN empresas e ON e.id = p.empresa_id
    WHERE r.id = ?`),
  sillasDeReserva: db.prepare('SELECT silla FROM reserva_sillas WHERE reserva_id = ? ORDER BY silla'),
  excelReservas: db.prepare(`
    SELECT r.*, ${LISTA_SILLAS} AS sillas_texto,
           (SELECT COUNT(*) FROM reserva_sillas s WHERE s.reserva_id = r.id) AS cantidad,
           (SELECT COALESCE(SUM(valor), 0) FROM pagos WHERE reserva_id = r.id) AS pagado,
           ${MEDIO_Y_FECHA},
           c.nombre AS zona, e.nombre AS empresa,
           (SELECT COALESCE(SUM(personas), 0) FROM ingresos WHERE reserva_id = r.id) AS ingresados,
           (SELECT MIN(fecha) FROM ingresos WHERE reserva_id = r.id) AS primer_ingreso,
           (SELECT MAX(fecha) FROM ingresos WHERE reserva_id = r.id) AS ultimo_ingreso
    FROM reservas r
    JOIN palcos p ON p.numero = r.palco
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN empresas e ON e.id = p.empresa_id
    ORDER BY r.palco, r.id`),
  excelIngresos: db.prepare('SELECT * FROM ingresos ORDER BY id'),
  // ── Ingreso al evento ──
  reservaIngreso: db.prepare(`
    SELECT r.id, r.codigo, r.palco, r.nombre, r.documento, r.afiliacion,
           ${LISTA_SILLAS} AS sillas_texto,
           (SELECT COUNT(*) FROM reserva_sillas s WHERE s.reserva_id = r.id) AS personas,
           c.nombre AS zona, c.color AS zona_color, e.nombre AS empresa, e.color AS empresa_color
    FROM reservas r
    JOIN palcos p ON p.numero = r.palco
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN empresas e ON e.id = p.empresa_id
    WHERE r.codigo = ?`),
  ingresosDeReserva: db.prepare('SELECT id, personas, puerta, usuario, fecha FROM ingresos WHERE reserva_id = ? ORDER BY id'),
  insertarIngreso: db.prepare(`
    INSERT INTO ingresos (reserva_id, codigo, palco, nombre, personas, puerta, usuario, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  borrarIngreso: db.prepare('DELETE FROM ingresos WHERE id = ?'),
  borrarIngresosDeReserva: db.prepare('DELETE FROM ingresos WHERE reserva_id = ?'),
  asistenciaReservas: db.prepare(`
    SELECT r.palco,
           (SELECT COUNT(*) FROM reserva_sillas s WHERE s.reserva_id = r.id) AS personas,
           (SELECT COALESCE(SUM(personas), 0) FROM ingresos WHERE reserva_id = r.id) AS ingresados
    FROM reservas r`),
  ingresosTodos: db.prepare('SELECT id, codigo, palco, nombre, personas, puerta, fecha FROM ingresos ORDER BY id DESC'),
  excelPagos: db.prepare(`
    SELECT pg.*, r.codigo, r.palco, r.nombre, r.afiliacion, c.nombre AS zona
    FROM pagos pg
    JOIN reservas r ON r.id = pg.reserva_id
    JOIN palcos p ON p.numero = r.palco
    LEFT JOIN categorias c ON c.id = p.categoria_id
    ORDER BY pg.fecha, pg.id`),
  excelPalcos: db.prepare(`
    SELECT p.numero, p.capacidad, p.bloqueado, p.motivo_bloqueo,
           c.nombre AS zona, c.precio, e.nombre AS empresa,
           (SELECT COUNT(*) FROM reserva_sillas s WHERE s.palco = p.numero) AS ocupadas,
           (SELECT COUNT(*) FROM reservas r WHERE r.palco = p.numero) AS reservas,
           (SELECT COALESCE(SUM(r.valor), 0) FROM reservas r WHERE r.palco = p.numero) AS vendido,
           (SELECT COALESCE(SUM(pg.valor), 0) FROM pagos pg JOIN reservas r ON r.id = pg.reserva_id WHERE r.palco = p.numero) AS pagado
    FROM palcos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN empresas e ON e.id = p.empresa_id
    ORDER BY p.numero`),
  pagado: db.prepare('SELECT COALESCE(SUM(valor), 0) AS total, COUNT(*) AS cantidad FROM pagos WHERE reserva_id = ?'),
  pagosDePalco: db.prepare(`
    SELECT pg.* FROM pagos pg JOIN reservas r ON r.id = pg.reserva_id
    WHERE r.palco = ? ORDER BY pg.fecha, pg.id`),
  pago: db.prepare('SELECT * FROM pagos WHERE id = ?'),
  insertarPago: db.prepare('INSERT INTO pagos (reserva_id, valor, medio, registrado_por) VALUES (?, ?, ?, ?)'),
  pagosDeReserva: db.prepare('SELECT * FROM pagos WHERE reserva_id = ? ORDER BY fecha, id'),
  borrarPagosDeReserva: db.prepare('DELETE FROM pagos WHERE reserva_id = ?'),
  ponerValor: db.prepare('UPDATE reservas SET valor = ? WHERE id = ?'),
  historial: db.prepare(`
    INSERT INTO historial (ip, usuario, registrado_por, accion, palco, codigo, detalle, antes, despues)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  usuario: db.prepare('SELECT usuario, clave FROM usuarios WHERE usuario = ?'),
  cambiarClave: db.prepare("UPDATE usuarios SET clave = ?, cambiada_en = datetime('now', 'localtime') WHERE usuario = ?"),
  insertarSesion: db.prepare('INSERT INTO sesiones (token, usuario, ip, expira_en) VALUES (?, ?, ?, ?)'),
  sesion: db.prepare(`
    SELECT s.usuario, s.expira_en, COALESCE(u.rol, 'admin') AS rol
    FROM sesiones s LEFT JOIN usuarios u ON u.usuario = s.usuario WHERE s.token = ?`),
  borrarSesion: db.prepare('DELETE FROM sesiones WHERE token = ?'),
  borrarOtrasSesiones: db.prepare('DELETE FROM sesiones WHERE usuario = ? AND token <> ?'),
  borrarVencidas: db.prepare('DELETE FROM sesiones WHERE expira_en <= ?'),
  finanzasReservas: db.prepare(`
    SELECT r.id, r.codigo, r.palco, r.nombre, r.telefono, r.afiliacion, r.valor,
           (SELECT COALESCE(SUM(valor), 0) FROM pagos WHERE reserva_id = r.id) AS pagado,
           ${MEDIO_Y_FECHA},
           (SELECT COUNT(*) FROM reserva_sillas WHERE reserva_id = r.id) AS personas,
           p.categoria_id, p.empresa_id
    FROM reservas r JOIN palcos p ON p.numero = r.palco
    ORDER BY r.palco, r.id`),
  finanzasPagos: db.prepare(`
    SELECT pg.id, pg.reserva_id, pg.valor, pg.medio, pg.registrado_por, pg.fecha, r.palco, r.nombre, r.codigo
    FROM pagos pg JOIN reservas r ON r.id = pg.reserva_id
    ORDER BY pg.fecha DESC, pg.id DESC`),
  insertarSilla: db.prepare('INSERT INTO reserva_sillas (palco, silla, reserva_id) VALUES (?, ?, ?)'),
  borrarSillas: db.prepare('DELETE FROM reserva_sillas WHERE reserva_id = ?'),
  eliminar: db.prepare('DELETE FROM reservas WHERE id = ?'),
  buscar: db.prepare(`
    SELECT r.*, ${LISTA_SILLAS} AS sillas_texto, e.nombre AS empresa
    FROM reservas r
    JOIN palcos p ON p.numero = r.palco
    LEFT JOIN empresas e ON e.id = p.empresa_id
    WHERE r.nombre LIKE ?1 ESCAPE '\\' OR r.documento LIKE ?1 ESCAPE '\\'
       OR r.telefono LIKE ?1 ESCAPE '\\' OR r.notas LIKE ?1 ESCAPE '\\'
       OR r.registrado_por LIKE ?1 ESCAPE '\\' OR CAST(r.palco AS TEXT) = ?2
       OR r.codigo LIKE ?1 ESCAPE '\\' OR r.correo LIKE ?1 ESCAPE '\\'
    ORDER BY r.palco, r.id
    LIMIT 300`),
  respaldo: db.prepare('VACUUM INTO ?'),
};

// Categorías y empresas comparten la misma forma (nombre + color); las categorías además tienen precio.
const GRUPOS = {};
for (const tabla of ['categorias', 'empresas']) {
  const conPrecio = tabla === 'categorias';
  const columnas = conPrecio ? 'id, nombre, color, precio' : 'id, nombre, color';
  GRUPOS[tabla] = {
    conPrecio,
    listar: db.prepare(`SELECT ${columnas} FROM ${tabla} ORDER BY id`),
    obtener: db.prepare(`SELECT ${columnas} FROM ${tabla} WHERE id = ?`),
    insertar: db.prepare(conPrecio
      ? `INSERT INTO ${tabla} (nombre, color, precio) VALUES (?, ?, ?)`
      : `INSERT INTO ${tabla} (nombre, color) VALUES (?, ?)`),
    actualizar: db.prepare(conPrecio
      ? `UPDATE ${tabla} SET nombre = ?, color = ?, precio = ? WHERE id = ?`
      : `UPDATE ${tabla} SET nombre = ?, color = ? WHERE id = ?`),
    eliminar: db.prepare(`DELETE FROM ${tabla} WHERE id = ?`),
  };
}
const asignarCategoria = db.prepare('UPDATE palcos SET categoria_id = ? WHERE numero = ?');
const asignarEmpresa = db.prepare('UPDATE palcos SET empresa_id = ? WHERE numero = ?');

let huboCambios = false;

// ── Validación ──────────────────────────────────────────────────────────
const texto = (v, max) => String(v ?? '').trim().slice(0, max);
// Pesos enteros: acepta "3.000.000", "$ 3,000,000" o 3000000.
const entero = v => Number(String(v ?? '').replace(/[^\d]/g, '').slice(0, 13)) || 0;
const pesos = n => `$ ${n.toLocaleString('es-CO')}`;

function limpiarReserva(datos, capacidad) {
  const r = {
    nombre: texto(datos.nombre, 120),
    documento: texto(datos.documento, 40),
    telefono: texto(datos.telefono, 40),
    notas: texto(datos.notas, 500),
    registrado_por: texto(datos.registrado_por, 60),
    valor: entero(datos.valor),
    afiliacion: texto(datos.afiliacion, 40),
    correo: texto(datos.correo, 120).toLowerCase(),
    autoriza_datos: datos.autoriza_datos ? 1 : 0,
    sillas: [...new Set((Array.isArray(datos.sillas) ? datos.sillas : []).map(Number))].sort((a, b) => a - b),
  };
  if (!r.nombre) throw new ErrorHttp(400, 'El nombre es obligatorio');
  if (r.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.correo)) throw new ErrorHttp(400, 'El correo electrónico no es válido');
  if (r.sillas.length === 0) throw new ErrorHttp(400, 'Selecciona al menos una silla');
  if (r.sillas.some(s => !Number.isInteger(s) || s < 1 || s > capacidad)) throw new ErrorHttp(400, 'Hay una silla inválida en la selección');
  return r;
}

function obtenerPalcoODar404(numero) {
  const palco = sql.palco.get(numero);
  if (!palco) throw new ErrorHttp(404, `El palco ${numero} no existe`);
  return palco;
}

// La regla principal: una silla no puede estar en dos reservas.
function verificarSillas(palco, sillas, excluirId = 0) {
  const ocupadas = new Set(sql.sillasOcupadas.all(palco, excluirId).map(s => s.silla));
  const choque = sillas.filter(s => ocupadas.has(s));
  if (choque.length) {
    throw new ErrorHttp(409, choque.length === 1
      ? `La silla ${choque[0]} del palco ${palco} ya está ocupada`
      : `Las sillas ${choque.join(', ')} del palco ${palco} ya están ocupadas`);
  }
}

// ── Palcos y reservas ───────────────────────────────────────────────────
function estadoGeneral() {
  const ocupadas = new Map();
  for (const { palco, silla } of sql.sillasOcupadasTodas.all()) {
    if (!ocupadas.has(palco)) ocupadas.set(palco, []);
    ocupadas.get(palco).push(silla);
  }
  return {
    palcos: sql.palcos.all().map(p => ({ ...p, ocupadas: ocupadas.get(p.numero) || [] })),
    categorias: GRUPOS.categorias.listar.all(),
    empresas: GRUPOS.empresas.listar.all(),
  };
}

function obtenerPalco(numero) {
  const palco = obtenerPalcoODar404(numero);
  const sillas = sql.sillasDePalco.all(numero);
  const pagos = sql.pagosDePalco.all(numero);
  const reservas = sql.reservasDePalco.all(numero).map(r => {
    const suyos = pagos.filter(p => p.reserva_id === r.id);
    return {
      ...r,
      sillas: sillas.filter(s => s.reserva_id === r.id).map(s => s.silla),
      pagos: suyos,
      pagado: suyos.reduce((t, p) => t + p.valor, 0),
    };
  });
  return { ...palco, ocupadas: sillas.map(s => s.silla), reservas };
}

function conSillas(id) {
  const r = sql.reserva.get(id);
  const sillas = sql.sillasDePalco.all(r.palco).filter(s => s.reserva_id === id).map(s => s.silla);
  return { ...r, sillas };
}

// ── Historial de movimientos ────────────────────────────────────────────
// quien = { ip, usuario, registrado_por } lo arma el servidor en cada petición.
// Se guarda dentro de la misma transacción del cambio: no hay cambio sin registro.
function registrarMovimiento(quien, accion, { palco = null, codigo = '', detalle = '', antes = null, despues = null } = {}) {
  sql.historial.run(
    texto(quien?.ip, 60), texto(quien?.usuario, 40), texto(quien?.registrado_por, 60), accion, palco, codigo || '', texto(detalle, 2000),
    antes ? JSON.stringify(antes) : '', despues ? JSON.stringify(despues) : '');
  huboCambios = true;
}

// Reserva completa (con sillas y pagos) para guardarla en el historial.
function fotoReserva(id) {
  const r = sql.reserva.get(id);
  if (!r) return null;
  return {
    ...r,
    sillas: sql.sillasDeReserva.all(id).map(s => s.silla),
    pagos: sql.pagosDeReserva.all(id).map(p => ({ valor: p.valor, medio: p.medio, fecha: p.fecha, registrado_por: p.registrado_por })),
  };
}

const CAMPOS_LEGIBLES = {
  nombre: 'nombre', documento: 'documento', telefono: 'teléfono', correo: 'correo', afiliacion: 'afiliación',
  notas: 'notas', autoriza_datos: 'autoriza datos', sillas: 'sillas', valor: 'valor',
};
function diferencias(antes, despues) {
  const cambios = [];
  for (const [campo, nombre] of Object.entries(CAMPOS_LEGIBLES)) {
    const a = Array.isArray(antes[campo]) ? antes[campo].join(', ') : String(antes[campo] ?? '');
    const d = Array.isArray(despues[campo]) ? despues[campo].join(', ') : String(despues[campo] ?? '');
    if (a !== d) cambios.push(`${nombre}: "${a}" → "${d}"`);
  }
  return cambios.join('; ');
}

const rangosTexto = numeros => {
  const n = [...numeros].sort((a, b) => a - b);
  const partes = [];
  for (let i = 0; i < n.length; i++) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    partes.push(j > i ? `${n[i]}-${n[j]}` : `${n[i]}`);
    i = j;
  }
  return partes.join(', ');
};

// ── Pagos: toda reserva se paga completa al crearla ─────────────────────
function medioValido(medio) {
  const m = texto(medio, 30);
  if (!PLANO.MEDIOS_PAGO.includes(m)) throw new ErrorHttp(400, 'Elige el medio de pago');
  return m;
}

function crearReserva(datos, quien) {
  return transaccion(() => {
    const palco = obtenerPalcoODar404(Number(datos.palco));
    if (palco.bloqueado) {
      throw new ErrorHttp(409, `El palco ${palco.numero} está bloqueado${palco.motivo_bloqueo ? ` (${palco.motivo_bloqueo})` : ''}: no admite reservas nuevas`);
    }
    const r = limpiarReserva(datos, palco.capacidad);
    if (r.valor <= 0) throw new ErrorHttp(400, 'El valor total debe ser mayor a $ 0');
    const medio = medioValido(datos.medio_pago);
    verificarSillas(palco.numero, r.sillas);
    const codigo = nuevoCodigo();
    const id = Number(sql.insertar.run(palco.numero, r.nombre, r.documento, r.telefono, r.notas, r.registrado_por, r.valor, r.afiliacion,
      codigo, r.correo, r.autoriza_datos).lastInsertRowid);
    for (const s of r.sillas) sql.insertarSilla.run(palco.numero, s, id);
    // Sin pago no hay reserva: el pago completo se registra en la misma operación.
    sql.insertarPago.run(id, r.valor, medio, r.registrado_por);
    registrarMovimiento(quien, 'Crear reserva (pagada)', {
      palco: palco.numero, codigo,
      detalle: `${r.nombre} · palco ${palco.numero} · sillas ${r.sillas.join(', ')} · pagó ${pesos(r.valor)} (${medio})`,
      despues: fotoReserva(id),
    });
    return conSillas(id);
  });
}

// Una reserva pagada solo cambia datos personales o sus sillas por otras (misma cantidad):
// el valor ya está pagado y no se modifica.
function actualizarReserva(id, datos, quien) {
  return transaccion(() => {
    const antes = fotoReserva(id);
    if (!antes) throw new ErrorHttp(404, 'La reserva ya no existe (puede que otra persona la haya anulado)');
    const palco = obtenerPalcoODar404(antes.palco);
    const r = limpiarReserva(datos, palco.capacidad);
    if (r.sillas.length !== antes.sillas.length) {
      throw new ErrorHttp(409, `La reserva está pagada por ${antes.sillas.length === 1 ? '1 silla' : `${antes.sillas.length} sillas`}: `
        + 'puedes cambiar a otras sillas pero no la cantidad. Para cambiarla, anula la reserva y créala de nuevo.');
    }
    verificarSillas(palco.numero, r.sillas, id);
    // Se conserva quién la registró originalmente; quién la edita queda en el historial.
    sql.actualizar.run(r.nombre, r.documento, r.telefono, r.notas, antes.registrado_por, antes.valor, r.afiliacion, r.correo, r.autoriza_datos, id);
    sql.borrarSillas.run(id);
    for (const s of r.sillas) sql.insertarSilla.run(palco.numero, s, id);
    const despues = fotoReserva(id);
    registrarMovimiento(quien, 'Editar reserva', {
      palco: palco.numero, codigo: antes.codigo, detalle: diferencias(antes, despues) || 'sin cambios', antes, despues,
    });
    return conSillas(id);
  });
}

// Reservas antiguas (de antes de esta regla) con pago incompleto: se completa en un solo pago.
function completarPago(id, datos, quien) {
  return transaccion(() => {
    const antes = fotoReserva(id);
    if (!antes) throw new ErrorHttp(404, 'La reserva ya no existe');
    const medio = medioValido(datos.medio_pago);
    let valor = antes.valor;
    if (valor <= 0) {
      valor = entero(datos.valor);
      if (valor <= 0) throw new ErrorHttp(400, 'Escribe el valor total de la reserva');
      sql.ponerValor.run(valor, id);
    }
    const falta = valor - antes.pagos.reduce((t, p) => t + p.valor, 0);
    if (falta <= 0) throw new ErrorHttp(409, 'Esta reserva ya está pagada');
    sql.insertarPago.run(id, falta, medio, texto(quien?.registrado_por, 60));
    registrarMovimiento(quien, 'Completar pago', {
      palco: antes.palco, codigo: antes.codigo, detalle: `Pago de ${pesos(falta)} (${medio})`, antes, despues: fotoReserva(id),
    });
    return { palco: antes.palco };
  });
}

// Anular: libera las sillas y anula el pago. La reserva completa queda guardada en el historial.
function anularReserva(id, quien) {
  return transaccion(() => {
    const antes = fotoReserva(id);
    if (!antes) throw new ErrorHttp(404, 'La reserva ya no existe');
    const pagado = antes.pagos.reduce((t, p) => t + p.valor, 0);
    // Si ya habían ingresado al evento, esos ingresos se quitan del conteo (quedan en el historial).
    const ingresos = sql.ingresosDeReserva.all(id);
    const ingresados = ingresos.reduce((t, i) => t + i.personas, 0);
    sql.borrarIngresosDeReserva.run(id);
    sql.borrarPagosDeReserva.run(id);
    sql.eliminar.run(id); // las sillas se liberan solas (ON DELETE CASCADE)
    registrarMovimiento(quien, 'Anular reserva', {
      palco: antes.palco, codigo: antes.codigo,
      detalle: `${antes.nombre} · palco ${antes.palco} · sillas ${antes.sillas.join(', ')} · pago anulado ${pesos(pagado)}`
        + ` (${[...new Set(antes.pagos.map(p => p.medio))].join(', ') || 'sin pago'})`
        + (ingresados ? ` · ya habían ingresado ${ingresados} persona(s)` : ''),
      antes: ingresos.length ? { ...antes, ingresos } : antes,
    });
    return antes;
  });
}

// ── Boleta y correo ─────────────────────────────────────────────────────
// Datos listos para la boleta (lib/boleta.js).
function datosBoleta(id) {
  const r = sql.boleta.get(id);
  if (!r) throw new ErrorHttp(404, 'La reserva ya no existe');
  return {
    ...r,
    sillas: sql.sillasDeReserva.all(id).map(s => s.silla),
    categoria: r.categoria_nombre ? { nombre: r.categoria_nombre, color: r.categoria_color } : null,
    empresa: r.empresa_nombre ? { nombre: r.empresa_nombre } : null,
  };
}

function marcarCorreo(id, estadoEnvio, detalle = '') {
  sql.marcarCorreo.run(estadoEnvio, texto(detalle, 300), id);
  huboCambios = true;
}

function datosExcel() {
  return {
    reservas: sql.excelReservas.all(),
    pagos: sql.excelPagos.all(),
    ingresos: sql.excelIngresos.all(),
    palcos: sql.excelPalcos.all(),
    categorias: GRUPOS.categorias.listar.all(),
    empresas: GRUPOS.empresas.listar.all(),
  };
}

function finanzas() {
  return { reservas: sql.finanzasReservas.all(), pagos: sql.finanzasPagos.all() };
}

function buscar(consulta) {
  const q = String(consulta).trim().slice(0, 100);
  if (!q) return [];
  const patron = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  return sql.buscar.all(patron, q);
}

// ── Categorías, empresas y asignación de palcos ─────────────────────────
function grupo(tabla) {
  const g = GRUPOS[tabla];
  if (!g) throw new ErrorHttp(404, 'Ruta no encontrada');
  return g;
}

// Devuelve los valores en el orden de las columnas de la tabla (nombre, color[, precio]).
function limpiarGrupo(g, datos) {
  const nombre = texto(datos.nombre, 60);
  const color = texto(datos.color, 7);
  if (!nombre) throw new ErrorHttp(400, 'El nombre es obligatorio');
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ErrorHttp(400, 'Color inválido');
  return g.conPrecio ? [nombre, color, entero(datos.precio)] : [nombre, color];
}

const NOMBRE_GRUPO = { categorias: 'categoría', empresas: 'empresa' };

function crearGrupo(tabla, datos, quien) {
  const g = grupo(tabla);
  const valores = limpiarGrupo(g, datos);
  return transaccion(() => {
    const creado = g.obtener.get(Number(g.insertar.run(...valores).lastInsertRowid));
    registrarMovimiento(quien, `Crear ${NOMBRE_GRUPO[tabla]}`, {
      detalle: `${creado.nombre}${creado.precio !== undefined ? ` · precio palco ${pesos(creado.precio)}` : ''}`, despues: creado,
    });
    return creado;
  });
}

function actualizarGrupo(tabla, id, datos, quien) {
  const g = grupo(tabla);
  const valores = limpiarGrupo(g, datos);
  return transaccion(() => {
    const antes = g.obtener.get(id);
    if (!antes || Number(g.actualizar.run(...valores, id).changes) === 0) throw new ErrorHttp(404, 'Ya no existe');
    const despues = g.obtener.get(id);
    const cambios = Object.keys(despues).filter(k => antes[k] !== despues[k])
      .map(k => `${k}: "${k === 'precio' ? pesos(antes[k]) : antes[k]}" → "${k === 'precio' ? pesos(despues[k]) : despues[k]}"`);
    registrarMovimiento(quien, `Editar ${NOMBRE_GRUPO[tabla]}`, { detalle: `${antes.nombre}: ${cambios.join('; ') || 'sin cambios'}`, antes, despues });
    return despues;
  });
}

// datos: { palcos: [1, 2], bloqueado: true | false, motivo?: 'Cortesía' }
// Las reservas que ya existan en el palco se conservan; solo se impiden las nuevas.
function bloquearPalcos(datos, quien) {
  const palcos = [...new Set((Array.isArray(datos.palcos) ? datos.palcos : []).map(Number))];
  if (palcos.length === 0) throw new ErrorHttp(400, 'No hay palcos seleccionados');
  const bloqueado = datos.bloqueado ? 1 : 0;
  const motivo = bloqueado ? texto(datos.motivo, 120) : '';
  return transaccion(() => {
    for (const n of palcos) {
      obtenerPalcoODar404(n);
      sql.bloquear.run(bloqueado, motivo, n);
    }
    registrarMovimiento(quien, bloqueado ? 'Bloquear palcos' : 'Desbloquear palcos', {
      palco: palcos.length === 1 ? palcos[0] : null,
      detalle: `Palcos ${rangosTexto(palcos)}${motivo ? ` · motivo: ${motivo}` : ''}`,
    });
    return palcos;
  });
}

function eliminarGrupo(tabla, id, quien) {
  const g = grupo(tabla);
  transaccion(() => {
    const antes = g.obtener.get(id);
    if (!antes || Number(g.eliminar.run(id).changes) === 0) throw new ErrorHttp(404, 'Ya no existe');
    // los palcos que lo tenían quedan "sin asignar"
    registrarMovimiento(quien, `Eliminar ${NOMBRE_GRUPO[tabla]}`, { detalle: antes.nombre, antes });
  });
}

// datos: { palcos: [1, 2, 3], categoria_id?: id | null, empresa_id?: id | null }
function asignarPalcos(datos, quien) {
  const palcos = [...new Set((Array.isArray(datos.palcos) ? datos.palcos : []).map(Number))];
  if (palcos.length === 0) throw new ErrorHttp(400, 'No hay palcos seleccionados');
  const cambios = [];
  for (const [campo, tabla, sentencia] of [['categoria_id', 'categorias', asignarCategoria], ['empresa_id', 'empresas', asignarEmpresa]]) {
    if (!(campo in datos)) continue;
    const id = datos[campo] === null ? null : Number(datos[campo]);
    if (id !== null && !GRUPOS[tabla].obtener.get(id)) throw new ErrorHttp(404, 'La categoría o empresa ya no existe');
    cambios.push([sentencia, id]);
  }
  if (cambios.length === 0) throw new ErrorHttp(400, 'Elige una categoría o una empresa para asignar');
  return transaccion(() => {
    for (const n of palcos) {
      obtenerPalcoODar404(n);
      for (const [sentencia, id] of cambios) sentencia.run(id, n);
    }
    const partes = [];
    if ('categoria_id' in datos) partes.push(`zona: ${datos.categoria_id === null ? '(sin zona)' : GRUPOS.categorias.obtener.get(Number(datos.categoria_id))?.nombre}`);
    if ('empresa_id' in datos) partes.push(`empresa: ${datos.empresa_id === null ? '(sin empresa)' : GRUPOS.empresas.obtener.get(Number(datos.empresa_id))?.nombre}`);
    registrarMovimiento(quien, 'Asignar zona/empresa', {
      palco: palcos.length === 1 ? palcos[0] : null,
      detalle: `Palcos ${rangosTexto(palcos)} · ${partes.join(' · ')}`,
    });
    return palcos;
  });
}

// ── Ingreso al evento ───────────────────────────────────────────────────
// Saca el código FA-XXXX de lo que mande la pistola (el QR trae varias líneas y a veces
// letras dañadas por la distribución del teclado) o de lo que se escriba a mano ("WGGU").
// La pistola Honeywell separa las líneas con "flecha abajo", así que el código puede llegar
// pegado al nombre ("FA-WGGUaPalco"): se toman las 4 letras que siguen a "FA-".
const LETRAS_CODIGO = `[${ALFABETO_CODIGO}]`;
const BUSCAR_CODIGO = [
  new RegExp(`(?:^|[^A-Z0-9])FA[^A-Z0-9]{1,3}(${LETRAS_CODIGO}{4})`),          // FA-WGGU (o con el guion dañado)
  new RegExp(`(?:^|[^A-Z0-9])FA(${LETRAS_CODIGO}{4})(?![A-Z0-9])`),             // FAWGGU escrito a mano
  new RegExp(`^(${LETRAS_CODIGO}{4})$`),                                        // solo WGGU
];
function codigoDeLectura(leido) {
  const t = String(leido ?? '').toUpperCase().slice(0, 2000).trim();
  for (const re of BUSCAR_CODIGO) {
    const m = t.match(re);
    if (m) return `FA-${m[1]}`;
  }
  return '';
}

function infoIngreso(r) {
  const ingresos = sql.ingresosDeReserva.all(r.id);
  const ingresados = ingresos.reduce((t, i) => t + i.personas, 0);
  return { ...r, ingresados, faltan: Math.max(0, r.personas - ingresados), ingresos };
}

function reservaDeLectura(leido, quien) {
  const codigo = codigoDeLectura(leido);
  const r = codigo && sql.reservaIngreso.get(codigo);
  if (!r) {
    const visto = String(leido ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    registrarMovimiento(quien, 'Ingreso: código no válido', { codigo, detalle: `Leído: "${visto}"` });
    throw new ErrorHttp(404, codigo ? `El código ${codigo} no existe o fue anulado` : 'No se encontró un código de reserva en la lectura');
  }
  return r;
}

// Consultar (al leer el QR o escribir el código): todavía no registra el ingreso.
function consultarIngreso(datos, quien) {
  const info = infoIngreso(reservaDeLectura(datos.codigo, quien));
  if (info.faltan === 0) {
    registrarMovimiento(quien, 'Ingreso: lectura de reserva ya completa', {
      palco: info.palco, codigo: info.codigo, detalle: `${info.nombre} · ${info.ingresados} de ${info.personas} ya habían ingresado · puerta ${texto(datos.puerta, 40) || '(sin nombre)'}`,
    });
  }
  return info;
}

function registrarIngreso(datos, quien) {
  return transaccion(() => {
    const r = reservaDeLectura(datos.codigo, quien);
    const antes = infoIngreso(r);
    const personas = Number(datos.personas);
    if (antes.faltan === 0) throw new ErrorHttp(409, `Esta reserva ya ingresó completa (${antes.ingresados} de ${antes.personas})`);
    if (!Number.isInteger(personas) || personas < 1) throw new ErrorHttp(400, 'Indica cuántas personas ingresan');
    if (personas > antes.faltan) throw new ErrorHttp(409, `Solo ${antes.faltan === 1 ? 'falta 1 persona' : `faltan ${antes.faltan} personas`} por ingresar en esta reserva`);
    const puerta = texto(datos.puerta, 40);
    sql.insertarIngreso.run(r.id, r.codigo, r.palco, r.nombre, personas, puerta, texto(quien?.usuario, 40), texto(quien?.ip, 60));
    registrarMovimiento(quien, 'Registrar ingreso', {
      palco: r.palco, codigo: r.codigo,
      detalle: `${r.nombre} · ingresan ${personas} · van ${antes.ingresados + personas} de ${r.personas} · puerta ${puerta || '(sin nombre)'}`,
    });
    return infoIngreso(r);
  });
}

// Deshacer un ingreso de esa reserva (el elegido en la tarjeta, o el último si no se indica).
function deshacerIngreso(datos, quien) {
  return transaccion(() => {
    const r = reservaDeLectura(datos.codigo, quien);
    const antes = infoIngreso(r);
    if (!antes.ingresos.length) throw new ErrorHttp(409, 'Esta reserva no tiene ingresos para deshacer');
    const id = Number(datos.ingreso_id);
    const ultimo = id ? antes.ingresos.find(i => i.id === id) : antes.ingresos.at(-1);
    if (!ultimo) throw new ErrorHttp(404, 'Ese ingreso ya fue deshecho. Revisa la tarjeta actualizada.');
    sql.borrarIngreso.run(ultimo.id);
    registrarMovimiento(quien, 'Deshacer ingreso', {
      palco: r.palco, codigo: r.codigo,
      detalle: `${r.nombre} · se quitó el ingreso de ${ultimo.personas} (${ultimo.fecha.slice(11, 16)}, puerta ${ultimo.puerta || '(sin nombre)'}) · quedan ${antes.ingresados - ultimo.personas} de ${r.personas}`,
      antes: ultimo,
    });
    return infoIngreso(r);
  });
}

// Todo lo de la gráfica en vivo: asistencia por reserva y la lista de ingresos.
function estadoIngresos() {
  return { reservas: sql.asistenciaReservas.all(), ingresos: sql.ingresosTodos.all() };
}

// ── Inicio de sesión ────────────────────────────────────────────────────
// Devuelve el nombre del usuario tal como está guardado (ej. "CESAP"), o null si no coincide.
function verificarUsuario(usuario, clave) {
  const u = sql.usuario.get(texto(usuario, 40));
  const ok = CLAVES.coincide(String(clave ?? ''), u?.clave);
  return u && ok ? u.usuario : null;
}

// Crea la sesión y devuelve el token para la cookie (en la base solo queda su resumen).
function crearSesion(usuario, ip) {
  const token = CLAVES.nuevoToken();
  sql.insertarSesion.run(CLAVES.resumenToken(token), usuario, texto(ip, 60), Date.now() + HORAS_SESION * 3600_000);
  return token;
}

function sesionDeToken(token) {
  if (!token) return null;
  const s = sql.sesion.get(CLAVES.resumenToken(token));
  if (!s) return null;
  if (s.expira_en <= Date.now()) {
    sql.borrarSesion.run(CLAVES.resumenToken(token));
    return null;
  }
  return { usuario: s.usuario, expira_en: s.expira_en, rol: s.rol };
}

function cerrarSesion(token) {
  if (token) sql.borrarSesion.run(CLAVES.resumenToken(token));
}

function limpiarSesionesVencidas() {
  sql.borrarVencidas.run(Date.now());
}

// Cambia la contraseña del usuario de la sesión y cierra sus otras sesiones abiertas.
function cambiarClave(usuario, datos, tokenActual, quien) {
  const actual = String(datos.actual ?? '');
  const nueva = String(datos.nueva ?? '');
  if (!verificarUsuario(usuario, actual)) throw new ErrorHttp(400, 'La contraseña actual no es correcta');
  if (nueva.length < 8) throw new ErrorHttp(400, 'La nueva contraseña debe tener al menos 8 caracteres');
  if (nueva.length > 100) throw new ErrorHttp(400, 'La nueva contraseña es demasiado larga');
  if (nueva !== String(datos.repetir ?? '')) throw new ErrorHttp(400, 'Las dos contraseñas nuevas no coinciden');
  if (nueva === actual) throw new ErrorHttp(400, 'La nueva contraseña debe ser distinta a la actual');
  transaccion(() => {
    sql.cambiarClave.run(CLAVES.huella(nueva), usuario);
    sql.borrarOtrasSesiones.run(usuario, CLAVES.resumenToken(tokenActual));
    registrarMovimiento(quien, 'Cambiar contraseña', { detalle: `Usuario ${usuario}. Se cerraron sus otras sesiones abiertas.` });
  });
}

// ── Respaldos (la programación y las carpetas están en lib/respaldos.js) ─
// Copia consistente de toda la base (funciona aunque haya gente registrando).
function copiarBaseA(destino) {
  sql.respaldo.run(destino);
}
const hayCambios = () => huboCambios;
function cambiosRespaldados() { huboCambios = false; }

function cerrar() {
  db.close();
}

module.exports = {
  ErrorHttp,
  DIR_DATOS,
  estadoGeneral,
  obtenerPalco,
  crearReserva,
  actualizarReserva,
  anularReserva,
  completarPago,
  registrarMovimiento,
  buscar,
  datosBoleta,
  marcarCorreo,
  datosExcel,
  finanzas,
  crearGrupo,
  actualizarGrupo,
  eliminarGrupo,
  asignarPalcos,
  bloquearPalcos,
  consultarIngreso,
  registrarIngreso,
  deshacerIngreso,
  estadoIngresos,
  verificarUsuario,
  crearSesion,
  sesionDeToken,
  cerrarSesion,
  limpiarSesionesVencidas,
  cambiarClave,
  copiarBaseA,
  hayCambios,
  cambiosRespaldados,
  cerrar,
};
