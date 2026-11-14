// Satélite da Esri (World Imagery) sem a tela "Map data not yet available".
//
// Em área rural a Esri não tem foto nos zooms mais altos e devolve sempre a mesma
// imagem de aviso (2.521 bytes, hash abaixo). Duas defesas:
//  1. protocolo "esri://": se o tile for o aviso, usa o tile "pai" (zoom menor) recortado
//     e esticado — a imagem fica menos nítida, mas não some;
//  2. zoomComFoto(): pergunta à Esri (tilemap) até que zoom há foto num ponto, para o
//     mapa já parar ali ao selecionar um orelhão.

const SERVICO = 'ArcGIS/rest/services/World_Imagery/MapServer';
const AVISO_BYTES = 2521;
const AVISO_SHA256 = '9eafd300d61393184a4abc1d458564cfd1cd9b6f9c4e9c74687045c0a0e5b858';
const NIVEIS_ACIMA = 6; // até quantos zooms acima procurar foto

async function ehAviso(buf) {
  if (buf.byteLength !== AVISO_BYTES) return false;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('') === AVISO_SHA256;
}

async function baixar(host, z, y, x, signal) {
  const r = await fetch(`https://${host}/${SERVICO}/tile/${z}/${y}/${x}`, { signal });
  if (!r.ok) throw new Error(`Esri ${r.status}`);
  return r.arrayBuffer();
}

/** Recorta o pedaço do tile pai que corresponde ao tile pedido e estica para 256 px. */
async function recortar(bufPai, d, x, y) {
  const n = 2 ** d, lado = 256 / n;
  const sx = (x % n) * lado, sy = (y % n) * lado;
  const bmp = await createImageBitmap(new Blob([bufPai], { type: 'image/jpeg' }), sx, sy, lado, lado,
    { resizeWidth: 256, resizeHeight: 256, resizeQuality: 'high' });
  const c = new OffscreenCanvas(256, 256);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return (await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer();
}

/** Para maplibregl.addProtocol('esri', ...). URL: esri://<host>/{z}/{y}/{x} */
export async function tileEsri(params, abortController) {
  const [host, z, y, x] = params.url.replace('esri://', '').split('/');
  const Z = +z, Y = +y, X = +x, signal = abortController.signal;
  const buf = await baixar(host, Z, Y, X, signal);
  if (!(await ehAviso(buf))) return { data: buf };
  for (let d = 1; d <= NIVEIS_ACIMA && Z - d >= 0; d++) {
    const pai = await baixar(host, Z - d, Y >> d, X >> d, signal); // normalmente já está no cache do navegador
    if (!(await ehAviso(pai))) return { data: await recortar(pai, d, X, Y) };
  }
  return { data: buf };
}

const tileXY = (lat, lng, z) => {
  const r = (lat * Math.PI) / 180;
  return [Math.floor(((lng + 180) / 360) * 2 ** z), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)];
};

/**
 * Maior zoom do mapa (≤ max) com foto de satélite no ponto. O mapa usa tiles de 256 px,
 * então o zoom Z do mapa mostra tiles do nível Z+1. Em caso de erro, devolve `reserva`.
 */
export async function zoomComFoto(lat, lng, { max = 17, min = 13, reserva = 15 } = {}) {
  try {
    const niveis = [];
    for (let z = max + 1; z >= min + 1; z--) niveis.push(z);
    const tem = await Promise.all(niveis.map(async (z) => {
      const [x, y] = tileXY(lat, lng, z);
      const r = await fetch(`https://server.arcgisonline.com/${SERVICO}/tilemap/${z}/${y}/${x}/1/1`, { signal: AbortSignal.timeout(2500) });
      return (await r.json())?.data?.[0] === 1;
    }));
    const i = tem.indexOf(true);
    return i === -1 ? min : niveis[i] - 1;
  } catch {
    return reserva;
  }
}
