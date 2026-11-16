'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { tileEsri, zoomComFoto } from '@/lib/esri';

// Satélite pelo protocolo "esri://", que troca o aviso "Map data not yet available"
// pela última foto disponível esticada (ver lib/esri.js).
if (!globalThis.__protocoloEsri) { maplibregl.addProtocol('esri', tileEsri); globalThis.__protocoloEsri = true; }

// Só o Brasil: o mapa não sai desta área e o resto do continente fica escurecido.
// A área é larga de propósito: em tela larga o país inteiro precisa caber com folga.
const LIMITES_BRASIL = [[-125, -56], [15, 26]];
const BRASIL = [[-74, -34], [-34.8, 5.3]];
const ENQUADRAMENTO = { top: 70, bottom: 70, left: 420, right: 70 }; // espaço do painel lateral

// Bolinhas de agrupamento: uma cor só (o amarelo do app); o tamanho mostra a quantidade.
const COR_CLUSTER = '#fbbf24';
const RAIO_CLUSTER = ['step', ['get', 'point_count'], 14, 25, 17, 100, 21, 400, 26];

// Visão do país (zoom abaixo disto): um selo por estado, com a bandeira e o total de TUPs.
// De perto entram os grupos normais, que se abrem em pontos.
const UF_ZOOM = 5;
// Todos os selos têm o mesmo tamanho. Os estados pequenos do litoral não comportam o selo:
// o dele fica um pouco para o lado do mar (dx em px), ligado ao estado por uma linha fina.
// Cada grupo vizinho forma uma fila vertical com espaço fixo entre os selos, em qualquer zoom.
const SELO_FORA = { RN: 52, PB: 62, AL: 64, SE: 54, ES: 52, RJ: 56 };
const FILAS_FORA = [['RN', 'PB', 'AL', 'SE'], ['ES', 'RJ']];
// em teste (/teste): SC também fica fora, ligado por linha
const SELO_FORA_TESTE = { ...SELO_FORA, SC: 60 };
const FILAS_FORA_TESTE = [...FILAS_FORA, ['SC']];
const SELO_ESPACO = 58; // distância vertical mínima entre dois selos da fila (px)

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const FONT = ['Montserrat Medium'];

// Orelhão confirmado: posição marcada no Street View / Google Earth e salva (migrations 006/007
// gravam "Posição corrigida manualmente (Street View)" em origem_desc). No mapa, pisca em vermelho.
export const confirmado = (p) => /\((Street View|Google Earth)\)/.test(p?.origem_desc || '');

const toGeoJSON = (points) => ({
  type: 'FeatureCollection',
  features: points.map((p) => ({
    type: 'Feature', id: p.id,
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: { id: p.id, localidade: p.localidade, municipio: p.municipio, uf: p.uf, regiao: p.regiao, origem: p.origem, confirmado: confirmado(p) },
  })),
});
// pulso vermelho dos confirmados: um anel que cresce e some, embaixo do ícone
const PULSO_COR = '#ff2a2a';
const RAIO_GRUPO = ['step', ['get', 'point_count'], 19, 25, 23, 100, 28, 400, 34]; // mesmo tamanho do brilho do grupo
const filtroConfirmado = ['all', ['!', ['has', 'point_count']], ['==', ['get', 'confirmado'], true]];
const camadaPulso = (id, source) => ({
  id, type: 'circle', source, filter: filtroConfirmado, minzoom: ICON_ZOOM,
  paint: { 'circle-color': PULSO_COR, 'circle-opacity': 0.35, 'circle-blur': 0.35, 'circle-radius': 18,
    'circle-stroke-width': 2, 'circle-stroke-color': PULSO_COR, 'circle-stroke-opacity': 0.8, 'circle-pitch-alignment': 'map' },
});

const ICON_ZOOM = 8; // abaixo disso, pontos simples em vez da logo (performance)
// Em teste, todos os orelhões usam o ícone da antena (marker-antena.png)...
const icone = (teste) => (teste ? 'marker-antena' : 'marker');
// ... 30% maior (ícone e anel), para dar destaque à antena.
const ANTENA_ESCALA = 1.3;
const escalaTeste = (teste, v) => (teste ? v * ANTENA_ESCALA : v);
const tamIcone = (teste) => ['interpolate', ['linear'], ['zoom'], ICON_ZOOM, escalaTeste(teste, 0.085), 16, escalaTeste(teste, 0.14)];
const raioAnel = (teste) => ['interpolate', ['linear'], ['zoom'], ICON_ZOOM, escalaTeste(teste, 13), 16, escalaTeste(teste, 22)];
const SAT_HOSTS = ['server.arcgisonline.com', 'services.arcgisonline.com'];

const REGION_COLOR = ['match', ['get', 'regiao'],
  'Norte', '#34d399', 'Nordeste', '#fbbf24', 'Centro-Oeste', '#f472b6', 'Sudeste', '#60a5fa', 'Sul', '#a78bfa', '#ffffff'];

