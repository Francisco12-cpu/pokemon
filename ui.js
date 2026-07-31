/* ==========================================================================
   UI.JS
   Tudo relacionado a TELA: trocar de tela, desenhar a grade de Pokémon,
   atualizar a barra de vida, mostrar toasts/diálogos, sons, QR code e os
   handlers de clique. Não decide regras de batalha — só mostra o que
   battle-engine.js calculou.
   ========================================================================== */

// ---------- utilidades ----------
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

/** Substitui alert(): mostra um toast não-bloqueante no rodapé do app.
 *  isError=true deixa a borda vermelha (falhas de rede, validação etc.). */
function toast(message, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) { console.log(message); return; }
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- indicador offline ----------
// A batalha local (solo/duo no mesmo aparelho) funciona 100% sem internet.
// Só "BUSCAR POKÉMON" (PokeAPI) e "ONLINE" (sinalização entre aparelhos)
// precisam de rede — por isso avisamos e desabilitamos só esses botões.
function updateOnlineStatusUI() {
  const online = navigator.onLine;
  document.getElementById('offline-banner')?.classList.toggle('show', !online);
  const searchBtn = document.getElementById('btn-search-new');
  const onlineBtn = document.getElementById('btn-online');
  if (searchBtn) searchBtn.disabled = !online;
  if (onlineBtn) onlineBtn.disabled = !online;
}
window.addEventListener('online', updateOnlineStatusUI);
window.addEventListener('offline', updateOnlineStatusUI);

// ---------- telas ----------
const screens = {}; ['intro','mode','select','search','online','battle','victory','defeat'].forEach(id => { screens[id] = document.getElementById(`screen-${id}`); });
function showScreen(id) { Object.values(screens).forEach(s => s?.classList.remove('active')); screens[id]?.classList.add('active'); }
const uiState = { mode:null, playerParty:[], playerParty1:null, awaitingSecondTeam:false, roster:[], selectedForTeam:[], playerAction:null, opponentAction:null, currentPlayer:1, searchResult:null, searchMoves:[], selectedSearchMoves:[], audioCtx:null, myTeamSent:false, peerTeam:null };
function playSound(f=400,d=0.1) { try { if (!uiState.audioCtx) uiState.audioCtx = new (window.AudioContext||window.webkitAudioContext)(); const o = uiState.audioCtx.createOscillator(), g = uiState.audioCtx.createGain(); o.connect(g); g.connect(uiState.audioCtx.destination); g.gain.value = 0.08; o.frequency.value = f; o.type = 'square'; o.start(); o.stop(uiState.audioCtx.currentTime+d); } catch(e) {} }

document.getElementById('btn-start').addEventListener('click', () => showScreen('mode'));
document.getElementById('btn-back-mode').addEventListener('click', () => showScreen('intro'));
document.getElementById('btn-single').addEventListener('click', () => { uiState.mode='single'; goSelect(); });
document.getElementById('btn-duo').addEventListener('click', () => { uiState.mode='duo'; goSelect(); });
document.getElementById('btn-online').addEventListener('click', () => {
  if (!navigator.onLine) { toast('O modo online precisa de internet (ao menos para o primeiro contato).', true); return; }
  showScreen('online');
});

