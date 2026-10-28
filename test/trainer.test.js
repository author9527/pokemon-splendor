/* 训练家技能 v4（六训练师 + 主动技能）tests — run: node test/trainer.test.js  (from project root) */
const assert = require('assert');
const E = require('../js/engine.js');
const DB = require('../data/cards.json');
const T = require('../js/trainers.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const SK6 = ['ash', 'misty', 'erika', 'giovanni', 'sabrina', 'lance'];

// ---- 元数据完整性 ----
test('trainers.js exposes 6 trainers matching engine skill ids', () => {
  assert.strictEqual(T.TRAINER_DB.length, 6);
  const ids = T.TRAINER_DB.map(t => t.id).sort().join(',');
  assert.strictEqual(ids, SK6.slice().sort().join(','));
  for (const t of T.TRAINER_DB) {
    assert.ok(t.id && t.name && t.title && t.avatar && t.desc, 'trainer fields ' + t.id);
    assert.ok(E.TRAINER_SKILLS[t.id], 'engine knows skill ' + t.id);
    assert.ok(t.avatar.startsWith('assets/avatars/'), 'avatar path ' + t.id);
  }
  assert.strictEqual(T.TRAINER_BY_ID.sabrina.name, '娜姿');
  assert.strictEqual(T.TRAINER_BY_ID.giovanni.name, '坂木');
  assert.strictEqual(T.TRAINER_BY_ID.lance.name, '阿渡');
});

// ---- 技能关闭：原版行为不变 ----
test('skills off: no start bonus, no skill takes, no active skills', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 1, trainerSkills: false, trainers: ['erika', 'sabrina'] });
  assert.strictEqual(g.trainerSkillsEnabled, false);
  const p0 = g.players[0];
  assert.strictEqual(E.skillOf(g, p0), null);
  assert.deepStrictEqual(p0.startBonus, {});
  assert.strictEqual(E.applyAction(g, { type: 'take', colors: ['red', 'red', 'blue'] }).ok, false, 'erika doublePlus rejected when off');
  assert.strictEqual(E.applyAction(g, { type: 'psychicConvert', colors: ['red', 'blue', 'black'] }).ok, false, 'psychicConvert rejected when off');
});

// ---- 开局宝可梦（共同技能）----
test('start pokemon: each trainer gets +1 start bonus of their color, no score, no supply cost', () => {
  const EXPECT = { ash: 'red', misty: 'blue', erika: 'yellow', giovanni: 'black', sabrina: 'pink', lance: 'blue' };
  const g = E.createGame(DB, { numPlayers: 3, seed: 1, trainerSkills: true, trainers: SK6.slice(0, 3) });
  for (let i = 0; i < 3; i++) {
    const p = g.players[i], sk = p.trainer;
    assert.strictEqual(p.startBonus[EXPECT[sk]], 1, sk + ' start bonus color');
    const b = E.bonuses(g, p);
    for (const c of E.COLORS) assert.strictEqual(b[c], c === EXPECT[sk] ? 1 : 0, sk + ' bonus only ' + EXPECT[sk]);
    assert.strictEqual(E.scoreOf(g, p), 0, sk + ' start pokemon scores nothing');
    for (const c of E.ALL_TOKENS) assert.strictEqual(p.tokens[c], 0, sk + ' no tokens granted');
    assert.ok(!p.board.length && !p.reserve.length, sk + ' no real cards');
  }
  for (const c of E.COLORS) assert.strictEqual(g.supply[c], 5, 'supply untouched (3p)');
});

