'use strict';
// Prueba de conexión segura con Google usando el mismo Node.js del sistema.
// Muestra la versión de Node, los certificados de certificados.pem y por qué se acepta
// o se rechaza la conexión. Se ejecuta con probar-conexion.bat.
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');
const correo = require('./lib/correo');

const SITIO = 'script.google.com';
const ARCHIVO = path.join(__dirname, 'certificados.pem');
const linea = t => console.log(t);

linea(`Node.js ${process.version}  ·  opciones: ${process.execArgv.join(' ') || '(ninguna)'}`);
linea(`NODE_EXTRA_CA_CERTS: ${process.env.NODE_EXTRA_CA_CERTS || '(no definido)'}`);
linea(`Lee certificados de Windows: ${typeof tls.getCACertificates === 'function' ? 'sí' : 'no (versión antigua de Node)'}`);
linea('');

if (fs.existsSync(ARCHIVO)) {
  const bloques = fs.readFileSync(ARCHIVO, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  linea(`certificados.pem: ${bloques.length} certificado(s)`);
  for (const b of bloques) {
    try {
      const c = new X509Certificate(b);
      const corto = s => s.split('\n').find(l => l.startsWith('CN=')) || s.split('\n')[0];
      linea(`  - ${corto(c.subject)}  (emitido por ${corto(c.issuer)})  CA:${c.ca ? 'sí' : 'NO'}  vence ${c.validTo}`
        + (c.checkIssued(c) ? '  [raíz]' : ''));
    } catch (err) {
      linea(`  - no se pudo leer un certificado: ${err.message}`);
    }
  }
} else {
  linea('certificados.pem: NO existe (ejecuta exportar-certificados.bat)');
}
linea('');

function probar(nombre, opciones) {
  return new Promise(resolver => {
    let listo = false;
    const s = tls.connect({ host: SITIO, port: 443, servername: SITIO, rejectUnauthorized: false, ...opciones }, () => {
      listo = true;
      linea(`${nombre}: ${s.authorized ? 'ACEPTADA ✓' : `RECHAZADA ✗ (${s.authorizationError})`}`);
      let c = s.getPeerCertificate(true);
      const vistos = new Set();
      while (c && c.subject && !vistos.has(c.fingerprint256)) {
        vistos.add(c.fingerprint256);
        linea(`     cadena enviada: ${c.subject.CN || JSON.stringify(c.subject)}  ←  ${c.issuer.CN || JSON.stringify(c.issuer)}`);
        c = c.issuerCertificate;
      }
      s.end();
      resolver();
    });
    s.on('error', err => {
      if (listo) return; // errores al cerrar la conexión no importan
      linea(`${nombre}: ERROR ${err.code || err.message}`);
      resolver();
    });
  });
}

(async () => {
  await probar('Conexión normal de Node', {});
  const agente = correo.agenteHttps();
  await probar('Conexión del sistema (con certificados.pem)', agente.options);
  linea('');
  try {
    const r = await correo.pedirHttps('https://' + SITIO + '/');
    linea(`Petición HTTPS completa del sistema: OK (respuesta ${r.status})`);
  } catch (err) {
    linea(`Petición HTTPS completa del sistema: FALLÓ (${err.code || err.message})`);
  }
})();
