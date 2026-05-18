/**
 * AI 成长任务规划器
 * 收集农场上下文 → 调用 AI → 解析计划 → 执行步骤 → 恢复种植
 */

'use strict';

const { toNum, log, logWarn, getServerTimeSec } = require('../utils/utils');
const { getUserState } = require('../utils/network');
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

let plannerState = {
    running: false,
    lastTriggeredAt: 0,
    lastPlanAt: 0,
    currentPlan: null,
    lastError: null,
    lastTasksCompleted: [],
};

let plannerTimer = null;

// ============ 调度器 ============

function startPlannerLoop() {
    stopPlannerLoop();
    plannerTimer = setInterval(() => {
        runPlanner().catch((e) => {
            logWarn('ai-planner', `定时规划异常: ${e.message}`, { module: 'ai-planner', event: 'timer_error' });
        });
    }, PLANNER_INTERVAL_MS);
    log('ai-planner', 'AI 任务规划器已启动（每 30 分钟触发）', { module: 'ai-planner', event: 'start' });
}

function stopPlannerLoop() {
    if (plannerTimer) {
        clearInterval(plannerTimer);
        plannerTimer = null;
        log('ai-planner', 'AI 任务规划器已停止', { module: 'ai-planner', event: 'stop' });
    }
}

function getPlannerStatus() {
    return {
        running: plannerState.running,
        lastTriggeredAt: plannerState.lastTriggeredAt,
        lastPlanAt: plannerState.lastPlanAt,
        currentPlan: plannerState.currentPlan ? { ...plannerState.currentPlan } : null,
        lastError: plannerState.lastError,
        lastTasksCompleted: [...plannerState.lastTasksCompleted],
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
        if (!plant || !toNum(plant.seed_id)) {
            return { id, status: 'empty', plantName: null, matureInSec: null };
        }
        const matureTime = toNum(plant.mature_time);
        const matureInSec = matureTime > 0 ? Math.max(0, matureTime - nowSec) : 0;
        const isMature = matureInSec === 0 && toNum(plant.seed_id) > 0;
        return {
            id,
            status: isMature ? 'mature' : 'growing',
            plantName: String(plant.name || ''),
            matureInSec,
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
    try {
        const { getGrowthTaskStateLikeApp } = require('./task');
        const taskState = await getGrowthTaskStateLikeApp();
        const allTasks = Array.isArray(taskState && taskState.tasks) ? taskState.tasks : [];
        incompleteTasks = allTasks
            .filter((t) => {
                // Support both camelCase (from real API) and snake_case (from mocks/legacy)
                const progress = toNum(t && (t.progress));
                const totalProgress = toNum(t && (t.totalProgress || t.total_progress));
                const isClaimed = !!(t && (t.isClaimed || t.is_claimed));
                return !isClaimed && totalProgress > 0 && progress < totalProgress;
            })
            .map((t) => ({
                id: toNum(t.id),
                desc: String(t.desc || t.name || ''),
                progress: toNum(t.progress),
                totalProgress: toNum(t.totalProgress || t.total_progress),
                condType: toNum(t.condType || t.cond_type),
            }));
    } catch {
        incompleteTasks = [];
    }

    return {
        tasks: incompleteTasks,
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

规则：
1. 只能动用 maxActionLands 块土地（不超过总土地的 1/3）
2. 优先选择成熟时间最短的种子
3. 只规划"可主动推进"的任务（收获/种植/出售次数），跳过升级/扩建等被动任务
4. 被动用的土地必须是"空地"或"已成熟"状态，不铲除正在生长的作物
5. 输出严格的 JSON，不要解释

输出格式：
{
  "tasks": [{"taskId": <number>, "desc": "<string>", "need": <number>, "done": <number>}],
  "plan": {
    "seedId": <number>,
    "seedName": "<string>",
    "growMinutes": <number>,
    "landIds": [<number>, ...],
    "rounds": <number>,
    "estimatedMinutes": <number>,
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
        if (!p.seedId || !Array.isArray(p.landIds) || p.landIds.length === 0 || !p.rounds) {
            parsed.plan = null;
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
        return;
    }

    log('ai-planner', `发现 ${context.tasks.length} 个未完成任务，调用 AI 规划...`, {
        module: 'ai-planner', event: 'ai_call_start', taskCount: context.tasks.length,
    });

    const aiResult = await callAiForPlan(context);
    plannerState.lastPlanAt = Date.now();

    if (!aiResult.plan) {
        log('ai-planner', 'AI 判断无可推进任务', { module: 'ai-planner', event: 'no_plan' });
        return;
    }

    const plan = aiResult.plan;
    log('ai-planner', `AI 规划: 使用 ${plan.seedName}(${plan.seedId}) 在 ${plan.landIds.length} 块土地执行 ${plan.rounds} 轮，预计 ${plan.estimatedMinutes} 分钟`, {
        module: 'ai-planner', event: 'plan_received', plan,
    });

    plannerState.currentPlan = {
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

function buildSteps(plan, context) {
    const steps = [];
    const { seedId, landIds, rounds, growMinutes } = plan;

    const actionableLandIds = landIds.filter((id) => {
        const land = context.lands.find((l) => l.id === id);
        return land && (land.status === 'empty' || land.status === 'mature');
    });

    if (actionableLandIds.length === 0) return steps;

    const matureLandIds = actionableLandIds.filter((id) => {
        const land = context.lands.find((l) => l.id === id);
        return land && land.status === 'mature';
    });

    if (matureLandIds.length > 0) {
        steps.push({ type: 'harvest', landIds: matureLandIds, label: '预收获成熟土地' });
    }

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
            await harvest(step.landIds.map(Number));
            log('ai-planner', `收获完成，土地: ${step.landIds.join(',')}`, {
                module: 'ai-planner', event: 'harvest_done', landIds: step.landIds,
            });
            break;
        }
        case 'plant': {
            if (!step.landIds || step.landIds.length === 0) break;
            await plantSeeds(step.seedId, step.landIds.map(Number));
            log('ai-planner', `种植完成，种子: ${step.seedId}`, {
                module: 'ai-planner', event: 'plant_done', seedId: step.seedId,
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
        return;
    }

    const step = steps[stepIndex];

    if (step.type === 'wait') {
        const delayMs = Math.max(0, step.minutes * 60 * 1000);
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
