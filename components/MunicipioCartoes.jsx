'use client';

// Cartões do município (Gestão Municipal, Orelhões TUP, Cobertura 4G, Carteira e ação comercial).
// Usados na consulta da Ferramenta SDR e no cartão do orelhão (painel lateral do mapa).

import { useEffect, useState } from 'react';
import { acaoLer, acaoConsultores } from '@/lib/supabase';
import { nk, urlTse, URL_SGMU, urlPortal, anatelDoMunicipio, coberturaDoMunicipio, prefeiturasDaUf, municipiosBase } from '@/lib/sdr';
import { chaveMun } from '@/lib/acaoTups';

export const ROTULO_PLAN = { andamento: 'Andamento', incontatavel: 'Incontatável', agendada: 'Agendado', agendado: 'Agendado', perdido: 'Perdido', interessante: 'Interessante', retornar: 'Retornar' };
const CORES_OP = { Claro: '#ef4444', TIM: '#003399', Vivo: '#7c3aed', Oi: '#f59e0b', Algar: '#22c55e', Sercomtel: '#0ea5e9' };

// resumo da Ação TUPs para o município (cartão roxo da lousa e cartão da consulta)
export function resumoAcao(hit) {
  if (!hit || (!hit.base && !hit.sdr && !hit.cons)) return { naPlanilha: false };
  const b = hit.base || {};
  const valido = (n) => { const k = nk(n); return !!k && k !== 'a definir' && k !== '—' && k !== '-'; };
  let consultor = String(b.consultor || '').trim();
  if (!valido(consultor) && hit.cons) consultor = String(hit.cons.consultor || '').trim();
  const sem = !valido(consultor);
  let sdr = String(b.sdr || '').trim(), sdrStatus = '';
  if (hit.sdr) { if (!sdr) sdr = String(hit.sdr.sdr || '').trim(); if (hit.sdr.status) sdrStatus = ROTULO_PLAN[hit.sdr.status] || hit.sdr.status; }
  const temValor = !!String(b.valorContratualTexto || '').trim() || (typeof b.valorContratual === 'number' && !Number.isNaN(b.valorContratual));
  const est = String(b.estagio || '').trim(), st = String(b.statusOrig || '').trim();
  let situacao, proposta;
  if (temValor) { situacao = 'Proposta encaminhada'; proposta = 'Proposta encaminhada'; } else {
    situacao = est || st || '—';
    proposta = nk(est).includes('enviar proposta') ? 'Enviar proposta' : nk(est).includes('proposta') && est ? est : 'Sem proposta registrada';
  }
  return {
    naPlanilha: true, semConsultor: sem, consultor: sem ? '' : consultor, sdr, sdrStatus, regional: String(b.regional || '').trim(), situacao, proposta,
    estagio: est, statusOrig: st, temperatura: String(b.temperatura || '').trim(), tupsOferecidos: b.orelhoes ?? null, tupsPretendida: b.qtdPretendida ?? null,
    valor: String(b.valorContratualTexto || '').trim(), carteira: !!b.carteira, obs: String(b.obs || '').trim(),
  };
}

// índice da planilha da Ação TUPs por município ({ sdr, cons, base })
export function indicePlanilha(planilha) {
  const idx = {};
  if (!planilha) return idx;
  (planilha.atuacao || []).forEach((r) => { const k = chaveMun(r.uf, r.municipio); const cur = idx[k]?.sdr; if (!cur || (r.status && (!cur.status || r.aba > cur.aba))) (idx[k] ??= {}).sdr = r; });
  (planilha.consultores || []).forEach((r) => { (idx[chaveMun(r.uf, r.municipio)] ??= {}).cons = r; });
  (planilha.municipios || []).forEach((r) => { (idx[chaveMun(r.uf, r.municipio)] ??= {}).base = r; });
  return idx;
}

