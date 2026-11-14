# Orelhão Digital

Mapa interativo dos 6.149 orelhões (TUPs) do Brasil, com correção de posição pelo
Google Earth / Street View e edição dos dados de cada orelhão.

Feito com Next.js 14, MapLibre e Supabase (Postgres + PostGIS).

## Como rodar

```bash
npm install      # só na primeira vez
npm run dev      # abre em http://localhost:3000
```

As chaves do Supabase ficam em `.env.local`, que **não vai para o GitHub**. Num computador
novo: copie `.env.example` para `.env.local` e preencha a URL e a chave `anon` do projeto.

### Páginas

| Endereço | Para quê |
|---|---|
| `/` | Página principal, com tudo o que já foi aprovado |
| `/teste` | Ajustes novos ficam primeiro aqui (prop `novidades` em `Home`); só depois de aprovados vão para a principal |

O layout se adapta a **computador** (painel à direita), **tablet** e **celular** (painel em
gaveta que sobe de baixo, com o mapa visível em cima).

> Não rode `npm run build` com o `npm run dev` ligado: o build sobrescreve a pasta
> `.next` e o app aberto quebra. Se acontecer, pare o servidor, apague `.next` e
> rode `npm run dev` de novo.

## Estrutura

| Pasta / arquivo | O que tem |
|---|---|
| `components/Home.jsx` | Tela principal: painel, filtros, ficha do orelhão e edição (`app/page.jsx` só a carrega) |
| `components/Fotos.jsx` | Fotos do local: envio, miniaturas e visualizador em tela cheia |
| `app/globals.css` | Estilos |
| `components/MapView.jsx` | Mapa (satélite Esri / escuro, clusters, logo, pino de edição) |
| `lib/supabase.js` | Leitura e gravação no banco |
| `lib/geo.js` | Regiões, nomes de UF e cálculos de distância |
| `public/` | Logo (`logo-full.png` é o original; `logo.png` e `marker.png` são derivados) |
| `extensao/` | Extensão do Chrome: mira e botão "Marcar orelhão aqui" no Google Earth e no Street View |
| `supabase/migrations/` | SQL do banco (todos já aplicados, ver abaixo) |
| `scripts/` | Conversão do KMZ e montagem inicial do banco |
| `data/` | `orelhoes.json` (importação original) e `raw/` com o KMZ e o KML de origem |
| `relatorios/` | Relatórios gerados (ex.: comparação com a Anatel) |

## Banco de dados (Supabase)

| Migration | O que faz | Aplicada? |
|---|---|---|
| `001_init.sql` | Tabela `orelhoes`, busca "perto de mim", leitura pública | ✅ |
| `002_editar_posicao.sql` | Tabela `app_config` com a senha de edição | ✅ |
| `003_editar_orelhao.sql` | Função `atualizar_orelhao` e tabela `orelhoes_historico` | ✅ (conferido em 09/10/2026) |
| `004_fotos.sql` | Fotos: bucket `fotos` no Storage, tabela `orelhoes_fotos`, envio/remoção com senha | ✅ (conferido em 05/11/2026) |
| `005_corrigir_regioes.sql` | Tocantins no Norte e Rio Grande do Norte no Nordeste | ✅ |
| `006_marcar_posicao_sem_senha.sql` | Função `marcar_posicao`: salva a posição marcada no Street View/Earth sem senha (grava histórico) | ✅ |
| `007_vista_street_view.sql` | Colunas `sv_lat`, `sv_lng`, `sv_heading`, `sv_pitch`: guarda a vista do Street View para o link abrir virado para o orelhão | ✅ |

**Senha de edição** — ver ou trocar no SQL Editor do Supabase:

```sql
select value from public.app_config where key = 'edit_password';
update public.app_config set value = 'nova_senha' where key = 'edit_password';
```

**Histórico** — toda edição salva pelo app grava os valores de antes e depois em
`orelhoes_historico` (só acessível pelo Supabase). Serve para desfazer um erro.

**Evitar a pausa do Supabase** — o plano gratuito pausa o projeto após 7 dias sem uso
(o endereço some e o app não carrega). Uma tarefa do Agendador de Tarefas do Windows,
**"Orelhao Digital - manter Supabase ativo"**, roda `scripts/manter-supabase-ativo.mjs`
todo dia às 10h (ou assim que o PC ligar, se estiver desligado nesse horário). Ele faz
uma leitura simples no banco e anota o resultado em `logs/supabase-ativo.log`.
- Conferir: abrir o log, ou rodar `node scripts/manter-supabase-ativo.mjs`.
- Só funciona com este PC ligado ao menos uma vez a cada 7 dias. Se o projeto pausar
  mesmo assim: supabase.com/dashboard → projeto → **Restore project**.
- Remover a tarefa: Agendador de Tarefas → Biblioteca → apagar a tarefa.

> ⚠ `scripts/setup-supabase.mjs` apaga a tabela e reimporta do arquivo original.
> Rodar hoje desfaria todas as correções. Só para montar um banco novo.

## Busca por município e dados da localidade

- **Busca + Enter:** digitar um município e apertar Enter leva o mapa até ele e lista só os
  orelhões de lá. Nome repetido em outro estado: acrescente a UF (`batalha pi`).
