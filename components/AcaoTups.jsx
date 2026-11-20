'use client';

// Administração › Ação TUPs: painel gerencial da ação comercial (mesmos indicadores da plataforma
// CoLR "acao-tups"), organizado em abas, com filtros fixos no topo e ligado ao mapa e às Propostas.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { acaoEntrar, acaoLer, acaoGravar, acaoDesfazer, sdrLer } from '@/lib/supabase';
import {
  lerArquivo, snapshotUtil, montarModelo, indices, calcMetricas, calcExtras, distribuicao, distSdr, distPipeline,
  distRegional, campanhas, relatorioPropostas, listaConferencia, aplicarFiltros, opcoes, cicloGestor, pessoasGestor,
  localidadesGestor, narrativaGestor, corBarra, AJUDA, csvPropostas, baixarTexto, pct, fmtN, fmtMoeda, situacaoTitulo,
  valorExibido, destaqueEncaminhada, destaqueAEnviar, dataBr, VAZIO, mesclarSdr,
} from '@/lib/acaoTups';

const SESSAO = 'acaoTupsSenha';
const CACHE = 'acaoTupsCacheLocal';
const ABAS = [
  ['geral', 'Visão geral'], ['distribuicao', 'Distribuições'], ['propostas', 'Propostas'],
  ['campanhas', 'Campanhas'], ['municipios', 'Municípios'], ['gestor', 'Painel do gestor'],
];
// ações do nome do município nas tabelas (ver no mapa / abrir na Ferramenta SDR)
const AcoesMun = createContext({});
const lerSessao = () => { try { return sessionStorage.getItem(SESSAO) || ''; } catch { return ''; } };

export default function AcaoTups({ onFechar, onVoltar, onVerMunicipio, onGerarProposta, onAbrirSdr }) {
  const [senha, setSenha] = useState(lerSessao);
  const [entrou, setEntrou] = useState(false);
  const [semBanco, setSemBanco] = useState(false);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onFechar(); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onFechar]);
  // já entrou nesta sessão do navegador: confere de novo no banco
  useEffect(() => {
    const s = lerSessao();
    if (!s) return;
    acaoEntrar(s).then((r) => { if (r === 'ok' || r === 'sem-banco') { setSemBanco(r === 'sem-banco'); setEntrou(true); } }).catch(() => {});
  }, []);
  const sair = () => { try { sessionStorage.removeItem(SESSAO); } catch {} setSenha(''); setEntrou(false); };

  return (
    <>
      <div className="admin-fundo prop-fundo" onClick={onFechar} />
      <section className="prop-tela acao-tela" role="dialog" aria-label="Ação TUPs">
        <header className="prop-topo">
          <button type="button" className="prop-voltar" onClick={onVoltar}>‹ Administração</button>
          <div className="prop-titulo">
            <span className="admin-selo">Administração · SDR</span>
            <h2>Ação TUPs</h2>
            <p>Mapeamento das oportunidades e andamento do COLR</p>
          </div>
          {entrou && <button type="button" className="prop-voltar" onClick={sair} title="Sair (pede a senha de novo)">Sair</button>}
          <button type="button" className="admin-x" onClick={onFechar} aria-label="Fechar" title="Fechar (Esc)">×</button>
        </header>
        {entrou
          ? <AcoesMun.Provider value={{ abrirSdr: onAbrirSdr }}><Painel senha={senha} semBanco={semBanco} onVerMunicipio={onVerMunicipio} onGerarProposta={onGerarProposta} /></AcoesMun.Provider>
          : <Entrada onEntrou={(s, sb) => { try { sessionStorage.setItem(SESSAO, s); } catch {} setSenha(s); setSemBanco(sb); setEntrou(true); }} />}
      </section>
    </>
  );
}

function Entrada({ onEntrou }) {
  const [s, setS] = useState('');
  const [erro, setErro] = useState('');
  const [indo, setIndo] = useState(false);
  const entrar = async (e) => {
    e.preventDefault(); setErro(''); setIndo(true);
    try {
      const r = await acaoEntrar(s);
      if (r === 'senha') setErro('Senha incorreta.');
      else onEntrou(s, r === 'sem-banco');
    } catch (err) { setErro('Não foi possível conferir a senha: ' + (err.message || err)); }
    setIndo(false);
  };
  return (
    <form className="acao-entrada" onSubmit={entrar}>
      <div className="acao-cadeado" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10.5" width="14" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.8" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="15.5" r="1.5" fill="currentColor" /></svg>
      </div>
      <b>Acesso só para quem trabalha no SDR</b>
      <span>Informe a senha da equipe.</span>
      <input type="password" value={s} onChange={(e) => setS(e.target.value)} placeholder="Senha" autoFocus autoComplete="current-password" />
      {erro && <p className="prop-erro">{erro}</p>}
      <button type="submit" className="prop-btn grande" disabled={!s || indo}>{indo ? 'Conferindo…' : 'Entrar'}</button>
    </form>
  );
}

