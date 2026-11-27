'use client';

// Consulta da caixa-preta do discador (/telefone/log): mostra as sessões mais recentes, cada
// uma como linha do tempo, com os problemas destacados. Lê pela função telefone_log_ler
// (migração 013), protegida pela senha 'log_password' do app_config.

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const NOMES = {
  abertura: 'Abriu o discador', aparelho: 'Aparelho', 'permissao-microfone': 'Permissão do microfone (antes de ligar)',
  token: 'Validou o link do QR', 'token-erro': 'Link do QR recusado', 'sip-carregado': 'Carregou o telefone',
  conectando: 'Conectando ao servidor de voz', 'wss-conectado': 'Conectado ao servidor de voz', 'wss-aberto': 'Conexão pronta',
  'wss-caiu': 'Conexão com o servidor de voz caiu', 'wss-fechado': 'Conexão encerrada (pelo discador)', registro: 'Registro do ramal', 'registro-aceito': 'Ramal registrado',
  'registro-recusado': 'Registro do ramal recusado', 'falha-conectar': 'Falha ao conectar',
  ligar: 'Tocou em Ligar', 'ligar-ignorado': 'Ligar ignorado (telefone não estava pronto)', 'microfone-ok': 'Microfone liberado',
  'microfone-erro': 'Microfone falhou', 'numero-invalido': 'Número inválido', estado: 'Estado da chamada',
  resposta: 'Servidor de voz respondeu', atendida: 'Atendida', recusada: 'Recusada pelo servidor de voz', redirecionada: 'Redirecionada',
  'invite-enviado': 'Chamada enviada', 'erro-invite': 'Erro ao discar', ice: 'Conexão de áudio (ICE)', 'ice-coleta': 'Coleta de rotas de áudio',
  'conexao-audio': 'Conexão de áudio', audio: 'Áudio ligado', 'audio-sem-conexao': 'Áudio sem conexão', 'audio-play-erro': 'Falha ao tocar o áudio',
  encerrar: 'Desligamento pedido', encerrou: 'Encerrou', tela: 'Tela', 'saiu-da-tela': 'Saiu da tela sem ligar (desconectou)',
  pagehide: 'Página fechando', rede: 'Internet do aparelho', 'erro-js': 'Erro na página', 'erro-promessa': 'Erro na página',
  'chamada-recebida-recusada': 'Chamada recebida (recusada)', 'sip-warn': 'Aviso do telefone', 'sip-error': 'Erro do telefone', 'erro-tom': 'Erro no tom de chamando',
  'sip-enviou': '→ Enviou ao servidor de voz', 'sip-recebeu': '← Recebeu do servidor de voz', 'sip-transporte': 'Conexão (detalhe)',
  'sip-midia': 'Áudio (detalhe)', 'sip-sessao': 'Chamada (detalhe)',
};

const CODIGOS = {
  100: 'tentando', 180: 'tocando', 181: 'encaminhando', 183: 'em progresso', 200: 'OK', 401: 'pede autenticação', 403: 'proibido',
  404: 'número não encontrado', 407: 'pede autenticação', 408: 'tempo esgotado', 480: 'indisponível', 484: 'número incompleto',
  486: 'ocupado', 487: 'cancelada', 488: 'áudio não aceito', 500: 'erro no servidor', 502: 'gateway com erro', 503: 'serviço indisponível',
  603: 'recusada (decline)',
};

const MOTIVOS = {
  'botao-desligar': 'quem ligou tocou em Desligar', 'outra-pessoa-desligou': 'a outra pessoa desligou', 'queda-do-audio': 'a conexão de áudio caiu',
  'recusa-do-servidor': 'o servidor de voz recusou', 'erro-ao-discar': 'erro ao discar', 'terminou-sem-atender': 'terminou antes de atender',
};

const RUINS = new Set(['token-erro', 'wss-caiu', 'registro-recusado', 'falha-conectar', 'ligar-ignorado', 'microfone-erro', 'numero-invalido',
  'recusada', 'erro-invite', 'audio-sem-conexao', 'audio-play-erro', 'erro-js', 'erro-promessa', 'sip-error', 'erro-tom']);

function ehRuim(e) {
  if (RUINS.has(e.tipo)) return true;
  const d = e.dados || {};
  if (Number(d.codigo) >= 400) return true;
  if (e.tipo === 'encerrou' && /recusa|erro|queda|sem-atender/.test(d.motivo || '')) return true;
  if ((e.tipo === 'ice' || e.tipo === 'conexao-audio') && /failed/.test(d.estado || '')) return true;
  if (e.tipo === 'sip-recebeu') { const c = Number((/^SIP\/2\.0 (\d{3})/.exec(d.linha || '') || [])[1]); if (c >= 400 && c !== 401 && c !== 407) return true; }
  // conexão: só erro de verdade (fechamento normal é código 1000; quedas reais já viram "wss-caiu")
  if (e.tipo === 'sip-transporte' && (/error/i.test(d.msg || '') || /WebSocket closed.*code: (?!1000\b)\d+/.test(d.msg || ''))) return true;
  return false;
}

