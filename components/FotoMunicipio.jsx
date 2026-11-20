'use client';
// Brasão (ou, sem brasão, foto) do município no detalhe do orelhão (em teste). Vem da Wikipédia (gratuita, sem chave):
// primeiro "Município (Estado)", depois "Município"; só vale a página cujo resumo cita o estado.
import { useEffect, useState } from 'react';

const cache = new Map();
const minusculas = (s) => s.replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (w) => w.toLowerCase());

async function resumo(titulo) {
  const r = await fetch('https://pt.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(titulo.replace(/ /g, '_')));
  return r.ok ? r.json() : null;
}

// Bandeira, brasão, mapas e desenhos não servem como "foto do município".
const NAO_E_FOTO = /\.svg|bandeira|bras[aã]o|bras%C3%A3o|flag|coat|escudo|mapa|_map|location|locator|municip_|logo|partilha/i;
// A Wikimedia só gera alguns tamanhos (960 e 500 px funcionam; 720 não).
const tamanhos = (src) => (/\/\d+px-/.test(src) ? [960, 500].map((w) => src.replace(/\/\d+px-/, `/${w}px-`)) : []).concat(src);

const BRASAO = /bras[aã]o|coat[_ ]of[_ ]arms|escudo|armas/i;
const fonte = (it) => it.srcset.map((s) => 'https:' + s.src).reverse(); // maior primeiro

async function imagensDaPagina(titulo) {
  const r = await fetch('https://pt.wikipedia.org/api/rest_v1/page/media-list/' + encodeURIComponent(titulo.replace(/ /g, '_')));
  if (!r.ok) return [];
  return ((await r.json()).items || []).filter((i) => i.type === 'image' && i.srcset?.length);
}

// Preferência: brasão do município; sem brasão, foto da cidade.
async function buscar(municipio, estado) {
  const mun = minusculas(municipio);
  for (const t of [`${mun} (${estado})`, mun]) {
    const j = await resumo(t).catch(() => null);
    const desc = (j?.description || '').toLowerCase();
    // "Mato Grosso" também aparece em "Mato Grosso do Sul"
    const outroEstado = estado === 'Mato Grosso' && desc.includes('mato grosso do sul');
    if (j?.type !== 'standard' || !desc.includes(estado.toLowerCase()) || outroEstado) continue;
    const pagina = j.content_urls?.desktop?.page;
    const imagens = await imagensDaPagina(j.title).catch(() => []);
    // brasão do próprio município (não o do estado ou do Brasil, que algumas páginas mostram)
    const sem = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/_/g, ' ').toLowerCase();
    const doEstado = (t) => /estado|brasil|brazil/.test(t) || (t.includes(sem(estado)) && !t.includes(sem(mun)));
    const brasao = imagens.find((i) => { const t = sem(decodeURIComponent(i.title)); return BRASAO.test(t) && !doEstado(t); });
    if (brasao) return { tipo: 'brasao', srcs: fonte(brasao), pagina };
    // foto principal da página; se for bandeira/mapa, a primeira foto de verdade do artigo
    const img = j.originalimage?.source || '';
    if (img && !NAO_E_FOTO.test(img)) return { tipo: 'foto', srcs: [...new Set([...tamanhos(j.thumbnail?.source || img), img])], pagina };
    const f = imagens.find((i) => !NAO_E_FOTO.test(i.title));
    return f ? { tipo: 'foto', srcs: [...new Set([...tamanhos(fonte(f)[0]), ...fonte(f)])], pagina } : null;
  }
  return null;
}

// (também usado pelo gerador de propostas, para achar o brasão quando a API não acha)
export { buscar as buscarImagemMunicipio };

// Busca (com cache) a imagem do município: { tipo: 'brasao' | 'foto', srcs, pagina } ou null.
export function useImagemMunicipio(municipio, estado, ativo = true) {
  const chave = `${municipio}|${estado}`;
  const [info, setInfo] = useState(() => (ativo ? cache.get(chave) : null));
  useEffect(() => {
    if (!ativo || !municipio) { setInfo(null); return; }
    if (cache.has(chave)) { setInfo(cache.get(chave)); return; }
    setInfo(undefined);
    let vivo = true;
    buscar(municipio, estado).catch(() => null).then((r) => { cache.set(chave, r); if (vivo) setInfo(r); });
    return () => { vivo = false; };
  }, [chave, municipio, estado, ativo]);
  return info; // undefined = carregando
}

// <img> que tenta os endereços em ordem (tamanhos diferentes) antes de desistir.
// A troca é detectada pelos endereços (não pelo objeto), e uma imagem que já estava carregada (cache) avisa onOk de novo.
function ImgTentativas({ srcs, alt, onOk, onFalha }) {
  const [n, setN] = useState(0);
  const chave = srcs.join('|');
  useEffect(() => setN(0), [chave]);
  const pronta = (el) => { if (el?.complete && el.naturalWidth) onOk?.(); };
  return <img key={`${chave}#${n}`} ref={pronta} src={srcs[n]} alt={alt} onLoad={onOk} onError={() => (n + 1 < srcs.length ? setN(n + 1) : onFalha?.())} />;
}
const chaveDe = (info) => (info ? info.srcs.join('|') : String(info));

// Brasão dentro do círculo do cartão do orelhão (substitui o ícone do telefone).
// "ok"/"falhou" guardam o endereço a que se referem: ao trocar de imagem voltam a valer falso sozinhos.
function useEstadoImg(info) {
  const chave = chaveDe(info);
  const [ok, setOk] = useState(null);
  const [falhou, setFalhou] = useState(null);
  return { ok: ok === chave, falhou: falhou === chave, onOk: () => setOk(chave), onFalha: () => setFalhou(chave) };
}

export function BrasaoMunicipio({ info, municipio, reserva }) {
  const { ok, falhou, onOk, onFalha } = useEstadoImg(info);
  if (falhou || info === null || (info && info.tipo !== 'brasao')) return reserva;
  return (
    <div className={`hero-brasao ${ok ? 'ok' : ''}`}>
      {info && <ImgTentativas srcs={info.srcs} alt={`Brasão de ${minusculas(municipio)}`} onOk={onOk} onFalha={onFalha} />}
    </div>
  );
}

// Foto da cidade no topo do detalhe: só quando o município não tem brasão.
export default function FotoMunicipio({ info, municipio }) {
  const { ok, falhou, onOk, onFalha } = useEstadoImg(info);
  if (!info || info.tipo !== 'foto' || falhou) return null;
  return (
    <figure className={`foto-mun ${ok ? 'ok' : ''}`}>
      <ImgTentativas srcs={info.srcs} alt={`Vista de ${minusculas(municipio)}`} onOk={onOk} onFalha={onFalha} />
      <figcaption>
        <b>{minusculas(municipio)}</b>
        {info.pagina && <a href={info.pagina} target="_blank" rel="noreferrer">Foto: Wikipédia</a>}
      </figcaption>
    </figure>
  );
}
