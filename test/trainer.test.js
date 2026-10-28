/* 训练家技能扩展 tests — run: node test/trainer.test.js  (from project root) */
const assert = require('assert');
const E = require('../js/engine.js');
const DB = require('../data/cards.json');
const T = require('../js/trainers.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// ---- 元数据完整性 ----
test('trainers.js exposes 5 trainers matching engine skill ids', () => {
  assert.strictEqual(T.TRAINER_DB.length, 5);
  for (const t of T.TRAINER_DB) {
    assert.ok(t.id && t.name && t.title && t.avatar && t.desc, 'trainer fields ' + t.id);
    assert.ok(E.TRAINER_SKILLS[t.id], 'engine knows skill ' + t.id);
    assert.ok(t.avatar.startsWith('assets/avatars/'), 'avatar path ' + t.id);
  }
  assert.strictEqual(T.TRAINER_BY_ID.ash, T.TRAINER_DB[0]);
  assert.ok(T.TRAINER_BY_ID.sabrina, 'sabrina registered');
});

// ---- 技能关闭时：原版行为不变 ----
test('skills off: no triple, no 4-distinct, reserve gives 1 master, no rocket bonus', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 1, trainerSkills: false, trainers: ['ash', 'rocket'] });
  assert.strictEqual(g.trainerSkillsEnabled, false);
  const p0 = g.players[0];
  const acts = E.legalActions(g);
  assert.ok(!acts.some(a => a.type === 'take' && a.colors.length === 4), 'no 4-distinct');
  assert.ok(!acts.some(a => a.type === 'take' && a.colors.length === 3 && new Set(a.colors).size === 1), 'no triple-same');
  assert.ok(E.skillOf(g, p0) === null, 'skillOf null when off');
  // 3 同色 / 4 异色均被拒
  assert.strictEqual(E.applyAction(g, { type: 'take', colors: ['red', 'red', 'red'] }).ok, false, 'triple rejected');
  assert.strictEqual(E.applyAction(g, { type: 'take', colors: ['red', 'blue', 'black', 'pink'] }).ok, false, '4-distinct rejected');
  // 保留只给 1 大师球
  const fid = g.field.stage1.find(id => id);
  assert.strictEqual(E.applyAction(g, { type: 'reserve', target: { fromField: fid } }).ok, true, 'reserve ok');
  assert.strictEqual(p0.tokens.purple, 1, 'exactly 1 master without skill');
});

// ---- 小智·精灵之心：保留额外 +1 大师球 ----
test('ash: reserve grants 2 master balls (supply permitting)', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 1, trainerSkills: true, trainers: ['ash', 'brock'] });
  const p0 = g.players[0];
  assert.strictEqual(E.skillOf(g, p0), 'ash');
  const fid = g.field.stage1.find(id => id);
  assert.strictEqual(E.applyAction(g, { type: 'reserve', target: { fromField: fid } }).ok, true);
  assert.strictEqual(p0.tokens.purple, 2, 'ash reserve gives 2 masters');
  assert.strictEqual(g.supply.purple, 3, 'supply consumed 2');
});

// ---- 小刚·岩石意志：同色 3 个 ----
test('brock: take 3 same works when supply>=3; rejected when supply<3 or skill off', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 1, trainerSkills: true, trainers: ['brock', 'ash'] });
  const p0 = g.players[0];
  assert.strictEqual(E.skillOf(g, p0), 'brock');
  // 开局宝可梦：brock 黄 / ash 红 各 +1 奖励（不扣供应）→ red 供应仍为 4
  assert.strictEqual(E.bonuses(g, p0).yellow, 1, 'brock start bonus yellow');
  assert.strictEqual(g.supply.red, 4, 'supply untouched by start bonus');
  assert.strictEqual(E.applyAction(g, { type: 'take', colors: ['red', 'red', 'red'] }).ok, true, 'triple ok at supply 4');
  assert.strictEqual(p0.tokens.red, 3, '3 red taken');
  assert.strictEqual(g.supply.red, 1, 'supply 4 -> 1');
  // 供应不足（2）时拒绝
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 2, trainerSkills: true, trainers: ['brock', 'ash'] });
  g2.supply.red = 2;
  assert.strictEqual(E.applyAction(g2, { type: 'take', colors: ['red', 'red', 'red'] }).ok, false, 'triple rejected at supply 2');
  // 非 brock 玩家拒绝
  const g3 = E.createGame(DB, { numPlayers: 2, seed: 3, trainerSkills: true, trainers: ['ash', 'brock'] });
  assert.strictEqual(E.applyAction(g3, { type: 'take', colors: ['red', 'red', 'red'] }).ok, false, 'ash cannot triple');
});