// detalhes técnicos: escondidos por padrão (a não ser que indiquem problema)
const DETALHE = new Set(['sip-midia', 'sip-transporte', 'sip-sessao', 'sip-enviou', 'sip-recebeu']);
const ehDetalhe = (e) => DETALHE.has(e.tipo);

function aparelho(s) {
  const ev = s.eventos || [];
  const ap = ev.find((e) => e.tipo === 'aparelho')?.dados;
  const ua = ev.find((e) => e.tipo === 'abertura')?.dados?.ua || '';
  const so = ua.match(/Android [\d.]+/)?.[0] || (ua.match(/iPhone OS ([\d_]+)/) ? 'iOS ' + ua.match(/iPhone OS ([\d_]+)/)[1].replace(/_/g, '.') : '') || (/Windows/.test(ua) ? 'Windows' : '');
  const nav = ua.match(/SamsungBrowser\/[\d.]+/)?.[0]?.replace('SamsungBrowser', 'Samsung Internet')
    || ua.match(/EdgA?\/[\d.]+/)?.[0] || ua.match(/CriOS\/[\d.]+/)?.[0]?.replace('CriOS', 'Chrome iOS')
    || ua.match(/Chrome\/\d+/)?.[0] || (/Safari/.test(ua) ? 'Safari' : '');
  const emApp = /; wv\)|FBAN|FBAV|Instagram|WhatsApp|Line\//.test(ua) ? ' (navegador interno de app)' : '';
  return [ap?.modelo, so, nav].filter(Boolean).join(' · ') + emApp || 'aparelho desconhecido';
}

function resumo(s) {
  const ev = s.eventos || [];
  const ligou = ev.filter((e) => e.tipo === 'ligar');
  const fim = ev.filter((e) => e.tipo === 'encerrou').pop()?.dados?.motivo;
  const atendida = ev.some((e) => e.tipo === 'atendida');
  // problemas, com as etapas principais antes dos detalhes técnicos (o 1º é o que aparece no cartão)
  const ruins = ev.filter(ehRuim).sort((a, b) => Number(ehDetalhe(a)) - Number(ehDetalhe(b)));
  let cor = 'cinza', rotulo = 'Só abriu';
  if (atendida) { cor = 'verde'; rotulo = 'Ligação atendida'; }
  else if (ligou.length && ruins.length) { cor = 'vermelho'; rotulo = 'Ligação falhou'; }
  else if (ligou.length) { cor = 'amarelo'; rotulo = 'Não completou'; }
  else if (ruins.length) { cor = 'vermelho'; rotulo = 'Falhou ao abrir'; }
  return { ligou, fim, cor, rotulo, ruins };
}

function textoDados(e) {
  const d = e.dados;
  if (d == null) return '';
  const partes = [];
  if (d.codigo != null) partes.push(`${d.codigo} ${CODIGOS[d.codigo] || d.motivo || ''}`.trim());
  if (e.tipo === 'encerrou' && d.motivo) partes.push(MOTIVOS[d.motivo] || d.motivo);
  if (typeof d.linha === 'string') return d.linha;
  if (typeof d.msg === 'string' && Object.keys(d).every((k) => k === 'msg' || k === 'cat')) return d.msg;
  const resto = { ...d };
  delete resto.codigo; if (e.tipo === 'encerrou') delete resto.motivo;
  const txt = Object.keys(resto).length ? JSON.stringify(resto) : '';
  return [partes.join(' — '), txt].filter(Boolean).join('  ');
}

const hora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const duracao = (a, b) => { const s = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; };

