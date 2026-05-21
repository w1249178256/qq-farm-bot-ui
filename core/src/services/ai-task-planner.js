/**
 * AI 成长任务规划器
 * 收集农场上下文 → 调用 AI → 解析计划 → 执行步骤 → 恢复种植
 */

'use strict';

const { toNum, log, logWarn, getServerTimeSec } = require('../utils/utils');
const { getUserState, networkEvents } = require('../utils/network');
const { getAiPlannerConfig } = require('../models/store');
const { chat } = require('./ai-client');
const {
    getAllLands,
    getAvailableSeeds,
    removePlant,
    plantSeeds,
    harvest,
    autoPlantEmptyLands,
} = require('./farm');
const { checkAndClaimTasks } = require('./task');

// ============ 常量 ============

const PLANNER_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟

const FAST_SEEDS = [
    { seedId: 20002, name: '白萝卜', growSec: 60 },
    { seedId: 20003, name: '胡萝卜', growSec: 120 },
    { seedId: 20059, name: '大白菜', growSec: 300 },
];

// ============ 内存状态 ============

const MAX_DECISION_LOG = 20;

let plannerState = {
    running: false,
    lastTriggeredAt: 0,
    lastPlanAt: 0,
    currentPlan: null,
    lastError: null,
    lastTasksCompleted: [],
    decisionLog: [],
};

let plannerTimer = null;

function addDecisionLog(entry) {
    plannerState.decisionLog.unshift({ ...entry, time: Date.now() });
    if (plannerState.decisionLog.length > MAX_DECISION_LOG) {
        plannerState.decisionLog.length = MAX_DECISION_LOG;
    }
}

// ============ 调度器 ============

function onTaskInfoNotify(taskInfo) {
    const config = getAiPlannerConfig();
    if (!config.enabled || plannerState.running) return;
    // 服务器推送新任务时，延迟 3 秒触发规划（等推送数据稳定）
    setTimeout(() => {
        runPlanner().catch((e) => {
            logWarn('ai-planner', `推送触发规划异常: ${e.message}`, { module: 'ai-planner', event: 'notify_replan_error' });
        });
    }, 3000);
}

function startPlannerLoop() {
    stopPlannerLoop();
    plannerTimer = setInterval(() => {
        runPlanner().catch((e) => {
            logWarn('ai-planner', `定时规划异常: ${e.message}`, { module: 'ai-planner', event: 'timer_error' });
        });
    }, PLANNER_INTERVAL_MS);
    networkEvents.on('taskInfoNotify', onTaskInfoNotify);
    log('ai-planner', 'AI 任务规划器已启动（每 30 分钟触发，监听任务推送）', { module: 'ai-planner', event: 'start' });
}

function stopPlannerLoop() {
    if (plannerTimer) {
        clearInterval(plannerTimer);
        plannerTimer = null;
        log('ai-planner', 'AI 任务规划器已停止', { module: 'ai-planner', event: 'stop' });
    }
    networkEvents.off('taskInfoNotify', onTaskInfoNotify);
}

function getPlannerStatus() {
    return {
        running: plannerState.running,
        lastTriggeredAt: plannerState.lastTriggeredAt,
        lastPlanAt: plannerState.lastPlanAt,
        currentPlan: plannerState.currentPlan ? { ...plannerState.currentPlan } : null,
        lastError: plannerState.lastError,
        lastTasksCompleted: [...plannerState.lastTasksCompleted],
        decisionLog: [...plannerState.decisionLog],
    };
}

// ============ 上下文收集 ============