// ---- 小智·羁绊进化：缺口 X 图标 → 付该色 2X 球补足 ----
test('ash bond evolution: gap>0 pays 2X balls of the color; rejected when short', () => {
  function setup() {
    const g = E.createGame(DB, { numPlayers: 2, seed: 7, trainerSkills: true, trainers: ['ash', 'misty'] });
    const p = g.players[0];
    const from = DB.find(c => c.tier === 'stage1' && c.evolvesTo && c.evoCost && c.evoCost.color !== 'red');
    const to = DB.find(c => c.name === from.evolvesTo && c.tier === 'stage2');
    p.board = [from.id];
    p.reserve = [to.id];
    p.startBonus = {}; // 去掉开局红奖励，确保 gap 存在
    const col = from.evoCost.color, need = from.evoCost.count;
    return { g, p, from, to, col, need };
  }
  // 有足够球：bond 出现，进化实扣 2X
  const { g, p, from, to, col, need } = setup();
  p.tokens[col] = need * 2;
  const opts = E.evolutionOptions(g, p);
  const bond = opts.find(o => o.fromId === from.id && o.bond);
  assert.ok(bond, 'bond option exists');
  assert.strictEqual(bond.payCount, need * 2);
  assert.ok(E.applyAction(g, { type: 'evolve', fromId: from.id, toId: to.id }).ok, 'bond evolve ok');
  assert.strictEqual(p.tokens[col], 0, '2X balls paid');
  assert.strictEqual(g.supply[col], 4 + need * 2, 'balls returned to supply (2p base 4)');
  assert.ok(p.board.includes(to.id) && p.buried.includes(from.id), 'evolved');
  // 球不足：无 bond 选项
  const { g: g2, p: p2, from: f2, to: t2, col: c2, need: n2 } = setup();
  p2.tokens[c2] = n2 * 2 - 1;
  assert.ok(!E.evolutionOptions(g2, p2).some(o => o.bond), 'no bond when short');
  assert.strictEqual(E.applyAction(g2, { type: 'evolve', fromId: f2.id, toId: t2.id }).ok, false, 'bond evolve rejected when short');
});

// ---- 小智·热血成长：2级 +1 分、3级 +2 分 ----
test('ash hot-blooded growth: stage2 cards +1vp, stage3 +2vp in scoreOf', () => {
  const s2 = DB.find(c => c.tier === 'stage2');
  const s3 = DB.find(c => c.tier === 'stage3');
  const g = E.createGame(DB, { numPlayers: 2, seed: 8, trainerSkills: true, trainers: ['ash', 'erika'] });
  const ash = g.players[0], erika = g.players[1];
  ash.board = [s2.id, s3.id];
  erika.board = [s2.id, s3.id];
  assert.strictEqual(E.scoreOf(g, ash), s2.vp + s3.vp + 3, 'ash +1+2');
  assert.strictEqual(E.scoreOf(g, erika), s2.vp + s3.vp, 'erika no bonus');
});

// ---- 小霞·潮汐预读：保留时放弃大师球，查看牌堆顶 4 张重排并拿蓝球 ----
test('misty tide-reading: valid reorder applies (blue instead of master), invalid order rejected & state restored', () => {
  function setup() {
    const g = E.createGame(DB, { numPlayers: 2, seed: 9, trainerSkills: true, trainers: ['misty', 'ash'] });
    const cid = g.field.stage1.find(id => id);
    // 模拟 refill 将 pop 的张数 = 当前 null 槽（含本卡槽位）
    const nulls = g.field.stage1.reduce((a, x) => a + (x == null ? 1 : 0), 0) + 1;
    const deck = g.decks.stage1;
    const pops = Math.min(nulls, deck.length);
    const top = deck.slice(Math.max(0, deck.length - pops - 4), deck.length - pops);
    return { g, cid, top, pops };
  }
  // 合法重排（把 top 反转放回）
  const { g, cid, top, pops } = setup();
  const p0 = g.players[0];
  const deckBefore = g.decks.stage1.slice();
  const order = top.slice().reverse();
  const r = E.actionReserve(g, { fromField: cid }, { order });
  assert.ok(r.ok, 'tide-reading reserve ok');
  assert.strictEqual(p0.tokens.blue, 1, 'gained 1 blue');
  assert.strictEqual(p0.tokens.purple, 0, 'no master ball');
  const tail = g.decks.stage1.slice(g.decks.stage1.length - order.length);
  assert.deepStrictEqual(tail, order, 'deck top reordered');
  assert.strictEqual(g.decks.stage1.length, deckBefore.length - pops, 'deck length = before - refill pops');
  // 非法顺序：包含非 top 卡 → 拒绝且完整恢复
  const { g: g2, cid: cid2, top: top2 } = setup();
  const p2 = g2.players[0];
  const badOrder = top2.slice();
  badOrder[0] = g2.field.stage2.find(id => id); // 混入别层卡
  const d0 = g2.decks.stage1.slice(), f0 = g2.field.stage1.slice();
  const r2 = E.actionReserve(g2, { fromField: cid2 }, { order: badOrder });
  assert.strictEqual(r2.ok, false, 'invalid order rejected');
  assert.deepStrictEqual(g2.decks.stage1, d0, 'deck restored');
  assert.deepStrictEqual(g2.field.stage1, f0, 'field restored');
  assert.deepStrictEqual(p2.reserve, [], 'reserve restored');
  assert.strictEqual(p2.tokens.blue, 0, 'no blue granted');
  // 普通保留（无 preview）：仍拿大师球
  const g3 = E.createGame(DB, { numPlayers: 2, seed: 10, trainerSkills: true, trainers: ['misty', 'ash'] });
  const cid3 = g3.field.stage1.find(id => id);
  assert.ok(E.actionReserve(g3, { fromField: cid3 }).ok);
  assert.strictEqual(g3.players[0].tokens.purple, 1, 'plain reserve gives master');
});

