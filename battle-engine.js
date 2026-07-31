/* ==========================================================================
   BATTLE-ENGINE.JS
   Regras do jogo: turnos, trocas, desmaios, efeitos secundários (status/boosts)
   e comunicação P2P (WebRTC) para o modo online. Não mexe em DOM — quem
   desenha a tela é o ui.js.

   Depende de: pokemon-data.js (GEN, Pokemon, Move, calculate, LEVEL, IVS, EVS).
   ========================================================================== */

const battleState = {
  playerParty: [], rivalParty: [],
  playerActiveIndex: 0, rivalActiveIndex: 0,
  battleOver: false, winner: null
};
function currentPlayerMon() { return battleState.playerParty[battleState.playerActiveIndex]; }
function currentRivalMon() { return battleState.rivalParty[battleState.rivalActiveIndex]; }

function toCalcPokemon(mon) {
  return new Pokemon(GEN, mon.name, {
    level: LEVEL, ivs: IVS, evs: EVS, nature: 'Serious',
    curHP: mon.currentHp, status: mon.status || '',
    boosts: {
      atk: mon.boosts?.atk ?? 0, def: mon.boosts?.def ?? 0,
      spa: mon.boosts?.spa ?? 0, spd: mon.boosts?.spd ?? 0, spe: mon.boosts?.spe ?? 0
    }
  });
}
function toCalcMove(move) { return new Move(GEN, move.name); }

/** Dano esperado (média da faixa de dano) de `move` de `attackerMon` contra
 *  `defenderMon`, usando o motor real do Smogon Calc. Usado pela IA e pelo
 *  preview de dano na tela de batalha. Retorna 0 para golpes de status. */
function estimateDamage(attackerMon, defenderMon, move) {
  try {
    const atker = toCalcPokemon(attackerMon);
    const defer = toCalcPokemon(defenderMon);
    const calcMove = toCalcMove(move);
    if (!calcMove.bp) return 0;
    const result = calculate(GEN, atker, defer, calcMove);
    const dmg = Array.isArray(result.damage) ? result.damage : [result.damage];
    return dmg.reduce((s, d) => s + d, 0) / dmg.length;
  } catch (e) { return 0; }
}

const knownStatusMoves = {
  'thunder-wave': { ailment:'par', chance:90 }, 'will-o-wisp': { ailment:'brn', chance:85 },
  'toxic': { ailment:'psn', chance:90 }, 'spore': { ailment:'slp', chance:100 },
  'hypnosis': { ailment:'slp', chance:60 }, 'sing': { ailment:'slp', chance:55 },
  'ice-beam': { ailment:'frz', chance:10 }, 'blizzard': { ailment:'frz', chance:10 },
  'body-slam': { ailment:'par', chance:30 }, 'thunder': { ailment:'par', chance:30 },
  'flamethrower': { ailment:'brn', chance:10 }, 'scald': { ailment:'brn', chance:30 },
  'lava-plume': { ailment:'brn', chance:30 }, 'sludge-bomb': { ailment:'psn', chance:30 },
  'discharge': { ailment:'par', chance:30 }, 'ice-punch': { ailment:'frz', chance:10 }
};

function applyMoveSecondaryEffects(attacker, defender, move, log) {
  if (move.ailment && move.ailmentChance && Math.random()*100 < move.ailmentChance && !defender.status) {
    const map = { paralysis:'par', burn:'brn', poison:'psn', sleep:'slp', freeze:'frz' };
    defender.status = map[move.ailment] || '';
    log.push(`${defender.name} ficou ${defender.status}!`);
  }
  if (move.statChanges) {
    move.statChanges.forEach(ch => {
      if (!defender.boosts) defender.boosts = { atk:0, def:0, spa:0, spd:0, spe:0 };
      defender.boosts[ch.stat] = Math.min(6, Math.max(-6, (defender.boosts[ch.stat]||0) + ch.change));
    });
  }
  const fb = knownStatusMoves[move.name];
  if (fb && !defender.status && Math.random()*100 < fb.chance) {
    defender.status = fb.ailment;
    log.push(`${defender.name} ficou ${fb.ailment}!`);
  }
}

