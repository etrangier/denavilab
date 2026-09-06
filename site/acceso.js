/* DenaviLAB · la puerta del taller.
   Cortina, no cerradura: al ser un sitio estático la comprobación ocurre en el navegador
   del visitante y se puede sortear. Ver el README. */
(() => {
  const LLAVES = {
    rolando: '9b5999aa401660f7719125fa8c0a6f8db317063f1a0bba928ec3efa93b048883',
    schair:  '47d3865e9c149251ef89bbc0b054c76d4efb6cb0a4d390143c78d34394d1e4f6',
  };
  const NOMBRE = { rolando: 'Rolando', schair: 'Schair', invitado: 'Invitado' };
  const VALIDOS = ['rolando', 'schair', 'invitado'];
  const CLAVE_SESION = 'denavilab.sesion';

  const $ = id => document.getElementById(id);
  const leerSesion = () => { try { return localStorage.getItem(CLAVE_SESION); } catch (e) { return null; } };
  const dentro = () => VALIDOS.includes(leerSesion());

  async function huella(texto) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const puerta = $('puerta'), sesionEl = $('sesion'), errorEl = $('errorPuerta');
  let destino = null;

  function pintarSesion() {
    if (!sesionEl) return;
    const u = leerSesion();
    if (dentro()) {
      const etq = u === 'invitado' ? 'Invitado (solo mirando)' : NOMBRE[u];
      sesionEl.innerHTML = '<span class="candado">&#9679;</span> Dentro como ' + etq + ' &middot; ';
      const enPortada = /(^|\/)(index\.html)?$/.test(location.pathname);
      const salir = document.createElement('button');
      salir.type = 'button'; salir.textContent = enPortada ? 'salir' : 'cambiar sesión';
      salir.addEventListener('click', () => {
        try { localStorage.removeItem(CLAVE_SESION); } catch (e) {}
        if (enPortada) pintarSesion(); else location.href = 'index.html';
      });
      sesionEl.append(salir);
    } else {
      sesionEl.innerHTML = '<span class="candado">&#128274;</span> La portada es libre; el resto pide nombre y clave.';
    }
  }

  document.addEventListener('click', e => {
    const enlace = e.target.closest('a[data-privado]');
    if (!enlace || dentro() || !puerta) return;
    e.preventDefault();
    destino = enlace.getAttribute('href');
    errorEl.textContent = ''; $('usuario').value = ''; $('clave').value = '';
    puerta.showModal();
    $('usuario').focus();
  });

  if (puerta) {
    $('cancelar').addEventListener('click', () => puerta.close());
    const verClave = $('verClave');
    if (verClave) verClave.addEventListener('click', () => {
      const oculta = $('clave').type === 'password';
      $('clave').type = oculta ? 'text' : 'password';
      verClave.textContent = oculta ? 'Ocultar' : 'Ver';
      verClave.setAttribute('aria-pressed', String(oculta));
      verClave.setAttribute('aria-label', oculta ? 'Ocultar la clave' : 'Mostrar la clave');
      $('clave').focus();
    });
    const invBtn = $('entrarInvitado');
    if (invBtn) invBtn.addEventListener('click', () => {
      try { localStorage.setItem(CLAVE_SESION, 'invitado'); } catch (e) {}
      puerta.close(); pintarSesion();
      if (destino) location.href = destino;
    });
    $('formPuerta').addEventListener('submit', async e => {
      e.preventDefault();
      const u = $('usuario').value.trim().toLowerCase();
      const c = $('clave').value;
      if (!LLAVES[u] || await huella('denavilab:' + u + ':' + c) !== LLAVES[u]) {
        errorEl.textContent = 'Ese nombre y esa clave no calzan.';
        $('clave').value = ''; $('clave').focus();
        return;
      }
      try { localStorage.setItem(CLAVE_SESION, u); } catch (e2) {}
      puerta.close();
      pintarSesion();
      if (destino) location.href = destino;
    });
  }

  const atras = $('navAtras');
  if (atras) atras.addEventListener('click', () => { if (history.length > 1) history.back(); else location.href = 'index.html'; });

  pintarSesion();
})();