function Painel({ senha, semBanco, onVerMunicipio, onGerarProposta }) {
  const [leitura, setLeitura] = useState(undefined); // undefined = carregando; null = sem planilha
  const [meta, setMeta] = useState(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState('geral');
  const [f, setF] = useState({ regional: '', uf: '', consultor: '', status: '', estagio: '' });
  const [carga, setCarga] = useState(false);
  const corpo = useRef(null);

  const carregar = async () => {
    setErro('');
    try {
      const r = semBanco ? { semBanco: true } : await acaoLer(senha);
      if (r?.semBanco) {
        let cache = null; try { cache = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch {}
        setLeitura(snapshotUtil(cache) ? cache : null); setMeta({ semBanco: true });
        return;
      }
      setLeitura(r?.dados && snapshotUtil(r.dados) ? r.dados : null);
      setMeta(r ? { gravadoEm: r.gravado_em, temAnterior: r.tem_anterior } : {});
    } catch (e) { setErro('Não foi possível carregar: ' + (e.message || e)); setLeitura(null); }
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { corpo.current?.scrollTo({ top: 0 }); }, [aba]);

  // registros da Ferramenta SDR (ao vivo): entram por cima da planilha
  const [sdr, setSdr] = useState([]);
  useEffect(() => {
    if (semBanco) return undefined;
    let vivo = true;
    const puxar = () => sdrLer(senha).then((d) => vivo && setSdr(d?.registros || [])).catch(() => {});
    puxar();
    const t = setInterval(() => { if (!document.hidden) puxar(); }, 30000);
    return () => { vivo = false; clearInterval(t); };
  }, [senha, semBanco]);
  const mesclada = useMemo(() => mesclarSdr(leitura, sdr), [leitura, sdr]);
  const base = useMemo(() => (mesclada ? montarModelo(mesclada) : null), [mesclada]);
  const idx = useMemo(() => (mesclada ? indices(mesclada) : null), [mesclada]);

  const filtradas = useMemo(() => (base ? aplicarFiltros(base.modelo, f) : []), [base, f]);
  const escopo = base && filtradas.length !== base.modelo.length ? filtradas : base?.modelo || [];
  const m = useMemo(() => (idx ? calcMetricas(idx, escopo) : null), [idx, escopo]);

  if (leitura === undefined) return <div className="prop-corpo acao-vazio">Carregando a planilha…</div>;
  const filtrosAtivos = Object.values(f).some(Boolean);
  const mudaF = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value, ...(k === 'regional' ? { uf: '' } : {}) }));
  const escopoOpcoes = base ? aplicarFiltros(base.modelo, { regional: f.consultor ? '' : f.regional, uf: f.uf, consultor: f.consultor }) : [];
  const verMun = (r) => onVerMunicipio?.(r.uf, r.municipio);

  return (
    <div className="acao-corpo-wrap">
      {semBanco && <p className="acao-aviso">⚠ Banco ainda não configurado (migração 008). Modo de teste: a planilha fica só neste navegador.</p>}
      {erro && <p className="acao-aviso erro">{erro}</p>}
      <Carga aberta={carga || !leitura} onAlterna={() => setCarga((v) => !v)} leitura={leitura} meta={meta} senha={senha} semBanco={semBanco}
        onCarregou={(d) => { setLeitura(d); setCarga(false); }} onRecarregar={carregar} />

      {leitura && base && (
        <>
          <nav className="acao-abas" role="tablist">
            {ABAS.map(([id, nome]) => <button key={id} role="tab" aria-selected={aba === id} className={aba === id ? 'on' : ''} onClick={() => setAba(id)}>{nome}</button>)}
          </nav>
          {aba !== 'gestor' && (
            <div className="acao-filtros">
              <select value={f.regional} onChange={mudaF('regional')}><option value="">Todas as regionais</option>{opcoes(base.modelo, 'regional').map((v) => <option key={v}>{v}</option>)}</select>
              <select value={f.uf} onChange={mudaF('uf')}><option value="">Todos os estados</option>{opcoes(escopoOpcoes, 'uf').map((v) => <option key={v}>{v}</option>)}</select>
              <select value={f.consultor} onChange={mudaF('consultor')}><option value="">Todos os consultores</option>{opcoes(base.modelo, 'consultor').map((v) => <option key={v}>{v}</option>)}</select>
              <select value={f.status} onChange={mudaF('status')}><option value="">Todos os status</option>{opcoes(escopoOpcoes, 'statusLabel').map((v) => <option key={v}>{v}</option>)}</select>
              <select value={f.estagio} onChange={mudaF('estagio')}><option value="">Todos os estágios</option>{opcoes(escopoOpcoes, 'estagioLabel').map((v) => <option key={v}>{v}</option>)}</select>
              {filtrosAtivos && <button type="button" className="prop-link" onClick={() => setF({ regional: '', uf: '', consultor: '', status: '', estagio: '' })}>Limpar filtros</button>}
              <span className="acao-recorte">{filtrosAtivos ? `Recorte: ${fmtN(filtradas.length)} de ${fmtN(base.modelo.length)} municípios` : `Planilha inteira · ${fmtN(base.modelo.length)} municípios`}</span>
            </div>
          )}
          <div className="prop-corpo acao-corpo" ref={corpo}>
            {aba === 'geral' && <VisaoGeral m={m} leitura={leitura} />}
            {aba === 'distribuicao' && <Distribuicoes idx={idx} filtradas={filtradas} escopo={escopo} />}
            {aba === 'propostas' && <QuadroPropostas idx={idx} filtradas={filtradas} m={m} verMun={verMun} onGerarProposta={onGerarProposta} />}
            {aba === 'campanhas' && <Campanhas idx={idx} filtradas={filtradas} />}
            {aba === 'municipios' && <Conferencia idx={idx} filtradas={filtradas} f={f} verMun={verMun} />}
            {aba === 'gestor' && <Gestor idx={idx} modelo={base.modelo} leitura={leitura} />}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- carga da planilha ----------
function Carga({ aberta, onAlterna, leitura, meta, senha, semBanco, onCarregou, onRecarregar }) {
  const [nome, setNome] = useState(() => { try { return localStorage.getItem('acaoTupsNome') || ''; } catch { return ''; } });
  const [arq, setArq] = useState(null);
  const [msg, setMsg] = useState('');
  const [indo, setIndo] = useState(false);
  const carregar = async () => {
    if (!nome.trim()) { setMsg('Escreva o nome de quem está atualizando.'); return; }
    if (!arq) { setMsg('Escolha a planilha (.xlsx) neste computador.'); return; }
    setIndo(true); setMsg('Lendo a planilha…');
    try {
      try { localStorage.setItem('acaoTupsNome', nome.trim()); } catch {}
      const d = await lerArquivo(arq, nome.trim());
      setMsg('Planilha lida. Gravando…');
      if (semBanco) { try { localStorage.setItem(CACHE, JSON.stringify(d)); } catch {} setMsg('Planilha lida (só neste navegador — banco não configurado).'); }
      else { const r = await acaoGravar(senha, d); setMsg(r?.semBanco ? 'Lida, mas o banco não está configurado.' : 'Planilha atualizada para toda a equipe.'); }
      onCarregou(d); setArq(null);
    } catch (e) { setMsg(e.message || String(e)); }
    setIndo(false);
  };
  const desfazer = async () => {
    if (!confirm('Voltar para a planilha anterior?')) return;
    try { await acaoDesfazer(senha); setMsg('Planilha anterior restaurada.'); onRecarregar(); } catch (e) { setMsg(e.message || String(e)); }
  };
  const snapshot = () => baixarTexto(JSON.stringify({ ...leitura, exportadoEm: dataBr(new Date()) }), (leitura.arquivo || 'acao-tups').replace(/\.xlsx$/i, '') + '-snapshot.json', 'application/json');
  return (
    <div className={`acao-carga ${aberta ? 'aberta' : ''}`}>
      <div className="acao-carga-linha">
        <div className="acao-fonte">
          {leitura ? (
            <>
              <b>📊 {leitura.arquivo || 'Ação TUPs'}</b>
              <span>Planilha de {leitura.geradoEm || '—'}{leitura.atualizadoPor ? ` · atualizada por ${leitura.atualizadoPor}` : ''} · {fmtN(leitura.municipios.length)} municípios · {fmtN(leitura.base?.orelhoes)} TUPs</span>
            </>
          ) : <><b>Nenhuma planilha carregada ainda</b><span>Carregue a “Ação TUPs.xlsx” para montar o painel.</span></>}
        </div>
        <div className="prop-linha">
          {leitura && <button type="button" className="prop-btn sec peq" onClick={snapshot}>Baixar snapshot (JSON)</button>}
          {leitura && <button type="button" className="prop-btn peq" onClick={onAlterna}>{aberta ? 'Fechar' : 'Atualizar a planilha'}</button>}
        </div>
      </div>
      {aberta && (
        <div className="acao-carga-form">
          <label className="prop-campo"><span>Quem está atualizando</span><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" /></label>
          <label className="prop-campo"><span>Planilha (.xlsx) ou snapshot (.json)</span><input type="file" accept=".xlsx,.xls,.json" onChange={(e) => setArq(e.target.files?.[0] || null)} /></label>
          <button type="button" className="prop-btn" disabled={indo} onClick={carregar}>{indo ? 'Lendo…' : 'Carregar planilha'}</button>
          {meta?.temAnterior && <button type="button" className="prop-btn sec" onClick={desfazer}>Desfazer última carga</button>}
          <p className="prop-nota">A leitura nova substitui a anterior para toda a equipe (a anterior fica guardada para desfazer).</p>
        </div>
      )}
      {msg && <p className="prop-msg">{msg}</p>}
    </div>
  );
}

// ---------- blocos visuais ----------
function Kpi({ titulo, valor, sub, cor, ajuda }) {
  const [abre, setAbre] = useState(false);
  return (
    <div className={`acao-kpi ${cor || ''}`}>
      {ajuda && <button type="button" className="acao-ajuda" onClick={() => setAbre((v) => !v)} aria-label="O que significa">?</button>}
      <h4>{titulo}</h4>
      <b>{valor}</b>
      {sub && <small>{sub}</small>}
      {abre && ajuda && <p className="acao-ajuda-txt">{AJUDA[ajuda][1]}</p>}
    </div>
  );
}
function Barras({ linhas, total, rotuloTotal = 'municípios' }) {
  if (!linhas.length) return <p className="acao-vazio">Nenhum no recorte.</p>;
  const max = Math.max(...linhas.map((l) => l.n), 1);
  return (
    <div className="acao-barras">
      {linhas.map((l, i) => (
        <div key={l.rotulo} className={`acao-barra ${destaqueEncaminhada({ statusOrig: l.rotulo }) || /apresentada/i.test(l.rotulo) ? 'enc' : /enviar proposta/i.test(l.rotulo) ? 'env' : ''}`}>
          <span title={l.rotulo}>{l.rotulo}</span>
          <div><i style={{ width: `${(l.n / max) * 100}%`, background: corBarra(l.rotulo, i) }} /></div>
          <b>{fmtN(l.n)}</b>
          <em>{pct(l.n, total)}</em>
        </div>
      ))}
      <p className="prop-nota">Denominador: {fmtN(total)} {rotuloTotal}.</p>
    </div>
  );
}
function Cartao({ titulo, sub, children, className = '' }) {
  return <section className={`prop-bloco acao-cartao ${className}`}><h3>{titulo}</h3>{sub && <p className="acao-sub">{sub}</p>}{children}</section>;
}

// ---------- abas ----------
function VisaoGeral({ m, leitura }) {
  const etapas = [
    { tit: 'Base mapeada', n: m.baseMun, ant: 0, cor: '#64748b', det: `${fmtN(m.baseTups)} TUPs no total` },
    { tit: 'Priorizados (≥3 TUPs)', n: m.priMun, ant: m.baseMun, cor: '#38bdf8', det: `${fmtN(m.priTups)} TUPs nos priorizados` },
    { tit: 'Abordados pelo SDR', n: m.abordados, ant: m.priMun, cor: '#22c55e', det: '1º contato ou status SDR preenchido' },
    { tit: 'Com contato válido', n: m.contatoVal, ant: m.abordados, cor: '#2dd4bf', det: 'Interlocutor útil na prefeitura' },
    { tit: 'Oportunidade comercial', n: m.oportMun, ant: m.contatoVal, cor: '#f59e0b', det: `${fmtN(m.tupsNeg)} TUPs em negociação` },
    { tit: 'Proposta a enviar', n: m.propAEnviarMun, ant: m.oportMun, cor: '#a78bfa', det: `${fmtN(m.propAEnviarTups)} TUPs com “enviar proposta”` },
    { tit: 'Proposta encaminhada', n: m.propEncMun, ant: m.propAEnviarMun || m.oportMun, cor: '#2d8a8a', det: `${m.propEncValor ? fmtMoeda(m.propEncValor) : '—'} · ${fmtN(m.propEncTups)} TUPs` },
  ];
  const max = Math.max(m.baseMun, 1);
  return (
    <div className="acao-grade">
      <p className="acao-resumo">De <b>{fmtN(m.baseMun)}</b> municípios mapeados · <b>{fmtN(m.propEncMun)}</b> propostas encaminhadas · <b>{fmtN(m.propAEnviarMun)}</b> a enviar · {fmtN(m.baseTups)} TUPs na base, <b>{fmtN(m.tupsNeg)}</b> em negociação ativa · {leitura.arquivo} · atualizado {leitura.geradoEm}.</p>
      <div className="acao-kpis cinco">
        <Kpi titulo="TUPs mapeados" valor={fmtN(m.baseTups)} sub={`em ${fmtN(m.baseMun)} municípios`} cor="azul" />
        <Kpi titulo="Abordados pelo SDR" valor={fmtN(m.abordados)} sub="contatos iniciados na Atuação SDR" cor="verde" />
        <Kpi titulo="Oportunidades abertas" valor={fmtN(m.oportMun)} sub={`${fmtN(m.tupsNeg)} TUPs em negociação`} cor="amarelo" />
        <Kpi titulo="Propostas encaminhadas" valor={fmtN(m.propEncMun)} sub={m.propEncValor ? `${fmtMoeda(m.propEncValor)} em valor contratual` : 'com valor na planilha'} cor="teal" />
        <Kpi titulo="Propostas a enviar" valor={fmtN(m.propAEnviarMun)} sub="estágio “enviar proposta”" cor="roxo" />
      </div>
      <Cartao titulo="Evolução da ação" sub="Quantos municípios chegaram a cada etapa e quanto avançaram em relação à etapa anterior.">
        <div className="acao-funil">
          {etapas.map((e) => (
            <div key={e.tit} className="acao-etapa" style={{ '--cor': e.cor }}>
              <div className="acao-etapa-txt"><b>{e.tit}</b><small>{e.det}</small></div>
              <div className="acao-etapa-barra"><i style={{ width: `${Math.max(1.5, (e.n / max) * 100)}%` }} /></div>
              <strong>{fmtN(e.n)}</strong>
              <em>{e.ant ? `${pct(e.n, e.ant)} da etapa ant.` : '100%'}</em>
            </div>
          ))}
        </div>
      </Cartao>
    </div>
  );
}

function Distribuicoes({ idx, filtradas, escopo }) {
  const total = filtradas.length || 1;
  const sdr = distSdr(idx, escopo), pipe = distPipeline(escopo), reg = distRegional(escopo);
  return (
    <div className="acao-grade duas">
      <Cartao titulo="Distribuição por status"><Barras linhas={distribuicao(filtradas, (r) => r.statusLabel)} total={total} /></Cartao>
      <Cartao titulo="Distribuição por estágio"><Barras linhas={distribuicao(filtradas, (r) => r.estagioLabel)} total={total} /></Cartao>
      <Cartao titulo="Etapa 1 — Prospecção SDR" sub={`${fmtN(sdr.total)} municípios abordados pelo SDR neste recorte.`}><Barras linhas={sdr.linhas} total={sdr.total || 1} /></Cartao>
      <Cartao titulo="Etapa 2 — Pipeline comercial" sub={`${fmtN(pipe.total)} municípios no pipeline · ${fmtN(pipe.tups)} TUPs com quantidade pretendida.`}><Barras linhas={pipe.linhas} total={pipe.total || 1} /></Cartao>
      <Cartao titulo="Potencial por regional" className="largo">
        <table className="acao-tabela"><thead><tr><th>Regional</th><th>TUPs mapeados</th><th>Oportunidades abertas</th></tr></thead>
          <tbody>{reg.map((r) => <tr key={r.rotulo}><td>{r.rotulo}</td><td>{fmtN(r.tups)}</td><td>{fmtN(r.oport)}</td></tr>)}</tbody></table>
      </Cartao>
    </div>
  );
}

function QuadroPropostas({ idx, filtradas, m, verMun, onGerarProposta }) {
  const rp = useMemo(() => relatorioPropostas(idx, filtradas), [idx, filtradas]);
  const top = filtradas.filter((r) => r.qtdPretendida > 0).sort((a, b) => b.qtdPretendida - a.qtdPretendida).slice(0, 4);
  const somaTop = top.reduce((s, r) => s + r.qtdPretendida, 0);
  return (
    <div className="acao-grade">
      <div className="acao-kpis">
        <Kpi titulo="Oportunidades abertas" valor={fmtN(m.oportMun)} cor="amarelo" />
        <Kpi titulo="TUPs em negociação" valor={fmtN(m.tupsNeg)} cor="amarelo" />
        <Kpi titulo="Propostas encaminhadas" valor={fmtN(rp.encaminhadas)} cor="teal" />
        <Kpi titulo="Propostas a enviar" valor={fmtN(rp.aEnviar)} cor="roxo" />
        <Kpi titulo="Total TUPs pedidos" valor={fmtN(rp.somaTupsPedidos)} cor="roxo" />
        <Kpi titulo="Soma TUPs direito (base)" valor={fmtN(rp.somaTupsDireito)} cor="azul" />
        <Kpi titulo="Média TUPs pedidos" valor={rp.mediaTupsPedidos.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} />
        <Kpi titulo="Média TUPs direito" valor={rp.mediaTupsDireito.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} />
        <Kpi titulo="Já cliente (carteira)" valor={fmtN(rp.carteira)} cor="verde" />
      </div>
      {somaTop > 0 && m.tupsNeg > 0 && <p className="acao-insight"><b>{top.map((r) => r.municipio).join(', ')}</b> concentram {fmtN(somaTop)} dos {fmtN(m.tupsNeg)} TUPs com quantidade pretendida ({pct(somaTop, m.tupsNeg)}).</p>}
      <Cartao titulo="Quadro de propostas solicitadas" sub="Pipeline comercial e municípios com “enviar proposta”. Compare os TUPs na base (direito) com a quantidade pretendida.">
        <div className="prop-linha"><button type="button" className="prop-btn sec peq" disabled={!rp.itens.length} onClick={() => baixarTexto(csvPropostas(rp), 'propostas-acao-tups.csv', 'text/csv;charset=utf-8')}>Baixar relatório (CSV)</button></div>
        <div className="acao-rolagem">
          <table className="acao-tabela">
            <thead><tr><th>UF</th><th>Município</th><th>SDR</th><th>Consultor</th><th>Situação comercial</th><th>Temperatura</th><th>Valor contratual</th><th>Previsão</th><th>TUPs direito</th><th>TUPs pedidos</th><th>Carteira</th><th /></tr></thead>
            <tbody>
              {rp.itens.length ? rp.itens.map((x) => (
                <tr key={x.uf + x.municipio} className={x.carteira ? 'carteira' : ''}>
                  <td>{x.uf}</td>
                  <td><MunLink r={x} verMun={verMun} /></td>
                  <td>{x.sdr || VAZIO}</td><td>{x.consultor || VAZIO}</td>
                  <td className={destaqueEncaminhada(x) ? 'sit enc' : destaqueAEnviar(x) ? 'sit env' : 'sit'} title={situacaoTitulo(x)}>{x.situacaoLabel || VAZIO}</td>
                  <td><Temp t={x.temperatura} /></td>
                  <td className="num">{valorExibido(x) || VAZIO}</td><td>{x.previsaoFechamento || VAZIO}</td>
                  <td className="num">{fmtN(x.tupsDireito)}</td><td className="num">{fmtN(x.tupsPedidos)}</td>
                  <td>{x.carteira ? <span className="acao-sim">Sim</span> : 'Não'}</td>
                  <td>{onGerarProposta && <button type="button" className="acao-gerar" title="Abrir o gerador de proposta já preenchido" onClick={() => onGerarProposta(x)}>📄 Proposta</button>}</td>
                </tr>
              )) : <tr><td colSpan={12} className="acao-vazio">Nenhuma proposta no recorte.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="prop-nota">Situação comercial: com valor contratual → Proposta encaminhada; senão, o estágio da planilha. Linhas em verde = carteira.{m.pipelineSemQtd ? ` ${fmtN(m.pipelineSemQtd)} município(s) no pipeline ainda sem quantidade pretendida.` : ''}</p>
      </Cartao>
    </div>
  );
}

function Campanhas({ idx, filtradas }) {
  const lista = useMemo(() => campanhas(idx, filtradas), [idx, filtradas]);
  const [sel, setSel] = useState(4);
  const c = lista.find((x) => x.num === sel) || lista[0];
  if (!c) return <p className="acao-vazio">Nenhuma campanha identificada neste recorte.</p>;
  const fatias = [['Proposta', c.proposta, '#c4b5fd'], ['Trabalho ativo', c.trabalhoAtivo, '#f59e0b'], ['Reunião', c.reuniao, '#22c55e'], ['Perdido', c.perdido, '#f87171'], ['Sem classificação', c.semClass, '#64748b'], ['Só na lista', Math.max(0, c.lista - c.contato), '#475569']].filter((x) => x[1] > 0);
  const maxF = Math.max(...fatias.map((x) => x[1]), 1);
  const linhas = [
    ['Municípios nesta campanha', c.lista, 'porte de TUPs na base'], ['Com contato registrado', c.contato, 'status ou estágio preenchido'],
    ['Reunião gerada', c.reuniao, 'agendada ou em agendamento'], ['Proposta solicitada', c.proposta, 'estágio/status “enviar proposta”'],
    ['Trabalho ativo', c.trabalhoAtivo, 'andamento, retorno, agendamento'], ['Andamento / reagendar', c.andamento, 'status na planilha'],
    ['Agendado', c.agendada, 'reunião combinada'], ['Incontatável', c.incontatavel, 'sem retorno válido'],
    ['Perdido', c.perdido, 'não seguiu'], ['Sem classificação', c.semClass, 'contato sem encaixe nas faixas'],
  ];
  return (
    <div className="acao-grade">
      <p className="acao-sub">Campanhas conforme as abas Atuação SDR (1, 2, 3, 4 e 90 TUP). Município que não está numa aba entra pelo porte na base (1–4 ou ≥90 TUPs).</p>
      <div className="acao-camp-botoes">
        {lista.map((x) => <button key={x.num} type="button" className={x.num === c.num ? 'on' : ''} onClick={() => setSel(x.num)}><small>campanha</small><b>{x.num}</b><small>TUP{x.num === 1 ? '' : 's'} · {fmtN(x.lista)}</small></button>)}
      </div>
      <Cartao titulo={`Ação ${c.num} TUP${c.num === 1 ? '' : 's'} — resumo da campanha`}>
        <div className="acao-camp">
          <div className="acao-camp-lista">{linhas.map(([t, n, s], i) => <div key={t} className={i >= 3 ? 'res' : ''}><span>{t}<small>{s}</small></span><b>{fmtN(n)}</b></div>)}</div>
          <div className="acao-barras">
            {fatias.map(([t, n, cor]) => <div key={t} className="acao-barra"><span>{t}</span><div><i style={{ width: `${(n / maxF) * 100}%`, background: cor }} /></div><b>{fmtN(n)}</b><em>{pct(n, c.lista)}</em></div>)}
          </div>
        </div>
      </Cartao>
    </div>
  );
}

function Conferencia({ idx, filtradas, f, verMun }) {
  const [busca, setBusca] = useState('');
  const [ord, setOrd] = useState(['municipio', 1]);
  const [pag, setPag] = useState(1);
  const carteira = !!f.consultor;
  const lista = useMemo(() => {
    const l = listaConferencia(idx, filtradas, f, busca);
    const [col, dir] = ord;
    const numCol = ['orelhoes', 'qtdPretendida', 'valorContratual'].includes(col);
    return [...l].sort((a, b) => {
      if (numCol) return ((Number(a[col]) || -1) - (Number(b[col]) || -1)) * dir;
      if (col === 'carteira') return ((a.carteira ? 1 : 0) - (b.carteira ? 1 : 0)) * dir;
      return String(a[col] || '').localeCompare(String(b[col] || ''), 'pt-BR') * dir;
    });
  }, [idx, filtradas, f, busca, ord]);
  useEffect(() => setPag(1), [busca, f, ord]);
  const POR = 50, paginas = Math.max(1, Math.ceil(lista.length / POR)), fatia = lista.slice((pag - 1) * POR, pag * POR);
  const th = (col, t) => <th className="ord" onClick={() => setOrd(([c, d]) => [col, c === col ? -d : 1])}>{t}{ord[0] === col ? (ord[1] > 0 ? ' ↑' : ' ↓') : ''}</th>;
  const totO = lista.reduce((s, r) => s + (r.orelhoes || 0), 0), totN = lista.reduce((s, r) => s + (r.qtdPretendida || 0), 0);
  return (
    <div className="acao-grade">
      <Cartao titulo="Municípios — conferência" sub={carteira ? `Carteira do consultor ${f.consultor}: todos os municípios com esse nome (inclui fora da regional).` : 'Municípios com histórico de atendimento (status ou estágio) e observação preenchida.'}>
        <input className="acao-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar município, CNPJ ou Ploomes…" />
        <div className="acao-rolagem">
          <table className="acao-tabela conf">
            <thead><tr>
              {th('uf', 'UF')}{th('municipio', 'Município')}{carteira ? th('ploomes', 'Ploomes') : th('regional', 'Regional')}{th('sdr', 'SDR')}{!carteira && th('consultor', 'Consultor')}
              {th('situacaoLabel', 'Situação comercial')}{th('temperatura', 'Temperatura')}{th('orelhoes', carteira ? 'TUPs direito' : 'TUPs oferecidos')}{th('qtdPretendida', carteira ? 'TUPs pedidos' : 'Em negociação')}
              {th('valorContratual', 'Valor contratual')}{th('previsaoFechamento', 'Previsão')}{carteira ? th('carteira', 'Carteira') : <th>Observação</th>}
            </tr></thead>
            <tbody>
              {fatia.length ? fatia.map((r) => (
                <tr key={r.uf + r.municipio + r.cnpj} className={r.carteira && carteira ? 'carteira' : ''}>
                  <td>{r.uf}</td><td><MunLink r={r} verMun={verMun} /></td><td>{(carteira ? r.ploomes : r.regional) || VAZIO}</td><td>{r.sdr || VAZIO}</td>{!carteira && <td>{r.consultor || VAZIO}</td>}
                  <td className={destaqueEncaminhada(r) ? 'sit enc' : destaqueAEnviar(r) ? 'sit env' : 'sit'} title={situacaoTitulo(r)}>{r.situacaoLabel}</td>
                  <td><Temp t={r.temperatura} /></td><td className="num">{r.orelhoes ? fmtN(r.orelhoes) : VAZIO}</td><td className="num">{r.qtdPretendida ? fmtN(r.qtdPretendida) : VAZIO}</td>
                  <td className="num">{valorExibido(r) || VAZIO}</td><td>{r.previsaoFechamento || VAZIO}</td>
                  {carteira ? <td>{r.carteira ? <span className="acao-sim">Sim</span> : 'Não'}</td> : <td className="obs"><span title={r.obs}>{r.obs || VAZIO}</span></td>}
                </tr>
              )) : <tr><td colSpan={12} className="acao-vazio">Nenhum município neste filtro.</td></tr>}
            </tbody>
            {lista.length > 0 && <tfoot><tr><td colSpan={carteira ? 6 : 7}><b>Totais ({fmtN(lista.length)})</b></td><td className="num"><b>{fmtN(totO)}</b></td><td className="num"><b>{fmtN(totN)}</b></td><td colSpan={3} /></tr></tfoot>}
          </table>
        </div>
        <div className="acao-pag">
          <button type="button" className="prop-btn sec peq" disabled={pag <= 1} onClick={() => setPag((p) => p - 1)}>‹ Anterior</button>
          <span>{lista.length ? `${fmtN((pag - 1) * POR + 1)}–${fmtN(Math.min(pag * POR, lista.length))} de ${fmtN(lista.length)}` : 'Nenhum resultado'}</span>
          <button type="button" className="prop-btn sec peq" disabled={pag >= paginas} onClick={() => setPag((p) => p + 1)}>Próxima ›</button>
        </div>
      </Cartao>
    </div>
  );
}

function Gestor({ idx, modelo, leitura }) {
  const m = calcMetricas(idx, modelo), ex = calcExtras(idx, modelo), ciclo = cicloGestor(leitura.geradoEm);
  const pessoas = pessoasGestor(idx, modelo), locs = localidadesGestor(idx, modelo);
  const ritmo = ciclo.decorridos ? Math.round((m.abordados / ciclo.decorridos) * 10) / 10 : 0;
  const kpis = [
    ['abordagem', 'Abordagem SDR', fmtN(m.abordados), [`${pct(m.abordados, m.baseMun)} da base mapeada`, `${pct(m.abordados, m.priMun)} dos priorizados (≥3 TUPs)`]],
    ['contato', 'Contato válido', fmtN(m.contatoVal), [`${pct(m.contatoVal, m.abordados)} dos abordados`, `${pct(m.contatoVal, m.baseMun)} da base`]],
    ['oportunidade', 'Oportunidade comercial', fmtN(m.oportMun), [`${pct(m.oportMun, m.contatoVal)} dos contatos`, `${pct(m.tupsNeg, m.baseTups)} dos TUPs mapeados em negociação`]],
    ['encaminhadas', 'Propostas encaminhadas', fmtN(m.propEncMun), [m.propEncValor ? `${fmtMoeda(m.propEncValor)} em valor contratual` : 'sem valor informado', `${pct(m.propEncMun, m.oportMun)} das oportunidades`]],
    ['aEnviar', 'Propostas a enviar', fmtN(m.propAEnviarMun), [`${pct(m.propAEnviarMun, m.oportMun)} das oportunidades`, `${pct(m.propAEnviarMun, m.baseMun)} da base`]],
    ['reunioes', 'Reuniões / agendamentos', fmtN(ex.reuniao), [`${pct(ex.reuniao, m.contatoVal)} dos contatos válidos`, `${pct(ex.reuniao, m.abordados)} dos abordados SDR`]],
    ['ativo', 'Trabalho ativo', fmtN(ex.trabalhoAtivo), [`${pct(ex.trabalhoAtivo, m.baseMun)} da base`, `${pct(ex.incontatavel, m.abordados)} incontatáveis (sobre abordados)`]],
    ['tups', 'TUPs na proposta', fmtN(m.propTups), [`${pct(m.propTups, m.baseTups)} do potencial mapeado`, `${pct(m.propTups, m.tupsNeg || 1)} do pipeline com qde. pretendida`]],
    ['ritmo', 'Ritmo (dia útil)', ciclo.decorridos ? fmtN(ritmo) : '—', ['municípios abordados / dia útil', `${fmtN(m.contatoVal)} contatos em ${ciclo.decorridos} dias`]],
  ];
  const etapas = [['Base', m.baseMun, 0], ['Priorizados', m.priMun, m.baseMun], ['Abordados SDR', m.abordados, m.priMun], ['Contato válido', m.contatoVal, m.abordados], ['Oportunidade', m.oportMun, m.contatoVal], ['A enviar', m.propAEnviarMun, m.oportMun], ['Encaminhadas', m.propEncMun, m.propAEnviarMun || m.oportMun]];
  const cores = ['#64748b', '#38bdf8', '#22c55e', '#2dd4bf', '#f59e0b', '#a78bfa', '#2d8a8a'];
  return (
    <div className="acao-grade">
      <p className="acao-sub">Ciclo de {ciclo.total} dias úteis · dia {ciclo.decorridos} de {ciclo.total} · planilha inteira (ignora os filtros) · corte {leitura.geradoEm || dataBr(ciclo.fim)}</p>
      <p className="acao-resumo">{narrativaGestor(ciclo, m, ex)}</p>
      <div className="acao-kpis tres">{kpis.map(([aj, t, v, l]) => <Kpi key={aj} titulo={t} valor={v} sub={l.join(' · ')} ajuda={aj} />)}</div>
      <div className="acao-etapas-mini">{etapas.map(([t, n, ant], i) => <div key={t} style={{ '--cor': cores[i] }}><em>{t}</em><b>{fmtN(n)}</b><span>{pct(n, m.baseMun)} da base</span><span>{ant ? pct(n, ant) : '—'} da etapa ant.</span></div>)}</div>
      <div className="acao-grade duas">
        <Cartao titulo="Equipe envolvida">
          <div className="acao-rolagem curta"><table className="acao-tabela"><thead><tr><th>Pessoa</th><th>Papel</th><th>Municípios</th><th>% da base</th><th>Já contactados</th></tr></thead>
            <tbody>{pessoas.map((p) => <tr key={p.papel + p.nome}><td>{p.nome}</td><td>{p.papel}</td><td className="num">{fmtN(p.mun)}</td><td className="num">{p.pctBase}</td><td className="num">{fmtN(p.contactados)}{p.contactados ? <small> ({p.pctContactados})</small> : ''}</td></tr>)}</tbody></table></div>
        </Cartao>
        <Cartao titulo="Localidades e cobertura">
          <table className="acao-tabela"><thead><tr><th>Recorte</th><th>Municípios</th><th>% da base</th><th>Abordados</th><th>% abordados</th></tr></thead>
            <tbody>{locs.map((L) => <tr key={L.rotulo}><td>{L.rotulo}</td><td className="num">{fmtN(L.mun)}</td><td className="num">{L.pctBase}</td><td className="num">{fmtN(L.abord)}</td><td className="num">{L.pctAbord}</td></tr>)}</tbody></table>
        </Cartao>
      </div>
    </div>
  );
}

// município: ver no mapa (Orelhão Digital) ou abrir a pesquisa SDR
function MunLink({ r, verMun }) {
  const { abrirSdr } = useContext(AcoesMun);
  return (
    <span className="acao-mun">
      <button type="button" onClick={() => verMun(r)} title="Ver no mapa do Orelhão Digital">{r.municipio}</button>
      {abrirSdr && <a href="#" onClick={(e) => { e.preventDefault(); abrirSdr(r); }} title="Abrir este município na Ferramenta SDR">SDR</a>}
    </span>
  );
}
function Temp({ t }) {
  if (!t) return VAZIO;
  const k = t.toLowerCase();
  const c = /quent/.test(k) ? 'quente' : /morn/.test(k) ? 'morno' : /fri/.test(k) ? 'frio' : '';
  return <span className={`acao-temp ${c}`}>{t}</span>;
}
