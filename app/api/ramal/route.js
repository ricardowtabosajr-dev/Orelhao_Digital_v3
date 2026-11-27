// Dados do ramal para o discador (/telefone). A senha NUNCA vai no código nem no GitHub:
// fica só nas variáveis de ambiente da Vercel (RAMAL_*). Esta rota só devolve os dados
// quando o link traz o token certo (TELEFONE_TOKEN) — sem token, não entrega nada.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const token = (new URL(req.url).searchParams.get('token') || '').trim();
  const validos = (process.env.TELEFONE_TOKEN || '').split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
  if (!validos.length || !token || !validos.includes(token)) {
    return NextResponse.json({ erro: 'Link inválido ou expirado.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const cfg = {
    dominio: process.env.RAMAL_DOMINIO || '',
    proxy_wss: process.env.RAMAL_WSS || '',
    login: process.env.RAMAL_LOGIN || '',
    senha: process.env.RAMAL_SENHA || '',
  };
  if (!cfg.dominio || !cfg.proxy_wss || !cfg.login || !cfg.senha) {
    return NextResponse.json({ erro: 'Ramal não configurado no servidor.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(cfg, { headers: { 'Cache-Control': 'no-store' } });
}
