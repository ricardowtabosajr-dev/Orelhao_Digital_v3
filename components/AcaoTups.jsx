'use client';

// Administração › Ação TUPs: cópia fiel da página "acao-tups" da plataforma CoLR (página única:
// evolução da ação, conferência, propostas, gráficos 3D, regional, campanhas e painel geral).
// A versão anterior (em 6 abas) está guardada na marca do git "acao-tups-versao-1".

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { acaoEntrar, acaoLer, acaoGravar, acaoDesfazer, sdrLer } from '@/lib/supabase';
import {
  lerArquivo, snapshotUtil, montarModelo, indices, calcMetricas, calcExtras, distribuicao, distSdr, distPipeline,
  distRegional, campanhas, relatorioPropostas, listaConferencia, aplicarFiltros, opcoes, cicloGestor, consultoresPainel,
  faixaContactado, coberturaRegional, totaisConferencia, tupsDireito, tupsPedidos, narrativaGestor, corBarra, AJUDA,
  csvPropostas, baixarTexto, pct, fmtN, fmtMoeda, situacaoTitulo, valorExibido, destaqueEncaminhada, destaqueAEnviar,
  dataBr, VAZIO, mesclarSdr, nk, chaveMun,
} from '@/lib/acaoTups';

const SESSAO = 'acaoTupsSenha';
const CACHE = 'acaoTupsCacheLocal';
const POR_PAGINA = 50;
// Registros da Ferramenta SDR entrando ao vivo por cima da planilha: desligado para ficar idêntico ao link
// (recurso só do nosso sistema; decidir depois se volta nesta versão).
const SDR_AO_VIVO = false;
const lerSessao = () => { try { return sessionStorage.getItem(SESSAO) || ''; } catch { return ''; } };
const FILTROS_VAZIOS = { regional: '', uf: '', consultor: '', status: '', estagio: '' };
const COR_REGIONAL = { NNE: '#f59e0b', CO: '#a78bfa', MG_ES_RJ: '#38bdf8', SUL_SP: '#f472b6', 'Sem regional': '#64748b', Norte: '#22c55e', Nordeste: '#f59e0b', 'Centro-Oeste': '#a78bfa', Sudeste: '#38bdf8', Sul: '#f472b6' };
const corReg = (reg) => COR_REGIONAL[reg] || '#64748b';

