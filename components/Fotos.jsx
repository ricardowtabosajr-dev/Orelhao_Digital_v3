'use client';
// Fotos dos orelhões (migration 004): para lugares sem Street View / Google Earth.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFotos, enviarFoto, apagarFoto } from '@/lib/supabase';

/** Carrega as fotos do orelhão selecionado. `erro` fica preenchido se o banco ainda não tiver a migration 004. */
export function useFotos(orelhaoId, ativo) {
  const [fotos, setFotos] = useState([]);
  const [erro, setErro] = useState(null);
  const recarregar = useCallback(() => {
    if (!ativo || !orelhaoId) { setFotos([]); return; }
    fetchFotos(orelhaoId).then((f) => { setFotos(f); setErro(null); }).catch((e) => { setFotos([]); setErro(e.message); });
  }, [orelhaoId, ativo]);
  useEffect(() => { setFotos([]); recarregar(); }, [recarregar]);
  return { fotos, erro, recarregar };
}

/** Reduz a foto para no máx. 1600 px e JPEG ~85% (fotos de celular têm 3–8 MB). */
async function comprimir(arquivo) {
  const img = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Não foi possível ler a imagem'))), 'image/jpeg', 0.85));
}

/** Bloco do modo de edição: adicionar e apagar fotos (usa a senha de edição). */
export function FotosEditor({ orelhaoId, fotos, erro, recarregar, senha, notify, onSenhaOk }) {
  const [legenda, setLegenda] = useState('');
  const [enviando, setEnviando] = useState(null); // "1/3" durante o envio
  const input = useRef(null);

  const adicionar = async (arquivos) => {
    if (!arquivos?.length) return;
    if (!senha) { notify('Digite a senha de edição (no fim da ficha) antes de enviar'); return; }
    let enviadas = 0;
    try {
      for (let i = 0; i < arquivos.length; i++) {
        setEnviando(`${i + 1}/${arquivos.length}`);
        const ok = await enviarFoto(orelhaoId, senha, await comprimir(arquivos[i]), legenda);
        if (!ok) { notify('Senha incorreta'); break; }
        enviadas++;
      }
      if (enviadas) { notify(enviadas > 1 ? `${enviadas} fotos adicionadas ✔` : 'Foto adicionada ✔'); setLegenda(''); onSenhaOk?.(); }
    } catch (e) { notify('Erro ao enviar foto: ' + e.message); }
    setEnviando(null);
    if (input.current) input.current.value = '';
    recarregar();
  };

  const apagar = async (f) => {
    if (!senha) { notify('Digite a senha de edição (no fim da ficha) antes de apagar'); return; }
    if (!confirm('Apagar esta foto? Não dá para desfazer.')) return;
    try {
      const ok = await apagarFoto(f.id, senha);
      notify(ok ? 'Foto apagada' : 'Senha incorreta');
    } catch (e) { notify('Erro ao apagar: ' + e.message); }
    recarregar();
  };

  return (
    <div className="edit-box fotos-edit">
      <b>📷 Fotos do local</b>
      {erro ? (
        <small className="fotos-erro">O banco ainda não está pronto para fotos: rode <code>supabase/migrations/004_fotos.sql</code> no SQL Editor do Supabase.</small>
      ) : (
        <>
          <small>Para quando não há Street View nem Google Earth. Com foto, o botão “Ver na rua” passa a abrir as fotos.</small>
          {fotos.length > 0 && (
            <div className="fotos-grade">
              {fotos.map((f) => (
                <figure key={f.id}>
                  <img src={f.url} alt={f.legenda || 'Foto do orelhão'} loading="lazy" />
                  <button className="fotos-apagar" title="Apagar foto" onClick={() => apagar(f)}>🗑</button>
                  {f.legenda && <figcaption>{f.legenda}</figcaption>}
                </figure>
              ))}
            </div>
          )}
          <input className="edit-input" value={legenda} onChange={(e) => setLegenda(e.target.value)} placeholder="Legenda (opcional), ex.: orelhão em frente à escola" maxLength={140} />
          <input ref={input} id="fotos-arquivo" type="file" accept="image/*" multiple hidden onChange={(e) => adicionar([...e.target.files])} />
          <button id="btn-add-foto" className="btn primary" disabled={!!enviando} onClick={() => input.current?.click()}>
            {enviando ? `Enviando ${enviando}…` : '➕ Adicionar foto(s)'}
          </button>
        </>
      )}
    </div>
  );
}

/** Visualizador em tela cheia. */
export function VisorFotos({ fotos, inicio = 0, streetViewUrl, onFechar }) {
  const [i, setI] = useState(inicio);
  const f = fotos[i];
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onFechar(); }
      if (e.key === 'ArrowRight') setI((n) => (n + 1) % fotos.length);
      if (e.key === 'ArrowLeft') setI((n) => (n - 1 + fotos.length) % fotos.length);
    };
    window.addEventListener('keydown', tecla, true); // antes do Esc que fecha a ficha
    return () => window.removeEventListener('keydown', tecla, true);
  }, [fotos.length, onFechar]);
  if (!f) return null;
  return (
    <div className="visor" onClick={onFechar}>
      <button className="visor-fechar" aria-label="Fechar">×</button>
      <img src={f.url} alt={f.legenda || 'Foto do orelhão'} onClick={(e) => e.stopPropagation()} />
      {fotos.length > 1 && (
        <>
          <button className="visor-nav ant" aria-label="Anterior" onClick={(e) => { e.stopPropagation(); setI((n) => (n - 1 + fotos.length) % fotos.length); }}>‹</button>
          <button className="visor-nav prox" aria-label="Próxima" onClick={(e) => { e.stopPropagation(); setI((n) => (n + 1) % fotos.length); }}>›</button>
        </>
      )}
      <div className="visor-rodape" onClick={(e) => e.stopPropagation()}>
        <span>{f.legenda || 'Foto do local'} · {new Date(f.criado_em).toLocaleDateString('pt-BR')}{fotos.length > 1 && ` · ${i + 1} de ${fotos.length}`}</span>
        <a href={streetViewUrl} target="_blank" rel="noreferrer">Abrir o Street View do Google mesmo assim</a>
      </div>
    </div>
  );
}
