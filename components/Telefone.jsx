'use client';

// Discador do Orelhão Digital (/telefone). Aberto pelo QR Code com ?token=…
// A senha do ramal NÃO fica aqui: vem da rota /api/ramal só quando o token é válido, e nunca
// aparece na tela. Liga por WebRTC/SIP (SIP.js, carregado de /public/sip.esm.js).

import { useEffect, useRef, useState } from 'react';

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

const TECLAS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];

export default function Telefone() {
  const [fase, setFase] = useState('carregando'); // carregando | invalido | pronto
  const [stat, setStat] = useState({ txt: 'Iniciando…', cor: '' });
  const [numero, setNumero] = useState('');
  const [emChamada, setEmChamada] = useState(false);
  const [registrado, setRegistrado] = useState(false);
  const [encerrada, setEncerrada] = useState(false); // tela final depois de desligar
  const [logs, setLogs] = useState([]);

  const SIP = useRef(null);
  const uaRef = useRef(null);
  const sessaoRef = useRef(null);
  const audioRef = useRef(null);
  const ringRef = useRef({ ctx: null, timer: null });
  const numeroRef = useRef('');
  useEffect(() => { numeroRef.current = numero; }, [numero]);

  const log = (m) => setLogs((xs) => [...xs.slice(-40), new Date().toLocaleTimeString('pt-BR') + '  ' + m]);
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
    } catch {}
  };
  const pararChamando = () => { const r = ringRef.current; if (r.timer) { clearInterval(r.timer); r.timer = null; } };

  // monta o ramal uma vez, com os dados que a rota devolve (se o token for válido)
  useEffect(() => {
    let vivo = true;
    (async () => {
      const token = (new URLSearchParams(window.location.search).get('token') || '').trim();
      if (!token) { setFase('invalido'); return; }
      let cfg;
      try {
        const r = await fetch('/api/ramal?token=' + encodeURIComponent(token), { cache: 'no-store' });
        cfg = await r.json();
        if (!r.ok) throw new Error(cfg?.erro || 'Falha ao carregar o ramal.');
      } catch (e) { if (vivo) { setFase('invalido'); } return; }
      if (!vivo) return;
      setFase('pronto');
      try {
        const mod = await import(/* webpackIgnore: true */ '/sip.esm.js');
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
          delegate: {
            onInvite: (inv) => { try { inv.reject({ statusCode: 486 }); } catch {} },
            onDisconnect: () => { if (!vivo) return; setRegistrado(false); status('Conexão perdida', 'erro'); },
          },
        });
        uaRef.current = ua;
        status('Conectando…');
        await ua.start();
        if (!vivo) return;
        const registerer = new Registerer(ua);
        registerer.stateChange.addListener((e) => {
          if (!vivo) return;
          if (e === RegistererState.Registered) { setRegistrado(true); status('Registrado', 'on'); }
          else if (e === RegistererState.Unregistered) { setRegistrado(false); status('Ramal não registrado', 'erro'); }
        });
        status('Registrando…');
        await registerer.register();
      } catch (e) { if (vivo) status('Falha ao conectar', 'erro'); }
    })();
    return () => {
      vivo = false; pararChamando();
      try { sessaoRef.current?.bye?.().catch(() => {}); } catch {}
      try { uaRef.current?.stop?.(); } catch {}
    };
  }, []);

  const ligarAudio = () => {
    const pc = sessaoRef.current?.sessionDescriptionHandler?.peerConnection;
    if (!pc || !audioRef.current) return;
    const stream = new MediaStream();
    pc.getReceivers().forEach((r) => { if (r.track) stream.addTrack(r.track); });
    audioRef.current.srcObject = stream;
    audioRef.current.play().catch(() => {});
    let quedaTimer = null;
    pc.onconnectionstatechange = () => {
      const e = pc.connectionState;
      if (e === 'failed' || e === 'closed') encerrar(true);
      else if (e === 'disconnected') { clearTimeout(quedaTimer); quedaTimer = setTimeout(() => { if (pc.connectionState !== 'connected') encerrar(true); }, 2000); }
      else if (e === 'connected') clearTimeout(quedaTimer);
    };
  };

  const ligar = async () => {
    const mod = SIP.current; if (!mod || !uaRef.current) return;
    const { Inviter, SessionState } = mod;
    const num = comPrefixo(numeroRef.current);
    if (!num) { log('Informe um número.'); return; }
    const alvo = mod.UserAgent.makeURI(`sip:${num}@${uaRef.current.configuration.uri.host}`);
    if (!alvo) { log('Número inválido.'); return; }
    const sessao = new Inviter(uaRef.current, alvo);
    sessaoRef.current = sessao;
    setEmChamada(true);
    sessao.stateChange.addListener((estado) => {
      if (estado === SessionState.Establishing) { status('Chamando…', 'chamando'); tocarChamando(); }
      if (estado === SessionState.Established) { status('Em chamada', 'on'); pararChamando(); ligarAudio(); }
      if (estado === SessionState.Terminated) finalizar();
    });
    status('Discando…', 'chamando');
    const reason = (m) => (m ? (m.statusCode || '?') + ' ' + (m.reasonPhrase || '') : '');
    try {
      await sessao.invite({ requestDelegate: {
        onProgress: ({ message }) => log('  ← ' + reason(message)),
        onAccept: () => log('  ← atendida'),
        onReject: ({ message }) => log('  ✖ recusada: ' + reason(message)),
      } });
    } catch (e) { log('Erro ao ligar: ' + (e?.message || e)); finalizar(); }
  };

  // encerra a sessão aqui (pela queda da outra ponta, ou pelo botão)
  const encerrar = async (porQueda = false) => {
    const s = sessaoRef.current; if (!s) return;
    if (porQueda) log('A outra pessoa desligou.');
    try {
      const SessionState = SIP.current?.SessionState;
      if (SessionState && s.state === SessionState.Established) await s.bye().catch(() => {});
      else await s.cancel?.().catch(() => {});
    } catch {}
    finalizar();
  };

  // limpa tudo e mostra a tela de "encerrada" (e tenta fechar a aba)
  const finalizar = () => {
    if (!sessaoRef.current && encerrada) return;
    pararChamando();
    sessaoRef.current = null;
    setEmChamada(false);
    if (audioRef.current) audioRef.current.srcObject = null;
    setEncerrada(true);
    status('Registrado', 'on');
    setTimeout(() => { try { window.close(); } catch {} }, 400);
  };

  const digitar = (d) => { if (!emChamada) setNumero((v) => v + d); else try { sessaoRef.current?.sessionDescriptionHandler?.sendDtmf(d); } catch {} };
  const apagar = () => { if (!emChamada) setNumero((v) => v.slice(0, -1)); };
  const recomecar = () => { setEncerrada(false); setNumero(''); };

  const corDot = { on: '#16a34a', erro: '#dc2626', chamando: '#f59e0b' }[stat.cor] || '#64748b';

  return (
    <div className="tel-wrap">
      <div className="tel-fone">
        <h1>Seu orelhão agora é digital</h1>

        {fase === 'carregando' ? (
          <p className="tel-invalido" style={{ color: '#90b2b3' }}>Carregando…</p>
        ) : fase === 'invalido' ? (
          <p className="tel-invalido">Este link não é válido ou expirou.<br />Peça um novo QR Code para fazer ligações.</p>
        ) : encerrada ? (
          <div className="tel-fim">
            <div className="tel-fim-ic">✔</div>
            <p>Ligação encerrada.</p>
            <small>Pode fechar esta aba.</small>
            <button className="tel-btn ligar" onClick={recomecar}>Ligar de novo</button>
          </div>
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