function processSwitch(side, index) {
  const party = side === 'player' ? battleState.playerParty : battleState.rivalParty;
  const field = side === 'player' ? 'playerActiveIndex' : 'rivalActiveIndex';
  const old = party[battleState[field]];
  if (!party[index] || party[index].currentHp <= 0) return { log: ['Troca inválida!'], ok: false };
  battleState[field] = index;
  return { log: [`${old.name}, volte!`, `Vai, ${party[index].name}!`], ok: true };
}

let faintResolve = null;
let faintPendingSide = null;
/** side: 'player' ou 'rival' — de quem é o Pokémon que desmaiou.
 *  manual: true = espera humano escolher (chamar setFaintChoice); false = IA
 *  escolhe sozinha o próximo Pokémon vivo. No modo duo os dois lados são
 *  jogadores humanos, então os dois precisam de "manual". */
async function handleFaint(side, manual) {
  const party = side === 'player' ? battleState.playerParty : battleState.rivalParty;
  const activeField = side === 'player' ? 'playerActiveIndex' : 'rivalActiveIndex';
  const activeIdx = battleState[activeField];
  const fainted = party[activeIdx];
  const aliveIdx = party.findIndex((m,i) => m.currentHp > 0 && i !== activeIdx);
  if (aliveIdx === -1) {
    battleState.battleOver = true;
    battleState.winner = side === 'player' ? 'rival' : 'player';
    return { log: [`${fainted.name} desmaiou! ${battleState.winner==='player'?'Você':'O rival'} venceu!`] };
  }
  if (manual) {
    faintPendingSide = side;
    return new Promise(resolve => {
      faintResolve = (idx) => {
        if (party[idx]?.currentHp > 0) {
          battleState[activeField] = idx;
          faintPendingSide = null;
          resolve({ log: [`${fainted.name} desmaiou!`, `Vai, ${party[idx].name}!`] });
        } else faintResolve = resolve;
      };
    });
  } else {
    battleState[activeField] = aliveIdx;
    return { log: [`${fainted.name} desmaiou!`, `O rival enviou ${party[aliveIdx].name}!`] };
  }
}
function setPlayerFaintChoice(idx) { if (faintResolve) { faintResolve(idx); faintResolve = null; } }
function getFaintPendingSide() { return faintPendingSide; }

async function resolveTurn(playerAction, rivalAction) {
  if (battleState.battleOver) return { log:['Batalha encerrada.'], battleOver:true, winner:battleState.winner };
  const log = [];
  if (playerAction.type === 'switch') log.push(...processSwitch('player', playerAction.index).log);
  if (rivalAction.type === 'switch') log.push(...processSwitch('rival', rivalAction.index).log);
  const pMove = playerAction.type==='move' ? playerAction.move : null;
  const rMove = rivalAction.type==='move' ? rivalAction.move : null;
  const willP = pMove && playerAction.type!=='switch';
  const willR = rMove && rivalAction.type!=='switch';
  const attackers = [];
  if (willP) attackers.push({ side:'player', attacker:currentPlayerMon(), defender:currentRivalMon(), move:pMove });
  if (willR) attackers.push({ side:'rival', attacker:currentRivalMon(), defender:currentPlayerMon(), move:rMove });

  // Corrigido: cada Pokémon/golpe é convertido para o formato do calculadora
  // UMA única vez (antes eram construídos de novo dentro do sort E de novo no
  // loop de execução). Também: em caso de empate de velocidade, o desempate
  // aleatório é decidido uma única vez fora do comparator do sort — um
  // comparator que retorna valores diferentes em chamadas repetidas para o
  // mesmo par é um bug sutil (viola o contrato de Array.prototype.sort).
  attackers.forEach(a => {
    a.calcAttacker = toCalcPokemon(a.attacker);
    a.calcDefender = toCalcPokemon(a.defender);
    a.calcMove = toCalcMove(a.move);
  });
  const coinFlip = Math.random() < 0.5 ? -1 : 1;
  attackers.sort((a, b) => {
    if (a.calcMove.priority !== b.calcMove.priority) return b.calcMove.priority - a.calcMove.priority;
    let sa = a.calcAttacker.stats.spe, sb = b.calcAttacker.stats.spe;
    if (a.calcAttacker.status === 'par') sa = Math.floor(sa * 0.25);
    if (b.calcAttacker.status === 'par') sb = Math.floor(sb * 0.25);
    if (sa !== sb) return sb - sa;
    return coinFlip;
  });

  for (const a of attackers) {
    if (a.defender.currentHp <= 0) continue;
    const move = a.calcMove;
    if (move.accuracy !== true && Math.random()*100 > (a.move.accuracy ?? 100)) {
      log.push(`${a.attacker.name} usou ${a.move.name}, mas errou!`);
      continue;
    }
    // Recalcula o atacante/defensor no estado atual (o HP pode ter mudado se
    // o outro lado já agiu neste turno).
    const atker = toCalcPokemon(a.attacker);
    const defer = toCalcPokemon(a.defender);
    const result = calculate(GEN, atker, defer, move);
    const dmg = Array.isArray(result.damage) ? result.damage[Math.floor(Math.random()*result.damage.length)] : result.damage;
    const faint = a.defender.currentHp - dmg <= 0;
    a.defender.currentHp = Math.max(0, a.defender.currentHp - dmg);
    log.push(`${a.attacker.name} usou ${a.move.name}! ${result.critical?'Crítico! ':''}Causou ${dmg} de dano.`);
    applyMoveSecondaryEffects(a.attacker, a.defender, a.move, log);
    if (faint) {
      log.push(`${a.defender.name} desmaiou!`);
      const faintSide = a.defender === currentPlayerMon() ? 'player' : 'rival';
      // No modo duo os dois lados são controlados por humanos (o mesmo
      // aparelho, passado de mão em mão) — os dois merecem escolher pra
      // quem trocar, em vez de só o lado "player" ter esse controle.
      const manual = faintSide === 'player' || (typeof uiState !== 'undefined' && uiState?.mode === 'duo');
      const fr = await handleFaint(faintSide, manual);
      log.push(...fr.log);
      if (battleState.battleOver) return { log, battleOver:true, winner:battleState.winner };
    }
  }
  return { log, battleOver:battleState.battleOver, winner:battleState.winner };
}

