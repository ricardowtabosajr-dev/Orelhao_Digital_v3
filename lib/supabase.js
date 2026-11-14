import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const COLS = 'id,localidade,regiao,uf,municipio,cod_localidade,cod_ibge,lat,lng,origem,origem_desc,status,cod_tup,rota';

/** Busca todos os orelhões paginando de 1000 em 1000 (limite do PostgREST). */
export async function fetchOrelhoes(onProgress) {
  const page = 1000;
  const { count } = await supabase.from('orelhoes').select('id', { count: 'exact', head: true });
  const total = count ?? 0;
  const requests = [];
  for (let from = 0; from < total; from += page) {
    requests.push(
      supabase.from('orelhoes').select(COLS).order('id').range(from, from + page - 1)
        .then(({ data, error }) => { if (error) throw error; onProgress?.(data.length, total); return data; })
    );
  }
  return (await Promise.all(requests)).flat();
}

export async function fetchProximos(lat, lng, limite = 15) {
  const { data, error } = await supabase.rpc('orelhoes_proximos', { p_lat: lat, p_lng: lng, p_limite: limite });
  if (error) throw error;
  return data;
}

/**
 * Salva os dados editáveis de um orelhão. `pos` é { lat, lng } ou null se a posição
 * não mudou. Retorna false se a senha de edição estiver errada.
 */
export async function atualizarOrelhao(id, senha, pos, dados) {
  const { data, error } = await supabase.rpc('atualizar_orelhao', {
    p_id: id, p_senha: senha, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null,
    p_cod_localidade: dados.cod_localidade, p_cod_ibge: dados.cod_ibge, p_status: dados.status, p_cod_tup: dados.cod_tup,
  });
  if (error) throw error;
  return data;
}
/**
 * Salva só a posição (sem senha — migration 006) e relê do banco para conferir.
 * Retorna { lat, lng } gravados, ou lança erro.
 */
export async function marcarPosicao(id, lat, lng, fonte, vista) {
  const args = { p_id: id, p_lat: lat, p_lng: lng, p_fonte: fonte || null };
  // vista da câmera do Street View (migration 007); sem ela, usa a função da 006
  let semVista = false;
  if (vista) Object.assign(args, { p_sv_lat: vista.lat, p_sv_lng: vista.lng, p_sv_heading: vista.heading, p_sv_pitch: vista.pitch });
  let { data, error } = await supabase.rpc('marcar_posicao', args);
  if (error && vista) { // banco ainda sem a 007: salva só a posição
    ({ data, error } = await supabase.rpc('marcar_posicao', { p_id: id, p_lat: lat, p_lng: lng, p_fonte: fonte || null }));
    semVista = true;
  }
  if (error) throw error;
  if (!data) throw new Error('orelhão não encontrado');
  const { data: o, error: e2 } = await supabase.from('orelhoes').select('lat,lng').eq('id', id).single();
  if (e2) throw e2;
  if (Math.abs(o.lat - lat) > 1e-6 || Math.abs(o.lng - lng) > 1e-6) throw new Error('o banco não gravou a posição nova');
  return { ...o, semVista };
}

/** Vista do Street View guardada (migration 007): { lat, lng, heading, pitch } ou null (também se a coluna ainda não existir). */
export async function fetchVista(id) {
  const { data, error } = await supabase.from('orelhoes').select('sv_lat,sv_lng,sv_heading,sv_pitch').eq('id', id).maybeSingle();
  if (error || data?.sv_lat == null) return null;
  return { lat: data.sv_lat, lng: data.sv_lng, heading: data.sv_heading ?? 0, pitch: data.sv_pitch ?? 0 };
}

// --- Fotos (migration 004) ---

const urlFoto = (caminho) => supabase.storage.from('fotos').getPublicUrl(caminho).data.publicUrl;

/** Fotos de um orelhão, da mais nova para a mais antiga: [{ id, url, legenda, criado_em }] */
export async function fetchFotos(orelhaoId) {
  const { data, error } = await supabase.from('orelhoes_fotos').select('id,caminho,legenda,criado_em')
    .eq('orelhao_id', orelhaoId).order('criado_em', { ascending: false });
  if (error) throw error;
  return data.map((f) => ({ ...f, url: urlFoto(f.caminho) }));
}

/** Envia uma foto (Blob JPEG). Retorna false se a senha estiver errada. */
export async function enviarFoto(orelhaoId, senha, blob, legenda) {
  const { data: token, error: e1 } = await supabase.rpc('autorizar_foto', { p_id: orelhaoId, p_senha: senha });
  if (e1) throw e1;
  if (!token) return false;
  const caminho = `${orelhaoId}/${token}.jpg`;
  const { error: e2 } = await supabase.storage.from('fotos').upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
  if (e2) throw e2;
  const { data: id, error: e3 } = await supabase.rpc('registrar_foto', { p_token: token, p_caminho: caminho, p_legenda: legenda || null });
  if (e3) throw e3;
  if (!id) throw new Error('A foto foi enviada mas não pôde ser registrada.');
  return true;
}

/** Apaga uma foto (do app e do Storage). Retorna false se a senha estiver errada. */
export async function apagarFoto(fotoId, senha) {
  const { data: caminho, error } = await supabase.rpc('apagar_foto', { p_foto_id: fotoId, p_senha: senha });
  if (error) throw error;
  if (!caminho) return false;
  await supabase.storage.from('fotos').remove([caminho]); // se falhar, só sobra o arquivo solto
  return true;
}