export default function TelefoneLog() {
  const [senha, setSenha] = useState('');
  const [entrou, setEntrou] = useState(false);
  const [sessoes, setSessoes] = useState([]);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [aoVivo, setAoVivo] = useState(true);
  const [abertas, setAbertas] = useState({});
  const [atualizado, setAtualizado] = useState('');
  const [copiado, setCopiado] = useState('');
  const [detalhes, setDetalhes] = useState(false);

  const carregar = async (s = senha) => {
    if (!s) return;
    setCarregando(true);
    const { data, error } = await supabase.rpc('telefone_log_ler', { p_senha: s, p_limite: 60 });
    setCarregando(false);
    if (error) {
      setErro(/telefone_log_ler|PGRST202|does not exist|Could not find/i.test(error.message || '')
        ? 'O banco ainda não tem o log: rode supabase/migrations/013_telefone_log.sql no Supabase.'
        : 'Erro ao ler: ' + error.message);
      return;
    }
    if (data == null) { setErro('Senha incorreta (ou a senha do log ainda não foi cadastrada no Supabase).'); setEntrou(false); return; }
    setErro(''); setEntrou(true); setSessoes(data);
    setAtualizado(new Date().toLocaleTimeString('pt-BR'));
  };

  useEffect(() => {
    if (!entrou || !aoVivo) return undefined;
    const t = setInterval(() => carregar(), 10000);
    return () => clearInterval(t);
  }, [entrou, aoVivo, senha]); // eslint-disable-line react-hooks/exhaustive-deps

  const copiar = async (s) => {
    try { await navigator.clipboard.writeText(JSON.stringify(s, null, 2)); setCopiado(s.sessao); setTimeout(() => setCopiado(''), 2000); } catch {}
  };

  if (!entrou) {
    return (
      <div className="tlog-wrap">
        <form className="tlog-entrar" onSubmit={(e) => { e.preventDefault(); carregar(); }}>
          <h1>Log do discador</h1>
          <p>Linha do tempo das ligações feitas pelo QR Code.</p>
          <input type="password" placeholder="Senha do log" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
          <button type="submit" disabled={!senha || carregando}>{carregando ? 'Entrando…' : 'Entrar'}</button>
          {erro && <div className="tlog-erro">{erro}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="tlog-wrap">
      <div className="tlog-topo">
        <h1>Log do discador</h1>
        <div className="tlog-acoes">
          <label><input type="checkbox" checked={aoVivo} onChange={(e) => setAoVivo(e.target.checked)} /> Ao vivo</label>
          <label><input type="checkbox" checked={detalhes} onChange={(e) => setDetalhes(e.target.checked)} /> Detalhes técnicos</label>
          <button onClick={() => carregar()} disabled={carregando}>{carregando ? 'Atualizando…' : 'Atualizar'}</button>
        </div>
      </div>
      <p className="tlog-sub">{sessoes.length} sessões nos últimos 15 dias · atualizado às {atualizado}{aoVivo ? ' · atualiza a cada 10s' : ''}</p>
      {erro && <div className="tlog-erro">{erro}</div>}
      {!sessoes.length && <p className="tlog-vazio">Nenhuma sessão registrada ainda. Abra o discador pelo QR Code e ela aparece aqui.</p>}

      {sessoes.map((s) => {
        const r = resumo(s);
        const aberta = !!abertas[s.sessao];
        return (
          <div key={s.sessao} className={`tlog-sessao ${r.cor}`}>
            <button className="tlog-cab" onClick={() => setAbertas((x) => ({ ...x, [s.sessao]: !aberta }))}>
              <div className="tlog-linha1">
                <span className="tlog-hora">{hora(s.inicio)}</span>
                <span className="tlog-dur">{duracao(s.inicio, s.fim)}</span>
                <span className={`tlog-selo ${r.cor}`}>{r.rotulo}</span>
              </div>
              <div className="tlog-linha2">{aparelho(s)}{s.local ? ` · ${s.local}` : ''}{s.ip ? ` · ${s.ip}` : ''}</div>
              {(r.ligou.length > 0 || r.fim) && (
                <div className="tlog-linha3">
                  {r.ligou.length > 0 && <>Discou {r.ligou.map((e) => e.dados?.numero).join(', ')}</>}
                  {r.fim && <> → encerrou: <b>{MOTIVOS[r.fim] || r.fim}</b></>}
                </div>
              )}
              {r.ruins.length > 0 && <div className="tlog-linha3 ruim">⚠ {NOMES[r.ruins[0].tipo] || r.ruins[0].tipo}{r.ruins[0].dados?.codigo ? ` (${r.ruins[0].dados.codigo} ${CODIGOS[r.ruins[0].dados.codigo] || ''})` : ''}{r.ruins.length > 1 ? ` e mais ${r.ruins.length - 1}` : ''}</div>}
            </button>
            {aberta && (
              <div className="tlog-corpo">
                <div className="tlog-corpo-acoes">
                  <span>Sessão {s.sessao.slice(0, 8)}</span>
                  <button onClick={() => copiar(s)}>{copiado === s.sessao ? 'Copiado ✔' : 'Copiar sessão'}</button>
                </div>
                <ol className="tlog-eventos">
                  {(s.eventos || []).filter((e) => detalhes || !ehDetalhe(e) || ehRuim(e)).map((e) => (
                    <li key={e.seq + '-' + e.t} className={ehRuim(e) ? 'ruim' : ''}>
                      <span className="tlog-t">+{((e.t || 0) / 1000).toFixed(1)}s</span>
                      <span className="tlog-tipo">{NOMES[e.tipo] || e.tipo}</span>
                      <span className="tlog-dados">{textoDados(e)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