/** IA simples: escolhe o golpe com maior dano esperado real (via calculate),
 *  em vez de só olhar o "power" bruto — já considera STAB, tipo, clima etc. */
function getRivalAction() {
  const active = currentRivalMon();
  const target = currentPlayerMon();
  if (!active?.moves?.length) return { type:'switch', index:0 };
  let best = active.moves[0], bestDmg = -1;
  for (const m of active.moves) {
    const dmg = estimateDamage(active, target, m);
    if (dmg > bestDmg) { bestDmg = dmg; best = m; }
  }
  return { type:'move', move:best };
}

// ========== P2P (WEBRTC) ==========
// Sinalização manual via QR code (sem servidor): o offer/answer do WebRTC vai
// codificado em base64 dentro do próprio QR. Funciona pela internet (STUN do
// Google) e também na mesma rede local/hotspot sem internet, já que o
// navegador tenta candidatos locais (host/mDNS) antes de precisar do STUN —
// mas em redes locais mais restritas a conexão pode falhar sem um STUN/TURN
// acessível. Ver README para detalhes.
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let pc = null, dc = null, onActionCb = null, onConnectionStateCb = null;
function setupDC(ch) {
  ch.onopen = () => { console.log('Conectado'); onConnectionStateCb?.('open'); };
  ch.onclose = () => onConnectionStateCb?.('closed');
  ch.onmessage = e => { try { const a = JSON.parse(e.data); if (onActionCb) onActionCb(a); } catch(ex) {} };
}
async function waitIceGatheringComplete(peer) {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise(r => {
    const check = () => { if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', check); r(); } };
    peer.addEventListener('icegatheringstatechange', check);
  });
}
async function createRoom() {
  pc = new RTCPeerConnection(ICE_CONFIG);
  dc = pc.createDataChannel('battle'); setupDC(dc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceGatheringComplete(pc);
  return btoa(JSON.stringify(pc.localDescription));
}
async function joinRoom(code) {
  pc = new RTCPeerConnection(ICE_CONFIG);
  pc.ondatachannel = e => { dc = e.channel; setupDC(dc); };
  await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(code))));
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  await waitIceGatheringComplete(pc);
  return btoa(JSON.stringify(pc.localDescription));
}
async function completeConnection(code) { await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(code)))); }
function sendAction(a) { if (dc?.readyState==='open') dc.send(JSON.stringify(a)); }
function onReceiveAction(cb) { onActionCb = cb; }
function onConnectionState(cb) { onConnectionStateCb = cb; }
