// Roda no Google Maps (Street View) e no Google Earth. Mostra uma mira no centro
// da tela e o botão "Marcar orelhão aqui", que envia a posição para o app.

const NO_EARTH = location.hostname === 'earth.google.com';

// Lê a câmera da URL.
//  Street View: /maps/@lat,lng,3a,75y,<heading>h,<tilt>t/...
//    → posição do carro + direção; o app projeta o ponto à frente.
//  Google Earth: /web/@lat,lng,<alt>a,<dist>d,35y,<heading>h,<tilt>t,0r/...
//    → lat,lng já é o ponto do chão no centro da tela: posição exata.
function lerCamera() {
  const p = (location.href.split('@')[1] || '').split('/')[0].split(',');
  const g = (c) => { const v = p.find((x) => x.endsWith(c)); return v ? parseFloat(v) : null; };
  const lat = parseFloat(p[0]), lng = parseFloat(p[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  if (NO_EARTH) {
    if (g('d') === null) return null;
    // Street View dentro do Earth: câmera praticamente no chão, olhando para a frente.
    if (g('d') < 5 && g('h') !== null) return { lat, lng, h: g('h'), t: g('t') ?? 90 };
    return { lat, lng, exato: true };
  }

  // Street View tem "a" (altura) e "y" (campo de visão). Com a câmera virada para o norte,
  // o Google omite o "h" (direção) do endereço: vale 0.
  if (p.length < 4 || g('a') === null || g('y') === null) return null;
  return { lat, lng, h: g('h') ?? 0, t: g('t') ?? 90 };
}

// Discreto: fica só um botãozinho redondo embaixo. Ao clicar nele aparecem a mira (sem texto)
// e o botão "Marcar aqui"; depois de enviar (ou no ×, ou com Esc) tudo volta a se esconder.
const PIN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 1 1 13 0C18.5 14.8 12 21 12 21Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.8" r="2.3" fill="currentColor"/></svg>';
const ui = document.createElement('div');
ui.id = 'orelhao-ui';
ui.innerHTML = `
  <div class="orelhao-mira" aria-hidden="true"><i></i></div>
  <div class="orelhao-acoes">
    <button class="orelhao-btn" type="button">${PIN}<span>Marcar aqui</span></button>
    <button class="orelhao-x" type="button" title="Cancelar (Esc)" aria-label="Cancelar">×</button>
  </div>
  <button class="orelhao-gatilho" type="button" title="Marcar a posição do orelhão" aria-label="Marcar a posição do orelhão">${PIN}</button>`;
const btn = ui.querySelector('.orelhao-btn');
const rotulo = btn.querySelector('span');
const abrir = () => ui.classList.add('marcando');
const fechar = () => { ui.classList.remove('marcando'); btn.disabled = false; rotulo.textContent = 'Marcar aqui'; ui.classList.remove('enviado', 'erro'); };
ui.querySelector('.orelhao-gatilho').addEventListener('click', abrir);
ui.querySelector('.orelhao-x').addEventListener('click', fechar);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.classList.contains('marcando')) fechar(); }, true);

btn.addEventListener('click', async () => {
  const cam = lerCamera();
  if (!cam) return;
  btn.disabled = true;
  rotulo.textContent = 'Enviando…';
  const r = await chrome.runtime.sendMessage({ tipo: 'marcar', cam }).catch(() => null);
  ui.classList.add(r?.ok ? 'enviado' : 'erro');
  rotulo.textContent = r?.ok ? 'Enviado ✔' : r?.erro || 'Erro ao enviar';
  setTimeout(r?.ok ? fechar : () => { btn.disabled = false; rotulo.textContent = 'Marcar aqui'; ui.classList.remove('erro'); }, r?.ok ? 1600 : 4000);
});

// Google Maps e Earth trocam a URL sem recarregar a página: confere periodicamente.
setInterval(() => {
  const cam = lerCamera();
  if (cam && !ui.isConnected) document.body.appendChild(ui);
  if (!cam && ui.isConnected) { fechar(); ui.remove(); }
}, 400);
