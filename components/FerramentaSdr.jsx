'use client';

// Ferramenta SDR (Pesquisa Municípios): cópia fiel da página "campanha-contatos" da plataforma CoLR,
// com os dados no nosso banco (Supabase, migração 009) — coletivo: todos da equipe veem a cada 5 s.
// Abre só pela Ação TUPs (botão "Ferramenta - SDR" e nome do município). Usa a senha da Ação TUPs.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { acaoEntrar, acaoLer, sdrLer, sdrEntrar, sdrSalvar, sdrDesfazer } from '@/lib/supabase';
import { UF_NOME } from '@/lib/geo';
import {
  nk, chaveSdr, STATUS, STATUS_POR_ID, rotuloStatus, TEVE_CONTATO, codigoDaPlanilha, CARGOS, CAMPANHA,
  ESTAGIOS_CONS, urlTse, URL_SGMU, urlPortal, anatelDoMunicipio, coberturaDoMunicipio, prefeiturasDaUf, municipiosBase,
} from '@/lib/sdr';
import { chaveMun } from '@/lib/acaoTups';
import MunicipioCartoes, { ROTULO_PLAN, resumoAcao } from './MunicipioCartoes';

const SESSAO = 'acaoTupsSenha'; // mesma sessão da Ação TUPs (a senha é a mesma)
const NOME_KEY = 'sdrNome';
const ler = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const grava = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} };
const fmtData = (s) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
// estágio liberado para o consultor só depois de uma ligação com interação
const PARA_CONSULTOR = new Set(['retorno', 'agenda', 'sem_interesse', 'retornar']);
const ultimoStatus = (reg) => [...(reg?.acoes || [])].filter((a) => a.tipo === 'status' && STATUS_POR_ID[a.status]).pop()?.status || '';
const teveContato = (reg) => (reg?.acoes || []).some((a) => a.tipo === 'status' && TEVE_CONTATO.has(a.status));

export default function FerramentaSdr({ onFechar, onVoltarPainel, onMenu, orelhoes = [], inicial = null, onVerMunicipio }) {
  const [senha, setSenha] = useState(() => { try { return sessionStorage.getItem(SESSAO) || ''; } catch { return ''; } });
  const [ok, setOk] = useState(false);
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(document.getElementById('topbar-acao')); }, []);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.s2-modal-fundo')) onFechar(); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onFechar]);
  useEffect(() => { if (senha) acaoEntrar(senha).then((r) => r === 'ok' && setOk(true)).catch(() => {}); /* eslint-disable-next-line */ }, []);
  const sair = () => { grava(NOME_KEY, ''); onMenu(); };

  return (
    <>
      <div className="admin-fundo prop-fundo" onClick={onFechar} />
      <section className="prop-tela acao-tela a2-tela s2-tela" role="dialog" aria-label="Pesquisa Municípios">
        {slot && createPortal(
          <>
            <button type="button" className="cta" onClick={onVoltarPainel} title="Voltar ao painel da Ação TUPs">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="rotulo">Voltar ao painel</span>
            </button>
            <button type="button" className="cta" onClick={sair} title="Sair (desmarca o seu nome)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l-4 4 4 4M5 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="rotulo">Sair</span>
            </button>
            <button type="button" className="cta" onClick={onMenu} title="Voltar ao mapa">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" /></svg>
              <span className="rotulo">Menu</span>
            </button>
          </>,
          slot,
        )}
        {ok
          ? <Pesquisa senha={senha} orelhoes={orelhoes} inicial={inicial} onVerMunicipio={onVerMunicipio} onVoltarPainel={onVoltarPainel} />
          : <Senha onOk={(s) => { try { sessionStorage.setItem(SESSAO, s); } catch {} setSenha(s); setOk(true); }} />}
      </section>
    </>
  );
}