// resumo público por município, sem senha (migração 010): consultor, SDR, situação comercial,
// temperatura e TUPs. Mesmo formato do índice da planilha ({ base, cons, sdr }), só com esses campos.
export function indicePublico(lista) {
  const idx = {};
  (lista || []).forEach((r) => {
    const k = chaveMun(r.uf, r.municipio);
    if (r.fonte === 'base') (idx[k] ??= {}).base = r;
    else if (r.fonte === 'consultores') (idx[k] ??= {}).cons = r;
    else if (r.fonte === 'atuacao') { const cur = idx[k]?.sdr; if (!cur || (r.status && (!cur.status || r.aba > cur.aba))) (idx[k] ??= {}).sdr = r; }
  });
  return idx;
}

// planilha da Ação TUPs para o cartão do orelhão.
// Com o acesso da Ação TUPs aberto nesta aba: a carteira completa. Sem senha: só o consultor do município.
let cachePlan = null; // { senha, idx }
let cacheCons = null; // Promise<{ idx } | null>
export function usePlanilhaAcao(ativo) {
  const [estado, setEstado] = useState({ idx: null, liberado: false, consultores: undefined });
  useEffect(() => {
    if (!ativo) return undefined;
    let senha = '';
    try { senha = sessionStorage.getItem('acaoTupsSenha') || ''; } catch {}
    let vivo = true;
    const soConsultor = () => {
      cacheCons ??= acaoConsultores().then((l) => (l ? indicePublico(l) : null)).catch(() => { cacheCons = null; return null; });
      cacheCons.then((c) => vivo && setEstado({ idx: null, liberado: false, consultores: c }));
    };
    if (!senha) { soConsultor(); return () => { vivo = false; }; }
    if (cachePlan?.senha === senha) { setEstado({ idx: cachePlan.idx, liberado: true }); return undefined; }
    acaoLer(senha).then((r) => { const idx = indicePlanilha(r?.dados || null); cachePlan = { senha, idx }; if (vivo) setEstado({ idx, liberado: true }); }).catch(() => vivo && soConsultor());
    return () => { vivo = false; };
  }, [ativo]);
  return estado;
}