// ---- 小霞·潮汐祝福：异色 4 个 ----
test('misty: take 4 distinct works when >=4 colors available; rejected otherwise or without skill', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 1, trainerSkills: true, trainers: ['misty', 'ash'] });
  const p0 = g.players[0];
  assert.strictEqual(E.skillOf(g, p0), 'misty');
  const sum = (o) => o.red + o.blue + o.black + o.pink;
  const before = sum(p0.tokens); // misty 开局奖励为蓝色宝可梦（bonus），不是球 token
  assert.strictEqual(E.applyAction(g, { type: 'take', colors: ['red', 'blue', 'black', 'pink'] }).ok, true, '4-distinct ok');
  assert.strictEqual(sum(p0.tokens) - before, 4, '4 taken');
  // 只有 3 种颜色可用时，4 异色被拒
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 2, trainerSkills: true, trainers: ['misty', 'ash'] });
  g2.supply.yellow = 0; g2.supply.black = 0;
  assert.strictEqual(E.applyAction(g2, { type: 'take', colors: ['red', 'blue', 'black', 'pink'] }).ok, false, '4-distinct rejected when 3 colors available');
  assert.strictEqual(E.applyAction(g2, { type: 'take', colors: ['red', 'blue', 'pink'] }).ok, true, '3-distinct still fine');
  // 非 misty 玩家拒绝 4 异色
  const g3 = E.createGame(DB, { numPlayers: 3, seed: 3, trainerSkills: true, trainers: ['ash', 'misty', 'brock'] });
  assert.strictEqual(E.applyAction(g3, { type: 'take', colors: ['red', 'blue', 'black', 'pink'] }).ok, false, 'ash cannot 4-distinct');
});

// ---- 火箭队·捕获装置：捕捉后回合结束 +1 大师球 ----
test('rocket: capture then endTurn grants 1 master; skipped when capped or no capture', () => {
  function prepCapture(g) {
    const p = g.players[0];
    const fid = g.field.stage1.find(id => id);
    // 给恰好等于卡面成本的球（一阶卡总成本很小），保证可直接捕捉且不超过上限
    const card = g.byId[fid];
    p.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
    for (const c of E.COLORS) p.tokens[c] = card.cost[c] || 0;
    return fid;
  }
  // 捕捉 → 回合结束 +1 大师球
  const g1 = E.createGame(DB, { numPlayers: 2, seed: 10, trainerSkills: true, trainers: ['rocket', 'ash'] });
  const p1 = g1.players[0];
  const fid1 = prepCapture(g1);
  assert.strictEqual(E.applyAction(g1, { type: 'capture', cardId: fid1 }).ok, true, 'capture ok');
  const before = p1.tokens.purple;
  assert.strictEqual(E.endTurn(g1).ok, true, 'endTurn ok');
  assert.strictEqual(p1.tokens.purple, before + 1, 'rocket gains 1 master after capture');
  assert.strictEqual(g1.supply.purple, 4, 'supply decreased');
  // 已满 10 球 → 不触发
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 11, trainerSkills: true, trainers: ['rocket', 'ash'] });
  const p2 = g2.players[0];
  g2.acted = true; g2.capturedThisTurn = true;
  p2.tokens = { red: 10, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  const before2 = p2.tokens.purple;
  assert.strictEqual(E.endTurn(g2).ok, true, 'endTurn ok (at cap)');
  assert.strictEqual(p2.tokens.purple, before2, 'no master when at 10-ball cap');
  // 本回合未捕捉 → 不触发
  const g3 = E.createGame(DB, { numPlayers: 2, seed: 12, trainerSkills: true, trainers: ['rocket', 'ash'] });
  const p3 = g3.players[0];
  assert.strictEqual(E.applyAction(g3, { type: 'take', colors: ['red', 'blue', 'black'] }).ok, true, 'take ok');
  const before3 = p3.tokens.purple;
  assert.strictEqual(E.endTurn(g3).ok, true, 'endTurn ok');
  assert.strictEqual(p3.tokens.purple, before3, 'no master without capture');
});

