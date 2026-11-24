// Painel Ação TUPs — leitura da planilha "Ação TUPs.xlsx" e indicadores gerenciais.
// Mesmas regras da plataforma CoLR (orelhao-digital.pages.dev/acao-tups: planilha-acao.js e
// acao-tups-painel.js). A leitura vira um "snapshot" (JSON) guardado no Supabase.

// ======================= leitura da planilha =======================
const REGIAO = {
  AC: 'Norte', AP: 'Norte', AM: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MS: 'Centro-Oeste', MT: 'Centro-Oeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste', PR: 'Sul', RS: 'Sul', SC: 'Sul',
};
export const ROTULO_SDR = { andamento: 'Andamento', incontatavel: 'Incontatável', agendada: 'Agendado', agendado: 'Agendado', perdido: 'Perdido', interessante: 'Interessante', retornar: 'Retornar' };
export const rotuloSdr = (st) => ROTULO_SDR[st] || st || 'Sem resultado';

export const nk = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const txt = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const num = (v) => { const n = parseInt(String(v || '').replace(/\D/g, ''), 10); return Number.isNaN(n) ? 0 : n; };
export const chaveMun = (uf, mun) => nk(uf) + '|' + nk(mun);
const cel = (row, i) => (i == null || i < 0 ? '' : row[i]);

function statusDe(s, consultor) {
  const t = nk(s);
  if (!t) return '';
  if (t.includes('incontat') || t.includes('incontact')) return 'incontatavel';
  if (t.includes('retornar')) return 'retornar';
  if (t.includes('agend')) return consultor ? 'agendado' : 'agendada';
  if (t.includes('andament') || t === 'retorno') return 'andamento';
  if (t.includes('perdid')) return 'perdido';
  if (t.includes('interess')) return 'interessante';
  if (t.includes('retorn')) return 'retornar';
  return t;
}
const munDeCliente = (c) => txt(String(c || '').replace(/^(prefeitura municipal d[eoa]|prefeitura d[eoa]|municipio d[eoa])\s+/i, ''));
function parseValor(v) {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const s = txt(v);
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  if (Number.isNaN(n)) return null;
  return /^\s*-/.test(s) ? -n : n;
}

function mapear(header, modo) {
  const map = { vazio: [] };
  (header || []).forEach((h, i) => {
    const k = nk(h);
    if (!k) { map.vazio.push(i); return; }
    if (k.includes('regiao') || k === 'regional') map.regiao = i;
    else if (k === 'uf' || k === 'estado') map.uf = i;
    else if (k.includes('municip')) map.municipio = i;
    else if (k.includes('pretendida')) map.qtdPretendida = i;
    else if (k.includes('status')) map.status = i;
    else if (k.includes('estagio')) map.estagio = i;
    else if (k.includes('temperatura') || k.includes('termometr')) map.temperatura = i;
    else if (k.includes('previsao') && k.includes('fechamento')) map.previsaoFechamento = i;
    else if (k.includes('valor') && k.includes('contratual')) map.valorContratual = i;
    else if (k.includes('chave') || k.includes('orelh') || (k.includes('qde') && !k.includes('pretend'))) map.qtd = i;
    else if (k.includes('mail')) map.email = i;
    else if (k.includes('contato com') || k.includes('observa')) map.obs = i;
    else if (k.includes('contato')) map.contato = i;
    else if (k === 'nome') map.nome = i;
    else if (k === 'numero' || k === 'num') map.numero = i;
    else if (k.includes('cliente') && !k.includes('carteira')) map.cliente = i;
    else if (k.includes('cnpj')) map.cnpj = i;
    else if (k.includes('campanha')) map.campanha = i;
    else if (k.includes('consultor')) map.consultor = i;
    else if (k.includes('ploomes') || k.includes('plomes')) map.ploomes = i;
    else if (k === 'sdr') map.sdr = i;
    else if (k.includes('carteira')) map.carteira = i;
    else if (k.includes('origem')) map.origem = i;
  });
  if (modo !== 'consultor' && map.status != null) map.codigo = map.vazio[0];
  return map;
}
const canaisDe = (obs) => { const t = nk(obs); return { ligacao: t.includes('liga'), whats: t.includes('whats') || t.includes('whatapp'), email: t.includes('e-mail') || t.includes('email') }; };
const contar = (lista, campo) => { const bag = {}; lista.forEach((r) => { let k = r[campo] || ''; if (!k && campo === 'status') k = 'sem_status'; if (k) bag[k] = (bag[k] || 0) + 1; }); return bag; };
const temTexto = (r) => !!(r && (r.status || r.obs || r.contato || r.nome || r.email));
function levarPontoUmParaAbaUm(lista) {
  lista.forEach((r) => { if (Number(r.pontos) === 1 && Number(r.aba) !== 1) r.aba = 1; });
  const ordem = [], porChave = {};
  lista.forEach((r) => {
    const k = Number(r.aba) + '|' + nk(r.uf) + '|' + nk(r.municipio);
    if (!porChave[k]) { porChave[k] = r; ordem.push(k); return; }
    if (temTexto(r) && !temTexto(porChave[k])) porChave[k] = r;
  });
  return ordem.map((k) => porChave[k]);
}
const preenchido = (v) => !!txt(v);
function linhaTemConteudo(row, m) {
  return [m.status, m.estagio, m.obs, m.sdr, m.consultor, m.cnpj, m.ploomes].some((i) => preenchido(cel(row, i))) || num(cel(row, m.qtd)) > 0 || num(cel(row, m.qtdPretendida)) > 0;
}
function registroBase(row, m, uf, mun) {
  return {
    uf, municipio: mun, cnpj: txt(cel(row, m.cnpj)), ploomes: txt(cel(row, m.ploomes)),
    orelhoes: num(cel(row, m.qtd)), qtdPretendida: num(cel(row, m.qtdPretendida)),
    carteira: nk(cel(row, m.carteira)) === 'sim', regional: txt(cel(row, m.regiao)),
    sdr: txt(cel(row, m.sdr)), consultor: txt(cel(row, m.consultor)), statusOrig: txt(cel(row, m.status)),
    estagio: txt(cel(row, m.estagio)), temperatura: txt(cel(row, m.temperatura)),
    previsaoFechamento: txt(cel(row, m.previsaoFechamento)), valorContratualTexto: txt(cel(row, m.valorContratual)),
    valorContratual: parseValor(cel(row, m.valorContratual)), contato: txt(cel(row, m.contato)),
    numero: txt(cel(row, m.numero)), obs: txt(cel(row, m.obs)),
  };
}
const mergeCampo = (a, b) => (preenchido(a) ? txt(a) : txt(b));
function mesclarBase(dst, src) {
  if (!src) return dst;
  ['cnpj', 'ploomes', 'regional', 'sdr', 'consultor', 'statusOrig', 'estagio', 'temperatura', 'contato', 'numero', 'obs', 'previsaoFechamento', 'valorContratualTexto']
    .forEach((c) => { dst[c] = mergeCampo(dst[c], src[c]); });
  if (src.valorContratual != null && !Number.isNaN(src.valorContratual)) dst.valorContratual = src.valorContratual;
  else if (dst.valorContratual == null && src.valorContratualTexto) dst.valorContratual = parseValor(src.valorContratualTexto);
  if (!dst.orelhoes && src.orelhoes) dst.orelhoes = src.orelhoes;
  if (!dst.qtdPretendida && src.qtdPretendida) dst.qtdPretendida = src.qtdPretendida;
  if (!dst.carteira && src.carteira) dst.carteira = src.carteira;
  return dst;
}
const chaveRegistroBase = (r) => { const cj = String(r.cnpj || '').replace(/\D/g, ''); return cj ? 'cnpj:' + cj : 'mun:' + chaveMun(r.uf, r.municipio); };