async function collectContext() {
    const state = getUserState();
    const landsReply = await getAllLands();
    const lands = Array.isArray(landsReply && landsReply.lands) ? landsReply.lands : [];
    const unlockedLands = lands.filter((l) => l && l.unlocked);
    const totalLands = unlockedLands.length;
    const maxActionLands = Math.floor(totalLands / 3);

    const nowSec = getServerTimeSec();
    const landSummary = unlockedLands.map((l) => {
        const id = toNum(l.id);
        const plant = l.plant;
        if (!plant || !Array.isArray(plant.phases) || plant.phases.length === 0) {
            return { id, status: 'empty', plantName: null, matureInSec: null, hasMutant: false, canRemove: true };
        }
        const matureTime = toNum(plant.mature_time);
        const matureInSec = matureTime > 0 ? Math.max(0, matureTime - nowSec) : 0;
        const isMature = matureInSec === 0 && toNum(plant.seed_id) > 0;
        const hasMutant = Array.isArray(plant.mutant_config_ids) && plant.mutant_config_ids.length > 0;
        // 不可铲除：有变异、距成熟不足5分钟、稀有种子（seed_id >= 20200）
        const seedId = toNum(plant.seed_id);
        const isRareSeed = seedId >= 20200;
        const almostMature = matureInSec > 0 && matureInSec < 300;
        const canRemove = !hasMutant && !isRareSeed && !almostMature;
        return {
            id,
            status: isMature ? 'mature' : 'growing',
            plantName: String(plant.name || ''),
            matureInSec,
            hasMutant,
            isRareSeed,
            almostMature,
            canRemove,
        };
    });

    let shopSeeds = [];
    try {
        const seedsReply = await getAvailableSeeds();
        shopSeeds = Array.isArray(seedsReply) ? seedsReply.map((s) => ({
            seedId: toNum(s.seedId || s.seed_id),
            name: String(s.name || ''),
            price: toNum(s.price),
            growSec: toNum(s.growSec || s.grow_sec),
        })).filter((s) => s.seedId > 0 && s.growSec > 0)
            .sort((a, b) => a.growSec - b.growSec) : [];
    } catch {
        shopSeeds = [...FAST_SEEDS];
    }

    let bagSeeds = [];
    try {
        const bagReply = await require('./warehouse').getBagDetail();
        const items = Array.isArray(bagReply && bagReply.items) ? bagReply.items : [];
        bagSeeds = items
            .filter((item) => item && toNum(item.type) === 2)
            .map((item) => ({
                id: toNum(item.id),
                name: String(item.name || ''),
                count: toNum(item.count),
            }))
            .filter((s) => s.id > 0 && s.count > 0);
    } catch {
        bagSeeds = [];
    }

    let incompleteTasks = [];
    let allTasksSnapshot = [];
    try {
        const { getTaskInfo } = require('./task');
        const reply = await getTaskInfo();
        const ti = reply && reply.task_info ? reply.task_info : {};
        // 成长任务同时存在于 growth_tasks（field 1）和 tasks（field 3）
        const combined = [
            ...(Array.isArray(ti.growth_tasks) ? ti.growth_tasks : []),
            ...(Array.isArray(ti.tasks) ? ti.tasks : []),
        ];
        // 去重（按 id），只保留成长任务（task_type=1），过滤每日任务（task_type=2）
        const seen = new Set();
        const deduped = combined.filter((t) => {
            const id = toNum(t && t.id);
            const taskType = toNum(t && t.task_type);
            if (!id || seen.has(id)) return false;
            if (taskType === 2) return false; // 跳过每日任务
            seen.add(id);
            return true;
        });
        allTasksSnapshot = deduped.map((t) => ({
            id: toNum(t.id),
            desc: String(t.desc || ''),
            progress: toNum(t.progress),
            totalProgress: toNum(t.total_progress),
            isClaimed: !!t.is_claimed,
            isUnlocked: !!t.is_unlocked,
            condType: toNum(t.cond_type),
            params: Array.isArray(t.params) ? t.params : [],
        }));
        incompleteTasks = allTasksSnapshot.filter((t) =>
            t.isUnlocked && !t.isClaimed && t.totalProgress > 0 && t.progress < t.totalProgress
        );
        // 已完成但未领取的任务，直接触发领取，不需要 AI 规划
        const claimableTasks = allTasksSnapshot.filter((t) =>
            t.isUnlocked && !t.isClaimed && t.totalProgress > 0 && t.progress >= t.totalProgress
        );
        if (claimableTasks.length > 0) {
            log('ai-planner', `发现 ${claimableTasks.length} 个已完成待领取任务，直接领取`, { module: 'ai-planner', event: 'claim_ready' });
            await checkAndClaimTasks(true);
        }
    } catch {
        incompleteTasks = [];
        allTasksSnapshot = [];
    }

    return {
        tasks: incompleteTasks,
        allTasks: allTasksSnapshot,
        lands: landSummary,
        seeds: shopSeeds,
        bagSeeds,
        gold: toNum(state && state.gold),
        level: toNum(state && state.level),
        totalLands,
        maxActionLands,
    };
}