function Senha({ onOk }) {
  const [s, setS] = useState(''); const [erro, setErro] = useState(''); const [indo, setIndo] = useState(false);
  const entrar = async (e) => {
    e.preventDefault(); setErro(''); setIndo(true);
    try { const r = await acaoEntrar(s); if (r === 'ok') onOk(s); else setErro(r === 'senha' ? 'Senha incorreta.' : 'Banco não configurado.'); } catch (err) { setErro(err.message || String(err)); }
    setIndo(false);
  };
  return (
    <div className="a2-gate">
      <form className="a2-gate-box" onSubmit={entrar} autoComplete="off">
        <h2>Pesquisa Municípios</h2>
        <p>Acesso só para quem trabalha no SDR. Informe a senha.</p>
        <input type="password" value={s} onChange={(e) => setS(e.target.value)} placeholder="Senha" autoFocus />
        <div className="a2-gate-err">{erro}</div>
        <button type="submit" disabled={!s || indo}>{indo ? 'Conferindo…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

function Pesquisa({ senha, orelhoes, inicial, onVerMunicipio, onVoltarPainel }) {
  // ---------- quem está pesquisando ----------
  const [nome, setNome] = useState(() => ler(NOME_KEY));
  const [digitado, setDigitado] = useState(() => ler(NOME_KEY));
  const [ajuda, setAjuda] = useState(false);
  const ehConsultor = !!nome && nk(nome) !== 'marco';
  const confirmarNome = async (e) => {
    e.preventDefault();
    const n = digitado.replace(/\s+/g, ' ').trim(); if (!n) return;
    try { await sdrEntrar(senha, n, nk(n) === 'marco' ? 'sdr' : 'consultor'); } catch {}
    grava(NOME_KEY, n); setNome(n);
  };
  const desmarcar = () => { grava(NOME_KEY, ''); setNome(''); setDigitado(''); };

  // ---------- registros do banco (coletivo) ----------
  const [registros, setRegistros] = useState({});
  const [sync, setSync] = useState('');
  const desde = useRef(null);
  useEffect(() => {
    let vivo = true;
    const puxar = async () => {
      if (document.hidden) return;
      try {
        const d = await sdrLer(senha, desde.current);
        if (!vivo) return;
        desde.current = d.agora;
        if (d.registros?.length) setRegistros((o) => { const n = { ...o }; d.registros.forEach((r) => { n[r.chave] = r; }); return n; });
        setSync('ok');
      } catch { if (vivo) setSync('aviso'); }
    };
    puxar();
    const t = setInterval(puxar, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, [senha]);
  const salvo = (r) => setRegistros((o) => ({ ...o, [r.chave]: r }));

  // ---------- planilha da Ação TUPs ----------
  const [planilha, setPlanilha] = useState(null);
  useEffect(() => { acaoLer(senha).then((r) => setPlanilha(r?.dados || null)).catch(() => {}); }, [senha]);
  const idxPlan = useMemo(() => {
    const idx = {};
    if (!planilha) return idx;
    (planilha.atuacao || []).forEach((r) => { const k = chaveMun(r.uf, r.municipio); const cur = idx[k]?.sdr; if (!cur || (r.status && (!cur.status || r.aba > cur.aba))) (idx[k] ??= {}).sdr = r; });
    (planilha.consultores || []).forEach((r) => { (idx[chaveMun(r.uf, r.municipio)] ??= {}).cons = r; });
    (planilha.municipios || []).forEach((r) => { (idx[chaveMun(r.uf, r.municipio)] ??= {}).base = r; });
    return idx;
  }, [planilha]);
  const hitDe = (m) => (m ? idxPlan[chaveMun(m.uf, m.mun)] || null : null);
  const nomesConsultores = useMemo(() => [...new Set([...(planilha?.consultores || []).map((r) => r.consultor)].map((s) => String(s || '').replace(/\s+/g, ' ').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')), [planilha]);
  const estagios = useMemo(() => {
    const mapa = {};
    ESTAGIOS_CONS.forEach((n) => { mapa[nk(n)] = n; });
    (planilha?.consultores || []).forEach((r) => { const n = String(r?.estagio || '').replace(/\s+/g, ' ').trim(); if (n) mapa[nk(n)] = n; });
    return Object.values(mapa).sort((a, b) => a.localeCompare(b, 'pt'));
  }, [planilha]);

  // ---------- municípios (base de orelhões do mapa) ----------
  const municipios = useMemo(() => {
    const m = new Map();
    orelhoes.forEach((p) => { const k = chaveSdr(p.uf, p.municipio); const x = m.get(k) || { uf: p.uf, mun: p.municipio, n: 0 }; x.n += 1; m.set(k, x); });
    return [...m.values()];
  }, [orelhoes]);
  const ufs = useMemo(() => Object.keys(UF_NOME).filter((u) => municipios.some((m) => m.uf === u)), [municipios]);

  // ---------- filtros e lista ----------
  const [uf, setUf] = useState('');
  const [qtd, setQtd] = useState('');
  const [listaAtual, setListaAtual] = useState(null); // null = ainda não listou
  const [carteira, setCarteira] = useState(false);
  const [meta, setMeta] = useState('');
  const [escopo, setEscopo] = useState('A pesquisa começa pela quantidade de orelhões. Sem estado, a lista é o Brasil inteiro. Com a UF, fica só aquele estado. Depois abra a lousa do município.');
  const [teclado, setTeclado] = useState('');
  const [sel, setSel] = useState(null);
  const [consultaMun, setConsultaMun] = useState(null);
  const consultaRef = useRef(null);
  const quadroRef = useRef(null);
  const qtdN = (v = qtd) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

  const clientesCarteira = (u = uf) => {
    const origem = (planilha?.carteira?.length ? planilha.carteira : (planilha?.municipios || []).filter((r) => r.carteira));
    const porChave = new Map(municipios.map((m) => [chaveSdr(m.uf, m.mun), m]));
    const vistos = new Set();
    return origem.map((r) => {
      const b = porChave.get(chaveSdr(r.uf, r.municipio));
      const n = Number(r.orelhoes) || (b ? b.n : 0);
      return b ? { mun: b.mun, uf: b.uf, n } : { mun: r.municipio, uf: String(r.uf || '').toUpperCase(), n };
    }).filter((m) => { const k = chaveSdr(m.uf, m.mun); if (vistos.has(k)) return false; vistos.add(k); return !u || m.uf === u; })
      .sort((a, b) => (!u && a.uf !== b.uf ? a.uf.localeCompare(b.uf) : a.mun.localeCompare(b.mun, 'pt-BR')));
  };
  const nCarteira = useMemo(() => clientesCarteira('').length, [planilha, municipios]); // eslint-disable-line react-hooks/exhaustive-deps

  const listar = (u = uf, q = qtd) => {
    setCarteira(false); setTeclado('');
    const n = qtdN(q);
    const lista = municipios.filter((m) => (!u || m.uf === u) && (!n || m.n === n))
      .sort((a, b) => (!u && a.uf !== b.uf ? a.uf.localeCompare(b.uf) : a.mun.localeCompare(b.mun, 'pt-BR')));
    setMeta(`${lista.length} município(s) ${u ? 'em ' + UF_NOME[u] : 'no Brasil'}${n ? ` com exatamente ${n} orelh${n === 1 ? 'ão' : 'ões'}` : ''}`);
    setEscopo(n ? `Lista: ${u ? UF_NOME[u] : 'Brasil'} com exatamente ${n} orelhões.` : `0 mostra todos os municípios${u ? ' de ' + UF_NOME[u] : ''}. 1 mostra só quem tem 1 orelhão.`);
    setListaAtual(lista);
    if (sel && !lista.some((m) => chaveSdr(m.uf, m.mun) === chaveSdr(sel.uf, sel.mun))) setSel(null);
    return lista;
  };
  const listarCarteira = () => {
    setCarteira(true); setTeclado('');
    const lista = clientesCarteira();
    setMeta(`${lista.length} cliente(s) de carteira${uf ? ' em ' + UF_NOME[uf] : ''}`);
    setEscopo(uf ? `Clientes de carteira em ${UF_NOME[uf]}. Clique em Lousa para pesquisar este município.` : 'Clientes de carteira no Brasil. Clique em Lousa para pesquisar este município.');
    setListaAtual(lista);
    if (sel && !lista.some((m) => chaveSdr(m.uf, m.mun) === chaveSdr(sel.uf, sel.mun))) setSel(null);
  };
  const chips = useMemo(() => {
    if (listaAtual === null) return [];
    const d = {}; municipios.forEach((m) => { if (!uf || m.uf === uf) d[m.n] = (d[m.n] || 0) + 1; });
    const n = qtdN();
    return Object.keys(d).map(Number).sort((a, b) => a - b).filter((x) => !n || x === n).map((x) => ({ n: x, muns: d[x] }));
  }, [listaAtual, municipios, uf, qtd]); // eslint-disable-line react-hooks/exhaustive-deps

  // abrir a lousa de um município
  const ativar = (m, rolar = false) => {
    setSel(m); setConsultaMun(m);
    if (rolar) setTimeout(() => quadroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  // veio da Ação TUPs com um município: UF e CHAVE preenchidas, lista, lousa e consulta abertas
  const abriu = useRef(false);
  useEffect(() => {
    if (abriu.current || !inicial?.mun || !municipios.length || !nome) return;
    abriu.current = true;
    const achado = municipios.find((x) => x.uf === inicial.uf && nk(x.mun) === nk(inicial.mun));
    const n = achado?.n || Number(inicial.qtd) || 0;
    const u = (inicial.uf || '').toUpperCase();
    setUf(u); setQtd(n ? String(n) : '');
    const lista = listar(u, n ? String(n) : '');
    const m = lista.find((x) => nk(x.mun) === nk(inicial.mun)) || achado || { uf: u, mun: inicial.mun, n };
    ativar(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [municipios.length, nome]);

  // filtro por teclado (letras fora dos campos filtram a lista pelo começo do nome)
  useEffect(() => {
    const h = (ev) => {
      if (!listaAtual?.length) return;
      const t = ev.target, tag = t?.tagName?.toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT' || t?.isContentEditable) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === 'Escape') { if (!teclado) return; setTeclado(''); ev.preventDefault(); ev.stopPropagation(); return; }
      if (ev.key === 'Backspace') { if (!teclado) return; setTeclado((x) => x.slice(0, -1)); ev.preventDefault(); return; }
      if (ev.key.length === 1 && /^[\p{L}\p{N}\s]$/u.test(ev.key)) { setTeclado((x) => x + ev.key); ev.preventDefault(); }
    };
    document.addEventListener('keydown', h, true);
    return () => document.removeEventListener('keydown', h, true);
  }, [listaAtual, teclado]);

  const situacao = (m) => {
    const r = registros[chaveSdr(m.uf, m.mun)];
    if (r?.status) return r.status;
    const h = hitDe(m);
    return codigoDaPlanilha(h?.sdr?.status) || codigoDaPlanilha(h?.cons?.status) || '';
  };
  const base = listaAtual === null ? [] : carteira ? listaAtual : (qtdN() ? listaAtual.filter((m) => m.n === qtdN() || !m.n) : listaAtual);
  const visiveis = teclado ? base.filter((m) => nk(m.mun).startsWith(nk(teclado))) : base;
  const listaRef = useRef(null);
  useEffect(() => { if (teclado) listaRef.current?.querySelector('.s2-mun-item')?.scrollIntoView({ block: 'nearest' }); }, [teclado]);
  const regSel = sel ? registros[chaveSdr(sel.uf, sel.mun)] : null;

  return (
    <main className="s2">
      <section className="s2-painel s2-painel-nome">
        <div className="s2-nome-cabeca">
          <label htmlFor="s2-nome">Quem está pesquisando</label>
          <button type="button" className="s2-btn-ajuda" onClick={() => setAjuda((v) => !v)} aria-label="Por que este campo">?</button>
          <i className={`s2-coletivo ${sync}`}>{sync === 'ok' ? 'Coletivo · todos veem' : sync === 'aviso' ? 'Sem conexão com o banco' : 'Coletivo'}</i>
        </div>
        {ajuda && <p className="s2-ajuda-nome">Este nome marca quem fez a pesquisa no município. Toda vez que você alterar aquele município, fica registrado quem mexeu. O nome tem que ser o mesmo que você usa no Webex. Ele fica neste acesso até você sair.</p>}
        <form className="s2-form-nome" onSubmit={confirmarNome} autoComplete="off">
          <input id="s2-nome" type="text" maxLength={60} value={nome || digitado} disabled={!!nome} onChange={(e) => setDigitado(e.target.value)} placeholder="Seu nome no Webex" autoComplete="name" />
          {!nome && <button type="submit" className="s2-btn primario">Confirmar</button>}
        </form>
        <p className="s2-atend-hint">{nome ? `Nome marcado: ${nome}. Fica neste acesso enquanto você estiver logado.` : 'Escreva o seu nome, igual ao do Webex, para liberar a pesquisa.'}</p>
        {nome && <button type="button" className="s2-btn" onClick={desmarcar}>Desmarcar nome</button>}
      </section>

      <section className={`s2-filtros ${nome ? '' : 'sem-nome'}`}>
        <h1 className="s2-titulo-controle">Pesquisa Municípios</h1>
        <div className="s2-consulta-embutida" ref={consultaRef}>
          <div className="s2-painel-cabeca"><h2>Gestão municipal</h2><small>Prefeito, CNPJ, telefone e e-mail deste município</small></div>
          <Consulta m={consultaMun} setM={setConsultaMun} municipios={municipios} orelhoes={orelhoes} hitDe={hitDe} registros={registros} onVerMunicipio={onVerMunicipio} />
        </div>
        <h2>Escolha a quantidade de orelhões e o município</h2>
        <div className="s2-filtros-row">
          <div className="s2-campo">
            <label htmlFor="s2-uf">UF</label>
            <select id="s2-uf" value={uf} disabled={!nome} onChange={(e) => { setUf(e.target.value); if (listaAtual !== null) listar(e.target.value, qtd); }}>
              <option value="">Selecione a UF</option>
              {ufs.map((u) => <option key={u} value={u}>{u} — {UF_NOME[u]}</option>)}
            </select>
          </div>
          <div className="s2-campo">
            <label htmlFor="s2-qtd">CHAVE (pontos)</label>
            <input id="s2-qtd" className="s2-qtd" type="number" min="0" step="1" value={qtd} disabled={!nome} onChange={(e) => setQtd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') listar(); }} />
          </div>
          <button type="button" className="s2-btn primario" disabled={!nome} onClick={() => listar()}>Listar municípios</button>
        </div>
        <div className="s2-chips-linha">
          <button type="button" className={`s2-chip carteira ${carteira ? 'ativo' : ''}`} onClick={listarCarteira}>Clientes de carteira{nCarteira ? ` · ${nCarteira}` : ''}</button>
          {chips.map((c) => (
            <button key={c.n} type="button" className={`s2-chip ${qtdN() === c.n ? 'ativo' : ''}`} disabled={!nome} onClick={() => { setQtd(String(c.n)); listar(uf, String(c.n)); }}>
              {c.n} {c.n === 1 ? 'orelhão' : 'orelhões'} · {c.muns} mun.
            </button>
          ))}
        </div>
        <p className="s2-note">{nome ? escopo : 'Sem o seu nome, a pesquisa e a lousa ficam fechadas.'}</p>
      </section>

      <section className="s2-layout" ref={quadroRef}>
        <div className="s2-col-esq">
          <article className="s2-painel s2-painel-muns">
            <div className="s2-painel-cabeca"><h2>Municípios</h2><small>{nome ? (meta || 'Nenhum filtro ainda') : 'Escreva o seu nome para pesquisar'}</small></div>
            {teclado && <p className="s2-filtro-teclado">Teclado: “{teclado}” · {visiveis.length} de {base.length} · Esc limpa · Backspace apaga letra</p>}
            <div className="s2-lista-mun" ref={listaRef}>
              {!nome ? <div className="s2-vazio">Escreva o seu nome para listar os municípios.</div>
                : !base.length ? <div className="s2-vazio">{carteira ? 'Nenhum cliente de carteira neste recorte.' : 'Nenhum município neste recorte. Informe a quantidade — ou clique num chip acima.'}</div>
                  : !visiveis.length ? <div className="s2-vazio">Nenhum município começa com “{teclado}”. Esc para limpar o filtro.</div>
                    : visiveis.map((m) => {
                      const k = chaveSdr(m.uf, m.mun), r = registros[k], st = situacao(m);
                      const eSel = sel && chaveSdr(sel.uf, sel.mun) === k;
                      return (
                        <div key={k} className={`s2-mun-item ${st} ${r?.dados?.contatosValidos ? 'valido' : ''} ${eSel ? 'selecionado' : ''}`}>
                          <div className="s2-mun-corpo">
                            <a href="#" className="s2-mun-nome" title="Abrir a pesquisa deste município" onClick={(e) => { e.preventDefault(); ativar(m); }}>{uf ? m.mun : `${m.mun} (${m.uf})`}</a>
                            {r?.atendente && <div className="s2-quem">Pesquisa feita por {r.atendente}</div>}
                            {(eSel || visiveis.length === 1) && <InfoMunicipio m={m} r={r} hit={hitDe(m)} st={st} />}
                          </div>
                          {m.n ? <span className="s2-mun-qtd">{m.n === 1 ? '1 orelhão' : `${m.n} orelhões`}</span> : <span />}
                          <button type="button" className="s2-btn-lousa" onClick={() => ativar(m)}>Lousa</button>
                        </div>
                      );
                    })}
            </div>
            <div className="s2-legenda">
              {STATUS.map((s) => <span key={s.id}><i style={{ background: s.cor }} />{s.rotulo}</span>)}
              <span><i style={{ background: '#bef264' }} />Contatos válidos</span>
            </div>
          </article>
        </div>
        <div className="s2-col-dir">
          {sel
            ? <Lousa key={chaveSdr(sel.uf, sel.mun)} m={sel} reg={regSel} hit={hitDe(sel)} senha={senha} nome={nome} ehConsultor={ehConsultor}
              nomesConsultores={nomesConsultores} estagios={estagios} onSalvo={salvo}
              onConsulta={() => { setConsultaMun(sel); consultaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
            : <LousaVazia />}
        </div>
      </section>
    </main>
  );
}

// dados do município (aparece no item selecionado da lista)
function InfoMunicipio({ m, r, hit, st }) {
  const d = r?.dados || {}, s = hit?.sdr;
  const linhas = [
    d.contatosValidos ? ['Contatos válidos', 'Gravados neste município'] : null,
    ['Situação', st ? rotuloStatus(st) : ''],
    ['Orelhões', m.n ? String(m.n) : ''],
    ['CNPJ', hit?.base?.cnpj || ''],
    ['E-mail', d.email || s?.email || ''],
    ['Telefone', d.telefone || s?.contato || ''],
    ['Nome', [d.nomeContato || s?.nome || '', d.cargoContato || ''].filter(Boolean).join(' — ')],
    ['Observação', d.notas || s?.obs || hit?.cons?.contato || ''],
    ['Pesquisa feita por', r?.atendente || ''],
  ].filter((x) => x && String(x[1] || '').trim());
  if (!linhas.length) return null;
  return <div className="s2-mun-dados">{linhas.map(([a, b]) => <span key={a}><b>{a}</b> {String(b).replace(/\s+/g, ' ').trim()}</span>)}</div>;
}


function LousaVazia() {
  return (
    <>
      <article className="s2-painel s2-painel-lousa">
        <div className="s2-painel-cabeca"><h2>Lousa do contato <span className="s2-mem-marca">0 KB</span></h2><small>Escolha um município</small></div>
        <div className="s2-lousa-moldura">
          <div className="s2-lousa-titulo">Quadro livre — escreva o que quiser sobre este contato</div>
          <label className="s2-campo-rotulo">Observação<textarea className="s2-lousa" placeholder="Anote e-mails, telefones, nomes e o que encontrar neste município." disabled /></label>
          <div className="s2-status-box">
            <label className="s2-nome-contato">E-mail<input placeholder="E-mail do contato" disabled /></label>
            <label className="s2-nome-contato">Contato<input placeholder="Telefones encontrados" disabled /></label>
            <div className="s2-nome-contato s2-nome-largo"><span>Nome</span><div className="s2-nome-par"><select disabled><option>Ainda procurando</option></select><input placeholder="Nome encontrado" disabled /></div></div>
            <button type="button" className="s2-btn-limpar">Apagar texto da lousa</button>
          </div>
        </div>
      </article>
      <div className="s2-bloco-pos-lousa">
        <div className="s2-lousa-acoes">
          <button type="button" className="s2-btn primario" disabled>✏️ Editar lousa</button>
          <button type="button" className="s2-btn primario" disabled>Ver consulta deste município</button>
        </div>
      </div>
    </>
  );
}

function textoPlanilha(hit) {
  if (!hit) return '';
  const p = [];
  if (hit.sdr) p.push('Atuação SDR · ' + (ROTULO_PLAN[hit.sdr.status] || 'sem status'));
  if (hit.cons) p.push('Consultor ' + (hit.cons.consultor || 'sem nome') + ' · ' + (ROTULO_PLAN[hit.cons.status] || 'sem status'));
  if (!hit.sdr && !hit.cons && hit.base?.statusOrig) p.push('Municípios · ' + hit.base.statusOrig);
  return p.join(' · ');
}

// ---------- lousa do contato ----------
function Lousa({ m, reg, hit, senha, nome, ehConsultor, nomesConsultores, estagios, onSalvo, onConsulta }) {
  const k = chaveSdr(m.uf, m.mun);
  const d = reg?.dados || {};
  const sdrP = hit?.sdr, consP = hit?.cons;
  const inicial = () => ({
    notas: d.notas ?? sdrP?.obs ?? consP?.contato ?? '',
    email: d.email ?? sdrP?.email ?? '',
    telefone: d.telefone ?? sdrP?.contato ?? '',
    nomeContato: d.nomeContato ?? sdrP?.nome ?? '',
    cargoContato: d.cargoContato ?? '',
  });
  const [f, setF] = useState(inicial);
  const [erro, setErro] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const editando = useRef(false);
  const timer = useRef(null);
  const texto = useRef(null);
  // outro colega mudou (ou a planilha terminou de carregar): atualiza os campos, menos enquanto você digita
  useEffect(() => { if (!editando.current) setF(inicial()); /* eslint-disable-next-line */ }, [reg?.atualizadoEm, hit]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const enviar = async (campos) => {
    if (!nome) return;
    setErro('');
    try { onSalvo(await sdrSalvar(senha, k, m.uf, m.mun, { ...campos, qtd: m.n }, nome, null)); } catch (e) { setErro(e.message || String(e)); }
  };
  const muda = (campo) => (e) => {
    const v = e.target.value;
    setF((o) => ({ ...o, [campo]: v })); editando.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { editando.current = false; enviar({ [campo]: v }); }, 250);
  };
  const desabilitado = !nome;
  const resumo = resumoAcao(hit);
  const aviso = textoPlanilha(hit);
  const kb = reg ? Math.max(1, Math.round(new Blob([JSON.stringify(reg)]).size / 1024)) : 0;

  // histórico (só do nosso sistema): marcações de status com "desfazer"
  const historico = [...(reg?.acoes || [])].reverse();
  return (
    <>
      <article className="s2-painel s2-painel-lousa">
        <div className="s2-painel-cabeca">
          <h2>Lousa do contato <span className="s2-mem-marca" title="Tamanho dos dados deste município no banco">{kb} KB</span></h2>
          <small>{m.mun} ({m.uf}){reg?.atendente ? ` · pesquisa de ${reg.atendente}` : ''}</small>
        </div>
        <div className="s2-lousa-moldura">
          <div className="s2-lousa-titulo">Lousa — {m.mun}/{m.uf}</div>
          {aviso && <p className="s2-aviso-planilha">{aviso}</p>}
          <div className="s2-card-acao">
            {!resumo.naPlanilha ? <span>Sem registro na planilha Ação TUPs.</span> : (
              <div>
                {resumo.semConsultor ? <><strong className="destaque">Sem consultor</strong> na planilha.</> : <><strong>Consultor:</strong> {resumo.consultor}</>}
                {' · '}<strong>Situação:</strong> {resumo.situacao}{' · '}<strong>Proposta:</strong> {resumo.proposta}
                {resumo.sdr ? <>{' · '}<strong>SDR:</strong> {resumo.sdr}{resumo.sdrStatus ? ` (${resumo.sdrStatus})` : ''}</> : null}
                {' '}<a href="#" className="s2-card-acao-link" onClick={(e) => { e.preventDefault(); onConsulta(); }}>Detalhes na consulta</a>
              </div>
            )}
          </div>
          <label className="s2-campo-rotulo">Observação
            <textarea ref={texto} className="s2-lousa" value={f.notas} onChange={muda('notas')} disabled={desabilitado} placeholder="Anote e-mails, telefones, nomes e o que encontrar neste município." />
          </label>
          <div className="s2-status-box">
            <label className="s2-nome-contato">E-mail<input value={f.email} onChange={muda('email')} maxLength={180} placeholder="E-mail do contato" disabled={desabilitado} autoComplete="off" /></label>
            <label className="s2-nome-contato">Contato<input value={f.telefone} onChange={muda('telefone')} maxLength={240} placeholder="Telefones encontrados" disabled={desabilitado} autoComplete="off" /></label>
            <div className="s2-nome-contato s2-nome-largo">
              <span>Nome</span>
              <div className="s2-nome-par">
                <select value={f.cargoContato} disabled={desabilitado} onChange={(e) => { setF((o) => ({ ...o, cargoContato: e.target.value })); enviar({ cargoContato: e.target.value }); }}>
                  {CARGOS.map((c) => <option key={c} value={c}>{c || 'Ainda procurando'}</option>)}
                </select>
                <input value={f.nomeContato} onChange={muda('nomeContato')} maxLength={80} placeholder="Nome encontrado" disabled={desabilitado} autoComplete="off" />
              </div>
            </div>
            <button type="button" className="s2-btn-limpar" onClick={() => nome && setConfirmar(true)}>Apagar texto da lousa</button>
          </div>
          {erro && <p className="s2-erro">{erro}</p>}
        </div>
      </article>
      <div className="s2-bloco-pos-lousa">
        {ehConsultor && <Consultor key={k} reg={reg} d={d} nome={nome} nomesConsultores={nomesConsultores} estagios={estagios} enviar={enviar} />}
        <div className="s2-lousa-acoes">
          <button type="button" className="s2-btn primario" disabled={!nome} onClick={() => texto.current?.focus()}>✏️ Editar lousa</button>
          <button type="button" className="s2-btn primario" onClick={onConsulta}>Ver consulta deste município</button>
        </div>
      </div>
      {historico.length > 0 && (
        <div className="s2-historico">
          <p>Histórico</p>
          <ul>
            {historico.map((a) => (
              <li key={a.id}>
                <span className="st" style={{ '--c': STATUS_POR_ID[a.status]?.cor || '#64748b' }}>{a.tipo === 'status' ? rotuloStatus(a.status) : 'Pesquisa'}</span>
                <span>{a.atendente || '—'}</span><small>{fmtData(a.em)}</small>
                {a.tipo === 'status' && <button type="button" className="s2-link" onClick={async () => { if (!confirm('Desfazer esta marcação?')) return; try { onSalvo(await sdrDesfazer(senha, a.id, nome)); } catch (e) { setErro(e.message); } }}>desfazer</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirmar && (
        <div className="s2-modal-fundo" onClick={(e) => { if (e.target === e.currentTarget) setConfirmar(false); }}>
          <div className="s2-modal-caixa">
            <h3>Confirmar</h3>
            <p>Apagar o texto desta lousa?</p>
            <div className="s2-modal-btns">
              <button type="button" className="s2-modal-cancelar" onClick={() => setConfirmar(false)}>Cancelar</button>
              <button type="button" className="s2-modal-confirmar" onClick={() => { setConfirmar(false); setF((o) => ({ ...o, notas: '' })); enviar({ notas: '' }); }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// registro no painel · consultores (aparece para todos, menos o SDR Marco)
function Consultor({ reg, d, nome, nomesConsultores, estagios, enviar }) {
  const sugerido = d.consultorNome || nomesConsultores.find((n) => nk(n) === nk(nome)) || nome;
  const [cons, setCons] = useState(sugerido);
  const [ploomes, setPloomes] = useState(d.ploomesId || '');
  const [abreP, setAbreP] = useState(!!d.ploomesId);
  const [sug, setSug] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const liberado = PARA_CONSULTOR.has(ultimoStatus(reg));
  const salvarCons = (v) => { clearTimeout(timer.current); timer.current = setTimeout(() => enviar({ consultorNome: v.trim(), campanha: CAMPANHA }), 250); };
  const filtrados = nomesConsultores.filter((n) => !cons || nk(n).includes(nk(cons))).slice(0, 12);
  const estagio = estagios.find((n) => nk(n) === nk(d.estagio || '')) || '';
  return (
    <div className="s2-quadro-consultor">
      <p>Registro no painel · Consultores</p>
      <label className="s2-campo-rotulo">Campanha<input type="text" readOnly value={CAMPANHA} /></label>
      <label className="s2-campo-rotulo">Consultor
        <span className="s2-campo-busca">
          <input type="text" maxLength={80} value={cons} placeholder="Comece a digitar o nome" autoComplete="off"
            onChange={(e) => { setCons(e.target.value); setSug(true); salvarCons(e.target.value); }} onFocus={() => setSug(true)} onBlur={() => setTimeout(() => setSug(false), 120)} />
          {sug && filtrados.length > 0 && (
            <ul className="s2-sugestoes">{filtrados.map((n) => <li key={n} onMouseDown={() => { setCons(n); setSug(false); salvarCons(n); }}>{n}</li>)}</ul>
          )}
        </span>
      </label>
      {liberado && (
        <div className="s2-campo-estagio">
          <span>Estágio da Conversa</span>
          <select value={estagio} onChange={(e) => {
            if (e.target.value === '__ploomes__') { setAbreP(true); return; }
            enviar({ estagio: e.target.value, consultorNome: cons.trim(), campanha: CAMPANHA });
          }}>
            <option value="">Escolha o estágio</option>
            {estagios.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="__ploomes__">ID Ploomes</option>
          </select>
          {abreP && (
            <label className="s2-campo-rotulo s2-campo-ploomes">ID Ploomes
              <input type="text" maxLength={40} value={ploomes} placeholder="Se não tiver, deixe em branco" autoComplete="off" autoFocus
                onChange={(e) => { setPloomes(e.target.value); clearTimeout(timer.current); const v = e.target.value; timer.current = setTimeout(() => enviar({ ploomesId: v.trim() }), 250); }} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- consulta do município (Gestão municipal, Orelhões, 4G, Carteira e ação comercial) ----------
function Consulta({ m, setM, municipios, orelhoes, hitDe, onVerMunicipio }) {
  const [busca, setBusca] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { setBusca(m ? `${m.mun} - ${m.uf}` : ''); setMsg(''); }, [m]);
  // pesquisa: município ou localidade (sem precisar do estado)
  const opcoes = useMemo(() => municipios.map((x) => `${x.mun} - ${x.uf}`).sort((a, b) => a.localeCompare(b, 'pt-BR')), [municipios]);
  const consultar = () => {
    const t = busca.trim(); if (!t) return;
    const mm = t.match(/^(.*?)\s*[-–/]\s*([A-Za-z]{2})$/);
    const alvo = nk(mm ? mm[1] : t), ufAlvo = mm ? mm[2].toUpperCase() : '';
    let achado = municipios.find((x) => nk(x.mun) === alvo && (!ufAlvo || x.uf === ufAlvo));
    if (!achado) {
      const p = orelhoes.find((o) => nk(o.localidade) === alvo && (!ufAlvo || o.uf === ufAlvo)) || orelhoes.find((o) => nk(o.localidade).includes(alvo) && (!ufAlvo || o.uf === ufAlvo));
      if (p) achado = municipios.find((x) => x.uf === p.uf && nk(x.mun) === nk(p.municipio));
    }
    if (!achado) achado = municipios.find((x) => nk(x.mun).startsWith(alvo) && (!ufAlvo || x.uf === ufAlvo));
    if (achado) setM(achado); else setMsg('Município ou localidade não encontrado.');
  };
  const limpar = () => { setM(null); setBusca(''); setMsg(''); };
  return (
    <div className="s2-consulta">
      <section className="s2-search">
        <div className="s2-search-title">Digite o município ou a localidade:</div>
        <div className="s2-search-bar">
          <input className="s2-search-input" list="s2-lista-mun" value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') consultar(); }}
            placeholder="Município ou localidade, sem precisar do estado (Ex: Santa Joana, Buritis)" />
          <datalist id="s2-lista-mun">{busca.trim().length >= 2 && opcoes.filter((o) => nk(o).startsWith(nk(busca))).slice(0, 30).map((o) => <option key={o} value={o} />)}</datalist>
          <button type="button" className="s2-search-btn" onClick={consultar}>🔍 Consultar</button>
          <button type="button" className="s2-search-btn clear" onClick={limpar}>Limpar consulta</button>
        </div>
        {msg && <p className="s2-search-msg">{msg}</p>}
      </section>
      <MunicipioCartoes m={m} hit={hitDe(m)} onVerMunicipio={onVerMunicipio} />
    </div>
  );
}