function montarSnapshot(baseRows, sdrFolhas, consRows, meta) {
  const bm = mapear(baseRows[0] || [], 'base');
  const cm = mapear(consRows[0] || [], 'consultor');
  let base = [];
  const origemBag = {};
  let lastUf = '', lastMun = '', lastIdx = -1;
  baseRows.slice(1).forEach((row) => {
    const ufCel = txt(cel(row, bm.uf)).toUpperCase(), munCel = txt(cel(row, bm.municipio));
    const nova = !!(ufCel && munCel);
    const uf = ufCel || lastUf, mun = munCel || lastMun;
    if (!uf || !mun) return;
    if (!nova && !linhaTemConteudo(row, bm)) return;
    const origem = txt(cel(row, bm.origem));
    if (origem) origemBag[origem] = (origemBag[origem] || 0) + 1;
    const reg = registroBase(row, bm, uf, mun);
    if (nova) { lastUf = uf; lastMun = mun; base.push(reg); lastIdx = base.length - 1; return; }
    if (lastIdx >= 0) mesclarBase(base[lastIdx], reg);
  });
  const bag = {};
  base.forEach((r) => { const k = chaveRegistroBase(r); bag[k] = bag[k] ? mesclarBase(bag[k], r) : r; });
  base = Object.values(bag);

  let atuacao = [];
  sdrFolhas.forEach((folha) => {
    const rows = promoverCabecalho(folha.rows || []);
    const sm = mapear(rows[0] || [], 'sdr');
    rows.slice(1).forEach((row) => {
      const uf = txt(cel(row, sm.uf)).toUpperCase(), mun = txt(cel(row, sm.municipio));
      if (!uf || !mun) return;
      const obs = txt(cel(row, sm.obs));
      atuacao.push({
        aba: Number(folha.aba) || 0, regiao: txt(cel(row, sm.regiao)) || REGIAO[uf] || '', uf, municipio: mun,
        pontos: num(cel(row, sm.qtd)), status: statusDe(cel(row, sm.status), false), codigo: txt(cel(row, sm.codigo)),
        email: txt(cel(row, sm.email)), contato: txt(cel(row, sm.contato)), nome: txt(cel(row, sm.nome)), obs, canais: canaisDe(obs),
      });
    });
  });
  atuacao = levarPontoUmParaAbaUm(atuacao);
  const baseIdx = {};
  base.forEach((r) => { baseIdx[chaveMun(r.uf, r.municipio)] = r; });
  atuacao.forEach((r) => {
    const b = baseIdx[chaveMun(r.uf, r.municipio)];
    if (!b) return;
    if (!r.regiao) r.regiao = b.regional || REGIAO[r.uf] || '';
    r.sdr = b.sdr || ''; r.consultorBase = b.consultor || '';
  });
  const consultores = [];
  consRows.slice(1).forEach((row) => {
    const cliente = txt(cel(row, cm.cliente)), uf = txt(cel(row, cm.uf)).toUpperCase();
    if (!cliente && !uf) return;
    consultores.push({
      cliente, municipio: munDeCliente(cliente), cnpj: txt(cel(row, cm.cnpj)), uf, status: statusDe(cel(row, cm.status), true),
      estagio: txt(cel(row, cm.estagio)), ploomes: txt(cel(row, cm.ploomes)), campanha: txt(cel(row, cm.campanha)),
      consultor: txt(cel(row, cm.consultor)), sdr: txt(cel(row, cm.sdr)), qtd: num(cel(row, cm.qtd)),
      qtdPretendida: num(cel(row, cm.qtdPretendida)), contato: txt(cel(row, cm.obs)), regiao: REGIAO[uf] || '',
    });
  });
  let origem = '', origemN = 0;
  Object.keys(origemBag).forEach((k) => { if (origemBag[k] > origemN) { origem = k; origemN = origemBag[k]; } });
  const st = contar(atuacao, 'status');
  return {
    snapshotCompleto: true, atualizadoPor: txt(meta.atualizadoPor), arquivo: txt(meta.arquivo), geradoEm: txt(meta.geradoEm), origem,
    base: { municipios: base.length, orelhoes: base.reduce((s, r) => s + r.orelhoes, 0), carteira: base.filter((r) => r.carteira).length },
    atuacaoResumo: { municipios: atuacao.length, andamento: st.andamento || 0, incontatavel: st.incontatavel || 0, agendada: st.agendada || 0, perdido: st.perdido || 0, interessante: st.interessante || 0 },
    municipios: base, atuacao, consultores,
  };
}

