'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchOrelhoes, fetchProximos, atualizarOrelhao, marcarPosicao, fetchVista } from '@/lib/supabase';
import { useFotos, FotosEditor, VisorFotos } from '@/components/Fotos';
import FotoMunicipio, { BrasaoMunicipio, useImagemMunicipio } from '@/components/FotoMunicipio';
import { REGIOES, COR_REGIAO, UF_NOME, norm, haversine, fmt, bounds, destino, confirmado } from '@/lib/geo';
import { MARCA_PENDENTE, TEM_STREET_VIEW_PROPRIO, linkRua } from '@/lib/marcar';
import TvRua, { TV_RUA_MS } from '@/components/TvRua';
import InstalarApp from '@/components/InstalarApp';
// gerador de propostas (Administração): carregado só quando for aberto (inclui o gerador de Word)
const Propostas = dynamic(() => import('@/components/Propostas'), { ssr: false });
const AcaoTups = dynamic(() => import('@/components/AcaoTups'), { ssr: false });
const FerramentaSdr = dynamic(() => import('@/components/FerramentaSdr'), { ssr: false });

const ALTURA_CAMERA = 2.5; // metros, câmera do carro do Street View

// Campos de texto editáveis na ficha do orelhão: [coluna, rótulo, monoespaçado]
const CAMPOS = [
  ['cod_localidade', 'Cód. localidade', true],
  ['cod_ibge', 'Cód. IBGE 2022', true],
  ['status', 'Status', false],
  ['cod_tup', 'Cód. TUP', true],
];
const STATUS_SUGERIDOS = ['Ativo', 'Inativo', 'Danificado', 'Em manutenção', 'Removido', 'Não localizado'];

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

function useCountUp(target, ms = 1200) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf, start;
    const from = 0;
    const step = (t) => {
      start ??= t;
      const k = Math.min((t - start) / ms, 1);
      setV(Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Stat({ label, value, accent }) {
  const v = useCountUp(value);
  return (
    <div className="stat" style={{ '--accent': accent }}>
      <span className="stat-value">{fmt(v)}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function PhoneIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10a8 8 0 0 1 16 0v1H4v-1Z" fill="currentColor" opacity=".9" />
      <rect x="9" y="11" width="6" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 19v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

// ---- Cartão com os dados da comunidade (IBGE + OpenStreetMap) ----
const SITUACAO = { Rural: 'área rural', Urbana: 'área urbana' };
const distTxt = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`);
const PISO = { pavimentada: 'asfalto / pavimentada', terra: 'terra / cascalho', '?': 'piso não informado' };

function Acesso({ a }) {
  if (!a) return <p className="loc-acesso-vazio">Meio de acesso: ainda não calculado.</p>;
  const linhas = [];
  if (a.estrada) linhas.push(`🛣 ${a.estrada.desc}${a.estrada.nome ? ` (${a.estrada.nome})` : ''} a ${distTxt(a.estrada.m / 1000)} · ${PISO[a.estrada.piso] || PISO['?']}`);
  if (a.rio) linhas.push(`🛶 ${a.rio.nome || 'Rio / curso d’água'} a ${distTxt(a.rio.m / 1000)}`);
  if (a.aero) linhas.push(`✈ ${a.aero.nome || 'Pista de pouso'} a ${distTxt(a.aero.m / 1000)}`);
  return (
    <div className="loc-acesso">
      <span>Meio de acesso (estimado)</span>
      <b>{a.resumo}</b>
      {linhas.map((l) => <small key={l}>{l}</small>)}
    </div>
  );
}

// Prefeito e contato da prefeitura (em teste): public/dados/prefeituras/<UF>.json
// (prefeito: TSE — eleitos em 2024 e suplementares — conferido com a Wikipédia, que é mantida quando
//  traz mudança mais recente, ex.: vice que assumiu; telefone: site oficial da prefeitura).
const ano = (s) => +((s || '').match(/\b(19|20)\d{2}\b/)?.[0] || 0);
function Prefeitura({ f }) {
  if (!f) return null;
  let o = f.oficial;
  if (!o && f.prefeito) { // dados antigos, só Wikipédia: mandato vencido (até 2024) não aparece
    const fim = ano(f.fim), inicio = ano(f.inicio);
    const vencido = (fim && fim < 2025) || (!fim && inicio && inicio < 2021);
    if (!vencido) o = { nome: f.prefeito, obs: fim ? `mandato até ${fim}` : inicio ? `desde ${inicio}` : '', fonte: 'Wikipédia' };
  }
  if (!(o || f.telefone || f.site)) return null;
  return (
    <div className="loc-pref">
      {o ? <>
        <span>Prefeito(a)</span>
        <b>{o.nome}{o.partido && <em className="loc-partido"> · {o.partido}</em>}</b>
        <small>{[o.obs, `fonte: ${o.fonte}`].filter(Boolean).join(' · ')}</small>
      </> : <span>Prefeitura</span>}
      {f.telefone && <a className="loc-tel" href={`tel:+55${f.telefone.replace(/\D/g, '')}`}>📞 {f.telefone}</a>}
      {f.site && <a className="loc-site" href={f.site} target="_blank" rel="noreferrer">Site da prefeitura ↗</a>}
    </div>
  );
}

function DadosLocalidade({ d, a, carregando, p, pref }) {
  if (carregando) return <div className="loc-card"><small>Carregando dados do IBGE…</small></div>;
  if (!d) return null;
  return (
    <div className="loc-card">
      <div className="loc-titulo">Dados da localidade</div>
      {d.est && <p className="loc-aviso">⚠ Coordenada estimada: estes dados podem ser de outro ponto do município.</p>}
      <div className="loc-grid">
        <div>
          <span>Habitantes no setor</span>
          <b>{d.pop != null ? fmt(d.pop) : '—'}</b>
          <small>{d.dom != null ? `${fmt(d.dom)} domicílios` : ''}{d.sit ? ` · ${SITUACAO[d.sit] || d.sit}` : ''}</small>
        </div>
        <div>
          <span>Distância da sede</span>
          <b>{d.sede_km != null ? distTxt(d.sede_km) : '—'}</b>
          <small>em linha reta{d.sede ? ` · ${d.sede}` : ''}</small>
        </div>
        <div>
          <span>Habitantes do município</span>
          <b>{d.mun_pop ? fmt(d.mun_pop) : '—'}</b>
          <small>Censo 2022</small>
          <Prefeitura f={pref} />
        </div>
        <div>
          <span>Localidade IBGE mais próxima</span>
          <b className="loc-nome">{d.ibge_loc?.nome || '—'}</b>
          <small>{d.ibge_loc ? `${d.ibge_loc.tipo || 'localidade'} · ${distTxt(d.ibge_loc.km)}` : ''}</small>
        </div>
      </div>
      {d.aglom && <small className="loc-aglom">Aglomerado no Censo: <b>{d.aglom}</b></small>}
      <Acesso a={a} />
      {d.sede_lat != null && (
        <a id="btn-rota-sede" className="btn" target="_blank" rel="noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&origin=${d.sede_lat},${d.sede_lng}&destination=${p.lat},${p.lng}`}>
          🚗 Rota a partir da sede (distância por estrada)
        </a>
      )}
      <small className="loc-fonte">
        Fontes: IBGE — Censo 2022 (setores censitários e localidades){a ? '; acesso: OpenStreetMap' : ''}.
        O setor censitário pode incluir comunidades vizinhas.
      </small>
    </div>
  );
}

// Município -> chave de comparação ("Barra De São Francisco" = "Barra de São Francisco")
const chaveMun = (s = '') => norm(s).replace(/\s+/g, '');

// `regioes`: liga as regiões por pontos cardeais de cada estado (menos DF), em teste em /teste.
// Em teste: margens do mapa com a faixa no alto e o painel (quando aberto) à direita, 400px.
// livre = sem painel (Brasil centralizado na tela); painel/voo = deixando o lado direito para o painel.
const ENQ_TESTE = {
  livre: { top: 96, bottom: 16, left: 16, right: 16 }, // Brasil o maior possível, centralizado abaixo da faixa
  painel: { top: 110, bottom: 50, left: 60, right: 460 },
  voo: { top: 80, left: 0, right: 420 },
};

// regioes: ajustes já aprovados (principal e /teste). novidades: só no /teste, até o usuário aprovar.
// Modo TV (teste): estados percorridos no loop (com orelhões localizados).
// `id`: orelhão fixo daquele estado (senão, um localizado diferente a cada volta).
const TV_ESTADOS = [
  { uf: 'PA', id: 4195 }, // Porto Novo · Santarém (marcado no Street View)
  { uf: 'BA', id: 499 },  // Cabeceira · Vitória da Conquista
  { uf: 'MS', id: 3955 }, // Aldeia Buriti · Dois Irmãos do Buriti
];
// Tempos do roteiro (ms) — no máximo 50 s por estado. O "Na rua" fica em components/TvRua.jsx (TV_RUA_MS).
const TV_TEMPO = {
  brasilAntes: 1000, passeio: 7400, // Brasil: enquadra e faz o passeio em 3D (MapView, ~7,3 s)
  pontos: 3500,                      // depois do giro: mapa de pontos com a frase
  estado: 4000, regiao: 3000,
  letra: 60, aposDigitar: 600,     // pesquisa: velocidade da digitação e pausa antes do Enter
  municipio: 2500,
  orelhaoVoo: 3000, orelhaoGiro: 4500,
  voltando: 2000,
};

// Funções do painel de administração: cada uma abre a sua tela (adminTela = id)
// (cor = cor do cartão; senha = pede a senha do SDR)
const ADMIN_FUNCOES = [
  {
    id: 'propostas', nome: 'Propostas', desc: 'Gerar proposta Word e baixar materiais de apoio', cor: '#5cc3c5', cor2: '#2f9496',
    icone: (
      <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path d="M16 7h22l11 11v36a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" fill="#fff" />
        <path d="M38 7v9a2 2 0 0 0 2 2h9" fill="#cdeeee" />
        <rect x="20" y="15" width="13" height="3" rx="1.5" fill="#2f9496" />
        <rect x="20" y="24" width="23" height="2.4" rx="1.2" fill="#9cc9ca" /><rect x="20" y="30" width="19" height="2.4" rx="1.2" fill="#9cc9ca" />
        <path d="M20 45c3-3 5 2 8-1s4-2 6 0" stroke="#0d3b3c" strokeWidth="2" strokeLinecap="round" />
        <circle cx="41" cy="45" r="6.5" fill="#fbbf24" /><path d="M41 41l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" fill="#fff7d6" />
      </svg>
    ),
  },
  {
    id: 'acao', nome: 'Ação TUPs', desc: 'Painel gerencial da ação comercial: funil, propostas e equipe', cor: '#fbbf24', cor2: '#f97316', senha: true,
    icone: (
      <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <rect x="9" y="9" width="46" height="46" rx="6" fill="#fff" />
        <rect x="16" y="34" width="7" height="14" rx="1.5" fill="#fbbf24" /><rect x="28.5" y="26" width="7" height="22" rx="1.5" fill="#f97316" /><rect x="41" y="18" width="7" height="30" rx="1.5" fill="#0d3b3c" />
        <path d="M16 27l12-8 8 4 12-9" stroke="#2f9496" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="48" cy="14" r="2.6" fill="#2f9496" />
      </svg>
    ),
  },
];

