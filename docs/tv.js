'use strict';
// Pestaña Pantalla TV: solo visual, para proyectar la ocupación en vivo.
// Usa las funciones y el estado de app.js (construirPlano, estado, categoria, empresa…).
(function () {
  const svg = $('#plano-tv');
  const nodosTv = new Map();
  construirPlano(svg, nodosTv, { ancho: 0, alto: 0 }, 'tv');
  $('#tv-titulo').textContent = PLANO.TITULO;

  const suma = (lista, fn) => lista.reduce((t, x) => t + fn(x), 0);
  const OCUPADO = '#1d232c';

  function barras(lista, campo) {
    const palcos = [...estado.palcos.values()];
    return lista.map(g => {
      const ps = palcos.filter(p => p[campo] === g.id);
      const capacidad = suma(ps, p => p.capacidad);
      const personas = suma(ps, p => p.ocupadas.length);
      const pct = capacidad ? (personas / capacidad) * 100 : 0;
      return `<div class="tv-barra">
          <div class="tv-barra-cab"><span><i class="muestra" style="background:${g.color}"></i>${esc(g.nombre)}</span>
          <strong>${personas.toLocaleString('es-CO')} / ${capacidad.toLocaleString('es-CO')}</strong></div>
          <div class="barra-avance"><i style="width:${pct}%; background:${g.color}"></i></div>
        </div>`;
    }).join('') || '<span class="suave">Sin datos</span>';
  }

  function pintar(cambiados) {
    if (estado.vista !== 'tv') return;
    const palcos = [...estado.palcos.values()];
    const capacidad = suma(palcos, p => p.capacidad);
    const personas = suma(palcos, p => p.ocupadas.length);
    const ocupados = palcos.filter(p => p.ocupadas.length > 0).length;
    const llenos = palcos.filter(p => p.ocupadas.length >= p.capacidad).length;

    $('#tv-ocupados').innerHTML = `${ocupados} <small>de ${palcos.length}</small>`;
    $('#tv-llenos').textContent = llenos;
    $('#tv-personas').textContent = personas.toLocaleString('es-CO');
    $('#tv-libres').textContent = (capacidad - personas).toLocaleString('es-CO');
    $('#tv-ocupacion').textContent = `${capacidad ? ((personas / capacidad) * 100).toFixed(1) : '0.0'}%`;
    $('#tv-zonas').innerHTML = barras(estado.categorias, 'categoria_id');
    $('#tv-empresas').innerHTML = barras(estado.empresas, 'empresa_id');

    for (const [n, nodo] of nodosTv) {
      const p = estado.palcos.get(n);
      if (!p) continue;
      const color = categoria(p.categoria_id)?.color || NEUTRO;
      const k = p.ocupadas.length;
      nodo.g.classList.toggle('bloqueado', !!p.bloqueado);
      if (p.bloqueado) {
        nodo.fondo.setAttribute('fill', '#5b6470');
        nodo.fondo.style.stroke = '';
        nodo.num.setAttribute('fill', '#ffffff');
        nodo.sub.setAttribute('fill', '#ffffff');
        nodo.sub.textContent = k ? `${k}/${p.capacidad}` : 'BLOQ.';
      } else if (k > 0) {
        nodo.fondo.setAttribute('fill', OCUPADO);
        nodo.fondo.style.stroke = color;
        nodo.num.setAttribute('fill', '#ffffff');
        nodo.sub.setAttribute('fill', color);
        nodo.sub.textContent = `${k}/${p.capacidad}`;
      } else {
        nodo.fondo.setAttribute('fill', color);
        nodo.fondo.style.stroke = '';
        nodo.num.setAttribute('fill', tinta(color));
        nodo.sub.textContent = '';
      }
      nodo.g.classList.toggle('ocupado', k > 0);
    }
    for (const n of cambiados || []) {
      const g = nodosTv.get(n)?.g;
      if (!g) continue;
      g.classList.remove('destello');
      void g.getBoundingClientRect();
      g.classList.add('destello');
    }
  }

  function reloj() {
    const ahora = new Date();
    $('#tv-hora').textContent = ahora.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }
  reloj();
  setInterval(reloj, 30_000);

  $('#tv-completa').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#vista-tv').requestFullscreen?.();
  });
  document.addEventListener('fullscreenchange', () => {
    $('#tv-completa').textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
  });

  alMostrarVista.tv = () => pintar(null);
  alActualizar.push(pintar);
})();
