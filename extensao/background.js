// Recebe a posição da câmera vinda do Street View, entrega à aba do Orelhão Digital
// (pelo mesmo canal que o app já escuta) e traz essa aba para a frente.

// Endereços onde o app roda. Ao publicar o app, acrescente o novo endereço aqui
// e em "host_permissions" no manifest.json.
const APP_URLS = ['http://localhost:3000/*', 'http://127.0.0.1:3000/*'];

// Entrega a posição em uma aba do app. O canal (BroadcastChannel) chega a todas as abas
// do app, então basta uma aba carregada. Tenta primeiro a mais recente; uma aba
// suspensa pelo Chrome, ainda carregando ou com página de erro é pulada.
async function entregar(cam) {
  const abas = (await chrome.tabs.query({ url: APP_URLS }))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  if (!abas.length) return { ok: false, erro: 'Abra o Orelhão Digital primeiro' };
  let ultimoErro = '';
  for (const aba of abas) {
    if (aba.discarded) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: aba.id },
        world: 'MAIN',
        args: [cam],
        func: (c) => { const bc = new BroadcastChannel('orelhao-marcar'); bc.postMessage(c); bc.close(); },
      });
      await chrome.tabs.update(aba.id, { active: true });
      await chrome.windows.update(aba.windowId, { focused: true });
      return { ok: true };
    } catch (e) { ultimoErro = e.message; }
  }
  console.warn('Orelhão Digital: nenhuma aba aceitou a posição', ultimoErro);
  return { ok: false, erro: 'Recarregue a aba do Orelhão Digital (F5), abra o orelhão e tente de novo' };
}

chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  if (msg?.tipo !== 'marcar') return;
  entregar(msg.cam).then(responder, (e) => responder({ ok: false, erro: 'Erro: ' + e.message }));
  return true; // resposta assíncrona
});
