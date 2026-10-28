/* 补充自对弈压测（使用真实 data/cards.json + 全 6 训练师）
 *
 * 目的：在仓库自带测试之外，做更大样本量、专门走训练师技能代码路径的随机自对弈，
 *       验证三件事：
 *         (1) 技能实现与设计一致（engine 能正常驱动 6 训练师的各类技能而不报错）
 *         (2) 游戏不会卡死（每局有手数上限 + 引擎内置和棋兜底，必然终止）
 *         (3) 不抛异常、精灵球守恒成立（supply + 各玩家持有总量全程不变）
 *
 * 跑法（从仓库根目录）： node verification/selfplay_fuzz.js [局数，默认 3000]
 *
 * 注意：本脚本是「补充证据」，仓库自带的 test/trainer.test.js、test/invariants.test.js、
 *       test/engine.test.js 才是断言级验证（共 41 项断言全部通过）。
 */
'use strict';

const E = require('../js/engine.js');
const DB = require('../data/cards.json');

const SK6 = ['ash', 'misty', 'erika', 'giovanni', 'sabrina', 'lance'];
const GAMES = parseInt(process.argv[2], 10) || 3000;
const PLY_CAP = 4000;

// 可复现的线性同余随机数
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

// 精灵球总存量 = 供应堆 + 所有玩家持有
function totalTokens(g) {
  let t = 0;
  for (const c of E.ALL_TOKENS) t += g.supply[c] || 0;
  for (const p of g.players) for (const c of E.ALL_TOKENS) t += p.tokens[c] || 0;
  return t;
}

let crashes = 0, hangs = 0, badWinner = 0, completed = 0;
let maxPlies = 0, sumPlies = 0;
const configCounts = { 2: 0, 3: 0, 4: 0, 6: 0 };

for (let i = 0; i < GAMES; i++) {
  const seed = 1000 + i;
  const numPlayers = [2, 3, 4, 6][i % 4];
  const trainers = SK6.slice(0, numPlayers);
  configCounts[numPlayers]++;
  const r = makeRng(seed);

  let g;
  try {
    g = E.createGame(DB, { numPlayers, seed, trainerSkills: true, trainers });
  } catch (e) {
    crashes++;
    console.error('createGame 异常 @game', i, e.message);
    continue;
  }

  const initTotal = totalTokens(g);
  let plies = 0;
  let failed = false;
  try {
    while (g.phase !== 'gameover' && plies < PLY_CAP) {
      const acts = E.legalActions(g);
      if (acts.length) {
        const a = acts[Math.floor(r() * acts.length)];
        const res = E.applyAction(g, a);
        if (!res || !res.ok) throw new Error('合法行动被拒: ' + JSON.stringify(a) + ' -> ' + (res && res.error));
      } else {
        const res = E.actionPass(g);
        if (!res || !res.ok) throw new Error('pass 失败: ' + (res && res.error));
      }
      const me = g.players[g.turn];
      // 回合结束前弃到上限
      let guard = 0;
      while (E.needsDiscard(g, me) && guard++ < 30) {
        const c = E.ALL_TOKENS.filter(x => me.tokens[x] > 0)[0];
        if (!c) throw new Error('需弃球却无球');
        if (!E.actionDiscard(g, c).ok) throw new Error('弃球失败');
      }
      // 一半概率尝试进化（含羁绊进化等技能路径）
      const evo = E.evolutionOptions(g, me);
      if (evo.length && r() < 0.5) {
        const o = evo[Math.floor(r() * evo.length)];
        if (!E.actionEvolve(g, o.fromId, o.toId).ok) throw new Error('进化选项执行失败');
      }
      const et = E.endTurn(g);
      if (!et || !et.ok) throw new Error('回合无法结束: ' + (et && et.error));
      // 守恒不变量：每手之后总球数必须等于开局
      if (totalTokens(g) !== initTotal) throw new Error('精灵球守恒违例: ' + totalTokens(g) + ' vs ' + initTotal);
      plies++;
    }
  } catch (e) {
    crashes++;
    console.error('对局异常 @game', i, '(', numPlayers, '人,', plies, '手):', e.message);
    failed = true;
  }
  if (failed) continue;

  if (g.phase !== 'gameover') {
    hangs++;
    console.error('未终止(疑似卡死) @game', i, 'plies=', plies);
    continue;
  }
  if (g.winner == null || g.winner < 0) {
    badWinner++;
    console.error('结束无胜者 @game', i);
    continue;
  }
  completed++;
  maxPlies = Math.max(maxPlies, plies);
  sumPlies += plies;
}

console.log('\n================ 补充自对弈压测结果 ================');
console.log('总局数            :', GAMES, JSON.stringify(configCounts));
console.log('正常完成          :', completed);
console.log('对局异常/崩溃     :', crashes);
console.log('未终止(卡死)      :', hangs);
console.log('结束无有效胜者    :', badWinner);
console.log('平均手数          :', completed ? (sumPlies / completed).toFixed(1) : '-');
console.log('最大手数          :', maxPlies, '(上限', PLY_CAP, ')');

const ok = crashes === 0 && hangs === 0 && badWinner === 0 && completed === GAMES;
console.log(ok
  ? '\n✅ 全部通过：在 6 训练师全开的大规模随机自对弈下，无崩溃 / 无卡死 / 无守恒违例。'
  : '\n❌ 存在问题，详见上方日志。');
process.exit(ok ? 0 : 1);
