// Ferramenta SDR — regras da plataforma CoLR (campanha-contatos.html / consulta.html) usadas no Orelhão Digital.

export const nk = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
// mesma chave da plataforma antiga: "uf|municipio" (minúsculo, sem acento)
export const chaveSdr = (uf, mun) => String(uf || '').toLowerCase() + '|' + nk(mun);

// Situação da ligação (rádios): código → rótulo e cor
export const STATUS = [
  { id: 'retorno', rotulo: 'Andamento', cor: '#fbbf24' },
  { id: 'sem_contato', rotulo: 'Incontatável', cor: '#f87171' },
  { id: 'agenda', rotulo: 'Agendado', cor: '#4ade80' },
  { id: 'sem_interesse', rotulo: 'Perdido', cor: '#d8b4fe' },
  { id: 'interessante', rotulo: 'Interessante', cor: '#38bdf8' },
  { id: 'retornar', rotulo: 'Retornar', cor: '#7dd3fc' },
];
export const STATUS_POR_ID = Object.fromEntries(STATUS.map((s) => [s.id, s]));
export const COR_VALIDO = '#bef264';
export const rotuloStatus = (id) => STATUS_POR_ID[id]?.rotulo || '—';
// depois de qualquer contato, "Incontatável" não vale mais
export const TEVE_CONTATO = new Set(['agenda', 'retorno', 'sem_interesse', 'interessante', 'retornar']);

// planilha (Atuação SDR / Consultores) ↔ código dos rádios
const DA_PLANILHA = { andamento: 'retorno', incontatavel: 'sem_contato', agendada: 'agenda', agendado: 'agenda', perdido: 'sem_interesse', interessante: 'interessante', retornar: 'retornar' };
export const codigoDaPlanilha = (st) => DA_PLANILHA[st] || '';
const PARA_PLANILHA = { retorno: 'andamento', sem_contato: 'incontatavel', agenda: 'agendada', sem_interesse: 'perdido', interessante: 'interessante', retornar: 'retornar' };
export const statusParaPlanilha = (id) => PARA_PLANILHA[id] || '';

export const CARGOS = ['', 'Secretário de Administração', 'Coordenador de TI'];
export const CAMPANHA = 'Conversão TUPs por WiFi';
export const ESTAGIOS_CONS = ['ENVIAR PROPOSTA', 'RETORNAR CONTATO', 'A REALIZAR', 'REAPRESENTAÇÃO', 'PERDIDO', 'ENVIAR PROPOSTA // FOUDRES', 'EM AGENDAMENTO'];

// "Pega telefone": separa e-mails, telefones (10+ dígitos) e "prefeito: X" do texto da lousa
export function pegaContatos(texto) {
  const t = String(texto || '');
  const emails = [...new Set((t.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []).map((e) => e.toLowerCase()))];
  const telefones = [...new Set((t.match(/(?:\+?55\s*)?\(?\d{2}\)?[\s.-]*9?\d{4}[\s.-]?\d{4}/g) || [])
    .map((x) => x.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''))
    .filter((d) => d.length >= 10 && d.length <= 11)
    .map((d) => `(${d.slice(0, 2)}) ${d.length === 11 ? d.slice(2, 7) + '-' + d.slice(7) : d.slice(2, 6) + '-' + d.slice(6)}`))];
  const prefeito = (t.match(/prefeit[oa]\s*[:\-–]\s*([^\n,;/]+)/i)?.[1] || '').trim();
  return { emails, telefones, prefeito };
}

// Consulta: TSE (eleição municipal 2024) e Anatel
const REGIAO_TSE = { AC: 'NORTE', AP: 'NORTE', AM: 'NORTE', PA: 'NORTE', RO: 'NORTE', RR: 'NORTE', TO: 'NORTE', AL: 'NORDESTE', BA: 'NORDESTE', CE: 'NORDESTE', MA: 'NORDESTE', PB: 'NORDESTE', PE: 'NORDESTE', PI: 'NORDESTE', RN: 'NORDESTE', SE: 'NORDESTE', DF: 'CENTROOESTE', GO: 'CENTROOESTE', MT: 'CENTROOESTE', MS: 'CENTROOESTE', ES: 'SUDESTE', MG: 'SUDESTE', RJ: 'SUDESTE', SP: 'SUDESTE', PR: 'SUL', RS: 'SUL', SC: 'SUL' };
export const urlTse = (uf) => `https://divulgacandcontas.tse.jus.br/divulga/#/candidato/${REGIAO_TSE[uf] || 'BRASIL'}/${uf || 'BR'}/2045202024`;
export const URL_SGMU = 'https://sistemas.anatel.gov.br/sgmu/TUP/Lista/frmConsulta.asp?SISQSmodulo=17510';
export const urlPortal = (mun, uf) => `https://www.${nk(mun).replace(/['’]/g, '').replace(/\s+de\s+/g, 'de').replace(/[^a-z0-9]/g, '')}.${String(uf).toLowerCase()}.gov.br`;

// Bases de dados (carregadas sob demanda e guardadas em memória)
const cache = new Map();
const pegar = (url) => { if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)); return cache.get(url); };
export async function anatelDoMunicipio(uf, mun) {
  const d = await pegar(`/sdr/anatel/${String(uf).toUpperCase()}.json`);
  const m = d?.mun?.[nk(mun)];
  if (!m) return null;
  const ref = d.ref ? `${d.ref.slice(6, 8)}/${d.ref.slice(4, 6)}/${d.ref.slice(0, 4)}` : '';
  const tups = m.t.map(([loc, tup, cn, status, anatel, leitura]) => ({ loc, tup, cn, status, anatel, leitura }));
  const problema = (t) => nk(t.status) !== 'ativo' || nk(t.anatel) !== 'ativo';
  tups.sort((a, b) => problema(b) - problema(a) || a.loc.localeCompare(b.loc, 'pt-BR'));
  return { ref, tups, fora: tups.filter(problema).length };
}
export async function coberturaDoMunicipio(ibge) {
  const d = await pegar('/sdr/cobertura-smp.json');
  if (!d) return undefined;
  const r = d[String(ibge)];
  if (!r) return null;
  const ops = Object.entries(r).map(([op, t]) => ({ op, techs: t.split('').map((x) => x + 'G'), tem4G: t.includes('4') }));
  return { ops, tem4G: ops.some((o) => o.tem4G) };
}
export const prefeiturasDaUf = (uf) => pegar(`/dados/prefeituras/${String(uf).toUpperCase()}.json`);
export const municipiosBase = () => pegar('/propostas/municipios.json');