export default function AcaoTups({ onFechar, onVoltar, onAbrirSdr }) {
  const [senha, setSenha] = useState(lerSessao);
  const [entrou, setEntrou] = useState(false);
  const [semBanco, setSemBanco] = useState(false);
  // os botões vão para a faixa principal do topo (espaço reservado em Home)
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(document.getElementById('topbar-acao')); }, []);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.a2-modal')) onFechar(); };
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
      <section className="prop-tela acao-tela a2-tela" role="dialog" aria-label="Ação TUPs">
        {slot && createPortal(
          <>
            {entrou && onAbrirSdr && (
              <button type="button" className="cta" onClick={() => onAbrirSdr({})} title="Abrir a Ferramenta SDR">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
                <span className="rotulo">Ferramenta - SDR</span>
              </button>
            )}
            <button type="button" className="cta" onClick={onVoltar} title="Voltar à Administração">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="2" /></svg>
              <span className="rotulo">Menu</span>
            </button>
            {entrou && (
              <button type="button" className="cta" onClick={sair} title="Sair (pede a senha de novo)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l-4 4 4 4M5 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span className="rotulo">Sair</span>
              </button>
            )}
            <button type="button" className="cta fechar-acao" onClick={onFechar} aria-label="Fechar" title="Fechar (Esc)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            </button>
          </>,
          slot,
        )}
        {entrou
          ? <Painel senha={senha} semBanco={semBanco} abrirSdr={onAbrirSdr} />
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
    <div className="a2-gate">
      <form className="a2-gate-box" onSubmit={entrar} autoComplete="off">
        <h2>Painel de Ação</h2>
        <p>Acesso só para quem trabalha no SDR. Informe a senha.</p>
        <input type="password" value={s} onChange={(e) => setS(e.target.value)} placeholder="Senha" autoFocus />
        <div className="a2-gate-err">{erro}</div>
        <button type="submit" disabled={!s || indo}>{indo ? 'Conferindo…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

function Painel({ senha, semBanco, abrirSdr }) {
  const [leitura, setLeitura] = useState(undefined); // undefined = carregando; null = sem planilha
  const [meta, setMeta] = useState(null);
  const [erro, setErro] = useState('');
  const [f, setF] = useState(FILTROS_VAZIOS);

  const carregar = async () => {
    setErro('');
    try {
      const r = semBanco ? { semBanco: true } : await acaoLer(senha);
      if (r?.semBanco) {
        let cache = null; try { cache = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch {}
        setLeitura(snapshotUtil(cache) ? cache : (cache?.limpo ? cache : null)); setMeta({ semBanco: true });
        return;
      }
      setLeitura(r?.dados && (snapshotUtil(r.dados) || r.dados.limpo) ? r.dados : null);
      setMeta(r ? { gravadoEm: r.gravado_em, temAnterior: r.tem_anterior } : {});
    } catch (e) { setErro('Não foi possível carregar: ' + (e.message || e)); setLeitura(null); }
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // registros da Ferramenta SDR (ao vivo): entram por cima da planilha
  const [sdr, setSdr] = useState([]);
  useEffect(() => {
    if (semBanco || !SDR_AO_VIVO) return undefined;
    let vivo = true;
    const puxar = () => sdrLer(senha).then((d) => vivo && setSdr(d?.registros || [])).catch(() => {});
    puxar();
    const t = setInterval(() => { if (!document.hidden) puxar(); }, 30000);
    return () => { vivo = false; clearInterval(t); };
  }, [senha, semBanco]);
  const util = snapshotUtil(leitura) ? leitura : null;
  const mesclada = useMemo(() => (util ? mesclarSdr(util, sdr) : null), [util, sdr]);
  const base = useMemo(() => (mesclada ? montarModelo(mesclada) : null), [mesclada]);
  const idx = useMemo(() => (mesclada ? indices(mesclada) : null), [mesclada]);
  const filtradas = useMemo(() => (base ? aplicarFiltros(base.modelo, f) : []), [base, f]);
  const escopo = base && filtradas.length !== base.modelo.length ? filtradas : base?.modelo || [];
  const m = useMemo(() => (idx ? calcMetricas(idx, escopo) : null), [idx, escopo]);


  if (leitura === undefined) return <main className="a2"><p className="a2-note">Carregando a planilha…</p></main>;
  const textoLeitura = util
    ? `${fmtN(base.modelo.length)} municípios únicos · ${fmtN(util.base?.orelhoes)} TUPs na base.${util.atualizadoPor ? ` Atualizada por ${util.atualizadoPor}.` : ''}`
    : leitura?.limpo ? 'Dados zerados. Carregue a planilha (ex.: Ação TUPs (13).xlsx).' : 'Ainda não há planilha carregada.';

  return (
    <main className="a2">
      {semBanco && <p className="a2-note a2-aviso">⚠ Banco ainda não configurado (migração 008). Modo de teste: a planilha fica só neste navegador.</p>}
      {erro && <p className="a2-note a2-aviso">{erro}</p>}
      <p className="a2-note">{textoLeitura}</p>
      <Carga leitura={util} meta={meta} senha={senha} semBanco={semBanco} onCarregou={(d) => { setLeitura(d); setF(FILTROS_VAZIOS); }} onRecarregar={carregar} />
      {util && base && m && (
        <PainelDados util={util} base={base} idx={idx} f={f} setF={setF} filtradas={filtradas} escopo={escopo} m={m} abrirSdr={abrirSdr} />
      )}
    </main>
  );
}

// ---------- carga da planilha ----------
function Carga({ leitura, meta, senha, semBanco, onCarregou, onRecarregar }) {
  const [nome, setNome] = useState(() => { try { return localStorage.getItem('acaoTupsNome') || ''; } catch { return ''; } });
  const [arq, setArq] = useState(null);
  const [msg, setMsg] = useState('');
  const [indo, setIndo] = useState(false);
  const arquivo = useRef(null);
  const gravar = async (d, ok) => {
    if (semBanco) { try { localStorage.setItem(CACHE, JSON.stringify(d)); } catch {} setMsg(ok + ' (só neste navegador — banco não configurado).'); }
    else { const r = await acaoGravar(senha, d); setMsg(r?.semBanco ? 'Lida, mas o banco não está configurado.' : ok); }
    onCarregou(d);
  };
  const carregar = async () => {
    if (!nome.trim()) { setMsg('Escreva o nome de quem está atualizando.'); return; }
    if (!arq) { setMsg('Escolha a planilha (.xlsx) neste computador.'); return; }
    setIndo(true); setMsg('Lendo a planilha…');
    try {
      try { localStorage.setItem('acaoTupsNome', nome.trim()); } catch {}
      const d = await lerArquivo(arq, nome.trim());
      setMsg('Planilha lida. Gravando…');
      await gravar(d, 'Planilha atualizada para toda a equipe.');
      setArq(null); if (arquivo.current) arquivo.current.value = '';
    } catch (e) { setMsg(e.message || String(e)); }
    setIndo(false);
  };
  const zerar = async () => {
    if (!confirm('Zerar os dados deixa a tela vazia para toda a equipe, até a próxima planilha. Continuar?')) return;
    setIndo(true);
    try { await gravar({ limpo: true, atualizadoPor: nome.trim() || '' }, 'Dados zerados. Carregue a planilha seguinte.'); } catch (e) { setMsg(e.message || String(e)); }
    setIndo(false);
  };
  const desfazer = async () => {
    if (!confirm('Voltar para a planilha anterior?')) return;
    try { await acaoDesfazer(senha); setMsg('Planilha anterior restaurada.'); onRecarregar(); } catch (e) { setMsg(e.message || String(e)); }
  };
  const snapshot = () => baixarTexto(JSON.stringify({ ...leitura, exportadoEm: dataBr(new Date()) }), (leitura.arquivo || 'acao-tups').replace(/\.xlsx$/i, '') + '-snapshot.json', 'application/json');
  return (
    <div className="a2-card">
      <h2>Atualizar a planilha</h2>
      <p className="a2-note">Quem atualiza coloca o nome e escolhe o arquivo neste computador. A leitura nova substitui a anterior. Zerar dados deixa a tela vazia, para conferir se a planilha seguinte realmente entrou.</p>
      <div className="a2-filters">
        <input type="text" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" autoComplete="name" />
        <input ref={arquivo} type="file" accept=".xlsx,.xls,.json" onChange={(e) => setArq(e.target.files?.[0] || null)} />
        <button type="button" className="a2-carregar" disabled={indo} onClick={carregar}>{indo ? 'Lendo…' : 'Carregar planilha'}</button>
        <button type="button" className="a2-zerar" disabled={indo || !leitura} onClick={zerar}>Zerar dados</button>
        {leitura && <button type="button" className="a2-pag" onClick={snapshot}>Baixar snapshot completo (JSON)</button>}
        {meta?.temAnterior && <button type="button" className="a2-pag" onClick={desfazer}>Desfazer última carga</button>}
      </div>
      {msg && <p className="a2-note">{msg}</p>}
    </div>
  );
}

// ---------- painel (página única, na ordem do link) ----------
function PainelDados({ util, base, idx, f, setF, filtradas, escopo, m, abrirSdr }) {
  const modelo = base.modelo;
  const recorte = filtradas.length !== modelo.length;
  const mudaF = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value, ...(k === 'regional' ? { uf: '' } : {}) }));
  const escopoOpcoes = aplicarFiltros(modelo, { regional: f.consultor ? '' : f.regional, uf: '', consultor: f.consultor });
  const notaRecorte = (recorte ? `Recorte com ${fmtN(filtradas.length)} município(s) — KPIs e funil seguem o filtro.` : `Planilha inteira — ${fmtN(modelo.length)} municípios únicos na aba Municípios.`)
    + (f.consultor ? ` Consultor selecionado: carteira em todas as regionais${f.regional ? ` (filtro regional “${f.regional}” não restringe)` : ''}.` : '');
  const verMun = (r) => abrirSdr?.(r);
  const carteiraConf = !!f.consultor;
  const stTxt = Object.keys(base.mapaStatus).sort().map((s) => `${s} (${base.mapaStatus[s]})`).join('; ');
  const estTxt = Object.keys(base.mapaEstagio).sort().map((s) => `${s} (${base.mapaEstagio[s]})`).join('; ');

  return (
    <>
      <div className="a2-hero">
        <p className="a2-kicker">Ação comercial · TUPs de uso público</p>
        <h2>Mapeamento das oportunidades e andamento do COLR</h2>
        <p>De {fmtN(m.baseMun)} municípios mapeados · {fmtN(m.propEncMun)} propostas encaminhadas · {fmtN(m.propAEnviarMun)} a enviar · {fmtN(m.baseTups)} TUPs na base, {fmtN(m.tupsNeg)} em negociação ativa · {util.arquivo || 'Ação TUPs'}{util.geradoEm ? ` · atualizado ${util.geradoEm}` : ''}.</p>
      </div>

      <section className="a2-slide a2-slide-funil">
        <h2 className="a2-bloco">Evolução da ação</h2>
        <p className="a2-legenda">{notaRecorte}</p>
        <Funil m={m} />
      </section>

      <div className="a2-conferencia">
        <p className="a2-divider">Conferência (planilha)</p>
        <div className="a2-card">
          <h2>Filtros</h2>
          <div className="a2-filters">
            <select value={f.regional} onChange={mudaF('regional')}><option value="">Todas as regionais</option>{opcoes(modelo, 'regional').map((v) => <option key={v}>{v}</option>)}</select>
            <select value={f.uf} onChange={mudaF('uf')}><option value="">Todos os estados</option>{opcoes(escopoOpcoes, 'uf').map((v) => <option key={v}>{v}</option>)}</select>
            <select value={f.consultor} onChange={mudaF('consultor')}><option value="">Todos os consultores</option>{opcoes(modelo, 'consultor').map((v) => <option key={v}>{v}</option>)}</select>
            <select value={f.status} onChange={mudaF('status')}><option value="">Todos os status</option>{opcoes(escopoOpcoes, 'statusLabel').map((v) => <option key={v}>{v}</option>)}</select>
            <select value={f.estagio} onChange={mudaF('estagio')}><option value="">Todos os estágios</option>{opcoes(escopoOpcoes, 'estagioLabel').map((v) => <option key={v}>{v}</option>)}</select>
            <button type="button" className="a2-pag" onClick={() => setF(FILTROS_VAZIOS)}>Limpar filtros</button>
          </div>
        </div>
        <Conferencia idx={idx} filtradas={filtradas} f={f} carteira={carteiraConf} verMun={verMun} />
        <QuadroPropostas idx={idx} filtradas={filtradas} m={m} verMun={verMun} />
      </div>

      <section className="a2-slide a2-graficos">
        <h2 className="a2-bloco">Gráficos do recorte</h2>
        <p className="a2-legenda">Colunas verticais em estilo <strong>infográfico 3D</strong> (valor acima da barra). À esquerda, a tabela; à direita, o mesmo recorte em barras.</p>
        <Graficos idx={idx} filtradas={filtradas} escopo={escopo} />
      </section>

      <Regional idx={idx} escopo={escopo} />

      <div className="a2-operacional">
        <p className="a2-divider">Detalhamento operacional (planilha)</p>
        <Campanhas idx={idx} filtradas={filtradas} />
        <p className="a2-conta"><strong>Resumo:</strong> base e TUPs = aba <em>Municípios</em>; priorizados = ≥3 TUPs; abordados SDR = status preenchido na <em>Atuação SDR</em>; contato válido = SDR útil ou status/estágio na aba Municípios quando SDR marcou incontatável/perdido; oportunidade = estágio comercial ativo ou qde pretendida; proposta = “enviar proposta”. <strong>Conferência:</strong> {carteiraConf ? 'com consultor selecionado, lista toda a carteira atribuída na aba Municípios (como no Excel)' : 'histórico (status/estágio) e observação preenchida'}.</p>
        <p className="a2-note">Valores distintos na carga — Status: {stTxt || 'nenhum'}. Estágio: {estTxt || 'nenhum'}.</p>
        <PainelGeral idx={idx} modelo={modelo} util={util} f={f} filtradas={filtradas} />
      </div>
    </>
  );
}

// Evolução da ação: 7 etapas com "Avanço" e o complemento de cada etapa
function Funil({ m }) {
  const etapas = [
    { tit: 'Base mapeada', n: m.baseMun, ant: 0, cor: '#64748b', leg: 'TUPs na base', det: [`${fmtN(m.baseTups)} TUPs no total`] },
    { tit: 'Priorizados (≥3 TUPs)', n: m.priMun, ant: m.baseMun, cor: '#38bdf8', leg: 'TUPs nos priorizados', det: [`${fmtN(m.priTups)} TUPs (municípios com 3 ou mais)`] },
    { tit: 'Abordados pelo SDR', n: m.abordados, ant: m.priMun, cor: '#22c55e', leg: 'Registro na Atuação SDR', det: ['Município com 1º contato ou status SDR preenchido'] },
    { tit: 'Com contato válido', n: m.contatoVal, ant: m.abordados, cor: '#2dd4bf', leg: 'Interlocutor útil', det: ['Resposta da prefeitura ou status/estágio na aba Municípios'] },
    { tit: 'Oportunidade comercial', n: m.oportMun, ant: m.contatoVal, cor: '#f59e0b', leg: 'TUPs pedidos (qde. pretendida)', det: [`${fmtN(m.tupsNeg)} TUPs em negociação`] },
    { tit: 'Proposta a enviar', n: m.propAEnviarMun, ant: m.oportMun, cor: '#a78bfa', leg: 'TUPs a enviar', det: [`${fmtN(m.propAEnviarTups || 0)} TUPs (soma qde. pretendida)`, 'estágio “enviar proposta”'] },
    { tit: 'Proposta encaminhada', n: m.propEncMun, ant: m.propAEnviarMun || m.oportMun, cor: '#2d8a8a', leg: 'Valor contratual', det: [m.propEncValor ? fmtMoeda(m.propEncValor) : '—', `${fmtN(m.propEncTups || 0)} TUPs pedidos`] },
  ];
  return (
    <div className="a2-funil">
      {etapas.map((e) => (
        <article key={e.tit} className="a2-etapa" style={{ '--funil-cor': e.cor }}>
          <div className="a2-etapa-topo"><h3>{e.tit}</h3><div><div className="num">{fmtN(e.n)}</div><div className="num-legenda">municípios</div></div></div>
          <div className="a2-etapa-base">
            <div className="a2-quad pct"><span className="rot">Avanço</span><div className="val">{e.ant ? pct(e.n, e.ant) : '100%'}</div><span className="sub">{e.ant ? 'da etapa anterior' : 'do recorte'}</span></div>
            <div className="a2-quad dado"><span className="rot">{e.leg}</span><p>{e.det.map((d, i) => <span key={i}>{i > 0 && <br />}{d}</span>)}</p></div>
          </div>
        </article>
      ))}
    </div>
  );
}

// ---------- conferência ----------
const COLS_HIST = [['uf', 'UF', 3], ['municipio', 'Município', 10], ['regional', 'Regional', 5], ['sdr', 'SDR', 7], ['consultor', 'Consultor', 7], ['situacaoLabel', 'Situação comercial', 7], ['temperatura', 'Temperatura', 9], ['orelhoes', 'TUPs oferecidos', 5], ['qtdPretendida', 'TUPs em negociação', 5], ['valorContratual', 'Valor contratual', 7], ['previsaoFechamento', 'Previsão fechamento', 6], [null, 'Observação', 29]];
const COLS_CART = [['uf', 'UF', 3], ['ploomes', 'PLOOMES', 6], ['municipio', 'Município', 10], ['cnpj', 'CNPJ', 7], ['sdr', 'SDR', 6], ['situacaoLabel', 'Situação comercial', 9], ['temperatura', 'Temperatura', 6], ['valorContratual', 'Valor contratual', 7], ['previsaoFechamento', 'Previsão fechamento', 6], ['orelhoes', 'TUPs direito', 5], ['qtdPretendida', 'TUPs pedidos', 5], ['carteira', 'Carteira', 4], ['regional', 'Regional', 26]];
const Vazio = () => <span className="a2-vazio">{VAZIO}</span>;
const clsSit = (r) => (destaqueEncaminhada(r) ? ' a2-enc' : destaqueAEnviar(r) ? ' a2-env' : '');

function Conferencia({ idx, filtradas, f, carteira, verMun }) {
  const [busca, setBusca] = useState('');
  const [ord, setOrd] = useState(['municipio', 1]);
  const [pag, setPag] = useState(1);
  const lista = useMemo(() => {
    const l = listaConferencia(idx, filtradas, f, busca);
    const [col, dir] = ord;
    return [...l].sort((a, b) => {
      if (col === 'orelhoes' || col === 'qtdPretendida') return ((Number(a[col]) || 0) - (Number(b[col]) || 0)) * dir;
      if (col === 'carteira') return ((a.carteira ? 1 : 0) - (b.carteira ? 1 : 0)) * dir;
      if (col === 'valorContratual') {
        const va = typeof a.valorContratual === 'number' && !Number.isNaN(a.valorContratual) ? a.valorContratual : -1;
        const vb = typeof b.valorContratual === 'number' && !Number.isNaN(b.valorContratual) ? b.valorContratual : -1;
        return (va - vb) * dir;
      }
      const va = String(a[col] || '').toLowerCase(), vb = String(b[col] || '').toLowerCase();
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [idx, filtradas, f, busca, ord]);
  useEffect(() => setPag(1), [busca, f]);
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const pagina = Math.min(pag, paginas), ini = (pagina - 1) * POR_PAGINA;
  const fatia = lista.slice(ini, ini + POR_PAGINA);
  const cols = carteira ? COLS_CART : COLS_HIST;
  const t = lista.length ? totaisConferencia(idx, lista, carteira) : null;
  const tot = (v, tit) => <td className="a2-tot-num" title={tit ? `${tit}: ${v}` : v}><strong>{v}</strong></td>;
  return (
    <div className="a2-card">
      <h2>Municípios — conferência</h2>
      <p className="a2-note">{carteira
        ? `Carteira do consultor ${f.consultor} — todos os CNPJs/municípios com esse nome na aba Municípios (inclui fora da regional do consultor; filtro de regional é ignorado). ${f.uf ? `Estado: ${f.uf}. ` : ''}${fmtN(lista.length)} linha(s).`
        : 'Só entram municípios com histórico de atendimento (status ou estágio) e texto na observação.'}</p>
      <div className="a2-filters"><input className="a2-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar município, CNPJ ou PLOOMES (vazio = todos da lista)" autoComplete="off" /></div>
      <p className="a2-note">{lista.length} {carteira ? 'oportunidade(s) na carteira' : 'município(s)'}. Ordenação: {ord[0]} {ord[1] > 0 ? '↑' : '↓'}.</p>
      <div className="a2-rolagem">
        <table className="a2-tab a2-conf">
          <colgroup>{cols.map(([, , w], i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
          <thead><tr>{cols.map(([c, nome]) => (c
            ? <th key={nome} className="a2-ord" onClick={() => setOrd(([oc, od]) => [c, oc === c ? -od : 1])}>{nome}</th>
            : <th key={nome}>{nome}</th>))}</tr></thead>
          <tbody>
            {fatia.length ? fatia.map((r) => {
              const c = idx.cons[chaveMun(r.uf, r.municipio)];
              const sit = r.situacaoLabel !== VAZIO ? r.situacaoLabel : '';
              const valor = valorExibido(r);
              const mun = <td className="a2-mun"><a href="#" className="a2-mun-link" title={r.municipio} onClick={(e) => { e.preventDefault(); verMun(r); }}>{r.municipio}</a></td>;
              const temp = <td className="a2-cc" title={r.temperatura}>{r.temperatura ? <Temp t={r.temperatura} /> : <Vazio />}</td>;
              if (carteira) {
                const dir = tupsDireito(r, c), ped = tupsPedidos(r, c);
                return (
                  <tr key={r.uf + r.municipio + r.cnpj} className={`a2-reg-linha${r.carteira ? ' a2-carteira' : ''}`} style={{ '--reg': corReg(r.regional) }}>
                    <td className="a2-cc">{r.uf}</td><td className="a2-cc">{r.ploomes || <Vazio />}</td>{mun}
                    <td className="a2-cc" title={r.cnpj}>{r.cnpj || <Vazio />}</td><td className="a2-cc" title={r.sdr}>{r.sdr || <Vazio />}</td>
                    <td className={'a2-cc' + clsSit(r)} title={situacaoTitulo(r)}>{sit || <Vazio />}</td>{temp}
                    <td className="a2-cc" title={valor}>{valor || <Vazio />}</td><td className="a2-cc" title={r.previsaoFechamento}>{r.previsaoFechamento || <Vazio />}</td>
                    <td className="a2-cc">{dir ? fmtN(dir) : <Vazio />}</td><td className="a2-cc">{ped ? fmtN(ped) : <Vazio />}</td>
                    <td className={'a2-cc' + (r.carteira ? ' a2-sim' : '')}>{r.carteira ? 'Sim' : 'Não'}</td><td className="a2-cc">{r.regional || <Vazio />}</td>
                  </tr>
                );
              }
              return (
                <tr key={r.uf + r.municipio + r.cnpj} className="a2-reg-linha" style={{ '--reg': corReg(r.regional) }}>
                  <td className="a2-cc">{r.uf}</td>{mun}
                  <td className="a2-cc" title={r.regional}>{r.regional || <Vazio />}</td><td className="a2-cc" title={r.sdr}>{r.sdr || <Vazio />}</td>
                  <td className="a2-cc" title={r.consultor}>{r.consultor || <Vazio />}</td>
                  <td className={'a2-cc' + clsSit(r)} title={situacaoTitulo(r)}>{sit || <Vazio />}</td>{temp}
                  <td className="a2-cc">{r.orelhoes ? fmtN(r.orelhoes) : <Vazio />}</td><td className="a2-cc">{r.qtdPretendida ? fmtN(r.qtdPretendida) : <Vazio />}</td>
                  <td className="a2-cc" title={valor}>{valor || <Vazio />}</td><td className="a2-cc" title={r.previsaoFechamento}>{r.previsaoFechamento || <Vazio />}</td>
                  <td className="a2-obs">{r.obs ? <span className="a2-obs-clamp" title={r.obs}>{r.obs}</span> : <Vazio />}</td>
                </tr>
              );
            }) : <tr><td colSpan={cols.length}>Nenhum município neste filtro.</td></tr>}
          </tbody>
          {t && (
            <tfoot><tr className="a2-tot">
              {carteira ? (<>
                <td><strong>Totais</strong></td><td />{tot(fmtN(t.municipios), 'Municípios')}<td />{tot(fmtN(t.acaoSdr), 'SDR')}<td /><td />
                <td className="a2-tot-num a2-tot-valor" title={`Valor contratual: ${fmtMoeda(t.valor || 0)}`}><strong>{fmtMoeda(t.valor || 0)}</strong></td><td />
                {tot(fmtN(t.direito), 'TUPs direito')}{tot(fmtN(t.pedidos), 'TUPs pedidos')}<td /><td />
              </>) : (<>
                <td><strong>Totais</strong></td>{tot(fmtN(t.municipios), 'Municípios')}<td />{tot(fmtN(t.acaoSdr), 'SDR')}<td /><td /><td />
                {tot(fmtN(t.direito), 'TUPs oferecidos')}{tot(fmtN(t.pedidos), 'TUPs em negociação')}
                <td className="a2-tot-num a2-tot-valor" title={`Valor contratual: ${fmtMoeda(t.valor || 0)}`}><strong>{fmtMoeda(t.valor || 0)}</strong></td><td /><td />
              </>)}
            </tr></tfoot>
          )}
        </table>
      </div>
      <div className="a2-paginacao">
        <span>{lista.length ? `Mostrando ${fmtN(ini + 1)}–${fmtN(Math.min(ini + POR_PAGINA, lista.length))} de ${fmtN(lista.length)}` : 'Nenhum resultado'}</span>
        <div>
          <button type="button" className="a2-pag" disabled={pagina <= 1} onClick={() => setPag(pagina - 1)}>Anterior</button>
          <button type="button" className="a2-pag" disabled={pagina >= paginas} onClick={() => setPag(pagina + 1)}>Próxima</button>
        </div>
      </div>
    </div>
  );
}

// ---------- quadro de propostas ----------
function QuadroPropostas({ idx, filtradas, m, verMun }) {
  const rp = useMemo(() => relatorioPropostas(idx, filtradas), [idx, filtradas]);
  const itens = useMemo(() => [...rp.itens].sort((a, b) => (Number(b.tupsPedidos) || 0) - (Number(a.tupsPedidos) || 0)), [rp]);
  const top = itens.filter((x) => x.tupsPedidos > 0).slice(0, 4);
  const somaTop = top.reduce((s, x) => s + x.tupsPedidos, 0);
  const num = (v) => (v % 1 ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : fmtN(v));
  const cards = [
    ['Municípios na lista', rp.totalMunicipios, 'azul'], ['Propostas encaminhadas', rp.encaminhadas, 'teal'], ['Propostas a enviar', rp.aEnviar, 'roxo'],
    ['Total TUPs pedidos', rp.somaTupsPedidos, 'roxo'], ['Soma TUPs direito', rp.somaTupsDireito, 'azul'],
    ['Média TUPs pedidos', Math.round(rp.mediaTupsPedidos * 100) / 100, ''], ['Média TUPs direito', Math.round(rp.mediaTupsDireito * 100) / 100, ''], ['Já cliente (carteira)', rp.carteira, 'verde'],
  ];
  return (
    <div className="a2-card a2-propostas">
      <h2>Quadro de propostas solicitadas</h2>
      <p className="a2-note">Pipeline comercial e municípios com “enviar proposta”. Compare TUPs na base (direito) com quantidade pretendida.</p>
      <div className="a2-kpis-linha">{cards.map(([t, v, c]) => <div key={t} className={`a2-kpi ${c}`}><h3>{t}</h3><div className="val">{num(v)}</div></div>)}</div>
      {somaTop > 0 && rp.somaTupsPedidos > 0 && <p className="a2-insight"><strong>{top.map((x) => x.municipio).join(', ')}</strong> concentram {fmtN(somaTop)} dos {fmtN(rp.somaTupsPedidos)} TUPs com quantidade pretendida ({pct(somaTop, rp.somaTupsPedidos)}).</p>}
      <div className="a2-filters"><button type="button" className="a2-carregar" disabled={!rp.itens.length} onClick={() => baixarTexto(csvPropostas(rp), 'propostas-acao-tups.csv', 'text/csv;charset=utf-8')}>Baixar relatório de propostas (CSV)</button></div>
      <div className="a2-rolagem">
        <table className="a2-tab a2-resumo">
          <thead><tr><th>UF</th><th>Município</th><th>SDR</th><th>Consultor</th><th>Situação comercial</th><th>Temperatura</th><th>Valor contratual</th><th>Previsão fechamento</th><th>TUPs direito</th><th>TUPs pedidos</th><th>Carteira</th></tr></thead>
          <tbody>
            {itens.length ? itens.map((x) => (
              <tr key={x.uf + x.municipio} className={`a2-reg-linha${x.carteira ? ' a2-carteira' : ''}`} style={{ '--reg': corReg(x.regional) }}>
                <td>{x.uf}</td>
                <td><a href="#" className="a2-mun-link quebra" onClick={(e) => { e.preventDefault(); verMun({ ...x, orelhoes: x.tupsDireito || x.tupsPedidos }); }}>{x.municipio}</a></td>
                <td>{x.sdr || VAZIO}</td><td>{x.consultor || VAZIO}</td>
                <td className={clsSit(x).trim()} title={situacaoTitulo(x)}>{x.situacaoLabel || VAZIO}</td>
                <td>{x.temperatura ? <Temp t={x.temperatura} /> : VAZIO}</td>
                <td>{valorExibido(x) || VAZIO}</td><td>{x.previsaoFechamento || VAZIO}</td>
                <td>{fmtN(x.tupsDireito)}</td><td>{fmtN(x.tupsPedidos)}</td>
                <td className={x.carteira ? 'a2-sim' : ''}>{x.carteira ? 'Sim' : 'Não'}</td>
              </tr>
            )) : <tr><td colSpan={11}>Nenhum município com proposta no recorte.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="a2-note">Situação comercial: com valor contratual → Proposta encaminhada; caso contrário, estágio da planilha. TUPs pedidos = qde. pretendida; TUPs direito = TUPs na base. Linhas em verde = carteira.{m.pipelineSemQtd ? ` ${fmtN(m.pipelineSemQtd)} município(s) no pipeline ainda sem quantidade pretendida.` : ''}</p>
    </div>
  );
}

// ---------- gráficos do recorte ----------
function TabelaDist({ titulo, linhas, total }) {
  return (
    <table className="a2-tab a2-efet">
      <thead><tr><th>{titulo[0]}</th><th>{titulo[1]}</th><th>%</th></tr></thead>
      <tbody>
        {linhas.length ? linhas.map((l) => {
          const t = nk(l.rotulo);
          const cls = t.includes('proposta encaminhada') || t.includes('proposta apresentada') ? 'a2-enc' : t.includes('enviar proposta') ? 'a2-env' : '';
          return <tr key={l.rotulo} className={cls}><td>{l.rotulo}</td><td>{fmtN(l.n)}</td><td><span className="a2-pct">{pct(l.n, total)}</span></td></tr>;
        }) : <tr><td colSpan={3} className="a2-vazio">Nenhum no recorte.</td></tr>}
      </tbody>
    </table>
  );
}
function Graficos({ idx, filtradas, escopo }) {
  const k = filtradas.length || 1;
  const est = distribuicao(filtradas, (r) => r.estagioLabel);
  const sdr = distSdr(idx, escopo), pipe = distPipeline(escopo);
  const blocos = [
    { tit: '1 · Distribuição por estágio', leg: `Denominador: ${fmtN(k)} municípios no recorte — estágio comercial.`, cab: ['Estágio', 'Qtd.'], linhas: est, total: k },
    { tit: '2 · Etapa 1 — Prospecção SDR', leg: sdr.total ? `${fmtN(sdr.total)} municípios abordados pelo SDR neste recorte.` : 'Nenhum abordado no recorte.', cab: ['Situação do contato', 'Municípios'], linhas: sdr.linhas, total: sdr.total || 1 },
    { tit: '3 · Etapa 2 — Pipeline comercial', leg: `${fmtN(pipe.total)} municípios no pipeline · ${fmtN(pipe.tups)} TUPs com quantidade pretendida.`, cab: ['Estágio', 'Municípios'], linhas: pipe.linhas, total: pipe.total || 1 },
  ];
  return (
    <div className="a2-graficos-lista">
      {blocos.map((b) => (
        <article key={b.tit} className="a2-grafico">
          <h2>{b.tit}</h2>
          <p className="a2-grafico-leg">{b.leg}</p>
          <div className="a2-grafico-tab"><TabelaDist titulo={b.cab} linhas={b.linhas} total={b.total} /></div>
          <div className="a2-chart">{b.linhas.length > 0 && <Barras3D itens={b.linhas.map((l, i) => ({ rotulo: l.rotulo, valor: l.n, cor: corBarra(l.rotulo, i) }))} altura={Math.max(220, Math.min(300, 218 + (b.linhas.length > 6 ? 20 : 0)))} />}</div>
        </article>
      ))}
    </div>
  );
}

// ---------- potencial por regional ----------
function Regional({ idx, escopo }) {
  const regs = distRegional(escopo);
  const cob = coberturaRegional(idx, escopo);
  return (
    <section className="a2-slide a2-regional">
      <h2 className="a2-bloco">Potencial por regional</h2>
      {regs.some((r) => r.rotulo === 'Sem regional') && <p className="a2-legenda">Preencha a coluna Regional na aba Municípios para ver o recorte completo.</p>}
      <div className="a2-regional-painel">
        <div className="a2-regional-linha" role="list">
          {regs.length ? regs.map((r) => (
            <article key={r.rotulo} className="a2-regional-card" role="listitem" style={{ '--reg': corReg(r.rotulo) }}>
              <span className="nome" title={r.rotulo}>{r.rotulo}</span>
              <div className="metricas">
                <span><span className="lbl">TUPs mapeados</span><strong>{fmtN(r.tups)}</strong></span>
                <span><span className="lbl">Oport. abertas</span><strong>{fmtN(r.oport)}</strong></span>
              </div>
            </article>
          )) : <p className="a2-vazio">Sem regional preenchida na planilha.</p>}
        </div>
        {regs.length > 0 && (
          <aside className="a2-regional-grafico" aria-label="Barras coloridas: TUPs mapeados; contorno: percentual abordados (SDR) sobre 100%">
            <Barras3D compacto altura={58} itens={regs.map((r) => {
              const c = cob[r.rotulo] || { mun: 0, abord: 0 };
              return { rotulo: r.rotulo, valor: r.tups, cor: corReg(r.rotulo), pct: c.mun ? (c.abord / c.mun) * 100 : 0, pctRotulo: pct(c.abord, c.mun),
                dica: `TUPs mapeados: ${fmtN(r.tups)} · Cobertura SDR: ${pct(c.abord, c.mun)} abordados · ${fmtN(c.abord)} de ${fmtN(c.mun)} municípios` };
            })} dupla />
          </aside>
        )}
      </div>
    </section>
  );
}

// ---------- campanhas por porte ----------
function Campanhas({ idx, filtradas }) {
  const lista = useMemo(() => campanhas(idx, filtradas), [idx, filtradas]);
  const [sel, setSel] = useState(4);
  const c = lista.find((x) => x.num === sel) || lista.find((x) => x.num === 4) || lista[0];
  const cel = (rot, v, dica, cls, tit) => <div className={`a2-camp-cel ${cls}`} title={tit}><span className="rot">{rot}</span><strong className="val">{fmtN(v)}</strong>{dica && <span className="dica">{dica}</span>}</div>;
  return (
    <div className="a2-card a2-campanhas">
      <h2>Campanhas por porte (TUPs)</h2>
      <p className="a2-note">Campanhas conforme as abas <em>Atuação SDR</em> (1, 2, 3, 4 e 90 TUP). Clique no número para ver o resumo da ação; municípios só entram pela aba SDR ou, se não estiverem lá, pelo porte na base (1–4 ou ≥90 TUPs).</p>
      {!c ? <p className="a2-vazio">Nenhuma campanha identificada neste recorte.</p> : (
        <>
          <div className="a2-camp-topo">
            <div className="a2-camp-nums" role="tablist">
              {lista.map((x) => (
                <button key={x.num} type="button" className={`a2-camp-num${x.num === c.num ? ' atual' : ''}`} aria-pressed={x.num === c.num} onClick={() => setSel(x.num)}>
                  <small className="cima">campanha</small><span>{x.num}</span><small>TUP{x.num === 1 ? '' : 's'}</small>
                </button>
              ))}
            </div>
            <div className="a2-camp-chart">
              <Barras3D compacto altura={176} itens={(() => {
                let fat = [['Prop.', c.proposta, '#c4b5fd', 'Proposta'], ['Trab.', c.trabalhoAtivo, '#f59e0b', 'Trabalho ativo'], ['Reun.', c.reuniao, '#22c55e', 'Reunião'], ['Perd.', c.perdido, '#f87171', 'Perdido'], ['S/C', c.semClass, '#64748b', 'Sem classificação'], ['Lista', Math.max(0, c.lista - c.contato), '#334155', 'Só na lista (sem contato)']].filter((x) => x[1] > 0);
                if (!fat.length) fat = [['—', 1, '#64748b', 'Sem dados']];
                return fat.map(([rotulo, valor, cor, nome]) => ({ rotulo, valor, cor, dica: `${nome}: ${fmtN(valor)}` }));
              })()} />
            </div>
          </div>
          <article className="a2-camp-resumo">
            <h2>Ação <span className="a2-acao-num">{c.num}</span> TUP{c.num === 1 ? '' : 's'}</h2>
            <div className="a2-camp-funil">
              {cel('Municípios', c.lista, 'porte na base', 'funil', 'Municípios nesta campanha — porte de TUPs na base')}
              {cel('Contato', c.contato, 'com registro', 'funil', 'Com contato registrado — status ou estágio preenchido')}
              {cel('Reunião', c.reuniao, 'gerada', 'funil', 'Reunião gerada — agendada ou em agendamento')}
            </div>
            <div className="a2-camp-grade">
              {cel('Proposta', c.proposta, '', 'det', 'Proposta solicitada — enviar proposta')}
              {cel('Trab. ativo', c.trabalhoAtivo, '', 'det', 'Trabalho ativo — andamento, retorno, agendamento')}
              {cel('Andamento', c.andamento, '', 'det', 'Andamento / reagendar — status na planilha')}
              {cel('Agendado', c.agendada, '', 'det', 'Agendado — reunião combinada')}
              {cel('Incontatável', c.incontatavel, '', 'det', 'Incontatável — sem retorno válido')}
              {cel('Perdido', c.perdido, '', 'det', 'Perdido — não seguiu')}
              {cel('Sem classif.', c.semClass, '', 'det', 'Sem classificação — contato sem encaixe nas faixas')}
            </div>
          </article>
        </>
      )}
    </div>
  );
}

// ---------- painel demonstrativo - geral ----------
function PainelGeral({ idx, modelo, util, f, filtradas }) {
  const [ajuda, setAjuda] = useState(null);
  const m = calcMetricas(idx, modelo), ex = calcExtras(idx, modelo), ciclo = cicloGestor(util.geradoEm);
  const ag = consultoresPainel(idx, modelo, filtradas, f.consultor);
  const ritmo = ciclo.decorridos ? String(Math.round((m.abordados / ciclo.decorridos) * 10) / 10) : '—';
  const kpis = [
    ['reunioes', 'Reuniões / agendamentos', fmtN(ex.reuniao), [`${pct(ex.reuniao, m.contatoVal)} dos contatos válidos`, `${pct(ex.reuniao, m.abordados)} dos abordados SDR`]],
    ['ativo', 'Trabalho ativo', fmtN(ex.trabalhoAtivo), [`${pct(ex.trabalhoAtivo, m.baseMun)} da base`, `${pct(ex.incontatavel, m.abordados)} incontatáveis (sobre abordados)`]],
    ['ritmo', 'Ritmo (dia útil)', ritmo, ['municípios abordados / dia útil', `${fmtN(m.abordados)} abordados em ${ciclo.decorridos} dias úteis`]],
  ];
  const escala = ag.maxMun || 1;
  const nCons = ag.consultores.filter((c) => !c.indefinido).length;
  useEffect(() => {
    if (!ajuda) return undefined;
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setAjuda(null); } };
    addEventListener('keydown', esc, true);
    return () => removeEventListener('keydown', esc, true);
  }, [ajuda]);
  return (
    <section className="a2-slide a2-gestor">
      <h2 className="a2-bloco">Painel demonstrativo - GERAL</h2>
      <p className="a2-legenda">Indicadores que não aparecem no funil · planilha inteira (ignora filtros) · ciclo {ciclo.decorridos}/{ciclo.total} dias úteis · corte {util.geradoEm || dataBr(ciclo.fim)}</p>
      <p className="a2-narrativa">{narrativaGestor(ciclo, m, ex)}</p>
      <div className="a2-gestor-kpis">
        {kpis.map(([id, t, v, linhas]) => (
          <article key={id} className="a2-gestor-kpi">
            <button type="button" className="a2-ajuda" onClick={() => setAjuda(id)} aria-label="O que significa este indicador" title="O que significa?">?</button>
            <h4>{t}</h4><div className="big">{v}</div><div className="pct-linha">{linhas.map((l, i) => <span key={i}>{i > 0 && <br />}{l}</span>)}</div>
          </article>
        ))}
      </div>
      <div className="a2-equipe">
        <h3>Consultores — carteira e contactados</h3>
        <p className="a2-equipe-leg">{f.consultor
          ? `Filtro ativo: ${f.consultor} — ${fmtN(ag.consultores[0]?.mun || 0)} municípios no recorte (${pct(ag.consultores[0]?.mun || 0, ag.baseTotal)} da base nacional).`
          : `Comparativo na planilha inteira — barra amarela = % já contactado na carteira; barra azul = participação na base (${fmtN(ag.baseTotal)} municípios). Linha tracejada = média de contactados entre consultores (${ag.mediaCont ? ag.mediaCont.toFixed(1).replace('.', ',') + '%' : '—'}).`}</p>
        <div className="a2-consultores" role="list">
          {ag.consultores.length ? ag.consultores.map((c) => {
            const faixa = faixaContactado(c.pctContNum);
            return (
              <article key={c.nome} className={`a2-cons${c.indefinido ? ' indefinido' : ''}${f.consultor ? ' foco' : ''}`} role="listitem">
                <header className="a2-cons-head"><strong title={c.nome}>{c.nome}</strong><span className="chip">{c.pctBase} da base</span></header>
                <div className="a2-cons-met">
                  <span><em>{fmtN(c.mun)}</em> na carteira</span><span><em>{fmtN(c.contactados)}</em> contactados</span>
                  <span className={`destaque faixa-${faixa}`}>{c.pctContactados}</span>
                </div>
                <p className="a2-cons-rot">Contactados na carteira</p>
                <div className={`a2-cons-bar contato faixa-${faixa}`} role="img" aria-label={`${c.pctContactados} contactados`}>
                  <span className="fill" style={{ width: `${Math.min(100, Math.max(0, Math.round(c.pctContNum)))}%` }} />
                  {ag.consultores.length > 1 && !f.consultor && <span className="media" style={{ left: `${Math.min(99, ag.mediaCont)}%` }} title="Média da equipe" />}
                </div>
                <p className="a2-cons-rot">Tamanho vs. maior carteira</p>
                <div className="a2-cons-bar carteira" role="img" aria-label={`${c.pctBase} da base`}><span className="fill" style={{ width: `${Math.max(4, Math.round((c.mun / escala) * 100))}%` }} /></div>
                <p className="a2-cons-rodape">{fmtN(c.pendente)} ainda sem contato registrado</p>
              </article>
            );
          }) : <p className="a2-vazio">Nenhum município para o consultor selecionado.</p>}
        </div>
      </div>
      <p className="a2-note">{f.consultor ? 'Visão focada no consultor do filtro (demais cards ocultos). ' : `${nCons} consultores nomeados + linha “A definir”. `}Contactado = status ou estágio registrado (mesma regra do funil). Use o filtro Consultor (acima) para ver só a carteira daquela pessoa.</p>
      {ajuda && AJUDA[ajuda] && (
        <div className="a2-modal" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setAjuda(null); }}>
          <div className="a2-modal-painel">
            <button type="button" className="a2-modal-x" onClick={() => setAjuda(null)} aria-label="Fechar">×</button>
            <h3>{AJUDA[ajuda].titulo}</h3>
            {AJUDA[ajuda].corpo.map((b) => (
              <div key={b.h}><h4>{b.h}</h4>{b.p ? <p>{b.p}</p> : <ul>{b.ul.map((li) => <li key={li}>{li}</li>)}</ul>}</div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- colunas verticais em 3D (mesmo desenho do Chart.js da plataforma) ----------
function ajustarCor(hex, clarear) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return hex || '#38bdf8';
  const f = clarear ? 0.38 : 0.22, k = clarear ? 1 : -1;
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).map((v) => Math.max(0, Math.min(255, Math.round(v + k * (clarear ? 255 - v : v) * f))));
  return `rgb(${c.join(',')})`;
}
function Barras3D({ itens, altura = 220, compacto = false, dupla = false }) {
  const caixa = useRef(null);
  const [larg, setLarg] = useState(0);
  const [dica, setDica] = useState(null);
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return undefined;
    const medir = () => setLarg(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = itens.length;
  const px = compacto ? 5 : 8, py = compacto ? 4 : 6;
  const padT = dupla ? 16 : compacto ? 14 : 34, padR = compacto ? 8 : 14, padL = compacto ? 4 : 6, padB = 4;
  const fonteX = compacto ? 9 : 10;
  const slot = larg ? (larg - padL - padR) / Math.max(n, 1) : 0;
  // rótulos do eixo: inclinam quando não cabem (como o Chart.js, até 48°)
  const maiorRotulo = Math.max(...itens.map((i) => String(i.rotulo).length), 1) * fonteX * 0.62;
  const ang = compacto || !slot || maiorRotulo <= slot - 4 ? 0 : slot < 50 ? 40 : 20;
  const altRot = ang ? Math.min(80, maiorRotulo * Math.sin((ang * Math.PI) / 180) + fonteX + 6) : fonteX + 6;
  const baseY = altura - padB - altRot;
  const plotH = baseY - padT;
  const maxVal = Math.max(...itens.map((i) => i.valor), 0);
  const maxEixo = maxVal ? maxVal * (compacto ? 1.35 : 1.28) : 1;
  const maxBar = dupla ? (compacto ? 14 : 36) : compacto ? (n > 6 ? 18 : 24) : (n > 10 ? 28 : 36);
  const bw = Math.min(slot * (dupla ? 0.88 * 0.34 : 0.62 * 0.9), maxBar);
  const id = useMemo(() => 'g' + Math.random().toString(36).slice(2, 8), []);
  return (
    <div ref={caixa} className="a2-b3d" style={{ height: altura }} onMouseLeave={() => setDica(null)}>
      {larg > 0 && (
        <svg width={larg} height={altura} role="img">
          <defs>
            {itens.map((it, i) => (
              <linearGradient key={i} id={`${id}-${i}`} x1="0" y1={baseY} x2="0" y2={padT} gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor={ajustarCor(it.cor, false)} /><stop offset="0.35" stopColor={it.cor} /><stop offset="1" stopColor={ajustarCor(it.cor, true)} />
              </linearGradient>
            ))}
          </defs>
          <line x1={padL} x2={larg - padR} y1={baseY + 0.5} y2={baseY + 0.5} stroke="rgba(100,116,139,.35)" />
          {itens.map((it, i) => {
            const cx = padL + slot * (i + 0.5);
            const xb = cx;
            const h = (it.valor / maxEixo) * plotH;
            const x0 = xb - bw / 2, y = baseY - h;
            const claro = ajustarCor(it.cor, true), escuro = ajustarCor(it.cor, false);
            const tx = xb + px * 0.45, topoY = y - py, rotY = topoY - (compacto ? 10 : 14);
            const hPct = dupla ? ((Number(it.pct) || 0) / 100) * (plotH - (compacto ? 13 : 16)) : 0;
            const xp = xb + bw / 2 + (compacto ? 19 : 21) + (compacto ? 9 : 11) / 2, lp = compacto ? 9 : 11;
            return (
              <g key={i} onMouseMove={(e) => { const r = caixa.current.getBoundingClientRect(); setDica({ x: e.clientX - r.left, y: e.clientY - r.top, t: it.dica || `${it.rotulo}: ${fmtN(it.valor)} municípios` }); }}>
                <rect x={x0 - 8} y={padT - 20} width={bw + 40} height={plotH + 24} fill="transparent" />
                {h > 0 && (
                  <>
                    <rect x={x0 + 5} y={baseY + 2} width={bw + px} height={6} fill="rgba(0,0,0,.18)" />
                    <path d={`M${x0 + bw} ${y}L${x0 + bw + px} ${y - py}L${x0 + bw + px} ${baseY - py}L${x0 + bw} ${baseY}Z`} fill={escuro} />
                    <rect x={x0} y={y} width={bw} height={h} rx={Math.min(2, h / 2)} fill={`url(#${id}-${i})`} stroke={escuro} strokeWidth="1" />
                    {it.valor > 0 && <path d={`M${x0} ${y}L${x0 + bw} ${y}L${x0 + bw + px} ${y - py}L${x0 + px} ${y - py}Z`} fill={claro} />}
                    {it.valor > 0 && (
                      <>
                        <line x1={tx} x2={tx} y1={topoY} y2={rotY + 6} stroke={claro} strokeWidth="1.5" />
                        <text x={tx} y={rotY} textAnchor="middle" fill={claro} fontWeight="800" fontSize={compacto ? 11 : 15} fontFamily="Segoe UI, Arial, sans-serif">{it.rotuloAcima ?? fmtN(it.valor)}</text>
                      </>
                    )}
                  </>
                )}
                {dupla && hPct > 0 && (
                  <>
                    <rect x={xp - lp / 2} y={baseY - hPct} width={lp} height={hPct} fill="none" stroke="rgba(148,163,184,.95)" strokeWidth="1.5" />
                    <line x1={xp} x2={xp} y1={baseY - hPct} y2={baseY - hPct - (compacto ? 10 : 12)} stroke="rgba(148,163,184,.95)" strokeWidth="1.25" />
                    <text x={xp} y={baseY - hPct - (compacto ? 10 : 12) - 2} textAnchor="middle" fill="#cbd5e1" fontWeight="800" fontSize={compacto ? 10 : 11} fontFamily="Segoe UI, Arial, sans-serif">{it.pctRotulo}</text>
                  </>
                )}
                <text x={cx} y={baseY + fonteX + 3} fill="#cbd5e1" fontWeight="600" fontSize={fonteX} fontFamily="Segoe UI, Arial, sans-serif"
                  textAnchor={ang ? 'end' : 'middle'} transform={ang ? `rotate(${-ang} ${cx + 4} ${baseY + fonteX + 3})` : undefined}>{String(it.rotulo).replace(/_/g, ' ')}</text>
              </g>
            );
          })}
        </svg>
      )}
      {dica && <div className="a2-dica" style={{ left: Math.min(dica.x + 12, larg - 160), top: Math.max(0, dica.y - 36) }}>{dica.t}</div>}
    </div>
  );
}

function Temp({ t }) {
  const k = nk(t);
  const c = k === 'quente' ? 'quente' : k === 'morno' ? 'morno' : k === 'frio' ? 'frio' : '';
  return c ? <span className={`a2-temp ${c}`}>{t}</span> : t;
}