// ============ AI 调用 ============

const SYSTEM_PROMPT = `你是一个农场游戏任务规划器。根据当前状态，制定最小代价的任务推进计划。

任务字段说明：
- condType: 任务条件类型。7=购买种子, 1/4=收获次数, 2/5=种植次数, 3/6=出售金币/次数, 16=登录, 17=采摘, 18=互动好友
- params: 任务参数。condType=7时，params[0]是种子的plantId（如"20004"=玉米）
- progress/totalProgress: 当前进度/目标进度

可执行的操作类型：
- buy_seed：购买种子（condType=7，params[0]是plantId）
- sell_items：直接出售背包里的果实（condType=3/6出售类任务，优先用此方式）
- plant_harvest：种植并收获（condType=1/2/4/5收获/种植类任务）

规则：
1. condType=7（购买种子）→ 必须用 buy_seed，plantId=params[0]，buyCount=totalProgress-progress
2. condType=3/6（出售）→ 优先用 sell_items 直接出售背包果实，无需种植
3. condType=1/2/4/5（收获/种植）→ 用 plant_harvest，选最快成熟的种子（白萝卜1分钟），rounds=ceil((totalProgress-progress)/landCount)
4. plant_harvest 只能动用 maxActionLands 块土地（不超过总土地的 1/3）
5. 优先选 status=empty 的土地；status=growing 且 canRemove=true 的土地也可以选（执行时会先铲除）
6. 绝对不能选 canRemove=false 的土地（有变异/稀有种子/快成熟）
7. condType=16/18（登录/互动）→ 跳过，无法主动推进
8. 跳过无法主动推进的任务：升级/扩建土地（bot自动处理）、等级提升等
9. 输出严格的 JSON，不要解释

示例1（购买任务）：
任务: {"id":100035,"desc":"购买8个玉米种子","condType":7,"params":["20004"],"progress":0,"totalProgress":8}
输出: {"tasks":[{"taskId":100035,"desc":"购买8个玉米种子","need":8,"done":0}],"plan":{"type":"buy_seed","plantId":20004,"seedName":"玉米种子","buyCount":8,"reason":"condType=7购买任务，直接购买"},"skipped":[]}

示例2（收获任务，condType=4）：
任务: {"id":100047,"desc":"完成9次收获","condType":4,"params":[],"progress":0,"totalProgress":9}
输出: {"tasks":[{"taskId":100047,"desc":"完成9次收获","need":9,"done":0}],"plan":{"type":"plant_harvest","seedId":20002,"seedName":"白萝卜","growMinutes":1,"landIds":[1,2,3],"rounds":3,"estimatedMinutes":3,"reason":"condType=4收获任务，白萝卜1分钟最快，3块地×3轮=9次"},"skipped":[]}

示例3（出售任务）：
任务: {"id":100010,"desc":"售卖果实获得金币","condType":3,"params":[],"progress":500,"totalProgress":1800}
输出: {"tasks":[{"taskId":100010,"desc":"售卖果实获得金币","need":1800,"done":500}],"plan":{"type":"sell_items","reason":"condType=3出售任务，直接出售背包果实"},"skipped":[]}

输出格式：
{
  "tasks": [{"taskId": <number>, "desc": "<string>", "need": <number>, "done": <number>}],
  "plan": {
    "type": "plant_harvest" | "buy_seed" | "sell_items",
    "seedId": <number>,        // plant_harvest专用
    "seedName": "<string>",    // plant_harvest/buy_seed专用
    "growMinutes": <number>,   // plant_harvest专用
    "landIds": [<number>],     // plant_harvest专用
    "rounds": <number>,        // plant_harvest专用
    "estimatedMinutes": <number>, // plant_harvest专用
    "plantId": <number>,       // buy_seed专用
    "buyCount": <number>,      // buy_seed专用
    "reason": "<string>"
  },
  "skipped": [{"taskId": <number>, "desc": "<string>", "reason": "<string>"}]
}
如果没有可推进的任务，输出 { "tasks": [], "plan": null, "skipped": [...] }`;

