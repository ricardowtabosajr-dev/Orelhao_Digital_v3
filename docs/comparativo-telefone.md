# Relatório — De/Para: aplicação original × nossa aplicação (/telefone)

Registro do que foi analisado, evoluído e corrigido no discador por QR Code.

## 1. O que é cada uma

**Aplicação original** (o link que serviu de base): um discador web chamado **"Wephone"**, de terceiros, hospedado em `colrweb.servicostelefonicos.com.br`. Serve para ligar pelo navegador usando o ramal da Método (via VoiceManager). Abre por um link com token, que busca os dados do ramal e conecta a ligação.

**Nossa aplicação** (`/telefone`, em orelhao-digital-v3.vercel.app): um discador próprio, construído do zero, dentro do nosso sistema e sob o nosso controle, reaproveitando a mesma base de tecnologia, mas com segurança, comportamento e identidade feitos por nós.

## 2. Quadro De/Para

| Item | Aplicação original (Wephone) | Nossa aplicação (/telefone) |
|---|---|---|
| Dono/controle | Terceiro, build de laboratório ("VM WebPhone Lab") | Nosso, no nosso domínio |
| Tecnologia da ligação | WebRTC + SIP.js | A mesma |
| Abertura | Link com token | Link com token (igual) |
| Onde fica a senha do ramal | Servidor deles; entregue ao navegador via token | Servidor da Vercel; entregue ao navegador via token |
| Tom de "chamando" | Não tocava (silêncio até atender) | Tocamos um tom local enquanto chama |
| Formato do número | Manual (acertar "0" e DDD na mão) | Automático (0 de saída + DDD entram sozinhos) |
| Encerrar quando a outra ponta desliga | Dependia do servidor avisar | Vigia a conexão e encerra sozinho |
| Estado do ramal após a ligação | Continua registrado enquanto a página está aberta | Desconecta o ramal de vez ao encerrar |
| Tela ao encerrar | — | "Ligação encerrada — Ramal desconectado" |
| Link/token inválido | — | Mostra "Este link não é válido ou expirou" |
| Identidade/visual | Genérico ("Wephone") | "Seu orelhão agora é digital", visual próprio |
| Chamada recebida | Recusada automaticamente | Recusada automaticamente (igual) |

## 3. Evoluções que fizemos

1. Tom de chamando gerado no próprio aparelho (a original ficava muda até atender).
2. Discagem automática: o "0" de saída e o DDD entram sozinhos.
3. Desligar automático quando a outra pessoa encerra, com vigia da conexão de áudio.
4. Desconexão total do ramal ao encerrar (ver item 4 — principal correção de segurança).
5. Tela de encerramento clara e tratamento de link inválido.
6. Identidade e controle próprios, com token que podemos trocar quando quisermos.

## 4. Vulnerabilidades / fragilidades

### Corrigimos (existia na original, não existe mais na nossa)

- **Ramal ficava "ligado" sem necessidade.** Na original, o ramal segue registrado enquanto a página fica aberta. Aberta por um app de leitura de QR (que não fecha sozinho), dava para ligar de novo. Na nossa, ao encerrar, o ramal é desconectado de vez: a tela fica inerte e só volta a funcionar recarregando. Fecha o risco identificado no teste.
- **Comportamento de "laboratório".** A original se identifica como build de teste ("VM WebPhone Lab"). A nossa foi feita com esses cuidados desde o início.

### Continua igual nos dois (não corrigimos)

- **A senha do ramal chega ao navegador na hora de ligar.** Vale para as duas: ambas precisam entregar a senha ao navegador para a ligação sair, e uma pessoa técnica consegue capturá-la. Só dá para eliminar com um servidor de voz no meio. O token controla quem recebe a senha, mas não impede que o navegador a receba.
- **QR fixo e público não força reler.** Reabrir o link pelo histórico do app é idêntico a escanear de novo; o servidor não distingue. É limite da tecnologia.
- **Número aparece como "Spam"** no celular de quem recebe. É reputação do número na operadora, não muda pelo lado do discador.

### Observação sobre onde a senha é guardada

Nem a original nem a nossa deixam a senha escrita no código/página — as duas guardam no servidor e buscam por token. (A versão de teste local inicial tinha a senha no arquivo, mas era só protótipo; a versão publicada não tem.)

## 5. Conclusão

Nossa aplicação está à frente da original em comportamento, controle e higiene de sessão — com destaque para a desconexão do ramal ao encerrar, que resolve o problema real do uso por app de QR. Em identidade, discagem e feedback ao usuário, também evoluiu.

O único ponto de segurança sério que permanece (a senha chegar ao navegador) é estrutural da telefonia pelo navegador e igual nas duas. Para um uso público de verdade, a solução é o servidor de voz no meio, idealmente oferecido pela própria Método/VoiceManager.
