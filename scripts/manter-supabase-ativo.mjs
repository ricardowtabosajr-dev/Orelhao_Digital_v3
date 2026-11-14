// Mantém o projeto Supabase do Orelhão Digital ativo: o plano gratuito pausa o
// projeto após 7 dias sem uso. Executado pelo Agendador de Tarefas do Windows
// (tarefa "Orelhao Digital - manter Supabase ativo"). Faz uma leitura simples no
// banco, o que conta como uso, e registra o resultado em logs/supabase-ativo.log.
//
// Uso manual: node scripts/manter-supabase-ativo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = path.join(raiz, 'logs', 'supabase-ativo.log');
fs.mkdirSync(path.dirname(log), { recursive: true });

const env = Object.fromEntries(
  fs.readFileSync(path.join(raiz, '.env.local'), 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Até 3 tentativas com 1 min de intervalo: logo após ligar o PC a internet pode não estar pronta.
let msg;
for (let tentativa = 1; tentativa <= 3; tentativa++) {
  try {
    const r = await fetch(`${url}/rest/v1/orelhoes?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    msg = `OK - banco respondeu (${(r.headers.get('content-range') || '?/?').split('/').pop()} orelhões)`
      + (tentativa > 1 ? ` na tentativa ${tentativa}` : '');
    process.exitCode = 0;
    break;
  } catch (e) {
    msg = `FALHA - ${e.cause?.code || e.message} (após ${tentativa} tentativa${tentativa > 1 ? 's' : ''})`;
    process.exitCode = 1;
    if (tentativa < 3) await new Promise((r) => setTimeout(r, 60000));
  }
}

const agora = new Date().toLocaleString('sv-SE');
fs.appendFileSync(log, `${agora}  ${msg}\n`);
// Mantém só as últimas 200 linhas.
const linhas = fs.readFileSync(log, 'utf8').trimEnd().split('\n');
if (linhas.length > 200) fs.writeFileSync(log, linhas.slice(-200).join('\n') + '\n');
console.log(msg);
