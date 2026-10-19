'use strict';
// Servidor HTTP: sirve la página, la API JSON y los avisos en tiempo real (SSE).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const db = require('./db');
const correo = require('./lib/correo');
const respaldos = require('./lib/respaldos');
const BOLETA = require('./lib/boleta');
const EXPORTAR = require('./lib/exportar');

const PUERTO = Number(process.env.PUERTO) || 3000;
const DIR_PUBLICO = path.join(__dirname, 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ── Tiempo real ─────────────────────────────────────────────────────────
const clientes = new Set();

function emitir(evento, datos) {
  const mensaje = `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
  for (const res of clientes) res.write(mensaje);
}

function avisarCambio(...palcos) {
  emitir('cambio', { palcos: [...new Set(palcos)] });
}

// Mantiene viva la conexión aunque no haya cambios.
// Además corta las pantallas cuya sesión venció o se cerró (vuelven a pedir inicio de sesión).
setInterval(() => {
  for (const res of clientes) res.write(': ping\n\n');
  cortarSesionesCerradas();
}, 25_000);

function cortarSesionesCerradas() {
  for (const res of clientes) {
    if (!db.sesionDeToken(res.tokenSesion)) {
      clientes.delete(res);
      res.end();
    }
  }
}

// ── Inicio de sesión ────────────────────────────────────────────────────
const COOKIE = 'sesion';
const SEGUNDOS_SESION = 12 * 3600;
// Archivos que se ven sin sesión (la página de ingreso y su estilo).
const PUBLICOS = new Set(['/login.html', '/estilos.css', '/favicon.ico']);

function leerCookie(req, nombre) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return parte.slice(i + 1).trim();
  }
  return '';
}

function cookieSesion(token, segundos) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${segundos}`;
}

// Intentos fallidos por equipo: 5 seguidos → 5 minutos bloqueado.
const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 5;
const intentos = new Map(); // ip → { fallos, hasta }

function ipDe(req) {
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

// ── Quién hace cada cambio (para el historial interno) ──────────────────
// IP del equipo + usuario de la sesión + el nombre de "Registrado por" que la página envía.
function quien(req, url, sesion) {
  let ip = ipDe(req);
  if (ip === '::1' || ip === '127.0.0.1') ip = '127.0.0.1 (este servidor)';
  let nombre = '';
  try { nombre = decodeURIComponent(req.headers['x-registrado-por'] || url.searchParams.get('por') || ''); } catch { /* nombre ilegible */ }
  return { ip, usuario: sesion?.usuario || '', registrado_por: nombre.trim().slice(0, 60) };
}

// ── Correo con la boleta ────────────────────────────────────────────────
function mensajeBoleta(d) {
  return {
    para: d.correo,
    asunto: `Tu reserva ${d.codigo} · Palco ${d.palco} · Gran Fiesta Anual de Afiliados`,
    html: BOLETA.htmlCorreo(d),
    texto: BOLETA.textoCorreo(d),
    adjuntos: [
      { nombre: 'codigo-qr.png', tipo: 'image/png', contenido: BOLETA.pngQR(d), cid: 'qr-reserva' },
      { nombre: `Boleta-${d.codigo}.pdf`, tipo: 'application/pdf', contenido: BOLETA.pdf(d) },
    ],
  };
}

// Deja el correo en cola (no hace esperar a quien registra) y avisa a las pantallas el resultado.
function enviarBoleta(id, q) {
  const d = db.datosBoleta(id);
  if (!d.correo) throw new db.ErrorHttp(400, 'La reserva no tiene correo electrónico');
  if (!d.autoriza_datos) throw new db.ErrorHttp(400, 'La persona no autorizó el envío de información a su correo');
  const estadoCorreo = correo.estado();
  if (!estadoCorreo.activo) {
    db.marcarCorreo(id, 'error', estadoCorreo.problema || 'El envío de correos no está configurado (config.json)');
    avisarCambio(d.palco);
    return false;
  }
  db.marcarCorreo(id, 'pendiente');
  db.registrarMovimiento(q, 'Enviar boleta por correo', { palco: d.palco, codigo: d.codigo, detalle: `a ${d.correo}` });
  avisarCambio(d.palco);
  correo.encolar(async () => {
    try {
      await correo.enviar(mensajeBoleta(db.datosBoleta(id))); // datos frescos al momento de enviar
      db.marcarCorreo(id, 'enviado');
      db.registrarMovimiento(q, 'Correo enviado', { palco: d.palco, codigo: d.codigo, detalle: `a ${d.correo}` });
      console.log(`[correo] Boleta ${d.codigo} enviada a ${d.correo}`);
    } catch (err) {
      console.error(`[correo] Boleta ${d.codigo}: ${err.message}`);
      try {
        db.marcarCorreo(id, 'error', err.message);
        db.registrarMovimiento(q, 'Correo con error', { palco: d.palco, codigo: d.codigo, detalle: `a ${d.correo}: ${err.message}` });
      } catch { /* la reserva ya no existe */ }
    }
    avisarCambio(d.palco);
  });
  return true;
}

// ── Utilidades ──────────────────────────────────────────────────────────
function json(res, status, datos) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    let texto = '';
    req.setEncoding('utf8');
    req.on('data', parte => {
      texto += parte;
      if (texto.length > 100_000) {
        rechazar(new db.ErrorHttp(413, 'Datos demasiado grandes'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolver(texto ? JSON.parse(texto) : {}); }
      catch { rechazar(new db.ErrorHttp(400, 'Datos inválidos')); }
    });
    req.on('error', rechazar);
  });
}

// ── API ─────────────────────────────────────────────────────────────────
async function api(req, res, url, sesion, token) {
  const ruta = url.pathname;
  const metodo = req.method;
  const q = quien(req, url, sesion);
  let m;

  // Ingresar: única ruta de la API que funciona sin sesión.
  if (ruta === '/api/login' && metodo === 'POST') {
    const ip = ipDe(req);
    const ahora = Date.now();
    const registro = intentos.get(ip);
    if (registro?.hasta > ahora) {
      const minutos = Math.ceil((registro.hasta - ahora) / 60_000);
      throw new db.ErrorHttp(429, `Demasiados intentos fallidos. Espera ${minutos} minuto(s) y vuelve a intentar.`);
    }
    const datos = await leerCuerpo(req);
    const escrito = String(datos.usuario ?? '').trim().slice(0, 40);
    const usuario = db.verificarUsuario(escrito, datos.clave);
    if (!usuario) {
      const fallos = (registro && !registro.hasta ? registro.fallos : 0) + 1;
      const bloqueado = fallos >= MAX_INTENTOS;
      intentos.set(ip, bloqueado ? { fallos, hasta: ahora + MINUTOS_BLOQUEO * 60_000 } : { fallos });
      db.registrarMovimiento(q, 'Intento de ingreso fallido', { detalle: `Usuario escrito: "${escrito}"` });
      if (bloqueado) {
        db.registrarMovimiento(q, 'Equipo bloqueado por intentos', { detalle: `${fallos} intentos fallidos seguidos. Bloqueado ${MINUTOS_BLOQUEO} minutos.` });
        throw new db.ErrorHttp(429, `Demasiados intentos fallidos. Espera ${MINUTOS_BLOQUEO} minutos y vuelve a intentar.`);
      }
      throw new db.ErrorHttp(401, `Usuario o contraseña incorrectos (intento ${fallos} de ${MAX_INTENTOS}).`);
    }
    intentos.delete(ip);
    const nuevo = db.crearSesion(usuario, q.ip);
    db.registrarMovimiento({ ...q, usuario }, 'Iniciar sesión', { detalle: `Usuario ${usuario}` });
    res.setHeader('Set-Cookie', cookieSesion(nuevo, SEGUNDOS_SESION));
    return json(res, 200, { ok: true, usuario });
  }

  if (!sesion) throw new db.ErrorHttp(401, 'Tu sesión terminó. Vuelve a iniciar sesión.');

  if (ruta === '/api/sesion' && metodo === 'GET') {
    return json(res, 200, { usuario: sesion.usuario, expira_en: sesion.expira_en });
  }

  if (ruta === '/api/logout' && metodo === 'POST') {
    db.cerrarSesion(token);
    db.registrarMovimiento(q, 'Cerrar sesión', { detalle: `Usuario ${sesion.usuario}` });
    cortarSesionesCerradas();
    res.setHeader('Set-Cookie', cookieSesion('', 0));
    return json(res, 200, { ok: true });
  }

  if (ruta === '/api/clave' && metodo === 'POST') {
    db.cambiarClave(sesion.usuario, await leerCuerpo(req), token, q);
    cortarSesionesCerradas();
    return json(res, 200, { ok: true });
  }

  if (ruta === '/api/eventos' && metodo === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    res.tokenSesion = token;
    clientes.add(res);
    emitir('conectados', { total: clientes.size });
    req.on('close', () => {
      clientes.delete(res);
      emitir('conectados', { total: clientes.size });
    });
    return;
  }

  if (ruta === '/api/estado' && metodo === 'GET') {
    return json(res, 200, db.estadoGeneral());
  }

  if ((m = ruta.match(/^\/api\/palcos\/(\d+)$/)) && metodo === 'GET') {
    return json(res, 200, db.obtenerPalco(Number(m[1])));
  }

  if (ruta === '/api/palcos/asignar' && metodo === 'POST') {
    const palcos = db.asignarPalcos(await leerCuerpo(req), q);
    emitir('config', { palcos });
    return json(res, 200, { ok: true, palcos });
  }

  if (ruta === '/api/palcos/bloquear' && metodo === 'POST') {
    const palcos = db.bloquearPalcos(await leerCuerpo(req), q);
    emitir('config', { palcos });
    return json(res, 200, { ok: true, palcos });
  }

  if ((m = ruta.match(/^\/api\/(categorias|empresas)(?:\/(\d+))?$/))) {
    const [, tabla, id] = m;
    if (!id && metodo === 'POST') {
      const creado = db.crearGrupo(tabla, await leerCuerpo(req), q);
      emitir('config', {});
      return json(res, 201, creado);
    }
    if (id && metodo === 'PUT') {
      const actualizado = db.actualizarGrupo(tabla, Number(id), await leerCuerpo(req), q);
      emitir('config', {});
      return json(res, 200, actualizado);
    }
    if (id && metodo === 'DELETE') {
      db.eliminarGrupo(tabla, Number(id), q);
      emitir('config', {});
      return json(res, 200, { ok: true });
    }
  }

  // Crear reserva = reservar y pagar el valor completo en una sola operación.
  if (ruta === '/api/reservas' && metodo === 'POST') {
    const reserva = db.crearReserva(await leerCuerpo(req), q);
    avisarCambio(reserva.palco);
    let correoEnCola = false;
    if (reserva.correo && reserva.autoriza_datos) {
      try { correoEnCola = enviarBoleta(reserva.id, q); } catch (err) { console.error('[correo]', err.message); }
    }
    return json(res, 201, { ...reserva, correoEnCola });
  }

  if ((m = ruta.match(/^\/api\/reservas\/(\d+)\/correo$/)) && metodo === 'POST') {
    const enCola = enviarBoleta(Number(m[1]), q);
    if (!enCola) throw new db.ErrorHttp(409, correo.estado().problema || 'El envío de correos no está configurado (config.json)');
    return json(res, 202, { ok: true });
  }

  if ((m = ruta.match(/^\/api\/reservas\/(\d+)\/boleta\.pdf$/)) && metodo === 'GET') {
    const d = db.datosBoleta(Number(m[1]));
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Boleta-${d.codigo}.pdf"`,
      'Cache-Control': 'no-store',
    });
    return res.end(Buffer.from(BOLETA.pdf(d)));
  }

  // Solo para reservas antiguas (de antes de exigir pago completo) que quedaron con pago incompleto.
  if ((m = ruta.match(/^\/api\/reservas\/(\d+)\/completar-pago$/)) && metodo === 'POST') {
    const r = db.completarPago(Number(m[1]), await leerCuerpo(req), q);
    avisarCambio(r.palco);
    return json(res, 200, { ok: true });
  }

  if (ruta === '/api/correo/estado' && metodo === 'GET') {
    return json(res, 200, correo.estado());
  }

  // Correo de prueba con una boleta de ejemplo, para comprobar la configuración.
  if (ruta === '/api/correo/prueba' && metodo === 'POST') {
    const { para } = await leerCuerpo(req);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(para || ''))) throw new db.ErrorHttp(400, 'Escribe un correo válido para la prueba');
    const ejemplo = {
      codigo: 'FA-PRUEBA', nombre: 'Correo de prueba', documento: '', afiliacion: 'CESAP', palco: 1, sillas: [1, 2],
      capacidad: 10, valor: 600000, pagado: 600000, medio_pago: 'Efectivo', fecha_pago: '',
      categoria: { nombre: 'Morado', color: '#8e44ad' }, creado_en: '', correo: para,
    };
    try {
      await correo.enviar(mensajeBoleta(ejemplo));
      db.registrarMovimiento(q, 'Correo de prueba', { detalle: `a ${para}` });
    } catch (err) {
      throw new db.ErrorHttp(502, err.message);
    }
    return json(res, 200, { ok: true });
  }

  if (ruta === '/api/exportar.xlsx' && metodo === 'GET') {
    const hoy = new Date().toLocaleDateString('sv-SE');
    const archivo = Buffer.from(EXPORTAR.crear(db.datosExcel()));
    db.registrarMovimiento(q, 'Descargar Excel', { detalle: 'Exportar a Excel desde la página' });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="reservas-palcos_${hoy}.xlsx"`,
      'Cache-Control': 'no-store',
    });
    return res.end(archivo);
  }

  if ((m = ruta.match(/^\/api\/reservas\/(\d+)$/))) {
    const id = Number(m[1]);
    if (metodo === 'PUT') {
      const reserva = db.actualizarReserva(id, await leerCuerpo(req), q);
      avisarCambio(reserva.palco);
      return json(res, 200, reserva);
    }
    if (metodo === 'DELETE') {
      const reserva = db.anularReserva(id, q);
      avisarCambio(reserva.palco);
      return json(res, 200, { ok: true });
    }
  }

  if (ruta === '/api/buscar' && metodo === 'GET') {
    return json(res, 200, db.buscar(url.searchParams.get('q') || ''));
  }

  if (ruta === '/api/finanzas' && metodo === 'GET') {
    return json(res, 200, db.finanzas());
  }

  throw new db.ErrorHttp(404, 'Ruta no encontrada');
}

// ── Archivos de la página ───────────────────────────────────────────────
function redirigir(res, destino) {
  res.writeHead(302, { Location: destino, 'Cache-Control': 'no-store' });
  res.end();
}

function servirArchivo(req, res, ruta, sesion) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new db.ErrorHttp(405, 'Método no permitido');
  // Sin sesión solo se ve la página de ingreso. Con sesión, la de ingreso lleva al sistema.
  if (!sesion && !PUBLICOS.has(ruta)) {
    if (ruta === '/' || ruta.endsWith('.html')) return redirigir(res, '/login.html');
    throw new db.ErrorHttp(401, 'Inicia sesión primero');
  }
  if (sesion && ruta === '/login.html') return redirigir(res, '/');
  let relativa;
  try { relativa = decodeURIComponent(ruta === '/' ? '/index.html' : ruta); }
  catch { throw new db.ErrorHttp(400, 'Ruta inválida'); }
  const archivo = path.join(DIR_PUBLICO, path.normalize(relativa));
  if (!archivo.startsWith(DIR_PUBLICO + path.sep)) throw new db.ErrorHttp(403, 'Prohibido');

  fs.readFile(archivo, (err, contenido) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : contenido);
  });
}

// ── Arranque ────────────────────────────────────────────────────────────
const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = leerCookie(req, COOKIE);
    const sesion = db.sesionDeToken(token);
    if (url.pathname.startsWith('/api/')) await api(req, res, url, sesion, token);
    else servirArchivo(req, res, url.pathname, sesion);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Error interno del servidor' : err.message });
    else res.end();
  }
});

servidor.listen(PUERTO, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  console.log('\n  Reservas de Palcos funcionando.\n');
  console.log(`  En este equipo:   http://localhost:${PUERTO}`);
  for (const ip of ips) console.log(`  Desde la red:     http://${ip}:${PUERTO}`);
  console.log(`\n  Respaldos en:     ${respaldos.carpetaConfigurada()}`);
  const ec = correo.estado();
  console.log(ec.activo ? `  Correo:           activo (${ec.metodo}${ec.remitente ? `, ${ec.remitente}` : ''})` : `  Correo:           NO ACTIVO → ${ec.problema}`);
  console.log('  Ingreso:          usuarios CESAP y CESNE (sesión de 12 horas)');
  console.log('\n  No cierres esta ventana mientras se use el sistema.\n');
  respaldos.iniciar();
  db.limpiarSesionesVencidas();
  setInterval(() => db.limpiarSesionesVencidas(), 3600_000);
});

servidor.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`\n  El puerto ${PUERTO} ya está en uso. ¿El sistema ya está abierto en otra ventana?\n`);
  else console.error(err);
  process.exit(1);
});

function apagar() {
  console.log('\n  Cerrando y guardando respaldo...');
  for (const res of clientes) res.end();
  respaldos.respaldar('cierre');
  db.cerrar();
  process.exit(0);
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
