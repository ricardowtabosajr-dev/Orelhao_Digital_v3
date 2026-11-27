// Recebe os eventos da caixa-preta do discador (/telefone) e grava no Supabase (migração 013).
// O discador manda por sendBeacon/fetch keepalive, então chega mesmo quando a aba já fechou.
// Só aceita quem traz o token do QR (o mesmo do /api/ramal); o token NÃO é gravado.
// O IP é gravado mascarado (só o começo) e a cidade vem dos cabeçalhos da Vercel.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 48 * 1024;

function mascararIp(ip) {
  if (!ip) return null;
  if (ip.includes('.')) { const p = ip.split('.'); return p.length === 4 ? `${p[0]}.${p[1]}.x.x` : null; }
  return ip.split(':').slice(0, 3).join(':') + ':…';
}

function decodificar(v) { try { return v ? decodeURIComponent(v) : ''; } catch { return v || ''; } }

export async function POST(req) {
  try {
    const txt = await req.text();
    if (!txt || txt.length > MAX_BYTES) return new NextResponse(null, { status: 413 });
    const corpo = JSON.parse(txt);

    const validos = (process.env.TELEFONE_TOKEN || '').split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
    const token = String(corpo?.token || '').trim();
    if (!validos.length || !validos.includes(token)) return new NextResponse(null, { status: 403 });
    if (!Array.isArray(corpo.eventos) || !corpo.eventos.length) return new NextResponse(null, { status: 400 });

    const ip = mascararIp((req.headers.get('x-forwarded-for') || '').split(',')[0].trim());
    const cidade = decodificar(req.headers.get('x-vercel-ip-city'));
    const uf = req.headers.get('x-vercel-ip-country-region') || '';
    const local = [cidade, uf].filter(Boolean).join('/') || null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !chave) return new NextResponse(null, { status: 500 });

    const r = await fetch(`${url}/rest/v1/rpc/telefone_log_gravar`, {
      method: 'POST',
      headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_sessao: String(corpo.sessao || ''), p_eventos: corpo.eventos.slice(0, 80), p_ip: ip, p_local: local }),
      cache: 'no-store',
    });
    return new NextResponse(null, { status: r.ok ? 204 : 502, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new NextResponse(null, { status: 400 });
  }
}
