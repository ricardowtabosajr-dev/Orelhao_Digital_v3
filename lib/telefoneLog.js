// Caixa-preta do discador (/telefone): anota a linha do tempo de cada sessão (uma abertura do
// discador) e envia para /api/telefone-log, que grava no Supabase (migração 013).
// Regras: nunca registra senha, login do ramal nem token (são apagados de qualquer texto antes
// de anotar); o número discado vai mascarado. Se o envio falhar, a ligação segue normal.

const ROTA = '/api/telefone-log';
const LOTE = 60;

let sessao = '';
let token = '';
let inicio = 0;
let seq = 0;
let fila = [];
const segredos = [];

const agora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export const ms = (desde) => Math.round(agora() - desde);

function novoId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

// valores que nunca podem aparecer no log (login/senha do ramal, token do QR)
export function esconder(...valores) {
  for (const v of valores) if (v && String(v).length >= 3 && !segredos.includes(String(v))) segredos.push(String(v));
}

function semSegredos(txt) {
  let s = String(txt ?? '');
  for (const x of segredos) s = s.split(x).join('<oculto>');
  return s
    .replace(/((?:Proxy-)?Authorization:)[^\r\n"]*/gi, '$1 <oculto>')
    .replace(/token=[^&\s"]+/gi, 'token=<oculto>');
}

// texto livre (mensagens de erro etc.): sem segredos e curto
export const limpar = (txt) => semSegredos(txt).slice(0, 400);

// 061982590777 -> 061•••••0777
export function mascarar(n) {
  const d = String(n || '').replace(/\D/g, '');
  if (d.length <= 6) return d.replace(/\d(?=\d{2})/g, '•');
  return d.slice(0, 3) + '•'.repeat(d.length - 7) + d.slice(-4);
}

// sequências longas de dígitos (números de telefone) mascaradas dentro de um texto
export const mascararNumeros = (txt) => String(txt ?? '').replace(/\d{8,}/g, (n) => mascarar(n));

// devolve true só na primeira vez (a página pode montar duas vezes no modo de desenvolvimento)
export function iniciarLog(tk) {
  if (sessao) return false;
  sessao = novoId();
  token = tk || '';
  esconder(token);
  inicio = agora();
  setInterval(() => enviarLog(false), 3000);
  return true;
}

// Filtro das mensagens da biblioteca de telefonia (SIP.js manda tudo, até a configuração):
// fica só o que ajuda a diagnosticar, sem conteúdo bruto das mensagens.
export function registrarSip(nivel, categoria, conteudo) {
  const txt = String(conteudo ?? '');
  if (nivel === 'error' || nivel === 'warn') { ev('sip-' + nivel, { cat: categoria, msg: mascararNumeros(limpar(txt)) }); return; }
  const m = /^(Sending|Received) WebSocket (?:text |binary )?message:\s*([^\r\n]*)\r?\n?\s*([^\r\n]*)/.exec(txt);
  if (m) {
    const linha = (m[2] || m[3] || '').trim();
    if (linha) ev(m[1] === 'Sending' ? 'sip-enviou' : 'sip-recebeu', { linha: mascararNumeros(limpar(linha)) });
    return;
  }
  if (txt.startsWith('·') || /^Configuration:/.test(txt)) return; // listagem de configuração
  if (categoria === 'sip.Transport') { ev('sip-transporte', { msg: limpar(txt) }); return; }
  if (categoria === 'sip.SessionDescriptionHandler') {
    if (/onicecandidate$|constructor$/.test(txt)) return; // repetitivo
    ev('sip-midia', { msg: limpar(txt.replace(/^SessionDescriptionHandler\.?/, '')) }); return;
  }
  if (/^sip\.(Inviter|Session|Invitation)$/.test(categoria)) ev('sip-sessao', { msg: mascararNumeros(limpar(txt)) });
}

export function ev(tipo, dados) {
  if (!sessao) return;
  try {
    let d = null;
    if (dados != null) {
      const js = semSegredos(JSON.stringify(dados));
      d = js.length > 2500 ? { cortado: js.slice(0, 2500) } : JSON.parse(js);
    }
    fila.push({ seq: ++seq, t: Math.max(0, Math.round(agora() - inicio)), tipo: String(tipo).slice(0, 40), dados: d });
    if (fila.length > 400) fila.splice(0, fila.length - 400);
  } catch {}
}

// urgente = a página pode fechar a qualquer momento (usa sendBeacon, que sobrevive ao fechamento)
export function enviarLog(urgente = false) {
  if (!sessao || !fila.length) return;
  while (fila.length) {
    const corpo = JSON.stringify({ token, sessao, eventos: fila.splice(0, LOTE) });
    let foi = false;
    if (urgente && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try { foi = navigator.sendBeacon(ROTA, new Blob([corpo], { type: 'text/plain' })); } catch {}
    }
    if (!foi) {
      try { fetch(ROTA, { method: 'POST', body: corpo, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {}); } catch {}
    }
  }
}

// o que dá para saber do aparelho na hora da abertura (sem nada pessoal)
export function infoAparelho() {
  const c = navigator.connection;
  let origem = '';
  try { origem = document.referrer ? new URL(document.referrer).host : ''; } catch {}
  return {
    ua: navigator.userAgent,
    tela: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
    idioma: navigator.language,
    online: navigator.onLine,
    rede: c ? { tipo: c.effectiveType, downlink: c.downlink, rtt: c.rtt, economia: !!c.saveData } : null,
    visivel: document.visibilityState,
    historico: history.length,          // >1: a aba já tinha outras páginas (reaproveitada)
    origem,                             // de onde veio (host apenas)
    seguro: window.isSecureContext,
    webrtc: !!window.RTCPeerConnection,
    midia: !!navigator.mediaDevices?.getUserMedia,
  };
}

// modelo do aparelho e versões (só Chrome/Android informa; nos outros devolve null)
export async function detalhesAparelho() {
  try {
    const d = await navigator.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion', 'fullVersionList']);
    if (!d) return null;
    const nav = (d.fullVersionList || []).filter((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`).join(', ');
    return { modelo: d.model || '', plataforma: d.platform || '', versao: d.platformVersion || '', movel: !!d.mobile, navegador: nav };
  } catch { return null; }
}