function goSelect() { uiState.roster = getFullRoster(); uiState.selectedForTeam = []; renderRoster(); showScreen('select'); document.getElementById('team-count').textContent = '0/6 selecionados'; }
function renderRoster() {
  const grid = document.getElementById('roster-grid'); if (!grid) return; grid.innerHTML = '';
  uiState.roster.forEach((mon, i) => {
    const card = document.createElement('div'); card.className = 'pokemon-card';
    if (uiState.selectedForTeam.includes(i)) card.classList.add('selected');
    // Dados de mon.name/types podem ter vindo da PokeAPI (busca) — nunca
    // confiar neles em innerHTML sem escapar.
    card.innerHTML = `<img src="${escapeHtml(mon.sprite)}" alt="${escapeHtml(mon.name)}" loading="lazy"><span>${escapeHtml(mon.name)}</span><small>${escapeHtml(mon.types.join('/'))}</small>`;
    card.addEventListener('click', () => {
      const idx = uiState.selectedForTeam.indexOf(i);
      if (idx > -1) uiState.selectedForTeam.splice(idx, 1);
      else if (uiState.selectedForTeam.length < 6) uiState.selectedForTeam.push(i);
      else { playSound(200,0.2); return; }
      playSound(600,0.05);
      document.getElementById('team-count').textContent = `${uiState.selectedForTeam.length}/6 selecionados`;
      renderRoster();
    });
    grid.appendChild(card);
  });
}

document.getElementById('btn-start-battle').addEventListener('click', () => {
  // BUG CORRIGIDO (grave): o app original reaproveitava este mesmo botão pra
  // "CONFIRMAR TIME JOGADOR 2" atribuindo um handler extra via btn.onclick,
  // mas o addEventListener original CONTINUAVA ativo. Os dois disparavam no
  // mesmo clique e acabavam misturando o time do Jogador 1 com o do Jogador
  // 2 (os dois viravam o mesmo Pokémon!). Agora existe um único handler que
  // decide o que fazer com base em uiState.awaitingSecondTeam.
  if (uiState.awaitingSecondTeam) { confirmSecondTeam(); return; }
  if (uiState.selectedForTeam.length === 0) return;
  uiState.playerParty = uiState.selectedForTeam.map(i => ({...uiState.roster[i]}));
  // BUG CORRIGIDO: no arquivo original, battleState.playerParty só era
  // preenchido no fluxo de confirmação do Jogador 2 (modo duo). No modo
  // solo (o mais comum!) a batalha começava com o time do jogador vazio —
  // por isso currentPlayerMon() vinha undefined, sem HP e sem golpes.
  battleState.playerParty = uiState.playerParty;
  if (uiState.mode === 'single') {
    const rest = uiState.roster.filter((_,i) => !uiState.selectedForTeam.includes(i));
    if (rest.length === 0) { toast('Adicione mais Pokémon ao roster!', true); return; }
    battleState.rivalParty = rest.sort(()=>Math.random()-0.5).slice(0, Math.min(3, rest.length)).map(m => ({...m}));
  } else if (uiState.mode === 'duo') { battleState.rivalParty = []; }
  battleState.playerActiveIndex = 0; battleState.rivalActiveIndex = 0;
  battleState.battleOver = false; battleState.winner = null;
  uiState.playerAction = null; uiState.currentPlayer = 1;
  if (uiState.mode === 'duo') { document.getElementById('duo-ready-overlay').classList.remove('hidden'); showScreen('battle'); renderBattleField(); disableControls(); }
  else if (uiState.mode === 'online') {
    // Corrigido: o app original nunca preenchia battleState.rivalParty no modo
    // online — cada aparelho precisa enviar o próprio time pelo canal WebRTC e
    // esperar o time do outro antes de começar a batalha.
    document.getElementById('btn-start-battle').disabled = true;
    toast('Time enviado! Esperando o outro jogador...');
    uiState.myTeamSent = true;
    sendAction({ type:'team', party: uiState.playerParty });
    tryStartOnlineBattle();
  }
  else { showScreen('battle'); if (uiState.mode === 'single') battleState.rivalActiveIndex = 0; setupTurn(); renderBattleField(); }
});

function tryStartOnlineBattle() {
  if (!uiState.myTeamSent || !uiState.peerTeam) return;
  battleState.playerParty = uiState.playerParty;
  battleState.rivalParty = uiState.peerTeam;
  battleState.playerActiveIndex = 0; battleState.rivalActiveIndex = 0;
  battleState.battleOver = false; battleState.winner = null;
  document.getElementById('btn-start-battle').disabled = false;
  showScreen('battle'); renderBattleField(); setupTurn();
}

