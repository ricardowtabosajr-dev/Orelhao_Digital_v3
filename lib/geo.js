export const REGIOES = [
  { id: 'Norte', cor: '#34d399' },
  { id: 'Nordeste', cor: '#fbbf24' },
  { id: 'Centro-Oeste', cor: '#f472b6' },
  { id: 'Sudeste', cor: '#60a5fa' },
  { id: 'Sul', cor: '#a78bfa' },
];
export const COR_REGIAO = Object.fromEntries(REGIOES.map((r) => [r.id, r.cor]));

export const UF_NOME = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

export const norm = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function haversine(a, b) {
  const R = 6371, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const fmt = (n) => n.toLocaleString('pt-BR');

export function bounds(points) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of points) { w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
  return [[w, s], [e, n]];
}

/** Ponto a `metros` de distância, na direção `graus` (0 = norte). */
export function destino(lat, lng, graus, metros) {
  const R = 6371000, d = metros / R, br = (graus * Math.PI) / 180;
  const f1 = (lat * Math.PI) / 180, l1 = (lng * Math.PI) / 180;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: (f2 * 180) / Math.PI, lng: (((l2 * 180) / Math.PI + 540) % 360) - 180 };
}