function numeroAba(nome) {
  const k = nk(nome);
  let m = k.match(/(\d+)\s*tup/); if (m) return Number(m[1]);
  m = k.match(/(?:sdr|atuac)[\s\-–—]*(\d+)\b/); if (m) return Number(m[1]);
  return 0;
}
function pareceCabecalhoSdr(row) { const m = mapear(row || [], 'sdr'); return m.uf != null && m.municipio != null && m.qtd != null && m.status != null; }
function promoverCabecalho(rows) {
  if (pareceCabecalhoSdr(rows[0])) return rows;
  if (rows.length > 1 && pareceCabecalhoSdr(rows[1])) return rows.slice(1);
  return rows;
}
function exigir(map, campos) { return campos.filter((c) => map[c[0]] == null).map((c) => c[1]); }
function conferirPadrao(baseRows, sdrFolhas, consRows) {
  let faltou = [];
  if (!baseRows.length) faltou.push('aba Municípios');
  const bm = baseRows.length ? mapear(baseRows[0], 'base') : {};
  const unificado = bm.status != null && bm.estagio != null;
  if (baseRows.length) {
    faltou = faltou.concat(exigir(bm, [['uf', 'Estado'], ['municipio', 'Município'], ['cnpj', 'CNPJ'], ['qtd', 'Total de orelhões']]));
    if (!unificado) {
      if (bm.carteira == null) faltou.push('Cliente de carteira');
      if (bm.origem == null) faltou.push('Origem da Oportunidade');
      if (!sdrFolhas.length) faltou.push('aba Atuação SDR');
      if (!consRows.length) faltou.push('aba Atuação Consultores');
    }
  }
  if (!unificado) {
    sdrFolhas.forEach((f) => {
      const rows = promoverCabecalho(f.rows || []);
      if (!rows.length) { faltou.push(f.nome || 'aba Atuação SDR'); return; }
      exigir(mapear(rows[0], 'sdr'), [['uf', 'UF'], ['municipio', 'Município'], ['qtd', 'CHAVE (pontos)'], ['status', 'Status'], ['email', 'E-mail'], ['contato', 'Contato'], ['nome', 'Nome'], ['obs', 'Observação']])
        .forEach((n) => faltou.push(`${f.nome}: ${n}`));
    });
    if (consRows.length) {
      faltou = faltou.concat(exigir(mapear(consRows[0], 'consultor'), [['cliente', 'CLIENTE'], ['ploomes', 'ID PLOOMES'], ['cnpj', 'CNPJ'], ['uf', 'UF'], ['status', 'STATUS'], ['campanha', 'CAMPANHA'], ['consultor', 'CONSULTOR'], ['sdr', 'SDR'], ['qtd', 'QDE DE TUPS'], ['estagio', 'ESTAGIO'], ['obs', 'CONTATO COM CLIENTE']]));
    }
  }
  if (faltou.length) { const e = new Error('Planilha fora do padrão: ' + faltou.join('; ')); e.faltou = faltou; throw e; }
}

// Lê o arquivo .xlsx (ou o snapshot .json exportado da plataforma antiga) e devolve o snapshot.
export async function lerArquivo(file, atualizadoPor) {
  if (/\.json$/i.test(file.name)) {
    const d = JSON.parse(await file.text());
    if (!snapshotUtil(d)) throw new Error('Este JSON não é um snapshot da Ação TUPs.');
    return { ...d, atualizadoPor: atualizadoPor || d.atualizadoPor };
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const enxugar = (ws) => {
    if (!ws?.['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 8000 && range.e.c < 40) return;
    let maxR = range.s.r, maxC = range.s.c, vistos = 0;
    for (const addr in ws) {
      if (addr[0] === '!') continue;
      if (++vistos > 250000) break;
      const c = ws[addr];
      if (!c || c.v == null || String(c.v).trim() === '') continue;
      const p = XLSX.utils.decode_cell(addr);
      if (p.r > 20000) continue;
      maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c);
    }
    range.e.r = maxR; range.e.c = Math.min(maxC, 40);
    ws['!ref'] = XLSX.utils.encode_range(range);
  };
  const linhas = (nome) => { if (!nome || !wb.Sheets[nome]) return []; enxugar(wb.Sheets[nome]); return XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: '', raw: false }); };
  const aba = (teste) => wb.SheetNames.find(teste) || '';
  const baseRows = linhas(aba((n) => nk(n).includes('municip')));
  const sdrNomes = wb.SheetNames.filter((n) => { const k = nk(n); return !k.includes('consult') && (k.includes('sdr') || k.includes('atuac')); })
    .sort((a, b) => (numeroAba(a) || 99) - (numeroAba(b) || 99) || (nk(a) < nk(b) ? -1 : 1));
  const sdrFolhas = sdrNomes.map((nome) => ({ nome, aba: numeroAba(nome), rows: linhas(nome) }));
  const consRows = linhas(aba((n) => nk(n).includes('consult')));
  conferirPadrao(baseRows, sdrFolhas, consRows);
  const agora = new Date(), p = (n) => String(n).padStart(2, '0');
  const dados = montarSnapshot(baseRows, sdrFolhas, consRows, {
    atualizadoPor, arquivo: file.name,
    geradoEm: `${p(agora.getDate())}/${p(agora.getMonth() + 1)}/${agora.getFullYear()} ${p(agora.getHours())}:${p(agora.getMinutes())}`,
  });
  if (!dados.municipios.length) { const e = new Error('Sem municípios na leitura. Abas: ' + wb.SheetNames.join(', ')); throw e; }
  return dados;
}
export const snapshotUtil = (d) => !!(d && d.base && d.municipios && d.municipios.length);

