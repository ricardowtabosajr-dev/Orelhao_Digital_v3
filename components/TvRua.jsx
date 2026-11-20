'use client';

// Modo TV: Street View do orelhão localizado, dentro da própria tela (sem abrir aba).
// Um único StreetViewPanorama para o loop inteiro (só troca o lugar com setPano), o que
// economiza a cota da API do Google. Olha para o orelhão: vista salva na marcação ou,
// sem ela, a foto de rua mais próxima virada para ele. Depois faz um giro de 360°.

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { carregarGoogle, rumo } from '@/components/Rua';

const CHAVE = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
// tempos do giro (s): parado no orelhão, girando 360°, e parado no orelhão no fim
export const TV_PARADO = 1.2;
export const TV_GIRO = 13; // devagar o bastante para ver a comunidade
export const TV_RUA_MS = (TV_PARADO + TV_GIRO + 1.2) * 1000;

const TvRua = forwardRef(function TvRua(_, ref) {
  const el = useRef(null);
  const pano = useRef(null);
  const giro = useRef(null);
  const preparo = useRef(Promise.resolve(null));
  const [visivel, setVisivel] = useState(false);

  const parar = () => { cancelAnimationFrame(giro.current); giro.current = null; };
  const criar = async () => {
    await carregarGoogle();
    if (!pano.current) {
      pano.current = new window.google.maps.StreetViewPanorama(el.current, {
        visible: false, disableDefaultUI: true, clickToGo: false, scrollwheel: false,
        motionTracking: false, showRoadLabels: false, linksControl: false,
      });
    }
  };

  useImperativeHandle(ref, () => ({
    // carrega o Google e cria o Street View logo ao abrir o modo TV
    aquecer() { if (CHAVE) criar().catch(() => {}); },

    // Carrega a foto do orelhão ESCONDIDA (o quadro fica transparente), para ela já estar pronta
    // quando a etapa "Na rua" começar. Resolve true se há foto de rua perto, false se não.
    preparar(orelhao, vista) {
      preparo.current = (async () => {
        if (!CHAVE) return null;
        try {
          await criar();
          const g = window.google.maps;
          const svc = new g.StreetViewService();
          const buscar = async (onde, raio) => {
            try { return (await svc.getPanorama({ location: onde, radius: raio, preference: g.StreetViewPreference.NEAREST, source: g.StreetViewSource.OUTDOOR })).data; }
            catch { return null; }
          };
          const data = (vista && (await buscar({ lat: vista.lat, lng: vista.lng }, 30))) || (await buscar(orelhao, 60));
          if (!data) return null;
          const pos = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
          const base = vista ? { heading: vista.heading, pitch: vista.pitch } : { heading: rumo(pos, orelhao), pitch: -6 };
          const p = pano.current;
          parar();
          p.setPano(data.location.pano);
          p.setPov(base);
          p.setZoom(vista ? 1.2 : 0.8);
          p.setVisible(true); // já desenha, por trás do quadro ainda transparente
          return base;
        } catch { return null; }
      })();
      return preparo.current.then((b) => !!b);
    },

    // Aparece e faz o giro: parado no orelhão, 360° devagar mostrando a comunidade ao redor
    // (no meio do giro a câmera sobe para o horizonte) e termina de novo no orelhão.
    async exibir() {
      const base = await preparo.current;
      if (!base) return false;
      const p = pano.current;
      setVisivel(true);
      parar();
      const t0 = performance.now();
      const suave = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
      const passo = (agora) => {
        const t = (agora - t0) / 1000;
        const u = Math.min(1, Math.max(0, (t - TV_PARADO) / TV_GIRO));
        const meio = Math.sin(Math.PI * u); // 0 no orelhão, 1 no meio do giro
        p.setPov({ heading: base.heading + 360 * suave(u), pitch: base.pitch * (1 - meio) });
        if (u < 1) giro.current = requestAnimationFrame(passo);
      };
      giro.current = requestAnimationFrame(passo);
      return true;
    },

    esconder() { parar(); setVisivel(false); },
  }), []);

  return (
    <div className={`tv-rua ${visivel ? 'in' : ''}`} aria-hidden={!visivel}>
      <div ref={el} className="tv-rua-pano" />
      <span className="tv-rua-selo">Street View · imagem do Google</span>
    </div>
  );
});

export default TvRua;