// ---- 小霞·蓝球调色：蓝球可当任意非大师球 ----
test('misty blue-painting: blue tokens fill any ordinary-color gap in payment', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 11, trainerSkills: true, trainers: ['misty', 'ash'] });
  const p = g.players[0];
  // 选一张仅红球需求 2~3 的一阶卡（蓝球盈余 3 颗须能补足红缺口）
  const card = DB.find(c => c.tier === 'stage1' && c.cost.red >= 2 && c.cost.red <= 3 && c.cost.blue === 0 && c.cost.black === 0 && c.cost.pink === 0 && c.cost.yellow === 0);
  assert.ok(card, 'found red-only stage1 card');
  p.tokens = { red: 0, blue: 3, black: 0, pink: 0, yellow: 0, purple: 0 };
  p.startBonus = {};
  const pay = E.computePayment(g, p, card);
  assert.ok(pay.ok, 'affordable via blue painting');
  assert.strictEqual(pay.paintedBlue, card.cost.red, 'paintedBlue recorded');
  assert.strictEqual(pay.pay.red, card.cost.red, 'red paid by blue');
  // 非 misty 不能调色
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 12, trainerSkills: true, trainers: ['ash', 'misty'] });
  const p2 = g2.players[0];
  p2.tokens = { red: 0, blue: 3, black: 0, pink: 0, yellow: 0, purple: 0 };
  assert.strictEqual(E.computePayment(g2, p2, card).ok, false, 'ash cannot paint');
});

// ---- 莉佳·花语采集：2 同色 + 1 异色 ----
test('erika flower-picking: [c,c,d] take works; [c,c,c] or non-erika rejected', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 13, trainerSkills: true, trainers: ['erika', 'ash'] });
  const p = g.players[0];
  assert.strictEqual(E.applyAction(g, { type: 'take', colors: ['red', 'red', 'blue'] }).ok, true, 'doublePlus ok');
  assert.strictEqual(p.tokens.red, 2); assert.strictEqual(p.tokens.blue, 1);
  assert.strictEqual(g.supply.red, 2, '2 red from supply 4'); assert.strictEqual(g.supply.blue, 3, '1 blue');
  // 3 同色非法（即使莉佳）
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 14, trainerSkills: true, trainers: ['erika', 'ash'] });
  assert.strictEqual(E.applyAction(g2, { type: 'take', colors: ['red', 'red', 'red'] }).ok, false, 'triple same rejected');
  // 非 erika 玩家拒绝 doublePlus
  const g3 = E.createGame(DB, { numPlayers: 3, seed: 15, trainerSkills: true, trainers: ['ash', 'erika', 'misty'] });
  assert.strictEqual(E.applyAction(g3, { type: 'take', colors: ['red', 'red', 'blue'] }).ok, false, 'ash cannot doublePlus');
  // legalActions 枚举
  const g4 = E.createGame(DB, { numPlayers: 2, seed: 16, trainerSkills: true, trainers: ['erika', 'ash'] });
  assert.ok(E.legalActions(g4).some(a => a.type === 'take' && a.colors.length === 3 && new Set(a.colors).size === 2), 'erika doublePlus in legalActions');
});

