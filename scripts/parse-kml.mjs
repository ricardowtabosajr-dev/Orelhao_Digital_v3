// Converte data/raw/kml/doc.kml -> data/orelhoes.json (+ estatísticas)
import fs from 'node:fs';

const xml = fs.readFileSync('data/raw/kml/doc.kml', 'utf8');
const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/&#x27;/g, "'");

const pts = [];
const folderRe = /<Folder><name>(.*?)<\/name>([\s\S]*?)<\/Folder>/g;
let f;
while ((f = folderRe.exec(xml))) {
  const folder = f[1];
  const pmRe = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let p;
  while ((p = pmRe.exec(f[2]))) {
    const b = p[1];
    const name = decode((b.match(/<name>(.*?)<\/name>/) || [])[1] || '');
    const style = (b.match(/<styleUrl>#(.*?)<\/styleUrl>/) || [])[1];
    const desc = decode(decode((b.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || ''));
    const [lng, lat] = ((b.match(/<coordinates>(.*?)<\/coordinates>/) || [])[1] || '').split(',').map(Number);
    const fields = {};
    for (const m of desc.matchAll(/<b>(.*?):<\/b>\s*(.*?)(?:<br\/>|$)/g)) fields[m[1].trim()] = m[2].trim();
    const nd = (v) => (!v || v === 'N/D' ? null : v);
    pts.push({
      id: pts.length + 1,
      localidade: name,
      regiao: fields['Região'] || null,
      uf: fields['UF'] || folder,
      municipio: fields['Município'] || null,
      cod_localidade: nd(fields['Cód. Localidade']),
      cod_ibge: nd(fields['Cód. IBGE 2022 corresp.']),
      lat, lng,
      origem: style === 'est' ? 'estimada' : 'original',
      origem_desc: fields['Origem da coordenada'] || null,
    });
  }
}

fs.writeFileSync('data/orelhoes.json', JSON.stringify(pts));
const count = (k) => pts.reduce((a, p) => ((a[p[k]] = (a[p[k]] || 0) + 1), a), {});
console.log('Total:', pts.length);
console.log('Regiões:', count('regiao'));
console.log('UFs:', Object.keys(count('uf')).length, count('uf'));
console.log('Origem:', count('origem'));
console.log('Municípios:', new Set(pts.map((p) => p.uf + p.municipio)).size);
console.log('Com cód. localidade:', pts.filter((p) => p.cod_localidade).length);
console.log('Coords inválidas:', pts.filter((p) => !isFinite(p.lat) || !isFinite(p.lng)).length);
console.log('Descrições de origem:', count('origem_desc'));