export default function MunicipioCartoes({ m, hit, onVerMunicipio, compacto = false, semPrefeito = false, semCarteira = '', publico }) {
  const [pref, setPref] = useState(undefined);
  const [anatel, setAnatel] = useState(undefined);
  const [cob, setCob] = useState(undefined);
  const [ibge, setIbge] = useState('');
  const [cnpj, setCnpj] = useState(null); // null | { carregando } | { razao, numero } | { erro }
  useEffect(() => {
    if (!m) { setPref(undefined); setAnatel(undefined); setCob(undefined); setIbge(''); setCnpj(null); return undefined; }
    let vivo = true;
    setPref(undefined); setAnatel(undefined); setCob(undefined); setCnpj(null);
    prefeiturasDaUf(m.uf).then((d) => { if (vivo) setPref(Object.entries(d || {}).find(([n]) => nk(n) === nk(m.mun))?.[1] || null); });
    anatelDoMunicipio(m.uf, m.mun).then((a) => vivo && setAnatel(a));
    municipiosBase().then((b) => {
      const x = (b?.municipios || []).find((r) => r.uf === m.uf && nk(r.nome) === nk(m.mun));
      if (!vivo) return;
      setIbge(x?.ibge || '');
      if (x?.ibge) coberturaDoMunicipio(x.ibge).then((c) => vivo && setCob(c)); else setCob(null);
    });
    return () => { vivo = false; };
  }, [m]);
  const buscarCnpj = async () => {
    if (!ibge) { setCnpj({ erro: 'Faça a consulta do município primeiro.' }); return; }
    setCnpj({ carregando: true });
    try {
      const q = encodeURIComponent(JSON.stringify({ cod_ibge: { $eq: Number(ibge) } }));
      const t = await fetch(`https://apidatalake.tesouro.gov.br/ords/siconfi/tt/entes?q=${q}&limit=5`).then((r) => (r.ok ? r.json() : null));
      const item = t?.items?.[0];
      const num = String(item?.cnpj || hit?.base?.cnpj || '').replace(/\D/g, '');
      if (num.length !== 14) throw new Error('vazio');
      let razao = '';
      try { const rec = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + num).then((r) => (r.ok ? r.json() : null)); razao = rec?.razao_social || ''; } catch {}
      setCnpj({ razao: razao || 'MUNICIPIO DE ' + String(item?.ente || m.mun).toUpperCase(), numero: num.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') });
    } catch { setCnpj({ erro: 'Não encontrei o CNPJ deste município.' }); }
  };
  const prefeito = pref?.oficial?.nome ? `${pref.oficial.nome}${pref.oficial.partido ? ` (${pref.oficial.partido})` : ''}` : pref === undefined ? '' : 'Gabinete do Executivo Municipal';
  const resumo = m ? resumoAcao(hit) : null;
  const linha = (rot, val, dest) => <div className={`s2-acao-linha ${dest ? 'destaque' : ''}`}><span className="rot">{rot}</span><span className="val">{val != null && String(val).trim() !== '' ? String(val) : '—'}</span></div>;
  return (
  <div className={`s2-grid ${compacto ? 'compacto' : ''}`}>
    <div className="s2-card">
      <div className="s2-card-head">
        <div className="s2-card-head-tit"><h2>🏛️ Gestão Municipal</h2>{m && onVerMunicipio && <button type="button" className="s2-btn-link teal" onClick={() => onVerMunicipio(m.uf, m.mun)}>🗺️ Ver no mapa da rota</button>}</div>
        <span className="s2-badge warning">{m ? m.uf : 'UF'}</span>
      </div>
      <div className="s2-gestao">
        <div className="s2-item"><span className="s2-label">Município</span>
          <div className="s2-mun-linha"><span className="s2-valor destaque">{m ? `${m.mun} (${m.uf})` : 'Aguardando pesquisa...'}</span></div>
        </div>
        {!semPrefeito && <div className="s2-item"><span className="s2-label">Prefeito(a)</span><div className="s2-valor">{!m ? '-' : pref === undefined ? <em>Consultando TSE...</em> : prefeito}</div></div>}
        <aside className="s2-caixa-cnpj">
          <span className="tit">CNPJ da prefeitura</span>
          {cnpj?.numero ? <><div className="razao">{cnpj.razao}</div><div className="numero">{cnpj.numero}</div></>
            : <div className="vazio">{cnpj?.carregando ? 'Consultando cadastro da Receita...' : cnpj?.erro || 'Clique em Busca CNPJ para trazer o nome completo e o CNPJ.'}</div>}
        </aside>
        <div className="s2-item"><span className="s2-label">Consultas</span>
          <div className="s2-btn-group">
            {m ? (
              <>
                <a className="s2-btn-link" href={pref?.site || urlPortal(m.mun, m.uf)} target="_blank" rel="noreferrer">Portal Oficial</a>
                <a className="s2-btn-link" href={`https://www.google.com/search?q=prefeito+telefone+gabinete+prefeitura+de+${encodeURIComponent(m.mun)}+${m.uf}`} target="_blank" rel="noreferrer">Gabinete</a>
                <a className="s2-btn-link verde" href={urlTse(m.uf)} target="_blank" rel="noreferrer">TSE</a>
                <button type="button" className="s2-btn-link amarelo" disabled={cnpj?.carregando} onClick={buscarCnpj}>Busca CNPJ</button>
              </>
            ) : <span className="s2-dica">Faça uma consulta para abrir os canais oficiais.</span>}
          </div>
        </div>
      </div>
    </div>

    <div className="s2-card tup">
      <div className="s2-card-head"><h2>☎️ Orelhões Públicos (TUP)</h2>
        {!m || anatel === undefined ? <span className="s2-badge warning">Aguardando</span> : !anatel ? <span className="s2-badge warning">Falta de informação</span>
          : anatel.fora ? <span className="s2-badge danger">{anatel.fora} fora de operação</span> : <span className="s2-badge success">Ativo na base de dados</span>}
      </div>
      <div className="s2-item"><span className="s2-label">Presença no Município</span>
        <span className="s2-valor">{!m || anatel === undefined ? '-' : anatel ? `Sim · ${anatel.tups.length} terminal(is) na base de dados TUP OI` : 'Não existe dados deste município na base de dados TUP OI'}</span></div>
      <div className="s2-item s2-qtd-data">
        <div><span className="s2-label">Quantidade de Terminais Identificados</span><span className="s2-valor destaque">{!m || anatel === undefined ? '-' : anatel ? anatel.tups.length : 'Falta de informação na base de dados'}</span></div>
        <div className="s2-atualizacao"><span className="s2-label">Atualização</span><span className="s2-data-grande">{!m || anatel === undefined ? '-' : anatel?.ref || 'Falta de informação na base de dados'}</span></div>
      </div>
      <div className="s2-item">
        <div className="s2-relacao-head"><span className="s2-label">Relação de Terminais</span><span className="s2-label">Situação Cadastrada</span></div>
        <div className="s2-subcard">
          {!m ? <div className="s2-dica">Digite o nome da cidade acima para carregar os orelhões.</div>
            : anatel === undefined ? <div className="s2-dica">Carregando…</div>
              : !anatel ? <div className="s2-dica">Não existe dados na base de dados TUP OI para {m.mun} ({m.uf}).</div>
                : anatel.tups.map((t) => {
                  const prob = nk(t.status) !== 'ativo' || nk(t.anatel) !== 'ativo';
                  const cls = !prob ? 'success' : nk(t.anatel) === 'em manutencao' ? 'warning' : 'danger';
                  return (
                    <div key={t.tup + t.loc} className="s2-terminal">
                      <div><span className="loc">{t.loc}</span><div className="det">TUP {t.tup} · CN {t.cn} · Anatel: {t.anatel} · Última leitura: {t.leitura}</div></div>
                      <span className={`s2-badge ${cls}`}>{t.status}</span>
                    </div>
                  );
                })}
        </div>
      </div>
      <div className="s2-item"><span className="s2-label">Auditoria Externa (Anatel)</span>
        {m ? <a className="s2-btn-link verde largo" href={URL_SGMU} target="_blank" rel="noreferrer">📊 Abrir Auditoria SGMU Anatel ({m.mun}-{m.uf})</a> : <div>-</div>}
      </div>
    </div>

    <div className="s2-card g4">
      <div className="s2-card-head"><div className="s2-tit-4g"><h2>📡 Cobertura 4G no Município</h2>
        {!m || cob === undefined ? <span className="s2-badge warning">Aguardando</span> : cob?.tem4G ? <span className="s2-badge success">✅ 4G Confirmado</span> : cob ? <span className="s2-badge warning">⚠️ Sem 4G</span> : <span className="s2-badge danger">❌ Sem 4G</span>}
      </div></div>
      <div className="s2-item"><span className="s2-label">Status da Cobertura 4G</span>
        <span className="s2-valor">{!m || cob === undefined ? 'Faça uma consulta para verificar o 4G'
          : cob?.tem4G ? `Cobertura 4G confirmada - IBGE: ${ibge} (${cob.ops.filter((o) => o.tem4G).length} operadora${cob.ops.filter((o) => o.tem4G).length > 1 ? 's' : ''})`
            : cob ? `Município IBGE ${ibge} possui cobertura móvel, mas SEM 4G` : `Município IBGE ${ibge || '—'} NÃO consta na base SMP da Anatel — sem cobertura móvel 4G`}</span></div>
      <div className="s2-item"><span className="s2-label">Operadoras com 4G no Município</span>
        <div className="s2-chip-container">
          {!m || cob === undefined ? <span className="s2-chip-op">Aguardando consulta...</span>
            : cob ? (cob.tem4G ? cob.ops.filter((o) => o.tem4G) : cob.ops).map((o) => (
              <span key={o.op} className="s2-chip-op" style={{ borderColor: CORES_OP[o.op] || '#38bdf8', color: CORES_OP[o.op] || '#38bdf8', opacity: cob.tem4G ? 1 : 0.5 }}>{cob.tem4G ? `📡 ${o.op} (4G)` : `📱 ${o.op} (sem 4G)`}</span>
            )) : <span className="s2-chip-op">Nenhuma operadora</span>}
        </div>
      </div>
      <div className="s2-item"><span className="s2-label">Impacto na Obrigatoriedade do Orelhão (até 2028)</span>
        <span className="s2-valor impacto">{!m || cob === undefined ? '-' : cob?.tem4G ? <span style={{ color: '#4ade80' }}>🟢 Orelhão PODE ser retirado até 2028 (município com cobertura 4G)</span>
          : cob ? <span style={{ color: '#fbbf24' }}>🟡 Orelhão DEVE ser mantido até 2028 (município sem cobertura 4G)</span> : <span style={{ color: '#f87171' }}>🔴 Orelhão OBRIGATÓRIO até 2028 (município sem cobertura 4G)</span>}</span></div>
    </div>

    <div className="s2-card acao">
      <div className="s2-card-head"><h2>Carteira e ação comercial</h2></div>
      <div className="s2-acao-corpo">
        {!m ? <p className="s2-acao-aviso">Faça uma consulta para ver consultor, estágio e proposta.</p>
              : publico !== undefined ? (() => {
                if (!publico) return <><p className="s2-acao-aviso">Este município não consta na planilha Ação TUPs (leitura publicada).</p><p className="s2-acao-fonte">Fonte: planilha Ação TUPs</p></>;
                const r = resumoAcao(publico);
                return (
                  <>
                    {r.semConsultor ? <p className="s2-acao-sem-cons">Município ainda sem consultor na planilha da ação.</p> : linha('Consultor', r.consultor, true)}
                    {linha('SDR', r.sdr + (r.sdrStatus ? ' · ' + r.sdrStatus : ''))}
                    {linha('Situação comercial', publico.base?.situacao || '—', true)}
                    {linha('Temperatura', r.temperatura)}
                    {linha('TUPs (base / pretenda)', `${r.tupsOferecidos ?? '—'} / ${r.tupsPretendida ?? '—'}`)}
                  </>
                );
              })()
              : semCarteira ? <p className="s2-acao-aviso">{semCarteira}</p>
          : !resumo.naPlanilha ? <><p className="s2-acao-aviso">Este município não consta na planilha Ação TUPs (leitura publicada).</p><p className="s2-acao-fonte">Fonte: planilha Ação TUPs</p></>
            : (
              <>
                {resumo.semConsultor ? <p className="s2-acao-sem-cons">Município ainda sem consultor na planilha da ação.</p> : linha('Consultor', resumo.consultor, true)}
                {linha('SDR', resumo.sdr + (resumo.sdrStatus ? ' · ' + resumo.sdrStatus : ''))}
                {linha('Regional', resumo.regional)}
                {linha('Situação comercial', resumo.situacao, true)}
                {linha('Proposta', resumo.proposta, true)}
                {(resumo.estagio || resumo.statusOrig) && linha('Estágio / status', [resumo.estagio, resumo.statusOrig].filter(Boolean).join(' · '))}
                {resumo.temperatura && linha('Temperatura', resumo.temperatura)}
                {linha('TUPs (base / pretenda)', `${resumo.tupsOferecidos ?? '—'} / ${resumo.tupsPretendida ?? '—'}`)}
                {resumo.valor && linha('Valor contratual', resumo.valor)}
                {linha('Carteira', resumo.carteira ? 'Sim' : 'Não')}
                {resumo.obs && <div className="s2-acao-linha obs"><span className="rot">Observação</span><span className="val" title={resumo.obs}>{resumo.obs.length > 140 ? resumo.obs.slice(0, 137) + '…' : resumo.obs}</span></div>}
              </>
            )}
      </div>
    </div>
  </div>
  );
}
