'use strict';
// Boleta de una reserva: texto del QR, correo bonito (HTML y texto) y PDF.
// d = { codigo, nombre, documento, telefono, correo, afiliacion, palco, sillas: [..], capacidad,
//       valor, pagado, categoria: { nombre, color } | null, empresa: { nombre } | null, creado_en }
(function () {
  const enNode = typeof module !== 'undefined' && module.exports;
  const PLANO = enNode ? require('../public/plano.js') : window.PLANO;
  const QR = enNode ? require('../public/qr.js') : window.QR;
  const PDF = enNode ? require('./pdf.js') : window.PDF;
  const PNG = enNode ? require('./png.js') : window.PNG;

  const moneda = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const pesos = n => moneda.format(n || 0).replace(/ /g, ' ');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fecha = f => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)} ${f.slice(11, 16)}` : '');
  const ahora = () => {
    const d = new Date();
    const dos = n => String(n).padStart(2, '0');
    return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
  };
  const TITULO = 'GRAN FIESTA ANUAL DE AFILIADOS';
  const SUBTITULO = 'CESNE · CESAP';
  const OSCURO = '#1b2330';

  const zona = d => d.categoria?.nombre || 'Sin zona';
  const colorZona = d => d.categoria?.color || '#5b6470';
  const sillasTexto = d => d.sillas.join(', ');

  // ── Texto plano del QR (sin valores de dinero: solo identifica la reserva) ──
  function textoQR(d) {
    const nombre = d.nombre.length > 60 ? `${d.nombre.slice(0, 59)}…` : d.nombre;
    return `${PLANO.TITULO}\nReserva: ${d.codigo}\n${nombre}\nPalco ${d.palco} (${zona(d)}) · Sillas ${sillasTexto(d)}`;
  }

  const qrDe = d => QR.crear(textoQR(d));

  // Toda reserva se paga completa; "incompleto" solo puede pasar en registros antiguos.
  function estadoPago(d) {
    if (d.valor > 0 && d.pagado >= d.valor) return { texto: 'PAGADO', color: '#1a8a5c', ok: true };
    return { texto: `Pago incompleto: faltan ${pesos(Math.max(0, d.valor - d.pagado))}`, color: '#c76a12', ok: false };
  }
  const medioPago = d => d.medio_pago || '—';

  // ── Correo HTML (tablas y estilos en línea para que se vea bien en Gmail y Outlook) ──
  function sillasHtml(d) {
    const propias = new Set(d.sillas);
    const porPos = new Map(PLANO.sillas.map(s => [`${s.x},${s.y}`, s]));
    const maxX = Math.max(...PLANO.sillas.map(s => s.x));
    const maxY = Math.max(...PLANO.sillas.map(s => s.y));
    const color = colorZona(d);
    const td = 'width:42px;height:42px;padding:3px;text-align:center;';
    let filas = `<tr><td colspan="${maxX + 1}" style="text-align:center;font:600 11px Arial,sans-serif;letter-spacing:2px;color:#8a96a8;padding-bottom:6px;">&#9650; TARIMA</td></tr>`;
    for (let y = 0; y <= maxY; y++) {
      filas += '<tr>';
      for (let x = 0; x <= maxX; x++) {
        const enMesa = x >= 1 && x <= maxX - 1 && y <= maxY - 1;
        if (enMesa) {
          if (x === 1 && y === 0) {
            filas += `<td colspan="${maxX - 1}" rowspan="${maxY}" style="background:#eef1f5;border-radius:10px;text-align:center;font:700 14px Arial,sans-serif;color:#5d6979;">Palco ${d.palco}</td>`;
          }
          continue;
        }
        const s = porPos.get(`${x},${y}`);
        if (!s) { filas += `<td style="${td}"></td>`; continue; }
        const mia = propias.has(s.n);
        filas += `<td style="${td}"><div style="width:38px;height:38px;border-radius:9px;margin:0 auto;font:700 15px Arial,sans-serif;line-height:38px;`
          + (mia ? `background:${color};color:#ffffff;` : 'background:#eef1f5;color:#a3adbb;')
          + `">${s.n}</div></td>`;
      }
      filas += '</tr>';
    }
    return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;border-collapse:separate;">${filas}</table>`;
  }

  function fila(etiqueta, valor) {
    return `<tr><td style="padding:7px 0;font:13px Arial,sans-serif;color:#5d6979;width:120px;vertical-align:top;">${etiqueta}</td>`
      + `<td style="padding:7px 0;font:bold 14px Arial,sans-serif;color:${OSCURO};">${valor}</td></tr>`;
  }

  function htmlCorreo(d, { cidQR = 'qr-reserva' } = {}) {
    const color = colorZona(d);
    const estado = estadoPago(d);
    const primerNombre = esc(d.nombre.split(/\s+/)[0]);
    const caja = (titulo, valor, c = OSCURO) => `<td style="padding:6px;" width="33%"><div style="background:#f3f5f8;border-radius:10px;padding:12px 8px;text-align:center;">
      <div style="font:12px Arial,sans-serif;color:#5d6979;">${titulo}</div>
      <div style="font:bold 17px Arial,sans-serif;color:${c};margin-top:4px;">${valor}</div></div></td>`;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tu reserva ${esc(d.codigo)}</title></head>
<body style="margin:0;padding:0;background:#e9edf2;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e9edf2;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:${OSCURO};padding:30px 24px 24px;text-align:center;">
    <div style="font:bold 24px Arial,sans-serif;color:#ffffff;letter-spacing:1px;">${TITULO}</div>
    <div style="font:15px Arial,sans-serif;color:#c9d2de;margin-top:6px;">${SUBTITULO}</div>
  </td></tr>
  <tr><td style="background:${color};height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
  <tr><td style="padding:28px 28px 8px;">
    <div style="font:bold 20px Arial,sans-serif;color:${OSCURO};">¡Hola, ${primerNombre}!</div>
    <div style="font:15px Arial,sans-serif;color:#3d4756;margin-top:8px;line-height:1.5;">Tu reserva quedó registrada. Aquí tienes todos los detalles; guarda este correo y preséntalo el día del evento.</div>
  </td></tr>
  <tr><td style="padding:16px 28px;">
    <div style="border:2px dashed ${color};border-radius:14px;padding:16px;text-align:center;">
      <div style="font:12px Arial,sans-serif;color:#5d6979;letter-spacing:2px;">CÓDIGO DE RESERVA</div>
      <div style="font:bold 34px 'Courier New',monospace;color:${OSCURO};letter-spacing:4px;margin-top:4px;">${esc(d.codigo)}</div>
    </div>
  </td></tr>
  <tr><td style="padding:4px 28px 8px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      ${fila('Nombre', esc(d.nombre))}
      ${d.documento ? fila('Documento', esc(d.documento)) : ''}
      ${d.afiliacion ? fila('Afiliación', esc(d.afiliacion)) : ''}
      ${fila('Palco', `${d.palco}`)}
      ${fila('Zona', `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${color};vertical-align:-1px;margin-right:6px;"></span>${esc(zona(d))}`)}
      ${fila(d.sillas.length === 1 ? 'Silla' : 'Sillas', `${esc(sillasTexto(d))} <span style="font-weight:normal;color:#5d6979;">(${d.sillas.length} ${d.sillas.length === 1 ? 'silla' : 'sillas'})</span>`)}
    </table>
  </td></tr>
  <tr><td style="padding:12px 28px 4px;">
    <div style="font:bold 13px Arial,sans-serif;color:#5d6979;letter-spacing:1px;margin-bottom:10px;">TU UBICACIÓN EN EL PALCO</div>
    ${sillasHtml(d)}
  </td></tr>
  <tr><td style="padding:18px 22px 4px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      ${caja('Valor pagado', pesos(d.pagado))}${caja('Medio de pago', esc(medioPago(d)))}${caja('Estado', estado.ok ? 'Pagado ✓' : 'Incompleto', estado.color)}
    </tr></table>
    ${estado.ok ? '' : `<div style="text-align:center;font:bold 13px Arial,sans-serif;color:${estado.color};margin-top:6px;">${estado.texto}</div>`}
  </td></tr>
  <tr><td style="padding:22px 28px 8px;text-align:center;">
    <img src="cid:${cidQR}" width="180" height="180" alt="Código QR de la reserva ${esc(d.codigo)}" style="display:block;margin:0 auto;border:0;">
    <div style="font:13px Arial,sans-serif;color:#5d6979;margin-top:8px;">Presenta este código QR en la entrada.</div>
  </td></tr>
  <tr><td style="padding:14px 28px 26px;">
    <div style="background:#f3f5f8;border-radius:10px;padding:12px 14px;font:13px Arial,sans-serif;color:#3d4756;line-height:1.5;">
      📎 Adjuntamos tu <b>boleta en PDF</b> con esta misma información, para que la guardes o la imprimas.
    </div>
  </td></tr>
  <tr><td style="background:#f3f5f8;padding:16px 28px;font:11px Arial,sans-serif;color:#8a96a8;line-height:1.5;text-align:center;">
    Mensaje automático del sistema de reservas de la ${TITULO} ${SUBTITULO}.<br>
    Recibes este correo porque autorizaste el envío de la información de tu reserva.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  }

  function textoCorreo(d) {
    const estado = estadoPago(d);
    return [
      `${TITULO} - ${SUBTITULO}`,
      '',
      `Hola, ${d.nombre}. Tu reserva quedó registrada.`,
      '',
      `CÓDIGO DE RESERVA: ${d.codigo}`,
      `Palco: ${d.palco} (${zona(d)})`,
      `${d.sillas.length === 1 ? 'Silla' : 'Sillas'}: ${sillasTexto(d)}`,
      d.afiliacion ? `Afiliación: ${d.afiliacion}` : '',
      '',
      `Valor pagado: ${pesos(d.pagado)} (${medioPago(d)})  ·  ${estado.ok ? 'Pagado' : estado.texto}`,
      '',
      'Adjuntamos tu boleta en PDF. Presenta el código QR en la entrada.',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  }

  // ── PDF (tamaño carta) ──
  function pdf(d) {
    const doc = PDF.crear({ titulo: `Boleta ${d.codigo} - ${TITULO}` });
    const W = doc.ancho;
    const color = colorZona(d);
    const gris = '#5d6979';
    const estado = estadoPago(d);

    // Encabezado
    doc.rect(0, 0, W, 120, { relleno: OSCURO });
    doc.texto(W / 2, 54, TITULO, { tam: 24, negrita: true, color: '#ffffff', alinear: 'centro' });
    doc.texto(W / 2, 78, SUBTITULO, { tam: 13, color: '#c9d2de', alinear: 'centro' });
    doc.texto(W / 2, 102, 'BOLETA DE RESERVA', { tam: 10, negrita: true, color: '#9fb0c6', alinear: 'centro' });
    doc.rect(0, 120, W, 8, { relleno: color });

    // Código
    doc.rect(40, 148, W - 80, 82, { relleno: '#f3f5f8', borde: color, grosor: 1.5 });
    doc.texto(W / 2, 170, 'CÓDIGO DE RESERVA', { tam: 10, color: gris, alinear: 'centro' });
    doc.texto(W / 2, 214, d.codigo, { tam: 36, negrita: true, color: OSCURO, alinear: 'centro' });

    // Datos (columna izquierda)
    const datos = [
      ['NOMBRE', d.nombre],
      ['DOCUMENTO', d.documento || '—'],
      ['AFILIACIÓN', d.afiliacion || '—'],
      ['PALCO', String(d.palco)],
      ['ZONA', zona(d)],
      [d.sillas.length === 1 ? 'SILLA' : 'SILLAS', `${sillasTexto(d)}  (${d.sillas.length})`],
    ];
    let y = 268;
    for (const [etiqueta, valor] of datos) {
      doc.texto(40, y, etiqueta, { tam: 8.5, negrita: true, color: gris });
      if (etiqueta === 'ZONA') {
        doc.rect(40, y + 7, 11, 11, { relleno: color });
        doc.texto(57, y + 17, valor, { tam: 13, negrita: true, color: OSCURO, anchoMax: 270 });
      } else {
        doc.texto(40, y + 17, valor, { tam: 13, negrita: true, color: OSCURO, anchoMax: 290 });
      }
      y += 36;
    }

    // QR (columna derecha)
    const qr = qrDe(d);
    doc.rect(378, 252, 194, 194, { relleno: '#ffffff', borde: '#dce1e8' });
    doc.qr(qr, 396, 270, 158); // con margen blanco suficiente para que se lea bien impreso
    doc.texto(475, 462, 'Presenta este código en la entrada', { tam: 9, color: gris, alinear: 'centro' });

    // Ubicación en el palco (abajo a la izquierda)
    doc.texto(40, 500, 'UBICACIÓN EN EL PALCO', { tam: 9, negrita: true, color: gris });
    const C = 30, x0 = 70, y0 = 534;
    const maxX = Math.max(...PLANO.sillas.map(s => s.x));
    const maxY = Math.max(...PLANO.sillas.map(s => s.y));
    const centro = x0 + ((maxX + 1) * C) / 2;
    doc.triangulo(centro - 30, 524, centro - 24, 515, centro - 18, 524, '#8a96a8');
    doc.texto(centro + 4, 524, 'TARIMA', { tam: 8, negrita: true, color: '#8a96a8', alinear: 'centro' });
    doc.rect(x0 + C + 3, y0 + 3, (maxX - 1) * C - 6, maxY * C - 6, { relleno: '#eef1f5' });
    doc.texto(centro, y0 + (maxY * C) / 2 + 4, `Palco ${d.palco}`, { tam: 10, negrita: true, color: gris, alinear: 'centro' });
    const propias = new Set(d.sillas);
    for (const s of PLANO.sillas) {
      const sx = x0 + s.x * C + 3, sy = y0 + s.y * C + 3;
      const mia = propias.has(s.n);
      doc.rect(sx, sy, C - 6, C - 6, { relleno: mia ? color : '#eef1f5' });
      doc.texto(sx + (C - 6) / 2, sy + (C - 6) / 2 + 4, String(s.n), { tam: 10, negrita: true, color: mia ? '#ffffff' : '#a3adbb', alinear: 'centro' });
    }

    // Valores (abajo a la derecha)
    const valores = [
      ['Valor pagado', pesos(d.pagado), OSCURO],
      ['Medio de pago', medioPago(d), OSCURO],
      ['Fecha de pago', fecha(d.fecha_pago) || '—', OSCURO],
    ];
    valores.forEach(([t, v, c], i) => {
      const vy = 494 + i * 44;
      doc.rect(330, vy, 242, 38, { relleno: '#f3f5f8' });
      doc.texto(344, vy + 24, t, { tam: 11, color: gris });
      doc.texto(558, vy + 25, v, { tam: 15, negrita: true, color: c, alinear: 'der' });
    });
    doc.rect(330, 628, 242, 30, { relleno: estado.color });
    doc.texto(451, 648, estado.texto, { tam: estado.ok ? 14 : 10, negrita: true, color: '#ffffff', alinear: 'centro' });

    // Pie
    doc.rect(40, 690, W - 80, 1, { relleno: '#dce1e8' });
    doc.texto(W / 2, 714, 'Presenta este documento o el código QR en la entrada del evento.', { tam: 10, color: OSCURO, alinear: 'centro' });
    doc.texto(W / 2, 732, `Reserva registrada el ${fecha(d.creado_en)} · Documento generado el ${ahora()}`, { tam: 8, color: '#8a96a8', alinear: 'centro' });
    return doc.bytes();
  }

  const pngQR = d => PNG.pngQR(qrDe(d), 8, 4);

  const BOLETA = { textoQR, htmlCorreo, textoCorreo, pdf, pngQR, pesos };
  if (enNode) module.exports = BOLETA;
  else window.BOLETA = BOLETA;
})();
