/* =====================================================================
 * 训练家（训练师）与技能 — Trainer roster for the 训练家技能 extension.
 * ---------------------------------------------------------------------
 * 元数据（id / 中文名 / 技能名 / 头像 / 技能说明）。技能规则逻辑全部在
 * engine.js（TRAINER_SKILLS + skillOf）里权威结算；本文件只提供展示信息，
 * 浏览器（window.Trainers）与 Node（module.exports）通用。
 *
 * 每位训练家都拥有：
 *   共同技能「开局宝可梦」：开局视为已有一只对应色宝可梦（+1 对应色奖励，
 *     捕捉支付与进化判定时自动抵扣，不占用供应/球上限）
 *   专属技能（见下表，规则说明 → 训练家技能 可查看全文）：
 *   ash    小智 · 精灵之心 : 保留宝可梦时额外获得 1 个大师球（合计 2 个，供应允许时）
 *   misty  小霞 · 潮汐祝福 : 拿取异色精灵球时可拿 4 个（需 4 种颜色供应充足）
 *   brock  小刚 · 岩石意志 : 拿取同色精灵球时可拿 3 个（该色供应 ≥ 3）
 *   rocket 火箭队 · 捕获装置 : 本回合捕捉宝可梦后，回合结束时获得 1 个大师球（未满 10 球时）
 *   sabrina 娜姿 · 意念成球 : 支付时可用任意 2 颗普通球换算 1 颗大师球
 *                     （每回合限 1 次，整局限 2 次）
 *   sabrina 娜姿 · 大师馈赠 : 自己回合内消耗 2 颗同色精灵球，赠送 1 个大师球给
 *                     任意其他玩家（整局限 1 次，不占用主行动）
 * ===================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Trainers = api;
})(this, function () {
  'use strict';

  const TRAINER_DB = [
    { id: 'ash', name: '小智', title: '精灵之心', avatar: 'assets/avatars/ash.png',
      desc: '开局视为已有一只红色宝可梦（捕捉与进化时自动抵扣）；保留宝可梦时，额外获得 1 个大师球（合计 2 个，供应允许时）' },
    { id: 'misty', name: '小霞', title: '潮汐祝福', avatar: 'assets/avatars/misty.png',
      desc: '开局视为已有一只蓝色宝可梦（捕捉与进化时自动抵扣）；拿取异色精灵球时，可以拿取 4 个（需 4 种颜色供应充足）' },
    { id: 'brock', name: '小刚', title: '岩石意志', avatar: 'assets/avatars/brock.png',
      desc: '开局视为已有一只黄色宝可梦（捕捉与进化时自动抵扣）；拿取同色精灵球时，可以拿取 3 个（该色供应 ≥ 3）' },
    { id: 'rocket', name: '火箭队', title: '捕获装置', avatar: 'assets/avatars/rocket.png',
      desc: '开局视为已有一只黑色宝可梦（捕捉与进化时自动抵扣）；本回合捕捉宝可梦后，回合结束时获得 1 个大师球（未满 10 球时）' },
    { id: 'sabrina', name: '娜姿', title: '意念成球', avatar: 'assets/avatars/sabrina.svg',
      desc: '开局视为已有一只粉色宝可梦（捕捉与进化时自动抵扣）；支付时可用任意 2 颗普通球换算 1 颗大师球（每回合限 1 次，整局限 2 次）；大师馈赠：自己回合内消耗 2 颗同色精灵球，赠送 1 个大师球给任意其他玩家（整局限 1 次）' },
  ];

  const TRAINER_BY_ID = {};
  TRAINER_DB.forEach(t => { TRAINER_BY_ID[t.id] = t; });

  return { TRAINER_DB, TRAINER_BY_ID };
});
