# AI 成长任务规划器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 AI 驱动的成长任务规划器，每 30 分钟自动分析未完成任务，调用大模型生成种植计划，执行后恢复原有策略。

**Architecture:** ai-client.js 封装多模型 HTTP 调用；ai-task-planner.js 负责上下文收集、AI 规划、计划解释和执行；通过 worker 命令集成到现有调度体系；Settings.vue 提供配置 UI。

**Tech Stack:** Node.js, protobufjs, node:http (no new npm deps for AI client), Vue 3, existing farm.js/task.js APIs

---

## Task 1 — Export missing functions from farm.js + add aiPlanner config to store.js

**Files:** `core/src/services/farm.js`, `core/src/models/store.js`

### Step 1.1 — Export missing functions from farm.js

- [ ] Open `core/src/services/farm.js` and replace the `module.exports` block at line 1823:

```js
// BEFORE (line 1823-1837):
module.exports = {
    checkFarm, startFarmCheckLoop, stopFarmCheckLoop,
    refreshFarmCheckLoop,
    getCurrentPhase,
    setOperationLimitsCallback,
    getAllLands,
    getLandsDetail,
    getAvailableSeeds,
    runFarmOperation,
    runSingleLandOperation,
    runFertilizerByConfig,
    buildLandMap,
    getDisplayLandContext,
    isOccupiedSlaveLand,
};

// AFTER:
module.exports = {
    checkFarm, startFarmCheckLoop, stopFarmCheckLoop,
    refreshFarmCheckLoop,
    getCurrentPhase,
    setOperationLimitsCallback,
    getAllLands,
    getLandsDetail,
    getAvailableSeeds,
    runFarmOperation,
    runSingleLandOperation,
    runFertilizerByConfig,
    buildLandMap,
    getDisplayLandContext,
    isOccupiedSlaveLand,
    // AI planner exports
    removePlant,
    plantSeeds,
    harvest,
    autoPlantEmptyLands,
    findBestSeed,
};
```

- [ ] Verify the functions exist at the expected lines:
  - `removePlant` at line 581
  - `plantSeeds` at line 649
  - `harvest` at line 56
  - `autoPlantEmptyLands` at line 1004
  - `findBestSeed` at line 691

- [ ] Run smoke check:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
node -e "const f = require('./src/services/farm'); console.log(['removePlant','plantSeeds','harvest','autoPlantEmptyLands','findBestSeed'].map(k => k + ':' + typeof f[k]).join(', '))"
```
Expected output: `removePlant:function, plantSeeds:function, harvest:function, autoPlantEmptyLands:function, findBestSeed:function`

### Step 1.2 — Add aiPlanner config to store.js

- [ ] In `core/src/models/store.js`, after the `DEFAULT_RUNTIME_CLIENT` block (around line 52), add the default config constant:

```js
const DEFAULT_AI_PLANNER_CONFIG = {
    enabled: false,
    provider: 'claude',       // 'claude' | 'openai' | 'custom'
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    model: 'claude-opus-4-7',
    maxTokens: 1024,
    timeoutMs: 30000,
};
```

- [ ] In the `globalConfig` object (around line 124), add the `aiPlanner` field after `runtimeClient`:

```js
const globalConfig = {
    accountConfigs: {},
    defaultAccountConfig: cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG),
    ui: {
        theme: 'dark',
    },
    offlineReminder: { ...DEFAULT_OFFLINE_REMINDER },
    qrLogin: { ...DEFAULT_QR_LOGIN },
    runtimeClient: { ...DEFAULT_RUNTIME_CLIENT, device_info: { ...DEFAULT_RUNTIME_CLIENT.device_info } },
    aiPlanner: { ...DEFAULT_AI_PLANNER_CONFIG },   // <-- ADD THIS LINE
    adminPasswordHash: '',
    disablePasswordAuth: false,
};
```

- [ ] After the `normalizeRuntimeClientConfig` function (search for `function normalizeRuntimeClientConfig`), add the normalize + get/set functions:

```js
function normalizeAiPlannerConfig(input) {
    const src = (input && typeof input === 'object') ? input : {};
    const VALID_PROVIDERS = new Set(['claude', 'openai', 'custom']);
    const provider = VALID_PROVIDERS.has(String(src.provider || '').trim())
        ? String(src.provider).trim()
        : DEFAULT_AI_PLANNER_CONFIG.provider;
    const baseUrl = String(src.baseUrl || '').trim() || DEFAULT_AI_PLANNER_CONFIG.baseUrl;
    const apiKey = String(src.apiKey || '').trim();
    const model = String(src.model || '').trim() || DEFAULT_AI_PLANNER_CONFIG.model;
    let maxTokens = Number.parseInt(src.maxTokens, 10);
    if (!Number.isFinite(maxTokens) || maxTokens < 256 || maxTokens > 8192) {
        maxTokens = DEFAULT_AI_PLANNER_CONFIG.maxTokens;
    }
    let timeoutMs = Number.parseInt(src.timeoutMs, 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 5000 || timeoutMs > 120000) {
        timeoutMs = DEFAULT_AI_PLANNER_CONFIG.timeoutMs;
    }
    return {
        enabled: !!src.enabled,
        provider,
        baseUrl,
        apiKey,
        model,
        maxTokens,
        timeoutMs,
    };
}

function getAiPlannerConfig() {
    return { ...globalConfig.aiPlanner };
}