function confirmSecondTeam() {
  if (uiState.selectedForTeam.length === 0) return;
  battleState.rivalParty = uiState.selectedForTeam.map(i => ({...uiState.roster[i]}));
  const btn = document.getElementById('btn-start-battle');
  btn.textContent = 'INICIAR BATALHA';
  uiState.awaitingSecondTeam = false;
  showScreen('battle');
  battleState.playerParty = uiState.playerParty1;
  renderBattleField(); enableControls(1);
}

document.getElementById('duo-ready-btn').addEventListener('click', () => {
  document.getElementById('duo-ready-overlay').classList.add('hidden');
  toast('Jogador 2, selecione seu time.');
  // Guarda o time do Jogador 1 num campo separado antes de zerar
  // uiState.playerParty pra montar o do Jogador 2 (evita a troca acidental
  // de referência que causava o bug acima).
  uiState.playerParty1 = uiState.playerParty;
  uiState.playerParty = []; uiState.selectedForTeam = []; renderRoster(); showScreen('select');
  uiState.awaitingSecondTeam = true;
  document.getElementById('btn-start-battle').textContent = 'CONFIRMAR TIME JOGADOR 2';
});

document.getElementById('btn-search-new').addEventListener('click', () => showScreen('search'));
document.getElementById('btn-back-select').addEventListener('click', () => showScreen('mode'));
document.getElementById('btn-back-from-search').addEventListener('click', () => showScreen('select'));

document.getElementById('search-input-btn').addEventListener('click', async () => {
  const q = document.getElementById('search-input').value.trim(); if (!q) return;
  if (!navigator.onLine) { toast('Buscar Pokémon precisa de internet.', true); return; }
  const btn = document.getElementById('search-input-btn'); btn.disabled = true; btn.textContent = 'Carregando...';
  try {
    const data = await fetchPokemonRaw(q);
    if (!data) { toast('Pokémon não encontrado.', true); btn.disabled = false; btn.textContent = 'Buscar'; return; }
    uiState.searchResult = data; uiState.selectedSearchMoves = [];
    document.getElementById('search-result-container').innerHTML = `<img src="${escapeHtml(data.sprites.front_default)}" alt="${escapeHtml(data.name)}"><h3>${escapeHtml(data.name.toUpperCase())}</h3>`;
    document.getElementById('move-filter-wrap').style.display = 'flex';
    const moves = await fetchMovesForPokemon(data); uiState.searchMoves = moves; renderSearchMoves();
  } catch(e) { toast('Erro de conexão. Verifique sua internet e tente de novo.', true); }
  btn.disabled = false; btn.textContent = 'Buscar';
});

document.getElementById('search-type-filter').addEventListener('change', renderSearchMoves);
function renderSearchMoves() {
  const grid = document.getElementById('search-moves-grid'); if (!grid) return;
  const filter = document.getElementById('search-type-filter').value;
  const moves = filter ? uiState.searchMoves.filter(m => m.type === filter) : uiState.searchMoves;
  grid.innerHTML = '';
  moves.forEach(m => {
    const chip = document.createElement('span'); chip.className = 'move-chip';
    if (uiState.selectedSearchMoves.find(s => s.name === m.name)) chip.classList.add('selected');
    chip.textContent = m.name.replace(/-/g,' ');
    chip.addEventListener('click', () => {
      const idx = uiState.selectedSearchMoves.findIndex(s => s.name === m.name);
      if (idx > -1) uiState.selectedSearchMoves.splice(idx, 1);
      else if (uiState.selectedSearchMoves.length < 4) uiState.selectedSearchMoves.push(m);
      else { playSound(200,0.2); return; }
      playSound(600,0.05); renderSearchMoves();
    });
    grid.appendChild(chip);
  });
}

