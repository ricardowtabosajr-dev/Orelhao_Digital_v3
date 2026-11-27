'use client';

// Discador do Orelhão Digital (/telefone). Aberto pelo QR Code com ?token=…
// A senha do ramal NÃO fica aqui: vem da rota /api/ramal só quando o token é válido, e nunca
// aparece na tela. Liga por WebRTC/SIP (SIP.js, carregado de /public/sip.esm.js).
// Caixa-preta: cada etapa vai para /api/telefone-log (lib/telefoneLog.js), sem senha/login/token.

import { useEffect, useRef, useState } from 'react';
import { iniciarLog, ev, enviarLog, esconder, limpar, mascarar, ms, infoAparelho, detalhesAparelho, registrarSip } from '@/lib/telefoneLog';

const DDD_PADRAO = '91'; // número digitado sem DDD é completado com este

// 0 de saída (o ramal exige) + DDD quando não vem
function comPrefixo(n) {
  const d = String(n || '').replace(/[^\d*#]/g, '');
  if (!d || /[*#]/.test(d)) return d;
  if (/^0/.test(d)) return d;
  if (/^\d{10,11}$/.test(d)) return '0' + d;
  if (/^\d{8,9}$/.test(d)) return '0' + DDD_PADRAO + d;
  return d;
}

// resposta do servidor de voz, só com o que interessa para o diagnóstico
function resposta(m) {
  if (!m) return null;
  const r = { codigo: m.statusCode, motivo: m.reasonPhrase };
  try { const x = m.getHeader?.('Reason'); if (x) r.reason = limpar(x); } catch {}
  try { const x = m.getHeader?.('Warning'); if (x) r.aviso = limpar(x); } catch {}
  return r;
}

const TECLAS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];

export default function Telefone() {
  const [fase, setFase] = useState('carregando'); // carregando | invalido | pronto
  const [stat, setStat] = useState({ txt: 'Iniciando…', cor: '' });
  const [numero, setNumero] = useState('');
  const [emChamada, setEmChamada] = useState(false);
  const [registrado, setRegistrado] = useState(false);
  const [encerrada, setEncerrada] = useState(false); // tela final depois de desligar

  const SIP = useRef(null);
  const uaRef = useRef(null);
  const sessaoRef = useRef(null);
  const audioRef = useRef(null);
  const ringRef = useRef({ ctx: null, timer: null });
  const numeroRef = useRef('');
  const ocupadoRef = useRef(false); // true enquanto está discando / em ligação
  const motivoRef = useRef('');     // por que a ligação acabou (para o log)
  const atendidaRef = useRef(0);    // quando foi atendida (0 = não foi)
  const fimRef = useRef(false);     // finalizar só uma vez
  const paradoRef = useRef(false);  // nós mesmos desligamos o ramal (não é queda)
  useEffect(() => { numeroRef.current = numero; }, [numero]);

  const status = (txt, cor = '') => setStat({ txt, cor });

  // tom de "chamando" local (o servidor não devolve esse som)
  const tocarChamando = () => {
    try {
      const r = ringRef.current;
      r.ctx = r.ctx || new (window.AudioContext || window.webkitAudioContext)();
      pararChamando();
      const toque = () => {
        const o = r.ctx.createOscillator(), g = r.ctx.createGain();
        o.frequency.value = 425; g.gain.value = 0.07; o.connect(g); g.connect(r.ctx.destination);
        o.start(); setTimeout(() => { try { o.stop(); } catch {} }, 1000);
      };
      toque(); r.timer = setInterval(toque, 5000);
    } catch (e) { ev('erro-tom', { msg: limpar(e?.message || e) }); }
  };
  const pararChamando = () => { const r = ringRef.current; if (r.timer) { clearInterval(r.timer); r.timer = null; } };

  // monta o ramal uma vez, com os dados que a rota devolve (se o token for válido)
  useEffect(() => {
    let vivo = true;
    const token = (new URLSearchParams(window.location.search).get('token') || '').trim();
    if (iniciarLog(token)) {
      ev('abertura', infoAparelho());
      detalhesAparelho().then((d) => { if (d) ev('aparelho', d); });
      try { navigator.permissions?.query?.({ name: 'microphone' }).then((s) => ev('permissao-microfone', { estado: s.state })).catch(() => {}); } catch {}
    }

    const onErro = (e) => ev('erro-js', { msg: limpar(e.message), arquivo: String(e.filename || '').split('/').pop(), linha: e.lineno });
    const onRejeicao = (e) => ev('erro-promessa', { msg: limpar(e.reason?.message || e.reason) });
    const onOnline = () => ev('rede', { online: true });
    const onOffline = () => ev('rede', { online: false });
    const onPageHide = (e) => { ev('pagehide', { persisted: !!e.persisted }); enviarLog(true); };
    window.addEventListener('error', onErro);
    window.addEventListener('unhandledrejection', onRejeicao);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pagehide', onPageHide);

    (async () => {
      if (!token) { ev('token', { ok: false, motivo: 'sem-token' }); setFase('invalido'); return; }
      let cfg;
      const t0 = performance.now();
      try {
        const r = await fetch('/api/ramal?token=' + encodeURIComponent(token), { cache: 'no-store' });
        cfg = await r.json();
        ev('token', { ok: r.ok, status: r.status, ms: ms(t0) });
        if (!r.ok) throw new Error(cfg?.erro || 'Falha ao carregar o ramal.');
      } catch (e) { ev('token-erro', { msg: limpar(e?.message || e) }); enviarLog(true); if (vivo) setFase('invalido'); return; }
      esconder(cfg.login, cfg.senha);
      if (!vivo) return;
      setFase('pronto');
      try {
        const t1 = performance.now();
        const mod = await import(/* webpackIgnore: true */ '/sip.esm.js');
        ev('sip-carregado', { ms: ms(t1) });
        if (!vivo) return;
        SIP.current = mod;
        const { UserAgent, Registerer, RegistererState } = mod;
        const ua = new UserAgent({
          uri: UserAgent.makeURI(`sip:${cfg.login}@${cfg.dominio}`),
          transportOptions: { server: cfg.proxy_wss },
          authorizationUsername: cfg.login,
          authorizationPassword: cfg.senha,
          contactName: cfg.login,
          logBuiltinEnabled: false,
          logConfiguration: false,
          logConnector: (nivel, categoria, _rotulo, conteudo) => registrarSip(nivel, categoria, conteudo),
          delegate: {
            onInvite: (inv) => { ev('chamada-recebida-recusada'); try { inv.reject({ statusCode: 486 }); } catch {} },
            onConnect: () => ev('wss-conectado'),
            onDisconnect: (erro) => {
              // fechada por nós (encerrou / saiu da tela) não é problema; o resto é queda de verdade
              if (paradoRef.current || !vivo) { ev('wss-fechado'); return; }
              ev('wss-caiu', { erro: limpar(erro?.message || erro || '') });
              setRegistrado(false); status('Conexão perdida', 'erro');
            },
          },
        });
        uaRef.current = ua;
        status('Conectando…');
        let servidor = '';
        try { servidor = new URL(cfg.proxy_wss).host; } catch {}
        ev('conectando', { servidor });
        const t2 = performance.now();
        await ua.start();
        ev('wss-aberto', { ms: ms(t2) });
        if (!vivo) return;
        const registerer = new Registerer(ua, { logConfiguration: false });
        registerer.stateChange.addListener((e) => {
          ev('registro', { estado: String(e) });
          if (!vivo) return;
          if (e === RegistererState.Registered) { setRegistrado(true); status('Registrado', 'on'); }
          else if (e === RegistererState.Unregistered) { setRegistrado(false); status('Ramal não registrado', 'erro'); }
        });
        status('Registrando…');
        const t3 = performance.now();
        await registerer.register({ requestDelegate: {
          onAccept: ({ message }) => {
            let contatos = null; try { contatos = message.getHeaders('contact').length; } catch {}
            ev('registro-aceito', { ...resposta(message), ms: ms(t3), contatos });
          },
          onReject: ({ message }) => ev('registro-recusado', { ...resposta(message), ms: ms(t3) }),
        } });
      } catch (e) { ev('falha-conectar', { msg: limpar(e?.message || e) }); enviarLog(true); if (vivo) status('Falha ao conectar', 'erro'); }
    })();

    return () => {
      vivo = false; pararChamando();
      window.removeEventListener('error', onErro);
      window.removeEventListener('unhandledrejection', onRejeicao);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onPageHide);
      try { sessaoRef.current?.bye?.().catch(() => {}); } catch {}
      try { uaRef.current?.stop?.(); } catch {}
    };
  }, []);

  // Saiu da tela SEM estar em ligação (trocou de app ou de aba, bloqueou a tela): desconecta o
  // ramal e troca a página por uma em branco, na hora. Assim uma aba esquecida não reconecta
  // sozinha quando o celular a recarregar depois. Durante a ligação nada muda: a chamada continua.
  useEffect(() => {
    const aoMudarTela = () => {
      ev('tela', { estado: document.visibilityState, ocupado: ocupadoRef.current });
      if (document.visibilityState !== 'hidden' || ocupadoRef.current) return;
      ocupadoRef.current = true; // não repete
      ev('saiu-da-tela', { acao: 'desconectou e ficou em branco' });
      enviarLog(true);
      paradoRef.current = true;
      pararChamando();
      try { uaRef.current?.stop?.(); } catch {}
      try { window.location.replace('about:blank'); } catch {}
    };
    document.addEventListener('visibilitychange', aoMudarTela);
    return () => document.removeEventListener('visibilitychange', aoMudarTela);
  }, []);

  // só observa a conexão de áudio (para o log); quem decide encerrar é ligarAudio
  const vigiarConexao = (pc) => {
    if (!pc || pc.__vigiada) return;
    pc.__vigiada = true;
    pc.addEventListener('iceconnectionstatechange', () => ev('ice', { estado: pc.iceConnectionState }));
    pc.addEventListener('icegatheringstatechange', () => ev('ice-coleta', { estado: pc.iceGatheringState }));
    pc.addEventListener('connectionstatechange', () => ev('conexao-audio', { estado: pc.connectionState }));
  };

  const ligarAudio = () => {
    const pc = sessaoRef.current?.sessionDescriptionHandler?.peerConnection;
    if (!pc || !audioRef.current) { ev('audio-sem-conexao', { pc: !!pc, elemento: !!audioRef.current }); return; }
    vigiarConexao(pc);
    const stream = new MediaStream();
    pc.getReceivers().forEach((r) => { if (r.track) stream.addTrack(r.track); });
    ev('audio', { faixas: stream.getTracks().length });
    audioRef.current.srcObject = stream;
    audioRef.current.play().catch((e) => ev('audio-play-erro', { nome: e?.name, msg: limpar(e?.message) }));
    let quedaTimer = null;
    pc.onconnectionstatechange = () => {
      const e = pc.connectionState;
      if (e === 'failed' || e === 'closed') encerrar(true);
      else if (e === 'disconnected') { clearTimeout(quedaTimer); quedaTimer = setTimeout(() => { if (pc.connectionState !== 'connected') encerrar(true); }, 2000); }
      else if (e === 'connected') clearTimeout(quedaTimer);
    };
  };

  const ligar = async () => {
    const mod = SIP.current;
    if (!mod || !uaRef.current) { ev('ligar-ignorado', { sip: !!mod, ua: !!uaRef.current }); return; }
    const num = comPrefixo(numeroRef.current);
    if (!num) return;
    ocupadoRef.current = true; // a partir daqui, sair da tela não derruba nada
    motivoRef.current = ''; atendidaRef.current = 0;
    ev('ligar', { numero: mascarar(num), digitos: num.length, digitado: String(numeroRef.current).replace(/\D/g, '').length, registrado });
    // Garante o microfone ANTES de discar. A 1ª ligação falhava porque o navegador só pedia a
    // permissão do microfone na hora do INVITE, e a chamada morria antes de completar. Pedindo
    // aqui (ainda no toque do botão), a permissão é resolvida e o INVITE sai com áudio.
    const t0 = performance.now();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      ev('microfone-ok', { ms: ms(t0), faixas: s.getAudioTracks().length });
      s.getTracks().forEach((t) => t.stop());
    } catch (e) {
      ev('microfone-erro', { nome: e?.name, msg: limpar(e?.message), ms: ms(t0) });
      enviarLog(true);
      status('Permita o microfone e toque em Ligar', 'erro');
      ocupadoRef.current = false;
      return;
    }
    const { Inviter, SessionState } = mod;
    const alvo = mod.UserAgent.makeURI(`sip:${num}@${uaRef.current.configuration.uri.host}`);
    if (!alvo) { ev('numero-invalido', { numero: mascarar(num) }); ocupadoRef.current = false; return; }
    const sessao = new Inviter(uaRef.current, alvo);
    sessaoRef.current = sessao;
    setEmChamada(true);
    sessao.stateChange.addListener((estado) => {
      ev('estado', { estado: String(estado) });
      if (estado === SessionState.Establishing) {
        status('Chamando…', 'chamando'); tocarChamando();
        vigiarConexao(sessao.sessionDescriptionHandler?.peerConnection);
      }
      if (estado === SessionState.Established) { atendidaRef.current = performance.now(); status('Em chamada', 'on'); pararChamando(); ligarAudio(); }
      // espera um instante: a biblioteca avisa "terminada" antes de avisar a recusa (onReject),
      // e o log precisa do motivo certo antes de fechar
      if (estado === SessionState.Terminated) setTimeout(finalizar, 0);
    });
    status('Discando…', 'chamando');
    const t1 = performance.now();
    try {
      await sessao.invite({ requestDelegate: {
        onTrying: () => ev('resposta', { codigo: 100, ms: ms(t1) }),
        onProgress: ({ message }) => ev('resposta', { ...resposta(message), ms: ms(t1) }),
        onAccept: ({ message }) => ev('atendida', { ...resposta(message), ms: ms(t1) }),
        onReject: ({ message }) => { motivoRef.current = 'recusa-do-servidor'; ev('recusada', { ...resposta(message), ms: ms(t1) }); },
        onRedirect: ({ message }) => ev('redirecionada', resposta(message)),
      } });
      ev('invite-enviado', { ms: ms(t1) });
    } catch (e) {
      motivoRef.current = 'erro-ao-discar';
      ev('erro-invite', { nome: e?.name, msg: limpar(e?.message || e), ms: ms(t1) });
      finalizar();
    }
  };

  // encerra a sessão aqui (pela queda da outra ponta, ou pelo botão)
  const encerrar = async (porQueda = false) => {
    const s = sessaoRef.current; if (!s) return;
    if (!motivoRef.current) motivoRef.current = porQueda ? 'queda-do-audio' : 'botao-desligar';
    ev('encerrar', { motivo: motivoRef.current, estado: String(s.state) });
    try {
      const SessionState = SIP.current?.SessionState;
      if (SessionState && s.state === SessionState.Established) await s.bye().catch(() => {});
      else await s.cancel?.().catch(() => {});
    } catch {}
    finalizar();
  };

  // encerra TUDO: além da ligação, desconecta o ramal (dá o "unregister" e para o SIP).
  // Depois disso a aplicação se fecha sozinha: para fazer outra ligação, a pessoa precisa
  // reabrir escaneando o QR Code novamente.
  const finalizar = () => {
    if (fimRef.current) return;
    fimRef.current = true;
    const motivo = motivoRef.current || (atendidaRef.current ? 'outra-pessoa-desligou' : 'terminou-sem-atender');
    ev('encerrou', { motivo, conversa_s: atendidaRef.current ? Math.round((performance.now() - atendidaRef.current) / 1000) : 0 });
    enviarLog(true);
    pararChamando();
    sessaoRef.current = null;
    setEmChamada(false);
    if (audioRef.current) audioRef.current.srcObject = null;
    setRegistrado(false);
    setEncerrada(true);
    status('Desconectado', '');
    paradoRef.current = true;
    try { uaRef.current?.stop?.(); } catch {} // desconecta o ramal do servidor
    // Fecha a aplicação sozinha (como nos testes de 26/11 à noite). Se o navegador não deixar
    // fechar a aba, troca a página por uma em branco (sem voltar no histórico): assim, atualizar
    // a página NÃO reconecta o ramal — para ligar de novo, só escaneando o QR Code.
    // Se a ligação acabou com a tela escondida, troca pela página em branco na hora: em segundo
    // plano o celular pode congelar a aba antes de um temporizador rodar.
    if (document.visibilityState === 'hidden') { try { window.location.replace('about:blank'); } catch {} return; }
    setTimeout(() => {
      try { window.close(); } catch {}
      setTimeout(() => { try { window.location.replace('about:blank'); } catch {} }, 300);
    }, 400);
  };

  const digitar = (d) => { if (!emChamada) setNumero((v) => v + d); else try { sessaoRef.current?.sessionDescriptionHandler?.sendDtmf(d); } catch {} };
  const apagar = () => { if (!emChamada) setNumero((v) => v.slice(0, -1)); };

  const corDot = { on: '#16a34a', erro: '#dc2626', chamando: '#f59e0b' }[stat.cor] || '#64748b';

  // Ligação encerrada: ramal desconectado e a aplicação se fechando. Sem mensagem, sem botão.
  if (encerrada) return <div className="tel-wrap" />;

  return (
    <div className="tel-wrap">
      <div className="tel-fone">
        <h1>Seu orelhão agora é digital</h1>

        {fase === 'carregando' ? (
          <p className="tel-invalido" style={{ color: '#90b2b3' }}>Carregando…</p>
        ) : fase === 'invalido' ? (
          <p className="tel-invalido">Este link não é válido ou expirou.<br />Peça um novo QR Code para fazer ligações.</p>
        ) : (
          <>
            <div className="tel-status"><span className="tel-dot" style={{ background: corDot }} />{stat.txt}</div>

            <div className="tel-visor-linha">
              <input className="tel-visor" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && registrado && !emChamada) ligar(); }} autoComplete="off" disabled={emChamada} />
              <button className="tel-apagar" onClick={apagar} title="Apagar" disabled={emChamada}>⌫</button>
            </div>

            <div className="tel-teclado">
              {TECLAS.map(([d, s]) => (
                <button key={d} className="tel-tecla" onClick={() => digitar(d)}>{d}<small>{s}</small></button>
              ))}
            </div>

            {!emChamada
              ? <button className="tel-btn ligar" onClick={ligar} disabled={!registrado || !numero}>📞 Ligar</button>
              : <button className="tel-btn desligar" onClick={() => encerrar(false)}>✖ Desligar</button>}

            <p className="tel-aviso">Digite com ou sem DDD. Fale pelo microfone do aparelho.</p>
          </>
        )}
      </div>
      <audio ref={audioRef} autoPlay playsInline />
    </div>
  );
}
