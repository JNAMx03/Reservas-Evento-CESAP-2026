'use strict';
// Envío de correos sin dependencias. Tres formas (se elige en config.json):
//  - "google_script": una cuenta de Gmail con un Google Apps Script (ver google-apps-script.gs).
//                     Usa HTTPS (puerto 443): sirve cuando la red bloquea los puertos de correo.
//  - "graph":         Microsoft 365 / Outlook institucional, con una aplicación registrada en Entra ID.
//  - "smtp":          Gmail (contraseña de aplicación) u otro servidor SMTP con usuario y contraseña.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const https = require('node:https');
const os = require('node:os');

const ARCHIVO_CONFIG = path.join(__dirname, '..', 'config.json');

let errorConfig = ''; // explicación del último problema al leer config.json

function config() {
  let texto;
  try {
    texto = fs.readFileSync(ARCHIVO_CONFIG, 'utf8').replace(/^\uFEFF/, ''); // tolera el BOM del Bloc de notas
  } catch {
    errorConfig = 'No existe config.json en la carpeta del sistema (cópialo desde config.ejemplo.json)';
    return {};
  }
  try {
    const c = JSON.parse(texto);
    errorConfig = c.correo ? '' : 'config.json no tiene la sección "correo"';
    return c.correo || {};
  } catch (err) {
    errorConfig = `config.json tiene un error de formato (${err.message}). `
      + 'Revisa comas y comillas, y que las rutas usen barras dobles, por ejemplo "D:\\\\sw\\\\BK\\\\..."';
    return {};
  }
}

function estado() {
  const c = config();
  const metodo = ['graph', 'google_script'].includes(c.metodo) ? c.metodo : 'smtp';
  const completo = {
    graph: () => Boolean(c.graph?.tenant_id && c.graph?.client_id && c.graph?.client_secret && c.remitente),
    google_script: () => Boolean(c.google_script?.url && c.google_script?.clave),
    smtp: () => Boolean(c.smtp?.servidor && c.smtp?.usuario && c.smtp?.clave),
  }[metodo]();
  let problema = errorConfig;
  if (!problema && !completo) problema = `Faltan datos del correo en config.json (método "${metodo}")`;
  if (!problema && !c.activo) problema = 'El envío de correos está desactivado: en config.json cambia "activo" a true';
  return { activo: Boolean(c.activo) && completo, configurado: completo, metodo, remitente: c.remitente || c.smtp?.usuario || '', problema };
}

