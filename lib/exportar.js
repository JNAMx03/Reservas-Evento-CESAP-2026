'use strict';
// Libro de Excel con toda la información, organizado en hojas:
// Resumen · Reservas · Pagos · Palcos · Asistencia · Ingresos.
(function () {
  const enNode = typeof module !== 'undefined' && module.exports;
  const XLSX = enNode ? require('./xlsx.js') : window.XLSX;
  const PLANO = enNode ? require('../public/plano.js') : window.PLANO;

  const suma = (lista, fn) => lista.reduce((t, x) => t + (fn(x) || 0), 0);
  const fecha = f => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)} ${f.slice(11, 16)}` : '');
  const estadoPago = r => (r.valor > 0 && r.pagado >= r.valor ? 'Pagada' : 'Pago incompleto (registro anterior)');
  const ESTADO_CORREO = { enviado: 'Enviado', pendiente: 'Enviando…', error: 'Error' };
  const estadoCorreo = r => {
    if (!r.correo) return 'Sin correo';
    if (!r.autoriza_datos) return 'No autorizó envío';
    const e = ESTADO_CORREO[r.correo_estado] || 'No enviado';
    return r.correo_estado === 'enviado' ? `${e} ${fecha(r.correo_enviado_en)}` : r.correo_estado === 'error' ? `${e}: ${r.correo_detalle}` : e;
  };
  const estadoPalco = p => (p.bloqueado ? 'Bloqueado' : p.ocupadas === 0 ? 'Vacío' : p.ocupadas >= p.capacidad ? 'Lleno' : 'Con reservas');

  function crear(d) {
    const { reservas: R, pagos: P, palcos: Pa } = d;
    const ahora = new Date();
    const dos = n => String(n).padStart(2, '0');
    const generado = `${dos(ahora.getDate())}/${dos(ahora.getMonth() + 1)}/${ahora.getFullYear()} ${dos(ahora.getHours())}:${dos(ahora.getMinutes())}`;

    // ── Hoja Resumen ──
    const capacidad = suma(Pa, p => p.capacidad);
    const ocupadas = suma(Pa, p => p.ocupadas);
    const recaudado = suma(R, r => r.pagado);
    const incompletas = R.filter(r => !(r.valor > 0 && r.pagado >= r.valor)).length;
    const t = (v, estilo) => ({ v, estilo });
    const enc = v => ({ v, estilo: 'encabezado' });
    const filasResumen = [
      [t(PLANO.TITULO, 'titulo')],
      [`Reporte generado el ${generado}`],
      [],
      [enc('Indicador'), enc('Valor')],
      ['Palcos', Pa.length],
      ['Palcos con reservas', Pa.filter(p => p.reservas > 0).length],
      ['Palcos llenos', Pa.filter(p => p.ocupadas >= p.capacidad).length],
      ['Palcos bloqueados', Pa.filter(p => p.bloqueado).length],
      ['Sillas totales', capacidad],
      ['Sillas ocupadas', ocupadas],
      ['Sillas libres', capacidad - ocupadas],
      ['Ocupación', `${capacidad ? ((ocupadas / capacidad) * 100).toFixed(1) : '0.0'}%`],
      ['Reservas pagadas', R.length - incompletas],
      ['Total recaudado', t(recaudado, 'dinero')],
      ...(incompletas ? [['Pagos incompletos (registros anteriores)', incompletas]] : []),
      ['Personas que han ingresado al evento', `${suma(R, r => Math.min(r.ingresados || 0, r.cantidad))} de ${suma(R, r => r.cantidad)}`],
      [],
      [enc('Zona'), enc('Precio palco'), enc('Palcos'), enc('Sillas ocupadas'), enc('Recaudado')],
    ];
    const porGrupo = (lista, campoPalco, campoReserva) => [...lista.map(g => g.nombre), null].map(nombre => {
      const ps = Pa.filter(p => (p[campoPalco] ?? null) === nombre);
      const rs = R.filter(r => (r[campoReserva] ?? null) === nombre);
      return { nombre: nombre ?? 'Sin asignar', ps, rs, precio: lista.find(g => g.nombre === nombre)?.precio || 0 };
    }).filter(g => g.nombre !== 'Sin asignar' || g.ps.length);
    for (const g of porGrupo(d.categorias, 'zona', 'zona')) {
      filasResumen.push([g.nombre, t(g.precio, 'dinero'), g.ps.length, suma(g.ps, p => p.ocupadas), t(suma(g.rs, r => r.pagado), 'dinero')]);
    }
    filasResumen.push([], [enc('Empresa'), enc('Palcos'), enc('Sillas ocupadas'), enc('Recaudado')]);
    for (const g of porGrupo(d.empresas, 'empresa', 'empresa')) {
      filasResumen.push([g.nombre, g.ps.length, suma(g.ps, p => p.ocupadas), t(suma(g.rs, r => r.pagado), 'dinero')]);
    }
    filasResumen.push([], [enc('Medio de pago'), enc('Pagos'), enc('Valor')]);
    for (const medio of [...new Set([...PLANO.MEDIOS_PAGO, ...P.map(p => p.medio)])]) {
      const ps = P.filter(p => p.medio === medio);
      if (ps.length) filasResumen.push([medio, ps.length, t(suma(ps, p => p.valor), 'dinero')]);
    }

    // ── Hoja Reservas ──
    const hojaReservas = {
      nombre: 'Reservas',
      totales: true,
      columnas: [
        { titulo: 'Código', ancho: 11 }, { titulo: 'Palco', ancho: 8, tipo: 'numero', sumar: false }, { titulo: 'Zona', ancho: 11 },
        { titulo: 'Empresa del palco', ancho: 14 }, { titulo: 'Sillas', ancho: 16 }, { titulo: 'Cant. sillas', ancho: 10, tipo: 'numero' },
        { titulo: 'Nombre', ancho: 30 }, { titulo: 'Documento', ancho: 15 }, { titulo: 'Teléfono', ancho: 15 },
        { titulo: 'Correo', ancho: 28 }, { titulo: 'Afiliación', ancho: 12 },
        { titulo: 'Valor pagado', ancho: 14, tipo: 'dinero' }, { titulo: 'Medio de pago', ancho: 15 }, { titulo: 'Fecha de pago', ancho: 17 },
        { titulo: 'Estado', ancho: 14 }, { titulo: 'Correo enviado', ancho: 24 }, { titulo: 'Notas', ancho: 34, tipo: 'largo' },
        { titulo: 'Registrado por', ancho: 16 }, { titulo: 'Fecha de registro', ancho: 17 }, { titulo: 'Última modificación', ancho: 17 },
      ],
      filas: R.map(r => [r.codigo, r.palco, r.zona || '', r.empresa || '', r.sillas_texto || '', r.cantidad,
        r.nombre, r.documento, r.telefono, r.correo, r.afiliacion,
        r.pagado, r.medio_pago || '', fecha(r.fecha_pago), estadoPago(r), estadoCorreo(r), r.notas,
        r.registrado_por, fecha(r.creado_en), fecha(r.actualizado_en)]),
    };

    // ── Hoja Pagos ──
    const hojaPagos = {
      nombre: 'Pagos',
      totales: true,
      columnas: [
        { titulo: 'Fecha y hora', ancho: 17 }, { titulo: 'Código reserva', ancho: 13 }, { titulo: 'Palco', ancho: 8, tipo: 'numero', sumar: false },
        { titulo: 'Zona', ancho: 11 }, { titulo: 'Responsable', ancho: 30 }, { titulo: 'Afiliación', ancho: 12 },
        { titulo: 'Medio de pago', ancho: 15 }, { titulo: 'Valor', ancho: 14, tipo: 'dinero' }, { titulo: 'Registrado por', ancho: 16 },
      ],
      filas: P.map(p => [fecha(p.fecha), p.codigo, p.palco, p.zona || '', p.nombre, p.afiliacion, p.medio, p.valor, p.registrado_por]),
    };

    // ── Hoja Palcos ──
    const hojaPalcos = {
      nombre: 'Palcos',
      totales: true,
      columnas: [
        { titulo: 'Palco', ancho: 8, tipo: 'numero', sumar: false }, { titulo: 'Zona', ancho: 11 },
        { titulo: 'Precio palco', ancho: 14, tipo: 'dinero', sumar: false }, { titulo: 'Empresa', ancho: 12 },
        { titulo: 'Estado', ancho: 14 }, { titulo: 'Motivo del bloqueo', ancho: 24 },
        { titulo: 'Sillas ocupadas', ancho: 10, tipo: 'numero' }, { titulo: 'Sillas libres', ancho: 10, tipo: 'numero' },
        { titulo: 'Reservas', ancho: 10, tipo: 'numero' }, { titulo: 'Recaudado', ancho: 14, tipo: 'dinero' },
      ],
      filas: Pa.map(p => [p.numero, p.zona || '', p.precio || 0, p.empresa || '', estadoPalco(p), p.motivo_bloqueo,
        p.ocupadas, p.capacidad - p.ocupadas, p.reservas, p.pagado]),
    };

    // ── Hoja Asistencia (una fila por reserva) ──
    const estadoIngreso = r => (!r.ingresados ? 'Sin llegar' : r.ingresados >= r.cantidad ? 'Completa' : 'Parcial');
    const hojaAsistencia = {
      nombre: 'Asistencia',
      totales: true,
      columnas: [
        { titulo: 'Código', ancho: 11 }, { titulo: 'Palco', ancho: 8, tipo: 'numero', sumar: false }, { titulo: 'Zona', ancho: 11 },
        { titulo: 'Empresa del palco', ancho: 14 }, { titulo: 'Nombre', ancho: 30 }, { titulo: 'Documento', ancho: 15 },
        { titulo: 'Afiliación', ancho: 12 }, { titulo: 'Personas', ancho: 10, tipo: 'numero' },
        { titulo: 'Ingresaron', ancho: 11, tipo: 'numero' }, { titulo: 'Faltan', ancho: 9, tipo: 'numero' },
        { titulo: 'Estado', ancho: 12 }, { titulo: 'Primer ingreso', ancho: 17 }, { titulo: 'Último ingreso', ancho: 17 },
      ],
      filas: R.map(r => [r.codigo, r.palco, r.zona || '', r.empresa || '', r.nombre, r.documento, r.afiliacion,
        r.cantidad, r.ingresados || 0, Math.max(0, r.cantidad - (r.ingresados || 0)), estadoIngreso(r),
        fecha(r.primer_ingreso), fecha(r.ultimo_ingreso)]),
    };

    // ── Hoja Ingresos (cada lectura confirmada en la puerta) ──
    const hojaIngresos = {
      nombre: 'Ingresos',
      totales: true,
      columnas: [
        { titulo: 'Fecha y hora', ancho: 17 }, { titulo: 'Código reserva', ancho: 13 }, { titulo: 'Palco', ancho: 8, tipo: 'numero', sumar: false },
        { titulo: 'Nombre', ancho: 30 }, { titulo: 'Personas', ancho: 10, tipo: 'numero' }, { titulo: 'Puerta', ancho: 14 },
        { titulo: 'Usuario', ancho: 12 },
      ],
      filas: (d.ingresos || []).map(i => [fecha(i.fecha), i.codigo, i.palco, i.nombre, i.personas, i.puerta, i.usuario]),
    };

    return XLSX.crear([
      { nombre: 'Resumen', filas: filasResumen, anchos: [38, 16, 12, 16, 16] },
      hojaReservas,
      hojaPagos,
      hojaPalcos,
      hojaAsistencia,
      hojaIngresos,
    ]);
  }

  const EXPORTAR = { crear };
  if (enNode) module.exports = EXPORTAR;
  else window.EXPORTAR = EXPORTAR;
})();