// ---- 坂木·威压：标记阻断进化，清除标记恢复 ----
test('giovanni intimidation: seal blocks evolution; clearing pays same-color ball and restores', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 17, trainerSkills: true, trainers: ['giovanni', 'misty'] });
  const gio = g.players[0], misty = g.players[1];
  // 一阶进化卡折扣需求 count 通常为 3；用 3 张同色折扣卡把折扣补满 → 本可进化
  const from = DB.find(c => c.tier === 'stage1' && c.evolvesTo && c.evoCost);
  const to = DB.find(c => c.name === from.evolvesTo && c.tier === 'stage2');
  const aux = DB.find(c => c.tier === 'stage1' && c.bonus === from.evoCost.color);
  misty.board = [from.id, aux.id, aux.id, aux.id]; // b[color]=3 → gap=0
  misty.reserve = [to.id]; misty.startBonus = {}; gio.startBonus = {};
  gio.tokens.red = 1;
  // 无标记时本可进化（对照组）
  assert.ok(E.evolutionOptions(g, misty).some(o => o.fromId === from.id), 'evolution available without seal');
  // 威压：付 1 红球标记 misty 的卡
  assert.ok(E.applyAction(g, { type: 'intimidate', toPlayer: 1, cardId: from.id, color: 'red' }).ok, 'intimidate ok');
  assert.strictEqual(gio.tokens.red, 0, '1 red paid');
  assert.deepStrictEqual(misty.seals, [{ cardId: from.id, color: 'red' }], 'seal on target');
  // 被标记卡不出现进化选项
  assert.ok(!E.evolutionOptions(g, misty).some(o => o.fromId === from.id), 'sealed card cannot evolve');
  // giovanni 完成主行动后结束回合 → 轮到 misty：支付 1 个红色球清除标记
  assert.ok(E.applyAction(g, { type: 'take', colors: ['red', 'blue', 'black'] }).ok, 'gio main action');
  E.endTurn(g);
  misty.tokens.red = 1;
  assert.ok(E.applyAction(g, { type: 'clearSeal', cardId: from.id }).ok, 'clearSeal ok');
  assert.deepStrictEqual(misty.seals, [], 'seal removed');
  assert.strictEqual(misty.tokens.red, 0, 'same-color ball paid');
  const opts = E.evolutionOptions(g, misty);
  assert.ok(opts.some(o => o.fromId === from.id), 'evolution available again');
  // 无同色球不能清除（misty 回合内）
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 18, trainerSkills: true, trainers: ['giovanni', 'misty'] });
  g2.players[1].board = [from.id, aux.id, aux.id, aux.id];
  g2.players[0].tokens.red = 1;
  E.applyAction(g2, { type: 'intimidate', toPlayer: 1, cardId: from.id, color: 'red' });
  E.applyAction(g2, { type: 'take', colors: ['red', 'blue', 'black'] });
  E.endTurn(g2);
  assert.strictEqual(E.applyAction(g2, { type: 'clearSeal', cardId: from.id }).ok, false, 'clear needs the ball');
});

// ---- 坂木·肃清：移除目标精灵（失分失折扣）+ 对方获 2 大师球补偿 ----
test('giovanni purge: pay card cost +2 masters, remove target from board, compensate 2 masters', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 19, trainerSkills: true, trainers: ['giovanni', 'misty'] });
  const gio = g.players[0], misty = g.players[1];
  const card = DB.find(c => c.tier === 'stage2' && c.vp >= 3); // 有一定分数与折扣
  misty.board = [card.id];
  gio.startBonus = {}; misty.startBonus = {};
  // 给坂木足够支付：普通色成本 + 2 大师球
  gio.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  for (const c of E.COLORS) gio.tokens[c] = (card.cost[c] || 0) + 1;
  gio.tokens.purple = 2 + (card.cost.purple || 0);
  const supplyP0 = g.supply.purple;
  const beforeGio = gio.tokens.purple, beforeMisty = misty.tokens.purple;
  assert.strictEqual(E.applyAction(g, { type: 'purge', toPlayer: 1, cardId: card.id }).ok, true, 'purge ok');
  assert.ok(!misty.board.includes(card.id), 'card removed from board');
  assert.strictEqual(E.scoreOf(g, misty), 0, 'target loses its vp (board empty)');
  assert.strictEqual(E.bonuses(g, misty).red + E.bonuses(g, misty).blue + E.bonuses(g, misty).black + E.bonuses(g, misty).pink + E.bonuses(g, misty).yellow, 0, 'target loses discount');
  assert.strictEqual(misty.tokens.purple, beforeMisty + 2, 'target compensated 2 masters');
  assert.strictEqual(gio.tokens.purple, beforeGio - 2 - (card.cost.purple || 0), 'giovanni paid cost+2 real masters');
  assert.strictEqual(g.supply.purple, supplyP0, 'supply purple net unchanged (paid + compensate)');
  // 额外 2 大师球必须实付：只有 1 颗 → 拒绝
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 20, trainerSkills: true, trainers: ['giovanni', 'misty'] });
  const g2g = g2.players[0];
  g2.players[1].board = [card.id];
  for (const c of E.COLORS) g2g.tokens[c] = (card.cost[c] || 0) + 1;
  g2g.tokens.purple = 1;
  assert.strictEqual(E.applyAction(g2, { type: 'purge', toPlayer: 1, cardId: card.id }).ok, false, 'purge needs 2 real masters');
});