// ---- legalActions 包含技能行动 ----
test('legalActions enumerates skill takes', () => {
  const gb = E.createGame(DB, { numPlayers: 2, seed: 1, trainerSkills: true, trainers: ['brock', 'ash'] });
  assert.ok(E.legalActions(gb).some(a => a.type === 'take' && a.colors.length === 3 && new Set(a.colors).size === 1), 'brock triple in legal');
  const gm = E.createGame(DB, { numPlayers: 2, seed: 1, trainerSkills: true, trainers: ['misty', 'ash'] });
  assert.ok(E.legalActions(gm).some(a => a.type === 'take' && a.colors.length === 4), 'misty 4-distinct in legal');
  const gn = E.createGame(DB, { numPlayers: 2, seed: 1, trainerSkills: false, trainers: ['misty', 'brock'] });
  assert.ok(!E.legalActions(gn).some(a => a.type === 'take' && a.colors.length === 4), 'no 4-distinct when off');
});

// ---- clone / redactFor 兼容 ----
test('clone keeps trainer state; redactFor keeps trainer (public info)', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 5, trainerSkills: true, trainers: ['rocket', 'misty'] });
  const c = E.clone(g);
  assert.strictEqual(c.trainerSkillsEnabled, true);
  assert.strictEqual(c.players[0].trainer, 'rocket');
  assert.strictEqual(c.players[1].trainer, 'misty');
  // 火箭队捕获→endTurn 在克隆态也能结算（AI 模拟依赖）
  const p = c.players[0];
  const fid = c.field.stage1.find(id => id);
  const card = c.byId[fid];
  p.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  for (const col of E.COLORS) p.tokens[col] = card.cost[col] || 0;
  E.applyAction(c, { type: 'capture', cardId: fid });
  const bp = p.tokens.purple;
  E.endTurn(c);
  assert.strictEqual(p.tokens.purple, bp + 1, 'rocket skill fires on clone');
  const r = E.redactFor(g, 0);
  assert.strictEqual(r.trainerSkillsEnabled, true);
  assert.strictEqual(r.players[0].trainer, 'rocket');
  assert.strictEqual(r.players[1].trainer, 'misty');
});

// ---- 自走对局（带技能）可终止、筹码守恒、胜者有效 ----
function greedyRandomTurn(g, rng) {
  const acts = E.legalActions(g);
  if (!acts.length) { g.acted = true; }
  else {
    const caps = acts.filter(a => a.type === 'capture').sort((a, b) => (g.byId[b.cardId].vp - g.byId[a.cardId].vp));
    const pick = caps.length && rng() < 0.85 ? caps[0] : acts[Math.floor(rng() * acts.length)];
    E.applyAction(g, pick);
  }
  const p = E.activePlayer(g);
  while (E.needsDiscard(g, p)) {
    const col = E.ALL_TOKENS.find(x => p.tokens[x] > 0);
    E.actionDiscard(g, col);
  }
  const evos = E.evolutionOptions(g, p);
  if (evos.length && rng() < 0.7) E.actionEvolve(g, evos[0].fromId, evos[0].toId);
  return E.endTurn(g);
}

