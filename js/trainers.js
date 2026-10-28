/* =====================================================================
 * 训练家（训练师）与技能 — Trainer roster for the 训练家技能 extension.
 * ---------------------------------------------------------------------
 * 元数据（id / 中文名 / 技能名 / 头像 / 技能说明）。技能规则逻辑全部在
 * engine.js（TRAINER_SKILLS + skillOf + 各 action）里权威结算；本文件只
 * 提供展示信息，浏览器（window.Trainers）与 Node（module.exports）通用。
 *
 * 六位训练师（每位拥有共同技能「开局宝可梦」+ 专属技能）：
 *   ash      小智 · 红 精灵球   : 羁绊进化 + 热血成长
 *   misty    小霞 · 蓝 超级球   : 潮汐预读 + 蓝球调色
 *   erika    莉佳 · 黄 先机球   : 花语采集
 *   giovanni 坂木 · 黑 高级球   : 威压 + 肃清
 *   sabrina  娜姿 · 粉 治愈球   : 超能转换 + 精神压制
 *   lance    阿渡 · 蓝 超级球   : 龙之怒 + 快龙降临
 * ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Trainers = api;
})(this, function () {
  'use strict';

  const TRAINER_DB = [
    { id: 'ash', name: '小智', title: '羁绊进化', avatar: 'assets/avatars/ash.png',
      desc: '开局视为已有一只红色宝可梦（捕捉与进化时自动抵扣）。羁绊进化：进化时若缺口为 X 个指定颜色图标，可支付该色精灵球 2X 颗补足缺口完成进化。热血成长：你的 2 级精灵卡面分数 +1，3 级精灵卡面分数 +2' },
    { id: 'misty', name: '小霞', title: '潮汐预读', avatar: 'assets/avatars/misty.png',
      desc: '开局视为已有一只蓝色宝可梦（捕捉与进化时自动抵扣）。潮汐预读：执行保留精灵卡并拿大师球时，可放弃大师球，改为查看该等级牌堆顶 4 张自主重排，并拿 1 颗蓝球。蓝球调色：购买支付时，蓝球可当作任意非大师球使用' },
    { id: 'erika', name: '莉佳', title: '花语采集', avatar: 'assets/avatars/erika.svg',
      desc: '开局视为已有一只黄色宝可梦（捕捉与进化时自动抵扣）。花语采集：执行拿取 2 颗同色精灵球时，可额外拿取 1 颗与这两颗均不同色的非大师球精灵球' },
    { id: 'giovanni', name: '坂木', title: '威压', avatar: 'assets/avatars/giovanni.svg',
      desc: '开局视为已有一只黑色宝可梦（捕捉与进化时自动抵扣）。威压：支付 1 颗任意精灵球，盖在对方 1 张精灵卡上作标记；该精灵进化前需先支付 1 颗同色精灵球清除标记。肃清：支付目标精灵卡面捕捉成本 + 额外 2 颗大师球，将其移除游戏（对方获 2 颗大师球补偿）' },
    { id: 'sabrina', name: '娜姿', title: '超能转换', avatar: 'assets/avatars/sabrina.svg',
      desc: '开局视为已有一只粉色宝可梦（捕捉与进化时自动抵扣）。超能转换：每个你的回合限 1 次，支付 3 颗任意精灵球获得 1 颗大师球。精神压制：你持有的非大师球精灵球 ≥ 4 颗时可发动，弃置自己全部非大师球（记 N），并从其他玩家手中合计弃置 N-1 / N / 11 颗非大师球（N 分别对应 4-6 / 7-9 / 10）到公共池' },
    { id: 'lance', name: '阿渡', title: '龙之怒', avatar: 'assets/avatars/lance.svg',
      desc: '开局视为已有一只蓝色宝可梦（捕捉与进化时自动抵扣）。龙之怒：购买支付时，可将任意 2 颗同色非大师球视为 1 颗大师球（仅用于满足该卡的大师球需求，不能替代普通颜色需求）。快龙降临：你获得稀有/传说精灵时，任意领取 1 颗非大师球' },
  ];

  const TRAINER_BY_ID = {};
  TRAINER_DB.forEach(t => { TRAINER_BY_ID[t.id] = t; });

  return { TRAINER_DB, TRAINER_BY_ID };
});