// ---- 娜姿·超能转换：3 任意球 → 1 大师球，每回合限 1 次，回合重置 ----
test('sabrina psychic-convert: 3 balls -> 1 master, once per turn, resets on new turn', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 21, trainerSkills: true, trainers: ['sabrina', 'ash'] });
  const p = g.players[0];
  p.tokens = { red: 1, blue: 1, black: 1, pink: 0, yellow: 0, purple: 0 };
  assert.strictEqual(E.applyAction(g, { type: 'psychicConvert', colors: ['red', 'blue', 'black'] }).ok, true);
  assert.strictEqual(p.tokens.purple, 1, 'master gained');
  assert.strictEqual(p.psychicUsed, true);
  assert.strictEqual(p.tokens.red + p.tokens.blue + p.tokens.black, 0, '3 balls paid');
  // 每回合限 1 次
  p.tokens.red = 3;
  assert.strictEqual(E.applyAction(g, { type: 'psychicConvert', colors: ['red', 'red', 'red'] }).ok, false, 'once per turn');
  // 必须恰好 3 颗 / 只能普通球
  const g2 = E.createGame(DB, { numPlayers: 2, seed: 22, trainerSkills: true, trainers: ['sabrina', 'ash'] });
  g2.players[0].tokens = { red: 2, blue: 1, black: 0, pink: 0, yellow: 0, purple: 0 };
  assert.strictEqual(E.applyAction(g2, { type: 'psychicConvert', colors: ['red', 'blue'] }).ok, false, 'needs exactly 3');
  assert.strictEqual(E.applyAction(g2, { type: 'psychicConvert', colors: ['red', 'red', 'purple'] }).ok, false, 'master not allowed as payment');
  // 回合结束 → 重置
  const g3 = E.createGame(DB, { numPlayers: 2, seed: 23, trainerSkills: true, trainers: ['sabrina', 'ash'] });
  g3.players[0].tokens = { red: 3, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  assert.ok(E.applyAction(g3, { type: 'psychicConvert', colors: ['red', 'red', 'red'] }).ok);
  E.endTurn(g3); // 到 ash 回合
  E.applyAction(g3, { type: 'take', colors: ['blue', 'black', 'pink'] }); // ash 行动
  E.endTurn(g3); // 回到 sabrina
  assert.strictEqual(g3.players[0].psychicUsed, false, 'reset on new turn');
});

