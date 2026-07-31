# Desafio de Aniversário — Pokémon Battle PWA

Minijogo de batalha estilo Pokémon com motor de cálculo de dano **real**
(o mesmo do [Damage Calculator do Smogon/Pokémon Showdown](https://calc.pokemonshowdown.com/)),
jogável offline, sozinho ou com amigos.

## Como rodar

O jogo **precisa ser servido por um servidor HTTP** (não abrir o `index.html`
direto no navegador com duplo-clique). Isso é uma exigência dos navegadores
para dois recursos que você pediu: funcionamento offline via Service Worker e
acesso à câmera (para o modo online). Em `file://` essas duas coisas ficam
bloqueadas pelo navegador — o resto do jogo até funcionaria, mas sem elas.

Formas simples de servir localmente:

```bash
# Python (já vem em quase todo sistema)
cd pasta-do-jogo
python3 -m http.server 8080
# depois abra http://localhost:8080 no celular/computador

# ou Node
npx serve .
```

Para instalar como app de verdade no celular e usar offline de qualquer
lugar, hospede a pasta em algo com HTTPS grátis — **GitHub Pages**, **Netlify**
ou **Vercel** funcionam bem (é só arrastar a pasta ou conectar o repositório).
Depois de abrir uma vez com internet, o Service Worker guarda tudo no
aparelho e o jogo abre offline nas próximas vezes.

## Estrutura do projeto

```
index.html              shell da página (telas, sem lógica)
style.css                estilos
manifest.json             metadados do PWA (nome, ícone, cores)
sw.js                     service worker (cache offline)
lib/smogon-calc-engine.js  motor real de cálculo de dano (@smogon/calc, vendorizado)
js/pokemon-data.js         roster inicial + integração com a PokeAPI (busca/pokédex local)
js/battle-engine.js        regras de batalha (turnos, dano, status, P2P/WebRTC)
js/ui.js                   telas, DOM, handlers de clique
js/main.js                 ponto de entrada
assets/icons/              ícones do PWA (placeholders — troque pelos seus)
```

## O bug principal que você reportou (botão "JOGAR" não fazia nada)

O `smogon-calc.js` enviado não era compatível com o `import` usado no
`index.html`: ele não tinha nenhum `export` (era um bundle que só expõe
`window.calc`) e também não continha os dados de espécies/golpes
(`Generations`) — só a lógica de cálculo. Isso fazia o `<script type="module">`
inteiro falhar ao carregar, e **nenhum botão da página tinha seu clique
registrado**, incluindo o "JOGAR".

Resolvi baixando o pacote oficial `@smogon/calc` (v0.11.0) do npm e gerando,
com esbuild, um bundle único e realmente autocontido (sem `import`/`require`
nenhum) — é o que está em `lib/smogon-calc-engine.js`. Validei as 45 espécies
e os 84 golpes do seu roster original contra os dados reais: todos existem e
funcionam.

## Bugs corrigidos (todos os que encontrei)

**Críticos (impediam a batalha de funcionar):**

* Import quebrado do motor de cálculo → nada na página funcionava.
* `battleState.playerParty` nunca era preenchido no modo solo → a batalha
começava com o Pokémon do jogador vazio (sem HP, sem golpes).
* O botão "CONFIRMAR TIME JOGADOR 2" reaproveitava o mesmo botão de "iniciar
batalha" com um handler extra (`.onclick`) **sem remover o handler
original** — os dois disparavam juntos e misturavam os times dos dois
jogadores (os dois acabavam com o mesmo Pokémon).
* No modo duo, os botões de golpe sempre mostravam (e usavam!) os golpes do
Pokémon do Jogador 1, mesmo na vez do Jogador 2.
* No modo duo, só o Jogador 1 tinha a opção de escolher pra qual Pokémon
trocar ao desmaiar — o Jogador 2 tinha o próximo escolhido automaticamente.
* No modo online, o time do adversário nunca era definido — a batalha
começava com o time rival vazio. Implementei a troca de times pelo canal
WebRTC antes da batalha liberar.

**Outros bugs (menores, mas reais):**

* Bloco de código morto que tentava re-verificar desmaios de forma
assíncrona sem `await`, podia perder mensagens de log silenciosamente.
* `Array.sort` com resultado aleatório dentro do comparador (viola o
contrato do `sort`, "funciona por sorte").
* Reconstrução duplicada dos objetos de cálculo (uma vez no sort, outra na
execução) — não quebrava nada, mas desperdiçava trabalho.
* `joinRoom()` sem `.catch()` — um QR code inválido travava o fluxo sem
avisar o usuário.
* Nome e sprite do Pokémon rival nunca eram atualizados na tela de batalha
(ficava travado no texto fixo "Rival" e numa imagem `./rival.png` que nem
existia no projeto).
* `innerHTML` recebendo dados vindos da PokeAPI sem escapar (baixo risco,
mas é boa prática corrigir).
* Cache local (`localStorage`) sem controle de versão — uma mudança futura
no formato dos dados salvos poderia quebrar o jogo silenciosamente.
* Query de busca não usava `encodeURIComponent`.

## O que mudei/adicionei além dos bugs

* **Preview de dano**: cada botão de golpe mostra a % estimada de HP que ele
tira do oponente, calculada pelo motor real.
* **IA melhor**: o oponente (modo 1 jogador) agora escolhe o golpe com maior
dano esperado real (via `calculate()`), não só o de maior "power" bruto.
* **Offline de verdade**: `sw.js` guarda todos os arquivos do jogo, fontes,
sprites já usadas e as bibliotecas do modo online no primeiro acesso.
* **Indicador de offline**: um aviso discreto aparece quando não há internet,
e os botões que exigem rede (buscar Pokémon, modo online) ficam
desabilitados nesse momento — o resto do jogo continua funcionando normal.
* **Toasts em vez de `alert()`**: menos intrusivo, combina mais com um app
instalado. `alert()` trava a interface inteira até ser fechado manualmente,
o que é uma péssima experiência numa PWA "standalone".
* **Splash de carregamento** com detecção de erro visível (se o motor de
cálculo não carregar por algum motivo, agora você vê uma mensagem, em vez
da tela simplesmente não reagir a nada).
* Ícones de app placeholder (192px/512px) — troque pelos seus em
`assets/icons/` quando tiver uma arte definitiva.

## Limitações conhecidas (não implementei — ficam como sugestão)

* **Golpes de cura/proteção não têm efeito ainda** (Roost, Synthesis,
Protect, Detect, Wish etc. aparecem como opção mas hoje só "erram o
alvo" sem fazer nada — o app original também não tinha isso implementado).
Uma tabela pequena de efeitos por golpe resolveria, similar à que já existe
para status (`knownStatusMoves` em `battle-engine.js`).
* **Modo online e consistência de dano**: hoje cada celular calcula o dano
de cada turno de forma independente (cada um "rola seus próprios dados").
Como isso envolve números aleatórios, em tese os dois aparelhos podem
computar um resultado levemente diferente pro mesmo turno. Pra eliminar
esse risco 100%, o ideal é que só um dos dois lados calcule o resultado
de cada turno e envie o resultado já pronto pro outro (em vez de cada um
calcular por conta própria) — não implementei isso agora pra não aumentar
ainda mais o escopo, mas é a próxima melhoria mais importante se o modo
online for usado bastante.
* **Sem escolha de habilidade/item/natureza/EVs** — o motor já suportaria
isso (é para isso que ele serve!), mas a interface não expõe essa escolha
ainda. Hoje todo Pokémon usa natureza neutra, EVs zerados e a primeira
habilidade da espécie.
* Rede local sem internet nenhuma (hotspot sem dados): o WebRTC tenta
candidatos locais automaticamente e pode funcionar, mas o STUN configurado
é o do Google (precisa de internet pra essa etapa inicial de handshake).
Pra funcionar 100% sem nenhuma internet, seria preciso um STUN/TURN local
ou trocar o offer/answer por outro meio que não dependa de rede nenhuma
nesse primeiro passo (o QR code em si não depende, só o ICE gathering).

## Testes que fiz

Simulei o app inteiro num navegador headless (jsdom) servido por HTTP local
e rodei, de ponta a ponta: carregamento do motor de cálculo, seleção de
time, uma batalha solo completa até derrota, uma batalha em duo completa até
vitória (com verificação de que cada jogador via e usava os próprios
golpes), sincronização de times no modo online, e busca/salvamento de um
Pokémon novo via PokeAPI (com rede simulada). Todos os fluxos funcionaram
como esperado.