const b64 = datos => Buffer.from(datos).toString('base64');
const b64Lineas = datos => b64(datos).replace(/.{1,76}/g, '$&\r\n');
const encabezado = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(Buffer.from(s, 'utf8'))}?=`);

// mensaje = { para, asunto, html, texto, adjuntos: [{ nombre, tipo, contenido (Uint8Array), cid? }] }
async function enviar(mensaje) {
  const c = config();
  const e = estado();
  if (!e.activo) throw new Error(e.problema || 'El correo no está configurado (revisa config.json)');
  if (e.metodo === 'google_script') return enviarGoogleScript(c, mensaje);
  return e.metodo === 'graph' ? enviarGraph(c, mensaje) : enviarSmtp(c, mensaje);
}

// ── HTTPS con los certificados de la red ────────────────────────────────
// La red institucional revisa algunas conexiones seguras con su propio certificado
// (firewall chek.policia.gov.co). Se confía en: los certificados normales de Node,
// los de Windows (si esta versión de Node puede leerlos) y los de certificados.pem
// (generado con exportar-certificados.bat). Se lee de nuevo en cada envío: no hace falta reiniciar.
const ARCHIVO_CERTIFICADOS = path.join(__dirname, '..', 'certificados.pem');

function agenteHttps() {
  const ca = [...tls.rootCertificates];
  try {
    if (typeof tls.getCACertificates === 'function') ca.push(...tls.getCACertificates('system'));
  } catch { /* versión de Node sin acceso a los certificados de Windows */ }
  try { ca.push(fs.readFileSync(ARCHIVO_CERTIFICADOS, 'utf8')); } catch { /* sin certificados.pem */ }
  // allowPartialTrustChain: acepta la cadena si llega a un certificado intermedio de certificados.pem.
  return new https.Agent({ ca, allowPartialTrustChain: true, keepAlive: false });
}

function pedirHttps(url, { method = 'GET', headers = {}, body } = {}, saltos = 5) {
  return new Promise((resolver, rechazar) => {
    const datos = body === undefined ? null : Buffer.from(body, 'utf8');
    const req = https.request(url, {
      method,
      headers: datos ? { ...headers, 'Content-Length': datos.length } : headers,
      agent: agenteHttps(),
      timeout: 60_000,
    }, res => {
      const trozos = [];
      res.on('data', t => trozos.push(t));
      res.on('end', () => {
        const destino = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && destino && saltos > 0) {
          const siguiente = new URL(destino, url).href;
          // 307/308 repiten la petición; las demás se siguen con GET (como un navegador).
          const opciones = [307, 308].includes(res.statusCode) ? { method, headers, body } : { method: 'GET' };
          return resolver(pedirHttps(siguiente, opciones, saltos - 1));
        }
        resolver({ status: res.statusCode, texto: Buffer.concat(trozos).toString('utf8') });
      });
      res.on('error', rechazar);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Tiempo de espera agotado'), { code: 'ETIMEDOUT' })));
    req.on('error', rechazar);
    req.end(datos || undefined);
  });
}

// ── Google Apps Script (HTTPS) ──────────────────────────────────────────
// El script recibe el mensaje y lo envía desde la cuenta de Gmail donde está instalado.
async function enviarGoogleScript(c, m) {
  const g = c.google_script;
  let res;
  try {
    res = await pedirHttps(g.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        clave: g.clave,
        para: m.para,
        asunto: m.asunto,
        html: m.html,
        texto: m.texto || '',
        nombre_remitente: c.nombre_remitente || '',
        adjuntos: (m.adjuntos || []).map(a => ({ nombre: a.nombre, tipo: a.tipo, base64: b64(a.contenido), cid: a.cid || '' })),
      }),
    });
  } catch (err) {
    const codigo = err.code || err.message;
    if (/CERT|SELF_SIGNED|ISSUER/i.test(codigo)) {
      throw new Error(`La red revisa las conexiones seguras con un certificado propio y Node.js no lo acepta (${codigo}). `
        + 'Ejecuta exportar-certificados.bat y luego probar-conexion.bat, y envía el resultado.');
    }
    throw new Error(`No se pudo conectar con Google (¿el servidor tiene salida a internet por el puerto 443?): ${codigo}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Google pidió iniciar sesión (error ${res.status}): el script debe estar publicado como "Aplicación web", `
      + 'ejecutar como "Yo" y con acceso "Cualquier usuario", y la URL debe terminar en /exec');
  }
  let datos;
  try { datos = JSON.parse(res.texto); } catch {
    throw new Error(res.status < 400
      ? 'Google respondió algo inesperado: revisa que el script esté publicado como "Aplicación web" con acceso "Cualquier usuario"'
      : `Google respondió con error ${res.status}`);
  }
  if (!datos.ok) throw new Error(`El script de Google no pudo enviar: ${datos.error || 'error desconocido'}`);
}

// ── Microsoft Graph ─────────────────────────────────────────────────────
let token = null;

async function tokenGraph(g) {
  if (token && token.vence > Date.now() + 60_000) return token.valor;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(g.tenant_id)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: g.client_id,
      client_secret: g.client_secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft no autorizó la aplicación: ${datos.error_description || datos.error || res.status}`);
  token = { valor: datos.access_token, vence: Date.now() + (datos.expires_in || 3600) * 1000 };
  return token.valor;
}

async function enviarGraph(c, m) {
  const acceso = await tokenGraph(c.graph);
  const cuerpo = {
    message: {
      subject: m.asunto,
      body: { contentType: 'HTML', content: m.html },
      toRecipients: [{ emailAddress: { address: m.para } }],
      attachments: (m.adjuntos || []).map(a => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.nombre,
        contentType: a.tipo,
        contentBytes: b64(a.contenido),
        ...(a.cid ? { isInline: true, contentId: a.cid } : {}),
      })),
    },
    saveToSentItems: true,
  };
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.remitente)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${acceso}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (res.status !== 202) {
    const datos = await res.json().catch(() => ({}));
    throw new Error(`Microsoft rechazó el envío: ${datos.error?.message || res.status}`);
  }
}

// ── SMTP ────────────────────────────────────────────────────────────────
function construirMime(c, m) {
  const limite = tag => `----=_${tag}_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const mixto = limite('mixto'), relacionado = limite('rel'), alternativo = limite('alt');
  const remitente = c.remitente || c.smtp.usuario;
  const nombre = c.nombre_remitente ? `${encabezado(c.nombre_remitente)} ` : '';
  const dominio = remitente.split('@')[1] || 'localhost';
  const enLinea = (m.adjuntos || []).filter(a => a.cid);
  const adjuntos = (m.adjuntos || []).filter(a => !a.cid);
  const parte = (tipo, contenido, extra = '') =>
    `Content-Type: ${tipo}\r\nContent-Transfer-Encoding: base64\r\n${extra}\r\n${b64Lineas(contenido)}`;

  const lineas = [
    `From: ${nombre}<${remitente}>`,
    `To: <${m.para}>`,
    `Subject: ${encabezado(m.asunto)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${dominio}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixto}"`,
    '',
    `--${mixto}`,
    `Content-Type: multipart/related; boundary="${relacionado}"`,
    '',
    `--${relacionado}`,
    `Content-Type: multipart/alternative; boundary="${alternativo}"`,
    '',
    `--${alternativo}`,
    parte('text/plain; charset=UTF-8', Buffer.from(m.texto || '', 'utf8')),
    `--${alternativo}`,
    parte('text/html; charset=UTF-8', Buffer.from(m.html, 'utf8')),
    `--${alternativo}--`,
    ...enLinea.flatMap(a => [`--${relacionado}`,
      parte(`${a.tipo}; name="${a.nombre}"`, a.contenido, `Content-ID: <${a.cid}>\r\nContent-Disposition: inline; filename="${a.nombre}"\r\n`)]),
    `--${relacionado}--`,
    ...adjuntos.flatMap(a => [`--${mixto}`,
      parte(`${a.tipo}; name="${a.nombre}"`, a.contenido, `Content-Disposition: attachment; filename="${a.nombre}"\r\n`)]),
    `--${mixto}--`,
    '',
  ];
  return lineas.join('\r\n');
}