async function callAiForPlan(context) {
    const config = getAiPlannerConfig();
    if (!config.enabled) {
        throw new Error('ai-planner: AI 规划器未启用');
    }
    if (!config.apiKey) {
        throw new Error('ai-planner: apiKey 未配置');
    }

    const userMessage = JSON.stringify(context, null, 2);
    const messages = [
        { role: 'user', content: `${SYSTEM_PROMPT}\n\n当前状态：\n${userMessage}` },
    ];

    const response = await chat(messages, config);
    const text = response.content.trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error(`ai-planner: AI 返回内容无法解析为 JSON: ${text.slice(0, 200)}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
        throw new Error(`ai-planner: JSON 解析失败: ${e.message}`);
    }

    if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
    if (!Array.isArray(parsed.skipped)) parsed.skipped = [];
    if (parsed.plan !== null && parsed.plan !== undefined) {
        const p = parsed.plan;
        const planType = String(p.type || 'plant_harvest');
        if (planType === 'buy_seed') {
            if (!p.plantId || !p.buyCount) parsed.plan = null;
        } else if (planType === 'sell_items') {
            // sell_items 只需要 type 字段，无需其他验证
        } else {
            // plant_harvest (default)
            if (!p.seedId || !Array.isArray(p.landIds) || p.landIds.length === 0 || !p.rounds) {
                parsed.plan = null;
            } else {
                p.type = 'plant_harvest';
            }
        }
    }

    return parsed;
}

// ============ 主规划入口 ============

async function triggerPlanner() {
    const config = getAiPlannerConfig();
    if (!config.enabled) {
        return { ok: false, message: 'AI 规划器未启用' };
    }
    if (plannerState.running) {
        return { ok: false, message: '规划器正在运行中，请稍后再试' };
    }

    plannerState.running = true;
    plannerState.lastTriggeredAt = Date.now();
    plannerState.lastError = null;

    try {
        await runPlanner();
        return { ok: true, message: '规划已触发', status: getPlannerStatus() };
    } catch (e) {
        plannerState.lastError = e.message;
        addDecisionLog({ type: 'error', reason: e.message });
        return { ok: false, message: e.message, status: getPlannerStatus() };
    } finally {
        plannerState.running = false;
    }
}

async function runPlanner() {
    const config = getAiPlannerConfig();
    if (!config.enabled) return;

    log('ai-planner', '开始收集农场上下文...', { module: 'ai-planner', event: 'collect_start' });
    const context = await collectContext();

    if (context.tasks.length === 0) {
        log('ai-planner', '没有未完成的成长任务，跳过规划', { module: 'ai-planner', event: 'no_tasks' });
        addDecisionLog({ type: 'skip', reason: '没有未完成的成长任务', allTasks: context.allTasks });
        return;
    }

    log('ai-planner', `发现 ${context.tasks.length} 个未完成任务，调用 AI 规划...`, {
        module: 'ai-planner', event: 'ai_call_start', taskCount: context.tasks.length,
    });

    const aiResult = await callAiForPlan(context);
    plannerState.lastPlanAt = Date.now();

    if (!aiResult.plan) {
        log('ai-planner', 'AI 判断无可推进任务', { module: 'ai-planner', event: 'no_plan' });
        addDecisionLog({ type: 'skip', reason: 'AI 判断无可推进任务', skipped: aiResult.skipped });
        return;
    }

    const plan = aiResult.plan;
    const planType = String(plan.type || 'plant_harvest');

    if (planType === 'buy_seed') {
        log('ai-planner', `AI 规划(购买): ${plan.seedName} × ${plan.buyCount} 个`, {
            module: 'ai-planner', event: 'plan_received', plan,
        });
        addDecisionLog({
            type: 'plan',
            planType: 'buy_seed',
            seedName: plan.seedName,
            buyCount: plan.buyCount,
            reason: plan.reason,
            tasks: aiResult.tasks,
            allTasks: context.allTasks,
        });
        plannerState.currentPlan = {
            planType: 'buy_seed',
            seedName: plan.seedName,
            buyCount: plan.buyCount,
            remainingRounds: 1,
            rounds: 1,
            estimatedMinutes: 0,
        };
        await executeBuySeed(plan, context);
        return;
    }

    if (planType === 'sell_items') {
        log('ai-planner', 'AI 规划(出售): 直接出售背包果实', {
            module: 'ai-planner', event: 'plan_received', plan,
        });
        addDecisionLog({
            type: 'plan',
            planType: 'sell_items',
            reason: plan.reason,
            tasks: aiResult.tasks,
            allTasks: context.allTasks,
        });
        plannerState.currentPlan = { planType: 'sell_items', remainingRounds: 1, rounds: 1, estimatedMinutes: 0 };
        await executeSellItems(context);
        return;
    }

    log('ai-planner', `AI 规划: 使用 ${plan.seedName}(${plan.seedId}) 在 ${plan.landIds.length} 块土地执行 ${plan.rounds} 轮，预计 ${plan.estimatedMinutes} 分钟`, {
        module: 'ai-planner', event: 'plan_received', plan,
    });
    addDecisionLog({
        type: 'plan',
        planType: 'plant_harvest',
        seedName: plan.seedName,
        seedId: plan.seedId,
        landIds: plan.landIds,
        rounds: plan.rounds,
        estimatedMinutes: plan.estimatedMinutes,
        reason: plan.reason,
        tasks: aiResult.tasks,
        allTasks: context.allTasks,
    });

    plannerState.currentPlan = {
        planType: 'plant_harvest',
        seedId: plan.seedId,
        seedName: plan.seedName,
        landIds: plan.landIds,
        rounds: plan.rounds,
        remainingRounds: plan.rounds,
        estimatedMinutes: plan.estimatedMinutes,
    };

    // executePlan will be added in Task 4
    await executePlan(plan, context);
}

// ============ 计划执行器 ============

/**
 * 执行购买种子计划（buy_seed 类型）
 * plantId 是游戏内的 plant_id，需要先查商店找到对应的 goods_id
 */
async function executeSellItems(context) {
    const { sellAllFruits } = require('./warehouse');
    try {
        log('ai-planner', '出售背包果实...', { module: 'ai-planner', event: 'sell_items_start' });
        await sellAllFruits();
        log('ai-planner', '出售完成', { module: 'ai-planner', event: 'sell_items_done' });
        addDecisionLog({ type: 'complete', reason: '出售果实完成' });
        await checkAndClaimTasks(true);
    } catch (e) {
        logWarn('ai-planner', `出售失败: ${e.message}`, { module: 'ai-planner', event: 'sell_items_error' });
        plannerState.lastError = e.message;
        addDecisionLog({ type: 'error', reason: `出售失败: ${e.message}` });
    } finally {
        plannerState.currentPlan = null;
        plannerState.running = false;
    }
}

async function executeBuySeed(plan, context) {
    const { getShopInfo, buyGoods } = require('./farm');
    const SEED_SHOP_ID = 2; // 种子商店 ID
    try {
        const shopReply = await getShopInfo(SEED_SHOP_ID);
        const goodsList = shopReply.goods_list || [];
        // 通过 item_id（种子 id）匹配，params[0] 是 plantId，种子 id = 20000 + plantId
        const plantId = toNum(plan.plantId);
        const seedId = plantId > 20000 ? plantId : 20000 + plantId;
        const goods = goodsList.find((g) => toNum(g.item_id) === seedId);
        if (!goods) {
            logWarn('ai-planner', `购买失败：商店中未找到种子 plantId=${plantId} seedId=${seedId}`, {
                module: 'ai-planner', event: 'buy_seed_error',
            });
            plannerState.currentPlan = null;
            plannerState.running = false;
            return;
        }
        const goodsId = toNum(goods.id);
        const price = toNum(goods.price);
        const buyCount = Math.max(1, toNum(plan.buyCount));
        log('ai-planner', `购买种子: ${plan.seedName} × ${buyCount}，goodsId=${goodsId} price=${price}`, {
            module: 'ai-planner', event: 'buy_seed_start', goodsId, buyCount, price,
        });
        await buyGoods(goodsId, buyCount, price);
        log('ai-planner', `购买完成: ${plan.seedName} × ${buyCount}`, {
            module: 'ai-planner', event: 'buy_seed_done', goodsId, buyCount,
        });
        addDecisionLog({ type: 'complete', reason: `购买 ${plan.seedName} × ${buyCount} 完成` });
        await checkAndClaimTasks(true);
    } catch (e) {
        logWarn('ai-planner', `购买种子失败: ${e.message}`, { module: 'ai-planner', event: 'buy_seed_error' });
        plannerState.lastError = e.message;
        addDecisionLog({ type: 'error', reason: `购买失败: ${e.message}` });
    } finally {
        plannerState.currentPlan = null;
        plannerState.running = false;
    }
}

function buildSteps(plan, context) {
    const steps = [];
    const { seedId, rounds, growMinutes } = plan;

    // 分类土地：空地、已成熟、可铲除的生长中
    const emptyLandIds = [];
    const matureLandIds = [];
    const removableLandIds = [];

    for (const id of (plan.landIds || [])) {
        const land = context.lands.find((l) => l.id === id);
        if (!land) continue;
        if (land.status === 'empty') emptyLandIds.push(id);
        else if (land.status === 'mature') matureLandIds.push(id);
        else if (land.status === 'growing' && land.canRemove) removableLandIds.push(id);
    }

    const actionableLandIds = [...emptyLandIds, ...matureLandIds, ...removableLandIds];
    if (actionableLandIds.length === 0) return steps;

    // 预处理：收获成熟土地
    if (matureLandIds.length > 0) {
        steps.push({ type: 'harvest', landIds: matureLandIds, label: '预收获成熟土地' });
    }
    // 预处理：铲除可铲除的生长中土地
    if (removableLandIds.length > 0) {
        steps.push({ type: 'remove', landIds: removableLandIds, label: '铲除可替换作物' });
    }

    // 每轮：种植 → 等待 → 收获
    for (let i = 0; i < rounds; i++) {
        steps.push({ type: 'plant', seedId, landIds: actionableLandIds, label: `第 ${i + 1}/${rounds} 轮种植` });
        steps.push({ type: 'wait', minutes: growMinutes, label: `等待 ${growMinutes} 分钟成熟` });
        steps.push({ type: 'harvest', landIds: actionableLandIds, label: `第 ${i + 1}/${rounds} 轮收获` });
    }

    steps.push({ type: 'restore', landIds: actionableLandIds, label: '恢复种植策略' });
    steps.push({ type: 'check_tasks', label: '检查并领取任务奖励' });

    return steps;
}

async function executeStep(step) {
    log('ai-planner', `执行步骤: ${step.label}`, { module: 'ai-planner', event: 'step_start', step: step.type });

    switch (step.type) {
        case 'harvest': {
            if (!step.landIds || step.landIds.length === 0) break;
            // 收获前确认作物已成熟，未成熟的跳过（避免 code=1001021）
            let harvestIds = step.landIds.map(Number);
            try {
                const landsReply = await getAllLands();
                const currentLands = Array.isArray(landsReply && landsReply.lands) ? landsReply.lands : [];
                const nowSec = getServerTimeSec();
                const matureIds = new Set(
                    currentLands.filter(l => {
                        if (!l || !l.unlocked || !l.plant || !Array.isArray(l.plant.phases) || l.plant.phases.length === 0) return false;
                        const matureTime = toNum(l.plant.mature_time);
                        return matureTime === 0 || matureTime <= nowSec;
                    }).map(l => toNum(l.id))
                );
                harvestIds = harvestIds.filter(id => matureIds.has(id));
            } catch { /* 查询失败则尝试全部收获 */ }
            if (harvestIds.length === 0) {
                log('ai-planner', '目标土地尚未成熟，跳过本次收获', { module: 'ai-planner', event: 'harvest_skip' });
                break;
            }
            await harvest(harvestIds);
            log('ai-planner', `收获完成，土地: ${harvestIds.join(',')}`, {
                module: 'ai-planner', event: 'harvest_done', landIds: harvestIds,
            });
            break;
        }
        case 'plant': {
            if (!step.landIds || step.landIds.length === 0) break;
            // 种植前重新查一次土地状态，只种当前为空的土地（无作物或作物阶段为空）
            let targetLandIds = step.landIds.map(Number);
            try {
                const landsReply = await getAllLands();
                const currentLands = Array.isArray(landsReply && landsReply.lands) ? landsReply.lands : [];
                const emptyIds = new Set(
                    currentLands
                        .filter(l => l && l.unlocked && (!l.plant || !Array.isArray(l.plant.phases) || l.plant.phases.length === 0))
                        .map(l => toNum(l.id))
                );
                targetLandIds = targetLandIds.filter(id => emptyIds.has(id));
            } catch { /* 查询失败则用原始列表 */ }
            if (targetLandIds.length === 0) {
                log('ai-planner', '没有空地可种植，跳过本轮', { module: 'ai-planner', event: 'plant_skip' });
                break;
            }
            await plantSeeds(step.seedId, targetLandIds);
            log('ai-planner', `种植完成，种子: ${step.seedId}，土地: ${targetLandIds.join(',')}`, {
                module: 'ai-planner', event: 'plant_done', seedId: step.seedId,
            });
            break;
        }
        case 'remove': {
            if (!step.landIds || step.landIds.length === 0) break;
            await removePlant(step.landIds.map(Number));
            log('ai-planner', `铲除完成，土地: ${step.landIds.join(',')}`, {
                module: 'ai-planner', event: 'remove_done', landIds: step.landIds,
            });
            break;
        }
        case 'wait': {
            // Handled by executeStepsSequentially via setTimeout
            break;
        }
        case 'restore': {
            if (!step.landIds || step.landIds.length === 0) break;
            await autoPlantEmptyLands([], step.landIds.map(Number));
            log('ai-planner', `恢复种植完成，土地: ${step.landIds.join(',')}`, {
                module: 'ai-planner', event: 'restore_done', landIds: step.landIds,
            });
            break;
        }
        case 'check_tasks': {
            await checkAndClaimTasks(true);
            log('ai-planner', '任务检查完成', { module: 'ai-planner', event: 'tasks_checked' });
            break;
        }
        default:
            logWarn('ai-planner', `未知步骤类型: ${step.type}`, { module: 'ai-planner', event: 'unknown_step' });
    }
}

function executeStepsSequentially(steps, stepIndex = 0) {
    if (stepIndex >= steps.length) {
        plannerState.currentPlan = null;
        plannerState.running = false;
        log('ai-planner', '所有步骤执行完毕', { module: 'ai-planner', event: 'plan_complete' });
        addDecisionLog({ type: 'complete', reason: '计划执行完毕' });
        return;
    }

    const step = steps[stepIndex];

    if (step.type === 'wait') {
        const delayMs = Math.max(0, step.minutes * 60 * 1000) + 15000; // +15s 缓冲确保成熟
        log('ai-planner', `等待 ${step.minutes} 分钟后继续...`, {
            module: 'ai-planner', event: 'wait_start', minutes: step.minutes,
        });
        if (plannerState.currentPlan) {
            plannerState.currentPlan.remainingRounds = Math.max(
                0,
                plannerState.currentPlan.remainingRounds - 1
            );
        }
        setTimeout(() => {
            executeStepsSequentially(steps, stepIndex + 1);
        }, delayMs);
        return;
    }

    executeStep(step)
        .then(() => executeStepsSequentially(steps, stepIndex + 1))
        .catch((e) => {
            logWarn('ai-planner', `步骤 "${step.label}" 执行失败: ${e.message}，中止计划`, {
                module: 'ai-planner', event: 'step_error', step: step.type, error: e.message,
            });
            plannerState.lastError = e.message;
            plannerState.currentPlan = null;
            plannerState.running = false;
        });
}

async function executePlan(plan, context) {
    const steps = buildSteps(plan, context);
    if (steps.length === 0) {
        log('ai-planner', '没有可执行的步骤（目标土地均不可用）', { module: 'ai-planner', event: 'no_steps' });
        plannerState.currentPlan = null;
        return;
    }
    log('ai-planner', `开始执行 ${steps.length} 个步骤`, { module: 'ai-planner', event: 'execute_start', stepCount: steps.length });
    plannerState.running = true;
    executeStepsSequentially(steps, 0);
}

module.exports = {
    startPlannerLoop,
    stopPlannerLoop,
    getPlannerStatus,
    triggerPlanner,
    runPlanner,
    collectContext,
    callAiForPlan,
    executePlan,
    buildSteps,  // exported for testing
};