test('30 self-play games with random trainers terminate & conserve tokens', () => {
  const TRAINER_IDS = Object.keys(E.TRAINER_SKILLS);
  for (let game = 0; game < 30; game++) {
    const np = 2 + (game % 3); // 2,3,4
    const trainers = [];
    for (let i = 0; i < np; i++) trainers.push(TRAINER_IDS[(game + i) % TRAINER_IDS.length]);
    const g = E.createGame(DB, { numPlayers: np, seed: 2000 + game, trainerSkills: true, trainers });
    const rng = E.makeRng(9000 + game);
    let plies = 0;
    while (g.phase !== 'gameover' && plies < 4000) { greedyRandomTurn(g, rng); plies++; }
    assert.strictEqual(g.phase, 'gameover', `game ${game} did not finish in ${plies} plies`);
    assert.ok(g.winner != null && g.winner >= 0 && g.winner < np, 'valid winner');
    const init = E.supplyFor(np);
    for (const c of E.ALL_TOKENS) {
      let sum = g.supply[c];
      for (const p of g.players) sum += p.tokens[c];
      assert.strictEqual(sum, init[c], `token ${c} conserved in game ${game}: got ${sum}, want ${init[c]}`);
    }
    // 每位玩家都保有技能
    for (const p of g.players) assert.ok(E.skillOf(g, p), 'player has a skill in game ' + game);
  }
});

// ---- 共同技能：开局宝可梦（视为已有一只对应色宝可梦，+1 奖励，不扣供应）----
test('start Pokémon: each trainer has +1 own-colour bonus; off => none; log recorded', () => {
  const startMap = { ash: 'red', misty: 'blue', brock: 'yellow', rocket: 'black', sabrina: 'pink' };
  for (const id of Object.keys(startMap)) {
    const g = E.createGame(DB, { numPlayers: 2, seed: 40, trainerSkills: true, trainers: [id, 'brock'] });
    const p = g.players[0];
    assert.strictEqual(p.startBonus[startMap[id]], 1, id + ' start bonus ' + startMap[id]);
    const b = E.bonuses(g, p);
    assert.strictEqual(b[startMap[id]], 1, id + ' bonuses include start bonus');
    // 不消耗任何供应
    const init = E.supplyFor(2);
    for (const c of E.ALL_TOKENS) assert.strictEqual(g.supply[c], init[c], 'supply untouched for ' + id);
  }
  // 关闭技能 → 无开局奖励
  const g0 = E.createGame(DB, { numPlayers: 2, seed: 41, trainerSkills: false, trainers: ['sabrina', 'misty'] });
  for (const p of g0.players) for (const c of E.COLORS) assert.strictEqual((p.startBonus[c] || 0), 0, 'no start bonus when off');
  // 开局日志
  const g1 = E.createGame(DB, { numPlayers: 2, seed: 43, trainerSkills: true, trainers: ['sabrina', 'brock'] });
  assert.ok(g1.log.some(l => l.msg.includes('开局宝可梦')), 'start-pokemon log present');
});

