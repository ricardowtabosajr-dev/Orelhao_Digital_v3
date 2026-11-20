'use client';

// Street View do orelhão numa aba própria do Orelhão Digital (API Maps JavaScript do Google).
// Faz o papel que antes era da extensão do Chrome: mira + "Marcar aqui", que manda a posição da
// câmera para a aba do mapa pelo mesmo canal ('orelhao-marcar'). Lá aparece o cartão "✔ Salvar".
// A marcação também fica guardada no navegador (localStorage): se a aba do mapa estiver
// congelada (comum no celular), ela recebe a marcação ao voltar para a frente.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MARCA_PENDENTE } from '@/lib/marcar';

const CHAVE = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

export function carregarGoogle() {
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve();
  if (!window.__carregandoGoogle) {
    window.__carregandoGoogle = new Promise((ok, erro) => {
      window.__googlePronto = ok;
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${CHAVE}&v=weekly&loading=async&language=pt-BR&region=BR&callback=__googlePronto`;
      s.async = true;
      s.onerror = () => erro(new Error('Não foi possível carregar o Google Maps'));
      document.head.appendChild(s);
    });
  }
  return window.__carregandoGoogle;
}

// direção (0–360°, a partir do norte) de a até b
export function rumo(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

const PIN = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
    <path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 1 1 13 0C18.5 14.8 12 21 12 21Z" stroke="currentColor" strokeWidth="2" />
    <circle cx="12" cy="9.8" r="2.3" fill="currentColor" />
  </svg>
);

export default function Rua() {
  const sp = useSearchParams();
  const num = (k) => { const v = parseFloat(sp.get(k)); return Number.isFinite(v) ? v : null; };
  const id = num('id');
  const orelhao = { lat: num('lat'), lng: num('lng') };
  const vista = num('vlat') !== null && num('vlng') !== null ? { lat: num('vlat'), lng: num('vlng'), heading: num('h') ?? 0, pitch: num('p') ?? 0 } : null;
  const nome = sp.get('nome') || '';
  const linkGoogle = vista
    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${vista.lat},${vista.lng}&heading=${vista.heading}&pitch=${vista.pitch}&fov=80`
    : `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${orelhao.lat},${orelhao.lng}`;

  const el = useRef(null);
  const pano = useRef(null);
  const [estado, setEstado] = useState('carregando'); // carregando | pronto | sem | erro
  const [erro, setErro] = useState('');
  const [marcando, setMarcando] = useState(false);
  const [envio, setEnvio] = useState(null); // null | 'ok' | 'erro'

  useEffect(() => {
    if (!CHAVE) { setEstado('erro'); setErro('A chave do Google Maps não está configurada.'); return; }
    if (orelhao.lat === null || orelhao.lng === null) { setEstado('erro'); setErro('Orelhão sem coordenadas.'); return; }
    window.gm_authFailure = () => { setEstado('erro'); setErro('O Google recusou a chave da API (confira as restrições da chave no Google Cloud).'); };
    let vivo = true;
    carregarGoogle().then(async () => {
      if (!vivo) return;
      const g = window.google.maps;
      const p = new g.StreetViewPanorama(el.current, {
        visible: false, addressControl: false, fullscreenControl: false, enableCloseButton: false,
        motionTracking: false, motionTrackingControl: false, showRoadLabels: false,
        zoomControl: true, panControl: true, linksControl: true, clickToGo: true,
      });
      pano.current = p;
      const svc = new g.StreetViewService();
      // com vista guardada: a mesma câmera; sem: a foto mais perto do orelhão, olhando para ele
      const tentar = async (raio) => {
        try {
          const { data } = await svc.getPanorama({ location: vista || orelhao, radius: raio, preference: g.StreetViewPreference.NEAREST, source: g.StreetViewSource.OUTDOOR });
          return data;
        } catch { return null; }
      };
      const data = (await tentar(vista ? 30 : 60)) || (await tentar(250));
      if (!vivo) return;
      if (!data) { setEstado('sem'); return; }
      const pos = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
      p.setPano(data.location.pano);
      p.setPov(vista ? { heading: vista.heading, pitch: vista.pitch } : { heading: rumo(pos, orelhao), pitch: -8 });
      p.setZoom(vista ? 1 : 0);
      p.setVisible(true);
      setEstado('pronto');
    }).catch((e) => { if (vivo) { setEstado('erro'); setErro(e.message); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') setMarcando(false); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, []);

  const marcar = () => {
    const p = pano.current;
    const pos = p?.getPosition();
    if (!pos) return;
    const pov = p.getPov();
    // mesmo formato da extensão: h = direção, t = inclinação no padrão da URL do Google (90 = horizonte)
    const msg = { lat: pos.lat(), lng: pos.lng(), h: ((pov.heading % 360) + 360) % 360, t: 90 + pov.pitch, id, n: Date.now() };
    try {
      try { localStorage.setItem(MARCA_PENDENTE, JSON.stringify(msg)); } catch {}
      if (typeof BroadcastChannel !== 'undefined') { const bc = new BroadcastChannel('orelhao-marcar'); bc.postMessage(msg); bc.close(); }
      setEnvio('ok');
      // volta para o mapa: fecha esta aba (se o navegador deixar)
      setTimeout(() => { window.close(); }, 900);
    } catch { setEnvio('erro'); }
  };

  return (
    <main className="rua">
      <div ref={el} className="rua-pano" />

      <header className="rua-topo">
        <span className="rua-nome" title={nome}>{nome || 'Orelhão'}</span>
        <a className="rua-google" href={linkGoogle} target="_blank" rel="noreferrer">Abrir no Google Maps ↗</a>
      </header>

      {estado === 'carregando' && <div className="rua-aviso">Carregando o Street View…</div>}
      {estado === 'sem' && (
        <div className="rua-aviso">
          <b>Sem Street View perto deste orelhão.</b>
          <span>O Google não tem fotos de rua a até 250 m daqui. Use o pino no mapa ou as fotos do local.</span>
          <button type="button" onClick={() => window.close()}>Fechar esta aba</button>
        </div>
      )}
      {estado === 'erro' && (
        <div className="rua-aviso erro">
          <b>Não foi possível abrir o Street View.</b>
          <span>{erro}</span>
          <a href={linkGoogle}>Abrir no Google Maps</a>
        </div>
      )}

      {estado === 'pronto' && id !== null && (
        <div className={`rua-marcar ${marcando ? 'marcando' : ''} ${envio || ''}`}>
          <div className="rua-mira" aria-hidden="true"><i /></div>
          {envio === 'ok' ? (
            <div className="rua-enviado">✔ Enviado — volte para a aba do mapa e confirme em <b>Salvar</b></div>
          ) : (
            <>
              <div className="rua-acoes">
                <button type="button" className="rua-btn" onClick={marcar}>{PIN}<span>Marcar aqui</span></button>
                <button type="button" className="rua-x" onClick={() => setMarcando(false)} title="Cancelar (Esc)" aria-label="Cancelar">×</button>
              </div>
              <button type="button" className="rua-gatilho" onClick={() => setMarcando(true)} title="Marcar a posição do orelhão" aria-label="Marcar a posição do orelhão">{PIN}</button>
            </>
          )}
        </div>
      )}
    </main>
  );
}
