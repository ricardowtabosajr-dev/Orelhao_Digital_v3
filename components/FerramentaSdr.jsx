'use client';

// Administração › Ferramenta SDR: pesquisa coletiva por município (mesmo fluxo da plataforma CoLR
// "campanha-contatos"): quem pesquisa, filtros por UF e nº de orelhões, lousa do contato, situação da
// ligação com histórico, repasse ao consultor e consulta do município — tudo salvo no Supabase.

import { useEffect, useMemo, useRef, useState } from 'react';
import { acaoEntrar, acaoLer, sdrLer, sdrEntrar, sdrSalvar, sdrDesfazer } from '@/lib/supabase';
import { UF_NOME } from '@/lib/geo';
import { buscarImagemMunicipio } from '@/components/FotoMunicipio';
import {
  nk, chaveSdr, STATUS, STATUS_POR_ID, COR_VALIDO, rotuloStatus, TEVE_CONTATO, codigoDaPlanilha, CARGOS, CAMPANHA,
  ESTAGIOS_CONS, pegaContatos, urlTse, URL_SGMU, urlPortal, anatelDoMunicipio, coberturaDoMunicipio, prefeiturasDaUf, municipiosBase,
} from '@/lib/sdr';
import { chaveMun } from '@/lib/acaoTups';

const SESSAO = 'acaoTupsSenha'; // mesma sessão da Ação TUPs (a senha é a mesma)
const ler = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const grava = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const fmtData = (s) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const MAX_LISTA = 150;

export default function FerramentaSdr({ onFechar, onVoltar, orelhoes = [], inicial = null, onVerMunicipio }) {
  const [senha, setSenha] = useState(() => { try { return sessionStorage.getItem(SESSAO) || ''; } catch { return ''; } });
  const [ok, setOk] = useState(false);
  const [nome, setNome] = useState(() => ler('sdrNome'));
  const [papel, setPapel] = useState(() => ler('sdrPapel', 'sdr'));
  const [identificado, setIdentificado] = useState(false);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onFechar(); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onFechar]);
  useEffect(() => { if (senha) acaoEntrar(senha).then((r) => r === 'ok' && setOk(true)).catch(() => {}); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (ok && nome) sdrEntrar(senha, nome, papel).then(() => setIdentificado(true)).catch(() => {}); /* eslint-disable-next-line */ }, [ok]);

  return (
    <>
      <div className="admin-fundo prop-fundo" onClick={onFechar} />
      <section className="prop-tela acao-tela sdr-tela" role="dialog" aria-label="Ferramenta SDR">
        <header className="prop-topo">
          <button type="button" className="prop-voltar" onClick={onVoltar}>‹ {inicial?.de === 'acao' ? 'Ação TUPs' : 'Administração'}</button>
          <div className="prop-titulo">
            <span className="admin-selo">Administração · SDR</span>
            <h2>Ferramenta SDR</h2>
            <p>Pesquisa coletiva de e-mail, telefone e nome — todos da equipe veem</p>
          </div>
          {identificado && (
            <div className="sdr-quem">
              <span>{papel === 'consultor' ? '💼 Consultor' : '🎧 SDR'}</span><b>{nome}</b>
              <button type="button" className="prop-link" onClick={() => setIdentificado(false)}>trocar</button>
            </div>
          )}
          <button type="button" className="admin-x" onClick={onFechar} aria-label="Fechar" title="Fechar (Esc)">×</button>
        </header>
        {!ok ? <Senha onOk={(s) => { try { sessionStorage.setItem(SESSAO, s); } catch {} setSenha(s); setOk(true); }} />
          : !identificado ? <Identificar senha={senha} nome={nome} papel={papel} onOk={(n, p) => { grava('sdrNome', n); grava('sdrPapel', p); setNome(n); setPapel(p); setIdentificado(true); }} />
            : <Pesquisa senha={senha} nome={nome} papel={papel} orelhoes={orelhoes} inicial={inicial} onVerMunicipio={onVerMunicipio} />}
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
    <form className="acao-entrada" onSubmit={entrar}>
      <div className="acao-cadeado" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10.5" width="14" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.8" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="15.5" r="1.5" fill="currentColor" /></svg></div>
      <b>Acesso só para quem trabalha no SDR</b>
      <span>Informe a senha da equipe.</span>
      <input type="password" value={s} onChange={(e) => setS(e.target.value)} placeholder="Senha" autoFocus />
      {erro && <p className="prop-erro">{erro}</p>}
      <button type="submit" className="prop-btn grande" disabled={!s || indo}>{indo ? 'Conferindo…' : 'Entrar'}</button>
    </form>
  );
}

