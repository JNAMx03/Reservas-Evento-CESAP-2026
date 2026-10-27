'use strict';
// Pestaña Ingreso: lectura del QR (pistola o código escrito), registro de las personas que
// entran y gráfica de asistencia en vivo. Usa las funciones y el estado de app.js.
// Solo el usuario INGRESO registra; CESAP y CESNE ven la gráfica, el contador y los últimos ingresos.
(function () {
  const puedeRegistrar = () => estado.rol === 'ingreso';
  const svg = $('#plano-ing');
  const nodosIng = new Map();
  construirPlano(svg, nodosIng, { ancho: 0, alto: 0 }, 'tv');

  const COLOR = { sin: '#e4e8ed', nadie: '#8d96a3', parcial: '#ffc94d', completo: '#1fa36a', bloqueado: '#5b6470' };
  const suma = (lista, fn) => lista.reduce((t, x) => t + fn(x), 0);
  const num = n => n.toLocaleString('es-CO');
  const aFecha = f => new Date(f.replace(' ', 'T'));
  const hora = f => aFecha(f).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  const personasTxt = n => plural(n, 'persona', 'personas');

  let datos = { reservas: [], ingresos: [] };
  let tarjeta = 'espera';   // espera | listo | completa | invalido | registrado
  let actual = null;        // reserva que muestra la tarjeta
  let cantidad = 0;         // personas que se van a registrar
  let ocupado = false;
  let propio = { codigo: '', hasta: 0 }; // para no "avisarme" de mi propio registro

  // ── Puerta de este equipo ─────────────────────────────────────────────
  const campoPuerta = $('#ing-puerta');
  campoPuerta.value = leerLocal('puerta');
  campoPuerta.addEventListener('input', () => guardarLocal('puerta', campoPuerta.value.trim()));
  const puerta = () => campoPuerta.value.trim();

  // ── Sonidos (ayudan en la puerta: no hay que mirar la pantalla) ───────
  let audio;
  function sonar(tipo) {
    try {
      audio ||= new AudioContext();
      const notas = tipo === 'ok' ? [[880, 0, 0.12]] : tipo === 'listo' ? [[660, 0, 0.09], [990, 0.11, 0.12]] : [[220, 0, 0.18], [180, 0.24, 0.28]];
      for (const [f, ini, dur] of notas) {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.frequency.value = f;
        o.type = tipo === 'error' ? 'square' : 'sine';
        g.gain.value = 0.12;
        o.connect(g).connect(audio.destination);
        o.start(audio.currentTime + ini);
        o.stop(audio.currentTime + ini + dur);
      }
    } catch { /* sin sonido */ }
  }

  // ── Datos de la gráfica ───────────────────────────────────────────────
  async function cargar(cambiados) {
    if (estado.vista !== 'ingreso') return;
    try {
      datos = await api('GET', '/api/ingreso/estado');
      pintar(cambiados);
    } catch (err) {
      console.error(err);
    }
  }

  function porPalco() {
    const mapa = new Map();
    for (const r of datos.reservas) {
      const p = mapa.get(r.palco) || { personas: 0, ingresados: 0 };
      p.personas += r.personas;
      p.ingresados += Math.min(r.ingresados, r.personas);
      mapa.set(r.palco, p);
    }
    return mapa;
  }

  function barras(lista, campo, palcos) {
    return lista.map(g => {
      let personas = 0, ingresados = 0;
      for (const [n, a] of palcos) {
        if (estado.palcos.get(n)?.[campo] !== g.id) continue;
        personas += a.personas;
        ingresados += a.ingresados;
      }
      if (!personas) return '';
      const pct = (ingresados / personas) * 100;
      return `<div class="tv-barra">
          <div class="tv-barra-cab"><span><i class="muestra" style="background:${g.color}"></i>${esc(g.nombre)}</span>
          <strong>${num(ingresados)} / ${num(personas)}</strong></div>
          <div class="barra-avance"><i style="width:${pct}%; background:${g.color}"></i></div>
        </div>`;
    }).join('') || '<span class="suave pequeno">Sin reservas todavía</span>';
  }

  // Ingresos agrupados cada 15 minutos (las últimas 6 horas con movimiento).
  function serie() {
    if (!datos.ingresos.length) return '<span class="suave pequeno">Todavía no ha ingresado nadie.</span>';
    const PASO = 15 * 60_000;
    const cubeta = f => Math.floor(aFecha(f).getTime() / PASO) * PASO;
    const conteo = new Map();
    for (const i of datos.ingresos) conteo.set(cubeta(i.fecha), (conteo.get(cubeta(i.fecha)) || 0) + i.personas);
    const ultima = Math.max(...conteo.keys());
    // Mínimo 2 horas a la vista (8 barras) y máximo 6 horas (24 barras).
    const primera = Math.max(Math.min(Math.min(...conteo.keys()), ultima - 7 * PASO), ultima - 23 * PASO);
    const cubetas = [];
    for (let t = primera; t <= ultima; t += PASO) cubetas.push([t, conteo.get(t) || 0]);
    const max = Math.max(...cubetas.map(c => c[1]));
    const A = 320, ALTO = 120, BASE = 100;
    const ancho = A / cubetas.length;
    const cada = Math.ceil(cubetas.length / 6);
    const barrasSvg = cubetas.map(([t, n], i) => {
      const h = max ? (n / max) * (BASE - 16) : 0;
      const x = i * ancho;
      const etiqueta = i % cada === 0
        ? `<text x="${x + ancho / 2}" y="${ALTO - 4}" class="serie-eje">${new Date(t).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</text>` : '';
      return `<rect x="${x + 1.5}" y="${BASE - h}" width="${Math.max(1, ancho - 3)}" height="${h}" rx="2" class="serie-barra"><title>${new Date(t).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}: ${personasTxt(n)}</title></rect>
        ${n ? `<text x="${x + ancho / 2}" y="${BASE - h - 3}" class="serie-valor">${n}</text>` : ''}${etiqueta}`;
    }).join('');
    return `<svg viewBox="0 0 ${A} ${ALTO}" class="serie-svg" role="img" aria-label="Ingresos cada 15 minutos">
      <line x1="0" x2="${A}" y1="${BASE}" y2="${BASE}" class="serie-linea"/>${barrasSvg}</svg>`;
  }

  function pintar(cambiados) {
    const palcos = porPalco();
    const R = datos.reservas;
    const esperadas = suma(R, r => r.personas);
    const ingresados = suma(R, r => Math.min(r.ingresados, r.personas));
    const completas = R.filter(r => r.ingresados >= r.personas).length;
    const parciales = R.filter(r => r.ingresados > 0 && r.ingresados < r.personas).length;
    const pct = esperadas ? (ingresados / esperadas) * 100 : 0;

    $('#ing-personas').textContent = num(ingresados);
    $('#ing-esperadas').textContent = num(esperadas);
    $('#ing-pct').textContent = `${pct.toFixed(1)}%`;
    $('#ing-barra').style.width = `${Math.min(100, pct)}%`;
    const tarjetas = [
      ['Faltan por ingresar', num(esperadas - ingresados)],
      ['Reservas completas', `${num(completas)} / ${num(R.length)}`],
      ['Reservas parciales', num(parciales)],
      ['Reservas sin llegar', num(R.length - completas - parciales)],
      ['Palcos completos', num([...palcos.values()].filter(p => p.ingresados >= p.personas).length)],
    ];
    $('#ing-datos').innerHTML = tarjetas.map(([t, v]) => `<div class="dato"><span>${t}</span><strong>${v}</strong></div>`).join('');

    for (const [n, nodo] of nodosIng) {
      const a = palcos.get(n);
      const bloqueado = !!estado.palcos.get(n)?.bloqueado;
      let color = COLOR.sin, sub = '';
      if (a) {
        color = a.ingresados === 0 ? COLOR.nadie : a.ingresados >= a.personas ? COLOR.completo : COLOR.parcial;
        sub = `${a.ingresados}/${a.personas}`;
      } else if (bloqueado) {
        color = COLOR.bloqueado;
      }
      const t = a || bloqueado ? tinta(color) : '#8a929c';
      nodo.fondo.setAttribute('fill', color);
      nodo.num.setAttribute('fill', t);
      nodo.sub.setAttribute('fill', t);
      nodo.sub.textContent = sub;
      nodo.g.classList.toggle('sin-reservas', !a);
    }
    for (const n of cambiados || []) {
      const g = nodosIng.get(n)?.g;
      if (!g) continue;
      g.classList.remove('destello');
      void g.getBoundingClientRect();
      g.classList.add('destello');
    }

    $('#ing-zonas').innerHTML = barras(estado.categorias, 'categoria_id', palcos);
    $('#ing-empresas').innerHTML = barras(estado.empresas, 'empresa_id', palcos);
    $('#ing-serie').innerHTML = serie();

    $('#ing-ultimos').innerHTML = datos.ingresos.slice(0, 12).map(i => `
      <li data-codigo="${esc(i.codigo)}" class="${puedeRegistrar() ? 'clic' : ''}">
        <span class="ing-u-hora">${hora(i.fecha)}</span>
        <span class="ing-u-nombre"><strong>${esc(i.nombre)}</strong> <span class="pill codigo">${esc(i.codigo)}</span></span>
        <span class="ing-u-detalle">Palco ${i.palco} · ${personasTxt(i.personas)}${i.puerta ? ` · ${esc(i.puerta)}` : ''}</span>
      </li>`).join('') || '<li class="suave">Todavía no ha ingresado nadie.</li>';
  }

  // ── Tarjeta del resultado ─────────────────────────────────────────────
  function datosReserva(r) {
    return `<div class="ing-nombre">${esc(r.nombre)}</div>
      <div class="etiquetas">
        <span class="pill codigo">${esc(r.codigo)}</span>
        <span class="chip"><i style="background:${r.zona_color || NEUTRO}"></i>Palco ${r.palco}${r.zona ? ` · ${esc(r.zona)}` : ''}</span>
        ${r.empresa ? `<span class="chip"><i style="background:${r.empresa_color || NEUTRO}"></i>${esc(r.empresa)}</span>` : ''}
      </div>
      <div class="ing-ficha">
        <span>Sillas <strong>${esc(r.sillas_texto || '')}</strong></span>
        ${r.documento ? `<span>Doc. <strong>${esc(r.documento)}</strong></span>` : ''}
        ${r.afiliacion ? `<span>Afiliación <strong>${esc(r.afiliacion)}</strong></span>` : ''}
      </div>`;
  }

  const listaIngresos = r => (r.ingresos.length
    ? `<ul class="ing-previos">${r.ingresos.map(i => `<li>${hora(i.fecha)} · ingresaron ${i.personas}${i.puerta ? ` · ${esc(i.puerta)}` : ''}</li>`).join('')}</ul>`
    : '');

  function pintarTarjeta(mensaje = '') {
    const caja = $('#ing-tarjeta');
    caja.className = `ing-tarjeta solo-ingreso ${tarjeta}`;
    const r = actual;
    if (tarjeta === 'espera') {
      caja.innerHTML = '<div class="ing-espera">Esperando lectura del código QR…</div>';
    } else if (tarjeta === 'invalido') {
      caja.innerHTML = `<div class="ing-estado"><span class="ing-icono x" aria-hidden="true">✕</span>
        <div><strong>Código no válido</strong><p>${esc(mensaje)}</p></div></div>`;
    } else if (tarjeta === 'completa') {
      caja.innerHTML = `<div class="ing-estado"><span class="ing-icono x" aria-hidden="true">✕</span>
          <div><strong>Esta reserva ya ingresó completa</strong><p>Ingresaron ${r.ingresados} de ${r.personas}. Puede ser un QR repetido.</p></div></div>
        ${datosReserva(r)}${listaIngresos(r)}
        <div class="acciones"><button type="button" class="boton peligro" data-deshacer>Deshacer último ingreso</button></div>`;
    } else if (tarjeta === 'listo') {
      const parcial = r.ingresados > 0;
      caja.innerHTML = `<div class="ing-estado"><span class="ing-icono ${parcial ? 'parcial' : 'ok'}" aria-hidden="true">${parcial ? '!' : '✓'}</span>
          <div><strong>${parcial ? `Ya ingresaron ${r.ingresados} de ${r.personas}` : 'Puede ingresar'}</strong>
          <p>${parcial ? `Faltan ${personasTxt(r.faltan)}.` : `Reserva de ${personasTxt(r.personas)}.`}</p></div></div>
        ${datosReserva(r)}${listaIngresos(r)}
        <div class="ing-cantidad">
          <span>¿Cuántas personas ingresan?</span>
          <div class="ing-stepper">
            <button type="button" class="boton" data-menos aria-label="Una persona menos">−</button>
            <strong id="ing-cant">${cantidad}</strong>
            <button type="button" class="boton" data-mas aria-label="Una persona más">+</button>
          </div>
          <span class="suave pequeno">de ${r.faltan} que ${r.faltan === 1 ? 'falta' : 'faltan'}</span>
        </div>
        <button type="button" id="ing-registrar" class="primario ing-registrar">Registrar ingreso de ${personasTxt(cantidad)}</button>
        <p class="suave pequeno ing-ayuda"><strong>Enter</strong> confirma · flechas ↑ ↓ cambian la cantidad</p>`;
    } else if (tarjeta === 'registrado') {
      caja.innerHTML = `<div class="ing-estado"><span class="ing-icono ok" aria-hidden="true">✓</span>
          <div><strong>Ingreso registrado: ${personasTxt(mensaje)}</strong>
          <p>Van ${r.ingresados} de ${r.personas}.${r.faltan ? ` ${r.faltan === 1 ? 'Falta 1 persona: puede' : `Faltan ${r.faltan} personas: pueden`} entrar después con el mismo QR.` : ' Reserva completa.'}</p></div></div>
        ${datosReserva(r)}
        <div class="acciones"><button type="button" class="boton peligro" data-deshacer>Deshacer este ingreso</button></div>`;
    }
  }

  function mostrar(info) {
    actual = info;
    if (info.faltan === 0) {
      tarjeta = 'completa';
      sonar('error');
    } else {
      tarjeta = 'listo';
      cantidad = info.faltan;
      sonar('listo');
    }
    pintarTarjeta();
    // El foco queda libre: el Enter (de la persona) confirma; el de la pistola no.
    document.activeElement?.blur?.();
  }

  async function consultar(leido) {
    if (ocupado || !puedeRegistrar()) return;
    ocupado = true;
    $('#ing-lector').textContent = '● Consultando…';
    try {
      mostrar(await api('POST', '/api/ingreso/consultar', { codigo: leido, puerta: puerta() }));
    } catch (err) {
      actual = null;
      tarjeta = 'invalido';
      pintarTarjeta(err.message);
      sonar('error');
    } finally {
      ocupado = false;
      $('#ing-lector').textContent = '● Listo para leer';
    }
  }

  async function registrar() {
    if (ocupado || tarjeta !== 'listo' || !actual) return;
    ocupado = true;
    const n = cantidad;
    let fallo = false;
    try {
      propio = { codigo: actual.codigo, hasta: Date.now() + 5000 };
      actual = await api('POST', '/api/ingreso/registrar', { codigo: actual.codigo, personas: n, puerta: puerta() });
      tarjeta = 'registrado';
      pintarTarjeta(n);
      sonar('ok');
    } catch (err) {
      aviso(err.message, 'error');
      sonar('error');
      fallo = true;
    } finally {
      ocupado = false;
    }
    if (fallo) consultar(actual.codigo); // mostrar cómo quedó (por ejemplo, si otra puerta ya la registró)
  }

  async function deshacer() {
    if (ocupado || !actual || !puedeRegistrar()) return;
    const ultimo = actual.ingresos.at(-1);
    if (!ultimo || !confirm(`¿Deshacer el ingreso de ${personasTxt(ultimo.personas)} de ${actual.nombre} (${hora(ultimo.fecha)})?`)) return;
    ocupado = true;
    try {
      propio = { codigo: actual.codigo, hasta: Date.now() + 5000 };
      const info = await api('POST', '/api/ingreso/deshacer', { codigo: actual.codigo, puerta: puerta() });
      aviso('Ingreso deshecho');
      ocupado = false;
      mostrar(info);
    } catch (err) {
      aviso(err.message, 'error');
    } finally {
      ocupado = false;
    }
  }

  function cambiarCantidad(delta) {
    if (tarjeta !== 'listo' || !actual) return;
    cantidad = Math.min(actual.faltan, Math.max(1, cantidad + delta));
    $('#ing-cant').textContent = cantidad;
    $('#ing-registrar').textContent = `Registrar ingreso de ${personasTxt(cantidad)}`;
  }

  $('#ing-tarjeta').addEventListener('click', e => {
    if (e.target.closest('[data-menos]')) cambiarCantidad(-1);
    if (e.target.closest('[data-mas]')) cambiarCantidad(1);
    if (e.target.closest('#ing-registrar')) registrar();
    if (e.target.closest('[data-deshacer]')) deshacer();
  });

  $('#ing-form').addEventListener('submit', e => {
    e.preventDefault();
    const campo = $('#ing-codigo');
    if (!campo.value.trim()) return;
    consultar(campo.value);
    campo.value = '';
  });

  $('#ing-ultimos').addEventListener('click', e => {
    const li = e.target.closest('li[data-codigo]');
    if (li && puedeRegistrar()) consultar(li.dataset.codigo);
  });

  // ── Pistola lectora (Honeywell Xenon 1900 como teclado USB) ───────────
  // La pistola "escribe" todo el texto del QR muy rápido, con un Enter por cada línea.
  // Se junta lo que llega seguido (menos de 60 ms entre teclas) y se procesa al terminar.
  // Una persona escribe mucho más despacio, así que su Enter sirve para confirmar.
  const RAPIDO = 60;
  let buffer = '', inicio = 0, ultima = 0, temporizador = null;

  function programar() {
    clearTimeout(temporizador);
    temporizador = setTimeout(procesar, 150);
  }

  function procesar() {
    const leido = buffer;
    const duracion = ultima - inicio;
    buffer = '';
    const sinSaltos = leido.replace(/\n/g, '');
    const esPistola = sinSaltos.length >= 6 && duracion / Math.max(1, leido.length - 1) <= 35;
    const activo = document.activeElement;
    if (!esPistola) {
      // Escritura a mano con un Enter muy rápido al final: se envía el formulario del código.
      if (leido.endsWith('\n') && activo?.id === 'ing-codigo') $('#ing-form').requestSubmit();
      return;
    }
    // Si la pistola escribió dentro de un campo, se le devuelve lo que tenía.
    if (activo?.matches?.('input:not([type=password]), textarea')) {
      activo.value = activo.value.replace(sinSaltos, '');
      if (activo === campoPuerta) guardarLocal('puerta', puerta());
      activo.blur();
    }
    if (estado.vista !== 'ingreso') location.hash = '#ingreso';
    if (dialogo.open) dialogo.close();
    consultar(leido);
  }

  document.addEventListener('keydown', e => {
    if (!puedeRegistrar() || e.ctrlKey || e.altKey || e.metaKey) return;
    const activo = document.activeElement;
    if (activo?.matches?.('input[type=password]')) return;
    const ahora = performance.now();
    const seguido = ahora - ultima < RAPIDO;
    if (!seguido) { buffer = ''; inicio = ahora; }
    ultima = ahora;

    if (e.key === 'Enter') {
      if (seguido && buffer.length >= 3) {
        // Enter en medio de una lectura de la pistola: no debe confirmar ni enviar nada.
        buffer += '\n';
        e.preventDefault();
        e.stopPropagation();
        programar();
        return;
      }
      buffer = '';
      // Enter de la persona: confirma el ingreso que muestra la tarjeta
      // (también si el foco quedó en los botones − / + de la tarjeta).
      const enTarjeta = activo?.closest?.('#ing-tarjeta') && !activo.closest('[data-deshacer]');
      if (estado.vista === 'ingreso' && tarjeta === 'listo' && (enTarjeta || !activo?.closest?.('input, textarea, select, button, a, dialog'))) {
        e.preventDefault();
        registrar();
      }
      return;
    }
    if (e.key.length === 1) {
      buffer += e.key;
      programar();
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && estado.vista === 'ingreso' && tarjeta === 'listo'
      && !activo?.closest?.('input, textarea, select')) {
      e.preventDefault();
      cambiarCantidad(e.key === 'ArrowUp' ? 1 : -1);
    }
  }, true);

  // ── Pantalla completa y reloj ─────────────────────────────────────────
  $('#ing-completa').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#ing-grafica').requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => {
    $('#ing-completa').textContent = document.fullscreenElement === $('#ing-grafica') ? 'Salir de pantalla completa' : '⛶ Pantalla completa';
  });
  function reloj() {
    $('#ing-hora').textContent = new Date().toLocaleString('es-CO', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
  }
  reloj();
  setInterval(reloj, 30_000);

  // ── Tiempo real ───────────────────────────────────────────────────────
  alIngreso.push(d => {
    cargar([d.palco]);
    // Si otra puerta registró la misma reserva que tengo en pantalla, se actualiza la tarjeta.
    const mio = d.codigo === propio.codigo && Date.now() < propio.hasta;
    if (!mio && actual && d.codigo === actual.codigo && tarjeta === 'listo' && puedeRegistrar()) {
      aviso(`Otra puerta acaba de registrar la reserva ${d.codigo}`, 'error');
      consultar(d.codigo);
    }
  });
  alMostrarVista.ingreso = () => cargar(null);
  alActualizar.push(() => cargar(null));
})();
