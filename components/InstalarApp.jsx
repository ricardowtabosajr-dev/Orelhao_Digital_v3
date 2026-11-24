'use client';

// Botão "Instalar app" (PWA). Chrome/Edge/Android: instala com um clique (janela do próprio navegador).
// iPhone/iPad e Safari no Mac não deixam o site instalar sozinho: o botão mostra o passo a passo.
// Já instalado (aberto como app) ou navegador sem suporte: o botão não aparece.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const COMPARTILHAR = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const MAIS = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="currentColor" strokeWidth="2" /><path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;

function aberto_como_app() {
  try { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true; } catch { return false; }
}
function plataforma() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox/.test(ua)) return 'mac';
  return '';
}

export default function InstalarApp({ oculto = false }) {
  const [modo, setModo] = useState(null); // null | 'prompt' | 'ios' | 'mac'
  const [ajuda, setAjuda] = useState(false);
  const [feito, setFeito] = useState('');
  const pedido = useRef(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (aberto_como_app()) return undefined;
    const p = plataforma();
    if (p) setModo(p);
    // iPhone/iPad: sempre o passo a passo (lá o Safari não oferece a janela de instalação)
    const antes = (e) => { if (p === 'ios') return; e.preventDefault(); pedido.current = e; setModo('prompt'); };
    const instalado = () => { pedido.current = null; setModo(null); setFeito('App instalado! Procure o ícone do Orelhão Digital.'); setTimeout(() => setFeito(''), 6000); };
    addEventListener('beforeinstallprompt', antes);
    addEventListener('appinstalled', instalado);
    return () => { removeEventListener('beforeinstallprompt', antes); removeEventListener('appinstalled', instalado); };
  }, []);

  const clicar = async () => {
    if (modo === 'prompt' && pedido.current) {
      const e = pedido.current;
      e.prompt();
      const r = await e.userChoice.catch(() => null);
      if (r?.outcome === 'accepted') { pedido.current = null; setModo(null); }
      return;
    }
    setAjuda(true);
  };

  return (
    <>
      {modo && (
        <button type="button" id="instalar-app" className={`instalar-flutua ${oculto ? '' : 'in'}`} onClick={clicar} aria-hidden={oculto} tabIndex={oculto ? -1 : 0}
          title="Instalar o Orelhão Digital como aplicativo">
          <span className="marca"><img src="/marker.png" alt="" draggable={false} /></span>
          <span className="txt"><b>Instalar<span className="quebra" /> App</b><small>no celular ou computador</small></span>
        </button>
      )}
      {feito && createPortal(<div className="toast glass instalar-ok">{feito}</div>, document.querySelector('main.app') || document.body)}
      {ajuda && createPortal(
        <>
          <div className="admin-fundo" onClick={() => setAjuda(false)} />
          <section className="admin-painel instalar-ajuda" role="dialog" aria-label="Como instalar">
            <header>
              <div><span className="admin-selo">Aplicativo</span><h2>Instalar o Orelhão Digital</h2></div>
              <button type="button" className="admin-x" onClick={() => setAjuda(false)} aria-label="Fechar">×</button>
            </header>
            <div className="instalar-app-icone"><img src="/app/icone-192.png" alt="" width="64" height="64" /><span><b>Orelhão Digital</b><small>abre direto no mapa, em tela cheia, como um app</small></span></div>
            {modo === 'mac' ? (
              <ol className="instalar-passos">
                <li><span>1</span><p>No menu <b>Arquivo</b> do Safari, escolha <b>Adicionar ao Dock…</b></p></li>
                <li><span>2</span><p>Confirme em <b>Adicionar</b>. O ícone aparece no Dock e no Launchpad.</p></li>
              </ol>
            ) : (
              <ol className="instalar-passos">
                <li><span>1</span><p>Toque no botão <b>Compartilhar</b> <i>{COMPARTILHAR}</i> (na barra do Safari, embaixo ou no topo).</p></li>
                <li><span>2</span><p>Role a lista e toque em <b>Adicionar à Tela de Início</b> <i>{MAIS}</i>.</p></li>
                <li><span>3</span><p>Toque em <b>Adicionar</b>. O ícone aparece na tela inicial.</p></li>
              </ol>
            )}
            <p className="prop-nota">A Apple não permite que o site instale sozinho no {modo === 'mac' ? 'Mac' : 'iPhone/iPad'} — por isso estes passos.</p>
          </section>
        </>,
        document.querySelector('main.app') || document.body,
      )}
    </>
  );
}