function Identificar({ senha, nome: nome0, papel: papel0, onOk }) {
  const [nome, setNome] = useState(nome0); const [papel, setPapel] = useState(papel0 || 'sdr');
  const [lista, setLista] = useState([]); const [erro, setErro] = useState(''); const [indo, setIndo] = useState(false);
  useEffect(() => { sdrLer(senha, new Date().toISOString()).then((d) => setLista(d?.atendentes || [])).catch((e) => setErro(e.message)); }, [senha]);
  const confirmar = async (e) => {
    e.preventDefault(); const n = nome.replace(/\s+/g, ' ').trim(); if (!n) return;
    setIndo(true); setErro('');
    try { await sdrEntrar(senha, n, papel); onOk(n, papel); } catch (err) { setErro(err.message || String(err)); }
    setIndo(false);
  };
  return (
    <form className="acao-entrada sdr-ident" onSubmit={confirmar}>
      <b>Quem está pesquisando?</b>
      <span>Escreva o seu nome igual ao do Webex. Ele fica marcado em tudo que você registrar.</span>
      <input list="sdr-atendentes" value={nome} onChange={(e) => { setNome(e.target.value); const a = lista.find((x) => nk(x.nome) === nk(e.target.value)); if (a) setPapel(a.papel); }} placeholder="Seu nome no Webex" maxLength={60} autoFocus />
      <datalist id="sdr-atendentes">{lista.map((a) => <option key={a.nome} value={a.nome} />)}</datalist>
      <div className="sdr-papel">
        <button type="button" className={papel === 'sdr' ? 'on' : ''} onClick={() => setPapel('sdr')}><b>🎧 SDR</b><small>pesquisa e liga para as prefeituras</small></button>
        <button type="button" className={papel === 'consultor' ? 'on' : ''} onClick={() => setPapel('consultor')}><b>💼 Consultor</b><small>recebe o contato, estágio e Ploomes</small></button>
      </div>
      {erro && <p className="prop-erro">{erro}</p>}
      <button type="submit" className="prop-btn grande" disabled={!nome.trim() || indo}>{indo ? 'Entrando…' : 'Começar'}</button>
    </form>
  );
}