- **Ficha do orelhão → "Dados da localidade":** habitantes e domicílios do setor censitário,
  distância em linha reta até a sede municipal, habitantes do município, localidade do IBGE
  mais próxima e meio de acesso estimado (estrada / rio / pista de pouso).

Os dados ficam em arquivos estáticos, gerados uma vez:

| Arquivo | Gerado por | Fonte |
|---|---|---|
| `public/dados/localidades.json` | `scripts/gerar-dados-localidades.py` | IBGE — Censo 2022: setores censitários e Localidades do Brasil |
| `public/dados/acesso.json` | `scripts/gerar-dados-acesso.py` | OpenStreetMap (extratos da Geofabrik) |

Os scripts usam a posição atual dos orelhões no banco. Depois de muitas correções de
posição, vale rodá-los de novo (instruções e links das fontes no topo de cada script;
precisam de `pip install geopandas pyogrio`). O número de habitantes é do **setor
censitário**, que pode incluir comunidades vizinhas; o meio de acesso é uma **estimativa**
que depende de quanto o OpenStreetMap está mapeado no lugar.

## Editar um orelhão

1. Selecione o orelhão → **✏️ Editar orelhão**.
2. Posição: **🌎 Google Earth** (mais preciso) ou **🚶 Street View** → clique no botão
   redondo discreto embaixo da tela → aparece a mira → ponha a mira sobre o orelhão →
   **Marcar aqui** (Esc ou × cancela). No app aparece o cartão de confirmação:
   **✔ Salvar** grava direto no banco (sem senha), junto com a vista do Street View.
   Também dá para arrastar o pino no mapa ou digitar latitude/longitude (funciona no
   celular, onde o Chrome não aceita extensões).
3. Ajuste os campos (códigos, status, cód. TUP), digite a senha → **Salvar alterações**.

### Fotos do local

Para lugares sem Street View nem Google Earth. No modo de edição, bloco **📷 Fotos do
local** → **➕ Adicionar foto(s)** (várias de uma vez, legenda opcional; 🗑 apaga). Pede a
senha de edição. A foto é reduzida no navegador (máx. 1600 px, JPEG) antes de subir.
Com foto, o botão **Ver na rua** da ficha abre as fotos em tela cheia (com link para o
Street View mesmo assim); sem foto, abre o Street View como antes.

Os arquivos ficam no Storage do Supabase (bucket `fotos`, 1 GB no plano gratuito) e a
lista em `orelhoes_fotos`. Como o app só tem a chave pública, a senha libera uma
autorização de 10 minutos para um arquivo (detalhes no topo de `004_fotos.sql`).

### Extensão do Chrome (necessária para marcar no Earth / Street View)

- Instalar: `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem
  compactação** → pasta `extensao`.
- Depois de qualquer mudança na pasta `extensao`, clique em **↻** no cartão dela.
- Ela só conversa com o app em `http://localhost:3000`. Ao publicar o app em outro
  endereço, acrescente-o em `extensao/background.js` (`APP_URLS`) e em
  `extensao/manifest.json` (`host_permissions`).

## Decisões já tomadas (e por quê)

- **Sem APIs pagas do Google.** A chave exigia pré-pagamento de R$ 150. Street View e
  Earth são abertos por link; a extensão faz a ponte com o app.
- **Street View embutido no app não funciona** sem chave (testado: fica preto).
- **Mapillary, KartaView e Panoramax** não têm fotos perto dos orelhões (testado com
  60 orelhões sorteados: 0 a 100 m).
- **Satélite da Esri**, servido por dois domínios para não travar. O mapa está
  aprovado — mexer só se for pedido.
- **Sem "Map data not yet available".** Em área rural a Esri não tem foto nos zooms altos.
  `lib/esri.js`: ao selecionar um orelhão, o mapa para no maior zoom com foto naquele ponto
  (consulta o `tilemap` da Esri); aproximando além disso, estica a última foto disponível.
- **Só o Brasil.** O mapa não sai da área do país e o resto do continente fica escurecido
  (`public/dados/brasil-mascara.json`, contorno da API de malhas do IBGE).
- **Mapa que se recupera sozinho.** Com o Street View aberto em outra aba, o Chrome pode
  tirar a placa de vídeo da aba do mapa; o MapLibre 4 não redesenha fotos e ícones quando
  ela volta (mapa preto). O `MapView` recria o mapa no mesmo lugar quando isso acontece.
- **Anatel não publica coordenadas** dos orelhões hoje. O conjunto aberto traz
  localidade, número da linha e status. Fonte:
  https://dados.gov.br/dados/conjuntos-dados/acompanhamento-e-controle--orelhes

## Pendências / próximos passos

- **Comparação com a Anatel** (`relatorios/comparacao_anatel_2026-10-08.xlsx`):
  aguardando autorização para:
  - (a) preencher o **status** dos orelhões com o da Anatel (hoje vazio em todos);
  - (b) corrigir nomes com **"De Us"** (deveria ser "Deus") e semelhantes;
  - (c) listar para cadastro as 2.022 localidades que só existem na Anatel.
- `.env.local` tem `NEXT_PUBLIC_MAPILLARY_TOKEN`, que o app não usa. Pode apagar.
- Publicação (deploy) ainda não feita. Ao publicar, acrescentar o endereço novo na
  extensão (ver "Extensão do Chrome" acima).
