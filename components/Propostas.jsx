'use client';

// Administração › Propostas: o mesmo que a plataforma CoLR (orelhao-digital.pages.dev/colr-gerador/proposta)
// — "Gerar proposta Word" e "Materiais para download" — dentro do Orelhão Digital.
// A mais: município com sugestões enquanto digita, prefeito eleito (TSE) e orelhões do mapa já
// preenchidos, brasão mostrado na hora, tabela de preços à vista e prévia ao lado do formulário.

import { useEffect, useMemo, useRef, useState } from 'react';
import { UF_NOME } from '@/lib/geo';
import { buscarImagemMunicipio } from '@/components/FotoMunicipio';
import {
  DESCRICAO_PADRAO, TRATAMENTOS, MATERIAIS, montarPayload, mensalidadeTabela, moeda, parseQtd,
  carregarMunicipios, sugerirMunicipios, validarMunicipio, buscarBrasao, prepararBrasao, tipoImagem,
  carregarModelo, gerarDocx, baixar, nomeBase, nomeArquivo, proximaVersao, registrarVersao,
} from '@/lib/proposta';

const sem = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const hoje = () => new Date().toLocaleDateString('pt-BR');
const nomeProprio = (s) => String(s ?? '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (w) => w.toLowerCase());

const ICONES = {
  word: <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h7l5 5v13H7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M14 3v5h5M9.5 12l1.2 5 1.3-4 1.3 4 1.2-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  materiais: <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.8" /><path d="M9 4h6l1 3H8zM12 10v6m-3-3 3 3 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  pptx: <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><path d="M12 17v3M8 20h8M8 13l3-3 2 2 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  video: <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="m10 9.5 4.5 2.5-4.5 2.5z" fill="currentColor" /></svg>,
  docx: <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h7l5 5v13H7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M14 3v5h5M10 13h6M10 16.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
};

// ilustrações dos dois cartões da tela inicial
const ILUSTRA = {
  // proposta: folha com texto, selo (brasão) e caneta assinando
  proposta: (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M14 6h24l12 12v38a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" fill="#ffffff" />
      <path d="M38 6v10a2 2 0 0 0 2 2h10" fill="#cdeeee" />
      <rect x="18" y="14" width="14" height="3" rx="1.5" fill="#2f9496" />
      <rect x="18" y="23" width="26" height="2.4" rx="1.2" fill="#9cc9ca" />
      <rect x="18" y="29" width="22" height="2.4" rx="1.2" fill="#9cc9ca" />
      <rect x="18" y="35" width="24" height="2.4" rx="1.2" fill="#9cc9ca" />
      <path d="M18 47c3-3 5 2 8-1s4-2 6 0" stroke="#0d3b3c" strokeWidth="2" strokeLinecap="round" />
      <circle cx="40" cy="47" r="7" fill="#fbbf24" />
      <path d="M40 42.5l1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z" fill="#fff7d6" />
      <path d="M49 33l7-7 4 4-7 7-5 1z" fill="#0d3b3c" />
      <path d="M56 26l2-2a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-2 2" fill="#5cc3c5" />
    </svg>
  ),
  // materiais: pasta com slide de apresentação e um vídeo
  materiais: (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M6 18a3 3 0 0 1 3-3h14l5 5h27a3 3 0 0 1 3 3v29a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" fill="#fde68a" />
      <rect x="13" y="10" width="26" height="18" rx="2.5" fill="#ffffff" />
      <path d="M17 23l5-5 4 3 6-6" stroke="#f472b6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="30" y="14" width="22" height="15" rx="2.5" fill="#0d3b3c" />
      <path d="M39 18.5l5 3-5 3z" fill="#f472b6" />
      <path d="M6 27a3 3 0 0 1 3-3h46a3 3 0 0 1 3 3v25a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" fill="#fbbf24" />
      <path d="M32 33v12m-5-5 5 5 5-5" stroke="#7c4a03" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

export default function Propostas({ onFechar, onVoltar, contexto = null, orelhoes = [], inicial = null }) {
  // inicial: proposta já preenchida (ex.: vinda do quadro da Ação TUPs) — abre direto no gerador
  const [tela, setTela] = useState(inicial ? 'gerar' : 'inicio'); // inicio | gerar | materiais
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onFechar(); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onFechar]);

  const voltar = tela === 'inicio' || inicial ? onVoltar : () => setTela('inicio');
  const rotuloVoltar = inicial?.de === 'acao' ? 'Ação TUPs' : tela === 'inicio' ? 'Administração' : 'Propostas';
  return (
    <>
      <div className="admin-fundo prop-fundo" /* clicar fora não fecha: só pelos botões (evita perder o que está sendo feito) */ />
      <section className="prop-tela" role="dialog" aria-label="Propostas">
        <header className="prop-topo">
          <button type="button" className="prop-voltar" onClick={voltar}>‹ {rotuloVoltar}</button>
          <div className="prop-titulo">
            <span className="admin-selo">Administração</span>
            <h2>{tela === 'gerar' ? 'Gerar proposta Word' : tela === 'materiais' ? 'Materiais para download' : 'Proposta comercial'}</h2>
            <p>{tela === 'gerar' ? 'Modelo padrão “Proposta BASE PARA ENVIO” — preencha os campos e baixe o .docx.'
              : tela === 'materiais' ? 'Apresentação, vídeos e documentos de apoio à proposta.'
                : 'Gere a proposta Word ou baixe apresentações, vídeos e modelos de apoio.'}</p>
          </div>
          <button type="button" className="admin-x" onClick={onFechar} aria-label="Fechar" title="Fechar (Esc)">×</button>
        </header>

        {tela === 'inicio' && (
          <div className="prop-opcoes">
            <button type="button" className="prop-opcao gerar" onClick={() => setTela('gerar')}>
              <i className="prop-ilustra">{ILUSTRA.proposta}</i>
              <div className="prop-opcao-txt">
                <b>Gerar proposta Word</b>
                <span>Preencha município e destinatário e baixe o .docx com o modelo padrão.</span>
              </div>
            </button>
            <button type="button" className="prop-opcao materiais" onClick={() => setTela('materiais')}>
              <i className="prop-ilustra">{ILUSTRA.materiais}</i>
              <div className="prop-opcao-txt">
                <b>Materiais para download</b>
                <span>Apresentações, vídeos e documentos de apoio à proposta.</span>
              </div>
            </button>
          </div>
        )}
        {tela === 'gerar' && <GerarProposta contexto={inicial || contexto} orelhoes={orelhoes} inicial={inicial} />}
        {tela === 'materiais' && <Materiais />}
      </section>
    </>
  );
}

function Materiais() {
  return (
    <div className="prop-corpo prop-materiais">
      {MATERIAIS.map((g) => (
        <section key={g.grupo} className="prop-bloco">
          <h3>{g.grupo}</h3>
          <div className="mat-lista">
            {g.itens.map((it) => (
              <div key={it.nome} className={`mat-item ${it.tipo}`}>
                <i>{ICONES[it.tipo]}</i>
                <div>
                  <b>{it.nome}</b>
                  {it.desc && <span>{it.desc}</span>}
                  <small>{it.arquivo}</small>
                </div>
                {it.baixar
                  ? <a className="prop-btn" href={it.baixar} download={it.arquivo}>Baixar Word</a>
                  : <a className="prop-btn sec" href={it.url} target="_blank" rel="noreferrer">{it.tipo === 'video' ? 'Abrir vídeo ↗' : 'Abrir PowerPoint ↗'}</a>}
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="prop-nota">Vídeos e apresentação abrem no OneDrive/SharePoint da Método (pode pedir login da empresa).</p>
    </div>
  );
}

function GerarProposta({ contexto, orelhoes, inicial = null }) {
  const [f, setF] = useState(() => ({
    nome_municipio: contexto?.municipio ? nomeProprio(contexto.municipio) : '', uf: contexto?.uf || '',
    destinatario_tratamento: 'EXMO. SR.', destinatario_nome: '', destinatario_cargo: 'PREFEITO',
    numero_proposta: '', data_proposta: hoje(),
    qtd_adaptados: inicial ? String(inicial.adaptados ?? '') : '', qtd_novos: inicial ? String(inicial.novos ?? '') : '',
    total_mensal_override: '', descricao_item_investimento: DESCRICAO_PADRAO,
  }));
  const muda = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  const [base, setBase] = useState(null);
  const [mun, setMun] = useState(null); // município confirmado { nome, uf, ibge }
  const [aviso, setAviso] = useState(null); // { msg, sugestoes }
  const [lista, setLista] = useState([]); // sugestões enquanto digita
  const [focoMun, setFocoMun] = useState(false);
  const [prefeito, setPrefeito] = useState(null); // { nome, obs }
  const [nomeAuto, setNomeAuto] = useState(false);
  const [brasao, setBrasao] = useState({ estado: 'espera' }); // espera | buscando | ok | nada | manual
  const [buscarNet, setBuscarNet] = useState(true);
  const [modelo, setModelo] = useState({ estado: 'carregando' });
  const [confirmar, setConfirmar] = useState(null);
  const [gerando, setGerando] = useState(false);
  const [feito, setFeito] = useState(null);
  const [erro, setErro] = useState('');
  const arquivoRef = useRef(null);

  useEffect(() => { carregarMunicipios().then(setBase).catch(() => setBase([])); }, []);
  useEffect(() => {
    carregarModelo().then((b) => setModelo({ estado: 'ok', mb: b.length / 1048576 })).catch((e) => setModelo({ estado: 'erro', msg: e.message }));
  }, []);

  // confere o município na base (IBGE · base Método) logo depois de parar de digitar
  useEffect(() => {
    if (!base) return;
    const nome = f.nome_municipio.trim();
    if (mun && sem(nome) === sem(mun.nome) && f.uf === mun.uf) return; // continua confirmado
    setMun(null);
    if (nome.length < 2) { setAviso(null); return; }
    const t = setTimeout(() => {
      const r = validarMunicipio(base, nome, f.uf);
      // digitando sem UF: não "adivinha" o estado ainda (ex.: "Conquista" antes de "Vitória da Conquista")
      if (focoMun && r.ufAuto) { setAviso(null); return; }
      if (r.ok) {
        setMun({ nome: r.nome, uf: r.uf, ibge: r.ibge });
        setAviso(null);
        if (r.nome !== nome || r.uf !== f.uf) setF((o) => ({ ...o, nome_municipio: r.nome, uf: r.uf }));
      } else setAviso(focoMun ? null : r);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, f.nome_municipio, f.uf, focoMun]);

  useEffect(() => {
    if (!base || !focoMun) { setLista([]); return; }
    setLista(mun ? [] : sugerirMunicipios(base, f.nome_municipio, f.uf));
  }, [base, f.nome_municipio, f.uf, focoMun, mun]);

  const escolher = (m) => { setF((o) => ({ ...o, nome_municipio: m.nome, uf: m.uf })); setLista([]); setFocoMun(false); };

  // orelhões do Orelhão Digital neste município (sugestão para "TUPs adaptados")
  const noMapa = useMemo(() => {
    if (!mun) return 0;
    const k = sem(mun.nome);
    return orelhoes.filter((p) => p.uf === mun.uf && sem(p.municipio) === k).length;
  }, [mun, orelhoes]);

  // prefeito eleito (TSE 2024) dos dados do Orelhão Digital
  useEffect(() => {
    setPrefeito(null);
    if (!mun) return;
    let vivo = true;
    fetch(`/dados/prefeituras/${mun.uf}.json`).then((r) => (r.ok ? r.json() : {})).then((d) => {
      if (!vivo) return;
      const k = sem(mun.nome);
      const reg = Object.entries(d).find(([nome]) => sem(nome) === k)?.[1];
      const nome = reg?.oficial?.nome || reg?.prefeito;
      if (!nome) return;
      setPrefeito({ nome, obs: reg?.oficial ? `${reg.oficial.fonte || 'TSE'} · ${reg.oficial.obs || ''}`.trim() : 'dados da prefeitura' });
      setF((o) => (o.destinatario_nome && !nomeAuto ? o : { ...o, destinatario_nome: nome.toUpperCase() }));
      setNomeAuto(true);
    }).catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mun]);

  // brasão: busca assim que o município é confirmado
  useEffect(() => {
    if (brasao.estado === 'manual') return;
    if (!mun || !buscarNet) { setBrasao({ estado: 'espera' }); return; }
    let vivo = true;
    setBrasao({ estado: 'buscando' });
    (async () => {
      const wiki = await buscarImagemMunicipio(mun.nome, UF_NOME[mun.uf] || '').catch(() => null);
      const extras = wiki?.tipo === 'brasao' ? wiki.srcs : [];
      const hit = await buscarBrasao(mun.nome, mun.uf, mun.ibge, extras);
      if (!vivo) return;
      if (!hit) { setBrasao({ estado: 'nada' }); return; }
      setBrasao({ estado: 'ok', bytes: hit.bytes, titulo: hit.titulo, url: URL.createObjectURL(new Blob([hit.bytes], { type: tipoImagem(hit.bytes) })) });
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mun?.nome, mun?.uf, buscarNet]);

  const enviarBrasao = async (e) => {
    const arq = e.target.files?.[0];
    if (!arq) return;
    const bytes = new Uint8Array(await arq.arrayBuffer());
    setBrasao({ estado: 'manual', bytes, titulo: `Enviado: ${arq.name}`, url: URL.createObjectURL(arq) });
    e.target.value = '';
  };

  const adapt = parseQtd(f.qtd_adaptados), novos = parseQtd(f.qtd_novos);
  const qtdOk = adapt !== null && novos !== null && adapt + novos > 0;
  const p = useMemo(() => montarPayload(f), [f]);
  const faltando = [
    !mun && 'município confirmado',
    !f.numero_proposta.trim() && 'número da proposta',
    !qtdOk && 'quantidade de TUPs',
  ].filter(Boolean);
  const pronto = !faltando.length && modelo.estado === 'ok';
  const arquivo = pronto ? nomeArquivo(p, proximaVersao(nomeBase(p))) : '';

  const gerar = async () => {
    setErro(''); setGerando(true);
    try {
      const modeloBytes = await carregarModelo();
      const img = brasao.bytes ? await prepararBrasao(brasao.bytes) : null;
      const out = gerarDocx(modeloBytes, p, { brasao: img, avisoSemBrasao: buscarNet && !img });
      const b = nomeBase(p), v = proximaVersao(b), nome = nomeArquivo(p, v);
      baixar(out, nome);
      registrarVersao(b, v);
      setFeito(nome); setConfirmar(null);
    } catch (e) { setErro(e.message || String(e)); }
    setGerando(false);
  };

  const nivel = p._pontos >= 4 ? 4 : p._pontos;
  return (
    <div className="prop-corpo prop-gerar">
      <form className="prop-form" onSubmit={(e) => e.preventDefault()}>
        <section className="prop-bloco">
          <h3>1 · Município e destinatário</h3>
          <div className="prop-grade">
            <label className="prop-campo mun">
              <span>Município</span>
              <input value={f.nome_municipio} onChange={muda('nome_municipio')} onFocus={() => setFocoMun(true)} onBlur={() => setTimeout(() => setFocoMun(false), 150)}
                placeholder="Digite o nome…" autoComplete="off" className={aviso ? 'invalido' : mun ? 'valido' : ''} />
              {lista.length > 0 && (
                <ul className="prop-sugestoes">
                  {lista.map((m) => <li key={m.ibge}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(m)}>{m.nome} <small>{m.uf}</small></button></li>)}
                </ul>
              )}
            </label>
            <label className="prop-campo campo-uf">
              <span>UF</span>
              <input value={f.uf} maxLength={2} onChange={(e) => setF((o) => ({ ...o, uf: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) }))} placeholder="BA" className={mun ? 'valido' : ''} />
            </label>
          </div>
          {mun && <p className="prop-msg ok">✔ Município confirmado: {mun.nome} — {mun.uf} <small>IBGE {mun.ibge}</small></p>}
          {!base && <p className="prop-msg">Carregando a base de municípios…</p>}
          {aviso && (
            <div className="prop-msg erro">
              {aviso.msg}
              {aviso.sugestoes?.length > 0 && <div className="prop-chips">{aviso.sugestoes.map((m) => <button type="button" key={m.ibge} onClick={() => escolher(m)}>{m.nome} — {m.uf}</button>)}</div>}
            </div>
          )}

          <div className="prop-grade tres">
            <label className="prop-campo">
              <span>Tratamento</span>
              <select value={f.destinatario_tratamento} onChange={muda('destinatario_tratamento')}>{TRATAMENTOS.map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label className="prop-campo largo">
              <span>Nome do destinatário</span>
              <input value={f.destinatario_nome} onChange={(e) => { setNomeAuto(false); muda('destinatario_nome')(e); }} placeholder="Nome do prefeito(a)" />
            </label>
            <label className="prop-campo">
              <span>Cargo</span>
              <input value={f.destinatario_cargo} onChange={muda('destinatario_cargo')} />
            </label>
          </div>
          {prefeito && <p className="prop-dica">👤 Prefeito(a) eleito(a): <b>{nomeProprio(prefeito.nome)}</b> <small>{prefeito.obs}</small>{!nomeAuto && <button type="button" onClick={() => { setF((o) => ({ ...o, destinatario_nome: prefeito.nome.toUpperCase() })); setNomeAuto(true); }}>usar este nome</button>}</p>}

          <div className="prop-brasao">
            <div className={`prop-brasao-img ${brasao.estado}`}>
              {brasao.url ? <img src={brasao.url} alt="Brasão do município" /> : <span>{brasao.estado === 'buscando' ? '…' : '?'}</span>}
            </div>
            <div className="prop-brasao-info">
              <b>Brasão do município</b>
              <span>{brasao.estado === 'buscando' ? `Buscando o brasão de ${mun?.nome}…`
                : brasao.estado === 'ok' || brasao.estado === 'manual' ? brasao.titulo
                  : brasao.estado === 'nada' ? 'Não achei o brasão automaticamente. Envie a imagem — sem ela, o Word sai com o aviso “Cole aqui o brasão”.'
                    : !buscarNet ? 'Busca automática desligada: fica a imagem original do modelo.'
                      : 'Buscado na internet assim que o município for confirmado.'}</span>
              <div className="prop-linha">
                <label className="prop-check"><input type="checkbox" checked={buscarNet} onChange={(e) => { setBuscarNet(e.target.checked); if (brasao.estado === 'manual') setBrasao({ estado: 'espera' }); }} /> Buscar na internet</label>
                <button type="button" className="prop-btn sec peq" onClick={() => arquivoRef.current?.click()}>Enviar brasão (.jpg/.png)</button>
                <input ref={arquivoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={enviarBrasao} />
              </div>
            </div>
          </div>
        </section>

        <section className="prop-bloco">
          <h3>2 · Proposta</h3>
          <div className="prop-grade">
            <label className="prop-campo"><span>Número da proposta</span><input value={f.numero_proposta} onChange={muda('numero_proposta')} placeholder="ex.: 2026-0457" /></label>
            <label className="prop-campo"><span>Data</span><input value={f.data_proposta} onChange={muda('data_proposta')} placeholder="dd/mm/aaaa" /></label>
            <label className="prop-campo"><span>TUPs adaptados <small>(orelhão existente)</small></span><input type="number" min="0" value={f.qtd_adaptados} onChange={muda('qtd_adaptados')} placeholder="ex.: 0" /></label>
            <label className="prop-campo"><span>TUPs novos</span><input type="number" min="0" value={f.qtd_novos} onChange={muda('qtd_novos')} placeholder="ex.: 5" /></label>
          </div>
          {mun && noMapa > 0 && (
            <p className="prop-dica">📍 No mapa do Orelhão Digital, {mun.nome} tem <b>{noMapa} {noMapa > 1 ? 'orelhões' : 'orelhão'}</b>.
              {String(noMapa) !== f.qtd_adaptados && <button type="button" onClick={() => setF((o) => ({ ...o, qtd_adaptados: String(noMapa), qtd_novos: o.qtd_novos || '0' }))}>usar como TUPs adaptados</button>}</p>
          )}
          <div className="prop-tabela" aria-label="Tabela comercial (valor mensal)">
            {[1, 2, 3].map((n) => <div key={n} className={nivel === n ? 'on' : ''}><b>{n} TUP{n > 1 ? 's' : ''}</b><span>{moeda(mensalidadeTabela(n))}/mês</span></div>)}
            <div className={nivel === 4 ? 'on' : ''}><b>4 ou mais</b><span>{moeda(1800)} por ponto</span></div>
          </div>
          <details className="prop-raro" open={!!f.total_mensal_override}>
            <summary>Valor mensal diferente da tabela (uso raro)</summary>
            <label className="prop-campo"><span>Total mensal manual (R$)</span><input value={f.total_mensal_override} onChange={muda('total_mensal_override')} placeholder="ex.: 9.000,00" /></label>
          </details>
        </section>

        <section className="prop-bloco">
          <h3>3 · Item de investimento</h3>
          <label className="prop-campo">
            <span>Descrição do serviço <small>(padrão da proposta — editável)</small></span>
            <textarea rows={5} value={f.descricao_item_investimento} onChange={muda('descricao_item_investimento')} />
          </label>
          {f.descricao_item_investimento !== DESCRICAO_PADRAO && <button type="button" className="prop-link" onClick={() => setF((o) => ({ ...o, descricao_item_investimento: DESCRICAO_PADRAO }))}>Voltar ao texto padrão</button>}
        </section>
      </form>

      {/* prévia fixa ao lado */}
      <aside className="prop-previa">
        <div className="prop-valor">
          <span>Total mensal{p._manual ? ' (manual)' : ''}</span>
          <b>{qtdOk ? moeda(p._total) : '—'}</b>
          <small>{qtdOk ? `${p._pontos} ponto${p._pontos > 1 ? 's' : ''} · ${moeda(p._unitario)} por ponto` : 'Informe os TUPs adaptados e novos'}</small>
          {qtdOk && <em>{p.total_mensal_extenso}</em>}
        </div>
        <dl className="prop-resumo">
          <dt>Destinatário</dt>
          <dd>À PREFEITURA MUNICIPAL DE {p.nome_municipio_maiusculo || '—'}{p.uf ? ` - ${p.uf}` : ''}<br />A/C DO {p.destinatario_tratamento} {p.destinatario_nome || '—'} ({p.destinatario_cargo})</dd>
          <dt>Proposta</dt>
          <dd>Nº {p.numero_proposta || '—'} · {p.data_proposta}</dd>
          <dt>Pontos TUP</dt>
          <dd>{p.qtd_adaptados} adaptado(s) + {p.qtd_novos} novo(s) = <b>{p.qtd_pontos}</b></dd>
          <dt>Brasão</dt>
          <dd>{brasao.estado === 'ok' || brasao.estado === 'manual' ? '✔ ' + brasao.titulo : brasao.estado === 'buscando' ? 'buscando…' : buscarNet ? 'aviso “Cole aqui o brasão”' : 'imagem original do modelo'}</dd>
          <dt>Modelo</dt>
          <dd>{modelo.estado === 'ok' ? `Proposta BASE PARA ENVIO (${modelo.mb.toFixed(1)} MB)` : modelo.estado === 'erro' ? <span className="prop-erro">{modelo.msg}</span> : 'carregando…'}</dd>
        </dl>
        {arquivo && <p className="prop-arquivo">📄 {arquivo}</p>}
        {faltando.length > 0 && <p className="prop-falta">Falta: {faltando.join(', ')}.</p>}
        {erro && <p className="prop-erro">{erro}</p>}
        {feito && <p className="prop-msg ok">✔ Baixado: {feito} (pasta Downloads)</p>}
        <button type="button" className="prop-btn grande" disabled={!pronto || gerando} onClick={() => { setFeito(null); setConfirmar(arquivo); }}>
          {ICONES.word}<span>Gerar proposta Word</span>
        </button>
        <p className="prop-nota">Textos jurídicos permanecem no modelo Word. Cada nova geração do mesmo nº/município/data vira v2, v3…</p>
      </aside>

      {confirmar && (
        <div className="prop-modal" onClick={(e) => { if (e.target === e.currentTarget) setConfirmar(null); }}>
          <div className="prop-modal-caixa" role="dialog" aria-label="Confirmar geração">
            <h3>Confirmar e gerar o Word</h3>
            <dl className="prop-resumo">
              <dt>Município</dt><dd>{p.nome_municipio} — {p.uf}</dd>
              <dt>Destinatário</dt><dd>{p.destinatario_tratamento} {p.destinatario_nome || '—'} ({p.destinatario_cargo})</dd>
              <dt>Proposta</dt><dd>Nº {p.numero_proposta} · {p.data_proposta}</dd>
              <dt>Valores</dt><dd>{p.qtd_pontos} pontos · {p.total_mensal}/mês · {p.valor_unitario}/ponto</dd>
              <dt>Arquivo</dt><dd>{confirmar}</dd>
            </dl>
            <div className="prop-linha fim">
              <button type="button" className="prop-btn sec" onClick={() => setConfirmar(null)}>Cancelar</button>
              <button type="button" className="prop-btn" disabled={gerando} onClick={gerar}>{gerando ? 'Gerando…' : 'Confirmar e baixar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
