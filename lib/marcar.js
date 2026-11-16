// Marcação feita na aba do Street View (/rua), guardada no navegador até a aba do mapa recebê-la
export const MARCA_PENDENTE = 'orelhao-marca-pendente';

// Há chave do Google Maps? Então "Ver na rua" abre a nossa aba /rua em vez do site do Google.
export const TEM_STREET_VIEW_PROPRIO = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

// Endereço da aba /rua para um orelhão (com a vista guardada, se houver)
export function linkRua(p, vista) {
  const q = new URLSearchParams({ id: String(p.id), lat: String(p.lat), lng: String(p.lng), nome: [p.localidade, p.municipio && `${p.municipio} · ${p.uf}`].filter(Boolean).join(' — ') });
  if (vista) { q.set('vlat', vista.lat); q.set('vlng', vista.lng); q.set('h', vista.heading); q.set('p', vista.pitch); }
  return `/rua?${q}`;
}
