// Gerador de proposta comercial (Word) — mesmas regras da plataforma CoLR
// (orelhao-digital.pages.dev/colr-gerador): tabela comercial, valores por extenso, nome do arquivo
// com versão, ajustes de layout no .docx e troca do brasão no modelo.
// Modelo: public/propostas/modelo-proposta.docx · base de municípios: public/propostas/municipios.json

import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

// ---------------- tabela comercial (lib/constants.mjs + lib/simulador.mjs) ----------------
const EQUIPAMENTO_TABELA = [0, 3333, 4180];
const EQUIPAMENTO_PACOTE_3 = 5400;
const MEDIA_POR_PONTO_4_MAIS = 1800;

// valor mensal pela tabela: 1 TUP 3.333 · 2 TUPs 4.180 · 3 TUPs 5.400 · 4+ TUPs 1.800 por ponto
export function mensalidadeTabela(pontos) {
  const p = Math.max(1, Math.min(100, Math.floor(Number(pontos) || 1)));
  if (p <= 3) return [0, EQUIPAMENTO_TABELA[1], EQUIPAMENTO_TABELA[2], EQUIPAMENTO_PACOTE_3][p];
  return Math.round(p * MEDIA_POR_PONTO_4_MAIS * 100) / 100;
}

// ---------------- números por extenso ----------------
const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