// ---- 娜姿·意念成球限制：每回合限 1 次，整局限 2 次 ----
test('sabrina conversion: at most 1 per turn and 2 per game', () => {
  function setup(seed, extraPink) {
    const g = E.createGame(DB, { numPlayers: 2, seed, trainerSkills: true, trainers: ['sabrina', 'ash'] });
    const p = g.players[0];
    const rid = g.field.rare.find(id => id);
    const card = g.byId[rid];
    p.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
    for (const c of E.COLORS) p.tokens[c] = card.cost[c] || 0;
    p.tokens.pink += extraPink;
    return { g, p, rid, card };
  }
  // 第 1 次换算成功（回合内第 1 次）
  const { g, p, rid, card } = setup(60, 2);
  const pay = E.computePayment(g, p, card);
  assert.ok(pay.ok && pay.converted === 1, 'first conversion ok');
  assert.strictEqual(E.applyAction(g, { type: 'capture', cardId: rid }).ok, true, 'capture ok');
  assert.strictEqual(p.sabrinaTurn, true, 'turn flag set');
  assert.strictEqual(p.sabrinaTotal, 1, 'total 1');
  // 同回合再捕捉稀有（若可行）→ 本回合已换算 → 拒绝换算
  const ridB = g.field.rare.find(id => id && id !== rid);
  if (ridB) {
    const cardB = g.byId[ridB];
    g.acted = false;
    p.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
    for (const c of E.COLORS) p.tokens[c] = cardB.cost[c] || 0;
    p.tokens.pink += 2;
    const payB = E.computePayment(g, p, cardB);
    assert.ok(!payB.ok, 'conversion blocked same turn');
  }
  // 回合结束 → 回合标志重置
  g.acted = true;
  assert.strictEqual(E.endTurn(g).ok, true, 'endTurn ok');
  assert.strictEqual(p.sabrinaTurn, false, 'turn flag reset');
  assert.strictEqual(p.sabrinaTotal, 1, 'total persists 1');
  // 第 2 次（新回合）→ 成功；total=2
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 61, trainerSkills: true, trainers: ['sabrina', 'ash'] });
  const r2 = setup(61, 2);
  const pay2 = E.computePayment(r2.g, r2.p, r2.card);
  assert.ok(pay2.ok && pay2.converted === 1, 'second conversion ok');
  r2.p.sabrinaTotal = 1; // 模拟已达上限前 1 次
  assert.strictEqual(E.applyAction(r2.g, { type: 'capture', cardId: r2.rid }).ok, true, 'second conversion ok');
  assert.strictEqual(r2.p.sabrinaTotal, 2, 'total 2');
  // 整局已 2 次 → 第 3 次拒绝
  r2.g.acted = true;
  assert.strictEqual(E.endTurn(r2.g).ok, true, 'endTurn ok');
  const g3 = E.createGame(DB, { numPlayers: 2, seed: 62, trainerSkills: true, trainers: ['sabrina', 'ash'] });
  const r3 = setup(62, 2);
  r3.p.sabrinaTotal = 2;
  const pay3 = E.computePayment(r3.g, r3.p, r3.card);
  assert.ok(!pay3.ok, 'third conversion blocked (game limit 2)');
});

// ---- 娜姿·大师馈赠：2 同色球 → 赠送 1 大师球给他人（整局限 1 次）----
test('giveMaster: 2 same-colour balls -> gift 1 master to another player, once per game', () => {
  const g = E.createGame(DB, { numPlayers: 3, seed: 70, trainerSkills: true, trainers: ['sabrina', 'ash', 'misty'] });
  const p = g.players[0];
  p.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  p.tokens.red = 3;
  const t0 = g.players[1].tokens.purple;
  // 成功赠送
  assert.strictEqual(E.applyAction(g, { type: 'giveMaster', toPlayer: 1, color: 'red' }).ok, true, 'gift ok');
  assert.strictEqual(p.tokens.red, 1, 'spent 2 red');
  assert.strictEqual(g.supply.red, E.supplyFor(3).red + 2, 'red returned to supply');
  assert.strictEqual(g.players[1].tokens.purple, t0 + 1, 'target got master');
  assert.strictEqual(g.supply.purple, E.supplyFor(3).purple - 1, 'master supply decreased');
  assert.strictEqual(p.giveUsed, true, 'giveUsed set');
  assert.ok(g.log.some(l => l.msg.includes('大师馈赠')), 'log tags give');
  // 不占用主行动
  assert.strictEqual(g.acted, false, 'main action untouched');
  // 整局第二次 → 拒绝
  p.tokens.red += 2;
  assert.strictEqual(E.applyAction(g, { type: 'giveMaster', toPlayer: 2, color: 'red' }).ok, false, 'second gift rejected');
  // 送给自己 → 拒绝
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 71, trainerSkills: true, trainers: ['sabrina', 'ash'] });
  g2.players[0].tokens.red = 2;
  assert.strictEqual(E.applyAction(g2, { type: 'giveMaster', toPlayer: 0, color: 'red' }).ok, false, 'cannot gift self');
  // 球不足 → 拒绝
  const g3 = E.createGame(DB, { numPlayers: 2, seed: 72, trainerSkills: true, trainers: ['sabrina', 'ash'] });
  g3.players[0].tokens.red = 1;
  assert.strictEqual(E.applyAction(g3, { type: 'giveMaster', toPlayer: 1, color: 'red' }).ok, false, 'needs 2 balls');
  // 非娜姿 → 拒绝
  const g4 = E.createGame(DB, { numPlayers: 2, seed: 73, trainerSkills: true, trainers: ['ash', 'sabrina'] });
  g4.players[0].tokens.red = 2;
  assert.strictEqual(E.applyAction(g4, { type: 'giveMaster', toPlayer: 1, color: 'red' }).ok, false, 'only sabrina can gift');
});