// Conversación SMTP: lee respuestas (pueden ser de varias líneas) y escribe comandos.
function sesion(socket) {
  let bufer = '';
  let esperando = null;
  const revisar = () => {
    if (!esperando) return;
    const lineas = bufer.split('\r\n');
    for (let i = 0; i < lineas.length - 1; i++) {
      if (/^\d{3} /.test(lineas[i])) {
        const respuesta = lineas.slice(0, i + 1).join('\n');
        bufer = lineas.slice(i + 1).join('\r\n');
        const { resolver } = esperando;
        esperando = null;
        resolver({ codigo: Number(lineas[i].slice(0, 3)), texto: respuesta });
        return;
      }
    }
  };
  const alDatos = d => { bufer += d.toString('utf8'); revisar(); };
  const alError = err => { if (esperando) { esperando.rechazar(err); esperando = null; } };
  socket.on('data', alDatos);
  socket.on('error', alError);
  return {
    leer() {
      return new Promise((resolver, rechazar) => { esperando = { resolver, rechazar }; revisar(); });
    },
    async comando(linea, esperado, ocultar) {
      if (linea !== null) socket.write(`${linea}\r\n`);
      const r = await this.leer();
      if (!esperado.includes(r.codigo)) {
        throw new Error(`El servidor de correo respondió: ${r.texto.replace(/\n/g, ' ')}${ocultar ? '' : ` (a "${linea || 'saludo'}")`}`);
      }
      return r;
    },
    soltar() { socket.off('data', alDatos); socket.off('error', alError); },
  };
}

function conectar(opciones, seguro) {
  return new Promise((resolver, rechazar) => {
    const socket = seguro
      ? tls.connect({ ...opciones, servername: opciones.host }, () => resolver(socket))
      : net.connect(opciones, () => resolver(socket));
    socket.setTimeout(30_000, () => socket.destroy(new Error('Tiempo de espera agotado con el servidor de correo')));
    socket.once('error', rechazar);
  });
}

async function enviarSmtp(c, m) {
  const s = c.smtp;
  const puerto = Number(s.puerto) || 587;
  const implicito = puerto === 465;
  let socket = await conectar({ host: s.servidor, port: puerto }, implicito);
  let conv = sesion(socket);
  const yo = os.hostname() || 'reservas-palcos';
  try {
    await conv.comando(null, [220]);
    const ehlo = await conv.comando(`EHLO ${yo}`, [250]);
    if (!implicito) {
      if (!/STARTTLS/i.test(ehlo.texto)) throw new Error('El servidor de correo no ofrece conexión segura (STARTTLS)');
      await conv.comando('STARTTLS', [220]);
      conv.soltar();
      socket = await new Promise((resolver, rechazar) => {
        const seguro = tls.connect({ socket, servername: s.servidor }, () => resolver(seguro));
        seguro.once('error', rechazar);
      });
      conv = sesion(socket);
      await conv.comando(`EHLO ${yo}`, [250]);
    }
    await conv.comando('AUTH LOGIN', [334]);
    await conv.comando(b64(Buffer.from(s.usuario, 'utf8')), [334], true);
    await conv.comando(b64(Buffer.from(s.clave, 'utf8')), [235], true);
    await conv.comando(`MAIL FROM:<${c.remitente || s.usuario}>`, [250]);
    await conv.comando(`RCPT TO:<${m.para}>`, [250, 251]);
    await conv.comando('DATA', [354]);
    const mime = construirMime(c, m).replace(/^\./gm, '..'); // "dot-stuffing"
    socket.write(mime); // termina en salto de línea
    await conv.comando('.', [250]);
    await conv.comando('QUIT', [221]).catch(() => {});
  } finally {
    socket.end();
  }
}

// ── Cola: los correos se envían de a uno, en segundo plano ──────────────
let cadena = Promise.resolve();
function encolar(tarea) {
  cadena = cadena.then(tarea).catch(err => console.error('[correo]', err.message));
  return cadena;
}

module.exports = { estado, enviar, encolar, agenteHttps, pedirHttps };