document.getElementById('btn-save-pokemon').addEventListener('click', async () => {
  if (!uiState.searchResult || uiState.selectedSearchMoves.length===0) return;
  const mon = normalizeChosenPokemon(uiState.searchResult, uiState.selectedSearchMoves);
  saveToLocalDex(mon); toast(`${mon.name} salvo na Pokédex!`); showScreen('select');
  uiState.roster = getFullRoster(); renderRoster();
});

document.getElementById('btn-back-online').addEventListener('click', () => showScreen('mode'));
document.getElementById('btn-create-room').addEventListener('click', async () => {
  try {
    const code = await createRoom();
    document.getElementById('room-qr-display').style.display = 'flex';
    document.getElementById('qr-label').textContent = 'Mostre este QR ao oponente';
    QRCode.toCanvas(document.getElementById('qr-canvas'), code, { width:180 });
    onConnectionState(state => { if (state === 'open') { toast('Oponente conectado!'); uiState.mode = 'online'; goSelect(); } });
  } catch(e) { toast('Erro ao criar sala. O modo online exige HTTPS (ou localhost).', true); }
});
document.getElementById('btn-join-room').addEventListener('click', () => { document.getElementById('qr-scanner-wrap').style.display = 'flex'; startQRScanner(); });
document.getElementById('btn-qr-done').addEventListener('click', () => { document.getElementById('room-qr-display').style.display = 'none'; });
document.getElementById('btn-cancel-scan').addEventListener('click', () => { stopQRScanner(); document.getElementById('qr-scanner-wrap').style.display = 'none'; });
let scannerInterval = null;
function startQRScanner() {
  const video = document.getElementById('qr-scanner-video');
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
    video.srcObject = stream; video.play();
    const canvas = document.getElementById('qr-scanner-canvas'), ctx = canvas.getContext('2d');
    scannerInterval = setInterval(() => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height);
        if (code) {
          stopQRScanner(); document.getElementById('qr-scanner-wrap').style.display = 'none';
          // Corrigido: sem .catch() aqui, um QR inválido/corrompido derrubava
          // a promise sem nenhum aviso pro usuário.
          joinRoom(code.data).then(answerCode => {
            document.getElementById('room-qr-display').style.display = 'flex';
            document.getElementById('qr-label').textContent = 'Mostre este QR de volta';
            QRCode.toCanvas(document.getElementById('qr-canvas'), answerCode, { width:180 });
            onConnectionState(state => { if (state === 'open') { toast('Conectado!'); uiState.mode = 'online'; goSelect(); } });
          }).catch(() => toast('QR code inválido ou sala expirada. Peça um novo.', true));
        }
      }
    }, 500);
  }).catch(() => toast('Permita o acesso à câmera para escanear o QR code.', true));
}
function stopQRScanner() { if (scannerInterval) { clearInterval(scannerInterval); scannerInterval = null; } const video = document.getElementById('qr-scanner-video'); if (video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; } }

// ---------- tela de batalha ----------
function renderBattleField() {
  const pm = currentPlayerMon();
  if (pm) updateMonDisplay('player', pm);
  const rm = currentRivalMon();
  if (rm) updateMonDisplay('rival', rm);
  updateMoveButtons();
}

function updateMonDisplay(side, mon) {
  const el = document.getElementById(`${side}-mon`);
  if (!el) return;
  // Corrigido: antes o lado "rival" nunca atualizava nome/sprite do Pokémon
  // ativo (ficava travado no texto fixo "Rival" e numa imagem de placeholder
  // que apontava pra um arquivo — ./rival.png — que nem existe no projeto).
  // Agora os dois lados mostram o Pokémon realmente ativo.
  const sprite = el.querySelector('.sprite');
  if (sprite && mon.sprite) sprite.src = mon.sprite;
  const nameEl = el.querySelector('.name');
  if (nameEl) nameEl.textContent = mon.name || '';
  const pct = mon.maxHp ? (mon.currentHp/mon.maxHp)*100 : 0;
  const fill = el.querySelector('.hp-fill');
  fill.style.width = pct+'%';
  if (pct < 25) fill.classList.add('low'); else fill.classList.remove('low');
  el.querySelector('.hp-text').textContent = `${mon.currentHp||0}/${mon.maxHp||0}`;
  el.querySelector('.status').textContent = mon.status || '';
}