// ---- 娜姿·精神压制：N/K 表、弃自己全部非大师球、大师球不可弃 ----
test('sabrina suppression: K table (N-1/N/11), dumps own non-master balls, cannot touch masters', () => {
  function setup(nonMaster) {
    const g = E.createGame(DB, { numPlayers: 3, seed: 24, trainerSkills: true, trainers: ['sabrina', 'ash', 'erika'] });
    const p = g.players[0];
    p.tokens = { red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 1 };
    const colors = ['red', 'blue', 'black', 'pink', 'yellow'];
    let left = nonMaster, i = 0;
    while (left > 0) { p.tokens[colors[i % 5]]++; left--; i++; }
    // 其他玩家各持球
    g.players[1].tokens = { red: 3, blue: 2, black: 1, pink: 0, yellow: 0, purple: 1 };
    g.players[2].tokens = { red: 0, blue: 1, black: 2, pink: 3, yellow: 0, purple: 0 };
    return g;
  }
  // N=5 → K=4
  const g1 = setup(5);
  const s1 = g1.supply;
  const before1 = s1.red + s1.blue + s1.black + s1.pink + s1.yellow;
  const o1b = g1.players[1].tokens.red + g1.players[1].tokens.blue + g1.players[1].tokens.black + g1.players[1].tokens.pink + g1.players[1].tokens.yellow
    + g1.players[2].tokens.red + g1.players[2].tokens.blue + g1.players[2].tokens.black + g1.players[2].tokens.pink + g1.players[2].tokens.yellow;
  const r1 = E.applyAction(g1, { type: 'suppress' });
  assert.ok(r1.ok && r1.N === 5 && r1.K === 4, 'N=5 K=4');
  for (const c of E.COLORS) assert.strictEqual(g1.players[0].tokens[c], 0, 'own non-master dumped');
  assert.strictEqual(g1.players[0].tokens.purple, 1, 'own master kept');
  const after1 = s1.red + s1.blue + s1.black + s1.pink + s1.yellow;
  const o1a = g1.players[1].tokens.red + g1.players[1].tokens.blue + g1.players[1].tokens.black + g1.players[1].tokens.pink + g1.players[1].tokens.yellow
    + g1.players[2].tokens.red + g1.players[2].tokens.blue + g1.players[2].tokens.black + g1.players[2].tokens.pink + g1.players[2].tokens.yellow;
  assert.strictEqual(after1 - before1, 5 + 4, '5 own + 4 others into supply');
  assert.strictEqual(o1b - o1a, 4, 'others lost exactly K');
  // N=10 → K=11
  const g2 = setup(10);
  const r2 = E.applyAction(g2, { type: 'suppress' });
  assert.ok(r2.ok && r2.N === 10 && r2.K === 11, 'N=10 K=11');
  // N<4 不可发动
  const g3 = setup(3);
  assert.strictEqual(E.applyAction(g3, { type: 'suppress' }).ok, false, 'needs >=4 non-master');
  // 显式指定弃大师球 → 拒绝
  const g4 = setup(5);
  assert.strictEqual(E.applyAction(g4, { type: 'suppress', targets: [{ toPlayer: 1, color: 'purple', count: 1 }] }).ok, false, 'masters cannot be dumped');
  // 显式分配合法：指定每人每色
  const g5 = setup(6); // N=6 → K=5
  const ok = E.applyAction(g5, { type: 'suppress', targets: [
    { toPlayer: 1, color: 'red', count: 3 }, { toPlayer: 2, color: 'pink', count: 2 },
  ] });
  assert.ok(ok.ok, 'explicit allocation ok');
  assert.strictEqual(g5.players[1].tokens.red, 0); assert.strictEqual(g5.players[2].tokens.pink, 1);
});

