/* =====================================================================
 * 璀璨宝石：宝可梦  —  Pokémon Splendor  game engine (pure logic, no DOM)
 * ---------------------------------------------------------------------
 * Faithful to the TTS mod "璀璨宝石：宝可梦（自动脚本）" + the rulebook:
 *   - 6 ball types: red(精灵球) blue(超级球) black(高级球) pink(治愈球)
 *     yellow(先机球) + purple(大师球, wild).  [internal color codes]
 *   - 3 normal stages + Rare + Legendary. Rare/Legendary need Master Balls
 *     and grant 2 bonus balls each.
 *   - Actions: take balls / reserve+master / capture.
 *   - Evolution at end of turn (not an action): paid ONLY by the discount
 *     balls on your captured cards (bonuses) — never by held tokens; you must
 *     already own enough discounts of the required color. The old card goes
 *     "under the tile" (no longer scores or grants a bonus).
 *   - 18 VP triggers the final round; tiebreak = most cards under tile,
 *     then most Pokémon in play.
 *
 * Designed to run identically in the browser (window.Engine) and in Node
 * (module.exports) so it can be unit-tested headless.
 * ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Engine = api;
})(this, function () {
  'use strict';

  const COLORS = ['red', 'blue', 'black', 'pink', 'yellow']; // the 5 normal ball types
  const MASTER = 'purple';                                    // wild ball
  const ALL_TOKENS = COLORS.concat([MASTER]);
  const NORMAL_TIERS = ['stage1', 'stage2', 'stage3'];
  const FIELD_TIERS = ['stage1', 'stage2', 'stage3', 'rare', 'legend'];
  const FIELD_SLOTS = { stage1: 4, stage2: 4, stage3: 4, rare: 1, legend: 1 };
  const SPECIAL_TIERS = ['rare', 'legend'];
  const SPECIAL_DECK_SIZE = 5; // 神兽/幻兽: only 5 of the 10-card pool play per game (1 revealed + 4 in deck)
  // --- Pokémart expansion (opt-in via opts.pokemart + opts.pokemartDB) ---
  // 3 extra decks (one per base level); each shows 2 face-up cards to the right
  // of its level row. Cards capture/reserve like base cards (special effects are
  // resolved separately). Empty/absent when the expansion is off.
  const PM_TIERS = ['pmL1', 'pmL2', 'pmL3'];
  const PM_SLOTS = 2;
  const PM_BASE_TIER = { pmL1: 'stage1', pmL2: 'stage2', pmL3: 'stage3' }; // reserve eligibility mirrors its level
  // Pokémart effects whose engine logic is live. Capturing a Pokémart card whose
  // effect is not yet implemented is rejected (so gameplay never silently misfires).
  // double  : POTION — 2 bonuses (bonusCount already drives bonuses()).
  // copy    : EVOLVE STONE — on capture, associate with an owned card's bonus.
  // colorless_master : POKÉDEX — no bonus; later discardable as 2 virtual master balls.
  // discard_buy : REPEL — no token cost; discard 2 owned cards of a color instead.
  // free    : TM — on capture, immediately take a free face-up Level-2 card.
  // copy_free : RARE CANDY — associate (like copy) + take a free Level-1 card.
  const PM_EFFECTS_LIVE = { double: true, copy: true, colorless_master: true, discard_buy: true, free: true, copy_free: true };
  // Canonical color-balanced sets (one bonus colour each), matching the classic
  // 神兽/稀有 used in the strategy guides. Every game has exactly one rare & one
  // legend per colour (red/black/yellow/blue/pink), each granting 2 same-colour bonuses.
  const CANON_SPECIAL = {
    rare: ['rr_06', 'rr_07', 'rr_08', 'rr_09', 'rr_10'],   // 拉普拉斯红/伊布黑/卡比兽粉/百变怪蓝/化石翼龙黄
    legend: ['lg_06', 'lg_07', 'lg_08', 'lg_09', 'lg_10'], // 火焰鸟粉/超梦黑/梦幻蓝/急冻鸟黄/闪电鸟红
  };
  const HAND_MAX = 3;
  const TOKEN_MAX = 10;
  const WIN_SCORE = 18;
  // ----- Trainer skills (训练家技能扩展, opt-in via opts.trainerSkills) -----
  // 每位训练家一个共同技能 + 专属技能，在行动流程内部结算（引擎权威）。技能规则：
  //   共同技能「开局宝可梦」: 开局视为已有一只对应色宝可梦（+1 对应色奖励，
  //     捕捉支付与进化判定时自动抵扣；start 字段为对应色）。
  //   ash      羁绊进化 : 进化缺口 X 个指定颜色图标时，可支付该色 2X 颗补足完成进化
  //           热血成长 : 2 级卡面分数 +1，3 级卡面分数 +2
  //   misty    潮汐预读 : 保留时可放弃大师球，改为查看该等级牌堆顶 4 张自主重排并拿 1 颗蓝球
  //           蓝球调色 : 支付时蓝球可当作任意非大师球使用
  //   erika    花语采集 : 拿取 2 同色时可额外拿 1 颗异色非大师球
  //   giovanni 威压 : 支付 1 球在对方精灵卡上作标记，该精灵进化前需先支付 1 颗同色球清除
  //           肃清 : 支付目标卡捕捉成本 + 2 大师球，将其移除游戏（对方获 2 大师球补偿）
  //   sabrina  超能转换 : 每回合限 1 次，支付 3 颗任意精灵球获得 1 颗大师球
  //           精神压制 : 非大师球 ≥4 时发动，弃置自己全部非大师球（N），并从其他玩家
  //                     合计弃置 N-1/N/11（N=4-6/7-9/10）颗非大师球到公共池
  //   lance    龙之怒 : 支付时 2 颗同色非大师球可视为 1 颗大师球（仅满足大师球需求）
  //           快龙降临 : 获得稀有/传说精灵时任意领取 1 颗非大师球
  // 元数据在 js/trainers.js；引擎只认 id。
  const TRAINER_SKILLS = {
    ash:      { name: '羁绊进化', start: 'red' },     // 开局红色宝可梦
    misty:    { name: '潮汐预读', start: 'blue' },    // 开局蓝色宝可梦
    erika:    { name: '花语采集', start: 'yellow' },  // 开局黄色宝可梦
    giovanni: { name: '威压', start: 'black' },       // 开局黑色宝可梦
    sabrina:  { name: '超能转换', start: 'pink' },    // 开局粉色宝可梦
    lance:    { name: '龙之怒', start: 'blue' },      // 开局蓝色宝可梦
  };
  function skillOf(s, p) {
    if (!s.trainerSkillsEnabled || !p || !p.trainer) return null;
    return TRAINER_SKILLS[p.trainer] ? p.trainer : null;
  }
  // 共同技能「开局宝可梦」：开局视为已有一只对应色宝可梦（+1 奖励，不占用供应/球上限）
  function grantStartPokemon(s) {
    for (const p of s.players) {
      const meta = TRAINER_SKILLS[p.trainer];
      if (!meta || !meta.start) continue;
      p.startBonus = p.startBonus || {};
      p.startBonus[meta.start] = 1;
      log(s, `${p.name}（${meta.name}）开局视为已有一只${zhBall(meta.start)}宝可梦（技能·开局宝可梦）`);
    }
  }
  // --- Megas expansion (opt-in via opts.megas + opts.megaDB) ---
  const MEGA_TOKENS = 4;          // shared pool of "Mega" tokens
  const MEGA_WIN_SCORE = 20;      // with Megas: need 20 VP + 1 of each color + 1 Mega

  // ----- seedable RNG (mulberry32) so shuffles are reproducible -----
  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  const emptyTokens = () => ({ red: 0, blue: 0, black: 0, pink: 0, yellow: 0, purple: 0 });
  const emptyColors = () => ({ red: 0, blue: 0, black: 0, pink: 0, yellow: 0 });

  function supplyFor(numPlayers) {
    const each = numPlayers <= 2 ? 4 : numPlayers === 3 ? 5 : 7;
    const s = emptyTokens();
    for (const c of COLORS) s[c] = each;
    s.purple = 5; // Master Balls always 5
    return s;
  }

  // -------------------------------------------------------------------
  // Card DB: array of card objects. Engine indexes them by id.
  //   { id, tier, name, vp, bonus, bonusCount, cost{6}, evolvesTo, evoCost }
  // -------------------------------------------------------------------
  function buildIndex(cardDB) {
    const byId = {};
    for (const c of cardDB) byId[c.id] = c;
    return byId;
  }

  // Field tiers actually in play for this state (base tiers + Pokémart when on).
  function fieldTiers(s) { return s.pokemartEnabled ? FIELD_TIERS.concat(PM_TIERS) : FIELD_TIERS; }
  function slotCount(tier) { return FIELD_SLOTS[tier] != null ? FIELD_SLOTS[tier] : PM_SLOTS; }
  function isPokemart(card) { return !!card && PM_TIERS.indexOf(card.tier) >= 0; }

  // ---------------------------- setup --------------------------------
  function createGame(cardDB, opts) {
    opts = opts || {};
    const numPlayers = opts.numPlayers || 2;
    const seed = (opts.seed != null) ? opts.seed : Math.floor(Math.random() * 2 ** 31);
    const winScore = (opts.winScore != null) ? opts.winScore : WIN_SCORE; // tutorial may lower this
    const rng = makeRng(seed);
    const byId = buildIndex(cardDB);

    // Optional Megas expansion: index mega cards; they form a face-up "mega offer".
    const megasEnabled = !!(opts.megas && opts.megaDB && opts.megaDB.length);
    if (megasEnabled) for (const c of opts.megaDB) byId[c.id] = c;

    // Optional Pokémart expansion: index its cards; they get their own per-level decks.
    const pokemartEnabled = !!(opts.pokemart && opts.pokemartDB && opts.pokemartDB.length);
    if (pokemartEnabled) for (const c of opts.pokemartDB) byId[c.id] = c;

    // decks per tier (ids), shuffled
    const decks = {};
    for (const tier of FIELD_TIERS) {
      decks[tier] = shuffle(cardDB.filter(c => c.tier === tier).map(c => c.id), rng);
    }
    if (pokemartEnabled) {
      for (const tier of PM_TIERS) {
        decks[tier] = shuffle(opts.pokemartDB.filter(c => c.tier === tier).map(c => c.id), rng);
      }
    }
    // 神兽/幻兽: use the canonical colour-balanced 5 per tier (1 revealed + 4 in deck),
    // keeping the shuffled order so which one is revealed first still varies.
    for (const tier of SPECIAL_TIERS) {
      const set = (opts.specialSets && opts.specialSets[tier]) || CANON_SPECIAL[tier];
      decks[tier] = decks[tier].filter(id => set.indexOf(id) >= 0);
    }
    const allFieldTiers = pokemartEnabled ? FIELD_TIERS.concat(PM_TIERS) : FIELD_TIERS;
    const field = {};
    for (const tier of allFieldTiers) {
      field[tier] = [];
      for (let i = 0; i < slotCount(tier); i++) {
        field[tier].push(decks[tier].length ? decks[tier].pop() : null);
      }
    }

    const players = [];
    for (let i = 0; i < numPlayers; i++) {
      players.push({
        id: i,
        name: (opts.names && opts.names[i]) || ('训练家 ' + (i + 1)),
        isAI: !!(opts.ai && opts.ai[i]),
        trainer: (opts.trainers && opts.trainers[i]) || null, // 训练家技能扩展：训练师 id
        tokens: emptyTokens(),
        startBonus: {},            // 训练家技能·开局宝可梦：开局视为已拥有的对应色宝可梦奖励
        psychicUsed: false,        // 娜姿·超能转换：本回合是否已使用（每回合限 1 次）
        seals: [],                 // 坂木·威压：盖在【本玩家】场上精灵卡上的标记 [{cardId, color}]
        megaToken: 0, // Megas expansion: 0 or 1 held Mega token
        board: [],   // captured card ids currently in play (provide bonus + vp)
        buried: [],  // card ids under the tile (evolved away — no bonus/vp)
        reserve: [], // reserved card ids (in hand)
        assoc: {},   // Pokémart copy cards: cardId -> associated bonus colour
      });
    }

    const supply = supplyFor(numPlayers);
    if (megasEnabled) supply.megaToken = MEGA_TOKENS;

    const s = {
      seed,
      winScore,
      cardDB,
      byId,
      numPlayers,
      supply,
      trainerSkillsEnabled: !!opts.trainerSkills, // 训练家技能扩展开关
      decks,
      field,
      players,
      // Megas expansion state (empty/false when the expansion is off)
      megasEnabled,
      megaDB: megasEnabled ? opts.megaDB : [],
      megaOffer: megasEnabled ? opts.megaDB.map(c => c.id) : [], // the 10 unique megas, removed when taken
      // Pokémart expansion state (empty/false when off). Its face-up cards live in
      // field.pmL1/pmL2/pmL3 (2 each) and use the normal capture/reserve/refill path.
      pokemartEnabled,
      pokemartDB: pokemartEnabled ? opts.pokemartDB : [],
      turn: 0,                 // index of active player
      round: 1,
      phase: 'play',           // 'play' | 'discard' | 'evolve' | 'gameover'
      lastRound: false,        // someone hit the win trigger
      finalTurnOf: null,       // when lastRound, the player index that ends the game
      winner: null,
      log: [],
      // per-turn scratch
      acted: false,            // main action used this turn
      taken: [],               // colors taken this turn (for take-action validation)
      evolvedThisTurn: false,  // at most one (mega-)evolution per turn
      capturedThisTurn: false, // 训练家技能扩展：本回合是否捕捉过宝可梦（火箭队·捕获装置）
    };
    if (s.trainerSkillsEnabled) grantStartPokemon(s); // 训练家技能共同技能：开局宝可梦
    return s;
  }

  // --------------------------- helpers -------------------------------
  function activePlayer(s) { return s.players[s.turn]; }

  // A card's effective bonus colour for this player. Pokémart "copy" cards
  // (EVOLVE STONE / RARE CANDY) take the colour of the card they were associated
  // with at capture time (stored in player.assoc); cards with no real colour
  // (e.g. POKÉDEX, or an unassociated copy card) contribute nothing.
  function effBonusColor(s, player, id) {
    const assoc = player.assoc && player.assoc[id];
    const col = assoc || s.byId[id].bonus;
    return COLORS.indexOf(col) >= 0 ? col : null;
  }
  function bonusOf(s, player, color) {
    let n = 0;
    for (const id of player.board) {
      if (effBonusColor(s, player, id) === color) n += (s.byId[id].bonusCount || 1);
    }
    return n;
  }
  function bonuses(s, player) {
    const b = emptyColors();
    for (const id of player.board) {
      const col = effBonusColor(s, player, id);
      if (col) b[col] += (s.byId[id].bonusCount || 1);
    }
    // 训练家技能·开局宝可梦：开局视为已有一只对应色宝可梦（+1 奖励）
    if (player.startBonus) for (const c of COLORS) if (player.startBonus[c]) b[c] += player.startBonus[c];
    return b;
  }
  function tokenTotal(player) {
    return ALL_TOKENS.reduce((a, c) => a + player.tokens[c], 0);
  }
  function scoreOf(s, player) {
    let v = 0;
    for (const id of player.board) v += (s.byId[id].vp || 0);
    // 热血成长（小智）：所有 2 级精灵卡面分数 +1、3 级精灵卡面分数 +2
    if (skillOf(s, player) === 'ash') {
      for (const id of player.board) {
        const t = s.byId[id].tier;
        if (t === 'stage2') v += 1;
        else if (t === 'stage3') v += 2;
      }
    }
    return v;
  }
  function locateCard(s, id) {
    // returns {where:'field'|'deck'|'reserve'|null, tier, slot, owner}
    for (const tier of fieldTiers(s)) {
      const slot = s.field[tier].indexOf(id);
      if (slot >= 0) return { where: 'field', tier, slot };
    }
    for (const p of s.players) {
      const ri = p.reserve.indexOf(id);
      if (ri >= 0) return { where: 'reserve', owner: p.id, slot: ri };
    }
    return { where: null };
  }
  function refill(s, tier) {
    const slots = s.field[tier];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] == null && s.decks[tier].length) slots[i] = s.decks[tier].pop();
    }
  }
  function log(s, msg) {
    s.log.push({ turn: s.turn, round: s.round, msg });
    if (s.log.length > 200) s.log.splice(0, s.log.length - 200); // bound growth (persisted + broadcast online)
  }

  // ----------------------- payment computation -----------------------
  // Compute how to pay for a card given current bonuses & tokens.
  // Returns {ok, pay:{tokens spent}, error}. `pay` includes purple (master).
  // 技能被动（结算于支付计算内）：
  //   蓝球调色（小霞）: 蓝球可当作任意非大师球使用（补任意普通色缺口）
  //   龙之怒（阿渡）  : 2 颗同色非大师球可视为 1 颗大师球，仅用于满足大师球需求
  //                     （不能替代普通颜色需求）
  function computePayment(s, player, card, extraMaster) {
    extraMaster = extraMaster || 0; // virtual master balls from discarded POKÉDEX cards
    const sk = skillOf(s, player);
    const b = bonuses(s, player);
    const pay = emptyTokens();
    // --- 普通色需求：先同色球，再（小霞）蓝球调色补任意缺口 ---
    for (const c of COLORS) {
      const need = Math.max(0, (card.cost[c] || 0) - b[c]);
      pay[c] = Math.min(need, player.tokens[c]);
    }
    let paintedBlue = 0; // 蓝球调色：蓝球以其他颜色身份支付的颗数
    if (sk === 'misty') {
      let surplus = Math.max(0, player.tokens.blue - pay.blue); // 蓝球用于蓝色需求后的盈余
      for (const c of COLORS) {
        if (surplus <= 0) break;
        const gap = Math.max(0, (card.cost[c] || 0) - b[c]) - pay[c];
        const fill = Math.min(gap, surplus);
        if (fill > 0) { pay[c] += fill; surplus -= fill; paintedBlue += fill; }
      }
      // 蓝球盈余仍未被用于补缺口 → 真实需求不足以消耗，蓝球少付（pay.blue 已按需计）
    }
    // --- 大师球需求：真实大师球优先满足紫色需求；龙之怒补紫色缺口 ---
    const purpleNeed = card.cost.purple || 0;   // mandatory master (rare/legend)
    const realPurple = player.tokens.purple + extraMaster; // 真实大师球（万能）
    const purplePaidByReal = Math.min(realPurple, purpleNeed);
    const purpleShort = purpleNeed - purplePaidByReal;
    let dragonConverted = 0; // 龙之怒换算的虚拟大师球数
    if (purpleShort > 0) {
      if (sk !== 'lance') return { ok: false, error: '大师球不足' };
      // 龙之怒：2 颗同色非大师球 → 1 颗大师球（仅满足大师球需求）
      let pairs = 0;
      for (const c of COLORS) pairs += Math.floor(Math.max(0, player.tokens[c] - pay[c]) / 2);
      if (pairs < purpleShort) return { ok: false, error: '大师球不足（龙之怒需同色对）' };
      dragonConverted = purpleShort;
      let needConv = purpleShort * 2;
      for (const c of COLORS) {
        if (needConv <= 0) break;
        const take = Math.min(Math.floor((player.tokens[c] - pay[c]) / 2) * 2, needConv);
        pay[c] += take; needConv -= take;
      }
    }
    // 普通色缺口：由剩余真实大师球替代（大师球万能，龙之怒虚拟球不能用于普通缺口）
    let ordinaryGap = 0;
    for (const c of COLORS) ordinaryGap += Math.max(0, (card.cost[c] || 0) - b[c] - pay[c]);
    const remainingReal = realPurple - purplePaidByReal;
    if (ordinaryGap > remainingReal) return { ok: false, error: '精灵球不足（含大师球替代）' };
    pay.purple = purplePaidByReal + Math.min(remainingReal, ordinaryGap);
    const virtualMaster = Math.min(extraMaster, purplePaidByReal + Math.min(remainingReal, ordinaryGap));
    return { ok: true, pay, paintedBlue, dragonConverted, virtualMaster };
  }
  function canAfford(s, player, card) { return computePayment(s, player, card).ok; }

  // Per-colour breakdown of a purchase, purely for display. Mirrors
  // computePayment's logic so the UI can show, for each colour:
  //   required     = balls printed on the card cost
  //   bonusCovered = covered for free by permanent bonuses (no token spent)
  //   paidColor    = matching coloured tokens you hand back to the supply
  //   paidWild     = covered by Master Balls (wildcard) because that colour ran short
  // Plus the card's mandatory Master cost (rare/legend). Returns null if unaffordable.
  function paymentBreakdown(s, player, card, extraMaster) {
    const cp = computePayment(s, player, card, extraMaster);
    if (!cp.ok) return null;
    const b = bonuses(s, player);
    const sk = skillOf(s, player);
    const rows = [];
    for (const c of COLORS) {
      const required = card.cost[c] || 0;
      if (required === 0 && cp.pay[c] === 0) continue;
      const bonusCovered = Math.min(required, b[c]);
      const remaining = required - bonusCovered;
      const paidColor = Math.min(remaining, cp.pay[c]);
      rows.push({
        color: c, required, bonusCovered, paidColor,
        paidWild: Math.max(0, remaining - paidColor),
        painted: (sk === 'misty' && c !== 'blue') ? Math.max(0, cp.pay[c] - Math.min(remaining, player.tokens[c])) : 0,
      });
    }
    const mandatoryMaster = card.cost.purple || 0; // purple pips printed on rare/legend
    return {
      rows,
      mandatoryMaster,
      master: cp.pay.purple,                // real Master Balls spent from your stash
      virtualMaster: cp.virtualMaster || 0, // Master "balls worth" from discarded POKÉDEX
      dragonConverted: cp.dragonConverted || 0, // 龙之怒：2 同色普通球换算的大师球数
    };
  }

  function payTokens(s, player, pay) {
    for (const c of ALL_TOKENS) {
      player.tokens[c] -= pay[c];
      s.supply[c] += pay[c];
    }
  }

  // --------------------------- actions -------------------------------
  // Each action returns {ok:true} or {ok:false, error}. On success the
  // main action is consumed (acted=true) and the turn auto-advances to the
  // evolve/discard check unless more sub-steps are required.

  function actionTake(s, colors) {
    const p = activePlayer(s);
    if (s.acted) return { ok: false, error: '本回合已行动' };
    if (!Array.isArray(colors) || colors.length === 0) return { ok: false, error: '未选择精灵球' };
    if (colors.length > 6) return { ok: false, error: '非法的拿取' }; // bound input before allocating a Set
    for (const c of colors) {
      if (!COLORS.includes(c)) return { ok: false, error: '不能拿取大师球' };
    }
    const sk = skillOf(s, p);
    const uniq = new Set(colors);
    let mode;
    // 花语采集（莉佳）：拿取 2 个同色时可额外拿取 1 个不同色非大师球（[c,c,d]）
    if (colors.length === 3 && uniq.size === 2 && sk === 'erika') {
      const cnt = {};
      colors.forEach(c => cnt[c] = (cnt[c] || 0) + 1);
      const doubleColor = Object.keys(cnt).find(c => cnt[c] === 2);
      const extraColor = Object.keys(cnt).find(c => cnt[c] === 1);
      if (!doubleColor || !extraColor) return { ok: false, error: '花语采集需 2 个同色 + 1 个不同色' };
      mode = 'doublePlus';
      if (s.supply[doubleColor] < 2) return { ok: false, error: '该颜色不足 2 个，不能拿两个' };
      if (s.supply[extraColor] < 1) return { ok: false, error: '额外拿取的颜色供应不足' };
    } else if (colors.length === 2 && uniq.size === 1) {
      mode = 'double';
      const c = colors[0];
      if (s.supply[c] < 4) return { ok: false, error: '该颜色少于4个，不能拿两个' };
    } else if (uniq.size === colors.length && colors.length <= 3) {
      mode = 'distinct';
      // Official rule: take 3 tokens of different types. Only when fewer than 3
      // colors remain available in the supply may you take fewer (2, or even 1).
      const availDistinct = COLORS.filter(col => s.supply[col] > 0).length;
      if (availDistinct >= 3 && colors.length !== 3) {
        return { ok: false, error: '必须拿取3种不同颜色的精灵球' };
      }
    } else {
      return { ok: false, error: '只能拿3种不同 或 2个同色' };
    }
    for (const c of uniq) if (s.supply[c] < (mode === 'double' ? 2 : 1)) return { ok: false, error: '供应不足' };
    // apply
    for (const c of colors) { s.supply[c]--; p.tokens[c]++; }
    s.acted = true;
    s.passStreak = 0;                          // 有人真的行动了 → 清零和棋计数
    s.taken = colors.slice();
    const skillTag = (mode === 'doublePlus') ? `（技能·${TRAINER_SKILLS[sk].name}）` : '';
    log(s, `${p.name} 拿取 ${colors.map(zhBall).join('、')}${skillTag}`);
    return { ok: true };
  }

  function actionReserve(s, target, preview) {
    // target: {fromField:id} or {fromDeck:tier}
    // preview: 潮汐预读（小霞）— {order:[id1..id4]} 按从上到下重排该等级牌堆顶 4 张；
    //          放弃拿大师球，改为查看牌堆并拿 1 颗蓝球
    const p = activePlayer(s);
    if (s.acted) return { ok: false, error: '本回合已行动' };
    if (!target || typeof target !== 'object' || Array.isArray(target)) return { ok: false, error: '保留目标无效' };
    if (p.reserve.length >= HAND_MAX) return { ok: false, error: '保留区已满（最多3张）' };
    const sk = skillOf(s, p);
    let cardId = null, tier = null, slot = -1, fromDeck = false;
    const reservable = (t) => NORMAL_TIERS.includes(t) || (s.pokemartEnabled && PM_TIERS.includes(t));
    const wantPreview = !!(preview && sk === 'misty');
    let deckBefore = null; // 潮汐预读：改状态前的牌堆快照（校验失败时恢复）
    if (target.fromDeck) {
      tier = target.fromDeck;
      if (!reservable(tier)) return { ok: false, error: '稀有/传说不可保留' };
      if (!s.decks[tier].length) return { ok: false, error: '牌堆已空' };
      if (wantPreview) deckBefore = s.decks[tier].slice();
      cardId = s.decks[tier].pop(); fromDeck = true;
    } else {
      cardId = target.fromField;
      const loc = locateCard(s, cardId);
      if (loc.where !== 'field') return { ok: false, error: '该卡不在场上' };
      if (!reservable(loc.tier)) return { ok: false, error: '稀有/传说不可保留' };
      tier = loc.tier; slot = loc.slot;
      if (wantPreview) deckBefore = s.decks[tier].slice();
    }
    p.reserve.push(cardId);
    if (!fromDeck) { s.field[tier][slot] = null; refill(s, tier); }
    // gain a master ball if available; 潮汐预读（小霞）改拿蓝球 + 重排牌堆顶 4 张
    let got = '';
    if (wantPreview) {
      const deck = s.decks[tier];
      const top = deck.slice(-Math.min(4, deck.length));
      const okOrder = Array.isArray(preview.order) && preview.order.length === top.length
        && top.slice().sort().join(',') === preview.order.slice().sort().join(',');
      if (!okOrder) {
        // 回滚：恢复牌堆快照、场上槽位与预留区
        s.decks[tier] = deckBefore;
        if (!fromDeck) s.field[tier][slot] = cardId;
        p.reserve.pop();
        return { ok: false, error: '潮汐预读：牌堆顺序校验失败' };
      }
      const removed = deck.splice(deck.length - top.length, top.length);
      for (const id of preview.order) deck.push(id); // order[0] 为新的最顶
      if (s.supply.blue > 0) { s.supply.blue--; p.tokens.blue++; got = '，潮汐预读：查看牌堆顶并拿1个超级球'; }
      else got = '，潮汐预读：查看牌堆顶（蓝球供应不足）';
      log(s, `${p.name} 保留了${zhTier(tier)}宝可梦（潮汐预读）并重排牌堆顶${top.length}张${got}`);
    } else {
      if (s.supply.purple > 0) { s.supply.purple--; p.tokens.purple++; got = ' 并获得1个大师球'; }
      log(s, `${p.name} 保留了一张${zhTier(tier)}宝可梦${fromDeck ? '（牌堆顶）' : ''}${got}`);
    }
    s.acted = true;
    s.passStreak = 0;                          // 有人真的行动了 → 清零和棋计数
    s.acquiredThisTurn = true;                 // 拿到牌 = 有进展
    return { ok: true, cardId };
  }

  // remove a just-captured card from wherever it sat (field or own reserve)
  function takeFromSource(s, p, loc, fromReserve, cardId) {
    if (fromReserve) { const i = p.reserve.indexOf(cardId); if (i >= 0) p.reserve.splice(i, 1); }
    else { s.field[loc.tier][loc.slot] = null; refill(s, loc.tier); }
  }
  // remove a board card out of the game (Pokémart "discard … returned to the box")
  function discardFromBoard(s, p, id) {
    const i = p.board.indexOf(id);
    if (i >= 0) p.board.splice(i, 1);
    if (p.assoc) delete p.assoc[id];
  }
  // EVOLVE STONE / RARE CANDY: pick an owned card with a real bonus to copy.
  function resolveCopyTarget(s, p, targetId) {
    const cands = p.board.filter(id => effBonusColor(s, p, id));
    if (!cands.length) return { ok: false, error: '进化石需要你已有一张带奖励的卡' };
    if (targetId == null) targetId = cands[0];
    if (cands.indexOf(targetId) < 0) return { ok: false, error: '关联目标必须是你已有的带奖励的卡' };
    return { ok: true, color: effBonusColor(s, p, targetId) };
  }
  // REPEL: choose `discardCount` owned cards of `discardColor` to discard.
  function resolveDiscardBuy(s, p, card, chosen) {
    const color = card.effectParam.discardColor, need = card.effectParam.discardCount;
    const owned = p.board.filter(id => effBonusColor(s, p, id) === color);
    if (owned.length < need) return { ok: false, error: `需要弃掉${need}张${zhBall(color)}卡，但你只有${owned.length}张` };
    if (chosen != null && !Array.isArray(chosen)) return { ok: false, error: '弃牌选择必须是卡牌数组' };
    let discarded;
    if (chosen && chosen.length) {
      if (chosen.length !== need) return { ok: false, error: `必须弃掉${need}张` };
      if (new Set(chosen).size !== chosen.length) return { ok: false, error: '弃牌不能重复选择同一张卡' };
      for (const id of chosen) if (owned.indexOf(id) < 0) return { ok: false, error: '所选弃牌颜色不符或不属于你' };
      discarded = chosen.slice();
    } else {
      discarded = owned.slice(0, need);
    }
    return { ok: true, discarded };
  }

  // "Take a free card" effects (TM / RARE CANDY). The free card comes from the
  // level below: RARE CANDY (pmL2) -> Level 1 (stage1/pmL1); TM (pmL3) -> Level 2.
  function freeTiers(parentCard) {
    if (parentCard.tier === 'pmL2') return ['stage1', 'pmL1'];
    if (parentCard.tier === 'pmL3') return ['stage2', 'pmL2'];
    return [];
  }
  // Is `fc` a free card the player could legally take right now (effect live + any
  // required sub-choice is satisfiable)? Used to decide if the take is mandatory.
  function freeTakeable(s, p, fc) {
    if (isPokemart(fc) && fc.effect && !PM_EFFECTS_LIVE[fc.effect]) return false;
    if (isPokemart(fc) && (fc.effect === 'copy' || fc.effect === 'copy_free'))
      return p.board.some(b => effBonusColor(s, p, b)); // needs a bonus card to copy
    return true;
  }
  // Validate (no mutation) the chain of free takes; returns {ok, steps:[{freeId,assoc}]}.
  function planFree(s, p, parentCard, opts, depth, seen) {
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) return { ok: false, error: '免费取卡参数无效' };
    depth = depth || 0; seen = seen || {};
    if (depth > 4) return { ok: false, error: '免费取卡层级过深' };
    const tiers = freeTiers(parentCard);
    const freeId = opts.freeTakeId;
    if (freeId == null) {
      let any = false;
      for (const t of tiers) for (const id of (s.field[t] || [])) if (id && freeTakeable(s, p, s.byId[id])) any = true;
      return any ? { ok: false, error: '请选择要免费获得的卡（freeTakeId）' } : { ok: true, steps: [] };
    }
    if (seen[freeId]) return { ok: false, error: '免费取卡重复' };
    const loc = locateCard(s, freeId);
    if (loc.where !== 'field' || tiers.indexOf(loc.tier) < 0) return { ok: false, error: '免费卡必须是可选等级中的面朝上卡' };
    const fc = s.byId[freeId];
    if (isPokemart(fc) && fc.effect && !PM_EFFECTS_LIVE[fc.effect]) return { ok: false, error: `免费卡「${fc.name}」效果待实现` };
    const sub = opts.freeOpts || {};
    if (typeof sub !== 'object' || Array.isArray(sub)) return { ok: false, error: '免费取卡子参数无效' };
    let assoc = null;
    if (isPokemart(fc) && (fc.effect === 'copy' || fc.effect === 'copy_free')) {
      const r = resolveCopyTarget(s, p, sub.copyTargetId); if (!r.ok) return r; assoc = r.color;
    }
    let steps = [{ freeId, assoc }];
    if (isPokemart(fc) && (fc.effect === 'free' || fc.effect === 'copy_free')) {
      const ns = Object.assign({}, seen); ns[freeId] = true;
      const rec = planFree(s, p, fc, sub, depth + 1, ns);
      if (!rec.ok) return rec;
      steps = steps.concat(rec.steps);
    }
    return { ok: true, steps };
  }
  function execFree(s, p, steps) {
    for (const st of steps) {
      const loc = locateCard(s, st.freeId);
      if (loc.where === 'field') { s.field[loc.tier][loc.slot] = null; refill(s, loc.tier); }
      p.board.push(st.freeId);
      if (st.assoc) { p.assoc = p.assoc || {}; p.assoc[st.freeId] = st.assoc; }
      log(s, `${p.name} 免费获得 ${s.byId[st.freeId].name}${st.assoc ? `（关联${zhBall(st.assoc)}）` : ''}`);
    }
  }

  // opts (all optional, used by Pokémart effects):
  //   copyTargetId  — board card id to copy a bonus from (EVOLVE STONE / RARE CANDY)
  //   spendPokedex  — board POKÉDEX ids to discard, each worth 2 virtual master balls
  //   discardCards  — board card ids to discard to pay for a REPEL (discard_buy)
  //   freeTakeId + freeOpts — the free card to take (TM / RARE CANDY), and its own choices
  function actionCapture(s, cardId, opts) {
    opts = opts || {};
    if (typeof opts !== 'object' || Array.isArray(opts)) return { ok: false, error: '捕捉参数无效' };
    const p = activePlayer(s);
    if (s.acted) return { ok: false, error: '本回合已行动' };
    const card = s.byId[cardId];
    if (!card) return { ok: false, error: '无此卡' };
    if (isPokemart(card) && card.effect && !PM_EFFECTS_LIVE[card.effect]) {
      return { ok: false, error: `Pokémart「${card.name}」效果待实现（后续阶段）` };
    }
    const loc = locateCard(s, cardId);
    const fromReserve = loc.where === 'reserve' && loc.owner === p.id;
    if (loc.where !== 'field' && !fromReserve) return { ok: false, error: '只能捕捉场上或自己保留区的宝可梦' };

    // --- REPEL (discard_buy): no token cost; discard owned cards of a colour ---
    if (isPokemart(card) && card.effect === 'discard_buy') {
      const r = resolveDiscardBuy(s, p, card, opts.discardCards);
      if (!r.ok) return r;
      takeFromSource(s, p, loc, fromReserve, cardId);
      for (const did of r.discarded) discardFromBoard(s, p, did);
      p.board.push(cardId);
      s.acted = true;
      s.passStreak = 0;                          // 有人真的行动了 → 清零和棋计数
      s.acquiredThisTurn = true;                 // 买到牌 = 有进展
      s.capturedThisTurn = true;                 // 训练家技能扩展：火箭队·捕获装置
      log(s, `${p.name} 用${card.name}获得（弃掉${r.discarded.length}张${zhBall(card.effectParam.discardColor)}卡）`);
      return { ok: true };
    }

    // --- optional: discard POKÉDEX cards as 2 virtual master balls each ---
    if (opts.spendPokedex != null && !Array.isArray(opts.spendPokedex)) return { ok: false, error: '图鉴消耗必须是卡牌数组' };
    const spend = Array.isArray(opts.spendPokedex) ? opts.spendPokedex : [];
    if (new Set(spend).size !== spend.length) return { ok: false, error: '图鉴不能重复消耗同一张卡' };
    for (const pid of spend) {
      const pc = s.byId[pid];
      if (p.board.indexOf(pid) < 0 || !(isPokemart(pc) && pc.effect === 'colorless_master')) {
        return { ok: false, error: '无效的图鉴消耗' };
      }
    }
    const payment = computePayment(s, p, card, spend.length * 2);
    if (!payment.ok) return { ok: false, error: payment.error };

    // --- EVOLVE STONE / RARE CANDY (copy): associate with an owned bonus card ---
    let assocColor = null;
    if (isPokemart(card) && (card.effect === 'copy' || card.effect === 'copy_free')) {
      const r = resolveCopyTarget(s, p, opts.copyTargetId);
      if (!r.ok) return r;
      assocColor = r.color;
    }
    // --- TM / RARE CANDY (free / copy_free): plan the free take(s) up front ---
    let freeSteps = null;
    if (isPokemart(card) && (card.effect === 'free' || card.effect === 'copy_free')) {
      const fp = planFree(s, p, card, opts, 0);
      if (!fp.ok) return fp;
      freeSteps = fp.steps;
    }

    // 虚拟大师球（图鉴）优先覆盖紫色支付：真实 purple 扣减 = pay.purple − virtualMaster
    const realPay = Object.assign({}, payment.pay, {
      purple: Math.max(0, (payment.pay.purple || 0) - (payment.virtualMaster || 0)),
    });
    payTokens(s, p, realPay);
    for (const pid of spend) discardFromBoard(s, p, pid); // virtual masters consumed
    takeFromSource(s, p, loc, fromReserve, cardId);
    p.board.push(cardId);
    if (assocColor) { p.assoc = p.assoc || {}; p.assoc[cardId] = assocColor; }
    s.acted = true;
    s.passStreak = 0;                          // 有人真的行动了 → 清零和棋计数
    s.acquiredThisTurn = true;                 // 买到牌 = 有进展
    s.capturedThisTurn = true;
    const extra = spend.length ? `，弃${spend.length}图鉴抵${spend.length * 2}万能` : '';
    const asc = assocColor ? `，关联${zhBall(assocColor)}` : '';
    const dragonTag = payment.dragonConverted ? `，龙之怒换算${payment.dragonConverted}个大师球` : '';
    // 快龙降临（阿渡）：获得稀有/传说精灵时，任意领取 1 颗非大师球
    let bless = '';
    if (skillOf(s, p) === 'lance' && SPECIAL_TIERS.indexOf(card.tier) >= 0) {
      let bc = (COLORS.indexOf(opts.blessColor) >= 0) ? opts.blessColor : null;
      if (bc == null) { // 自动兜底：选供应最充足的颜色（人类 UI 会显式选择）
        let best = COLORS[0], bs = -1;
        for (const c of COLORS) if (s.supply[c] > bs) { bs = s.supply[c]; best = c; }
        bc = best;
      }
      if (s.supply[bc] > 0) {
        s.supply[bc]--; p.tokens[bc]++;
        bless = `，快龙降临领取1个${zhBall(bc)}`;
      }
    }
    log(s, `${p.name} 捕捉了 ${card.name}（${payDesc(payment.pay)}${extra}${asc}${dragonTag}${bless}）`);
    if (freeSteps && freeSteps.length) execFree(s, p, freeSteps);
    return { ok: true };
  }

  // ----------------------- evolution (end of turn) -------------------
  // List the legal evolutions available right now for the active player.
  // Evolution is by SPECIES: a caught Pokémon evolves into ANY available
  // card of its next-form species (on the field or in the player's hand).
  function evolutionOptions(s, player) {
    const opts = [];
    if (s.evolvedThisTurn) return opts; // only one evolution per turn
    const sk = skillOf(s, player);
    const b = bonuses(s, player);
    // 威压（坂木）：被标记的精灵无法进化，需先支付同色球清除标记
    const sealedIds = {};
    (player.seals || []).forEach(se => { sealedIds[se.cardId] = se; });
    // available evolution targets: field cards + this player's reserve
    const avail = [];
    for (const tier of FIELD_TIERS) s.field[tier].forEach((id, slot) => { if (id) avail.push({ id, where: 'field', tier, slot }); });
    player.reserve.forEach((id, slot) => avail.push({ id, where: 'reserve', slot }));
    for (const id of player.board) {
      const c = s.byId[id];
      if (!c.evolvesTo || !c.evoCost) continue;
      if (sealedIds[id]) continue; // 被威压标记：无法进化
      const gap = c.evoCost.count - (b[c.evoCost.color] || 0);
      if (gap <= 0) {
        // 正常进化：折扣球已满足
        for (const a of avail) {
          if (s.byId[a.id].name !== c.evolvesTo) continue;
          opts.push({
            fromId: id, toId: a.id,
            color: c.evoCost.color, count: c.evoCost.count,
            targetWhere: a.where,
          });
        }
      } else if (sk === 'ash') {
        // 羁绊进化（小智）：缺口 X 个指定颜色图标，可支付该色 2X 颗补足完成进化
        const payCount = gap * 2;
        if ((player.tokens[c.evoCost.color] || 0) >= payCount) {
          for (const a of avail) {
            if (s.byId[a.id].name !== c.evolvesTo) continue;
            opts.push({
              fromId: id, toId: a.id,
              color: c.evoCost.color, count: c.evoCost.count, gap,
              bond: true, payCount,
              targetWhere: a.where,
            });
          }
        }
      }
    }
    return opts;
  }

  function actionEvolve(s, fromId, toId) {
    const p = activePlayer(s);
    if (s.evolvedThisTurn) return { ok: false, error: '本回合已进化过' };
    const cands = evolutionOptions(s, p).filter(o => o.fromId === fromId);
    const opt = (toId != null) ? cands.find(o => o.toId === toId) : cands[0];
    if (!opt) return { ok: false, error: '不满足进化条件' };
    // 羁绊进化（小智）：缺口 X 个图标 → 实付该色 2X 颗精灵球补足
    if (opt.bond) {
      if ((p.tokens[opt.color] || 0) < opt.payCount) return { ok: false, error: '羁绊进化：精灵球不足' };
      p.tokens[opt.color] -= opt.payCount; s.supply[opt.color] += opt.payCount;
    }
    // move target out of field/reserve
    const loc = locateCard(s, opt.toId);
    if (loc.where === 'field') { s.field[loc.tier][loc.slot] = null; refill(s, loc.tier); }
    else if (loc.where === 'reserve') { s.players[loc.owner].reserve.splice(loc.slot, 1); }
    // replace on board: remove fromId -> buried; add toId
    const bi = p.board.indexOf(fromId);
    p.board.splice(bi, 1);
    p.buried.push(fromId);
    p.board.push(opt.toId);
    s.evolvedThisTurn = true;
    s.acquiredThisTurn = true;                 // 进化也拿了新牌 = 有进展
    const payNote = opt.bond ? `（羁绊进化支付${opt.payCount}个${zhBall(opt.color)}）` : '';
    log(s, `${p.name} 将 ${s.byId[fromId].name} 进化为 ${s.byId[opt.toId].name}${payNote}`);
    return { ok: true, fromId, toId: opt.toId };
  }

  // ----------------------- Megas expansion ---------------------------
  // Main action: spend your whole turn to take one Mega token (max 1 held).
  function actionTakeMega(s) {
    const p = activePlayer(s);
    if (!s.megasEnabled) return { ok: false, error: '未启用 Megas 扩展' };
    if (s.acted) return { ok: false, error: '本回合已行动' };
    if (p.megaToken >= 1) return { ok: false, error: '已持有 Mega 代币（上限1）' };
    if (s.supply.megaToken < 1) return { ok: false, error: '没有可用的 Mega 代币' };
    s.supply.megaToken--; p.megaToken++;
    s.acted = true;
    s.passStreak = 0;                          // 有人真的行动了 → 清零和棋计数
    log(s, `${p.name} 获得了 1 个 Mega 代币`);
    return { ok: true };
  }

  // End-of-turn Mega evolution options. Requires: you hold a Mega token, you
  // have captured the base Pokémon (megaFrom) in play, and you can pay the Mega
  // card's cost (balls reduced by bonuses; master ball substitutes). Counts as
  // this turn's single evolution (shares evolvedThisTurn).
  function megaEvolveOptions(s, player) {
    const opts = [];
    if (!s.megasEnabled || s.evolvedThisTurn || player.megaToken < 1) return opts;
    for (const megaId of s.megaOffer) {
      const mega = s.byId[megaId];
      const fromId = player.board.find(id => s.byId[id].name === mega.megaFrom);
      if (!fromId) continue;
      if (!canAfford(s, player, mega)) continue;
      opts.push({ megaId, fromId, fromName: mega.megaFrom, megaName: mega.name });
    }
    return opts;
  }

  function actionMegaEvolve(s, megaId, fromId) {
    const p = activePlayer(s);
    if (!s.megasEnabled) return { ok: false, error: '未启用 Megas 扩展' };
    if (s.evolvedThisTurn) return { ok: false, error: '本回合已进化过' };
    const cands = megaEvolveOptions(s, p).filter(o => o.megaId === megaId);
    const opt = (fromId != null) ? cands.find(o => o.fromId === fromId) : cands[0];
    if (!opt) return { ok: false, error: '不满足超级进化条件' };
    const mega = s.byId[megaId];
    const payment = computePayment(s, p, mega);
    if (!payment.ok) return { ok: false, error: payment.error };
    payTokens(s, p, payment.pay);
    // consume the Mega token (returns to the shared pool)
    p.megaToken--; s.supply.megaToken++;
    // bury the base Pokémon, take the Mega card out of the offer, place it in play
    const bi = p.board.indexOf(opt.fromId);
    p.board.splice(bi, 1); p.buried.push(opt.fromId);
    s.megaOffer = s.megaOffer.filter(id => id !== megaId);
    p.board.push(megaId);
    s.evolvedThisTurn = true;
    s.acquiredThisTurn = true;                 // 进化也拿了新牌 = 有进展
    log(s, `${p.name} 将 ${s.byId[opt.fromId].name} 超级进化为 ${mega.name}（${payDesc(payment.pay)}）`);
    return { ok: true, megaId, fromId: opt.fromId };
  }

  // Win trigger. Base game: 18 VP. Megas: 20 VP AND ≥1 captured card of every
  // color AND ≥1 Mega in play.
  function hasMegaWin(s, p) {
    if (scoreOf(s, p) < MEGA_WIN_SCORE) return false;
    const b = bonuses(s, p);
    if (!COLORS.every(c => b[c] > 0)) return false;
    return p.board.some(id => s.byId[id].tier === 'mega');
  }
  function winTriggered(s, p) {
    return s.megasEnabled ? hasMegaWin(s, p) : (scoreOf(s, p) >= (s.winScore || WIN_SCORE));
  }

  // --------------------------- discard -------------------------------
  function needsDiscard(s, player) { return tokenTotal(player) > TOKEN_MAX; }
  function actionDiscard(s, color) {
    const p = activePlayer(s);
    if (!p.tokens[color]) return { ok: false, error: '没有该精灵球' };
    p.tokens[color]--; s.supply[color]++;
    log(s, `${p.name} 归还了1个${zhBall(color)}`);
    return { ok: true };
  }

  // A legitimate pass: only allowed when the player genuinely has no legal
  // main action (e.g. supply drained, nothing affordable, hand full).
  function actionPass(s) {
    if (s.acted) return { ok: false, error: '本回合已行动' };
    if (legalActions(s).length) return { ok: false, error: '尚有可执行的行动' };
    s.acted = true;
    s.passStreak = (s.passStreak || 0) + 1;   // 连续跳过计数，用于和棋判定
    log(s, `${activePlayer(s).name} 无法行动，跳过回合`);
    return { ok: true };
  }

  // ----------------------- 训练家主动技能 -------------------------
  // 主动技能均为免费动作（不占用主行动 s.acted），结算于引擎内。

  // 超能转换（娜姿）：每个你的回合限 1 次。支付 3 颗任意精灵球，获得 1 颗大师球。
  function actionPsychicConvert(s, colors) {
    const p = activePlayer(s);
    if (s.phase !== 'play') return { ok: false, error: '非行动阶段' };
    if (skillOf(s, p) !== 'sabrina') return { ok: false, error: '仅娜姿可用（超能转换）' };
    if (p.psychicUsed) return { ok: false, error: '超能转换每回合限用 1 次' };
    if (!Array.isArray(colors) || colors.length !== 3) return { ok: false, error: '超能转换需选择 3 颗精灵球' };
    for (const c of colors) if (!COLORS.includes(c)) return { ok: false, error: '只能支付普通精灵球' };
    for (const c of colors) if ((p.tokens[c] || 0) < 1) return { ok: false, error: `没有足够的${zhBall(c)}` };
    if (s.supply.purple <= 0) return { ok: false, error: '大师球供应不足' };
    for (const c of colors) { p.tokens[c]--; s.supply[c]++; }
    s.supply.purple--; p.tokens.purple++;
    p.psychicUsed = true;
    log(s, `${p.name} 使用技能·超能转换，支付 ${colors.map(zhBall).join('、')}，获得 1 个大师球`);
    return { ok: true };
  }

  // 精神压制（娜姿）：非大师球 ≥4 时发动。弃置自己所有非大师球（记 N），
  // 并从其他玩家手中合计弃置 K 颗非大师球到公共池（K = N-1/N/11，N=4-6/7-9/10）。
  // targets（可选）：[{toPlayer, color, count}] 显式分配；省略则引擎自动从其他
  // 玩家持有最多的球开始弃。
  function actionSuppress(s, targets) {
    const p = activePlayer(s);
    if (s.phase !== 'play') return { ok: false, error: '非行动阶段' };
    if (skillOf(s, p) !== 'sabrina') return { ok: false, error: '仅娜姿可用（精神压制）' };
    const mine = COLORS.filter(c => p.tokens[c] > 0);
    const N = mine.reduce((a, c) => a + p.tokens[c], 0);
    if (N < 4) return { ok: false, error: '精神压制需持有至少 4 颗非大师球' };
    // 弃置自己全部非大师球 → 公共池
    for (const c of mine) { s.supply[c] += p.tokens[c]; p.tokens[c] = 0; }
    const K = N >= 10 ? 11 : (N >= 7 ? N : N - 1);
    // 其他玩家可被弃的非大师球
    const others = s.players.filter(x => x.id !== p.id);
    const availOf = (pl) => COLORS.reduce((a, c) => a + Math.max(0, pl.tokens[c]), 0);
    const totalAvail = others.reduce((a, pl) => a + availOf(pl), 0);
    const Kp = Math.min(K, totalAvail);
    let spent = 0;
    if (Array.isArray(targets) && targets.length) {
      for (const t of targets) {
        if (!t || t.toPlayer === p.id) return { ok: false, error: '目标无效' };
        const tp = s.players[t.toPlayer];
        if (!tp) return { ok: false, error: '目标玩家无效' };
        if (!COLORS.includes(t.color)) return { ok: false, error: '不能弃置大师球' };
        if ((tp.tokens[t.color] || 0) < t.count) return { ok: false, error: '目标没有足够的球' };
        spent += t.count;
      }
      if (spent > Kp) return { ok: false, error: '合计弃置数超过上限' };
      for (const t of targets) { s.supply[t.color] += t.count; s.players[t.toPlayer].tokens[t.color] -= t.count; }
    } else {
      // 自动分配：从其他玩家持有最多的颜色开始弃，直至 Kp
      const pool = [];
      others.forEach(pl => COLORS.forEach(c => { if (pl.tokens[c] > 0) pool.push({ pl, c, n: pl.tokens[c] }); }));
      pool.sort((a, b) => b.n - a.n);
      for (const it of pool) {
        if (spent >= Kp) break;
        const take = Math.min(it.n, Kp - spent);
        s.supply[it.c] += take; it.pl.tokens[it.c] -= take; spent += take;
      }
    }
    const desc = spent ? `，从其他玩家合计弃置 ${spent} 颗` : '';
    log(s, `${p.name} 使用技能·精神压制，弃置自己 ${N} 颗精灵球${desc}`);
    return { ok: true, N, K: Kp };
  }

  // 威压（坂木）：支付 1 颗任意精灵球，盖在对方 1 张精灵卡上作标记；
  // 该精灵进化前需先支付 1 颗同色精灵球清除标记。
  function actionIntimidate(s, targetIdx, cardId, color) {
    const p = activePlayer(s);
    if (s.phase !== 'play') return { ok: false, error: '非行动阶段' };
    if (skillOf(s, p) !== 'giovanni') return { ok: false, error: '仅坂木可用（威压）' };
    if (!ALL_TOKENS.includes(color)) return { ok: false, error: '请选择一种精灵球' };
    if ((p.tokens[color] || 0) < 1) return { ok: false, error: `没有足够的${zhBall(color)}` };
    const tp = s.players[targetIdx];
    if (!tp || targetIdx === p.id) return { ok: false, error: '目标无效' };
    if (tp.board.indexOf(cardId) < 0) return { ok: false, error: '目标玩家场上没有该精灵' };
    tp.seals = tp.seals || [];
    if (tp.seals.some(se => se.cardId === cardId)) return { ok: false, error: '该精灵已被标记' };
    p.tokens[color]--; s.supply[color]++;
    tp.seals.push({ cardId, color });
    log(s, `${p.name} 使用技能·威压，支付 1 个${zhBall(color)}，标记了 ${tp.name} 的 ${s.byId[cardId].name}`);
    return { ok: true };
  }

  // 清除标记：被威压标记的玩家，在其回合内支付 1 颗同色精灵球移除标记。
  function actionClearSeal(s, cardId) {
    const p = activePlayer(s);
    if (s.phase !== 'play') return { ok: false, error: '非行动阶段' };
    const seals = p.seals || [];
    const se = seals.find(x => x.cardId === cardId);
    if (!se) return { ok: false, error: '该精灵未被标记' };
    if ((p.tokens[se.color] || 0) < 1) return { ok: false, error: `需要 1 个${zhBall(se.color)}清除标记` };
    p.tokens[se.color]--; s.supply[se.color]++;
    p.seals = seals.filter(x => x.cardId !== cardId);
    log(s, `${p.name} 支付 1 个${zhBall(se.color)}，清除了 ${s.byId[cardId].name} 上的威压标记`);
    return { ok: true };
  }

  // 肃清（坂木）：指定对方 1 张精灵卡，支付其牌面捕捉成本（自己的折扣可抵扣普通球）
  // + 额外 2 颗大师球（必须实付），将其移除游戏；对方获得 2 颗大师球补偿。
  function actionPurge(s, targetIdx, cardId) {
    const p = activePlayer(s);
    if (s.phase !== 'play') return { ok: false, error: '非行动阶段' };
    if (skillOf(s, p) !== 'giovanni') return { ok: false, error: '仅坂木可用（肃清）' };
    const tp = s.players[targetIdx];
    if (!tp || targetIdx === p.id) return { ok: false, error: '目标无效' };
    if (tp.board.indexOf(cardId) < 0) return { ok: false, error: '目标玩家场上没有该精灵' };
    const card = s.byId[cardId];
    const pay1 = computePayment(s, p, card);       // 牌面成本（bonus 抵扣普通球）
    if (!pay1.ok) return { ok: false, error: pay1.error };
    if ((p.tokens.purple - pay1.pay.purple) < 2) return { ok: false, error: '额外 2 颗大师球必须实付' };
    if (s.supply.purple < 2) return { ok: false, error: '大师球供应不足（需补偿目标 2 颗）' };
    payTokens(s, p, pay1.pay);
    p.tokens.purple -= 2; s.supply.purple += 2;   // 额外 2 颗大师球实付
    s.supply.purple -= 2; tp.tokens.purple += 2;   // 补偿目标 2 颗大师球
    // 移除游戏：从目标场上彻底移除（失去分数与折扣），不埋藏
    tp.board.splice(tp.board.indexOf(cardId), 1);
    if (tp.assoc) delete tp.assoc[cardId];
    log(s, `${p.name} 使用技能·肃清，支付 ${payDesc(pay1.pay)}+2大师球，将 ${tp.name} 的 ${card.name} 移除游戏；${tp.name} 获得 2 颗大师球补偿`);
    return { ok: true, cardId };
  }

  // 潮汐预读·预检（不改状态）：模拟"预留完成后"该等级牌堆的顶 4 张，
  // 供 UI / 联机房间在玩家重排前安全地 peek。返回 {ok, cardId, tier, top}。
  function actionReservePreview(s, target) {
    const p = activePlayer(s);
    if (!target || typeof target !== 'object' || Array.isArray(target)) return { ok: false, error: '保留目标无效' };
    if (p.reserve.length >= HAND_MAX) return { ok: false, error: '保留区已满（最多3张）' };
    const reservable = (t) => NORMAL_TIERS.includes(t) || (s.pokemartEnabled && PM_TIERS.includes(t));
    if (target.fromDeck) {
      const tier = target.fromDeck;
      if (!reservable(tier)) return { ok: false, error: '稀有/传说不可保留' };
      const deck = s.decks[tier];
      if (!deck.length) return { ok: false, error: '牌堆已空' };
      const cardId = deck[deck.length - 1]; // 预留的卡（将 pop）
      const top = deck.slice(-Math.min(4, deck.length - 1)); // pop 后的顶 4 张
      return { ok: true, cardId, tier, top };
    }
    const cardId = target.fromField;
    const loc = locateCard(s, cardId);
    if (loc.where !== 'field') return { ok: false, error: '该卡不在场上' };
    if (!reservable(loc.tier)) return { ok: false, error: '稀有/传说不可保留' };
    const tier = loc.tier;
    const deck = s.decks[tier].slice();
    let nulls = s.field[tier].reduce((a, x) => a + (x == null ? 1 : 0), 0) + 1; // +1 = 本卡槽将置空
    const pops = Math.min(nulls, deck.length); // refill 将 pop 的张数
    const top = deck.slice(Math.max(0, deck.length - pops - 4), deck.length - pops);
    return { ok: true, cardId, tier, top };
  }

  // --------------------------- turn flow -----------------------------
  // Call after the main action. Resolves discard requirement and lets the
  // caller present evolution options; then endTurn() advances.
  function turnState(s) {
    const p = activePlayer(s);
    return {
      acted: s.acted,
      mustDiscard: needsDiscard(s, p) ? (tokenTotal(p) - TOKEN_MAX) : 0,
      evolutions: evolutionOptions(s, p),
      megaEvolutions: megaEvolveOptions(s, p),
    };
  }

  function endTurn(s) {
    const p = activePlayer(s);
    if (!s.acted) return { ok: false, error: '尚未行动' };
    if (needsDiscard(s, p)) return { ok: false, error: '请先归还多余精灵球（上限10）' };
    // check win trigger (someone reached the target this turn)
    if (winTriggered(s, p) && !s.lastRound) {
      s.lastRound = true;
      const why = s.megasEnabled ? `${MEGA_WIN_SCORE}分+集齐每色+1只Mega` : `${s.winScore || WIN_SCORE} 分`;
      log(s, `${p.name} 达成胜利条件（${why}），进入最后一轮！`);
    }
    // The game ends once the LAST player of the round finishes during the
    // final round, so every Trainer has taken an equal number of turns.
    // 和棋（僵局）判定：如果连续一整圈每个人都「无合法行动只能跳过」，
    // 说明牌与球都已耗尽而胜利条件无人能达成（Megas 的资格条件下可复现）。
    // 实体游戏没规定这种情况，但数字版必须终止 —— 否则联机房间会永久卡死。
    // 按现有分数与既定平局规则结算。
    // 无进展判定：只要没人拿到任何新牌，就累计「空转回合」。
    // 已复现的死循环：牌堆见底、双方满 10 球，场上只剩「拿 1 个球」一个合法行动，
    // 拿完必须弃掉，净变化为零 —— 有合法行动，却永远不会结束。
    // 阈值取 8 整圈（2人局=16 手）远高于真实对局的最长「无人买牌」间隔（开局约 3-4 手）。
    if (s.acquiredThisTurn) s.idleTurns = 0;
    else s.idleTurns = (s.idleTurns || 0) + 1;
    s.acquiredThisTurn = false;
    if ((s.passStreak || 0) >= s.numPlayers || (s.idleTurns || 0) >= s.numPlayers * 8) {
      s.phase = 'gameover';
      s.winner = determineWinner(s);
      s.stalemate = true;
      log(s, `所有训练家都已无法行动，牌局结束（按当前分数结算），胜者：${s.players[s.winner].name}`);
      return { ok: true, gameover: true, stalemate: true };
    }
    const wasLastPlayer = s.turn === s.numPlayers - 1;
    if (s.lastRound && wasLastPlayer) {
      s.phase = 'gameover';
      s.winner = determineWinner(s);
      log(s, `游戏结束，胜者：${s.players[s.winner].name}`);
      return { ok: true, gameover: true };
    }
    s.turn = (s.turn + 1) % s.numPlayers;
    if (wasLastPlayer) s.round++;
    s.acted = false; s.taken = []; s.evolvedThisTurn = false; s.capturedThisTurn = false;
    p.psychicUsed = false; // 超能转换：回合级限制随回合重置
    return { ok: true };
  }

  function determineWinner(s) {
    // most VP, then most buried (evolutions), then most board cards
    const rank = (p) => [scoreOf(s, p), p.buried.length, p.board.length];
    // Eligibility: in the Megas variant only a player who actually achieves the
    // win condition (20 VP + every colour + a Mega in play) can win — a rival with
    // more raw points but no Mega/colour set does NOT. (Base game: everyone is
    // eligible; the highest score already implies they crossed the threshold.)
    let pool = [];
    for (let i = 0; i < s.numPlayers; i++) pool.push(i);
    if (s.megasEnabled) {
      const q = pool.filter(i => hasMegaWin(s, s.players[i]));
      if (q.length) pool = q;   // fall back to all only in the pathological "nobody qualifies" case
    }
    let best = pool[0];
    for (const i of pool) {
      const a = rank(s.players[i]), b = rank(s.players[best]);
      if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) best = i;
    }
    return best;
  }

  // One concrete, fully parameterised free-card chain for generic callers
  // (server fallback / pass validation).  The strategic AI enumerates more
  // alternatives, but every action returned here must be directly executable.
  function defaultFreePlans(s, p, parent, depth, seen) {
    depth = depth || 0; seen = seen || {};
    if (depth > 4) return [];
    const out = [];
    for (const tier of freeTiers(parent)) for (const id of (s.field[tier] || [])) {
      if (!id || seen[id]) continue;
      const card = s.byId[id];
      if (!freeTakeable(s, p, card)) continue;
      const sub = {};
      if (isPokemart(card) && (card.effect === 'copy' || card.effect === 'copy_free')) {
        const target = p.board.find(bid => effBonusColor(s, p, bid));
        if (!target) continue;
        sub.copyTargetId = target;
      }
      let nested = [{}];
      if (isPokemart(card) && (card.effect === 'free' || card.effect === 'copy_free')) {
        const ns = Object.assign({}, seen); ns[id] = true;
        nested = defaultFreePlans(s, p, card, depth + 1, ns);
        if (!nested.length) continue;
      }
      for (const next of nested) {
        const freeOpts = Object.assign({}, sub, next);
        out.push({ freeTakeId: id, freeOpts });
        if (out.length >= 32) return out;
      }
    }
    if (!out.length) {
      const none = planFree(s, p, parent, {}, depth, seen);
      if (none.ok) out.push({});
    }
    return out;
  }

  function defaultCaptureAction(s, p, id) {
    const card = s.byId[id]; if (!card) return null;
    if (isPokemart(card) && card.effect && !PM_EFFECTS_LIVE[card.effect]) return null;
    if (isPokemart(card) && card.effect === 'discard_buy') {
      const color = card.effectParam.discardColor, need = card.effectParam.discardCount;
      const owned = p.board.filter(bid => effBonusColor(s, p, bid) === color);
      return owned.length >= need ? { type: 'capture', cardId: id, opts: { discardCards: owned.slice(0, need) } } : null;
    }
    const opts = {};
    if (!canAfford(s, p, card)) {
      const dex = p.board.filter(bid => isPokemart(s.byId[bid]) && s.byId[bid].effect === 'colorless_master');
      let spend = null;
      for (let n = 1; n <= dex.length; n++) if (computePayment(s, p, card, n * 2).ok) { spend = dex.slice(0, n); break; }
      if (!spend) return null;
      opts.spendPokedex = spend;
    }
    if (isPokemart(card) && (card.effect === 'copy' || card.effect === 'copy_free')) {
      const target = p.board.find(bid => effBonusColor(s, p, bid));
      if (!target) return null;
      opts.copyTargetId = target;
    }
    if (isPokemart(card) && (card.effect === 'free' || card.effect === 'copy_free')) {
      const plans = defaultFreePlans(s, p, card, 0, {});
      let found = null;
      for (const plan of plans) {
        const merged = Object.assign({}, opts, plan);
        if (planFree(s, p, card, merged, 0, {}).ok) { found = merged; break; }
      }
      if (!found) return null;
      return { type: 'capture', cardId: id, opts: found };
    }
    const action = { type: 'capture', cardId: id };
    if (Object.keys(opts).length) action.opts = opts;
    return action;
  }

  // ------------------- legal move enumeration (for AI) ---------------
  // Auto-plan the choice parameters of an effect capture so search/AI can play
  // Pokémart cards without a UI: copy targets pick the player's DEEPEST bonus
  // colour (coherence), discard_buy sacrifices the least valuable owned cards,
  // free-takes pick the best available card (VP, bonuses, evolvability) and
  // recurse for chained effects. Returns an opts object for actionCapture.
  function autoCaptureOpts(s, p, card) {
    const opts = {};
    const pickCopyTarget = () => {
      const cands = p.board.filter(id => effBonusColor(s, p, id));
      if (!cands.length) return null;
      const b = bonuses(s, p);
      let best = cands[0], bs = -1;
      for (const id of cands) { const v = b[effBonusColor(s, p, id)]; if (v > bs) { bs = v; best = id; } }
      return best;
    };
    if (card.effect === 'copy' || card.effect === 'copy_free') {
      const t = pickCopyTarget(); if (t) opts.copyTargetId = t;
    }
    if (card.effect === 'discard_buy') {
      const col = card.effectParam.discardColor, need = card.effectParam.discardCount;
      const owned = p.board.filter(id => effBonusColor(s, p, id) === col);
      // sacrifice the least valuable first: low VP, not evolvable, single bonus
      owned.sort((a, c) => {
        const A = s.byId[a], C = s.byId[c];
        return ((A.vp || 0) * 4 + (A.evolvesTo ? 3 : 0) + (A.bonusCount || 1))
             - ((C.vp || 0) * 4 + (C.evolvesTo ? 3 : 0) + (C.bonusCount || 1));
      });
      opts.discardCards = owned.slice(0, need);
    }
    if (card.effect === 'free' || card.effect === 'copy_free') {
      let best = null, bs = -1e9;
      for (const t of freeTiers(card)) for (const id of (s.field[t] || [])) {
        if (!id) continue;
        const fc = s.byId[id];
        if (!freeTakeable(s, p, fc)) continue;
        const v = (fc.vp || 0) * 3 + (fc.bonusCount || 1) * 2 + (fc.evolvesTo ? 1 : 0);
        if (v > bs) { bs = v; best = fc; }
      }
      if (best) {
        opts.freeTakeId = best.id;
        const sub = {};
        if (isPokemart(best) && (best.effect === 'copy' || best.effect === 'copy_free')) {
          const t = pickCopyTarget(); if (t) sub.copyTargetId = t;
        }
        if (isPokemart(best) && (best.effect === 'free' || best.effect === 'copy_free')) {
          // chained free-take: plan one level deep with the same rule
          const rec = autoCaptureOpts(s, p, best);
          if (rec.freeTakeId) { sub.freeTakeId = rec.freeTakeId; sub.freeOpts = rec.freeOpts || {}; }
        }
        opts.freeOpts = sub;
      }
      // no takeable free card → effect fizzles, capture still legal (planFree allows it)
    }
    return opts;
  }

  function legalActions(s) {
    const p = activePlayer(s);
    if (s.acted || s.phase !== 'play') return [];
    const acts = [];
    // Megas: spending the whole turn on a Mega token is a real action — the AI
    // must be able to plan it (required for the 20VP+colours+Mega win).
    if (s.megasEnabled && p.megaToken < 1 && s.supply.megaToken > 0 && s.megaOffer.length) {
      acts.push({ type: 'takeMega' });
    }
    // takes
    const avail = COLORS.filter(c => s.supply[c] > 0);
    const sk = skillOf(s, p);
    // 3 distinct
    for (let i = 0; i < avail.length; i++)
      for (let j = i + 1; j < avail.length; j++)
        for (let k = j + 1; k < avail.length; k++)
          acts.push({ type: 'take', colors: [avail[i], avail[j], avail[k]] });
    // fewer-than-3 distinct only if <3 colors available
    if (avail.length === 2) acts.push({ type: 'take', colors: [avail[0], avail[1]] });
    if (avail.length === 1) acts.push({ type: 'take', colors: [avail[0]] });
    // 2 same；花语采集（莉佳）可 2 同色 + 1 异色
    for (const c of COLORS) {
      if (s.supply[c] >= 4) acts.push({ type: 'take', colors: [c, c] });
      if (sk === 'erika' && s.supply[c] >= 2) {
        for (const d of COLORS) {
          if (d !== c && s.supply[d] > 0) acts.push({ type: 'take', colors: [c, c, d] });
        }
      }
    }
    // captures (field + own reserve), including one executable default choice
    // for every PokéMart effect. Strategic callers may expand more alternatives.
    const capIds = [];
    for (const tier of fieldTiers(s)) for (const id of s.field[tier]) if (id) capIds.push(id);
    for (const id of p.reserve) capIds.push(id);
    for (const id of capIds) {
      const card = s.byId[id], action = defaultCaptureAction(s, p, id);
      if (!action) continue;
      // Preserve the guaranteed-executable fallback (including POKÉDEX
      // payment), while upgrading PokéMart choices to the engine's strategic
      // copy/discard/free defaults used by search and timeout takeover.
      if (isPokemart(card) && card.effect) {
        action.opts = Object.assign({}, action.opts || {}, autoCaptureOpts(s, p, card));
      }
      acts.push(action);
    }
    // reserves (base levels + Pokémart levels)
    if (p.reserve.length < HAND_MAX) {
      const reserveTiers = s.pokemartEnabled ? NORMAL_TIERS.concat(PM_TIERS) : NORMAL_TIERS;
      for (const tier of reserveTiers) {
        for (const id of s.field[tier]) if (id) acts.push({ type: 'reserve', target: { fromField: id } });
        if (s.decks[tier].length) acts.push({ type: 'reserve', target: { fromDeck: tier } });
      }
    }
    return acts;
  }

  // Total reducer: a single validate-and-apply chokepoint for EVERY move, so
  // both local clicks and network messages flow through one path. The move's
  // {type,...} object is the wire format. `playerId` is an optional ownership
  // guard for networked play (reject a move submitted for a seat that isn't the
  // active player); local/AI callers omit it. End-of-turn steps (evolve / mega
  // / discard / endTurn) are included so a turn's whole lifecycle is serialisable.
  function applyAction(s, a, playerId) {
    if (!a || typeof a !== 'object' || Array.isArray(a) || typeof a.type !== 'string')
      return { ok: false, error: '无效的行动格式' };
    if (playerId != null && playerId !== s.turn) return { ok: false, error: '未轮到你' };
    switch (a.type) {
      case 'take':       return actionTake(s, a.colors);
      case 'capture':    return actionCapture(s, a.cardId, a.opts);
      case 'reserve':    return actionReserve(s, a.target, a.preview);
      case 'takeMega':   return actionTakeMega(s);
      case 'evolve':     return actionEvolve(s, a.fromId, a.toId);
      case 'megaEvolve': return actionMegaEvolve(s, a.megaId, a.fromId);
      case 'discard':    return actionDiscard(s, a.color);
      case 'pass':       return actionPass(s);
      case 'psychicConvert': return actionPsychicConvert(s, a.colors);
      case 'suppress':   return actionSuppress(s, a.targets);
      case 'intimidate': return actionIntimidate(s, a.toPlayer, a.cardId, a.color);
      case 'clearSeal':  return actionClearSeal(s, a.cardId);
      case 'purge':      return actionPurge(s, a.toPlayer, a.cardId);
      case 'endTurn':    return endTurn(s);
      default:           return { ok: false, error: '未知行动' };
    }
  }

  // Public projection of the state for ONE viewer, safe to send over a network.
  // Hides what the viewer must not see — the ordered face-down deck (every future
  // draw) and other players' reserved-card identities (possibly drawn blind) —
  // while preserving counts/tiers so the UI still renders pile sizes & card-backs.
  // Static card refs are omitted (every client already has the full card DB).
  function redactFor(s, viewerId) {
    // _byName: ai.js's name→card lookup cache, if an AI ever thought on this object — static data, never on the wire
    const { cardDB, byId: _b, megaDB, pokemartDB, _byName, ...dyn } = s;
    const v = JSON.parse(JSON.stringify(dyn));            // deep copy of dynamic state
    delete v.seed;                                        // server shuffle seed is private
    if (v.decks) for (const t in v.decks) v.decks[t] = v.decks[t].map(() => null); // hide deck order, keep length
    v.players = v.players.map((p, i) => {
      if (i === viewerId) return p;                       // you see your OWN reserve ids
      return Object.assign({}, p, {                       // opponents' reserves → {hidden,tier} stubs
        reserve: p.reserve.map(id => ({ hidden: true, tier: (s.byId[id] || {}).tier || null })),
      });
    });
    v.viewerId = viewerId;
    return v;
  }

  // --------------------------- i18n bits -----------------------------
  const BALL_ZH = { red: '精灵球', blue: '超级球', black: '高级球', pink: '治愈球', yellow: '先机球', purple: '大师球' };
  const TIER_ZH = { stage1: '一阶', stage2: '二阶', stage3: '三阶', rare: '稀有', legend: '传说', mega: 'Mega', pmL1: 'Pokémart一级', pmL2: 'Pokémart二级', pmL3: 'Pokémart三级' };
  function zhBall(c) { return BALL_ZH[c] || c; }
  function zhTier(t) { return TIER_ZH[t] || t; }
  function payDesc(pay) {
    const parts = ALL_TOKENS.filter(c => pay[c] > 0).map(c => `${pay[c]}${zhBall(c)}`);
    return parts.length ? parts.join('+') : '免费';
  }

  // ----- deep clone for AI search -----
  function clone(s) {
    const c = JSON.parse(JSON.stringify({
      seed: s.seed, winScore: s.winScore, numPlayers: s.numPlayers, supply: s.supply, decks: s.decks,
      field: s.field, players: s.players, turn: s.turn, round: s.round,
      phase: s.phase, lastRound: s.lastRound,
      winner: s.winner, acted: s.acted, taken: s.taken, evolvedThisTurn: s.evolvedThisTurn,
      megasEnabled: s.megasEnabled, megaOffer: s.megaOffer,
      pokemartEnabled: s.pokemartEnabled,
      trainerSkillsEnabled: s.trainerSkillsEnabled,   // 训练家技能扩展
      capturedThisTurn: s.capturedThisTurn,           // 火箭队·捕获装置需要（AI 模拟结算）
    }));
    c.cardDB = s.cardDB; c.byId = s.byId; c.megaDB = s.megaDB; c.pokemartDB = s.pokemartDB; c.log = []; // share static refs, drop log
    return c;
  }

  return {
    COLORS, MASTER, ALL_TOKENS, NORMAL_TIERS, FIELD_TIERS, FIELD_SLOTS,
    HAND_MAX, TOKEN_MAX, WIN_SCORE,
    makeRng, shuffle, supplyFor,
    createGame, activePlayer, bonusOf, bonuses, tokenTotal, scoreOf, locateCard, refill,
    computePayment, canAfford, paymentBreakdown,
    actionTake, actionReserve, actionCapture, actionEvolve, actionDiscard, actionPass,
    actionPsychicConvert, actionSuppress, actionIntimidate, actionClearSeal, actionPurge, actionReservePreview,
    actionTakeMega, megaEvolveOptions, actionMegaEvolve, MEGA_TOKENS, MEGA_WIN_SCORE,
    PM_TIERS, PM_SLOTS, fieldTiers, isPokemart, effBonusColor, freeTiers, freeTakeable, autoCaptureOpts, CANON_SPECIAL,
    evolutionOptions, needsDiscard, turnState, endTurn, determineWinner,
    legalActions, applyAction, redactFor, clone,
    skillOf, TRAINER_SKILLS,
    zhBall, zhTier, payDesc,
  };
});