// No modo duo os dois jogadores humanos se revezam no MESMO celular. Battle-
// State sempre trata um lado como "player" e o outro como "rival" (papéis
// fixos), mas quem está com a vez de escolher muda. Esta função resolve
// "de quem são os golpes que devo mostrar agora" corretamente.
function activeSideForTurn() { return (uiState.mode === 'duo' && uiState.currentPlayer === 2) ? 'rival' : 'player'; }
function activeMonForTurn() { return activeSideForTurn() === 'rival' ? currentRivalMon() : currentPlayerMon(); }
function targetMonForTurn() { return activeSideForTurn() === 'rival' ? currentPlayerMon() : currentRivalMon(); }

function updateMoveButtons() {
  // BUG CORRIGIDO: antes os botões sempre mostravam os golpes de
  // currentPlayerMon(), então no modo duo o Jogador 2 via (e usava!) os
  // golpes do Pokémon do Jogador 1 na vez dele.
  const mon = activeMonForTurn();
  const target = targetMonForTurn();
  document.querySelectorAll('.move-btn').forEach((btn,i) => {
    const move = mon?.moves[i];
    if (!move) { btn.innerHTML = '---'; return; }
    // NOVO: preview de dano estimado (% do HP do oponente) em cada golpe —
    // já que o motor real de cálculo está disponível, custa pouco mostrar.
    let dmgLabel = '';
    if (target && move.power > 0) {
      const est = estimateDamage(mon, target, move);
      const pct = target.maxHp ? Math.min(100, Math.round((est / target.maxHp) * 100)) : 0;
      dmgLabel = `<span class="move-dmg">~${pct}% HP</span>`;
    }
    btn.innerHTML = `${escapeHtml(move.name.replace(/-/g,' ').toUpperCase())}${dmgLabel}`;
  });
}
function enableControls(p=1) { document.querySelectorAll('.move-btn').forEach(b => b.disabled = false); document.getElementById('btn-switch').disabled = false; document.getElementById('player-label').textContent = uiState.mode==='duo' ? `Jogador ${p}` : ''; updateMoveButtons(); }
function disableControls() { document.querySelectorAll('.move-btn').forEach(b => b.disabled = true); document.getElementById('btn-switch').disabled = true; }
document.querySelectorAll('.move-btn').forEach((btn,i) => { btn.addEventListener('click', () => { const mon = activeMonForTurn(); if (!mon?.moves[i]) return; onPlayerAction({ type:'move', move:mon.moves[i] }); }); });
document.getElementById('btn-switch').addEventListener('click', () => {
  const menu = document.getElementById('switch-menu'); menu.innerHTML = '';
  // BUG CORRIGIDO: a lista de troca também sempre mostrava o time do
  // "player", nunca o do Jogador 2 (rivalParty) quando era a vez dele.
  const side = activeSideForTurn();
  const party = side === 'rival' ? battleState.rivalParty : battleState.playerParty;
  const activeIdx = side === 'rival' ? battleState.rivalActiveIndex : battleState.playerActiveIndex;
  party.forEach((m,i) => {
    if (i===activeIdx || m.currentHp<=0) return;
    const b = document.createElement('button'); b.className = 'switch-option';
    b.innerHTML = `<img src="${escapeHtml(m.sprite)}" width="32"> ${escapeHtml(m.name)} (${m.currentHp}/${m.maxHp})`;
    b.addEventListener('click', () => { menu.classList.add('hidden'); onPlayerAction({ type:'switch', index:i }); });
    menu.appendChild(b);
  });
  menu.classList.remove('hidden');
});
function setupTurn() { if (uiState.mode==='single') enableControls(1); else if (uiState.mode==='duo') enableControls(uiState.currentPlayer); else updateMoveButtons(); }
// getRivalAction agora mora em battle-engine.js (usa o motor real pra escolher
// o golpe de maior dano esperado, não só o maior "power" bruto).
async function onPlayerAction(action) {
  if (battleState.battleOver) return;
  if (uiState.mode==='online') { uiState.playerAction = action; sendAction(action); disableControls(); return; }
  let pAct=action, rAct;
  if (uiState.mode==='single') rAct = getRivalAction();
  else if (uiState.mode==='duo') { if (uiState.currentPlayer===1) { uiState.playerAction=action; playPassTurn(2); return; } else { pAct=uiState.playerAction; rAct=action; uiState.playerAction=null; } }
  await executeTurn(pAct, rAct);
}
async function executeTurn(pAct, rAct) {
  disableControls();
  const result = await resolveTurn(pAct, rAct);
  document.getElementById('battle-log').innerHTML = result.log.map(m => `<p>${escapeHtml(m)}</p>`).join('');
  renderBattleField();
  if (result.battleOver) { showScreen(result.winner==='player'?'victory':'defeat'); return; }
  // BUG CORRIGIDO: só o lado "player" recebia a tela de troca ao desmaiar; no
  // modo duo o Jogador 2 (rivalParty) tinha o próximo Pokémon escolhido
  // automaticamente, sem chance de decidir. getFaintPendingSide() (de
  // battle-engine.js) diz qual lado está esperando uma escolha manual agora.
  if (getFaintPendingSide()) { showSwitchForFaint(); }
  else if (uiState.mode==='duo') { uiState.currentPlayer=1; playPassTurn(1); }
  else { setupTurn(); }
}
function showSwitchForFaint() {
  const menu = document.getElementById('switch-menu'); menu.innerHTML = '';
  const side = getFaintPendingSide();
  const party = side === 'rival' ? battleState.rivalParty : battleState.playerParty;
  const activeIdx = side === 'rival' ? battleState.rivalActiveIndex : battleState.playerActiveIndex;
  party.forEach((m,i) => {
    if (i===activeIdx || m.currentHp<=0) return;
    const b = document.createElement('button'); b.className = 'switch-option';
    b.innerHTML = `${escapeHtml(m.name)} (${m.currentHp}/${m.maxHp})`;
    b.addEventListener('click', () => {
      menu.classList.add('hidden'); setPlayerFaintChoice(i); renderBattleField();
      if (uiState.mode==='duo') { uiState.currentPlayer = 1; playPassTurn(1); }
      else setupTurn();
    });
    menu.appendChild(b);
  });
  menu.classList.remove('hidden');
}
function playPassTurn(next) {
  const overlay = document.getElementById('pass-turn-overlay'); overlay.classList.remove('hidden');
  overlay.querySelector('.message').textContent = `Passe o celular para o Jogador ${next}`;
  overlay.querySelector('.ready-btn').onclick = () => { overlay.classList.add('hidden'); uiState.currentPlayer = next; if (next===2) { enableControls(2); } else { enableControls(1); uiState.playerAction = null; } };
  disableControls();
}
onReceiveAction((action) => {
  if (uiState.mode!=='online') return;
  if (action.type === 'team') { uiState.peerTeam = action.party; tryStartOnlineBattle(); return; }
  if (battleState.battleOver) return;
  if (uiState.playerAction) { const p=uiState.playerAction; uiState.playerAction=null; executeTurn(p,action); } else { uiState.opponentAction=action; enableControls(1); }
});
['btn-play-again','btn-play-again-defeat'].forEach(id => { document.getElementById(id)?.addEventListener('click', () => { battleState.playerParty=[]; battleState.rivalParty=[]; battleState.battleOver=false; battleState.winner=null; showScreen('mode'); }); });