export default function Home({ regioes = false, novidades = false, tv = false }) {
  const [all, setAll] = useState([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [booted, setBooted] = useState(false);

  const [regiao, setRegiao] = useState(null);
  const [uf, setUf] = useState(null);
  const [municipio, setMunicipio] = useState(null);
  const [q, setQ] = useState('');
  const [soOriginais, setSoOriginais] = useState(false);
  const [mode, setMode] = useState('cluster');
  const [tab, setTab] = useState('explorar');
  const [basemap, setBasemap] = useState('sat');
  const [orbit, setOrbit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [marcado, setMarcado] = useState(null); // em teste: de onde veio a marcação ('Street View' | 'Google Earth') aguardando confirmação
  const [erroSalvar, setErroSalvar] = useState(null); // erro mostrado no cartão de confirmação
  const [vistaMarcada, setVistaMarcada] = useState(null); // câmera do Street View no momento da marcação
  const [vistas, setVistas] = useState({}); // em teste: vista guardada no banco por orelhão (migration 007)
  const [camPos, setCamPos] = useState(null); // posição+direção da câmera do Street View
  const [dist, setDist] = useState(12);       // metros à frente da câmera
  const [senha, setSenha] = useState(() => { try { return sessionStorage.getItem('edit_senha') || ''; } catch { return ''; } });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);     // campos editáveis do orelhão
  const [latTxt, setLatTxt] = useState('');
  const [lngTxt, setLngTxt] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [flyTarget, setFlyTarget] = useState(null);
  const [userPos, setUserPos] = useState(null);
  const [proximos, setProximos] = useState(null);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => {
    let loaded = 0;
    fetchOrelhoes((n, total) => { loaded += n; setProgress(Math.round((loaded / total) * 100)); })
      .then((d) => { setAll(d); setTimeout(() => setBooted(true), 450); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement !== searchRef.current) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') { setSelectedId(null); setProximos(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Cada aviso novo reinicia o cronômetro (senão o do aviso anterior apaga o novo antes da hora).
  const toastTimer = useRef(null);
  const notify = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  // Filtros em cascata
  const porRegiao = useMemo(() => (regiao ? all.filter((p) => p.regiao === regiao) : all), [all, regiao]);
  const porUf = useMemo(() => (uf ? porRegiao.filter((p) => p.uf === uf) : porRegiao), [porRegiao, uf]);

  // Macrorregiões do estado (public/dados/regioes/<UF>.json): cada uma vira um card
  // com os seus orelhões; escolhida, o mapa e a lista ficam só com ela.
  const [macro, setMacro] = useState(null); // { uf, nome }
  const [regioesGeo, setRegioesGeo] = useState({});
  // cada estado tem o seu arquivo; só é baixado quando o estado entra em foco
  const pedidosRegioes = useRef(new Set());
  const carregarRegioes = useCallback((u) => {
    if (!regioes || !u || pedidosRegioes.current.has(u)) return;
    pedidosRegioes.current.add(u);
    fetch(`/dados/regioes/${u}.json`).then((r) => (r.ok ? r.json() : null))
      .then((g) => g && setRegioesGeo((x) => ({ ...x, [u]: g }))).catch(() => {});
  }, [regioes]);
  useEffect(() => { carregarRegioes(uf); }, [uf, carregarRegioes]);
  // Estado em foco no mapa (bandeira clicada); null ao sair dele
  const [ufMapa, setUfMapa] = useState(null);
  const onFocoMapa = useCallback((u) => { carregarRegioes(u); setUfMapa(u || null); }, [carregarRegioes]);
  // nome no banco com grafia diferente do IBGE ("Itapagé" -> "Itapajé"): chave do banco -> chave do IBGE
  const apelidoDe = useMemo(() => {
    const m = {};
    for (const [u, g] of Object.entries(regioesGeo)) {
      const x = new Map();
      g.features.forEach((f) => Object.entries(f.properties.apelidos || {}).forEach(([nb, ib]) => x.set(chaveMun(nb), chaveMun(ib))));
      m[u] = x;
    }
    return m;
  }, [regioesGeo]);
  const macroDe = useMemo(() => {
    const m = {};
    for (const [u, g] of Object.entries(regioesGeo)) {
      const x = new Map();
      g.features.forEach((f) => f.properties.tipo === 'regiao' && f.properties.municipios.forEach((mu) => x.set(chaveMun(mu), f.properties.nome)));
      apelidoDe[u]?.forEach((ib, nb) => x.has(ib) && x.set(nb, x.get(ib)));
      m[u] = x;
    }
    return m;
  }, [regioesGeo, apelidoDe]);
  // Em teste: município escolhido pela busca (ou pela lista) num estado com regiões também
  // escolhe a região dele — senão os orelhões ficam escondidos dentro dos cards das regiões.
  useEffect(() => {
    if (!novidades || !municipio || !uf || macro) return;
    const nome = macroDe[uf]?.get(chaveMun(municipio));
    if (nome) setMacro({ uf, nome });
  }, [novidades, municipio, uf, macro, macroDe]);
  // cards das regiões contam os orelhões de `lista` (todos, ou só os localizados no modo "Localizados")
  const montarRegioes = useCallback((lista) => {
    const out = {};
    for (const [u, g] of Object.entries(regioesGeo)) {
      const pts = lista.filter((p) => p.uf === u);
      const porMun = {};
      const nomeNaBase = {}; // grafia do município no banco ("Barra De São Francisco"), usada no filtro
      pts.forEach((p) => {
        const k0 = chaveMun(p.municipio);
        const k = apelidoDe[u]?.get(k0) ?? k0;
        porMun[k] = (porMun[k] || 0) + 1; nomeNaBase[k] = p.municipio;
      });
      const area = Object.fromEntries(g.features.filter((f) => f.properties.tipo === 'regiao').map((f) => [f.properties.nome, f.properties.municipios]));
      const cards = g.features.filter((f) => f.properties.tipo === 'rotulo').map((f) => {
        const ps = pts.filter((p) => macroDe[u]?.get(chaveMun(p.municipio)) === f.properties.nome);
        // todos os municípios da região (para o pop-up do card), com quantos orelhões cada um tem
        const municipios = (area[f.properties.nome] || []).map((m) => ({ nome: m, n: porMun[chaveMun(m)] || 0, filtro: nomeNaBase[chaveMun(m)] || null }))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        return { nome: f.properties.nome, cor: f.properties.cor, centro: f.geometry.coordinates, n: ps.length, nMun: new Set(ps.map((p) => p.municipio)).size, municipios };
      });
      out[u] = { geo: g, cards };
    }
    return out;
  }, [regioesGeo, macroDe, apelidoDe]);
  const regioesInfo = useMemo(() => montarRegioes(all), [montarRegioes, all]);
  const regioesInfoLoc = useMemo(() => montarRegioes(all.filter(confirmado)), [montarRegioes, all]);
  // área de cada estado (todos os orelhões): no modo "Localizados" a bandeira enquadra o estado inteiro
  const caixasUf = useMemo(() => {
    const c = {};
    all.forEach((p) => {
      const u = p.uf?.toUpperCase(); if (!u) return;
      const x = (c[u] ??= { w: p.lng, e: p.lng, s: p.lat, n: p.lat });
      x.w = Math.min(x.w, p.lng); x.e = Math.max(x.e, p.lng); x.s = Math.min(x.s, p.lat); x.n = Math.max(x.n, p.lat);
    });
    return c;
  }, [all]);
  const porMacro = useMemo(() => (macro
    ? porUf.filter((p) => p.uf === macro.uf && macroDe[p.uf]?.get(chaveMun(p.municipio)) === macro.nome)
    : porUf), [porUf, macro, macroDe]);
  useEffect(() => { if (macro && macro.uf !== uf) setMacro(null); }, [uf]); // eslint-disable-line react-hooks/exhaustive-deps

  // Estado clicado no mapa (ou escolhido): a busca fica só dentro dele
  const ufFocoBusca = novidades && !municipio && !macro ? (ufMapa || uf) : null;
  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    const base = porMacro.filter((p) =>
      (mode !== 'localizados' || confirmado(p)) &&
      (!municipio || p.municipio === municipio) &&
      (!soOriginais || p.origem === 'original') &&
      (!nq || !ufFocoBusca || p.uf === ufFocoBusca)
    );
    if (!nq) return base;
    if (!novidades) return base.filter((p) => norm(p.localidade).includes(nq) || norm(p.municipio).includes(nq) || p.cod_localidade?.includes(nq));
    // nome exato primeiro ("Formoso" não traz "Campo Formoso"); sem nome exato, os que começam com o texto
    const exatos = base.filter((p) => norm(p.localidade) === nq || norm(p.municipio) === nq || p.cod_localidade === nq);
    if (exatos.length) return exatos;
    return base.filter((p) => norm(p.localidade).startsWith(nq) || norm(p.municipio).startsWith(nq) || p.cod_localidade?.startsWith(nq));
  }, [porMacro, municipio, soOriginais, q, novidades, ufFocoBusca, mode]);

  // Com uma macrorregião escolhida, a lista vem agrupada por município
  const porMunicipio = useMemo(() => {
    if (!macro && !(novidades && municipio)) return [];
    const g = new Map();
    filtered.forEach((p) => g.set(p.municipio, [...(g.get(p.municipio) || []), p]));
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [filtered, macro, novidades, municipio]);

  const ufs = useMemo(() => {
    const c = {};
    porRegiao.forEach((p) => (c[p.uf] = (c[p.uf] || 0) + 1));
    return Object.entries(c).sort((a, b) => a[0].localeCompare(b[0]));
  }, [porRegiao]);

  const municipios = useMemo(() => {
    if (!uf) return [];
    const c = {};
    porMacro.forEach((p) => (c[p.municipio] = (c[p.municipio] || 0) + 1));
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [porMacro, uf]);

  const stats = useMemo(() => ({
    total: filtered.length,
    municipios: new Set(filtered.map((p) => p.uf + p.municipio)).size,
    ufs: new Set(filtered.map((p) => p.uf)).size,
    estimados: filtered.filter((p) => p.origem === 'estimada').length,
  }), [filtered]);

  const porRegiaoStats = useMemo(() => REGIOES.map((r) => ({ ...r, n: all.filter((p) => p.regiao === r.id).length })), [all]);
  const topUfs = useMemo(() => {
    const c = {};
    all.forEach((p) => (c[p.uf] = (c[p.uf] || 0) + 1));
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [all]);
  const topMunicipios = useMemo(() => {
    const c = {};
    filtered.forEach((p) => { const k = `${p.municipio} · ${p.uf}`; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [filtered]);

  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const selected = selectedId ? byId.get(selectedId) : null;
  const fotosSel = useFotos(selectedId, true);
  const [visor, setVisor] = useState(false);
  // em teste (todos os estados): brasão do município, tema Método e prefeitura no detalhe
  const temaDetalhe = !!regioes && !!selected;
  const ufSel = selected?.uf?.toUpperCase();
  const imgWiki = useImagemMunicipio(selected?.municipio, UF_NOME[ufSel], temaDetalhe && !!UF_NOME[ufSel]);
  const [prefeituras, setPrefeituras] = useState({}); // { UF: { município: dados } }, carregado por estado
  useEffect(() => {
    if (!temaDetalhe || !ufSel || prefeituras[ufSel]) return;
    const salva = (d) => setPrefeituras((p) => ({ ...p, [ufSel]: d }));
    fetch(`/dados/prefeituras/${ufSel}.json`).then((r) => (r.ok ? r.json() : {})).then(salva).catch(() => salva({}));
  }, [temaDetalhe, ufSel, prefeituras]);
  // Sem brasão na página da Wikipédia: usa o brasão achado no Wikidata/Commons ou no site da prefeitura
  // (este salvo em public/brasoes/<UF>/), conforme public/dados/prefeituras.
  const dadosMun = temaDetalhe ? prefeituras[ufSel]?.[selected.municipio] : null;
  const brasaoExtra = dadosMun?.brasao, brasaoLocal = dadosMun?.brasaoLocal;
  const imgMun = useMemo(() => {
    if (imgWiki?.tipo === 'brasao') return imgWiki;
    if (brasaoLocal) return { tipo: 'brasao', srcs: [brasaoLocal], pagina: imgWiki?.pagina };
    if (!brasaoExtra) return imgWiki;
    const arq = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(brasaoExtra.replace(/ /g, '_'));
    return { tipo: 'brasao', srcs: [arq + '?width=500', arq], pagina: imgWiki?.pagina };
  }, [imgWiki, brasaoExtra, brasaoLocal]);
  useEffect(() => setVisor(false), [selectedId]);

  const vizinhos = useMemo(() => {
    if (!selected) return [];
    return all.filter((p) => p.id !== selected.id && Math.abs(p.lat - selected.lat) < 1.5 && Math.abs(p.lng - selected.lng) < 1.5)
      .map((p) => ({ ...p, km: haversine(selected, p) })).sort((a, b) => a.km - b.km).slice(0, 5);
  }, [selected, all]);

  // Enquadrar ao mudar filtro geográfico
  useEffect(() => {
    if (!booted) return;
    // Macrorregião escolhida (sem município): enquadra a região inteira, não só os orelhões dela
    const area = macro && !municipio && regioesGeo[macro.uf]?.features.find((f) => f.properties.tipo === 'regiao' && f.properties.nome === macro.nome);
    if (area) {
      const pts = [];
      const juntar = (c) => (typeof c[0] === 'number' ? pts.push({ lng: c[0], lat: c[1] }) : c.forEach(juntar));
      juntar(area.geometry.coordinates);
      setFlyTarget({ bounds: bounds(pts) });
      return;
    }
    const pts = municipio || macro ? filtered : porUf;
    // só o estado (sem região/município): mesmo enquadramento do clique na bandeira (estado: true)
    if (pts.length && (regiao || uf || municipio)) setFlyTarget({ bounds: bounds(pts), estado: novidades && !!uf && !municipio && !macro && !regiao });
    else if (!regiao && !uf) setFlyTarget({ bounds: [[-74, -34], [-34.8, 5.3]], livre: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regiao, uf, municipio, macro, booted]);

  // Card de macrorregião (no mapa ou no painel): fixa o estado e escolhe/solta a região
  const escolherMacro = useCallback((u, nome) => {
    setRegiao(null); setUf(u); setMunicipio(null);
    setMacro(nome ? { uf: u, nome } : null);
  }, []);
  // Município clicado no pop-up do card: só os orelhões dele no mapa
  const escolherMunicipioRegiao = useCallback((u, nome, mun) => {
    setRegiao(null); setUf(u); setMacro({ uf: u, nome }); setMunicipio(mun);
    setSelectedId(null);
  }, []);

  const select = useCallback((id, fly = true) => {
    setSelectedId(id);
    const p = byId.get(id);
    if (p && fly) setFlyTarget({ lat: p.lat, lng: p.lng, zoom: 17, comFoto: true, pitch: 0, bearing: 0, t: Date.now() });
  }, [byId]);

  // ---- Dados do IBGE / OpenStreetMap por orelhão (gerados por scripts/gerar-dados-*) ----
  const [dadosLoc, setDadosLoc] = useState(null);
  const [dadosAcesso, setDadosAcesso] = useState(null);
  useEffect(() => {
    fetch('/dados/localidades.json').then((r) => r.json()).then(setDadosLoc).catch(() => notify('Não foi possível carregar os dados do IBGE'));
    fetch('/dados/acesso.json').then((r) => (r.ok ? r.json() : null)).then(setDadosAcesso).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Enter na busca leva ao município ("santa rita" ou "santa rita ma") ----
  const municipiosIdx = useMemo(() => {
    const m = new Map();
    all.forEach((p) => {
      const k = `${p.uf}|${p.municipio}`;
      if (!m.has(k)) m.set(k, { uf: p.uf, municipio: p.municipio, n: 0 });
      m.get(k).n++;
    });
    return [...m.values()];
  }, [all]);
  const irParaMunicipio = () => {
    let nq = norm(q.trim());
    if (!nq) return;
    const fim = nq.split(' ').pop().toUpperCase();
    const ufBusca = nq.includes(' ') && UF_NOME[fim] ? fim : null;
    if (ufBusca) nq = nq.slice(0, -3).trim();
    const ufAlvo = ufBusca || ufFocoBusca; // com um estado em foco, só municípios dele
    const daUf = (m) => !ufAlvo || m.uf === ufAlvo;
    const exatos = municipiosIdx.filter((m) => daUf(m) && norm(m.municipio) === nq);
    const cand = exatos.length ? exatos : municipiosIdx.filter((m) => daUf(m) && norm(m.municipio).startsWith(nq));
    if (!cand.length) {
      if (filtered.length === 1) select(filtered[0].id);
      else if (!filtered.length) notify(ufFocoBusca ? `Nada com esse nome em ${UF_NOME[ufFocoBusca]}` : 'Nenhum município com esse nome na base');
      return;
    }
    const m = [...cand].sort((a, b) => b.n - a.n)[0];
    setRegiao(null); setUf(m.uf); setMunicipio(m.municipio); setQ(''); setSelectedId(null); setProximos(null);
    const outros = cand.length - 1;
    notify(`${m.municipio} (${m.uf}): ${m.n} ${m.n > 1 ? 'orelhões' : 'orelhão'}`
      + (outros ? ` · ${outros} outro${outros > 1 ? 's' : ''} município${outros > 1 ? 's' : ''} com nome parecido — digite a UF no fim` : ''));
  };
  const resumoMunicipio = useMemo(() => {
    if (!municipio || !dadosLoc) return null;
    const pts = porUf.filter((p) => p.municipio === municipio);
    const d = pts.map((p) => dadosLoc[p.id]).find((x) => x?.mun_pop);
    return { n: pts.length, pop: d?.mun_pop, sede: d?.sede };
  }, [municipio, porUf, dadosLoc]);

  const pertoDeMim = () => {
    if (!navigator.geolocation) return notify('Geolocalização indisponível neste navegador');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const pos = { lat: coords.latitude, lng: coords.longitude };
      setUserPos(pos);
      try {
        const d = await fetchProximos(pos.lat, pos.lng, 15);
        setProximos(d);
        setSelectedId(null);
        if (d.length) setFlyTarget({ bounds: bounds([pos, ...d.slice(0, 5)]) });
      } catch (e) { notify('Erro ao buscar próximos: ' + e.message); }
      setLocating(false);
    }, () => { setLocating(false); notify('Não foi possível obter sua localização'); }, { enableHighAccuracy: true, timeout: 10000 });
  };

  const cancelEdit = () => { setEditing(false); setDraft(null); setCamPos(null); setForm(null); setMarcado(null); setErroSalvar(null); setVistaMarcada(null); };
  const startEdit = () => {
    setOrbit(false); setEditing(true); setCamPos(null); setDist(12);
    setDraft({ lat: selected.lat, lng: selected.lng });
  };
  useEffect(() => { cancelEdit(); }, [selectedId]);

  // Ao entrar em edição (pelo botão ou por uma marcação vinda da extensão),
  // os campos começam com os valores atuais do orelhão.
  useEffect(() => {
    if (!editing || !selected || form) return;
    setForm(Object.fromEntries(CAMPOS.map(([k]) => [k, selected[k] ?? ''])));
    setDraft((d) => d ?? { lat: selected.lat, lng: selected.lng });
  }, [editing]);

  // Latitude/longitude digitadas movem o pino; pino movido atualiza os campos.
  // Só aceita o texto inteiro como número ("-1.27050-1.27" não vale), com vírgula ou ponto.
  const lerNumero = (txt) => { const s = String(txt).trim().replace(',', '.'); return s && Number.isFinite(+s) ? +s : null; };
  useEffect(() => {
    if (!draft) return;
    const casa = (txt, v) => { const n = lerNumero(txt); return n !== null && Math.abs(n - v) < 1e-7; };
    if (!casa(latTxt, draft.lat)) setLatTxt(draft.lat.toFixed(6));
    if (!casa(lngTxt, draft.lng)) setLngTxt(draft.lng.toFixed(6));
  }, [draft]);
  const digitarCoord = (eixo, txt) => {
    (eixo === 'lat' ? setLatTxt : setLngTxt)(txt);
    const v = lerNumero(txt);
    if (v === null) return;
    setCamPos(null);
    setDraft((d) => ({ ...d, [eixo]: v }));
  };
  const coordInvalida = lerNumero(latTxt) === null || lerNumero(lngTxt) === null;

  // Com a direção da câmera do Street View, o pino anda para a frente dela.
  useEffect(() => {
    if (camPos?.heading == null) return;
    setDraft(destino(camPos.lat, camPos.lng, camPos.heading, dist));
  }, [camPos, dist]);

  const marcarNoMapa = (d) => { setCamPos(null); setDraft(d); };

  // Recebe a posição enviada pela extensão (pasta extensao/). Do Google Earth vem o
  // ponto exato do centro da tela; do Street View, a câmera, e o ponto é projetado à frente.
  const onStreetView = useRef(null);
  onStreetView.current = ({ lat, lng, h, t, exato }) => {
    if (!selected) return notify('Abra o orelhão no app antes de marcar');
    // Em teste: mostra o cartão "Confirmar e salvar" e enquadra a posição antiga e a nova no mapa.
    if (regioes) {
      setMarcado(exato ? 'Google Earth' : 'Street View');
      setFlyTarget({ bounds: bounds([selected, { lat, lng }]), maxZoom: 18, t: Date.now() });
    }
    if (exato) {
      setOrbit(false); setEditing(true);
      setCamPos(null); setDraft({ lat, lng });
      if (!regioes) setFlyTarget({ lat, lng, zoom: 16, pitch: 0, bearing: 0, t: Date.now() });
      return notify('Posição recebida do Google Earth');
    }
    // Câmera do carro do Google fica a ~2,5 m do chão: o ângulo para baixo até o pé
    // do orelhão dá a distância. Mirando no horizonte, usa 12 m e o ajuste fino.
    const abaixo = 90 - t;
    const d = abaixo >= 2 ? Math.round(Math.min(60, Math.max(2, ALTURA_CAMERA / Math.tan((abaixo * Math.PI) / 180)))) : 12;
    setOrbit(false); setEditing(true);
    setCamPos({ lat, lng, heading: h }); setDist(d);
    setVistaMarcada({ lat, lng, heading: Math.round(h * 100) / 100, pitch: Math.round((t - 90) * 100) / 100 });
    if (!regioes) setFlyTarget({ lat, lng, zoom: 16, pitch: 0, bearing: 0, t: Date.now() });
    notify(`Posição recebida do Street View (${d} m à frente da câmera)`);
  };
  // Marcação vinda da aba do Street View (/rua): traz o id do orelhão e um número (n) para
  // não ser usada duas vezes. Se outro orelhão estiver aberto (ou nenhum), abre o da marcação antes.
  const ultimaMarca = useRef(0);
  const marcaEsperando = useRef(null);
  const receberMarca = useRef(null);
  receberMarca.current = (m) => {
    if (!m) return;
    if (m.n) {
      if (m.n <= ultimaMarca.current || Date.now() - m.n > 30 * 60 * 1000) return;
      if (m.id != null && !byId.get(m.id)) return; // orelhões ainda carregando: tenta de novo depois
      ultimaMarca.current = m.n;
      try { localStorage.removeItem(MARCA_PENDENTE); } catch {}
    }
    if (m.id != null && selected?.id !== m.id) { marcaEsperando.current = m; select(m.id, false); return; }
    onStreetView.current?.(m);
  };
  useEffect(() => {
    const m = marcaEsperando.current;
    if (!m || !selected || selected.id !== m.id) return;
    marcaEsperando.current = null;
    onStreetView.current?.(m);
  }, [selected?.id]);
  useEffect(() => {
    // marcação guardada no navegador: a aba do mapa pode ter ficado congelada (celular)
    const verPendente = () => { try { const s = localStorage.getItem(MARCA_PENDENTE); if (s) receberMarca.current?.(JSON.parse(s)); } catch {} };
    const aoVoltar = () => { if (document.visibilityState === 'visible') verPendente(); };
    const aoGuardar = (e) => { if (e.key === MARCA_PENDENTE) verPendente(); };
    let bc = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('orelhao-marcar');
      bc.onmessage = (e) => receberMarca.current?.(e.data);
    }
    document.addEventListener('visibilitychange', aoVoltar);
    addEventListener('focus', verPendente);
    addEventListener('storage', aoGuardar);
    if (booted) verPendente();
    return () => { bc?.close(); document.removeEventListener('visibilitychange', aoVoltar); removeEventListener('focus', verPendente); removeEventListener('storage', aoGuardar); };
  }, [booted]);

  const salvarEdicao = async () => {
    if (!draft || !selected || !form) return;
    if (!senha) return notify('Informe a senha de edição');
    const moveu = Math.abs(draft.lat - selected.lat) > 1e-7 || Math.abs(draft.lng - selected.lng) > 1e-7;
    const pos = moveu ? { lat: draft.lat, lng: draft.lng } : null;
    setSaving(true);
    try {
      const ok = await atualizarOrelhao(selected.id, senha, pos, form);
      if (!ok) {
        notify('Senha incorreta');
        try { sessionStorage.removeItem('edit_senha'); } catch {}
      } else {
        try { sessionStorage.setItem('edit_senha', senha); } catch {}
        const limpo = Object.fromEntries(CAMPOS.map(([k]) => [k, String(form[k] ?? '').trim() || null]));
        setAll((arr) => arr.map((p) => p.id !== selected.id ? p : {
          ...p, ...limpo,
          ...(pos && { ...pos, origem: 'original', origem_desc: 'Posição corrigida manualmente' }),
        }));
        notify('Orelhão atualizado ✔');
        cancelEdit();
        if (pos) setFlyTarget({ ...pos, zoom: 16, pitch: 0, bearing: 0, t: Date.now() });
      }
    } catch (e) { notify('Erro ao salvar: ' + e.message); }
    setSaving(false);
  };

  // Em teste: busca a vista do Street View guardada para o orelhão aberto.
  const vistaSel = regioes && selected ? vistas[selected.id] : null;
  useEffect(() => {
    if (!regioes || !selected || selected.id in vistas) return;
    const id = selected.id;
    fetchVista(id).then((v) => setVistas((m) => ({ ...m, [id]: v })));
  }, [regioes, selected?.id, vistas]);
  // Link do Street View: com vista guardada, abre da câmera de onde o orelhão foi marcado, olhando para ele.
  // Com a chave do Google Maps, abre a nossa aba /rua (Street View com "Marcar aqui", sem extensão).
  const linkStreetView = (p) => {
    const v = vistaSel && p?.id === selected?.id ? vistaSel : null;
    if (TEM_STREET_VIEW_PROPRIO && regioes) return linkRua(p, v);
    // (abaixo: sem chave, o site do Google como antes)
    return v ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${v.lat},${v.lng}&heading=${v.heading}&pitch=${v.pitch}&fov=80`
      : `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}`;
  };
  // A aba /rua é aberta por código: assim o navegador deixa ela se fechar sozinha depois de marcar.
  const abrirRua = (e) => {
    const href = e.currentTarget.getAttribute('href');
    if (!href?.startsWith('/rua')) return;
    const aba = window.open(href, '_blank');
    if (aba) e.preventDefault();
  };

  // Em teste: salva a posição marcada no Street View / Google Earth, sem senha (migration 006),
  // e só confirma depois de reler o orelhão do banco.
  const salvarMarcacao = async () => {
    if (!draft || !selected) return;
    setSaving(true); setErroSalvar(null);
    try {
      const { semVista, ...pos } = await marcarPosicao(selected.id, draft.lat, draft.lng, marcado, vistaMarcada);
      const desc = `Posição corrigida manualmente${marcado ? ` (${marcado})` : ''}`;
      setAll((arr) => arr.map((p) => (p.id !== selected.id ? p : { ...p, ...pos, origem: 'original', origem_desc: desc })));
      setVistas((v) => ({ ...v, [selected.id]: semVista ? v[selected.id] ?? null : vistaMarcada }));
      notify(vistaMarcada && !semVista ? 'Posição e vista do Street View salvas ✔' : 'Posição salva e conferida no banco ✔');
      cancelEdit();
      setFlyTarget({ ...pos, zoom: 17, pitch: 0, bearing: 0, t: Date.now() });
    } catch (e) {
      const semFuncao = /marcar_posicao|function|schema cache/i.test(e.message);
      setErroSalvar(semFuncao ? 'O banco ainda não tem a função de salvar sem senha (migration 006). Nada foi salvo.' : `Erro ao salvar: ${e.message}. Nada foi salvo.`);
    }
    setSaving(false);
  };

  // Em teste: um painel por vez, à esquerda. Sem nada escolhido, fica oculto (mapa inteiro);
  // ao escolher um estado aparece o painel de busca; ao abrir um orelhão, ele dá lugar ao
  // detalhe, que entra no mesmo lugar. painelPedido: null = automático, true/false = pelo botão.
  const [painelPedido, setPainelPedido] = useState(null);
  // Tamanho da tela: no celular/tablet em pé (≤ 900px) o painel é uma gaveta embaixo,
  // então o mapa deixa espaço embaixo (e não à direita) ao enquadrar.
  const [tela, setTela] = useState(() => (typeof window === 'undefined' ? { w: 1920, h: 1080 } : { w: innerWidth, h: innerHeight }));
  useEffect(() => {
    const medir = () => setTela({ w: innerWidth, h: innerHeight });
    medir(); addEventListener('resize', medir);
    return () => removeEventListener('resize', medir);
  }, []);
  const enqTeste = useMemo(() => {
    if (tela.w > 1500) return ENQ_TESTE;
    if (tela.w > 900) { // faixa com duas linhas (título + botões): o mapa começa abaixo dela
      return { ...ENQ_TESTE, livre: { ...ENQ_TESTE.livre, top: 150 }, painel: { ...ENQ_TESTE.painel, top: 160 } };
    }
    const topo = tela.w <= 560 ? 130 : 140; // faixa + linha de botões
    const gaveta = Math.round(tela.h * (tela.w <= 560 ? 0.52 : 0.58)) + 16;
    return {
      // 80 embaixo: "Buscar"; mais à direita: as bandeiras de RN, PB, AL, SE, ES, RJ ficam fora da costa
      livre: { top: topo, bottom: 80, left: 4, right: tela.w <= 560 ? 74 : 70 },
      painel: { top: topo + 10, bottom: gaveta + 40, left: 24, right: 24 }, // folga: o ícone do orelhão tem ~40px
      voo: { top: topo - 40, bottom: gaveta, left: 0, right: 0 },
    };
  }, [tela]);
  const temFoco = !!(ufMapa || uf || municipio || macro || regiao || q.trim());
  useEffect(() => { setPainelPedido(null); }, [ufMapa, uf, municipio, macro, regiao]);
  const mostrarPainel = !novidades || (!selected && (painelPedido ?? temFoco));
  // município ou região do estado escolhidos (busca, lista, cartão ou pop-up do mapa, em qualquer estado):
  // o painel mostra só a busca e a lista de localidades
  const soMun = novidades && !!(municipio || macro);
  // estado clicado no mapa: o painel mostra só o campo de busca (busca limitada ao estado).
  // Aberto pelo botão "Buscar", sem estado, o painel continua completo.
  const soBusca = novidades && !!ufMapa && !soMun;

  // Modo "Localizados": no mapa só os orelhões já localizados (posição corrigida e salva), por estado
  // (o filtro dos localizados já está em `filtered`: mapa, lista e busca mostram só eles)
  const pontosMapa = filtered;
  const trocarModo = (id) => {
    setMode(id);
    if (id !== 'localizados' || id === mode) return;
    const loc = all.filter(confirmado);
    const nUf = new Set(loc.map((p) => p.uf)).size;
    notify(loc.length ? `${fmt(loc.length)} ${loc.length > 1 ? 'orelhões localizados' : 'orelhão localizado'} em ${nUf} ${nUf > 1 ? 'estados' : 'estado'}` : 'Nenhum orelhão localizado ainda');
    // volta para o Brasil inteiro, com os selos dos estados mostrando os localizados
    if (!selected) {
      setRegiao(null); setUf(null); setMunicipio(null); setMacro(null); setQ('');
      setFlyTarget({ bounds: [[-74, -34], [-34.8, 5.3]], livre: true, t: Date.now() });
    }
  };

  // ---- Trilha de navegação: Brasil › Estado › Região › Município › Orelhão ----
  // Cada etapa volta direto àquele nível (fechando o orelhão e enquadrando o mapa); "‹ Voltar" sobe um nível.
  const BRASIL = [[-74, -34], [-34.8, 5.3]];
  const sairDoOrelhao = () => { if (editing) cancelEdit(); setSelectedId(null); setProximos(null); setQ(''); };
  const irBrasil = () => {
    sairDoOrelhao(); setRegiao(null); setUf(null); setMunicipio(null); setMacro(null);
    setFlyTarget({ bounds: BRASIL, livre: true, t: Date.now() });
  };
  const irEstado = (u) => {
    sairDoOrelhao(); setRegiao(null); setMacro(null); setMunicipio(null); setUf(u);
    const c = caixasUf[u];
    if (c) setFlyTarget({ bounds: [[c.w, c.s], [c.e, c.n]], estado: true, t: Date.now() });
  };
  const irRegiao = (u, nome) => {
    sairDoOrelhao(); setRegiao(null); setUf(u); setMunicipio(null); setMacro({ uf: u, nome });
    const area = regioesGeo[u]?.features.find((f) => f.properties.tipo === 'regiao' && f.properties.nome === nome);
    if (!area) return;
    const pts = [];
    const juntar = (c) => (typeof c[0] === 'number' ? pts.push({ lng: c[0], lat: c[1] }) : c.forEach(juntar));
    juntar(area.geometry.coordinates);
    setFlyTarget({ bounds: bounds(pts), t: Date.now() });
  };
  const irMunicipio = (u, nome, mun) => {
    sairDoOrelhao(); setRegiao(null); setUf(u); setMacro(nome ? { uf: u, nome } : null); setMunicipio(mun);
    const pts = all.filter((p) => p.uf === u && p.municipio === mun);
    if (pts.length) setFlyTarget({ bounds: bounds(pts), maxZoom: 14, t: Date.now() });
  };
  // Ação TUPs › município: fecha o painel e mostra o município no mapa (com os orelhões dele)
  const verMunicipioAcao = (u, nome) => {
    const k = chaveMun(nome);
    const p = all.find((x) => x.uf === u && chaveMun(x.municipio) === k);
    if (!p) { notify(`${nome} (${u}) não tem orelhões no mapa`); return; }
    setAdminTela(null);
    if (mode !== 'cluster') setMode('cluster');
    irMunicipio(u, macroDe[u]?.get(chaveMun(p.municipio)) || null, p.municipio);
  };
  const trilha = (() => {
    if (!novidades) return [];
    const u = selected?.uf || macro?.uf || uf || ufMapa;
    if (!u) return [];
    const mun = selected?.municipio || municipio;
    const reg = selected ? macroDe[u]?.get(chaveMun(selected.municipio)) || null : macro?.nome || null;
    const t = [{ id: 'brasil', rotulo: 'Brasil', ir: irBrasil }, { id: 'uf', rotulo: UF_NOME[u] || u, ir: () => irEstado(u) }];
    if (reg) t.push({ id: 'regiao', rotulo: `Região ${reg}`, ir: () => irRegiao(u, reg) });
    if (mun) t.push({ id: 'mun', rotulo: mun, ir: () => irMunicipio(u, reg, mun) });
    if (selected) t.push({ id: 'orelhao', rotulo: selected.localidade });
    return t;
  })();
  const Trilha = () => (trilha.length > 1 ? (
    <nav className="trilha" aria-label="Voltar para">
      <button type="button" className="trilha-voltar" onClick={trilha[trilha.length - 2].ir} title={`Voltar para ${trilha[trilha.length - 2].rotulo}`}>‹ Voltar</button>
      <ol>
        {trilha.map((x, i) => (
          <li key={x.id}>
            {i < trilha.length - 1
              ? <button type="button" onClick={x.ir}>{x.rotulo}</button>
              : <span aria-current="page">{x.rotulo}</span>}
          </li>
        ))}
      </ol>
    </nav>
  ) : null);

  // ---- Modo TV (/tv): o sistema se apresenta sozinho, em loop ----
  // Brasil → estado → região → pesquisa do município → orelhão localizado (girando em 3D) → volta ao estado → próximo.
  // Só lê: nada é gravado. Teste com 3 estados que têm orelhões localizados.
  const tvAcoes = useRef(null);
  const tvRua = useRef(null);
  tvAcoes.current = { irBrasil, irEstado, irRegiao, irMunicipio, select, setOrbit, setQ, setFlyTarget, setMode, all, macroDe };
  const [tvLegenda, setTvLegenda] = useState(null); // { etapa, titulo, sub, ms, n }
  const [tvFrase, setTvFrase] = useState(false);
  // painel de administração (botão no lugar do antigo "Perto de mim"); fecha com Esc
  const [admin, setAdmin] = useState(false);
  const [adminTela, setAdminTela] = useState(null); // tela aberta a partir do painel (ex.: 'propostas')
  const [propostaInicial, setPropostaInicial] = useState(null); // proposta aberta já preenchida (vinda da Ação TUPs)
  const [sdrInicial, setSdrInicial] = useState(null); // município aberto direto na Ferramenta SDR
  useEffect(() => {
    if (!admin) return;
    const esc = (e) => { if (e.key === 'Escape') setAdmin(false); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [admin]); // frase sobre o mapa de pontos (abertura do Brasil)
  useEffect(() => {
    if (!tv || !booted) return;
    let vivo = true, wake = null, n = 0;
    const timers = [];
    const esperar = (ms) => new Promise((r) => { timers.push(setTimeout(r, ms)); });
    const A = () => tvAcoes.current;
    const legenda = (etapa, titulo, sub, ms) => setTvLegenda({ etapa, titulo, sub, ms, n: ++n });
    // digita letra por letra pelo relógio: se a busca demorar a redesenhar, pula letras em vez de atrasar
    const digitar = async (txt) => {
      const t0 = performance.now(), fim = txt.length * TV_TEMPO.letra;
      while (vivo) {
        const t = performance.now() - t0;
        A().setQ(txt.slice(0, Math.min(txt.length, Math.floor(t / TV_TEMPO.letra) + 1)));
        if (t >= fim) break;
        await esperar(TV_TEMPO.letra);
      }
    };
    const pedirTela = () => navigator.wakeLock?.request('screen').then((w) => { wake = w; }).catch(() => {});
    pedirTela();
    const aoVoltar = () => { if (document.visibilityState === 'visible') pedirTela(); };
    document.addEventListener('visibilitychange', aoVoltar);
    const vez = {};
    tvRua.current?.aquecer();
    (async () => {
      while (vivo) {
        for (const { uf: u, id: fixo } of TV_ESTADOS) {
          if (!vivo) return;
          const todos = A().all;
          const doUf = todos.filter((p) => p.uf === u);
          const loc = doUf.filter(confirmado);
          if (!loc.length) continue;
          // 1. Brasil
          // abre com as bandeiras dos estados e faz o passeio em 3D (inclina, gira e volta em pé ao centro)
          A().setOrbit(false); A().setMode('cluster'); A().irBrasil();
          legenda('Brasil', 'Mapa nacional de orelhões', '', TV_TEMPO.brasilAntes + TV_TEMPO.passeio + TV_TEMPO.pontos);
          await esperar(TV_TEMPO.brasilAntes); if (!vivo) return;
          A().setFlyTarget({ passeio: true, bounds: BRASIL, t: Date.now() });
          await esperar(TV_TEMPO.passeio); if (!vivo) return;
          // (teste) depois do giro: todos os pontos, com a frase sobre o mapa
          A().setMode('points'); setTvFrase(true);
          await esperar(TV_TEMPO.pontos); setTvFrase(false); if (!vivo) return;
          // 2. Estado (volta ao agrupado: bandeira e regiões do estado)
          A().setMode('cluster'); A().irEstado(u);
          legenda('Estado', UF_NOME[u], `${fmt(doUf.length)} orelhões · ${loc.length} ${loc.length > 1 ? 'localizados' : 'localizado'}`, TV_TEMPO.estado);
          // um orelhão localizado diferente a cada volta
          vez[u] = ((vez[u] ?? -1) + 1) % loc.length;
          const p = (fixo && doUf.find((x) => x.id === fixo)) || loc[vez[u]];
          // a foto de rua do orelhão já começa a carregar escondida aqui (o Google às vezes demora
          // vários segundos): assim fica pronta a tempo e o roteiro não passa dos 50 s
          const temRua = fetchVista(p.id).catch(() => null).then((vista) => tvRua.current?.preparar({ lat: p.lat, lng: p.lng }, vista) ?? false);
          await esperar(TV_TEMPO.estado); if (!vivo) return;
          const reg = A().macroDe[u]?.get(chaveMun(p.municipio)) || null;
          // 3. Região
          if (reg) {
            const nReg = doUf.filter((x) => A().macroDe[u]?.get(chaveMun(x.municipio)) === reg).length;
            A().irRegiao(u, reg);
            legenda('Região', `Região ${reg}`, `${UF_NOME[u]} · ${fmt(nReg)} orelhões`, TV_TEMPO.regiao);
            await esperar(TV_TEMPO.regiao); if (!vivo) return;
          }
          // 4. Pesquisa: digita o município na busca, letra por letra
          legenda('Pesquisa', `Buscando “${p.municipio}”`, `${UF_NOME[u]}`, p.municipio.length * TV_TEMPO.letra + TV_TEMPO.aposDigitar);
          await digitar(p.municipio);
          await esperar(TV_TEMPO.aposDigitar); if (!vivo) return;
          A().irMunicipio(u, reg, p.municipio);
          const nMun = doUf.filter((x) => x.municipio === p.municipio).length;
          legenda('Município', p.municipio, `${fmt(nMun)} ${nMun > 1 ? 'orelhões' : 'orelhão'} · ${UF_NOME[u]}`, TV_TEMPO.municipio);
          await esperar(TV_TEMPO.municipio); if (!vivo) return;
          // 4b. Pesquisa da localidade dentro do município
          legenda('Pesquisa', `Buscando “${p.localidade}”`, `${p.municipio} · ${UF_NOME[u]}`, p.localidade.length * TV_TEMPO.letra + TV_TEMPO.aposDigitar);
          await digitar(p.localidade);
          await esperar(TV_TEMPO.aposDigitar); if (!vivo) return;
          // 5. Orelhão localizado: voa até ele e gira em 3D
          A().select(p.id);
          legenda('Orelhão localizado', p.localidade, `${p.municipio} · ${UF_NOME[u]} · posição confirmada`, TV_TEMPO.orelhaoVoo + TV_TEMPO.orelhaoGiro);
          await esperar(TV_TEMPO.orelhaoVoo); if (!vivo) return;
          A().setOrbit(true);
          await esperar(TV_TEMPO.orelhaoGiro); if (!vivo) return;
          // 6. Na rua: o próprio orelhão no Street View (vista salva na marcação, ou a foto de rua mais próxima).
          // Se a foto ainda não chegou, espera no máximo 1,5 s e segue sem ela (não estoura o tempo).
          A().setOrbit(false);
          const pronta = await Promise.race([temRua, esperar(1500).then(() => false)]);
          const viu = vivo && pronta && (await tvRua.current?.exibir());
          if (viu && vivo) {
            legenda('Na rua', p.localidade, `${p.municipio} · ${UF_NOME[u]} · Street View 360°`, TV_RUA_MS);
            await esperar(TV_RUA_MS);
            tvRua.current?.esconder();
            if (!vivo) return;
          }
          // 7. Volta para o estado
          A().irEstado(u);
          legenda('Voltando', UF_NOME[u], 'próximo estado em instantes…', TV_TEMPO.voltando);
          await esperar(TV_TEMPO.voltando);
        }
      }
    })();
    return () => { vivo = false; timers.forEach(clearTimeout); wake?.release?.(); tvRua.current?.esconder(); document.removeEventListener('visibilitychange', aoVoltar); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv, booted]);
  const tvPlacar = useMemo(() => (tv ? {
    total: all.length, ufs: new Set(all.map((p) => p.uf)).size,
    muns: new Set(all.map((p) => `${p.uf}|${p.municipio}`)).size,
  } : null), [tv, all]);

  const limpar =() => { setRegiao(null); setUf(null); setMunicipio(null); setMacro(null); setQ(''); setSoOriginais(false); };
  const copy = (txt) => { navigator.clipboard.writeText(txt); notify('Copiado: ' + txt); };
  const maxRegiao = Math.max(1, ...porRegiaoStats.map((r) => r.n));

  return (
    <main className={`app ${tv ? 'modo-tv' : ''} ${novidades ? 'com-banner' : ''} ${novidades && (mostrarPainel || selected) ? 'painel-aberto' : ''} ${soBusca && !q.trim() && !selected ? 'busca-compacta' : ''}`}>
      <h1 className="sr-only">Orelhão Digital — mapa dos orelhões do Brasil</h1>

      {/* Splash */}
      <div className={`splash ${booted ? 'gone' : ''}`} aria-hidden={booted}>
        <div className="splash-ring"><span /><span /><span /><div className="splash-icon"><PhoneIcon size={44} /></div></div>
        <div className="splash-title">Orelhão <b>Digital</b></div>
        <div className="splash-bar"><i style={{ width: `${progress}%` }} /></div>
        <div className="splash-sub">{error ? `Erro: ${error}` : `Conectando ${fmt(Math.round((progress / 100) * 6149))} orelhões…`}</div>
      </div>

      <MapView points={pontosMapa} mode={mode} basemap={basemap} orbit={orbit && !!selected} onOrbitStop={() => setOrbit(false)} selected={selected} userPos={userPos} flyTarget={flyTarget} editing={editing} draft={draft} onDraft={marcarNoMapa} onSelect={(id) => { if (!editing) select(id, false); }}
        livre={!tv && mode === 'cluster' && !municipio && !q.trim() && !soOriginais && !selectedId && !userPos}
        regioes={mode === 'localizados' ? regioesInfoLoc : regioesInfo} caixasUf={caixasUf} ufFoco={uf} macro={macro?.nome ?? null} onMacro={escolherMacro} onMunicipio={escolherMunicipioRegiao} onFoco={onFocoMapa} teste={regioes}
        enquadramento={novidades ? enqTeste : null}
        deslocar={tela.w > 900 && (admin || (novidades && mostrarPainel && !temFoco && !selected)) ? 230 : 0} />

      {/* Painel lateral */}
      {/* Em teste: a faixa Método vira um banner fixo sobre o mapa (e sai do painel lateral) */}
      {novidades && (
        <header className={`banner-metodo ${booted ? 'in' : ''}`} aria-label="Método – Conectando o Brasil · Orelhão Digital">
          <div className="banner-marca">
            <img className="metodo-logo" src="/logo-metodo.png" alt="Método" draggable={false} />
            <span className="metodo-frase">Conectando o Brasil</span>
          </div>
          <div className="banner-titulo">
            {/* com a Ação TUPs aberta, a faixa principal vira o cabeçalho dela */}
            <h1>{adminTela === 'acao' ? 'Ação TUPs' : adminTela === 'sdr' ? 'Pesquisa Municípios' : 'Orelhão Digital'}</h1>
            <span>{adminTela === 'acao' ? 'Apresentação executiva' : adminTela === 'sdr' ? 'Pesquisa de e-mail, telefone e nome · Coletivo' : 'Mapa nacional de TUPs · v2'}</span>
          </div>
        </header>
      )}

      {/* Em teste: puxador para abrir o painel quando ele está oculto */}
      {novidades && (
        <button id="abrir-painel" className={`puxador-painel ${booted && !mostrarPainel && !selected ? 'in' : ''}`}
          onClick={() => setPainelPedido(true)} aria-label="Abrir painel de busca">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          <span>Buscar</span>
        </button>
      )}
      {novidades && (
        // com o painel aberto, o "Buscar" vira "Início": volta ao mapa do Brasil (todos os estados) e fecha o painel
        <button id="recolher-painel" className={`recolher-painel ${booted && mostrarPainel ? 'in' : ''}`}
          onClick={() => { setQ(''); irBrasil(); setPainelPedido(false); }} aria-label="Voltar ao início (mapa do Brasil)" title="Voltar ao início: todos os estados">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" /></svg>
          <span>Início</span>
        </button>
      )}
      {/* botão flutuante "Instalar App" (canto inferior esquerdo do mapa); some com painel, ficha ou administração abertos */}
      {!tv && <InstalarApp oculto={!booted || (novidades && mostrarPainel) || !!selected || admin} />}

      <aside className={`panel glass ${regioes ? 'tema-metodo' : ''} ${novidades ? 'painel-alterna' : ''} ${booted && mostrarPainel ? 'in' : ''}`} aria-hidden={!mostrarPainel}>
        {novidades ? null : regioes ? (
          // em teste: logo Método + "Conectando o Brasil" em cima; "Orelhão Digital" à direita embaixo
          <header className="brand brand-metodo">
            <div className="metodo-linha">
              <img className="metodo-logo" src="/logo-metodo.png" alt="Método" draggable={false} />
              <span className="metodo-frase">Conectando o Brasil</span>
            </div>
            <div className="metodo-titulo">
              <div className="brand-name">Orelhão <b>Digital</b></div>
              <div className="brand-sub">Mapa nacional de TUPs · v2</div>
            </div>
          </header>
        ) : (
          <header className="brand">
            <div className="logo"><img src="/logo.png" alt="" width="28" height="28" /></div>
            <div>
              <div className="brand-name">Orelhão <b>Digital</b></div>
              <div className="brand-sub">Mapa nacional de TUPs · v2</div>
            </div>
          </header>
        )}

        {!soMun && !soBusca && <div className="stats">
          <Stat label="orelhões" value={stats.total} accent="#fbbf24" />
          <Stat label="municípios" value={stats.municipios} accent="#34d399" />
          <Stat label="estados" value={stats.ufs} accent="#60a5fa" />
        </div>}

        {!soMun && !soBusca && <nav className="tabs" role="tablist">
          {[['explorar', 'Explorar'], ['dados', 'Painel']].map(([id, l]) => (
            <button key={id} id={`tab-${id}`} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>
          ))}
          <span className="tab-ink" style={{ transform: `translateX(${tab === 'explorar' ? 0 : 100}%)` }} />
        </nav>}

        {tab === 'explorar' || soMun || soBusca ? (
          <div className="scroll">
            <label className="search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <input id="search" ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') irParaMunicipio(); }}
                placeholder={soBusca ? `Buscar em ${UF_NOME[ufMapa] || ufMapa}…` : 'Município + Enter, localidade ou código…'} />
              {q ? <button className="x" onClick={() => setQ('')} aria-label="Limpar busca">×</button> : <kbd>/</kbd>}
            </label>

            {(soMun || soBusca) && <Trilha />}

            {!soMun && !soBusca && <>
            {resumoMunicipio && (
              <div className="mun-card">
                <div>
                  <b>{municipio}</b> <span>· {UF_NOME[uf]}</span>
                  <small>{resumoMunicipio.pop ? `${fmt(resumoMunicipio.pop)} habitantes (Censo 2022)` : 'população não encontrada'}</small>
                </div>
                <div className="mun-n"><b>{resumoMunicipio.n}</b><small>{resumoMunicipio.n > 1 ? 'orelhões' : 'orelhão'}</small></div>
                <button className="link" onClick={limpar}>Ver Brasil</button>
              </div>
            )}

            <div className="section-title">Região</div>
            <div className="chips">
              {REGIOES.map((r) => (
                <button key={r.id} id={`regiao-${r.id}`} className={`chip ${regiao === r.id ? 'on' : ''}`} style={{ '--c': r.cor }}
                  onClick={() => { setRegiao(regiao === r.id ? null : r.id); setUf(null); setMunicipio(null); }}>
                  <i />{r.id}<small>{fmt(porRegiaoStats.find((x) => x.id === r.id)?.n || 0)}</small>
                </button>
              ))}
            </div>

            {/* em teste: sem a grade de estados (as bandeiras no mapa já fazem isso) */}
            {!novidades && <>
              <div className="section-title">Estado</div>
              <div className="uf-grid">
                {ufs.map(([u, n]) => (
                  <button key={u} id={`uf-${u}`} title={`${UF_NOME[u]} · ${n} orelhões`} className={`uf ${uf === u ? 'on' : ''}`}
                    onClick={() => { setUf(uf === u ? null : u); setMunicipio(null); }}>
                    {regioes && <img className="uf-bandeira" src={`/bandeiras/${u.toLowerCase()}.png`} alt="" draggable={false} />}
                    <b>{u}</b><small>{n}</small>
                  </button>
                ))}
              </div>
            </>}

            {uf && regioesInfo[uf] && (
              <>
                <div className="section-title">Macrorregião <small>{UF_NOME[uf]}</small></div>
                <div className="reg-grid">
                  {regioesInfo[uf].cards.map((c) => (
                    <button key={c.nome} id={`macro-${c.nome}`} className={`reg-btn ${macro?.nome === c.nome ? 'on' : ''}`} style={{ '--c': c.cor }}
                      title={`${c.nome}: ${c.municipios.map((m) => (m.n ? `${m.nome} (${m.n})` : m.nome)).join(', ')}`}
                      disabled={!c.n} onClick={() => escolherMacro(uf, macro?.nome === c.nome ? null : c.nome)}>
                      <b><i />{c.nome}<em>{c.n}</em></b>
                      <small>{c.nMun} {c.nMun === 1 ? 'município' : 'municípios'}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {uf && (
              <>
                <div className="section-title">Município <small>{municipios.length} em {macro ? `${macro.nome} · ${uf}` : UF_NOME[uf]}</small></div>
                <select id="municipio" className="select" value={municipio || ''} onChange={(e) => setMunicipio(e.target.value || null)}>
                  <option value="">Todos os municípios</option>
                  {municipios.map(([m, n]) => <option key={m} value={m}>{m} ({n})</option>)}
                </select>
              </>
            )}

            <div className="row-between">
              <label className="toggle">
                <input id="toggle-originais" type="checkbox" checked={soOriginais} onChange={(e) => setSoOriginais(e.target.checked)} />
                <span className="track"><span /></span> Só coordenadas originais
              </label>
              {(regiao || uf || municipio || macro || q || soOriginais) && <button id="limpar" className="link" onClick={limpar}>Limpar</button>}
            </div>
            </>}

            {/* em teste: a lista geral de resultados sai; só aparece quando há busca, município ou região escolhidos */}
            {(!novidades || q.trim() || municipio || macro) && <>
            {!soMun && <div className="section-title">{macro ? `Região ${macro.nome}` : 'Resultados'} <small>{fmt(filtered.length)}</small></div>}
            {soMun && !municipio && <div className="section-title">Região {macro.nome} · {macro.uf} <small>{fmt(filtered.length)} orelhões</small></div>}
            {macro || soMun ? (
              <div className="grupos">
                {porMunicipio.map(([mun, ps]) => (
                  <div key={mun} className="grupo">
                    <div className="grupo-mun"><b>{mun}</b><small>{ps.length} {ps.length === 1 ? 'orelhão' : 'orelhões'}</small></div>
                    <ul className="list">
                      {ps.map((p) => (
                        <li key={p.id}>
                          <button className={selectedId === p.id ? 'on' : ''} onClick={() => select(p.id)}>
                            <i style={{ background: COR_REGIAO[p.regiao] }} />
                            <span className="li-main"><b>{p.localidade}</b><small>{p.municipio} · {p.uf}</small></span>
                            {p.origem === 'estimada' && <span className="tag warn">est.</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {!porMunicipio.length && <p className="more">Nenhum orelhão nesta região.</p>}
              </div>
            ) : (
            <ul className="list">
              {filtered.slice(0, 80).map((p, i) => (
                <li key={p.id} style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}>
                  <button className={selectedId === p.id ? 'on' : ''} onClick={() => select(p.id)}>
                    <i style={{ background: COR_REGIAO[p.regiao] }} />
                    <span className="li-main"><b>{p.localidade}</b><small>{p.municipio} · {p.uf}</small></span>
                    {p.origem === 'estimada' && <span className="tag warn">est.</span>}
                  </button>
                </li>
              ))}
              {filtered.length > 80 && <li className="more">+ {fmt(filtered.length - 80)} — refine a busca ou explore o mapa</li>}
              {!filtered.length && booted && <li className="more">Nenhum orelhão encontrado.</li>}
            </ul>
            )}
            </>}
          </div>
        ) : (
          <div className="scroll">
            <div className="section-title">Distribuição por região</div>
            <div className="bars">
              {porRegiaoStats.map((r) => (
                <button key={r.id} className="bar" onClick={() => { setRegiao(r.id); setUf(null); setMunicipio(null); setTab('explorar'); }}>
                  <span className="bar-label">{r.id}</span>
                  <span className="bar-track"><span style={{ width: `${(r.n / maxRegiao) * 100}%`, background: r.cor }} /></span>
                  <span className="bar-n">{fmt(r.n)}</span>
                </button>
              ))}
            </div>

            <div className="section-title">Ranking de estados</div>
            <div className="rank">
              {topUfs.map(([u, n], i) => (
                <button key={u} className="rank-item" onClick={() => { setRegiao(null); setUf(u); setMunicipio(null); setTab('explorar'); }}>
                  <span className="rank-pos">{i + 1}</span>
                  <span className="rank-name">{UF_NOME[u]}</span>
                  <span className="rank-bar"><span style={{ width: `${(n / topUfs[0][1]) * 100}%` }} /></span>
                  <span className="rank-n">{fmt(n)}</span>
                </button>
              ))}
            </div>

            <div className="section-title">Municípios com mais orelhões {(regiao || uf) && <small>no filtro atual</small>}</div>
            <ol className="mini">
              {topMunicipios.map(([m, n]) => <li key={m}><span>{m}</span><b>{n}</b></li>)}
            </ol>

            <div className="quality glass-inner">
              <div className="section-title" style={{ marginTop: 0 }}>Qualidade das coordenadas</div>
              <div className="donut" style={{ '--p': `${((stats.total - stats.estimados) / Math.max(stats.total, 1)) * 100}%` }}>
                <div><b>{Math.round(((stats.total - stats.estimados) / Math.max(stats.total, 1)) * 100)}%</b><small>originais</small></div>
              </div>
              <p><i className="dot ok" /> {fmt(stats.total - stats.estimados)} coordenadas originais<br /><i className="dot warn" /> {fmt(stats.estimados)} estimadas (centro do município/estado)</p>
            </div>
          </div>
        )}
      </aside>

      {/* Controles superiores */}
      <div className={`topbar ${booted ? 'in' : ''}`}>
        {/* Ação TUPs aberta: os botões dela entram aqui (Ferramenta - SDR, Menu, Sair, Fechar) */}
        {(adminTela === 'acao' || adminTela === 'sdr') && <div key={adminTela} id="topbar-acao" className="topbar-acao" />}
        {adminTela !== 'acao' && adminTela !== 'sdr' && <>
        <div className="seg glass">
          {[['cluster', 'Agrupado'], ['points', 'Pontos'], ['localizados', 'Localizados']].map(([id, l]) => (
            <button key={id} id={`modo-${id}`} className={mode === id ? 'on' : ''} onClick={() => trocarModo(id)}>{l}</button>
          ))}
        </div>
        <div className="seg glass">
          {[['sat', 'Satélite'], ['dark', 'Escuro']].map(([id, l]) => (
            <button key={id} id={`base-${id}`} className={basemap === id ? 'on' : ''} onClick={() => setBasemap(id)}>{l}</button>
          ))}
        </div>
        {/* no lugar do antigo "Perto de mim": abre o painel de administração */}
        <button id="admin" className={`cta ${admin ? 'aberto' : ''}`} onClick={() => setAdmin((v) => !v)} aria-expanded={admin} aria-controls="admin-painel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" /></svg>
          <span className="rotulo">Administração</span>
        </button>
        </>}
      </div>

      {/* Painel de administração: as funções entram em ADMIN_FUNCOES (cada uma vira um bloco) */}
      {admin && <div className="admin-fundo" onClick={() => setAdmin(false)} />}
      {admin && (
        <section id="admin-painel" className="admin-painel" role="dialog" aria-label="Administração">
          <header>
            <div>
              <span className="admin-selo">Área administrativa</span>
              <h2>Administração</h2>
            </div>
            <button type="button" className="admin-x" onClick={() => setAdmin(false)} aria-label="Fechar" title="Fechar (Esc)">×</button>
          </header>
          {ADMIN_FUNCOES.length ? (
            <div className="admin-grade">
              {ADMIN_FUNCOES.map((f) => (
                <button key={f.id} id={`admin-${f.id}`} type="button" className="admin-item" style={{ '--cor': f.cor, '--cor2': f.cor2 }} onClick={() => { setAdmin(false); setAdminTela(f.id); }}>
                  <i className="admin-icone">{f.icone}</i>
                  <span className="admin-txt">
                    <b>{f.nome}</b>
                    {f.desc && <small>{f.desc}</small>}
                  </span>
                  {f.senha && <em className="admin-cadeado" title="Pede a senha da equipe SDR"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10.5" width="14" height="10" rx="2.2" stroke="currentColor" strokeWidth="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="2" /></svg>senha</em>}
                </button>
              ))}
            </div>
          ) : (
            <div className="admin-vazio">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.5 2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.5 2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.5 2" /></svg>
              <b>As funções administrativas vão aparecer aqui.</b>
              <span>Em construção.</span>
            </div>
          )}
        </section>
      )}
      {adminTela === 'propostas' && (
        <Propostas orelhoes={all} inicial={propostaInicial}
          contexto={selected ? { municipio: selected.municipio, uf: selected.uf } : municipio && uf ? { municipio, uf } : null}
          onFechar={() => { setAdminTela(null); setPropostaInicial(null); }}
          onVoltar={() => { const de = propostaInicial?.de; setPropostaInicial(null); setAdminTela(de || null); if (!de) setAdmin(true); }} />
      )}
      {adminTela === 'acao' && (
        <AcaoTups onFechar={() => setAdminTela(null)} onVoltar={() => { setAdminTela(null); setAdmin(true); }}
          onVerMunicipio={verMunicipioAcao}
          onAbrirSdr={(r) => { setSdrInicial({ uf: r.uf, mun: r.municipio, qtd: r.orelhoes || r.tupsDireito, de: 'acao' }); setAdminTela('sdr'); }}
          onGerarProposta={(x) => {
            // TUPs pedidos: os que já existem no município entram como adaptados, o resto como novos
            const pedidos = x.tupsPedidos || x.tupsDireito || 0, adapt = Math.min(x.tupsDireito || 0, pedidos);
            setPropostaInicial({ municipio: x.municipio, uf: x.uf, adaptados: adapt, novos: Math.max(0, pedidos - adapt), de: 'acao' });
            setAdminTela('propostas');
          }} />
      )}
      {adminTela === 'sdr' && (
        <FerramentaSdr orelhoes={all} inicial={sdrInicial} onVerMunicipio={verMunicipioAcao}
          onFechar={() => { setAdminTela(null); setSdrInicial(null); }}
          onMenu={() => { setAdminTela(null); setSdrInicial(null); setAdmin(false); }}
          onVoltarPainel={() => { setSdrInicial(null); setAdminTela('acao'); }} />
      )}

      {/* Legenda (retirada no teste a pedido do usuário) */}
      {!regioes && <div className={`legend glass ${booted ? 'in' : ''}`}>
        {REGIOES.map((r) => <span key={r.id}><i style={{ background: r.cor }} />{r.id}</span>)}
        <span><i className="ring" />Estimada</span>
        <span><i className="grupo" />Grupo (nº de orelhões)</span>
      </div>}

      {/* Detalhe */}
      <aside className={`drawer glass ${temaDetalhe ? 'tema-metodo' : ''} ${novidades ? 'drawer-alterna' : ''} ${selected ? 'open' : ''}`} aria-hidden={!selected}>
        {selected && (
          <>
            <button className="close" onClick={() => setSelectedId(null)} aria-label="Fechar">×</button>
            <Trilha />
            {/* em teste (RJ): sem brasão, a foto da cidade vai no topo */}
            {temaDetalhe && <FotoMunicipio info={imgMun} municipio={selected.municipio} />}
            <div className="drawer-hero" style={{ '--c': COR_REGIAO[selected.regiao] }}>
              {temaDetalhe
                ? <BrasaoMunicipio info={imgMun} municipio={selected.municipio} reserva={<div className="hero-icon"><PhoneIcon size={30} /></div>} />
                : <div className="hero-icon"><PhoneIcon size={30} /></div>}
              <span className="badge" style={{ '--c': COR_REGIAO[selected.regiao] }}>{selected.regiao}</span>
              <h2>{selected.localidade}</h2>
              <p>{selected.municipio} · {UF_NOME[selected.uf]}</p>
            </div>

            <div className="actions">
              {fotosSel.fotos.length > 0 ? (
                <button id="btn-street-main" className="btn primary" onClick={() => setVisor(true)}>📷 Ver na rua ({fotosSel.fotos.length} foto{fotosSel.fotos.length > 1 ? 's' : ''})</button>
              ) : (
                <a id="btn-street-main" className="btn primary" target="_blank" rel="noreferrer" href={linkStreetView(selected)} onClick={abrirRua}>📍 Ver na rua (Street View)</a>
              )}
              <button id="btn-orbit" className="btn" onClick={() => setOrbit((o) => !o)}>{orbit ? '⏸ Parar giro' : '🔄 Girar em 3D'}</button>
            </div>
            {regioes && !editing && (TEM_STREET_VIEW_PROPRIO
              ? <small className="dica-marcar">Posição errada? Em <b>Ver na rua</b>, toque no botão redondo <b>📍</b>, mire no pé do orelhão e toque em <b>Marcar aqui</b>.</small>
              : <small className="dica-marcar">Posição errada? No Street View, mire no pé do orelhão e clique em <b>📍 Marcar orelhão aqui</b> (extensão do Chrome).</small>)}

            {!editing && (
              <DadosLocalidade d={dadosLoc?.[selected.id]} a={dadosAcesso?.[selected.id]} carregando={!dadosLoc} p={selected} pref={temaDetalhe ? prefeituras[ufSel]?.[selected.municipio] : null} />
            )}

            {!editing ? (
              <button id="btn-edit-pos" className="btn edit-toggle" onClick={startEdit}>✏️ Editar orelhão</button>
            ) : (
              <div className="edit-box">
                {regioes && marcado && draft && (() => {
                  const km = haversine(selected, draft);
                  return (
                    <div className="marca-confirma" ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}>
                      <b>📍 Nova posição recebida do {marcado}</b>
                      <span><b>{km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`}</b> da posição atual · {draft.lat.toFixed(6)}, {draft.lng.toFixed(6)}</span>
                      <small>No mapa: o pino amarelo é a posição nova. Se precisar, arraste o pino ou use o ajuste fino antes de confirmar.</small>
                      {erroSalvar && <em className="marca-erro">{erroSalvar}</em>}
                      <div className="actions">
                        <button id="btn-marca-salvar" className="btn primary" disabled={saving} onClick={salvarMarcacao}>{saving ? 'Salvando…' : '✔ Salvar'}</button>
                        <button id="btn-marca-descartar" className="btn" onClick={cancelEdit}>Descartar</button>
                      </div>
                    </div>
                  );
                })()}
                <b>Corrigir posição no mapa</b>
                <div className="edit-fontes">
                  <a id="btn-earth" className="btn primary" target="_blank" href={`https://earth.google.com/web/@${selected.lat},${selected.lng},10a,300d,35y,0h,0t,0r`}>🌎 Google Earth</a>
                  <a id="btn-sv-edit" className="btn" target="_blank" href={linkStreetView(selected)} onClick={abrirRua}>🚶 Street View</a>
                </div>
                {TEM_STREET_VIEW_PROPRIO ? (
                  <>
                    <ol className="edit-steps">
                      <li>Abra o <b>Street View</b> (abre em outra aba).</li>
                      <li>Toque no botão redondo <b>📍</b> embaixo e gire a imagem até a <b>mira</b> ficar no <b>pé</b> do orelhão.</li>
                      <li>Toque em <b>Marcar aqui</b>. A aba fecha e você volta para cá para confirmar em <b>✔ Salvar</b>.</li>
                    </ol>
                    <small>Funciona no computador, no tablet e no celular. O Google Earth continua precisando da extensão do Chrome (só no computador).</small>
                  </>
                ) : (
                  <>
                    <ol className="edit-steps">
                      <li>Abra o <b>Google Earth</b> (mais preciso) ou o <b>Street View</b>.</li>
                      <li>Arraste a imagem até a <b>mira amarela</b> ficar sobre o orelhão. No Street View, mire no <b>pé</b> dele.</li>
                      <li>Clique em <b>📍 Marcar orelhão aqui</b>. Você volta para cá com o pino no lugar.</li>
                    </ol>
                    <small>Precisa da extensão “Orelhão Digital” no Chrome (instalação única, pasta <code>extensao</code> do projeto).</small>
                  </>
                )}

                {camPos?.heading != null && (
                  <label className="edit-dist">
                    <span>Ajuste fino: <b>{dist} m</b> à frente da câmera</span>
                    <input type="range" min="0" max="60" step="1" value={dist} onChange={(e) => setDist(+e.target.value)} />
                  </label>
                )}
                <small>Também dá para clicar ou arrastar o pino amarelo direto no mapa, ou digitar a latitude e a longitude abaixo.</small>
              </div>
            )}

            {editing && (
              <FotosEditor orelhaoId={selected.id} {...fotosSel} senha={senha} notify={notify}
                onSenhaOk={() => { try { sessionStorage.setItem('edit_senha', senha); } catch {} }} />
            )}

            {editing && form ? (
              <div className="kv kv-edit">
                <label><span>Latitude</span><input id="edit-lat" className={`mono ${lerNumero(latTxt) === null ? 'invalido' : ''}`} inputMode="decimal" value={latTxt} onChange={(e) => digitarCoord('lat', e.target.value)} /></label>
                <label><span>Longitude</span><input id="edit-lng" className={`mono ${lerNumero(lngTxt) === null ? 'invalido' : ''}`} inputMode="decimal" value={lngTxt} onChange={(e) => digitarCoord('lng', e.target.value)} /></label>
                {CAMPOS.map(([k, rotulo, mono]) => (
                  <label key={k}>
                    <span>{rotulo}</span>
                    <input id={`edit-${k}`} className={mono ? 'mono' : ''} value={form[k]} list={k === 'status' ? 'status-sugeridos' : undefined}
                      placeholder={k === 'status' ? 'Escolha ou digite' : '—'} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                  </label>
                ))}
                <datalist id="status-sugeridos">{STATUS_SUGERIDOS.map((s) => <option key={s} value={s} />)}</datalist>
                <div className="kv-save">
                  <input id="edit-senha" className="edit-input" type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !coordInvalida && salvarEdicao()} placeholder="Senha de edição" />
                  <div className="actions">
                    <button id="btn-save" className="btn primary" disabled={saving || coordInvalida} onClick={salvarEdicao}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>
                    <button id="btn-cancel" className="btn" onClick={cancelEdit}>Cancelar</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="kv">
                <div><span>Latitude</span><b className="mono">{selected.lat.toFixed(5)}</b></div>
                <div><span>Longitude</span><b className="mono">{selected.lng.toFixed(5)}</b></div>
                <div><span>Cód. localidade</span><b className="mono">{selected.cod_localidade || '—'}</b></div>
                <div><span>Cód. IBGE 2022</span><b className="mono">{selected.cod_ibge || '—'}</b></div>
                <div><span>Status</span><b>{selected.status || <em>aguardando dados</em>}</b></div>
                <div><span>Cód. TUP</span><b className="mono">{selected.cod_tup || '—'}</b></div>
              </div>
            )}

            <div className={`origin ${selected.origem}`}>
              <i className={`dot ${selected.origem === 'original' ? 'ok' : 'warn'}`} />
              <div><b>{selected.origem === 'original' ? 'Coordenada original' : 'Coordenada estimada'}</b><small>{selected.origem_desc}</small></div>
            </div>

            <div className="actions">
              <a id="btn-gmaps" className="btn primary" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}>Rota Google Maps</a>
              <a id="btn-waze" className="btn" target="_blank" rel="noreferrer" href={`https://waze.com/ul?ll=${selected.lat},${selected.lng}&navigate=yes`}>Waze</a>
              <button id="btn-copy" className="btn" onClick={() => copy(`${selected.lat}, ${selected.lng}`)}>Copiar coords</button>
            </div>

            {vizinhos.length > 0 && (
              <>
                <div className="section-title">Orelhões vizinhos</div>
                <ul className="near">
                  {vizinhos.map((v) => (
                    <li key={v.id}><button onClick={() => select(v.id)}><span><b>{v.localidade}</b><small>{v.municipio}</small></span><em>{v.km.toFixed(1)} km</em></button></li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </aside>

      {/* Perto de mim */}
      <aside className={`drawer glass ${proximos && !selected ? 'open' : ''}`} aria-hidden={!proximos}>
        {proximos && (
          <>
            <button className="close" onClick={() => setProximos(null)} aria-label="Fechar">×</button>
            <div className="drawer-hero" style={{ '--c': '#60a5fa' }}>
              <div className="hero-icon pulse"><svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="currentColor" /><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" /></svg></div>
              <h2>Perto de você</h2>
              <p>{proximos.length} orelhões mais próximos</p>
            </div>
            <ul className="near">
              {proximos.map((v, i) => (
                <li key={v.id} style={{ animationDelay: `${i * 40}ms` }}><button onClick={() => select(v.id)}><span><b>{v.localidade}</b><small>{v.municipio} · {v.uf}</small></span><em>{v.distancia_km.toFixed(1)} km</em></button></li>
              ))}
            </ul>
          </>
        )}
      </aside>

      {editing && <div className="edit-hint">Modo edição: clique no mapa ou arraste o pino amarelo</div>}

      {visor && selected && fotosSel.fotos.length > 0 && (
        <VisorFotos fotos={fotosSel.fotos} onFechar={() => setVisor(false)}
          streetViewUrl={linkStreetView(selected)} />
      )}

      {toast && !tv && <div className="toast glass">{toast}</div>}

      {tv && <TvRua ref={tvRua} />}
      {/* Modo TV: placar fixo e legenda da etapa, grandes para ler de longe */}
      {tv && tvPlacar && booted && (
        <div className="tv-placar">
          <div><b>{fmt(tvPlacar.total)}</b><small>orelhões</small></div>
          <div><b>{tvPlacar.ufs}</b><small>estados</small></div>
          <div className="loc"><b>{fmt(tvPlacar.muns)}</b><small>municípios</small></div>
        </div>
      )}
      {tv && tvLegenda && (
        <div className="tv-legenda" key={tvLegenda.n}>
          <span className="tv-etapa">{tvLegenda.etapa}</span>
          <strong>{tvLegenda.titulo}</strong>
          {tvLegenda.sub && <small>{tvLegenda.sub}</small>}
          <i className="tv-tempo" style={{ animationDuration: `${tvLegenda.ms}ms` }} />
        </div>
      )}
      {/* Abertura do Brasil, depois do giro: frase sobre o mapa de pontos (no mar, à direita do país) */}
      {tv && tvFrase && (
        <div className="tv-frase" aria-live="polite">
          <span className="tv-frase-seta" aria-hidden="true"><i /></span>
          <div className="tv-frase-texto">
            <span className="tv-frase-pontos" aria-hidden="true">{['#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#a78bfa'].map((c, i) => <i key={c} style={{ background: c, animationDelay: `${0.5 + i * 0.12}s` }} />)}</span>
            <p>Cada pontinho no mapa é um <b>orelhão</b> conectado ao</p>
            <strong>BRASIL</strong>
          </div>
        </div>
      )}
    </main>
  );
}