// O Chrome pode tirar a placa de vídeo da aba do mapa (ex.: Street View aberto em outra
// aba). O MapLibre 4 não recarrega fotos e ícones quando o vídeo volta e o mapa fica
// preto. Quando isso acontece, o mapa é recriado no mesmo lugar.
export default function MapView(props) {
  const [geracao, setGeracao] = useState(0);
  const memoria = useRef({ camera: null, fly: null });
  return <Mapa key={geracao} {...props} memoria={memoria} onRecriar={() => setGeracao((g) => g + 1)} />;
}

function Mapa({ points, mode, basemap = 'sat', orbit = false, onOrbitStop, editing = false, draft = null, onDraft, selected, userPos, flyTarget, onSelect, onReady, memoria, onRecriar, regioes, ufFoco, macro = null, onMacro, onMunicipio, onFoco, teste = false, enquadramento = null }) {
  // Margens ao enquadrar: "livre" = sem painel aberto (Brasil centralizado), "painel" = com o painel,
  // "voo" = ao voar até um orelhão. Sem a prop, o painel fixo da esquerda de sempre.
  const enq = useRef(null);
  enq.current = enquadramento || { livre: ENQUADRAMENTO, painel: ENQUADRAMENTO, voo: { left: 420, right: 380 } };
  const ref = useRef(null);
  const map = useRef(null);
  const loaded = useRef(false);
  const [pronto, setPronto] = useState(false);
  const pending = useRef(points);
  const userMarker = useRef(null);
  const popup = useRef(null);
  const baseLayers = useRef([]);
  const pulseMarker = useRef(null);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  const testeRef = useRef(teste);
  testeRef.current = teste;
  const cb = useRef({ onSelect });
  cb.current.onSelect = onSelect;
  cb.current.onMacro = onMacro;
  cb.current.onMunicipio = onMunicipio;

  useEffect(() => {
    const cam = memoria?.current.camera;
    const m = new maplibregl.Map({
      container: ref.current, style: STYLE,
      ...(cam ? { center: cam.center, zoom: cam.zoom } : { bounds: BRASIL, fitBoundsOptions: { padding: enq.current.livre } }),
      bearing: cam?.bearing ?? 0, pitch: cam?.pitch ?? 0,
      // celular estreito: o Brasil inteiro só cabe com zoom um pouco menor
      // (e a tela em pé é mais alta que a faixa de latitude do limite: amplia o limite para não forçar zoom)
      minZoom: enquadramento && window.innerWidth < 600 ? 1.8 : 2.5, maxPitch: 60,
      maxBounds: enquadramento && window.innerWidth < 600 ? [[-125, -75], [15, 45]] : LIMITES_BRASIL, attributionControl: false,
      fadeDuration: 0, refreshExpiredTiles: false,
    });
    map.current = m;
    if (cam?.padding) m.setPadding(cam.padding);
    if (memoria) {
      const recriar = () => {
        clearTimeout(timer);
        memoria.current.camera = { center: m.getCenter().toArray(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch(), padding: m.getPadding() };
        onRecriar();
      };
      let timer;
      // Vídeo devolvido: recria. Se o Chrome não devolver em 3 s, recria assim mesmo.
      m.on('webglcontextlost', () => { timer = setTimeout(recriar, 3000); });
      m.on('webglcontextrestored', recriar);
    }
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    // Canto inferior direito, de baixo para cima: créditos, escala, zoom.
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'hover-pop' });

    m.on('load', async () => {
      // Camadas do estilo vetorial base: ficam ocultas no satélite para não
      // baixar/desenhar dois mapas ao mesmo tempo.
      baseLayers.current = m.getStyle().layers.filter((l) => l.type !== 'background').map((l) => l.id);
      const img = await m.loadImage('/marker.png');
      if (map.current !== m) return; // mapa já descartado (remontagem do React em dev)
      m.addImage('marker', img.data);
      if (testeRef.current) {
        // em teste (/teste): ícone da antena com a logo da Método, em todos os estados
        const antena = await m.loadImage('/marker-antena.png');
        if (map.current !== m) return;
        m.addImage('marker-antena', antena.data);
      }
      m.addSource('orelhoes', {
        type: 'geojson', data: toGeoJSON(pending.current || []),
        cluster: true, clusterRadius: 55, clusterMaxZoom: 11,
        // quantos orelhões confirmados há em cada grupo: o grupo também pisca em vermelho
        clusterProperties: { confirmados: ['+', ['case', ['==', ['get', 'confirmado'], true], 1, 0]] },
      });
      // Os tiles do Esri são HTTP/1.1: o navegador só abre ~6 conexões por domínio.
      // Dividir entre os dois hosts dobra o paralelismo e corta a fila de imagens.
      m.addSource('sat', { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Imagens © Esri, Maxar, Earthstar Geographics',
        tiles: SAT_HOSTS.map((h) => `esri://${h}/{z}/{y}/{x}`) });
      m.addSource('sat-labels', { type: 'raster', tileSize: 256, maxzoom: 19,
        tiles: SAT_HOSTS.map((h) => `https://${h}/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`) });
      m.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: basemapRef.current === 'sat' ? 'visible' : 'none' } });
      // Nomes da Esri (em inglês, fontes misturadas) só de perto; na visão geral, as siglas dos estados.
      m.addLayer({ id: 'sat-labels', type: 'raster', source: 'sat-labels', minzoom: 6, maxzoom: 11, layout: { visibility: basemapRef.current === 'sat' ? 'visible' : 'none' } });
      // Máscara: mundo com o Brasil recortado (contorno do IBGE, public/dados/brasil-mascara.json)
      m.addSource('mascara', { type: 'geojson', data: '/dados/brasil-mascara.json' });
      // A área clara tem ~13 km de folga além da costa (praias e ilhas); a linha é o contorno real.
      m.addLayer({ id: 'mascara', type: 'fill', source: 'mascara', filter: ['==', ['get', 'tipo'], 'mascara'], paint: { 'fill-color': '#05070d', 'fill-opacity': 0.88 } });
      m.addLayer({ id: 'mascara-borda', type: 'line', source: 'mascara', filter: ['==', ['get', 'tipo'], 'contorno'], paint: { 'line-color': '#e2e8f0', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 10, 2] } });
      // Divisas e siglas dos estados (IBGE, public/dados/brasil-ufs.json)
      m.addSource('ufs', { type: 'geojson', data: '/dados/brasil-ufs.json' });
      // Contorno de cada estado em destaque: linha clara contínua sobre uma sombra escura
      // (a sombra garante contraste tanto no satélite claro quanto no escuro).
      m.addLayer({ id: 'uf-divisas-sombra', type: 'line', source: 'ufs', filter: ['!=', ['geometry-type'], 'Point'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#030612', 'line-opacity': 0.6, 'line-blur': 1, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3.2, 9, 5.5] } });
      m.addLayer({ id: 'uf-divisas', type: 'line', source: 'ufs', filter: ['!=', ['geometry-type'], 'Point'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#f8fafc', 'line-opacity': 0.92, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 9, 2.6] } });
      m.addLayer({ id: 'uf-siglas', type: 'symbol', source: 'ufs', filter: ['==', ['geometry-type'], 'Point'], maxzoom: 7,
        layout: { 'text-field': ['get', 'uf'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 6, 15], 'text-letter-spacing': 0.12, 'text-allow-overlap': true },
        paint: { 'text-color': '#ffffff', 'text-opacity': 0.7, 'text-halo-color': 'rgba(3,6,18,0.85)', 'text-halo-width': 1.4 } });
      m.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      m.addLayer({
        id: 'heat', type: 'heatmap', source: 'orelhoes', maxzoom: 14,
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['case', ['has', 'point_count'], ['min', ['/', ['get', 'point_count'], 12], 1], 0.6],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 1, 10, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 14, 10, 30],
          'heatmap-opacity': 0.85,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.15, '#1e3a8a', 0.35, '#7c3aed', 0.55, '#ec4899', 0.75, '#f97316', 1, '#fde047'],
        },
      });

      m.addLayer({
        id: 'cluster-glow', type: 'circle', source: 'orelhoes', filter: ['has', 'point_count'], minzoom: UF_ZOOM,
        paint: {
          'circle-color': COR_CLUSTER, 'circle-opacity': 0.22,
          'circle-radius': ['step', ['get', 'point_count'], 19, 25, 23, 100, 28, 400, 34],
        },
      });
      m.addLayer({
        id: 'confirmado-pulso-grupo', type: 'circle', source: 'orelhoes', minzoom: UF_ZOOM,
        filter: ['all', ['has', 'point_count'], ['>', ['get', 'confirmados'], 0]],
        paint: { 'circle-color': PULSO_COR, 'circle-opacity': 0.35, 'circle-blur': 0.35, 'circle-radius': RAIO_GRUPO,
          'circle-stroke-width': 2, 'circle-stroke-color': PULSO_COR, 'circle-stroke-opacity': 0.8 },
      });
      m.addLayer({
        id: 'clusters', type: 'circle', source: 'orelhoes', filter: ['has', 'point_count'], minzoom: UF_ZOOM,
        paint: {
          'circle-color': COR_CLUSTER, 'circle-radius': RAIO_CLUSTER,
          'circle-stroke-width': 2, 'circle-stroke-color': 'rgba(3,6,18,0.75)',
        },
      });
      m.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'orelhoes', filter: ['has', 'point_count'], minzoom: UF_ZOOM,
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONT, 'text-size': ['step', ['get', 'point_count'], 11, 100, 12, 400, 13], 'text-allow-overlap': true },
        paint: { 'text-color': '#0b1020' },
      });

      // Longe: círculos baratos. Perto: a logo. Evita milhares de símbolos na visão nacional.
      m.addLayer({
        id: 'point-dots', type: 'circle', source: 'orelhoes', filter: ['!', ['has', 'point_count']], maxzoom: ICON_ZOOM,
        paint: {
          'circle-color': REGION_COLOR, 'circle-radius': 4,
          'circle-stroke-width': 1.2, 'circle-stroke-color': ['case', ['==', ['get', 'origem'], 'estimada'], '#ef4444', '#0b1020'],
        },
      });
      m.addLayer(camadaPulso('confirmado-pulso', 'orelhoes'));
      m.addLayer({
        id: 'point-ring', type: 'circle', source: 'orelhoes', filter: ['!', ['has', 'point_count']], minzoom: ICON_ZOOM,
        paint: {
          'circle-color': 'rgba(0,0,0,0)',
          'circle-radius': raioAnel(testeRef.current),
          'circle-stroke-width': 2.5,
          'circle-stroke-color': ['case', ['==', ['get', 'confirmado'], true], PULSO_COR, ['==', ['get', 'origem'], 'estimada'], '#ef4444', REGION_COLOR],
        },
      });
      m.addLayer({
        id: 'points', type: 'symbol', source: 'orelhoes', filter: ['!', ['has', 'point_count']], minzoom: ICON_ZOOM,
        layout: { 'icon-image': icone(testeRef.current), 'icon-size': tamIcone(testeRef.current), 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      });
      m.addLayer({
        id: 'point-labels', type: 'symbol', source: 'orelhoes', filter: ['!', ['has', 'point_count']], minzoom: 13,
        layout: { 'text-field': ['get', 'localidade'], 'text-font': FONT, 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top' },
        paint: { 'text-color': '#e2e8f0', 'text-halo-color': '#0b1020', 'text-halo-width': 1.5 },
      });

      m.addLayer({
        id: 'selected-pulse', type: 'circle', source: 'selected',
        paint: { 'circle-color': '#fbbf24', 'circle-radius': 26, 'circle-opacity': 0.22, 'circle-stroke-width': 3, 'circle-stroke-color': '#fbbf24' },
      });

      m.on('click', 'clusters', async (e) => {
        const f = e.features[0];
        const zoom = await m.getSource('orelhoes').getClusterExpansionZoom(f.properties.cluster_id);
        m.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.3, duration: 700 });
      });
      m.on('click', 'points', (e) => cb.current.onSelect(e.features[0].properties.id));
      m.on('mouseenter', 'points', (e) => {
        m.getCanvas().style.cursor = 'pointer';
        const p = e.features[0].properties;
        popup.current.setLngLat(e.features[0].geometry.coordinates)
          .setHTML(`<strong>${p.localidade}</strong><span>${p.municipio} · ${p.uf}</span>`).addTo(m);
      });
      m.on('mouseleave', 'points', () => { m.getCanvas().style.cursor = ''; popup.current.remove(); });
      m.on('mouseenter', 'clusters', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'clusters', () => (m.getCanvas().style.cursor = ''));

      if (basemapRef.current === 'sat') baseLayers.current.forEach((l) => m.getLayer(l) && m.setLayoutProperty(l, 'visibility', 'none'));

      loaded.current = true;
      setPronto(true);
      onReady?.();
    });
    return () => m.remove();
  }, []);

  // Dados
  // (com um estado escolhido no selo, só os orelhões dele entram nos grupos)
  const [ufFiltro, setUfFiltro] = useState(null);
  const filtroUf = useRef(null);
  // Estado em foco (escolhido no painel ou no selo) que tem macrorregiões: enquanto nenhuma
  // região for escolhida, os orelhões dele ficam "dentro" dos cards das regiões.
  const foco = ufFoco || ufFiltro;
  const infoReg = mode === 'cluster' && foco ? regioes?.[foco] ?? null : null;
  const nosCards = !!infoReg && !macro && selected?.uf?.toUpperCase() !== foco;
  // avisa o Home qual estado está em foco (ele carrega as regiões desse estado sob demanda)
  // (também avisa quando sai do estado: null)
  useEffect(() => { onFoco?.(foco || null); }, [foco, onFoco]);
  useEffect(() => {
    const visiveis = nosCards ? [] : ufFiltro ? points.filter((p) => p.uf?.toUpperCase() === ufFiltro) : points;
    pending.current = visiveis;
    if (loaded.current) map.current.getSource('orelhoes')?.setData(toGeoJSON(visiveis));
  }, [points, ufFiltro, nosCards]);

  // Macrorregiões: áreas coloridas + um card por região com o total de orelhões
  useEffect(() => {
    const m = map.current;
    if (!m || !pronto) return;
    const VAZIO = { type: 'FeatureCollection', features: [] };
    if (!m.getSource('regioes-uf')) {
      m.addSource('regioes-uf', { type: 'geojson', data: VAZIO });
      const soRegiao = ['==', ['get', 'tipo'], 'regiao'];
      const soDivisa = ['==', ['get', 'tipo'], 'divisa'];
      const largura = (a, b) => ['interpolate', ['linear'], ['zoom'], 5, a, 10, b];
      // áreas coloridas; divisas entre regiões numa linha só, suave, clara com sombra
      m.addLayer({ id: 'regioes-fill', type: 'fill', source: 'regioes-uf', filter: soRegiao, paint: { 'fill-color': ['get', 'cor'], 'fill-opacity': 0.2 } }, 'heat');
      m.addLayer({ id: 'regioes-divisa-sombra', type: 'line', source: 'regioes-uf', filter: soDivisa,
        layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#030612', 'line-opacity': 0.55, 'line-blur': 1.5, 'line-width': largura(4, 7) } }, 'heat');
      m.addLayer({ id: 'regioes-divisa', type: 'line', source: 'regioes-uf', filter: soDivisa,
        layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#f8fafc', 'line-opacity': 0.9, 'line-width': largura(1.6, 3) } }, 'heat');
      // contorno colorido só da região escolhida
      m.addLayer({ id: 'regioes-linha', type: 'line', source: 'regioes-uf', filter: soRegiao,
        layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'cor'], 'line-width': largura(2, 3.5), 'line-opacity': 0 } }, 'heat');
    }
    m.getSource('regioes-uf').setData(infoReg?.geo || VAZIO);
    m.setPaintProperty('regioes-fill', 'fill-opacity', macro ? ['case', ['==', ['get', 'nome'], macro], 0.26, 0.05] : 0.2);
    m.setPaintProperty('regioes-linha', 'line-opacity', macro ? ['case', ['==', ['get', 'nome'], macro], 1, 0] : 0);
    if (!infoReg) return;
    // Pop-up: abre ao passar o mouse e fica aberto enquanto o mouse estiver no card OU no pop-up;
    // ao sair, espera um pouco antes de fechar (dá tempo de levar o mouse até a lista).
    let abertoEl = null, timer = null;
    const abrir = (el) => {
      clearTimeout(timer);
      if (abertoEl && abertoEl !== el) abertoEl.classList.remove('aberto');
      el.classList.toggle('esq', el.getBoundingClientRect().right + 390 > window.innerWidth);
      el.classList.add('aberto'); abertoEl = el;
    };
    const fecharDepois = (el) => {
      clearTimeout(timer);
      timer = setTimeout(() => { el.classList.remove('aberto'); if (abertoEl === el) abertoEl = null; }, 600);
    };
    const marc = infoReg.cards.map((c) => {
      const el = document.createElement('div');
      el.className = `reg-card${macro === c.nome ? ' on' : macro ? ' apagado' : ''}`;
      el.style.setProperty('--c', c.cor);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = macro === c.nome ? 'Mostrar todas as regiões' : `Mostrar só a região ${c.nome}`;
      btn.innerHTML = `<i></i><span><b></b><small></small></span><em></em>`;
      btn.querySelector('b').textContent = c.nome;
      btn.querySelector('small').textContent = `${c.nMun} ${c.nMun === 1 ? 'município' : 'municípios'}`;
      btn.querySelector('em').textContent = c.n.toLocaleString('pt-BR');
      btn.disabled = !c.n;
      btn.addEventListener('click', () => cb.current.onMacro?.(foco, macro === c.nome ? null : c.nome));
      el.append(btn);
      // Pop-up ao passar o mouse: todos os municípios da região (os com orelhão em destaque)
      const pop = document.createElement('div');
      pop.className = 'reg-pop';
      const tit = document.createElement('div');
      tit.className = 'reg-pop-tit';
      // só os municípios que têm orelhão
      const comOrelhao = c.municipios.filter((mu) => mu.n && mu.filtro);
      tit.textContent = `${c.nome} · ${comOrelhao.length} ${comOrelhao.length === 1 ? 'município' : 'municípios'} com orelhão`;
      const ul = document.createElement('ul');
      for (const mu of comOrelhao) {
        const li = document.createElement('li');
        if (mu.n && mu.filtro) {
          // com orelhão: clicável, mostra só os orelhões deste município
          li.className = 'tem';
          const bt = document.createElement('button');
          bt.type = 'button';
          bt.title = `Ver só os orelhões de ${mu.nome}`;
          bt.textContent = mu.nome;
          const s = document.createElement('b');
          s.textContent = mu.n;
          bt.append(s);
          bt.addEventListener('click', (e) => { e.stopPropagation(); cb.current.onMunicipio?.(foco, c.nome, mu.filtro); });
          li.append(bt);
        } else li.textContent = mu.nome;
        ul.append(li);
      }
      pop.append(tit, ul);
      el.append(pop);
      // rolar a lista do pop-up não dá zoom no mapa
      pop.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      // arrastar/clicar dentro do pop-up não move o mapa
      ['mousedown', 'touchstart', 'dblclick'].forEach((ev) => pop.addEventListener(ev, (e) => e.stopPropagation()));
      // (card perto da borda direita da tela: o pop-up abre para a esquerda — ver abrir())
      if (comOrelhao.length) {
        el.addEventListener('mouseenter', () => abrir(el));
        el.addEventListener('mouseleave', () => fecharDepois(el));
      }
      return new maplibregl.Marker({ element: el }).setLngLat(c.centro).addTo(m);
    });
    // Na visão do país ficam os selos dos estados; os cards só aparecem de perto.
    const vis = () => { const on = m.getZoom() >= UF_ZOOM - 0.3; marc.forEach((x) => { x.getElement().style.display = on ? '' : 'none'; }); };
    vis();
    m.on('zoom', vis);
    return () => { clearTimeout(timer); m.off('zoom', vis); marc.forEach((x) => x.remove()); };
  }, [infoReg, foco, macro, pronto]);

  // Mapa base
  useEffect(() => {
    const m = map.current;
    const apply = () => {
      const sat = basemap === 'sat';
      const vis = (id, on) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      ['sat', 'sat-labels'].forEach((l) => vis(l, sat));
      // No satélite as camadas vetoriais somem: sem elas o MapLibre nem baixa esses tiles.
      baseLayers.current.forEach((l) => vis(l, !sat));
    };
    if (loaded.current) apply(); else m?.once('load', apply);
  }, [basemap]);

  // Modo de visualização
  useEffect(() => {
    const m = map.current;
    const apply = () => {
      const vis = (id, on) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      const heat = mode === 'heat';
      vis('heat', heat);
      ['clusters', 'cluster-glow', 'cluster-count', 'confirmado-pulso-grupo'].forEach((l) => vis(l, mode === 'cluster'));
      ['points', 'point-ring', 'point-dots', 'point-labels'].forEach((l) => vis(l, !heat));
      if (mode === 'points') {
        // reaproveita a fonte sem cluster: mostra os pontos dentro de clusters via camada auxiliar
        if (!m.getSource('raw')) {
          m.addSource('raw', { type: 'geojson', data: toGeoJSON(pending.current) });
          m.addLayer({
            id: 'raw-dots', type: 'circle', source: 'raw', maxzoom: ICON_ZOOM,
            paint: { 'circle-color': REGION_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.2, ICON_ZOOM, 5], 'circle-stroke-width': 0.5, 'circle-stroke-color': '#0b1020' },
          }, 'selected-pulse');
          m.addLayer(camadaPulso('confirmado-pulso-raw', 'raw'), 'selected-pulse');
          m.addLayer({
            id: 'raw-points', type: 'symbol', source: 'raw', minzoom: ICON_ZOOM,
            layout: { 'icon-image': icone(testeRef.current), 'icon-size': tamIcone(testeRef.current), 'icon-allow-overlap': true, 'icon-ignore-placement': true },
          }, 'selected-pulse');
          ['raw-points', 'raw-dots'].forEach((l) => {
            m.on('click', l, (e) => cb.current.onSelect(e.features[0].properties.id));
            m.on('mouseenter', l, () => (m.getCanvas().style.cursor = 'pointer'));
            m.on('mouseleave', l, () => (m.getCanvas().style.cursor = ''));
          });
        } else m.getSource('raw').setData(toGeoJSON(pending.current));
        ['raw-points', 'raw-dots', 'confirmado-pulso-raw'].forEach((l) => vis(l, true));
        ['points', 'point-ring', 'point-dots', 'confirmado-pulso'].forEach((l) => vis(l, false));
      } else {
        ['raw-points', 'raw-dots', 'confirmado-pulso-raw'].forEach((l) => vis(l, false));
        vis('confirmado-pulso', !heat);
      }
    };
    if (loaded.current) apply(); else map.current?.once('load', apply);
  }, [mode, points]);

  // Selos dos estados: bandeira + total de TUPs, só no modo agrupado e na visão do país
  const ufPontos = useRef(null);
  // Fora do modo agrupado, ou se o usuário escolher outro lugar, o filtro por estado sai
  useEffect(() => { if (mode !== 'cluster') { filtroUf.current = null; setUfFiltro(null); } }, [mode]);
  useEffect(() => {
    const f = filtroUf.current;
    if (f && selected && selected.uf?.toUpperCase() !== f.uf) { filtroUf.current = null; setUfFiltro(null); }
  }, [selected]);
  useEffect(() => {
    if (flyTarget?.bounds) { filtroUf.current = null; setUfFiltro(null); }
  }, [flyTarget]);
  useEffect(() => {
    const m = map.current;
    if (!m || !pronto) return;
    let vivo = true;
    const marcadores = [];
    let ligado = null;
    const seloFora = teste ? SELO_FORA_TESTE : SELO_FORA;
    const filasFora = teste ? FILAS_FORA_TESTE : FILAS_FORA;
    const atualizar = () => {
      const zoom = m.getZoom();
      const ligar = mode === 'cluster' && zoom < UF_ZOOM;
      if (ligar !== ligado) {
        ligado = ligar;
        marcadores.forEach((x) => { x.el.style.display = ligar ? '' : 'none'; });
        if (m.getLayer('uf-siglas')) m.setLayoutProperty('uf-siglas', 'visibility', ligar ? 'none' : 'visible');
      }
      // Filas do litoral: do norte para o sul, cada selo fica ao menos SELO_ESPACO abaixo do anterior;
      // depois a fila toda é recentrada para ficar o mais perto possível dos seus estados.
      if (ligar) {
        for (const fila of filasFora) {
          const itens = marcadores.filter((x) => fila.includes(x.uf)).map((x) => ({ x, y: m.project(x.lngLat).y })).sort((a, b) => a.y - b.y);
          if (!itens.length) continue;
          let alvo = -Infinity;
          for (const it of itens) { alvo = Math.max(it.y, alvo + SELO_ESPACO); it.alvo = alvo; }
          const media = itens.reduce((s, it) => s + (it.alvo - it.y), 0) / itens.length;
          for (const { x, y, alvo: a } of itens) {
            const dy = a - media - y;
            x.marker.setOffset([x.dx, dy]);
            x.liga.style.width = `${Math.hypot(x.dx, dy)}px`;
            x.liga.style.transform = `rotate(${Math.atan2(-dy, -x.dx)}rad)`;
          }
        }
      }
      // Filtro por estado (clique no selo): ao voltar para a visão do país, mostra todos de novo.
      const f = filtroUf.current;
      if (f) {
        if (!ligar) f.entrou = true;
        else if (f.entrou) { filtroUf.current = null; setUfFiltro(null); }
      }
    };
    (async () => {
      ufPontos.current ??= fetch('/dados/brasil-ufs.json').then((r) => r.json()).catch(() => null);
      const geo = await ufPontos.current;
      if (!vivo || !geo || map.current !== m) return;
      const total = {}; const caixa = {};
      for (const p of points) {
        const uf = p.uf?.toUpperCase();
        if (!uf) continue;
        total[uf] = (total[uf] || 0) + 1;
        const c = (caixa[uf] ??= { w: p.lng, e: p.lng, s: p.lat, n: p.lat });
        c.w = Math.min(c.w, p.lng); c.e = Math.max(c.e, p.lng); c.s = Math.min(c.s, p.lat); c.n = Math.max(c.n, p.lat);
      }
      for (const f of geo.features) {
        if (f.geometry.type !== 'Point') continue;
        const uf = f.properties.uf;
        if (!total[uf]) continue;
        const el = document.createElement('div');
        el.className = 'uf-selo';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = `${uf}: ${total[uf].toLocaleString('pt-BR')} orelhões`;
        const sigla = document.createElement('span');
        sigla.className = 'uf-sigla'; sigla.textContent = uf;
        const img = document.createElement('img');
        img.src = `/bandeiras/${uf.toLowerCase()}.png`; img.alt = uf; img.draggable = false;
        const n = document.createElement('b');
        n.textContent = total[uf].toLocaleString('pt-BR');
        btn.append(sigla, img, n);
        el.append(btn);
        btn.addEventListener('click', () => {
          const c = caixa[uf];
          if (enq.current.livre !== ENQUADRAMENTO) m.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); // mesma razão do fitBounds
          const cam = m.cameraForBounds([[c.w, c.s], [c.e, c.n]], { padding: enq.current.painel });
          // só os orelhões deste estado: os grupos passam a ser calculados só com eles
          filtroUf.current = { uf, entrou: false };
          setUfFiltro(uf);
          // nunca abaixo de UF_ZOOM: senão os selos voltariam e o estado não se abriria em grupos
          // Com margens próprias (teste): centraliza o estado na área livre (ao lado ou acima do painel).
          // O centro do cameraForBounds só vale para o zoom dele; quando o zoom mínimo entra, o estado
          // fugiria da área livre — por isso usa o centro do estado + as margens no próprio movimento.
          if (cam && enq.current.livre !== ENQUADRAMENTO) m.easeTo({ center: [(c.w + c.e) / 2, (c.s + c.n) / 2], zoom: Math.max(cam.zoom, UF_ZOOM + 0.2), padding: enq.current.painel, duration: 1000 });
          else if (cam) m.easeTo({ center: cam.center, zoom: Math.max(cam.zoom, UF_ZOOM + 0.2), duration: 1000 });
        });
        const dx = seloFora[uf];
        let liga = null;
        if (dx) {
          // linha do selo (deslocado) de volta ao centro do estado; posição e ângulo em atualizar()
          liga = document.createElement('i');
          liga.className = 'uf-liga';
          el.append(liga);
        }
        const lngLat = f.geometry.coordinates;
        marcadores.push({ el, uf, dx, liga, lngLat, marker: new maplibregl.Marker({ element: el, offset: dx ? [dx, 0] : undefined }).setLngLat(lngLat).addTo(m) });
      }
      atualizar();
    })();
    m.on('zoom', atualizar);
    return () => { vivo = false; m.off('zoom', atualizar); marcadores.forEach((x) => x.marker.remove()); if (m.getLayer('uf-siglas')) m.setLayoutProperty('uf-siglas', 'visibility', 'visible'); };
  }, [points, mode, pronto, teste]);

  // Selecionado
  useEffect(() => {
    if (!loaded.current) return;
    const src = map.current.getSource('selected');
    src.setData({ type: 'FeatureCollection', features: selected ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [selected.lng, selected.lat] }, properties: {} }] : [] });

    // Pulso piscando: animação em CSS num marcador HTML, sem redesenhar o mapa a cada quadro.
    if (!selected) { pulseMarker.current?.remove(); return; }
    if (!pulseMarker.current) {
      const el = document.createElement('div');
      el.className = 'sel-pulse';
      el.innerHTML = '<i></i><i></i>';
      pulseMarker.current = new maplibregl.Marker({ element: el });
    }
    pulseMarker.current.getElement().classList.toggle('vermelho', confirmado(selected));
    pulseMarker.current.setLngLat([selected.lng, selected.lat]).addTo(map.current);
  }, [selected, pronto]);

  // Pulso vermelho constante dos orelhões confirmados: o anel cresce e some (1,6 s), ~25 quadros/s.
  // Só anima com orelhão confirmado na lista e com zoom em que os ícones aparecem.
  const temConfirmado = points.some(confirmado);
  useEffect(() => {
    const m = map.current;
    if (!m || !pronto || !temConfirmado) return;
    const r0 = escalaTeste(testeRef.current, 13), r1 = escalaTeste(testeRef.current, 22);
    let raf, ultimo = 0, conferido = 0, naTela = true;
    const CAMADAS = ['confirmado-pulso', 'confirmado-pulso-raw', 'confirmado-pulso-grupo'];
    const passo = (agora) => {
      raf = requestAnimationFrame(passo);
      if (agora - ultimo < 40 || m.getZoom() < UF_ZOOM) return;
      // a cada meio segundo confere se há algum confirmado na tela (senão não redesenha à toa)
      if (agora - conferido > 500) {
        conferido = agora;
        const ls = CAMADAS.filter((id) => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none');
        try { naTela = ls.length > 0 && m.queryRenderedFeatures({ layers: ls }).length > 0; } catch { naTela = true; }
      }
      if (!naTela) return;
      ultimo = agora;
      const t = (agora % 1600) / 1600;
      const k = 1 + t * 1.2;
      const raio = ['interpolate', ['linear'], ['zoom'], ICON_ZOOM, r0 * k, 16, r1 * k];
      if (m.getLayer('confirmado-pulso-grupo')) {
        m.setPaintProperty('confirmado-pulso-grupo', 'circle-radius', ['*', 1 + t * 0.9, RAIO_GRUPO]);
        m.setPaintProperty('confirmado-pulso-grupo', 'circle-opacity', 0.5 * (1 - t));
        m.setPaintProperty('confirmado-pulso-grupo', 'circle-stroke-opacity', 0.9 * (1 - t));
      }
      for (const id of ['confirmado-pulso', 'confirmado-pulso-raw']) {
        if (!m.getLayer(id)) continue;
        m.setPaintProperty(id, 'circle-radius', raio);
        m.setPaintProperty(id, 'circle-opacity', 0.5 * (1 - t));
        m.setPaintProperty(id, 'circle-stroke-opacity', 0.9 * (1 - t));
      }
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [pronto, temConfirmado]);

  // Edição de posição: clique no mapa ou arraste o pino
  const draftMarker = useRef(null);
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  useEffect(() => {
    const m = map.current;
    if (!m || !editing) return;
    m.getCanvas().style.cursor = 'crosshair';
    const click = (e) => onDraftRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    m.on('click', click);
    return () => { m.off('click', click); m.getCanvas().style.cursor = ''; };
  }, [editing]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!editing || !draft) { draftMarker.current?.remove(); draftMarker.current = null; return; }
    if (!draftMarker.current) {
      const el = document.createElement('div');
      el.className = 'draft-pin';
      el.innerHTML = '<i></i>';
      draftMarker.current = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
        .setLngLat([draft.lng, draft.lat]).addTo(m);
      draftMarker.current.on('dragend', () => { const { lat, lng } = draftMarker.current.getLngLat(); onDraftRef.current?.({ lat, lng }); });
    } else draftMarker.current.setLngLat([draft.lng, draft.lat]);
  }, [editing, draft]);

  // Órbita ao redor do ponto selecionado
  useEffect(() => {
    const m = map.current;
    if (!orbit || !m) return;
    let raf, last;
    const step = (t) => {
      last ??= t;
      m.setBearing(m.getBearing() + ((t - last) / 1000) * 12);
      last = t;
      raf = requestAnimationFrame(step);
    };
    const stop = () => onOrbitStop?.();
    // A inclinação vive só aqui: mapa inclinado puxa tiles até o horizonte.
    m.easeTo({ pitch: 55, duration: 900 });
    const start = setTimeout(() => { raf = requestAnimationFrame(step); }, 1200);
    m.on('dragstart', stop); m.on('wheel', stop); m.on('touchstart', stop);
    return () => {
      clearTimeout(start); cancelAnimationFrame(raf);
      m.off('dragstart', stop); m.off('wheel', stop); m.off('touchstart', stop);
      if (map.current === m) m.easeTo({ pitch: 0, duration: 600 });
    };
  }, [orbit]);

  // Voar para
  useEffect(() => {
    if (!flyTarget || !map.current) return;
    if (memoria) { if (memoria.current.fly === flyTarget) return; memoria.current.fly = flyTarget; } // recriado: não refaz o voo
    const m = map.current;
    // o voo até um orelhão deixa a margem do painel gravada no mapa; ela se somaria a esta
    if (flyTarget.bounds && enquadramento) m.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    if (flyTarget.bounds) { m.fitBounds(flyTarget.bounds, { padding: flyTarget.livre ? enq.current.livre : enq.current.painel, duration: 1400, maxZoom: flyTarget.maxZoom ?? 11 }); return; }
    let cancelado = false;
    const voar = (zoom) => !cancelado && m.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom, pitch: flyTarget.pitch ?? 45, bearing: flyTarget.bearing ?? -15, duration: 2200, essential: true, padding: enq.current.voo });
    // comFoto: para no maior zoom em que a Esri tem foto naquele ponto (no máximo flyTarget.zoom)
    if (flyTarget.comFoto) zoomComFoto(flyTarget.lat, flyTarget.lng, { max: flyTarget.zoom ?? 17 }).then(voar);
    else voar(flyTarget.zoom ?? 13);
    return () => { cancelado = true; };
  }, [flyTarget]);

  // Posição do usuário
  useEffect(() => {
    if (!userPos || !map.current) return;
    if (!userMarker.current) {
      const el = document.createElement('div');
      el.className = 'user-dot';
      userMarker.current = new maplibregl.Marker({ element: el });
    }
    userMarker.current.setLngLat([userPos.lng, userPos.lat]).addTo(map.current);
  }, [userPos]);

  return <div ref={ref} className="map" />;
}