function Pesquisa({ senha, nome, papel, orelhoes, inicial, onVerMunicipio }) {
  const [registros, setRegistros] = useState({}); // chave -> registro do banco
  const [sync, setSync] = useState('carregando'); // carregando | ok | erro
  const [erro, setErro] = useState('');
  const [planilha, setPlanilha] = useState(null);
  const [uf, setUf] = useState(inicial?.uf || '');
  const [qtd, setQtd] = useState('');
  const [busca, setBusca] = useState(inicial?.mun || '');
  const [carteira, setCarteira] = useState(false);
  const [sel, setSel] = useState(null); // { uf, mun, n }
  const desde = useRef(null);

  // registros do banco: carga inicial e atualização a cada 5 s (só o que mudou)
  useEffect(() => {
    let vivo = true;
    const puxar = async () => {
      if (document.hidden) return;
      try {
        const d = await sdrLer(senha, desde.current);
        if (!vivo) return;
        desde.current = d.agora;
        if (d.registros?.length) setRegistros((o) => { const n = { ...o }; d.registros.forEach((r) => { n[r.chave] = r; }); return n; });
        setSync('ok'); setErro('');
      } catch (e) { if (vivo) { setSync('erro'); setErro(e.message || String(e)); } }
    };
    puxar();
    const t = setInterval(puxar, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, [senha]);
  useEffect(() => { acaoLer(senha).then((r) => setPlanilha(r?.dados || null)).catch(() => {}); }, [senha]);

  // municípios = base de orelhões do Orelhão Digital (o mesmo do mapa)
  const municipios = useMemo(() => {
    const m = new Map();
    orelhoes.forEach((p) => { const k = chaveSdr(p.uf, p.municipio); const x = m.get(k) || { uf: p.uf, mun: p.municipio, n: 0 }; x.n += 1; m.set(k, x); });
    return [...m.values()];
  }, [orelhoes]);
  // planilha: situação, observação e contatos de cada município
  const idxPlan = useMemo(() => {
    const idx = {};
    if (!planilha) return idx;
    (planilha.atuacao || []).forEach((r) => { const k = chaveMun(r.uf, r.municipio); const cur = idx[k]?.sdr; if (!cur || (r.status && (!cur.status || r.aba > cur.aba))) (idx[k] ??= {}).sdr = r; });
    (planilha.consultores || []).forEach((r) => { (idx[chaveMun(r.uf, r.municipio)] ??= {}).cons = r; });
    (planilha.municipios || []).forEach((r) => { (idx[chaveMun(r.uf, r.municipio)] ??= {}).base = r; });
    return idx;
  }, [planilha]);
  const nomesConsultores = useMemo(() => [...new Set([...(planilha?.consultores || []).map((r) => r.consultor), ...(planilha?.municipios || []).map((r) => r.consultor)].map((s) => String(s || '').trim()).filter((s) => s && !/^a definir$/i.test(s)))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [planilha]);
  const carteiraLista = useMemo(() => (planilha?.carteira || planilha?.municipios?.filter((r) => r.carteira) || []), [planilha]);

  const situacao = (m) => {
    const r = registros[chaveSdr(m.uf, m.mun)];
    if (r?.status) return r.status;
    const h = idxPlan[chaveMun(m.uf, m.mun)];
    return codigoDaPlanilha(h?.sdr?.status) || codigoDaPlanilha(h?.cons?.status) || '';
  };

  const ufs = useMemo(() => [...new Set(municipios.map((m) => m.uf))].sort(), [municipios]);
  const doUf = useMemo(() => municipios.filter((m) => !uf || m.uf === uf), [municipios, uf]);
  const chips = useMemo(() => { const b = {}; doUf.forEach((m) => { b[m.n] = (b[m.n] || 0) + 1; }); return Object.entries(b).map(([n, c]) => ({ n: Number(n), c })).sort((a, b) => a.n - b.n); }, [doUf]);
  const lista = useMemo(() => {
    let l;
    if (carteira) {
      const k = new Set(carteiraLista.map((r) => chaveSdr(r.uf, r.municipio)));
      l = municipios.filter((m) => k.has(chaveSdr(m.uf, m.mun)) && (!uf || m.uf === uf));
    } else {
      const q = nk(busca);
      l = doUf.filter((m) => (!qtd || m.n === Number(qtd)) && (!q || nk(m.mun).includes(q)));
    }
    return l.sort((a, b) => (uf ? 0 : a.uf.localeCompare(b.uf)) || a.mun.localeCompare(b.mun, 'pt-BR'));
  }, [carteira, carteiraLista, municipios, doUf, uf, qtd, busca]);

  // abre direto o município pedido (vindo da Ação TUPs)
  useEffect(() => {
    if (!inicial?.mun || !municipios.length) return;
    const m = municipios.find((x) => x.uf === inicial.uf && nk(x.mun) === nk(inicial.mun));
    setSel(m || { uf: inicial.uf, mun: inicial.mun, n: Number(inicial.qtd) || 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [municipios.length]);

  const salvarRegistro = (r) => setRegistros((o) => ({ ...o, [r.chave]: r }));
  const resumo = useMemo(() => {
    const c = { total: 0 }; Object.values(registros).forEach((r) => { if (r.status) { c[r.status] = (c[r.status] || 0) + 1; c.total += 1; } });
    return c;
  }, [registros]);

  return (
    <div className="sdr-corpo">
      <div className="sdr-esq">
        <div className={`sdr-sync ${sync}`}>{sync === 'ok' ? '● Coletivo · todos veem' : sync === 'erro' ? `● Sem conexão com o banco — ${erro}` : '● Conectando…'}</div>
        <div className="sdr-filtros">
          <select value={uf} onChange={(e) => { setUf(e.target.value); setQtd(''); setCarteira(false); }}>
            <option value="">Brasil inteiro</option>{ufs.map((u) => <option key={u} value={u}>{u} — {UF_NOME[u] || u}</option>)}
          </select>
          <input type="number" min="1" value={qtd} onChange={(e) => { setQtd(e.target.value); setCarteira(false); }} placeholder="Nº de orelhões" title="CHAVE (pontos): quantidade exata de orelhões no município" />
        </div>
        <input type="search" className="acao-busca" value={busca} onChange={(e) => { setBusca(e.target.value); setCarteira(false); }} placeholder="Buscar município…" />
        <div className="sdr-chips">
          {carteiraLista.length > 0 && <button type="button" className={`cart ${carteira ? 'on' : ''}`} onClick={() => { setCarteira((v) => !v); setQtd(''); setBusca(''); }}>Clientes de carteira · {carteiraLista.length}</button>}
          {!carteira && (qtd ? chips.filter((c) => c.n === Number(qtd)) : chips.slice(0, 14)).map((c) => (
            <button key={c.n} type="button" className={Number(qtd) === c.n ? 'on' : ''} onClick={() => setQtd(Number(qtd) === c.n ? '' : String(c.n))}>{c.n} orelhã{c.n === 1 ? 'o' : 'os'} · {c.c} mun.</button>
          ))}
        </div>
        <div className="sdr-legenda">{STATUS.map((s) => <span key={s.id}><i style={{ background: s.cor }} />{s.rotulo} {resumo[s.id] ? <b>{resumo[s.id]}</b> : null}</span>)}<span><i style={{ background: COR_VALIDO }} />Contatos válidos</span></div>
        <p className="sdr-conta">{carteira ? `${lista.length} clientes de carteira` : `${lista.length} município(s)${qtd ? ` com ${qtd} orelhão(ões)` : ''}${uf ? ` em ${UF_NOME[uf] || uf}` : ''}`}</p>
        <ul className="sdr-lista">
          {lista.slice(0, MAX_LISTA).map((m) => {
            const k = chaveSdr(m.uf, m.mun), r = registros[k], st = situacao(m);
            return (
              <li key={k}>
                <button type="button" className={`${sel && chaveSdr(sel.uf, sel.mun) === k ? 'on' : ''}`} style={{ '--st': r?.dados?.contatosValidos ? COR_VALIDO : STATUS_POR_ID[st]?.cor || 'transparent' }} onClick={() => setSel(m)}>
                  <span className="sdr-li-nome">{m.mun}{!uf && <small> ({m.uf})</small>}</span>
                  <span className="sdr-li-info">{m.n} orelhã{m.n === 1 ? 'o' : 'os'}{st ? ` · ${rotuloStatus(st)}` : ''}{r?.atendente ? ` · ${r.atendente}` : ''}</span>
                </button>
              </li>
            );
          })}
          {lista.length > MAX_LISTA && <li className="sdr-mais">+ {lista.length - MAX_LISTA} municípios — use a UF, o nº de orelhões ou a busca para filtrar</li>}
          {!lista.length && <li className="acao-vazio">Nenhum município neste recorte.</li>}
        </ul>
      </div>
      <div className="sdr-dir">
        {sel ? <Municipio key={chaveSdr(sel.uf, sel.mun)} m={sel} reg={registros[chaveSdr(sel.uf, sel.mun)]} plan={idxPlan[chaveMun(sel.uf, sel.mun)]}
          senha={senha} nome={nome} papel={papel} nomesConsultores={nomesConsultores} orelhoes={orelhoes} onSalvo={salvarRegistro} onVerMunicipio={onVerMunicipio} />
          : <div className="sdr-vazio"><b>Escolha um município na lista</b><span>Filtre pela UF e pelo número de orelhões (a “chave” da campanha) ou busque pelo nome.</span></div>}
      </div>
    </div>
  );
}

function Municipio({ m, reg, plan, senha, nome, papel, nomesConsultores, orelhoes, onSalvo, onVerMunicipio }) {
  const k = chaveSdr(m.uf, m.mun);
  const [aba, setAba] = useState('lousa');
  const d = reg?.dados || {};
  const sdrP = plan?.sdr, consP = plan?.cons, baseP = plan?.base;
  // campos da lousa: o que está no banco; senão, o que veio da planilha
  const inicial = () => ({
    notas: d.notas ?? sdrP?.obs ?? consP?.contato ?? '',
    email: d.email ?? sdrP?.email ?? '',
    telefone: d.telefone ?? sdrP?.contato ?? '',
    nomeContato: d.nomeContato ?? sdrP?.nome ?? '',
    cargoContato: d.cargoContato ?? '',
  });
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState('');
  const [erro, setErro] = useState('');
  const editando = useRef(false);
  const timer = useRef(null);
  // outro colega mudou: atualiza os campos (menos enquanto você digita)
  useEffect(() => { if (!editando.current) setF(inicial()); /* eslint-disable-next-line */ }, [reg?.atualizadoEm]);

  const enviar = async (campos, status = null) => {
    setSalvando('salvando…'); setErro('');
    try {
      const r = await sdrSalvar(senha, k, m.uf, m.mun, { ...campos, qtd: m.n }, nome, status);
      onSalvo(r); setSalvando('✔ salvo ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) { setErro(e.message || String(e)); setSalvando(''); }
  };
  const muda = (campo) => (e) => {
    const v = e.target.value;
    setF((o) => ({ ...o, [campo]: v })); editando.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { editando.current = false; enviar({ [campo]: v }); }, 700);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const status = reg?.status || codigoDaPlanilha(sdrP?.status) || '';
  const teveContato = (reg?.acoes || []).some((a) => a.tipo === 'status' && TEVE_CONTATO.has(a.status));
  const marcar = (st) => enviar({ ...f }, st);

  const pega = () => {
    const c = pegaContatos(f.notas);
    if (!c.emails.length && !c.telefones.length && !c.prefeito) { setErro('Não achei telefone, e-mail ou prefeito no texto da lousa.'); return; }
    const novo = {
      email: [...new Set([...String(f.email || '').split(/[;,\s]+/).filter(Boolean), ...c.emails])].join('; '),
      telefone: [...new Set([...String(f.telefone || '').split(/\s*(?:\/\/|\/|;)\s*/).filter(Boolean), ...c.telefones])].join(' // '),
    };
    setF((o) => ({ ...o, ...novo })); enviar({ ...novo, ...(c.prefeito ? { prefeitoInformado: c.prefeito } : {}) });
  };

  const historico = [...(reg?.acoes || [])].reverse();
  return (
    <div className="sdr-mun">
      <div className="sdr-mun-topo">
        <div>
          <h3>{m.mun} <small>{m.uf}</small></h3>
          <span>{m.n} orelhã{m.n === 1 ? 'o' : 'os'} no mapa{status ? ` · ${rotuloStatus(status)}` : ''}{reg?.atendente ? ` · pesquisa de ${reg.atendente}` : ''}</span>
        </div>
        <div className="prop-linha">
          {onVerMunicipio && <button type="button" className="prop-btn sec peq" onClick={() => onVerMunicipio(m.uf, m.mun)}>🗺️ Ver no mapa</button>}
        </div>
      </div>
      <nav className="acao-abas sdr-abas">
        <button className={aba === 'lousa' ? 'on' : ''} onClick={() => setAba('lousa')}>📝 Lousa do contato</button>
        <button className={aba === 'consulta' ? 'on' : ''} onClick={() => setAba('consulta')}>🏛️ Consulta do município</button>
      </nav>
      {aba === 'lousa' ? (
        <div className="sdr-lousa">
          {(sdrP || consP) && (
            <p className="sdr-plan">📋 Na planilha: {sdrP ? `Atuação SDR · ${rotuloStatus(codigoDaPlanilha(sdrP.status)) || 'sem status'}` : ''}{consP ? ` · Consultor ${consP.consultor || '—'} · ${consP.estagio || rotuloStatus(codigoDaPlanilha(consP.status))}` : ''}{baseP?.estagio ? ` · Estágio: ${baseP.estagio}` : ''}</p>
          )}
          <label className="prop-campo"><span>Observação <small>(salva sozinha)</small></span>
            <textarea rows={6} value={f.notas} onChange={muda('notas')} placeholder="Anote e-mails, telefones, nomes e o que encontrar…" />
          </label>
          <div className="prop-linha">
            <button type="button" className="prop-btn sec peq" onClick={pega} title="Separa telefones e e-mails escritos na observação">📞 Pega telefone</button>
            {f.notas && <button type="button" className="prop-link" onClick={() => { if (confirm('Apagar o texto da lousa?')) { setF((o) => ({ ...o, notas: '' })); enviar({ notas: '' }); } }}>Apagar texto da lousa</button>}
            <span className="sdr-salvo">{salvando}</span>
          </div>
          <div className="prop-grade">
            <label className="prop-campo"><span>E-mail</span><input value={f.email} onChange={muda('email')} placeholder="E-mail do contato" /></label>
            <label className="prop-campo"><span>Contato (telefone)</span><input value={f.telefone} onChange={muda('telefone')} placeholder="Telefones encontrados" /></label>
            <label className="prop-campo"><span>Cargo</span><select value={f.cargoContato} onChange={(e) => { setF((o) => ({ ...o, cargoContato: e.target.value })); enviar({ cargoContato: e.target.value }); }}>{CARGOS.map((c) => <option key={c} value={c}>{c || 'Ainda procurando'}</option>)}</select></label>
            <label className="prop-campo"><span>Nome</span><input value={f.nomeContato} onChange={muda('nomeContato')} placeholder="Nome encontrado" /></label>
          </div>
          <label className="prop-check sdr-valido">
            <input type="checkbox" checked={!!d.contatosValidos} disabled={!!d.contatosValidos || (!f.telefone && !f.email)} onChange={() => enviar({ contatosValidos: true, telefone: f.telefone, email: f.email })} />
            Contatos válidos (telefone/e-mail conferidos) {d.contatosValidos && <small>— marcado</small>}
          </label>
          {erro && <p className="prop-erro">{erro}</p>}

          <h4 className="sdr-tit">Situação da ligação</h4>
          <div className="sdr-status">
            {STATUS.map((s) => {
              const bloq = s.id === 'sem_contato' && teveContato;
              return (
                <button key={s.id} type="button" disabled={bloq} title={bloq ? 'Já houve contato com este município' : ''} className={status === s.id ? 'on' : ''} style={{ '--c': s.cor }} onClick={() => marcar(s.id)}>
                  <i />{s.rotulo}
                </button>
              );
            })}
          </div>

          {papel === 'consultor' && <Consultor k={k} d={d} nome={nome} status={status} nomesConsultores={nomesConsultores} enviar={enviar} />}

          {historico.length > 0 && (
            <>
              <h4 className="sdr-tit">Histórico</h4>
              <ul className="sdr-hist">
                {historico.map((a) => (
                  <li key={a.id}>
                    <span className="sdr-hist-st" style={{ '--c': STATUS_POR_ID[a.status]?.cor || '#64748b' }}>{a.tipo === 'status' ? rotuloStatus(a.status) : 'Pesquisa'}</span>
                    <span>{a.atendente || '—'}</span><small>{fmtData(a.em)}</small>
                    {a.tipo === 'status' && <button type="button" className="prop-link" onClick={async () => { if (!confirm('Desfazer esta marcação?')) return; try { onSalvo(await sdrDesfazer(senha, a.id, nome)); } catch (e) { setErro(e.message); } }}>desfazer</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : <Consulta m={m} plan={plan} reg={reg} orelhoes={orelhoes} />}
    </div>
  );
}

function Consultor({ d, nome, status, nomesConsultores, enviar }) {
  const padrao = d.consultorNome || nomesConsultores.find((n) => nk(n) === nk(nome)) || '';
  const [cons, setCons] = useState(padrao);
  const [ploomes, setPloomes] = useState(d.ploomesId || '');
  const interagiu = ['retorno', 'agenda', 'sem_interesse', 'retornar', 'interessante'].includes(status);
  const salvarCons = (v) => enviar({ consultorNome: v, campanha: CAMPANHA });
  return (
    <div className="sdr-cons">
      <h4 className="sdr-tit">💼 Consultor</h4>
      <div className="prop-grade">
        <label className="prop-campo"><span>Campanha</span><input value={CAMPANHA} readOnly /></label>
        <label className="prop-campo"><span>Consultor</span>
          <input list="sdr-consultores" value={cons} onChange={(e) => setCons(e.target.value)} onBlur={() => cons !== (d.consultorNome || '') && salvarCons(cons.trim())} placeholder="Comece a digitar o nome" />
          <datalist id="sdr-consultores">{nomesConsultores.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <label className="prop-campo"><span>Estágio da conversa</span>
          <select value={d.estagio || ''} disabled={!interagiu} title={interagiu ? '' : 'Marque a situação da ligação primeiro'} onChange={(e) => enviar({ estagio: e.target.value, consultorNome: cons.trim(), campanha: CAMPANHA })}>
            <option value="">{interagiu ? 'Escolha o estágio' : 'Depois da 1ª ligação'}</option>
            {ESTAGIOS_CONS.map((e) => <option key={e}>{e}</option>)}
          </select>
        </label>
        <label className="prop-campo"><span>ID Ploomes</span><input value={ploomes} onChange={(e) => setPloomes(e.target.value)} onBlur={() => ploomes !== (d.ploomesId || '') && enviar({ ploomesId: ploomes.trim() })} placeholder="Se não tiver, deixe em branco" /></label>
      </div>
    </div>
  );
}

function Consulta({ m, plan, reg, orelhoes }) {
  const [pref, setPref] = useState(undefined);
  const [anatel, setAnatel] = useState(undefined);
  const [cob, setCob] = useState(undefined);
  const [brasao, setBrasao] = useState(null);
  const [ibge, setIbge] = useState('');
  useEffect(() => {
    let vivo = true;
    prefeiturasDaUf(m.uf).then((d) => { if (vivo) setPref(Object.entries(d || {}).find(([n]) => nk(n) === nk(m.mun))?.[1] || null); });
    anatelDoMunicipio(m.uf, m.mun).then((a) => vivo && setAnatel(a));
    municipiosBase().then((b) => {
      const x = (b?.municipios || []).find((r) => r.uf === m.uf && nk(r.nome) === nk(m.mun));
      if (!vivo) return;
      setIbge(x?.ibge || '');
      if (x?.ibge) coberturaDoMunicipio(x.ibge).then((c) => vivo && setCob(c)); else setCob(null);
    });
    buscarImagemMunicipio(m.mun, UF_NOME[m.uf] || '').then((r) => vivo && setBrasao(r?.tipo === 'brasao' ? r.srcs?.[0] : null)).catch(() => {});
    return () => { vivo = false; };
  }, [m.uf, m.mun]);
  const prefeito = pref?.oficial?.nome || pref?.prefeito || '';
  const cnpj = plan?.base?.cnpj || plan?.cons?.cnpj || '';
  const noMapa = orelhoes.filter((p) => p.uf === m.uf && nk(p.municipio) === nk(m.mun));
  return (
    <div className="sdr-consulta">
      <div className="sdr-cons-grade">
        <section className="prop-bloco">
          <h3>🏛️ Gestão municipal</h3>
          <div className="sdr-gestao">
            <div className="sdr-brasao">{brasao ? <img src={brasao} alt={`Brasão de ${m.mun}`} /> : <span>🏛️</span>}</div>
            <dl className="prop-resumo">
              <dt>Município</dt><dd>{m.mun} — {UF_NOME[m.uf] || m.uf}{ibge ? <small> · IBGE {ibge}</small> : null}</dd>
              <dt>Prefeito(a)</dt><dd>{pref === undefined ? '…' : prefeito ? <>{prefeito}{pref?.oficial?.partido ? ` · ${pref.oficial.partido}` : ''}<small> {pref?.oficial?.obs || ''}</small></> : 'Gabinete do Executivo Municipal'}</dd>
              <dt>CNPJ</dt><dd>{cnpj || '—'}</dd>
              <dt>Telefone</dt><dd>{pref?.telefone || reg?.dados?.telefone || '—'}</dd>
              <dt>E-mail</dt><dd>{reg?.dados?.email || '—'}</dd>
            </dl>
          </div>
          <div className="prop-linha">
            <a className="prop-btn sec peq" href={pref?.site || urlPortal(m.mun, m.uf)} target="_blank" rel="noreferrer">Portal oficial ↗</a>
            <a className="prop-btn sec peq" href={`https://www.google.com/search?q=${encodeURIComponent(`gabinete prefeito ${m.mun} ${m.uf} telefone`)}`} target="_blank" rel="noreferrer">Gabinete ↗</a>
            <a className="prop-btn sec peq" href={urlTse(m.uf)} target="_blank" rel="noreferrer">TSE ↗</a>
          </div>
        </section>
        <section className="prop-bloco">
          <h3>📡 Cobertura 4G</h3>
          {cob === undefined ? <p className="prop-nota">Carregando…</p> : cob === null ? (
            <p className="sdr-impacto obrig">🔴 Sem registro de cobertura móvel — orelhão OBRIGATÓRIO.</p>
          ) : (
            <>
              <div className="sdr-ops">{cob.ops.map((o) => <span key={o.op} className={o.tem4G ? 'g4' : ''}>{o.op} · {o.techs.join('/')}</span>)}</div>
              <p className={`sdr-impacto ${cob.tem4G ? 'pode' : 'deve'}`}>{cob.tem4G ? '🟢 Município com 4G — orelhão PODE ser retirado até 2028.' : '🟡 Só 2G/3G — orelhão DEVE ser mantido.'}</p>
            </>
          )}
          <p className="prop-nota">Base SMP da Anatel (operadoras e tecnologias por município).</p>
        </section>
      </div>
      <section className="prop-bloco">
        <h3>☎️ Orelhões públicos (TUP){anatel?.fora ? <span className="sdr-fora">{anatel.fora} fora de operação</span> : null}</h3>
        <p className="acao-sub">{noMapa.length} no mapa do Orelhão Digital · {anatel ? `${anatel.tups.length} na base TUP Oi/Anatel (atualização ${anatel.ref})` : anatel === null ? 'sem registro na base TUP Oi/Anatel' : 'carregando a base da Anatel…'}</p>
        {anatel?.tups?.length > 0 && (
          <div className="acao-rolagem curta">
            <table className="acao-tabela">
              <thead><tr><th>Localidade</th><th>TUP</th><th>CN</th><th>Anatel</th><th>Situação</th><th>Última leitura</th></tr></thead>
              <tbody>{anatel.tups.map((t) => {
                const ruim = nk(t.status) !== 'ativo', manut = nk(t.anatel).includes('manuten');
                return <tr key={t.tup + t.loc}><td>{t.loc}</td><td>{t.tup}</td><td>{t.cn}</td><td>{manut ? <span className="acao-temp morno">{t.anatel}</span> : t.anatel}</td><td>{ruim ? <span className="acao-temp quente">{t.status}</span> : <span className="acao-sim">{t.status}</span>}</td><td>{t.leitura}</td></tr>;
              })}</tbody>
            </table>
          </div>
        )}
        <div className="prop-linha"><a className="prop-btn sec peq" href={URL_SGMU} target="_blank" rel="noreferrer">📊 Auditoria SGMU Anatel ↗</a></div>
      </section>
    </div>
  );
}