// ======================= indicadores (acao-tups-painel.js) =======================
export const CICLO_DIAS_UTEIS = 15;
export const CAMPANHAS_PADRAO = [1, 2, 3, 4, 90];
export const VAZIO = '—';
const ENCAMINHADA = 'Proposta encaminhada';
export const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 + '%' : '—');
export const fmtN = (n) => (n || 0).toLocaleString('pt-BR');
export const fmtMoeda = (n) => (n == null || Number.isNaN(n) ? VAZIO : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const cnpjDig = (s) => String(s || '').replace(/\D/g, '');

export const valorPreenchido = (r) => !!r && (!!String(r.valorContratualTexto || '').trim() || (typeof r.valorContratual === 'number' && !Number.isNaN(r.valorContratual)));
export function situacaoComercial(r) {
  if (!r) return '';
  if (valorPreenchido(r)) return ENCAMINHADA;
  return String(r.estagio || '').trim() || String(r.statusOrig || '').trim();
}
export function situacaoTitulo(r) {
  const sit = situacaoComercial(r);
  if (!valorPreenchido(r)) return sit;
  const partes = [sit], est = String(r.estagio || '').trim(), st = String(r.statusOrig || '').trim();
  if (est && nk(est) !== nk(sit)) partes.push('Estágio na planilha: ' + est);
  if (st && nk(st) !== nk(ENCAMINHADA) && nk(st) !== nk(sit)) partes.push('Status na planilha: ' + st);
  return partes.join(' · ');
}
export const valorExibido = (r) => (!valorPreenchido(r) ? '' : String(r.valorContratualTexto || '').trim() || fmtMoeda(r.valorContratual));
export const destaqueEncaminhada = (r) => valorPreenchido(r) || nk(r.statusOrig).includes('proposta encaminhada') || nk(situacaoComercial(r)).includes('proposta encaminhada');
export const destaqueAEnviar = (r) => nk(r.estagio).includes('enviar proposta');

function classificar(r) {
  const nst = nk(r.statusOrig), nest = nk(r.estagio);
  const contatoReg = !!(nst || nest);
  const recusou = nst.includes('perdido') || nest.includes('perdido');
  const proposta = nest.includes('enviar proposta') || nst.includes('enviar proposta') || nst.includes('proposta encaminhada') || valorPreenchido(r);
  let trabalhoAtivo = false;
  if (contatoReg && !recusou && (nst.includes('andament') || nst.includes('reagend') || ['realizar', 'retornar', 'agendament', 'reapresent'].some((x) => nest.includes(x)))) trabalhoAtivo = true;
  if (proposta) trabalhoAtivo = true;
  return { contatoReg, recusou, proposta, trabalhoAtivo, semClass: contatoReg && !recusou && !proposta && !trabalhoAtivo };
}
const pick = (a, b) => String(a || '').trim() || String(b || '').trim();
function mesclarMunicipio(a, b) {
  if (!b) return a; if (!a) return b;
  const o = { uf: a.uf || b.uf, municipio: a.municipio || b.municipio };
  ['cnpj', 'ploomes', 'regional', 'sdr', 'consultor', 'statusOrig', 'estagio', 'temperatura', 'obs', 'previsaoFechamento', 'valorContratualTexto'].forEach((c) => { o[c] = pick(a[c], b[c]); });
  o.valorContratual = a.valorContratual != null && !Number.isNaN(a.valorContratual) ? a.valorContratual : b.valorContratual != null && !Number.isNaN(b.valorContratual) ? b.valorContratual : null;
  o.orelhoes = Number(a.orelhoes) || Number(b.orelhoes) || 0;
  o.qtdPretendida = Number(a.qtdPretendida) || Number(b.qtdPretendida) || 0;
  o.carteira = !!(a.carteira || b.carteira);
  return o;
}

// Modelo: um registro por município (ou CNPJ), com a classificação e os rótulos usados no painel
export function montarModelo(dados) {
  const canon = {};
  const pessoa = (s) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); if (!t || /^n\/?a$/i.test(t)) return ''; const k = nk(t); if (!canon[k]) canon[k] = t; return canon[k]; };
  const extras = {};
  (dados.municipios || []).forEach((b) => {
    if (!b.uf || !b.municipio) return;
    const st = String(b.statusOrig || b.status || '').trim(), est = String(b.estagio || '').trim();
    if (!st && !est) return;
    const km = chaveMun(b.uf, b.municipio), cur = extras[km] || {};
    extras[km] = { statusOrig: pick(st, cur.statusOrig), estagio: pick(est, cur.estagio) };
  });
  const bag = {};
  (dados.municipios || []).forEach((b0) => {
    if (!b0.uf || !b0.municipio) return;
    const ext = extras[chaveMun(b0.uf, b0.municipio)];
    const b = ext ? mesclarMunicipio(b0, { uf: b0.uf, municipio: b0.municipio, ...ext }) : b0;
    const cj = cnpjDig(b.cnpj), k = cj ? 'cnpj:' + cj : 'mun:' + chaveMun(b.uf, b.municipio);
    bag[k] = bag[k] ? mesclarMunicipio(bag[k], b) : b;
  });
  const mapaStatus = {}, mapaEstagio = {};
  const modelo = Object.values(bag).map((b) => {
    const st = String(b.statusOrig || '').trim(), est = String(b.estagio || '').trim();
    if (st) mapaStatus[st] = (mapaStatus[st] || 0) + 1;
    if (est) mapaEstagio[est] = (mapaEstagio[est] || 0) + 1;
    return {
      uf: b.uf, municipio: b.municipio, cnpj: b.cnpj || '', ploomes: b.ploomes || '', regional: String(b.regional || '').trim(),
      sdr: pessoa(b.sdr), consultor: pessoa(b.consultor), statusOrig: st, estagio: est,
      statusLabel: st || VAZIO, estagioLabel: est || VAZIO, situacaoLabel: situacaoComercial(b) || VAZIO,
      temperatura: String(b.temperatura || '').trim(), orelhoes: Number(b.orelhoes) || 0, qtdPretendida: Number(b.qtdPretendida) || 0,
      carteira: !!b.carteira, obs: String(b.obs || '').trim(), previsaoFechamento: String(b.previsaoFechamento || '').trim(),
      valorContratualTexto: String(b.valorContratualTexto || '').trim(), valorContratual: b.valorContratual, classe: classificar(b),
    };
  });
  return { modelo, mapaStatus, mapaEstagio };
}