// ---- 娜姿·意念成球：任意 2 颗普通球换算 1 颗大师球 ----
test('sabrina: 2 ordinary balls convert to 1 master (rare capture); purple first; non-sabrina rejected', () => {
  // 1) 只有卡面颜色球、无多余普通球 → 无法换算 → 捕捉被拒
  const g = E.createGame(DB, { numPlayers: 2, seed: 50, trainerSkills: true, trainers: ['sabrina', 'ash'] });
  const p = g.players[0];
  const rid = g.field.rare.find(id => id);
  assert.ok(rid, 'rare card revealed');
  const card = g.byId[rid];
  p.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  for (const c of E.COLORS) p.tokens[c] = card.cost[c] || 0;
  assert.strictEqual(E.computePayment(g, p, card).ok, false, 'no extra ordinary -> cannot convert');
  assert.strictEqual(E.applyAction(g, { type: 'capture', cardId: rid }).ok, false, 'capture rejected');
  // 2) 补 2 颗普通球 → 换算成功
  p.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  for (const c of E.COLORS) p.tokens[c] = card.cost[c] || 0;
  p.tokens.pink += 2;
  const pay = E.computePayment(g, p, card);
  assert.ok(pay.ok && pay.converted >= 1, 'conversion computed: converted=' + pay.converted);
  assert.strictEqual(E.applyAction(g, { type: 'capture', cardId: rid }).ok, true, 'capture via conversion ok');
  assert.strictEqual(p.tokens.purple, 0, 'no purple spent');
  assert.strictEqual(p.board.length, 1, 'card on board');
  assert.ok(g.log.some(l => l.msg.includes('意念成球')), 'log tags conversion');
  // 3) 有真大师球 → 优先使用，不触发换算
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 51, trainerSkills: true, trainers: ['sabrina', 'ash'] });
  const p2 = g2.players[0];
  const rid2 = g2.field.rare.find(id => id);
  const card2 = g2.byId[rid2];
  p2.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  for (const c of E.COLORS) p2.tokens[c] = card2.cost[c] || 0;
  p2.tokens.purple = Math.max(1, card2.cost.purple || 1);
  const pay2 = E.computePayment(g2, p2, card2);
  assert.ok(pay2.ok && !pay2.converted, 'no conversion when purple suffices');
  assert.ok(pay2.pay.purple >= 1, 'purple paid');
  // 4) 同资源但非娜姿 → 大师球不足
  const g3 = E.createGame(DB, { numPlayers: 2, seed: 52, trainerSkills: true, trainers: ['ash', 'sabrina'] });
  const p3 = g3.players[0];
  const rid3 = g3.field.rare.find(id => id);
  const card3 = g3.byId[rid3];
  p3.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  for (const c of E.COLORS) p3.tokens[c] = card3.cost[c] || 0;
  p3.tokens.pink += 2;
  assert.strictEqual(E.computePayment(g3, p3, card3).ok, false, 'non-sabrina cannot convert');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