// ---- 阿渡·龙之怒：2 同色普通球 = 1 大师球（仅满足大师球需求）----
// 注入一张需求明确的稀有卡（普通色 2 红 + 大师球 1），精确验证换算语义
const RARE_A = { id: 'testRareA', name: '测试·喷火龙', tier: 'rare', bonus: 'red', bonusCount: 2, cost: { red: 2, blue: 0, black: 0, pink: 0, yellow: 0, purple: 1 }, vp: 5 };
const RARE_B = { id: 'testRareB', name: '测试·快龙', tier: 'rare', bonus: 'blue', bonusCount: 2, cost: { red: 3, blue: 0, black: 0, pink: 0, yellow: 0, purple: 1 }, vp: 6 };
function withRare(seed, trainers, card, cfg) {
  const g = E.createGame(DB, Object.assign({ numPlayers: 2, seed, trainerSkills: true, trainers }, cfg || {}));
  g.byId[card.id] = card;
  g.field.rare[0] = card.id; // 替换场上稀有卡（该层 deck 不受影响）
  g.players.forEach(p => { p.startBonus = {}; });
  return g;
}
test('lance dragon-rage: 2 same-color balls count as 1 master for master needs only', () => {
  // 4 红：2 红付普通色，剩 2 红 → 1 虚拟大师球
  const g = withRare(25, ['lance', 'ash'], RARE_A);
  const p = g.players[0];
  p.tokens = { red: 4, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  const pay = E.computePayment(g, p, RARE_A);
  assert.ok(pay.ok, 'dragon-rage covers master need');
  assert.strictEqual(pay.dragonConverted, 1, '1 virtual master');
  assert.strictEqual(pay.pay.purple, 0, 'no real master spent');
  // 3 红：普通色吃掉 2，剩 1 红不成对 → 大师球不足
  const g2 = withRare(26, ['lance', 'ash'], RARE_A);
  g2.players[0].tokens = { red: 3, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  assert.strictEqual(E.computePayment(g2, g2.players[0], RARE_A).ok, false, 'odd leftover cannot convert');
  // 普通色缺口不能用龙之怒：需求 3 红 + 1 大师，5 红 → 3 红付普通，剩 2 红 → 仅补大师
  const g3 = withRare(27, ['lance', 'ash'], RARE_B);
  const p3 = g3.players[0];
  p3.tokens = { red: 5, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  const pay3 = E.computePayment(g3, p3, RARE_B);
  assert.ok(pay3.ok, 'rage only bridges master need');
  assert.strictEqual(pay3.pay.red, 5, 'red paid: 3 ordinary + 2 converted for master');
  assert.strictEqual(pay3.dragonConverted, 1);
  // 非 lance 无龙之怒
  const g4 = withRare(28, ['ash', 'lance'], RARE_A);
  g4.players[0].tokens = { red: 4, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 };
  assert.strictEqual(E.computePayment(g4, g4.players[0], RARE_A).ok, false, 'ash has no rage');
});

// ---- 阿渡·快龙降临：获得稀有/传说时任意领 1 非大师球 ----
test('lance dragon-descent: capturing rare grants 1 non-master ball (auto color); not for normal tiers', () => {
  const g = withRare(29, ['lance', 'ash'], RARE_A);
  const p = g.players[0];
  for (const c of E.COLORS) p.tokens[c] = (RARE_A.cost[c] || 0) + 1;
  p.tokens.purple = 1;
  const supplyBefore = g.supply.red + g.supply.blue + g.supply.black + g.supply.pink + g.supply.yellow;
  const tokenBefore = p.tokens.red + p.tokens.blue + p.tokens.black + p.tokens.pink + p.tokens.yellow;
  assert.ok(E.applyAction(g, { type: 'capture', cardId: RARE_A.id }).ok, 'capture rare ok');
  const gained = (p.tokens.red + p.tokens.blue + p.tokens.black + p.tokens.pink + p.tokens.yellow) - tokenBefore;
  assert.strictEqual(gained, 1 - (RARE_A.cost.red || 0), 'net ordinary = -paid + 1 blessed');
  const afterSupply = g.supply.red + g.supply.blue + g.supply.black + g.supply.pink + g.supply.yellow;
  assert.strictEqual(afterSupply - supplyBefore, (RARE_A.cost.red || 0) - 1, 'supply +paid −1 blessed');
  // 显式指定颜色
  const g2 = withRare(30, ['lance', 'ash'], RARE_A);
  const p2 = g2.players[0];
  for (const c of E.COLORS) p2.tokens[c] = (RARE_A.cost[c] || 0) + 1;
  p2.tokens.purple = 1;
  assert.ok(E.applyAction(g2, { type: 'capture', cardId: RARE_A.id, opts: { blessColor: 'yellow' } }).ok);
  assert.strictEqual(p2.tokens.yellow, 2, 'blessed yellow (+1 over base)');
  // 非稀有/传说：不触发（净变化 = 只付普通球成本，无祝福）
  const g3 = E.createGame(DB, { numPlayers: 2, seed: 31, trainerSkills: true, trainers: ['lance', 'ash'] });
  const p3 = g3.players[0];
  p3.startBonus = {}; // 去掉开局奖励折扣，净变化只含成本
  const s1 = g3.field.stage1.find(id => id); // 场上真实一阶卡
  const s1c = g3.byId[s1];
  for (const c of E.COLORS) p3.tokens[c] = (s1c.cost[c] || 0) + 1;
  const costSum = E.COLORS.reduce((a, c) => a + (s1c.cost[c] || 0), 0);
  const tb = p3.tokens.red + p3.tokens.blue + p3.tokens.black + p3.tokens.pink + p3.tokens.yellow;
  assert.ok(E.applyAction(g3, { type: 'capture', cardId: s1 }).ok, 'capture stage1 ok');
  assert.strictEqual(p3.tokens.red + p3.tokens.blue + p3.tokens.black + p3.tokens.pink + p3.tokens.yellow - tb, -costSum, 'no blessing for stage1');
});

// ---- clone / redactFor 兼容（联机与 AI 模拟依赖）----
test('clone/redactFor keep trainer state incl. seals & psychicUsed', () => {
  const g = E.createGame(DB, { numPlayers: 2, seed: 32, trainerSkills: true, trainers: ['sabrina', 'giovanni'] });
  g.players[0].psychicUsed = true;
  g.players[1].seals = [{ cardId: 'x1', color: 'red' }];
  const c = E.clone(g);
  assert.strictEqual(c.players[0].psychicUsed, true);
  assert.deepStrictEqual(c.players[1].seals, [{ cardId: 'x1', color: 'red' }]);
  const r = E.redactFor(g, 0);
  assert.strictEqual(r.players[0].trainer, 'sabrina');
  assert.strictEqual(r.players[1].trainer, 'giovanni');
  assert.deepStrictEqual(r.players[1].seals, [{ cardId: 'x1', color: 'red' }], 'seals public');
});

// ---- 自走对局（六训练师混合）可终止、筹码守恒 ----
function greedyTurn(g, rng) {
  // 随机使用免费主动技能（部分可用的训练师）
  const p = E.activePlayer(g);
  const sk = E.skillOf(g, p);
  if (sk === 'sabrina' && !p.psychicUsed && g.supply.purple > 0) {
    const held = E.COLORS.filter(c => p.tokens[c] > 0);
    const total = held.reduce((a, c) => a + p.tokens[c], 0);
    if (total >= 3 && rng() < 0.3) {
      const colors = [];
      for (const c of held) for (let i = 0; i < p.tokens[c] && colors.length < 3; i++) colors.push(c);
      if (colors.length === 3) E.applyAction(g, { type: 'psychicConvert', colors });
    }
  }
  if (sk === 'giovanni' && E.COLORS.some(c => p.tokens[c] > 0) && rng() < 0.15) {
    for (const t of g.players) if (t.id !== p.id && t.board.length) {
      const cid = t.board[0];
      const pay = E.COLORS.reduce((a, c) => p.tokens[c] > p.tokens[a] ? c : a, E.COLORS[0]);
      E.applyAction(g, { type: 'intimidate', toPlayer: t.id, cardId: cid, color: pay });
      break;
    }
  }
  const acts = E.legalActions(g);
  if (!acts.length) { g.acted = true; }
  else {
    const caps = acts.filter(a => a.type === 'capture').sort((a, b) => (g.byId[b.cardId].vp - g.byId[a.cardId].vp));
    const pick = caps.length && rng() < 0.8 ? caps[0] : acts[Math.floor(rng() * acts.length)];
    E.applyAction(g, pick);
  }
  const ap = E.activePlayer(g);
  while (E.needsDiscard(g, ap)) {
    const col = E.ALL_TOKENS.find(x => ap.tokens[x] > 0);
    E.actionDiscard(g, col);
  }
  const evos = E.evolutionOptions(g, ap);
  if (evos.length && rng() < 0.7) E.actionEvolve(g, evos[0].fromId, evos[0].toId);
  return E.endTurn(g);
}
test('self-play with all 6 trainers terminates; tokens conserved; winner valid', () => {
  const g = E.createGame(DB, { numPlayers: 4, seed: 42, trainerSkills: true, trainers: SK6.slice(0, 4) });
  let rng = 0;
  const rand = () => { rng = (rng * 1103515245 + 12345) >>> 0; return rng / 4294967296; };
  const totalPerColor = {};
  for (const c of E.ALL_TOKENS) totalPerColor[c] = g.supply[c] + g.players.reduce((a, p) => a + p.tokens[c], 0);
  let turns = 0;
  while (g.phase === 'play' && turns < 600) {
    const r = greedyTurn(g, rand);
    assert.ok(r.ok, 'endTurn ok at turn ' + turns);
    // 守恒：供应 + 持有 = 初始（威压/肃清/压制/转换都不破坏守恒）
    for (const c of E.ALL_TOKENS) {
      const now = g.supply[c] + g.players.reduce((a, p) => a + p.tokens[c], 0);
      assert.strictEqual(now, totalPerColor[c], 'conserved ' + c + ' turn ' + turns);
    }
    turns++;
  }
  assert.ok(g.phase === 'gameover' || turns >= 600, 'game ends or bounded');
  if (g.phase === 'gameover') {
    assert.ok(g.winner != null && g.winner >= 0 && g.winner < 4);
    for (const p of g.players) assert.ok(E.scoreOf(g, p) >= 0);
  }
});

console.log(`\ntrainer v4: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
