// Aplica a migration e importa data/orelhoes.json via Supabase Management API
// Uso: SUPABASE_ACCESS_TOKEN=... node scripts/setup-supabase.mjs <project_ref>
//
// ⚠ ATENÇÃO: este script APAGA a tabela orelhoes (truncate) e reimporta tudo do
// arquivo original. Isso desfaz todas as correções feitas pelo app. Use só para
// montar um banco novo do zero.
import fs from 'node:fs';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.argv[2];
const api = `https://api.supabase.com/v1/projects/${ref}`;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function sql(query) {
  const r = await fetch(`${api}/database/query`, { method: 'POST', headers: H, body: JSON.stringify({ query }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${t}`);
  return JSON.parse(t || '[]');
}

console.log('Aplicando schema...');
await sql(fs.readFileSync('supabase/migrations/001_init.sql', 'utf8'));

const pts = JSON.parse(fs.readFileSync('data/orelhoes.json', 'utf8'));
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
await sql('truncate public.orelhoes restart identity;');
const B = 500;
for (let i = 0; i < pts.length; i += B) {
  const rows = pts.slice(i, i + B).map((p) =>
    `(${q(p.localidade)},${q(p.regiao)},${q(p.uf)},${q(p.municipio)},${q(p.cod_localidade)},${q(p.cod_ibge)},${p.lat},${p.lng},${q(p.origem)},${q(p.origem_desc)})`
  );
  await sql(`insert into public.orelhoes (localidade,regiao,uf,municipio,cod_localidade,cod_ibge,lat,lng,origem,origem_desc) values ${rows.join(',')};`);
  console.log(`  ${Math.min(i + B, pts.length)}/${pts.length}`);
}

console.log(await sql('select count(*) total, count(distinct uf) ufs, count(distinct uf||municipio) municipios from public.orelhoes;'));
console.log(await sql('select localidade, municipio, uf, round(distancia_km::numeric,1) km from public.orelhoes_proximos(-2.4430, -54.7083, 3);'));

const keys = await (await fetch(`${api}/api-keys`, { headers: H })).json();
const anon = keys.find((k) => k.name === 'anon')?.api_key;
fs.writeFileSync('.env.local',
  `NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}\n`);
console.log('.env.local gerado');