function setAiPlannerConfig(cfg) {
    globalConfig.aiPlanner = normalizeAiPlannerConfig(cfg);
    writeJsonFileAtomic(STORE_FILE, globalConfig);
    return getAiPlannerConfig();
}
```

- [ ] In the `applyConfigSnapshot` function (search for `if (data.runtimeClient`), add aiPlanner loading after the runtimeClient block:

```js
// After the runtimeClient loading block, add:
if (data.aiPlanner && typeof data.aiPlanner === 'object') {
    globalConfig.aiPlanner = normalizeAiPlannerConfig(data.aiPlanner);
} else {
    globalConfig.aiPlanner = { ...DEFAULT_AI_PLANNER_CONFIG };
}
```

- [ ] In `getConfigSnapshot` (search for `runtimeClient: getRuntimeClientConfig()`), add:

```js
aiPlanner: getAiPlannerConfig(),
```

- [ ] In `module.exports` at the bottom of store.js, add:

```js
getAiPlannerConfig,
setAiPlannerConfig,
```

- [ ] Verify:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
node -e "const s = require('./src/models/store'); console.log(JSON.stringify(s.getAiPlannerConfig()))"
```
Expected: `{"enabled":false,"provider":"claude","baseUrl":"https://api.anthropic.com","apiKey":"","model":"claude-opus-4-7","maxTokens":1024,"timeoutMs":30000}`

- [ ] Commit:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
git add core/src/services/farm.js core/src/models/store.js
git commit -m "feat(ai-planner): export farm functions + add aiPlanner config to store"
```


## Task 2 — Implement ai-client.js (multi-model HTTP client)

**File:** `core/src/services/ai-client.js` (new file)

### Step 2.1 — Write the file

- [ ] Create `core/src/services/ai-client.js` with the following content:

```js
/**
 * AI HTTP 客户端 - 支持 Claude / OpenAI / 自定义兼容接口
 * 使用 node:https 原生模块，不引入新依赖
 */

'use strict';

const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

/**
 * 发送 HTTP POST 请求，返回解析后的 JSON body
 * @param {string} urlStr
 * @param {object} headers
 * @param {object} body
 * @param {number} timeoutMs
 * @returns {Promise<object>}
 */
function httpPost(urlStr, headers, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(urlStr);
        } catch (e) {
            return reject(new Error(`ai-client: invalid URL: ${urlStr}`));
        }
        const isHttps = parsed.protocol === 'https:';
        const transport = isHttps ? https : http;
        const bodyStr = JSON.stringify(body);
        const reqHeaders = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            ...headers,
        };
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + (parsed.search || ''),
            method: 'POST',
            headers: reqHeaders,
        };
        const req = transport.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`ai-client: HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
                }
                try {
                    resolve(JSON.parse(raw));
                } catch {
                    reject(new Error(`ai-client: invalid JSON response: ${raw.slice(0, 200)}`));
                }
            });
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`ai-client: request timed out after ${timeoutMs}ms`));
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

/**
 * 调用 Claude Messages API (Anthropic)
 * POST {baseUrl}/v1/messages
 */
async function callClaude(messages, config) {
    const url = `${config.baseUrl.replace(/\/$/, '')}/v1/messages`;
    const headers = {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
    };
    const body = {
        model: config.model,
        max_tokens: config.maxTokens,
        messages,
    };
    const data = await httpPost(url, headers, body, config.timeoutMs);
    // Claude response: { content: [{ type: 'text', text: '...' }] }
    const textBlock = Array.isArray(data.content)
        ? data.content.find((b) => b && b.type === 'text')
        : null;
    if (!textBlock || typeof textBlock.text !== 'string') {
        throw new Error(`ai-client: unexpected Claude response shape: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { content: textBlock.text };
}

/**
 * 调用 OpenAI-compatible Chat Completions API
 * POST {baseUrl}/v1/chat/completions
 */
async function callOpenAI(messages, config) {
    const url = `${config.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const headers = {
        'Authorization': `Bearer ${config.apiKey}`,
    };
    const body = {
        model: config.model,
        max_tokens: config.maxTokens,
        messages,
    };
    const data = await httpPost(url, headers, body, config.timeoutMs);
    // OpenAI response: { choices: [{ message: { content: '...' } }] }
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    const content = choice && choice.message && typeof choice.message.content === 'string'
        ? choice.message.content
        : null;
    if (content === null) {
        throw new Error(`ai-client: unexpected OpenAI response shape: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { content };
}

/**
 * 统一入口：根据 provider 路由到对应实现
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ provider: string, baseUrl: string, apiKey: string, model: string, maxTokens: number, timeoutMs: number }} config
 * @returns {Promise<{ content: string }>}
 */
async function chat(messages, config) {
    if (!config || !config.apiKey) {
        throw new Error('ai-client: apiKey is required');
    }
    const provider = String(config.provider || 'claude').toLowerCase();
    if (provider === 'claude') {
        return callClaude(messages, config);
    }
    // 'openai' and 'custom' both use OpenAI-compatible format
    return callOpenAI(messages, config);
}

module.exports = { chat };
```

- [ ] Add the new file to git tracking:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
git add core/src/services/ai-client.js
```

### Step 2.2 — Unit test (TDD)

- [ ] Create `core/src/services/__tests__/ai-client.test.js`:

```js
'use strict';

const { chat } = require('../ai-client');

// Minimal mock: intercept https.request
const https = require('node:https');

function mockHttpsRequest(statusCode, responseBody) {
    const original = https.request;
    https.request = (options, callback) => {
        const EventEmitter = require('node:events');
        const res = new EventEmitter();
        res.statusCode = statusCode;
        const req = new EventEmitter();
        req.setTimeout = () => {};
        req.write = () => {};
        req.end = () => {
            callback(res);
            res.emit('data', Buffer.from(JSON.stringify(responseBody)));
            res.emit('end');
        };
        req.destroy = (err) => req.emit('error', err);
        return req;
    };
    return () => { https.request = original; };
}

describe('ai-client chat()', () => {
    const baseConfig = {
        provider: 'claude',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'test-key',
        model: 'claude-opus-4-7',
        maxTokens: 256,
        timeoutMs: 5000,
    };

    test('claude provider extracts text from content array', async () => {
        const restore = mockHttpsRequest(200, {
            content: [{ type: 'text', text: 'hello world' }],
        });
        try {
            const result = await chat([{ role: 'user', content: 'hi' }], baseConfig);
            expect(result).toEqual({ content: 'hello world' });
        } finally {
            restore();
        }
    });

    test('openai provider extracts text from choices', async () => {
        const restore = mockHttpsRequest(200, {
            choices: [{ message: { content: 'openai reply' } }],
        });
        try {
            const result = await chat(
                [{ role: 'user', content: 'hi' }],
                { ...baseConfig, provider: 'openai', baseUrl: 'https://api.openai.com' }
            );
            expect(result).toEqual({ content: 'openai reply' });
        } finally {
            restore();
        }
    });

    test('throws on HTTP error status', async () => {
        const restore = mockHttpsRequest(401, { error: 'unauthorized' });
        try {
            await expect(
                chat([{ role: 'user', content: 'hi' }], baseConfig)
            ).rejects.toThrow('HTTP 401');
        } finally {
            restore();
        }
    });

    test('throws when apiKey is missing', async () => {
        await expect(
            chat([{ role: 'user', content: 'hi' }], { ...baseConfig, apiKey: '' })
        ).rejects.toThrow('apiKey is required');
    });

    test('custom provider uses openai-compatible path', async () => {
        const restore = mockHttpsRequest(200, {
            choices: [{ message: { content: 'custom reply' } }],
        });
        try {
            const result = await chat(
                [{ role: 'user', content: 'hi' }],
                { ...baseConfig, provider: 'custom', baseUrl: 'https://my-llm.example.com' }
            );
            expect(result).toEqual({ content: 'custom reply' });
        } finally {
            restore();
        }
    });
});
```

- [ ] Add test file to git:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
mkdir -p core/src/services/__tests__
git add core/src/services/__tests__/ai-client.test.js
```

- [ ] Run tests (check package.json for test runner — likely jest):
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
npx jest src/services/__tests__/ai-client.test.js --no-coverage 2>&1 | tail -20
```
All 5 tests must pass.

- [ ] Commit:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
git add core/src/services/ai-client.js core/src/services/__tests__/ai-client.test.js
git commit -m "feat(ai-planner): add ai-client.js with claude/openai/custom support + tests"
```


## Task 3 — Implement ai-task-planner.js: context collector + AI call + plan interpreter

**File:** `core/src/services/ai-task-planner.js` (new file)

### Step 3.1 — Write the file (context collector + AI call + plan parser)

- [ ] Create `core/src/services/ai-task-planner.js`:

```js
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