// Índices das abas Atuação SDR e Atuação Consultores (por município)
export function indices(dados) {
  const sdr = {}, cons = {};
  const score = (r) => (r.status && r.status !== 'sem_status' ? 4 : 0) + (String(r.obs || '').trim() ? 2 : 0) + (Number(r.aba) || 0);
  (dados?.atuacao || []).forEach((r) => { if (!r.uf || !r.municipio) return; const k = chaveMun(r.uf, r.municipio); if (!sdr[k] || score(r) > score(sdr[k])) sdr[k] = r; });
  (dados?.consultores || []).forEach((r) => { if (r.uf && r.municipio) cons[chaveMun(r.uf, r.municipio)] = r; });
  const porAba = {};
  (dados?.atuacao || []).forEach((a) => { const aba = Number(a.aba) || 0; if (aba) (porAba[aba] ??= {})[chaveMun(a.uf, a.municipio)] = true; });
  return { sdr, cons, porAba };
}

export const sdrAbordado = (h) => !!(h && h.status && h.status !== 'sem_status');
function contatoMunicipio(r, s, c) {
  if (r.classe.contatoReg) return true;
  if (s && ((s.status && s.status !== 'sem_status') || String(s.obs || '').trim())) return true;
  if (c && ((c.status && c.status !== 'sem_status') || String(c.estagio || '').trim() || String(c.contato || '').trim())) return true;
  return false;
}
function reuniaoMunicipio(r, s, c) {
  const nst = nk(r.statusOrig), nest = nk(r.estagio), ec = nk(c && c.estagio);
  return nst.includes('reagend') || nest.includes('agendament') || nest.includes('reuni') || (s && (s.status === 'agendada' || s.status === 'agendado')) ||
    (c && (c.status === 'agendada' || c.status === 'agendado')) || ec.includes('agendament') || ec.includes('reuni');
}
export const propostaEncaminhada = (r) => !!r && (valorPreenchido(r) || nk(r.statusOrig).includes('proposta encaminhada'));
function propostaAEnviar(r, c) {
  if (propostaEncaminhada(r)) return false;
  if (nk(r.estagio).includes('enviar proposta') || nk(r.statusOrig).includes('enviar proposta')) return true;
  return nk(c && c.estagio).includes('enviar proposta') || nk(c && c.status).includes('enviar proposta');
}
const propostaMunicipio = (r, c) => propostaEncaminhada(r) || propostaAEnviar(r, c);
// valor contratual em número (aceita o texto da planilha, ex.: "R$ 1.949.400,00")
export function valorNumerico(r) {
  if (!r) return 0;
  if (typeof r.valorContratual === 'number' && !Number.isNaN(r.valorContratual)) return r.valorContratual;
  const t = String(r.valorContratualTexto || '').trim();
  if (!t) return 0;
  const n = parseFloat(t.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  if (Number.isNaN(n)) return 0;
  return /^\s*-/.test(t) ? -n : n;
}
export const somaValor = (l) => l.reduce((s, r) => s + valorNumerico(r), 0);
function contatoValido(r, s) {
  if (!sdrAbordado(s)) return !!r.classe.contatoReg;
  if (s.status !== 'incontatavel' && s.status !== 'perdido') return true;
  return !!r.classe.contatoReg;
}
export function estagioAtivo(r) {
  const e = nk(r.estagio);
  if (!e || e.includes('perdido')) return false;
  if (['enviar proposta', 'realizar', 'reapresent', 'retornar', 'agendament'].some((x) => e.includes(x))) return true;
  return (Number(r.qtdPretendida) || 0) > 0;
}

// Métricas principais (resumo executivo, funil, painel do gestor)
export function calcMetricas(idx, lista) {
  const m = { baseMun: lista.length, baseTups: 0, priMun: 0, priTups: 0, abordados: 0, contatoVal: 0, oportList: [], propEncList: [], propAEnviarList: [], propList: [] };
  lista.forEach((r) => {
    const o = Number(r.orelhoes) || 0;
    m.baseTups += o;
    if (o >= 3) { m.priMun += 1; m.priTups += o; }
    const k = chaveMun(r.uf, r.municipio), s = idx.sdr[k], c = idx.cons[k];
    if (sdrAbordado(s)) { m.abordados += 1; if (contatoValido(r, s)) m.contatoVal += 1; }
    if (estagioAtivo(r)) m.oportList.push(r);
    if (propostaEncaminhada(r)) m.propEncList.push(r);
    if (propostaAEnviar(r, c)) m.propAEnviarList.push(r);
    if (propostaMunicipio(r, c)) m.propList.push(r);
  });
  const soma = (l) => l.reduce((s, r) => s + (Number(r.qtdPretendida) || 0), 0);
  return {
    ...m, oportMun: m.oportList.length, tupsNeg: soma(m.oportList), pipelineSemQtd: m.oportList.filter((r) => !(Number(r.qtdPretendida) || 0)).length,
    propMun: m.propList.length, propTups: soma(m.propList), propEncMun: m.propEncList.length, propEncTups: soma(m.propEncList),
    propEncValor: somaValor(m.propEncList), propAEnviarMun: m.propAEnviarList.length, propAEnviarTups: soma(m.propAEnviarList),
  };
}
export function calcExtras(idx, lista) {
  let reuniao = 0, incontatavel = 0, trabalhoAtivo = 0;
  lista.forEach((r) => {
    const k = chaveMun(r.uf, r.municipio), s = idx.sdr[k], c = idx.cons[k];
    if (reuniaoMunicipio(r, s, c)) reuniao += 1;
    if (s && s.status === 'incontatavel') incontatavel += 1;
    if (r.classe.trabalhoAtivo) trabalhoAtivo += 1;
  });
  return { reuniao, incontatavel, trabalhoAtivo };
}

// Distribuições (status, estágio, etapa SDR, pipeline, regional)
const ordenarBag = (bag) => Object.keys(bag).sort((a, b) => bag[b] - bag[a]).map((k) => ({ rotulo: k, n: bag[k] }));
export function distribuicao(lista, fn) { const bag = {}; lista.forEach((r) => { const k = fn(r); bag[k] = (bag[k] || 0) + 1; }); return ordenarBag(bag); }
export function distSdr(idx, lista) {
  const bag = {}; let total = 0;
  lista.forEach((r) => { const h = idx.sdr[chaveMun(r.uf, r.municipio)]; if (!sdrAbordado(h)) return; total += 1; const rot = rotuloSdr(h.status); bag[rot] = (bag[rot] || 0) + 1; });
  return { linhas: ordenarBag(bag), total };
}
export function distPipeline(lista) {
  const ativos = lista.filter(estagioAtivo);
  return { linhas: distribuicao(ativos, (r) => r.situacaoLabel || r.estagioLabel), total: ativos.length, tups: ativos.reduce((s, r) => s + (Number(r.qtdPretendida) || 0), 0) };
}
export function distRegional(lista) {
  const bag = {};
  lista.forEach((r) => { const reg = r.regional || 'Sem regional'; bag[reg] ??= { rotulo: reg, tups: 0, oport: 0 }; bag[reg].tups += Number(r.orelhoes) || 0; if (estagioAtivo(r)) bag[reg].oport += 1; });
  return Object.values(bag).sort((a, b) => b.tups - a.tups);
}

// Campanhas por porte (abas Atuação SDR 1/2/3/4/90 TUP)
const porteCampanha = (r) => { const o = Number(r.orelhoes) || 0; return o >= 90 ? 90 : o >= 1 && o <= 4 ? o : 0; };
export function campanhas(idx, lista) {
  const porPorte = {};
  lista.forEach((r) => {
    const k = chaveMun(r.uf, r.municipio);
    let q = 0;
    CAMPANHAS_PADRAO.forEach((aba) => { if (idx.porAba[aba]?.[k]) q = aba; });
    if (!q) q = porteCampanha(r);
    if (q) (porPorte[q] ??= []).push(r);
  });
  let nums = CAMPANHAS_PADRAO.filter((q) => porPorte[q]?.length);
  if (!nums.length) nums = Object.keys(porPorte).map(Number).sort((a, b) => a - b);
  return nums.map((q) => {
    const R = { num: q, lista: porPorte[q].length, contato: 0, reuniao: 0, proposta: 0, andamento: 0, agendada: 0, incontatavel: 0, perdido: 0, semClass: 0, trabalhoAtivo: 0 };
    porPorte[q].forEach((r) => {
      const k = chaveMun(r.uf, r.municipio), s = idx.sdr[k], c = idx.cons[k];
      if (contatoMunicipio(r, s, c)) R.contato += 1;
      if (reuniaoMunicipio(r, s, c)) R.reuniao += 1;
      if (propostaMunicipio(r, c)) R.proposta += 1;
      if (r.classe.recusou) R.perdido += 1;
      else if (r.classe.proposta) { /* já em proposta */ } else if (r.classe.trabalhoAtivo) R.trabalhoAtivo += 1;
      else if (r.classe.semClass) R.semClass += 1;
      const nst = nk(r.statusOrig), nest = nk(r.estagio);
      if (nst.includes('andament') || nst.includes('reagend')) R.andamento += 1;
      if (nest.includes('agendament') || nst.includes('agend')) R.agendada += 1;
      if (nst.includes('incontat')) R.incontatavel += 1;
    });
    return R;
  });
}

// Quadro de propostas solicitadas
const tupsPedidos = (r, c) => Math.max(r ? Number(r.qtdPretendida) || 0 : 0, c ? Number(c.qtdPretendida) || 0 : 0);
const tupsDireito = (r, c) => (r ? Number(r.orelhoes) || 0 : 0) || (c ? Number(c.qtd) || 0 : 0);
export function relatorioPropostas(idx, lista) {
  const itens = [];
  lista.forEach((r) => {
    const c = idx.cons[chaveMun(r.uf, r.municipio)];
    const pediu = propostaMunicipio(r, c) || (c && (nk(c.estagio).includes('enviar proposta') || nk(c.status).includes('enviar proposta')));
    if (!pediu) return;
    itens.push({
      uf: r.uf, municipio: r.municipio, sdr: r.sdr || '', consultor: r.consultor || c?.consultor || '', regional: r.regional || '',
      statusOrig: r.statusOrig || '', estagio: r.estagio || c?.estagio || '', situacaoLabel: situacaoComercial(r), temperatura: r.temperatura || '',
      tupsDireito: tupsDireito(r, c), tupsPedidos: tupsPedidos(r, c), carteira: !!r.carteira, previsaoFechamento: r.previsaoFechamento || '',
      valorContratual: r.valorContratual, valorContratualTexto: r.valorContratualTexto || '', cnpj: r.cnpj, ploomes: r.ploomes,
    });
  });
  itens.sort((a, b) => chaveMun(a.uf, a.municipio).localeCompare(chaveMun(b.uf, b.municipio), 'pt-BR'));
  const somaPedidos = itens.reduce((s, x) => s + x.tupsPedidos, 0), somaDireito = itens.reduce((s, x) => s + x.tupsDireito, 0);
  const encaminhadas = itens.filter(propostaEncaminhada).length;
  return {
    itens, totalMunicipios: itens.length, encaminhadas, aEnviar: itens.length - encaminhadas, somaTupsPedidos: somaPedidos, somaTupsDireito: somaDireito,
    mediaTupsPedidos: itens.length ? somaPedidos / itens.length : 0, mediaTupsDireito: itens.length ? somaDireito / itens.length : 0,
    carteira: itens.filter((x) => x.carteira).length,
  };
}

// Conferência: municípios com histórico (status/estágio) e observação; com consultor filtrado, a carteira inteira
export function listaConferencia(idx, filtradas, f, busca) {
  let base = f.consultor ? filtradas : filtradas.filter((r) => {
    let hist = !!(r.statusOrig || r.estagio);
    if (!hist) {
      const k = chaveMun(r.uf, r.municipio), s = idx.sdr[k], c = idx.cons[k];
      hist = (s && s.status && s.status !== 'sem_status') || (c && (String(c.estagio || '').trim() || (c.status && c.status !== 'sem_status')));
    }
    return hist && !!r.obs;
  });
  const q = String(busca || '').trim().toLowerCase();
  if (q) {
    base = base.filter((r) => {
      const alvo = `${r.municipio} ${r.uf} ${r.cnpj} ${r.ploomes} ${cnpjDig(r.cnpj)}`.toLowerCase();
      const alvoSem = nk(alvo);
      return alvo.includes(q) || alvoSem.includes(nk(q)) || (cnpjDig(q) && cnpjDig(r.cnpj).includes(cnpjDig(q)));
    });
  }
  return base;
}

// Filtros (consultor = carteira em todas as regionais)
export function aplicarFiltros(lista, f) {
  return lista.filter((r) => {
    if (f.regional && !f.consultor && r.regional !== f.regional) return false;
    if (f.uf && r.uf !== f.uf) return false;
    if (f.consultor && r.consultor !== f.consultor) return false;
    if (f.status && r.statusLabel !== f.status) return false;
    if (f.estagio && r.estagioLabel !== f.estagio) return false;
    return true;
  });
}
export const opcoes = (lista, campo) => [...new Set(lista.map((r) => String(r[campo] || '').trim()).filter((v) => v && v !== VAZIO))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

// Painel do gestor: ciclo de 15 dias úteis terminando na data da planilha
const parseDataBr = (s) => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
export const dataBr = (d) => (d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '');
const util = (d) => d.getDay() !== 0 && d.getDay() !== 6;
export function cicloGestor(geradoEm) {
  const fim = parseDataBr(geradoEm) || new Date(); fim.setHours(0, 0, 0, 0);
  const inicio = new Date(fim); let rest = CICLO_DIAS_UTEIS - 1;
  while (rest > 0) { inicio.setDate(inicio.getDate() - 1); if (util(inicio)) rest -= 1; }
  let decorridos = 0; const d = new Date(inicio);
  while (d <= fim) { if (util(d)) decorridos += 1; d.setDate(d.getDate() + 1); }
  return { inicio, fim, decorridos: Math.min(decorridos, CICLO_DIAS_UTEIS), total: CICLO_DIAS_UTEIS };
}
// Consultores: carteira (municípios com o nome) e contactados; "A definir" por último
export function consultoresPainel(idx, listaBase, listaRecorte, filtroConsultor) {
  const baseTotal = listaBase.length || 1, fonte = filtroConsultor ? listaRecorte : listaBase, bag = {};
  fonte.forEach((r) => {
    const nome = String(r.consultor || '').trim() || 'A definir';
    if (filtroConsultor && nome !== filtroConsultor) return;
    const k = nk(nome);
    bag[k] ??= { nome, mun: 0, contactados: 0, indefinido: !String(r.consultor || '').trim() };
    bag[k].mun += 1;
    const km = chaveMun(r.uf, r.municipio);
    if (contatoMunicipio(r, idx.sdr[km], idx.cons[km])) bag[k].contactados += 1;
  });
  const lista = Object.values(bag).sort((a, b) => (a.indefinido !== b.indefinido ? (a.indefinido ? 1 : -1) : b.mun - a.mun));
  let maxMun = 0;
  lista.forEach((c) => {
    c.pctBase = pct(c.mun, baseTotal); c.pendente = Math.max(0, c.mun - c.contactados);
    c.pctContactados = c.mun ? pct(c.contactados, c.mun) : '—'; c.pctContNum = c.mun ? (c.contactados / c.mun) * 100 : 0;
    if (c.mun > maxMun) maxMun = c.mun;
  });
  const mediaCont = lista.length ? lista.reduce((s, c) => s + c.pctContNum, 0) / lista.length : 0;
  return { baseTotal, consultores: lista, maxMun, mediaCont };
}
export const faixaContactado = (n) => (n >= 70 ? 'alto' : n >= 40 ? 'medio' : 'baixo');
// % de municípios abordados pelo SDR em cada regional
export function coberturaRegional(idx, lista) {
  const bag = {};
  lista.forEach((r) => {
    const reg = r.regional || 'Sem regional';
    bag[reg] ??= { mun: 0, abord: 0 };
    bag[reg].mun += 1;
    if (sdrAbordado(idx.sdr[chaveMun(r.uf, r.municipio)])) bag[reg].abord += 1;
  });
  return bag;
}
// Totais do rodapé da conferência
export function totaisConferencia(idx, lista, carteira) {
  const mun = new Set(); let acaoSdr = 0, direito = 0, pedidos = 0;
  lista.forEach((r) => {
    const k = chaveMun(r.uf, r.municipio), c = idx.cons[k];
    mun.add(k);
    if (sdrAbordado(idx.sdr[k])) acaoSdr += 1;
    if (carteira) { direito += tupsDireito(r, c); pedidos += tupsPedidos(r, c); } else { direito += Number(r.orelhoes) || 0; pedidos += Number(r.qtdPretendida) || 0; }
  });
  return { municipios: mun.size, acaoSdr, valor: somaValor(lista), direito, pedidos };
}
export { tupsDireito, tupsPedidos };
export function narrativaGestor(ciclo, m, ex) {
  const ritmo = ciclo.decorridos ? Math.round((m.abordados / ciclo.decorridos) * 10) / 10 : 0;
  return `Complemento ao bloco Evolução da ação (acima): aqui não repetimos base, abordagem, contato, oportunidade nem propostas por município. Ciclo de ${ciclo.total} dias úteis — dia ${ciclo.decorridos} de ${ciclo.total} (${dataBr(ciclo.inicio)} a ${dataBr(ciclo.fim)}). Ritmo: ${fmtN(ritmo)} municípios abordados por dia útil. ${fmtN(ex.reuniao)} reuniões ou agendamentos (${pct(ex.reuniao, m.contatoVal)} dos contatos válidos). ${fmtN(ex.trabalhoAtivo)} municípios em trabalho ativo; ${fmtN(ex.incontatavel)} incontatáveis entre os abordados (${pct(ex.incontatavel, m.abordados)}).`;
}

// Cores das barras (mesmas da plataforma)
const PALETA = ['#38bdf8', '#22c55e', '#f59e0b', '#f87171', '#a78bfa', '#c4b5fd', '#2dd4bf', '#fb923c', '#64748b'];
export function corBarra(rotulo, i) {
  const t = nk(rotulo);
  if (t.includes('proposta encaminhada') || t.includes('proposta apresentada')) return '#2d8a8a';
  if (t.includes('enviar proposta')) return '#c4b5fd';
  if (t.includes('perdid')) return '#f87171';
  if (t.includes('incontat')) return '#fb923c';
  if (t.includes('agend')) return '#22c55e';
  if (t.includes('andament')) return '#f59e0b';
  if (t.includes('interess')) return '#2dd4bf';
  if (t.includes('retornar') || t.includes('realizar')) return '#38bdf8';
  if (t.includes('reapresent')) return '#a78bfa';
  return PALETA[i % PALETA.length];
}

// Ajuda dos indicadores do painel do gestor
export const AJUDA = {
  reunioes: { titulo: 'Reuniões / agendamentos', corpo: [
    { h: 'O número:', p: 'Municípios com agenda ou reunião: Status/Estágio (reagendar, agendamento, reunião) ou status agendado no SDR ou Consultores.' },
    { h: 'Percentuais na caixinha', ul: ['% dos contatos válidos = reuniões ÷ contatos válidos.', '% dos abordados SDR = reuniões ÷ municípios abordados pelo SDR.'] },
  ] },
  ativo: { titulo: 'Trabalho ativo', corpo: [
    { h: 'O número:', p: 'Municípios em acompanhamento comercial ativo (andamento, follow-up, proposta solicitada etc.) pela classificação de Status/Estágio, sem recusa explícita.' },
    { h: 'Percentuais na caixinha', ul: ['% da base = trabalho ativo ÷ municípios mapeados.', '% incontatáveis (sobre abordados) = status SDR incontatável ÷ abordados — mede dificuldade de contato, não sucesso comercial.'] },
  ] },
  ritmo: { titulo: 'Ritmo (dia útil)', corpo: [
    { h: 'O número:', p: `Municípios abordados pelo SDR ÷ dias úteis decorridos no ciclo de ${CICLO_DIAS_UTEIS} dias, contados a partir da data/hora em que a planilha foi carregada.` },
    { h: 'Linhas abaixo do número', ul: ['municípios abordados / dia útil', 'Total de contatos válidos no período e quantos dias úteis entraram no cálculo.'] },
  ] },
};

// ======================= exportações =======================
const csv = (s) => { const t = String(s ?? ''); return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
export function csvPropostas(rp) {
  const out = [['UF', 'Município', 'SDR', 'Consultor', 'Regional', 'Situação comercial', 'Temperatura', 'Valor contratual', 'Previsão fechamento', 'TUPs direito (base)', 'TUPs pedidos', 'Cliente carteira'].join(';')];
  out.push(['—', '— RESUMO —', '', '', '', '', '', '', '', rp.somaTupsDireito, rp.somaTupsPedidos, rp.carteira + ' com carteira'].map(csv).join(';'));
  rp.itens.forEach((x) => out.push([x.uf, x.municipio, x.sdr, x.consultor, x.regional, x.situacaoLabel, x.temperatura, valorExibido(x), x.previsaoFechamento, x.tupsDireito, x.tupsPedidos, x.carteira ? 'sim' : 'nao'].map(csv).join(';')));
  return '﻿' + out.join('\r\n');
}
export function baixarTexto(texto, nome, tipo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: tipo }));
  a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ======================= Ferramenta SDR ao vivo =======================
// O que o SDR/consultor registra na Ferramenta SDR entra no painel sem esperar a próxima planilha:
// a situação da ligação vale como a linha mais nova da Atuação SDR; consultor, estágio e Ploomes
// substituem os da aba Municípios.
const SDR_PARA_PLANILHA = { retorno: 'andamento', sem_contato: 'incontatavel', agenda: 'agendada', sem_interesse: 'perdido', interessante: 'interessante', retornar: 'retornar' };
export function mesclarSdr(leitura, registros) {
  if (!leitura || !registros?.length) return leitura;
  const porChave = new Map(registros.map((r) => [chaveMun(r.uf, r.municipio), r]));
  const municipios = leitura.municipios.map((b) => {
    const r = porChave.get(chaveMun(b.uf, b.municipio));
    const d = r?.dados;
    if (!d) return b;
    return { ...b, consultor: d.consultorNome || b.consultor, estagio: d.estagio || b.estagio, ploomes: d.ploomesId || b.ploomes, sdrAoVivo: true };
  });
  const extra = registros.filter((r) => r.status).map((r) => ({
    aba: 999, uf: String(r.uf).toUpperCase(), municipio: r.municipio, status: SDR_PARA_PLANILHA[r.status] || r.status,
    obs: r.dados?.notas || '', email: r.dados?.email || '', contato: r.dados?.telefone || '', nome: r.dados?.nomeContato || '', aoVivo: true,
  }));
  return { ...leitura, municipios, atuacao: [...(leitura.atuacao || []), ...extra] };
}
