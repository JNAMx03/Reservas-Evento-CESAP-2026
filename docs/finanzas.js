'use strict';
// Pestaña Finanzas: lo vendido, lo recaudado, lo que falta y por dónde entró el dinero.
// Usa las funciones y el estado de app.js (api, pesos, esc, estado, categoria, empresa…).
(function () {
  let datos = null;

  async function cargar() {
    if (estado.vista !== 'finanzas') return;
    try {
      datos = await api('GET', '/api/finanzas');
      pintar();
    } catch (err) {
      aviso(err.message, 'error');
    }
  }

  const suma = (lista, fn) => lista.reduce((t, x) => t + fn(x), 0);
  const fechaHora = f => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)} ${f.slice(11, 16)}`;
  const dia = f => new Date(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)))
    .toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const muestra = color => `<i class="muestra" style="background:${color}"></i>`;

  // columnas: [{ t: 'Título', n: true si es numérica }]
  function tabla(columnas, filas, pie, vacio = 'Sin datos todavía.') {
    const th = columnas.map(c => `<th class="${c.n ? 'num' : ''}">${c.t}</th>`).join('');
    const celdas = (fila, etiqueta) => fila.map((v, i) => `<${etiqueta} class="${columnas[i].n ? 'num' : ''}">${v}</${etiqueta}>`).join('');
    const cuerpo = filas.length
      ? filas.map(f => `<tr${f.attrs || ''}>${celdas(f.celdas || f, 'td')}</tr>`).join('')
      : `<tr><td colspan="${columnas.length}" class="suave">${vacio}</td></tr>`;
    return `<table class="tabla"><thead><tr>${th}</tr></thead><tbody>${cuerpo}</tbody>
      ${pie && filas.length ? `<tfoot><tr>${celdas(pie, 'td')}</tr></tfoot>` : ''}</table>`;
  }

  // Agrupa reservas por categoría o empresa del palco.
  function porGrupo(reservas, lista, campo, sinNombre, titulo) {
    const grupos = [...lista.map(g => ({ ...g })), { id: null, nombre: sinNombre, color: NEUTRO }];
    const filas = grupos.map(g => {
      const rs = reservas.filter(r => (r[campo] ?? null) === g.id);
      return { g, rs, palcos: new Set(rs.map(r => r.palco)).size, personas: suma(rs, r => r.personas), recaudado: suma(rs, r => r.pagado) };
    }).filter(f => f.g.id !== null || f.rs.length); // "sin asignar" solo si tiene algo
    const cols = [{ t: titulo }, { t: 'Palcos', n: 1 }, { t: 'Personas', n: 1 }, { t: 'Recaudado', n: 1 }];
    const R = reservas;
    return tabla(cols,
      filas.map(f => [`${muestra(f.g.color)}${esc(f.g.nombre)}`, f.palcos, f.personas, pesos(f.recaudado)]),
      ['<strong>Total</strong>', new Set(R.map(r => r.palco)).size, suma(R, r => r.personas), pesos(suma(R, r => r.pagado))]
        .map(v => `<strong>${v}</strong>`));
  }

  function pintar() {
    const R = datos.reservas;
    const P = datos.pagos;
    const recaudado = suma(R, r => r.pagado);
    const personas = suma(R, r => r.personas);
    const palcos = [...estado.palcos.values()];
    const sillasTotales = suma(palcos, p => p.capacidad);
    const pct = sillasTotales ? (personas / sillasTotales) * 100 : 0;
    const incompletas = R.filter(r => !(r.valor > 0 && r.pagado >= r.valor));

    const tarjetas = [
      ['Total recaudado', pesos(recaudado)],
      ['Reservas pagadas', R.length - incompletas.length],
      ['Sillas vendidas', `${personas.toLocaleString('es-CO')} / ${sillasTotales.toLocaleString('es-CO')}`],
      ['Palcos con reservas', new Set(R.map(r => r.palco)).size],
      ['Promedio por silla', pesos(personas ? Math.round(recaudado / personas) : 0)],
    ];
    if (incompletas.length) tarjetas.push(['Pagos incompletos (anteriores)', incompletas.length]);
    $('#fin-tarjetas').innerHTML = tarjetas.map(([t, v]) => `<div class="dato"><span>${t}</span><strong>${v}</strong></div>`).join('');

    $('#fin-pct').textContent = `${pct.toFixed(1)}%`;
    $('#fin-barra').style.width = `${Math.min(100, pct)}%`;

    $('#fin-zonas').innerHTML = porGrupo(R, estado.categorias, 'categoria_id', 'Sin categoría', 'Zona');
    $('#fin-empresas').innerHTML = porGrupo(R, estado.empresas, 'empresa_id', 'Sin empresa', 'Empresa');

    // Personas por afiliación
    const totalPersonas = suma(R, r => r.personas);
    const afiliaciones = [...estado.empresas.map(e => e.nombre), PLANO.AFILIACION_EXTRA];
    for (const r of R) if (r.afiliacion && !afiliaciones.includes(r.afiliacion)) afiliaciones.push(r.afiliacion);
    const filasAfil = afiliaciones.map(a => {
      const personas = suma(R.filter(r => r.afiliacion === a), r => r.personas);
      return [esc(a), personas, `${totalPersonas ? ((personas / totalPersonas) * 100).toFixed(1) : '0.0'}%`];
    });
    const sinAfil = suma(R.filter(r => !r.afiliacion), r => r.personas);
    if (sinAfil) filasAfil.push(['<span class="suave">Sin afiliación</span>', sinAfil, `${((sinAfil / totalPersonas) * 100).toFixed(1)}%`]);
    $('#fin-afiliacion').innerHTML = tabla([{ t: 'Afiliación' }, { t: 'Personas', n: 1 }, { t: '% del total', n: 1 }],
      filasAfil, ['Total', totalPersonas, totalPersonas ? '100.0%' : '0.0%'].map(v => `<strong>${v}</strong>`));

    // Pagos por medio
    const medios = [...new Set([...PLANO.MEDIOS_PAGO, ...P.map(p => p.medio)])]
      .map(m => ({ m, ps: P.filter(p => p.medio === m) }))
      .filter(x => x.ps.length);
    $('#fin-medios').innerHTML = tabla([{ t: 'Medio' }, { t: 'Pagos', n: 1 }, { t: 'Valor', n: 1 }],
      medios.map(x => [esc(x.m), x.ps.length, pesos(suma(x.ps, p => p.valor))]),
      ['Total', P.length, pesos(suma(P, p => p.valor))].map(v => `<strong>${v}</strong>`), 'Sin pagos todavía.');

    // Recaudado por día (más reciente primero)
    const dias = [...new Set(P.map(p => p.fecha.slice(0, 10)))].sort().reverse();
    $('#fin-dias').innerHTML = tabla([{ t: 'Día' }, { t: 'Pagos', n: 1 }, { t: 'Valor', n: 1 }],
      dias.map(d => {
        const ps = P.filter(p => p.fecha.startsWith(d));
        return [dia(d), ps.length, pesos(suma(ps, p => p.valor))];
      }), null, 'Sin pagos todavía.');

    // Solo aparece si quedan reservas de antes de exigir el pago completo.
    $('#fin-pendientes-tarjeta').hidden = incompletas.length === 0;
    $('#fin-pendientes').innerHTML = tabla(
      [{ t: 'Palco' }, { t: 'Código' }, { t: 'Responsable' }, { t: 'Teléfono' }, { t: 'Valor', n: 1 }, { t: 'Pagado', n: 1 }],
      incompletas.map(r => ({
        attrs: ` data-palco="${r.palco}" class="clic"`,
        celdas: [`<strong>${r.palco}</strong>`, esc(r.codigo), esc(r.nombre), esc(r.telefono),
          r.valor ? pesos(r.valor) : '<span class="suave">Sin valor</span>', pesos(r.pagado)],
      })),
      null, '');

    // Detalle de pagos
    $('#fin-pagos').innerHTML = tabla(
      [{ t: 'Fecha y hora' }, { t: 'Palco' }, { t: 'Código' }, { t: 'Responsable' }, { t: 'Medio' }, { t: 'Registrado por' }, { t: 'Valor', n: 1 }],
      P.map(p => ({
        attrs: ` data-palco="${p.palco}" class="clic"`,
        celdas: [fechaHora(p.fecha), `<strong>${p.palco}</strong>`, esc(p.codigo), esc(p.nombre), esc(p.medio), esc(p.registrado_por), pesos(p.valor)],
      })),
      null, 'Sin pagos todavía.');
  }

  // Tocar una fila abre ese palco en Registro.
  $('#vista-finanzas').addEventListener('click', e => {
    const fila = e.target.closest('tr[data-palco]');
    if (!fila) return;
    location.hash = '#registro';
    abrirPalco(Number(fila.dataset.palco));
  });

  alMostrarVista.finanzas = cargar;
  alActualizar.push(cargar);
})();