// 最快种子（按 growSec 升序），用于 AI 上下文提示
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
    currentPlan: null,   // { seedId, seedName, landIds, rounds, remainingRounds, estimatedMinutes }
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

/**
 * 收集当前农场状态，构建发给 AI 的上下文对象
 */
async function collectContext() {
    const state = getUserState();
    const landsReply = await getAllLands();
    const lands = Array.isArray(landsReply && landsReply.lands) ? landsReply.lands : [];
    const unlockedLands = lands.filter((l) => l && l.unlocked);
    const totalLands = unlockedLands.length;
    const maxActionLands = Math.floor(totalLands / 3);

    // 土地状态摘要
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

    // 可用种子（商店）
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

    // 背包种子
    let bagSeeds = [];
    try {
        const bagReply = await require('./warehouse').getBagDetail();
        const items = Array.isArray(bagReply && bagReply.items) ? bagReply.items : [];
        bagSeeds = items
            .filter((item) => item && toNum(item.type) === 2) // type=2 为种子
            .map((item) => ({
                id: toNum(item.id),
                name: String(item.name || ''),
                count: toNum(item.count),
            }))
            .filter((s) => s.id > 0 && s.count > 0);
    } catch {
        bagSeeds = [];
    }

    // 成长任务（未完成）
    let incompleteTasks = [];
    try {
        const { getGrowthTaskStateLikeApp } = require('./task');
        const taskState = await getGrowthTaskStateLikeApp();
        const allTasks = Array.isArray(taskState && taskState.tasks) ? taskState.tasks : [];
        incompleteTasks = allTasks
            .filter((t) => {
                const progress = toNum(t && t.progress);
                const totalProgress = toNum(t && t.total_progress);
                const isClaimed = !!(t && t.is_claimed);
                return !isClaimed && totalProgress > 0 && progress < totalProgress;
            })
            .map((t) => ({
                id: toNum(t.id),
                desc: String(t.desc || t.name || ''),
                progress: toNum(t.progress),
                totalProgress: toNum(t.total_progress),
                condType: toNum(t.cond_type),
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

/**
 * 调用 AI 获取规划结果
 * @param {object} context
 * @returns {Promise<{tasks: Array, plan: object|null, skipped: Array}>}
 */
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

    // 提取 JSON（AI 可能在 JSON 前后加文字）
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

    // 基本结构校验
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

/**
 * 手动或定时触发规划
 */
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

/**
 * 核心规划执行（由定时器或 triggerPlanner 调用）
 */
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

    // 保存当前计划状态
    plannerState.currentPlan = {
        seedId: plan.seedId,
        seedName: plan.seedName,
        landIds: plan.landIds,
        rounds: plan.rounds,
        remainingRounds: plan.rounds,
        estimatedMinutes: plan.estimatedMinutes,
    };

    // 执行计划
    await executePlan(plan, context);
}

module.exports = {
    startPlannerLoop,
    stopPlannerLoop,
    getPlannerStatus,
    triggerPlanner,
    runPlanner,
    collectContext,
    callAiForPlan,
};
```

- [ ] Add to git:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
git add core/src/services/ai-task-planner.js
```

### Step 3.2 — Unit test for context collector and plan parser

- [ ] Create `core/src/services/__tests__/ai-task-planner-context.test.js`:

```js
'use strict';

// Mock dependencies before requiring the module
jest.mock('../farm', () => ({
    getAllLands: jest.fn(),
    getAvailableSeeds: jest.fn(),
    removePlant: jest.fn(),
    plantSeeds: jest.fn(),
    harvest: jest.fn(),
    autoPlantEmptyLands: jest.fn(),
}));
jest.mock('../task', () => ({
    checkAndClaimTasks: jest.fn(),
    getGrowthTaskStateLikeApp: jest.fn(),
}));
jest.mock('../../utils/network', () => ({
    getUserState: jest.fn(() => ({ gold: 5000, level: 10, gid: 12345 })),
}));
jest.mock('../../utils/utils', () => ({
    toNum: (v) => Number(v) || 0,
    log: jest.fn(),
    logWarn: jest.fn(),
    getServerTimeSec: jest.fn(() => 1000000),
}));
jest.mock('../../models/store', () => ({
    getAiPlannerConfig: jest.fn(() => ({
        enabled: true,
        provider: 'claude',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'test-key',
        model: 'claude-opus-4-7',
        maxTokens: 1024,
        timeoutMs: 30000,
    })),
}));
jest.mock('../ai-client', () => ({
    chat: jest.fn(),
}));
jest.mock('../warehouse', () => ({
    getBagDetail: jest.fn(() => ({ items: [] })),
}));

const farm = require('../farm');
const task = require('../task');
const { chat } = require('../ai-client');
const { collectContext, callAiForPlan } = require('../ai-task-planner');

describe('collectContext()', () => {
    beforeEach(() => {
        farm.getAllLands.mockResolvedValue({
            lands: [
                { id: 1, unlocked: true, plant: null },
                { id: 2, unlocked: true, plant: { seed_id: 20002, name: '白萝卜', mature_time: 999999 } },
                { id: 3, unlocked: true, plant: { seed_id: 20002, name: '白萝卜', mature_time: 1000000 } },
                { id: 4, unlocked: false, plant: null }, // locked, should be excluded
            ],
        });
        farm.getAvailableSeeds.mockResolvedValue([
            { seedId: 20002, name: '白萝卜', price: 10, growSec: 60 },
            { seedId: 20003, name: '胡萝卜', price: 20, growSec: 120 },
        ]);
        task.getGrowthTaskStateLikeApp.mockResolvedValue({
            tasks: [
                { id: 100060, desc: '完成24次收获', progress: 10, total_progress: 24, is_claimed: false, cond_type: 1 },
                { id: 100061, desc: '等级提升至16级', progress: 10, total_progress: 16, is_claimed: false, cond_type: 2 },
            ],
        });
    });

    test('returns correct totalLands and maxActionLands', async () => {
        const ctx = await collectContext();
        expect(ctx.totalLands).toBe(3); // only unlocked
        expect(ctx.maxActionLands).toBe(1); // floor(3/3)
    });

    test('classifies land statuses correctly', async () => {
        const ctx = await collectContext();
        const land1 = ctx.lands.find((l) => l.id === 1);
        const land2 = ctx.lands.find((l) => l.id === 2);
        const land3 = ctx.lands.find((l) => l.id === 3);
        expect(land1.status).toBe('empty');
        expect(land2.status).toBe('growing'); // mature_time 999999 < serverTime 1000000 → matureInSec=0 but seed_id>0 → mature
        expect(land3.status).toBe('mature');  // mature_time === serverTime → matureInSec=0
    });

    test('includes only incomplete tasks', async () => {
        const ctx = await collectContext();
        expect(ctx.tasks).toHaveLength(2);
        expect(ctx.tasks[0].id).toBe(100060);
    });

    test('seeds are sorted by growSec ascending', async () => {
        const ctx = await collectContext();
        expect(ctx.seeds[0].growSec).toBeLessThanOrEqual(ctx.seeds[1].growSec);
    });
});

describe('callAiForPlan()', () => {
    const mockContext = {
        tasks: [{ id: 100060, desc: '完成24次收获', progress: 10, totalProgress: 24, condType: 1 }],
        lands: [{ id: 5, status: 'empty' }, { id: 6, status: 'mature' }],
        seeds: [{ seedId: 20002, name: '白萝卜', growSec: 60 }],
        bagSeeds: [],
        gold: 5000,
        level: 10,
        totalLands: 6,
        maxActionLands: 2,
    };

    test('parses valid AI JSON response', async () => {
        chat.mockResolvedValue({
            content: JSON.stringify({
                tasks: [{ taskId: 100060, desc: '完成24次收获', need: 24, done: 10 }],
                plan: { seedId: 20002, seedName: '白萝卜', growMinutes: 1, landIds: [5, 6], rounds: 7, estimatedMinutes: 7, reason: 'fastest seed' },
                skipped: [],
            }),
        });
        const result = await callAiForPlan(mockContext);
        expect(result.plan.seedId).toBe(20002);
        expect(result.plan.rounds).toBe(7);
        expect(result.tasks).toHaveLength(1);
    });

    test('returns null plan when AI says no actionable tasks', async () => {
        chat.mockResolvedValue({
            content: JSON.stringify({ tasks: [], plan: null, skipped: [] }),
        });
        const result = await callAiForPlan(mockContext);
        expect(result.plan).toBeNull();
    });

    test('extracts JSON even when AI wraps it in text', async () => {
        chat.mockResolvedValue({
            content: 'Here is the plan:\n{"tasks":[],"plan":null,"skipped":[]}',
        });
        const result = await callAiForPlan(mockContext);
        expect(result.plan).toBeNull();
    });

    test('throws when AI returns non-JSON', async () => {
        chat.mockResolvedValue({ content: 'I cannot help with that.' });
        await expect(callAiForPlan(mockContext)).rejects.toThrow('无法解析为 JSON');
    });
});
```

- [ ] Run tests:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
npx jest src/services/__tests__/ai-task-planner-context.test.js --no-coverage 2>&1 | tail -25
```
All tests must pass.

- [ ] Commit:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
git add core/src/services/ai-task-planner.js core/src/services/__tests__/ai-task-planner-context.test.js
git commit -m "feat(ai-planner): add ai-task-planner.js context collector + AI call + plan parser + tests"
```


## Task 4 — Implement executor (step runner with setTimeout for wait steps)

**File:** `core/src/services/ai-task-planner.js` (append `executePlan` function)

### Step 4.1 — Add executePlan to ai-task-planner.js

- [ ] In `core/src/services/ai-task-planner.js`, add the `executePlan` function **before** the `module.exports` block:

```js
// ============ 计划执行器 ============

/**
 * 构建执行步骤序列
 * @param {{ seedId, landIds, rounds, growMinutes }} plan
 * @param {{ lands: Array }} context  — used to identify which lands were empty before we started
 * @returns {Array<object>} steps
 */
function buildSteps(plan, context) {
    const steps = [];
    const { seedId, landIds, rounds, growMinutes } = plan;

    // Identify which of the target lands were empty/mature before we started
    // (we only remove plants from empty or mature lands — never growing ones)
    const actionableLandIds = landIds.filter((id) => {
        const land = context.lands.find((l) => l.id === id);
        return land && (land.status === 'empty' || land.status === 'mature');
    });

    if (actionableLandIds.length === 0) return steps;

    // Lands that had mature plants need to be harvested first (not removed)
    const matureLandIds = actionableLandIds.filter((id) => {
        const land = context.lands.find((l) => l.id === id);
        return land && land.status === 'mature';
    });
    // Lands that were empty need no pre-action
    const emptyLandIds = actionableLandIds.filter((id) => {
        const land = context.lands.find((l) => l.id === id);
        return land && land.status === 'empty';
    });

    // Pre-step: harvest mature lands so they become empty
    if (matureLandIds.length > 0) {
        steps.push({ type: 'harvest', landIds: matureLandIds, label: '预收获成熟土地' });
    }

    // Rounds: plant → wait → harvest (repeated)
    for (let i = 0; i < rounds; i++) {
        steps.push({ type: 'plant', seedId, landIds: actionableLandIds, label: `第 ${i + 1}/${rounds} 轮种植` });
        steps.push({ type: 'wait', minutes: growMinutes, label: `等待 ${growMinutes} 分钟成熟` });
        steps.push({ type: 'harvest', landIds: actionableLandIds, label: `第 ${i + 1}/${rounds} 轮收获` });
    }

    // Restore: re-plant with preferred strategy (includes previously empty lands)
    steps.push({ type: 'restore', landIds: actionableLandIds, label: '恢复种植策略' });

    // Check tasks after all rounds
    steps.push({ type: 'check_tasks', label: '检查并领取任务奖励' });

    return steps;
}

/**
 * 执行单个步骤
 * @param {object} step
 * @returns {Promise<void>}
 */
async function executeStep(step) {
    log('ai-planner', `执行步骤: ${step.label}`, { module: 'ai-planner', event: 'step_start', step: step.type });

    switch (step.type) {
        case 'harvest': {
            if (!step.landIds || step.landIds.length === 0) break;
            const reply = await harvest(step.landIds.map(Number));
            log('ai-planner', `收获完成，土地: ${step.landIds.join(',')}`, {
                module: 'ai-planner', event: 'harvest_done', landIds: step.landIds,
            });
            break;
        }
        case 'plant': {
            if (!step.landIds || step.landIds.length === 0) break;
            const { successCount } = await plantSeeds(step.seedId, step.landIds.map(Number));
            log('ai-planner', `种植完成 ${successCount} 块，种子: ${step.seedId}`, {
                module: 'ai-planner', event: 'plant_done', seedId: step.seedId, count: successCount,
            });
            break;
        }
        case 'wait': {
            // Schedule next step via setTimeout — do not block the event loop
            // The caller (executeStepsSequentially) handles the delay
            break;
        }
        case 'restore': {
            if (!step.landIds || step.landIds.length === 0) break;
            // autoPlantEmptyLands handles both dead and empty lands using the preferred strategy
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

/**
 * 顺序执行步骤列表，wait 步骤使用 setTimeout 延迟后续步骤
 * @param {Array<object>} steps
 * @param {number} stepIndex
 */
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
        // Update remaining rounds in state
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

/**
 * 执行 AI 规划
 * @param {object} plan  — from callAiForPlan result
 * @param {object} context  — from collectContext
 */
async function executePlan(plan, context) {
    const steps = buildSteps(plan, context);
    if (steps.length === 0) {
        log('ai-planner', '没有可执行的步骤（目标土地均不可用）', { module: 'ai-planner', event: 'no_steps' });
        plannerState.currentPlan = null;
        return;
    }
    log('ai-planner', `开始执行 ${steps.length} 个步骤`, { module: 'ai-planner', event: 'execute_start', stepCount: steps.length });
    // Mark running — will be cleared by executeStepsSequentially when done
    plannerState.running = true;
    executeStepsSequentially(steps, 0);
}
```

### Step 4.2 — Unit test for buildSteps

- [ ] Create `core/src/services/__tests__/ai-task-planner-executor.test.js`:

```js
'use strict';

// We test buildSteps in isolation by extracting it via module internals.
// Since buildSteps is not exported, we test executePlan behavior through
// a spy on executeStep. Instead, expose buildSteps for testing by temporarily
// adding it to exports — OR test via the observable side effects.
//
// Simpler approach: mock all I/O and verify the sequence of calls.

jest.mock('../farm', () => ({
    getAllLands: jest.fn(),
    getAvailableSeeds: jest.fn(),
    removePlant: jest.fn().mockResolvedValue({}),
    plantSeeds: jest.fn().mockResolvedValue({ successCount: 2, plantedLandIds: [5, 6] }),
    harvest: jest.fn().mockResolvedValue({}),
    autoPlantEmptyLands: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../task', () => ({
    checkAndClaimTasks: jest.fn().mockResolvedValue(undefined),
    getGrowthTaskStateLikeApp: jest.fn().mockResolvedValue({ tasks: [] }),
}));
jest.mock('../../utils/network', () => ({
    getUserState: jest.fn(() => ({ gold: 5000, level: 10, gid: 12345 })),
}));
jest.mock('../../utils/utils', () => ({
    toNum: (v) => Number(v) || 0,
    log: jest.fn(),
    logWarn: jest.fn(),
    getServerTimeSec: jest.fn(() => 1000000),
}));
jest.mock('../../models/store', () => ({
    getAiPlannerConfig: jest.fn(() => ({
        enabled: true, provider: 'claude', baseUrl: 'https://api.anthropic.com',
        apiKey: 'test-key', model: 'claude-opus-4-7', maxTokens: 1024, timeoutMs: 30000,
    })),
}));
jest.mock('../ai-client', () => ({ chat: jest.fn() }));
jest.mock('../warehouse', () => ({ getBagDetail: jest.fn(() => ({ items: [] })) }));

const farm = require('../farm');
const task = require('../task');

// Use fake timers to control setTimeout
jest.useFakeTimers();

const planner = require('../ai-task-planner');

describe('executePlan() step sequencing', () => {
    const plan = {
        seedId: 20002,
        seedName: '白萝卜',
        growMinutes: 1,
        landIds: [5, 6],
        rounds: 2,
        estimatedMinutes: 2,
        reason: 'test',
    };
    const context = {
        lands: [
            { id: 5, status: 'empty' },
            { id: 6, status: 'mature' },
        ],
        tasks: [],
        seeds: [],
        bagSeeds: [],
        gold: 5000,
        level: 10,
        totalLands: 6,
        maxActionLands: 2,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.clearAllTimers();
    });

    test('harvests mature lands before first plant', async () => {
        await planner.executePlan(plan, context);
        // First non-wait step should be harvest of mature land [6]
        expect(farm.harvest).toHaveBeenCalledWith([6]);
    });

    test('plants seeds on actionable lands', async () => {
        await planner.executePlan(plan, context);
        expect(farm.plantSeeds).toHaveBeenCalledWith(20002, [5, 6]);
    });

    test('wait step triggers setTimeout with correct delay', async () => {
        await planner.executePlan(plan, context);
        // After first plant, a wait step fires setTimeout(fn, 60000)
        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60000);
    });

    test('restore calls autoPlantEmptyLands after all rounds', async () => {
        await planner.executePlan(plan, context);
        // Advance all timers to complete all wait steps
        jest.runAllTimers();
        // autoPlantEmptyLands should be called for restore
        expect(farm.autoPlantEmptyLands).toHaveBeenCalled();
    });

    test('check_tasks calls checkAndClaimTasks at the end', async () => {
        await planner.executePlan(plan, context);
        jest.runAllTimers();
        expect(task.checkAndClaimTasks).toHaveBeenCalledWith(true);
    });
});
```

- [ ] Run tests:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
npx jest src/services/__tests__/ai-task-planner-executor.test.js --no-coverage 2>&1 | tail -25
```
All tests must pass.

- [ ] Commit:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
git add core/src/services/ai-task-planner.js core/src/services/__tests__/ai-task-planner-executor.test.js
git commit -m "feat(ai-planner): add executePlan step runner with setTimeout-based wait + tests"
```


## Task 5 — Integrate planner into worker.js (start/stop loop, add cases)

**File:** `core/src/core/worker.js`

### Step 5.1 — Add import at the top of worker.js

- [ ] In `core/src/core/worker.js`, find the existing require block at the top (around line 11 where farm is imported):

```js
// EXISTING line 11:
const { checkFarm, startFarmCheckLoop, stopFarmCheckLoop, refreshFarmCheckLoop, getLandsDetail, getAvailableSeeds, runFarmOperation, runSingleLandOperation, runFertilizerByConfig } = require('../services/farm');
```

Add the AI planner import immediately after that line:

```js
const { startPlannerLoop, stopPlannerLoop, triggerPlanner, getPlannerStatus } = require('../services/ai-task-planner');
```

### Step 5.2 — Start planner loop on login success

- [ ] Find the `onLoginSuccess` callback in worker.js (around line 584 where `startFarmCheckLoop` is called):

```js
// EXISTING (around line 584):
startFarmCheckLoop({ externalScheduler: true });
startFriendCheckLoop({ externalScheduler: true });
startUnifiedScheduler();
```

Add the planner start call after `startUnifiedScheduler()`:

```js
startFarmCheckLoop({ externalScheduler: true });
startFriendCheckLoop({ externalScheduler: true });
startUnifiedScheduler();
// AI 任务规划器（仅在启用时实际触发，内部检查 config.enabled）
startPlannerLoop();
```

### Step 5.3 — Stop planner loop on logout

- [ ] Find the `stopBot` function (around line 618 where `stopFarmCheckLoop` is called):

```js
// EXISTING (around line 618-621):
stopFarmCheckLoop();
stopFriendCheckLoop();
stopDailyRoutineTimer();
cleanupTaskSystem();
```

Add the planner stop call:

```js
stopFarmCheckLoop();
stopFriendCheckLoop();
stopDailyRoutineTimer();
cleanupTaskSystem();
stopPlannerLoop();   // <-- ADD THIS LINE
```

### Step 5.4 — Add worker switch/case handlers

- [ ] Find the switch/case block in worker.js (around line 685 where `case 'getSeeds':` is defined). Add the two new cases after the existing `doFarmOp` case:

```js
// Find this existing block (around line 700):
case 'doFarmOp': {
    // ... existing code ...
    break;
}

// ADD after the doFarmOp case:
case 'aiPlannerTrigger':
    result = await triggerPlanner();
    break;
case 'aiPlannerStatus':
    result = getPlannerStatus();
    break;
```

### Step 5.5 — Verify worker.js loads without errors

- [ ] Run a syntax check:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
node --check src/core/worker.js && echo "syntax OK"
```
Expected: `syntax OK`

- [ ] Verify the new cases are reachable:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
node -e "
const src = require('node:fs').readFileSync('./src/core/worker.js', 'utf8');
const hasTrigger = src.includes(\"case 'aiPlannerTrigger'\");
const hasStatus = src.includes(\"case 'aiPlannerStatus'\");
const hasStart = src.includes('startPlannerLoop()');
const hasStop = src.includes('stopPlannerLoop()');
console.log('aiPlannerTrigger:', hasTrigger, '| aiPlannerStatus:', hasStatus, '| start:', hasStart, '| stop:', hasStop);
"
```
Expected: all four values `true`.

- [ ] Commit:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
git add core/src/core/worker.js
git commit -m "feat(ai-planner): integrate planner loop and worker cases into worker.js"
```


## Task 6 — Add admin API routes in admin.js + data-provider.js

**Files:** `core/src/controllers/admin.js`, `core/src/runtime/data-provider.js`

### Step 6.1 — Add provider methods to data-provider.js

- [ ] In `core/src/runtime/data-provider.js`, find the `createDataProvider` function's returned object. Locate where `doFarmOp` is defined (around line 127):

```js
// EXISTING (around line 127-129):
doFarmOp: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'doFarmOp', opType),
doSingleLandOp: (accountRef, payload) => callWorkerApi(resolveAccountRefId(accountRef), 'doSingleLandOp', payload),
doAnalytics: (accountRef, sortBy) => callWorkerApi(resolveAccountRefId(accountRef), 'getAnalytics', sortBy),
```

Add the two new provider methods after `doAnalytics`:

```js
doFarmOp: (accountRef, opType) => callWorkerApi(resolveAccountRefId(accountRef), 'doFarmOp', opType),
doSingleLandOp: (accountRef, payload) => callWorkerApi(resolveAccountRefId(accountRef), 'doSingleLandOp', payload),
doAnalytics: (accountRef, sortBy) => callWorkerApi(resolveAccountRefId(accountRef), 'getAnalytics', sortBy),
aiPlannerTrigger: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'aiPlannerTrigger'),
aiPlannerStatus: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'aiPlannerStatus'),
```

- [ ] Verify syntax:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
node --check src/runtime/data-provider.js && echo "syntax OK"
```

### Step 6.2 — Add admin routes to admin.js

- [ ] In `core/src/controllers/admin.js`, find the import of `store` at the top (around line 16):

```js
const store = require('../models/store');
```

This already imports store. No new import needed — `store.getAiPlannerConfig` and `store.setAiPlannerConfig` will be called directly.

- [ ] Find the block of settings routes (around line 706 where `POST /api/settings/runtime-client` is defined). Add the four new AI planner routes **after** the runtime-client route block (after line ~721):

```js
// ── AI 任务规划器配置 ──────────────────────────────────────────────

// GET /api/ai-planner/config
app.get('/api/ai-planner/config', authRequired, (req, res) => {
    try {
        const cfg = store.getAiPlannerConfig ? store.getAiPlannerConfig() : {};
        // Mask apiKey in response — return only whether it is set
        const safe = { ...cfg, apiKey: cfg.apiKey ? '***' : '' };
        return res.json({ ok: true, data: safe });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/ai-planner/config
app.post('/api/ai-planner/config', authRequired, (req, res) => {
    try {
        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        // If apiKey is '***' (masked placeholder), preserve the existing key
        if (body.apiKey === '***') {
            const current = store.getAiPlannerConfig ? store.getAiPlannerConfig() : {};
            body.apiKey = current.apiKey || '';
        }
        const saved = store.setAiPlannerConfig ? store.setAiPlannerConfig(body) : {};
        const safe = { ...saved, apiKey: saved.apiKey ? '***' : '' };
        return res.json({ ok: true, data: safe });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /api/ai-planner/trigger  — manual trigger for a specific account
app.post('/api/ai-planner/trigger', authRequired, async (req, res) => {
    try {
        const accountId = String(req.headers['x-account-id'] || '').trim();
        if (!accountId) {
            return res.status(400).json({ ok: false, error: 'x-account-id header required' });
        }
        if (!provider || typeof provider.aiPlannerTrigger !== 'function') {
            return res.status(503).json({ ok: false, error: 'provider not ready' });
        }
        const result = await provider.aiPlannerTrigger(accountId);
        return res.json({ ok: true, data: result });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /api/ai-planner/status  — get planner state for a specific account
app.get('/api/ai-planner/status', authRequired, async (req, res) => {
    try {
        const accountId = String(req.headers['x-account-id'] || '').trim();
        if (!accountId) {
            return res.status(400).json({ ok: false, error: 'x-account-id header required' });
        }
        if (!provider || typeof provider.aiPlannerStatus !== 'function') {
            return res.status(503).json({ ok: false, error: 'provider not ready' });
        }
        const result = await provider.aiPlannerStatus(accountId);
        return res.json({ ok: true, data: result });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});
```

### Step 6.3 — Verify admin.js syntax

- [ ] Run syntax check:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
node --check src/controllers/admin.js && echo "syntax OK"
```

- [ ] Verify routes are present:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
node -e "
const src = require('node:fs').readFileSync('./src/controllers/admin.js', 'utf8');
['/api/ai-planner/config', '/api/ai-planner/trigger', '/api/ai-planner/status'].forEach(r => {
  console.log(r + ':', src.includes(r));
});
"
```
Expected: all three `true`.

- [ ] Commit:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
git add core/src/controllers/admin.js core/src/runtime/data-provider.js
git commit -m "feat(ai-planner): add admin API routes GET/POST /api/ai-planner/config, trigger, status"
```


## Task 7 — Add Settings.vue UI section + setting store methods

**Files:** `web/src/stores/setting.ts`, `web/src/views/Settings.vue`

### Step 7.1 — Add AiPlannerConfig type + store methods to setting.ts

- [ ] In `web/src/stores/setting.ts`, after the existing type definitions at the top (after `RuntimeClientConfig` or similar), add:

```ts
export interface AiPlannerConfig {
  enabled: boolean
  provider: 'claude' | 'openai' | 'custom'
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  timeoutMs: number
}
```

- [ ] In the `settings` ref object (wherever `runtimeClient` is typed/initialized), ensure `aiPlanner` is included. Find the `settings` ref declaration and add the field:

```ts
// Find the settings ref (likely: const settings = ref<...>({ ... }))
// Add aiPlanner to the type and initial value:
aiPlanner: null as AiPlannerConfig | null,
```

- [ ] Add two new store functions after `saveRuntimeClientConfig`:

```ts
async function fetchAiPlannerConfig() {
  loading.value = true
  try {
    const { data } = await api.get('/api/ai-planner/config')
    if (data && data.ok && data.data) {
      settings.value.aiPlanner = data.data as AiPlannerConfig
      return { ok: true, data: data.data }
    }
    return { ok: false, error: '获取失败' }
  }
  finally {
    loading.value = false
  }
}

async function saveAiPlannerConfig(config: AiPlannerConfig) {
  loading.value = true
  try {
    const { data } = await api.post('/api/ai-planner/config', config)
    if (data && data.ok) {
      settings.value.aiPlanner = data.data as AiPlannerConfig
      return { ok: true }
    }
    return { ok: false, error: data?.error || '保存失败' }
  }
  finally {
    loading.value = false
  }
}

async function triggerAiPlanner(accountId: string) {
  try {
    const { data } = await api.post('/api/ai-planner/trigger', {}, {
      headers: { 'x-account-id': accountId },
    })
    return data
  }
  catch (e: any) {
    return { ok: false, error: e.message }
  }
}

async function fetchAiPlannerStatus(accountId: string) {
  try {
    const { data } = await api.get('/api/ai-planner/status', {
      headers: { 'x-account-id': accountId },
    })
    return data
  }
  catch (e: any) {
    return { ok: false, error: e.message }
  }
}
```

- [ ] Update the `return` statement of the store to include the new functions:

```ts
return {
  settings, loading,
  fetchSettings, saveSettings,
  saveOfflineConfig, saveQrLoginConfig,
  saveRuntimeClientConfig,
  changeAdminPassword,
  fetchAiPlannerConfig, saveAiPlannerConfig,
  triggerAiPlanner, fetchAiPlannerStatus,
}
```

- [ ] Verify TypeScript compiles:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
npm run type-check 2>&1 | tail -20
```
No errors expected.

### Step 7.2 — Add AI planner section to Settings.vue

- [ ] In `web/src/views/Settings.vue`, in the `<script setup lang="ts">` block, add reactive state after the `runtimeClientSaving` ref (around line 30):

```ts
// AI 任务规划器
const aiPlannerSaving = ref(false)
const aiPlannerTriggering = ref(false)
const aiPlannerStatus = ref<any>(null)
const localAiPlanner = ref({
  enabled: false,
  provider: 'claude' as 'claude' | 'openai' | 'custom',
  baseUrl: 'https://api.anthropic.com',
  apiKey: '',
  model: 'claude-opus-4-7',
  maxTokens: 1024,
  timeoutMs: 30000,
})
```

- [ ] In the `watch` or `onMounted` block where `localRuntimeClient` is initialized from `settings` (around line 537), add the AI planner initialization:

```ts
// Find the block:
if (settings.value.runtimeClient) {
  localRuntimeClient.value = JSON.parse(JSON.stringify(settings.value.runtimeClient))
}
// Add after it:
if (settings.value.aiPlanner) {
  localAiPlanner.value = JSON.parse(JSON.stringify(settings.value.aiPlanner))
}
```

- [ ] Add the handler functions in the `<script setup>` block, after `handleSaveRuntimeClient`:

```ts
async function handleSaveAiPlanner() {
  aiPlannerSaving.value = true
  try {
    const res = await settingStore.saveAiPlannerConfig(localAiPlanner.value as any)
    if (res && res.ok) {
      toastStore.show('AI 规划器配置已保存', 'success')
    } else {
      toastStore.show((res && res.error) || '保存失败', 'error')
    }
  } catch (e: any) {
    toastStore.show(e.message || '保存失败', 'error')
  } finally {
    aiPlannerSaving.value = false
  }
}

async function handleTriggerAiPlanner() {
  if (!currentAccountId.value) {
    toastStore.show('请先选择账号', 'error')
    return
  }
  aiPlannerTriggering.value = true
  try {
    const res = await settingStore.triggerAiPlanner(currentAccountId.value)
    if (res && res.ok) {
      toastStore.show('AI 规划已触发', 'success')
      // Refresh status after a short delay
      setTimeout(async () => {
        const statusRes = await settingStore.fetchAiPlannerStatus(currentAccountId.value)
        if (statusRes && statusRes.ok) aiPlannerStatus.value = statusRes.data
      }, 1000)
    } else {
      toastStore.show((res && res.message) || '触发失败', 'error')
    }
  } catch (e: any) {
    toastStore.show(e.message || '触发失败', 'error')
  } finally {
    aiPlannerTriggering.value = false
  }
}
```

- [ ] In the template, find the end of the runtime-client section (around line 1794 where `</div>` closes the runtime-client content block). Add the AI planner section **after** the closing `</div>` of the runtime-client content and **before** the QR Login header:

```html
<!-- AI Planner Header -->
<div class="border-b border-t bg-gray-50/50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
  <h3 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
    <div class="i-carbon-machine-learning-model" />
    AI 任务规划
  </h3>
</div>

<!-- AI Planner Content -->
<div class="p-4 space-y-3">
  <BaseSwitch
    v-model="localAiPlanner.enabled"
    label="启用 AI 任务规划"
  />
  <p class="text-xs text-gray-500 dark:text-gray-400">
    每 30 分钟自动分析未完成成长任务，调用大模型生成种植计划并执行，完成后恢复原有种植策略。
  </p>

  <BaseSelect
    v-model="localAiPlanner.provider"
    label="模型提供商"
    :options="[
      { label: 'Claude (Anthropic)', value: 'claude' },
      { label: 'OpenAI', value: 'openai' },
      { label: '自定义兼容接口', value: 'custom' },
    ]"
  />

  <BaseInput
    v-model="localAiPlanner.baseUrl"
    label="Base URL"
    type="text"
    placeholder="https://api.anthropic.com"
  />

  <BaseInput
    v-model="localAiPlanner.apiKey"
    label="API Key"
    type="password"
    placeholder="sk-..."
  />

  <BaseInput
    v-model="localAiPlanner.model"
    label="模型名称"
    type="text"
    placeholder="claude-opus-4-7"
  />

  <!-- Status display -->
  <div v-if="aiPlannerStatus" class="rounded-md bg-gray-100 p-3 text-xs dark:bg-gray-800 space-y-1">
    <div class="text-gray-700 dark:text-gray-300 font-medium">规划器状态</div>
    <div class="text-gray-500 dark:text-gray-400">
      运行中: {{ aiPlannerStatus.running ? '是' : '否' }}
    </div>
    <div v-if="aiPlannerStatus.lastPlanAt" class="text-gray-500 dark:text-gray-400">
      上次规划: {{ new Date(aiPlannerStatus.lastPlanAt).toLocaleString() }}
    </div>
    <div v-if="aiPlannerStatus.currentPlan" class="text-gray-500 dark:text-gray-400">
      当前计划: {{ aiPlannerStatus.currentPlan.seedName }} ×{{ aiPlannerStatus.currentPlan.landIds?.length }} 块，
      剩余 {{ aiPlannerStatus.currentPlan.remainingRounds }}/{{ aiPlannerStatus.currentPlan.rounds }} 轮
    </div>
    <div v-if="aiPlannerStatus.lastError" class="text-red-500">
      最近错误: {{ aiPlannerStatus.lastError }}
    </div>
  </div>

  <div class="flex justify-end gap-2">
    <BaseButton
      variant="secondary"
      size="sm"
      :loading="aiPlannerTriggering"
      :disabled="!localAiPlanner.enabled"
      @click="handleTriggerAiPlanner"
    >
      立即规划
    </BaseButton>
    <BaseButton
      variant="primary"
      size="sm"
      :loading="aiPlannerSaving"
      @click="handleSaveAiPlanner"
    >
      保存 AI 规划配置
    </BaseButton>
  </div>
</div>
```

### Step 7.3 — Verify frontend builds

- [ ] Run the frontend build:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
npm run build 2>&1 | tail -30
```
Build must succeed with no errors.

- [ ] Commit:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
git add web/src/stores/setting.ts web/src/views/Settings.vue
git commit -m "feat(ai-planner): add AI planner config UI section in Settings.vue + store methods"
```


## Task 8 — End-to-end smoke test via the live server

**Goal:** Verify the full feature works against a running local server without a real AI key — using a mock endpoint to simulate AI responses.

### Step 8.1 — Start the dev server and confirm it boots

- [ ] Start the backend:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
npm run dev:core 2>&1 &
sleep 3
curl -s http://localhost:3000/api/health | head -c 200
```
Expected: JSON response with `ok: true` or similar health payload (server is up).

### Step 8.2 — Obtain an admin token

- [ ] Get a token (replace `YOUR_PASSWORD` with the configured admin password, or use the no-auth path if `disablePasswordAuth` is true):
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"YOUR_PASSWORD"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
echo "TOKEN=$TOKEN"
```

### Step 8.3 — Read and write AI planner config

- [ ] GET config (should return defaults):
```bash
curl -s http://localhost:3000/api/ai-planner/config \
  -H "x-admin-token: $TOKEN" | python3 -m json.tool
```
Expected: `{"ok": true, "data": {"enabled": false, "provider": "claude", ...}}`

- [ ] POST config (enable with a fake key):
```bash
curl -s -X POST http://localhost:3000/api/ai-planner/config \
  -H "x-admin-token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"provider":"claude","baseUrl":"http://localhost:9999","apiKey":"test-fake-key","model":"claude-opus-4-7","maxTokens":512,"timeoutMs":5000}' \
  | python3 -m json.tool
```
Expected: `{"ok": true, "data": {"enabled": true, ...}}`

- [ ] GET config again to confirm persistence:
```bash
curl -s http://localhost:3000/api/ai-planner/config \
  -H "x-admin-token: $TOKEN" | python3 -m json.tool
```
Expected: `enabled: true`, `baseUrl: "http://localhost:9999"`, `apiKey: "***"` (masked).

### Step 8.4 — Start a mock AI server to simulate Claude responses

- [ ] In a separate terminal, start a minimal mock HTTP server on port 9999:
```bash
python3 << 'MOCKEOF'
import http.server, json

MOCK_RESPONSE = {
    "content": [{"type": "text", "text": json.dumps({
        "tasks": [{"taskId": 100060, "desc": "完成24次收获", "need": 24, "done": 10}],
        "plan": {
            "seedId": 20002,
            "seedName": "白萝卜",
            "growMinutes": 1,
            "landIds": [],
            "rounds": 3,
            "estimatedMinutes": 3,
            "reason": "mock plan"
        },
        "skipped": []
    })}]
}

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        self.rfile.read(length)
        body = json.dumps(MOCK_RESPONSE).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass

print("Mock AI server on :9999")
http.server.HTTPServer(('', 9999), Handler).serve_forever()
MOCKEOF
```

### Step 8.5 — Trigger the planner manually via API

- [ ] Trigger for a running account (replace `ACCOUNT_ID` with an actual account ID from your setup):
```bash
ACCOUNT_ID="your-account-id-here"
curl -s -X POST http://localhost:3000/api/ai-planner/trigger \
  -H "x-admin-token: $TOKEN" \
  -H "x-account-id: $ACCOUNT_ID" \
  -H 'Content-Type: application/json' \
  | python3 -m json.tool
```
Expected: `{"ok": true, "data": {"ok": true, "message": "规划已触发", ...}}`

- [ ] Check status immediately after:
```bash
curl -s http://localhost:3000/api/ai-planner/status \
  -H "x-admin-token: $TOKEN" \
  -H "x-account-id: $ACCOUNT_ID" \
  | python3 -m json.tool
```
Expected: `{"ok": true, "data": {"running": true|false, "lastTriggeredAt": <timestamp>, ...}}`

### Step 8.6 — Verify Settings UI renders the new section

- [ ] Start the frontend dev server:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
npm run dev 2>&1 &
sleep 5
echo "Frontend started"
```

- [ ] Open the Settings page in a browser at `http://localhost:5173` (or whichever port Vite uses). Navigate to the Settings tab. Confirm:
  - "AI 任务规划" section header is visible
  - Toggle "启用 AI 任务规划" is present and toggleable
  - Provider select, Base URL, API Key, and Model Name inputs are present
  - "立即规划" and "保存 AI 规划配置" buttons are present
  - Saving the config shows a success toast

### Step 8.7 — Disable AI planner and restore clean state

- [ ] Disable the planner (so it doesn't fire against the fake key in production):
```bash
curl -s -X POST http://localhost:3000/api/ai-planner/config \
  -H "x-admin-token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false,"provider":"claude","baseUrl":"https://api.anthropic.com","apiKey":"","model":"claude-opus-4-7","maxTokens":1024,"timeoutMs":30000}' \
  | python3 -m json.tool
```
Expected: `{"ok": true, "data": {"enabled": false, ...}}`

- [ ] Stop the mock server (Ctrl+C in its terminal).

### Step 8.8 — Final commit

- [ ] Confirm all unit tests still pass:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui/core
npx jest src/services/__tests__/ai-client.test.js src/services/__tests__/ai-task-planner-context.test.js src/services/__tests__/ai-task-planner-executor.test.js --no-coverage 2>&1 | tail -15
```
Expected: all test suites pass.

- [ ] Confirm frontend build is clean:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
npm run build 2>&1 | tail -10
```

- [ ] Final commit tagging the feature complete:
```bash
cd /Users/fengbaiyu/project/qq-farm-bot-ui
git add -A
git commit -m "feat(ai-planner): smoke test verified — AI task planner feature complete"
```

---

## Implementation Checklist Summary

| Task | Files Changed | Status |
|------|--------------|--------|
| 1 | `farm.js` exports + `store.js` aiPlanner config | - [ ] |
| 2 | `ai-client.js` + tests | - [ ] |
| 3 | `ai-task-planner.js` context + AI call + parser + tests | - [ ] |
| 4 | `ai-task-planner.js` executor + tests | - [ ] |
| 5 | `worker.js` loop start/stop + cases | - [ ] |
| 6 | `admin.js` routes + `data-provider.js` methods | - [ ] |
| 7 | `setting.ts` store + `Settings.vue` UI | - [ ] |
| 8 | End-to-end smoke test | - [ ] |

## Key Invariants to Preserve

- AI planner only uses `floor(totalLands / 3)` lands — never more.
- Only targets `empty` or `mature` lands — never removes growing crops.
- When `config.enabled === false`, `startPlannerLoop()` installs the timer but `runPlanner()` returns immediately — no API calls are made.
- `apiKey` is never returned in plain text from GET `/api/ai-planner/config` — always masked as `***`.
- The `wait` step uses `setTimeout` (non-blocking) — the Node.js event loop is never blocked.
- After all rounds complete, `autoPlantEmptyLands` restores the lands using the account's configured planting strategy.