export function numeroPorExtenso(n) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x) || x < 0) return '';
  if (x === 0) return 'zero';
  if (x === 100) return 'cem';
  if (x < 20) return UNIDADES[x];
  if (x < 100) { const d = Math.floor(x / 10), u = x % 10; return u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]; }
  if (x < 1e3) {
    const c = Math.floor(x / 100), r = x % 100;
    const head = c === 1 && r === 0 ? 'cem' : CENTENAS[c];
    return r ? `${head} e ${numeroPorExtenso(r)}` : head;
  }
  if (x < 1e6) {
    const mil = Math.floor(x / 1e3), r = x % 1e3;
    const head = mil === 1 ? 'mil' : `${numeroPorExtenso(mil)} mil`;
    return r ? `${head} e ${numeroPorExtenso(r)}` : head;
  }
  return String(x);
}
function extensoMilhar(n) {
  if (n >= 1e3 && n < 2e3) { const r = n % 1e3; return r ? `um mil e ${numeroPorExtenso(r)}` : 'um mil'; }
  return numeroPorExtenso(n);
}
export function moedaPorExtenso(valor) {
  const n = Math.round(Number(valor) * 100) / 100;
  if (!Number.isFinite(n) || n < 0) return '';
  const reais = Math.floor(n), centavos = Math.round((n - reais) * 100);
  const partes = [];
  if (reais > 0) partes.push(`${extensoMilhar(reais)} ${reais === 1 ? 'real' : 'reais'}`);
  if (centavos > 0) partes.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  return partes.length ? partes.join(' e ') : 'zero reais';
}
export function moeda(v, { noBreak = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const s = n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return noBreak ? s.replace(/\s/g, '\u00A0') : s;
}

export function parseQtd(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Math.floor(Number(s.replace(',', '.')));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
// "9.000,00" / "R$ 9000" → 9000
export function parseMoeda(v) {
  let s = String(v ?? '').replace(/\s/g, '').replace(/R\$/gi, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}
const comPalavra = (n, sing, plur) => `${n} (${numeroPorExtenso(n)}) ${n === 1 ? sing : plur}`;

export const DESCRICAO_PADRAO = 'Pontos de acesso público de telefonia, incluindo os Serviços de Emergência (190, 192, 193, entre outros tri-dígitos de necessidade do município); ligações ilimitadas para Fixo e Móvel Brasil, concomitantemente com Wi-Fi de 50 GB/mês integrado para até 100 usuários simultâneos e raio de até 200m. Filtro de Conteúdo WEB (LGPD); Bloqueio de Trafego não Autorizado; Segurança de Rede; Autenticação de Usuários; Página de boas-vindas personalizada e Relatórios de Acesso.';
export const TRATAMENTOS = ['EXMO. SR.', 'EXMA. SRA.', 'ILMO. SR.', 'ILMA. SRA.', 'SR.', 'SRA.', 'DR.', 'DRA.', 'SR(A).'];

// Campos do modelo Word ({numero_proposta}, {total_mensal}…) a partir do formulário
export function montarPayload(raw = {}) {
  const nome_municipio = String(raw.nome_municipio ?? '').trim();
  const uf = String(raw.uf ?? '').trim().toUpperCase().slice(0, 2);
  const qtd_adaptados = parseQtd(raw.qtd_adaptados) ?? 0;
  const qtd_novos = parseQtd(raw.qtd_novos) ?? 0;
  const qtd_pontos = qtd_adaptados + qtd_novos;
  let totalMensal = parseMoeda(raw.total_mensal_override);
  const manual = Number.isFinite(totalMensal) && totalMensal > 0;
  if (!manual) totalMensal = qtd_pontos > 0 ? mensalidadeTabela(qtd_pontos) : 0;
  const unitario = qtd_pontos > 0 ? Math.round((totalMensal / qtd_pontos) * 100) / 100 : 0;
  const data = String(raw.data_proposta || new Date().toLocaleDateString('pt-BR')).trim();
  const trat = String(raw.destinatario_tratamento ?? 'SR.').trim();
  const nomeDest = String(raw.destinatario_nome ?? '').trim();
  let descricao = String(raw.descricao_item_investimento ?? DESCRICAO_PADRAO).trim();
  if (qtd_pontos === 1) descricao = descricao.replace(/^Pontos de acesso/i, 'Ponto de acesso');
  return {
    nome_municipio, nome_municipio_maiusculo: nome_municipio.toUpperCase(), uf, item_tabela: '1',
    destinatario_tratamento: trat.toUpperCase(),
    destinatario_nome: nomeDest.toUpperCase(),
    destinatario_cargo: String(raw.destinatario_cargo ?? 'PREFEITO').trim().toUpperCase(),
    destinatario_completo: [trat, nomeDest].filter(Boolean).join(' ').toUpperCase().replace(/ /g, '\u00A0'),
    numero_proposta: String(raw.numero_proposta ?? '').trim(),
    data_proposta: data,
    qtd_adaptados: String(qtd_adaptados), qtd_novos: String(qtd_novos), qtd_pontos: String(qtd_pontos),
    qtd_adaptados_extenso: numeroPorExtenso(qtd_adaptados), qtd_novos_extenso: numeroPorExtenso(qtd_novos), qtd_pontos_extenso: numeroPorExtenso(qtd_pontos),
    linha_qtd_pontos: comPalavra(qtd_pontos, 'ponto', 'pontos'),
    linha_qtd_locais: comPalavra(qtd_pontos, 'local', 'locais'),
    linha_qtd_adaptados: comPalavra(qtd_adaptados, 'ponto', 'pontos'),
    linha_qtd_novos: comPalavra(qtd_novos, 'ponto', 'pontos'),
    linha_pontos_totais: qtd_pontos === 1 ? comPalavra(1, 'ponto total', 'pontos totais') : `${comPalavra(qtd_pontos, 'ponto', 'pontos')} totais`,
    linha_adaptados_telefone: qtd_adaptados === 1 ? '1 (um) ponto de telefone público já instalado' : `${comPalavra(qtd_adaptados, 'ponto', 'pontos')} de telefone público já instalados`,
    linha_novos_pontos: comPalavra(qtd_novos, 'ponto', 'pontos'),
    linha_vistoria_pontos: comPalavra(qtd_pontos, 'ponto', 'pontos'),
    linha_implantacao_pontos: comPalavra(qtd_pontos, 'ponto', 'pontos'),
    linha_implantacao_adaptados: comPalavra(qtd_adaptados, 'ponto adaptado', 'pontos adaptados'),
    linha_implantacao_novos: comPalavra(qtd_novos, 'novo ponto', 'novos pontos'),
    municipio_uf_linha: `${nome_municipio}-${uf}`,
    total_mensal: moeda(totalMensal, { noBreak: true }),
    total_mensal_extenso: moedaPorExtenso(totalMensal),
    valor_unitario: moeda(unitario, { noBreak: true }),
    valor_unitario_extenso: moedaPorExtenso(unitario),
    descricao_item_investimento: descricao,
    // só para a tela (não vão para o Word)
    _total: totalMensal, _unitario: unitario, _manual: manual, _pontos: qtd_pontos,
  };
}

// ---------------- nome do arquivo e versão (v1, v2… neste navegador) ----------------
const SEM = /[\\/:*?"<>|]/g;
const limpaNome = (s) => String(s ?? '').trim().replace(SEM, '-').replace(/\s+/g, ' ');
export function nomeBase(p) {
  const data = String(p.data_proposta || new Date().toLocaleDateString('pt-BR')).replace(/\//g, '-');
  return `${limpaNome(p.numero_proposta || 'SEM-NUMERO')} - ${limpaNome(p.nome_municipio || 'Municipio')} - ${limpaNome(p.uf || '--')} - ${data}`;
}
const LS = 'colr-proposta-ver:';
export function proximaVersao(base) {
  try { return Number(localStorage.getItem(LS + base) ?? 0) + 1; } catch { return 1; }
}
export function registrarVersao(base, v) {
  try { localStorage.setItem(LS + base, String(Math.max(Number(localStorage.getItem(LS + base) ?? 0), v))); } catch {}
}
export const nomeArquivo = (p, v) => `${nomeBase(p)} - v${Math.max(1, v)}.docx`;

// ---------------- base de municípios (IBGE · base Método) ----------------
const sem = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
let baseCache = null;
export async function carregarMunicipios() {
  if (!baseCache) {
    baseCache = fetch('/propostas/municipios.json').then((r) => r.json()).then((d) => (d.municipios || d).map((m) => ({ ...m, chave: sem(m.nome) })));
  }
  return baseCache;
}
function lev(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return dp[b.length];
}
// Sugestões enquanto digita (o mesmo critério da plataforma: exato, começo, contém, parecido)
export function sugerirMunicipios(lista, texto, uf = '', max = 8) {
  const alvo = sem(texto);
  if (alvo.length < 2) return [];
  const u = String(uf).toUpperCase();
  const pontua = (m) => {
    let s = m.chave === alvo ? 0 : m.chave.startsWith(alvo) ? 1 : m.chave.includes(alvo) ? 2 : 3 + lev(m.chave, alvo);
    if (u && m.uf === u) s -= 8;
    return s;
  };
  return lista
    .filter((m) => m.chave.includes(alvo) || alvo.includes(m.chave) || (Math.abs(m.chave.length - alvo.length) <= 3 && lev(m.chave, alvo) <= 2))
    .map((m) => ({ m, s: pontua(m) }))
    .sort((a, b) => a.s - b.s || a.m.nome.localeCompare(b.m.nome, 'pt-BR'))
    .slice(0, max).map((x) => x.m);
}
// Confere nome + UF: { ok, nome, uf, ibge } ou { ok:false, msg, sugestoes }
export function validarMunicipio(lista, nome, uf) {
  const alvo = sem(nome), u = String(uf ?? '').trim().toUpperCase();
  if (!alvo) return { ok: false, msg: 'Informe o município.', sugestoes: [] };
  const iguais = lista.filter((m) => m.chave === alvo);
  const naUf = iguais.find((m) => m.uf === u);
  if (naUf) return { ok: true, ...naUf };
  if (!u && iguais.length === 1) return { ok: true, ...iguais[0], ufAuto: true };
  if (iguais.length > 1 && !u) return { ok: false, msg: `"${iguais[0].nome}" existe em mais de um estado. Escolha:`, sugestoes: iguais };
  if (iguais.length && u) return { ok: false, msg: `"${iguais[0].nome}" não fica em ${u}. Escolha o município correto:`, sugestoes: iguais };
  const sug = sugerirMunicipios(lista, nome, u, 12);
  return { ok: false, msg: u ? `Não encontramos "${nome}" em ${u}. Escolha um parecido:` : `Não encontramos "${nome}". Escolha o município correto:`, sugestoes: sug };
}

// ---------------- brasão ----------------
// 1º a mesma API da plataforma CoLR (Wikimedia + catálogo + site da prefeitura); 2º a imagem
// que o próprio Orelhão Digital já usa no detalhe (Wikipédia / prefeituras).
export async function buscarBrasao(nome, uf, ibge, extras = []) {
  try {
    const qs = new URLSearchParams({ nome, uf, ibge: ibge ?? '' });
    const r = await fetch(`https://orelhao-digital.pages.dev/api/brasao?${qs}`);
    if (r.ok && /json/i.test(r.headers.get('content-type') || '')) {
      const j = await r.json();
      if (j?.ok && j.bytesBase64) {
        return { bytes: Uint8Array.from(atob(j.bytesBase64), (c) => c.charCodeAt(0)), titulo: String(j.title || `Brasão ${nome}-${uf}`).replace(/^File:/, ''), fonte: j.url || '' };
      }
    }
  } catch {}
  for (const src of extras.filter(Boolean)) {
    try {
      const r = await fetch(src);
      if (!r.ok || !/^image\//i.test(r.headers.get('content-type') || '')) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > 800) return { bytes, titulo: `Brasão de ${nome} (Wikipédia)`, fonte: src };
    } catch {}
  }
  return null;
}
export function tipoImagem(u8) {
  if (u8?.[0] === 0xff && u8?.[1] === 0xd8) return 'image/jpeg';
  if (u8?.[0] === 0x89 && u8?.[1] === 0x50) return 'image/png';
  if (u8?.[0] === 0x52 && u8?.[1] === 0x49) return 'image/webp';
  return 'image/png';
}
// O modelo guarda o brasão como JPG: converte (fundo branco) e ajusta o tamanho (1200–2400 px no lado maior)
export async function prepararBrasao(u8) {
  let bmp;
  try { bmp = await createImageBitmap(new Blob([u8], { type: tipoImagem(u8) })); } catch { return u8; }
  const longo = Math.max(bmp.width, bmp.height);
  const escala = longo < 1200 ? Math.min(1200 / longo, 1.35) : longo > 2400 ? 2400 / longo : 1;
  const w = Math.max(1, Math.round(bmp.width * escala)), h = Math.max(1, Math.round(bmp.height * escala));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.98));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : u8;
}

// ---------------- Word: modelo, preenchimento e ajustes (docx-*.mjs da plataforma) ----------------
let modeloCache = null;
export function carregarModelo() {
  if (!modeloCache) {
    modeloCache = fetch('/propostas/modelo-proposta.docx', { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('Modelo Word não encontrado (HTTP ' + r.status + ').'); return r.arrayBuffer(); })
      .then((b) => new Uint8Array(b))
      .catch((e) => { modeloCache = null; throw e; });
  }
  return modeloCache;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textos = (p) => { const out = []; const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g; let m; while ((m = re.exec(p))) out.push(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')); return out; };
const textoPar = (p) => textos(p).join('');
const PARAGRAFOS = /<w:p[\s>][\s\S]*?<\/w:p>/g;
const foraDasTabelas = (xml, fn) => xml.split(/(<w:tbl[\s>][\s\S]*?<\/w:tbl>)/g).map((x) => (x.startsWith('<w:tbl') ? x : fn(x))).join('');
function abreEPr(p) { return { open: p.match(/^<w:p[^>]*>/)?.[0] ?? '<w:p>', pPr: p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '' }; }
function preto(p, txt) { const { open, pPr } = abreEPr(p); return `${open}${pPr}<w:r><w:rPr><w:color w:val="000000"/></w:rPr><w:t xml:space="preserve">${esc(txt)}</w:t></w:r></w:p>`; }
function trocaTextos(xml, pares) {
  const ord = [...pares].sort((a, b) => b[0].length - a[0].length);
  return xml.replace(PARAGRAFOS, (p) => {
    const ts = textos(p); if (!ts.length) return p;
    let j = ts.join(''), mudou = false;
    for (const [de, para] of ord) if (j.includes(de)) { j = j.split(de).join(para); mudou = true; }
    if (!mudou) return p;
    let i = 0; const novos = [j, ...ts.slice(1).map(() => '')];
    return p.replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (full) => full.match(/^<w:t[^>]*>/)[0] + esc(novos[i++] ?? '') + '</w:t>');
  });
}
function capaNumeroEData(xml, { numero_proposta = '', data_proposta = '' }) {
  const numero = String(numero_proposta).trim(), data = String(data_proposta).trim();
  if (!numero && !data) return xml;
  return xml.replace(PARAGRAFOS, (p) => {
    const t = textoPar(p).trim();
    const alvo = /Ploomes|^\{numero_proposta\}$/i.test(t) ? numero : /^Data de hoje|^\{data_proposta\}$/i.test(t) ? data : null;
    if (!alvo) return p;
    if (t === alvo && !/<w:color w:val="EE0000"/i.test(p)) return p;
    return preto(p, alvo);
  });
}
const COLUNAS_INVEST = [680, 6500, 1280, 3040];
function quebraAntes(p) {
  if (p.includes('w:pageBreakBefore')) return p;
  return p.includes('<w:pPr>') ? p.replace('<w:pPr>', '<w:pPr><w:pageBreakBefore/>') : p.replace(/<w:p([^>]*)>/, '<w:p$1><w:pPr><w:pageBreakBefore/></w:pPr>');
}
function ajustesLayout(xml, payload) {
  let x = capaNumeroEData(xml, payload);
  // quebra de página solta antes de "PREFEITURA MUNICIPAL DE"
  x = x.replace(/<w:p[^>]*>\s*<w:r>\s*<w:br w:type="page"\s*\/>\s*<\/w:r>\s*<\/w:p>\s*(?=<w:p[\s>][\s\S]*?PREFEITURA MUNICIPAL DE)/i, '');
  // parágrafos em branco entre "Condições Gerais" e "Investimento por ponto"
  x = foraDasTabelas(x, (part) => { let zona = false; return part.replace(PARAGRAFOS, (p) => { const t = textoPar(p).trim(); if (/Condições Gerais e Responsabilidades/i.test(t)) zona = true; if (/Investimento por ponto/i.test(t)) zona = false; return zona && (!t || t === 'x') ? '' : p; }); });
  // restos do quadro de investimento fora da tabela
  x = foraDasTabelas(x, (part) => {
    let bloco = false, aposTitulo = false;
    return part.replace(PARAGRAFOS, (p) => {
      if (p.includes('txbxContent')) return p;
      const t = textoPar(p).replace(/\s+/g, ' ').trim();
      if (/Condições Gerais/i.test(t)) bloco = true;
      if (/Investimento por ponto/i.test(t)) { bloco = false; aposTitulo = false; }
      if (!bloco) return p;
      if (/^Investimento$/i.test(t)) aposTitulo = true;
      if (!t) { const m = p.match(/w:spacing w:after(?: w:val)?="(\d+)"/); if ((m && Number(m[1]) > 200) || p.includes('w:br w:type="page"') || aposTitulo) return ''; }
      if (/^(Item|Descrição|Qtd\.?\s*Pontos|Total Mensal)$/i.test(t)) return '';
      if (/^\{item_tabela\}$|^\{descricao_item_investimento\}$|^\{qtd_pontos\}$|^\{total_mensal\}$/.test(t) || t === 'x') return '';
      if (/^Pontos? de acesso público de telefonia/i.test(t) && p.length < 2500) return '';
      return p;
    });
  });
  // "Investimento" começa em página nova
  x = x.replace(PARAGRAFOS, (p) => {
    const t = textoPar(p).replace(/\s+/g, ' ').trim();
    if (!/^(7\.\s*)?Investimento$/i.test(t)) return p;
    let o = quebraAntes(p).replace(/<w:keepNext\/>/g, '').replace(/<w:keepLines\/>/g, '');
    if (!/w:after/.test(o)) o = o.includes('<w:pPr>') ? o.replace('<w:pPr>', '<w:pPr><w:spacing w:after="34"/>') : o.replace(/<w:p([^>]*)>/, '<w:p$1><w:pPr><w:spacing w:after="34"/></w:pPr>');
    return o;
  });
  // largura das colunas da tabela de investimento
  const total = COLUNAS_INVEST.reduce((a, b) => a + b, 0);
  x = x.replace(/<w:tbl[\s>][\s\S]*?<\/w:tbl>/g, (tbl) => {
    if (!tbl.includes('Total Mensal') || !tbl.includes('Descrição')) return tbl;
    let t = tbl.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, `<w:tblGrid>${COLUNAS_INVEST.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`);
    t = /<w:tblW w:w="/.test(t) ? t.replace(/<w:tblW w:w="[^"]+"/, `<w:tblW w:w="${total}"`) : t.replace(/<w:tblPr>/, `<w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblLayout w:type="fixed"/>`);
    return t.replace(/<w:tr[\s>][\s\S]*?<\/w:tr>/g, (tr) => {
      let col = 0;
      return tr.replace(/<w:tc[\s>][\s\S]*?<\/w:tc>/g, (tc) => {
        const w = COLUNAS_INVEST[col]; if (w == null) return tc; col += 1;
        const noWrap = col === 4 ? '<w:noWrap/>' : '';
        if (tc.includes('<w:tcPr>')) { let n = tc.replace(/<w:tcW[^>]*\/>/, `<w:tcW w:w="${w}" w:type="dxa"/>`); if (col === 4 && !n.includes('w:noWrap')) n = n.replace('</w:tcPr>', `${noWrap}</w:tcPr>`); return n; }
        return tc.replace(/<w:tc([^>]*?)>/, `<w:tc$1><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${noWrap}</w:tcPr>`);
      });
    });
  });
  // espaço depois da tabela; "Dados da Proponente" sem quebra forçada; texto do corpo em preto
  x = x.replace(PARAGRAFOS, (p) => (!/Investimento por ponto/i.test(textoPar(p)) || /w:before/.test(p) ? p : p.includes('<w:pPr>') ? p.replace('<w:pPr>', '<w:pPr><w:spacing w:before="240"/>') : p.replace(/<w:p([^>]*)>/, '<w:p$1><w:pPr><w:spacing w:before="240"/></w:pPr>')));
  x = x.replace(PARAGRAFOS, (p) => (/^Dados da Proponente$/i.test(textoPar(p).replace(/\s+/g, ' ').trim()) ? p.replace(/<w:pageBreakBefore\/>/g, '') : p));
  let comecou = false;
  x = x.replace(PARAGRAFOS, (p) => {
    const t = textoPar(p);
    if (t.includes('PREFEITURA MUNICIPAL DE')) comecou = true;
    if (!comecou || /Contato Comercial/i.test(t)) return p;
    return p.replace(/<w:color w:val="(?:808080|7F7F7F|595959|A6A6A6|666666)"/gi, '<w:color w:val="000000"').replace(/<w:color w:val="auto"/gi, '<w:color w:val="000000"');
  });
  return trocaTextos(x, [['Qtd.Pontos', 'Qtd. Pontos'], ['ItemDescriçãoQtd.Pontos', 'Item']]);
}

// brasão = a imagem image1.* desenhada no documento/cabeçalho
const BASES_BRASAO = new Set(['image1.jpg', 'image1.jpeg', 'image1.png']);
function alvoBrasao(zip) {
  const partes = ['word/document.xml', ...Object.keys(zip.files).filter((n) => /^word\/header\d+\.xml$/i.test(n)).sort()];
  for (const parte of partes) {
    const xml = zip.file(parte)?.asText(); if (!xml) continue;
    const rels = zip.file(parte.replace(/^word\//, 'word/_rels/').replace(/\.xml$/i, '.xml.rels'))?.asText();
    if (!rels) continue;
    const re = /<w:drawing>[\s\S]*?<\/w:drawing>/g; let m;
    while ((m = re.exec(xml))) {
      const rid = m[0].match(/r:embed="(rId\d+)"/i)?.[1]; if (!rid) continue;
      const alvo = rels.match(new RegExp(`<Relationship[^>]+Id="${rid}"[^>]+Target="([^"]+)"`, 'i'))?.[1]; if (!alvo) continue;
      let t = alvo.replace(/\\/g, '/'); if (t.startsWith('../')) t = t.slice(3);
      const full = t.startsWith('word/') ? t : `word/${t}`;
      if (zip.file(full) && BASES_BRASAO.has(full.split('/').pop().toLowerCase())) return { media: full, parte, bloco: m[0] };
    }
  }
  for (const p of ['word/media/image1.jpg', 'word/media/image1.jpeg', 'word/media/image1.png']) if (zip.file(p)) return { media: p };
  return null;
}
const AVISO_SEM_BRASAO = 'Cole aqui o brasão. Se não tiver, delete este espaço.';

// Gera o .docx: preenche os campos, aplica os ajustes e troca o brasão (ou deixa o aviso em vermelho)
export function gerarDocx(modelo, payload, { brasao = null, avisoSemBrasao = false } = {}) {
  const doc = new Docxtemplater(new PizZip(modelo), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  const dados = Object.fromEntries(Object.entries(payload).filter(([k]) => !k.startsWith('_')));
  doc.render(dados);
  const zip = doc.getZip();
  zip.file('word/document.xml', ajustesLayout(zip.file('word/document.xml').asText(), payload));
  const alvo = alvoBrasao(zip);
  if (brasao?.length && alvo) zip.file(alvo.media, brasao);
  else if (avisoSemBrasao && alvo?.parte && alvo.bloco) {
    const xml = zip.file(alvo.parte).asText();
    zip.file(alvo.parte, xml.replace(alvo.bloco, `<w:r><w:rPr><w:color w:val="EE0000"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(AVISO_SEM_BRASAO)}</w:t></w:r>`));
  }
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
}

export function baixar(bytes, nome, tipo = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------- materiais de apoio ----------------
export const MATERIAIS = [
  { grupo: 'Apresentações', itens: [
    { nome: 'Apresentação Método — Municípios TUP (v3)', desc: 'PowerPoint para apoio comercial com prefeitos e equipes.', arquivo: 'Apresentação Método_Municipios TUP-16102026_v3.pptx', tipo: 'pptx',
      url: 'https://telecommetodo-my.sharepoint.com/:p:/g/personal/humberto_silveira_metodotelecom_com_br/IQA3C6UZVC35Sa3PZZVw_mvAARswlG8fl1Gv5vKt2b1vekw?e=UA2Ueu' },
  ] },
  { grupo: 'Vídeos', itens: [
    { nome: 'Do Orelhão ao Wi‑Fi público', arquivo: 'Do Orelhao ao Wi-fi Publico.mp4', tipo: 'video',
      url: 'https://telecommetodo-my.sharepoint.com/personal/humberto_silveira_metodotelecom_com_br/_layouts/15/stream.aspx?id=%2Fpersonal%2Fhumberto%5Fsilveira%5Fmetodotelecom%5Fcom%5Fbr%2FDocuments%2FAApresenta%C3%A7%C3%A3o%20MATERIAL%2FDo%20Orelhao%20ao%20Wi%2Dfi%20Publico%2Emp4&referrer=StreamWebApp%2EWeb&referrerScenario=AddressBarCopied%2Eview%2E816c3198%2Df65c%2D4a7e%2Dbdc5%2Dab729fd6fed8' },
    { nome: 'Conectividade em prefeituras (Método — 720p)', arquivo: 'Conectividade em Prefeituras_Logomarca Metodo_Baixa_720.mp4', tipo: 'video',
      url: 'https://telecommetodo-my.sharepoint.com/:v:/g/personal/humberto_silveira_metodotelecom_com_br/IQAQ6TauhH5TT7ajKkxgE2eNAQtv3w5Vwvuqc-7_fw09u7E?nav=eyJyZWZlcnJhbEluZm8iOnsicmVmZXJyYWxBcHAiOiJPbmVEcml2ZUZvckJ1c2luZXNzIiwicmVmZXJyYWxBcHBQbGF0Zm9ybSI6IldlYiIsInJlZmVycmFsTW9kZSI6InZpZXciLCJyZWZlcnJhbFZpZXciOiJNeUZpbGVzTGlua0NvcHkifX0&e=BLwgcv' },
    { nome: 'Dois Irmãos', arquivo: 'Dois Irmaos.mp4', tipo: 'video',
      url: 'https://telecommetodo-my.sharepoint.com/:v:/g/personal/humberto_silveira_metodotelecom_com_br/IQB52VXkp-a-SJSMn31ErRzdAVl_vq0UrhIFWdk1xfB-5_0?nav=eyJyZWZlcnJhbEluZm8iOnsicmVmZXJyYWxBcHAiOiJPbmVEcml2ZUZvckJ1c2luZXNzIiwicmVmZXJyYWxBcHBQbGF0Zm9ybSI6IldlYiIsInJlZmVycmFsTW9kZSI6InZpZXciLCJyZWZlcnJhbFZpZXciOiJNeUZpbGVzTGlua0NvcHkifX0&e=vEqRMO' },
  ] },
  { grupo: 'Documentos', itens: [
    { nome: 'Estudo técnico preliminar — Dispensa', arquivo: 'ESTUDO TECNICO PRELIMINAR (Dispensa).docx', tipo: 'docx', baixar: '/propostas/materiais/ESTUDO TECNICO PRELIMINAR (Dispensa).docx' },
    { nome: 'Estudo técnico preliminar — Inexigibilidade', arquivo: 'ESTUDO TECNICO PRELIMINAR (Inexigibilidade).docx', tipo: 'docx', baixar: '/propostas/materiais/ESTUDO TECNICO PRELIMINAR (Inexigibilidade).docx' },
    { nome: 'Termo de referência (modelo Método)', arquivo: 'TERMO DE REFERENCIA (Modelo Metodo).docx', tipo: 'docx', baixar: '/propostas/materiais/TERMO DE REFERENCIA (Modelo Metodo).docx' },
  ] },
];
