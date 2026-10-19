/**
 * Envío de boletas desde una cuenta de Gmail (Google Apps Script).
 *
 * Cómo instalarlo (una sola vez, con la cuenta de Gmail que enviará los correos):
 *  1. Entra a https://script.google.com  →  "Nuevo proyecto".
 *  2. Borra lo que aparece y pega TODO este archivo. Cambia CLAVE por una frase larga
 *     inventada (la misma irá en config.json del servidor). Guarda (icono del disquete).
 *  3. Arriba elige la función "probarPermisos" y presiona "Ejecutar". Google pedirá permisos:
 *     "Revisar permisos" → elige la cuenta → "Configuración avanzada" → "Ir a ... (no seguro)"
 *     → "Permitir". (Es seguro: el script es tuyo y solo envía correos desde tu cuenta.)
 *  4. "Implementar" → "Nueva implementación" → tipo "Aplicación web":
 *       - Ejecutar como: Yo
 *       - Quién tiene acceso: Cualquier usuario
 *     → "Implementar" y copia la "URL de la aplicación web" (termina en /exec).
 *  5. Esa URL y la CLAVE van en config.json del servidor (sección "google_script").
 *
 * Si después cambias este código, usa "Implementar" → "Gestionar implementaciones"
 * → editar → "Versión: Nueva versión", para que la URL siga siendo la misma.
 */

const CLAVE = 'CAMBIA-ESTA-CLAVE-POR-UNA-FRASE-LARGA';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.clave !== CLAVE) return responder({ ok: false, error: 'Clave incorrecta' });
    if (!d.para) return responder({ ok: false, error: 'Falta el destinatario' });

    const adjuntos = [];
    const imagenes = {};
    (d.adjuntos || []).forEach(function (a) {
      const blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.tipo, a.nombre);
      if (a.cid) imagenes[a.cid] = blob;
      else adjuntos.push(blob);
    });

    GmailApp.sendEmail(d.para, d.asunto, d.texto || '', {
      htmlBody: d.html,
      name: d.nombre_remitente || undefined,
      attachments: adjuntos,
      inlineImages: imagenes,
    });
    return responder({ ok: true, restantes_hoy: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return responder({ ok: false, error: String((err && err.message) || err) });
  }
}

// Permite abrir la URL en el navegador para comprobar que está publicada.
function doGet() {
  return responder({ ok: true, mensaje: 'Servicio de boletas activo', restantes_hoy: MailApp.getRemainingDailyQuota() });
}

function responder(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

// Ejecutar una vez a mano para conceder los permisos de envío.
function probarPermisos() {
  Logger.log('Correos que se pueden enviar hoy: ' + MailApp.getRemainingDailyQuota());
  GmailApp.getAliases();
}
