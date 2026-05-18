# AI 成长任务规划器 设计文档

**日期：** 2026-05-18  
**状态：** 待实现

---

## 背景

bot 当前只会领取已完成的任务奖励，不会主动规划如何完成"收获N次"类成长任务。需要引入 AI 规划层，在常规脚本周期外动态制定并执行任务推进计划。

**关键约束（来自线上环境观察）：**
- 成长任务走 `tasks` 字段，desc 为纯文本（"完成24次收获"、"等级提升至N级"）
- 任务分两类：可主动推进（收获/种植/出售次数）和被动等待（升级/扩建）
- 最快种子：白萝卜1分钟、胡萝卜2分钟、大白菜5分钟
- 安全边界：最多动用 1/3 土地（24块地 → 最多8块）

---

## 架构

```
┌─────────────────────────────────────────────────────┐
│                  AI Task Planner                     │
│                                                      │
│  ┌──────────────┐    ┌──────────────┐               │
│  │ Context      │    │ AI Client    │               │
│  │ Collector    │───▶│ (多模型适配) │               │
│  └──────────────┘    └──────┬───────┘               │
│                             │ JSON Plan              │
│                      ┌──────▼───────┐               │
│                      │ Plan         │               │
│                      │ Interpreter  │               │
│                      └──────┬───────┘               │
│                             │ Steps                  │
│                      ┌──────▼───────┐               │
│                      │ Executor     │               │
│                      │ + Scheduler  │               │
│                      └──────────────┘               │
└─────────────────────────────────────────────────────┘
```

---

## 模块设计

### 1. AI Client (`core/src/services/ai-client.js`)

统一的多模型 HTTP 客户端，支持 OpenAI 兼容接口（Claude、GPT、本地模型均可）。

**配置结构（存入 store.json）：**
```json
{
  "aiPlanner": {
    "enabled": false,
    "provider": "claude",
    "baseUrl": "https://api.anthropic.com",
    "apiKey": "",
    "model": "claude-opus-4-7",
    "maxTokens": 1024,
    "timeoutMs": 30000
  }
}
```

**接口：**
```js
async function chat(messages, options = {})
// → { content: string }  // AI 返回的文本
```

支持的 provider：
- `claude` → Anthropic API（`/v1/messages`）
- `openai` → OpenAI 兼容接口（`/v1/chat/completions`），适配 GPT/Codex/本地模型
- `custom` → 完全自定义 baseUrl + 请求格式

---

### 2. Context Collector (`core/src/services/ai-task-planner.js` 内部函数)

调用现有 API 收集规划所需上下文：

```js
async function collectContext(accountId) {
  return {
    tasks: [],          // 未完成的 tasks（含 desc/progress/totalProgress/condType）
    lands: [],          // 土地状态（id/status/plantName/matureInSec）
    seeds: [],          // 可购买种子（name/seedId/price/growSec）
    bagSeeds: [],       // 背包已有种子
    gold: 0,            // 当前金币
    level: 0,           // 当前等级
    totalLands: 0,      // 总土地数
    maxActionLands: 0,  // 可动用土地上限（totalLands / 3，向下取整）
  };
}
```

---

### 3. AI 规划（Prompt + 输出格式）

**System Prompt 核心约束：**
```
你是一个农场游戏任务规划器。根据当前状态，制定最小代价的任务推进计划。

规则：
1. 只能动用 maxActionLands 块土地（不超过总土地的 1/3）
2. 优先选择成熟时间最短的种子
3. 只规划"可主动推进"的任务（收获/种植/出售次数），跳过升级/扩建等被动任务
4. 输出严格的 JSON，不要解释

输出格式：
{
  "tasks": [{ "taskId": 100060, "desc": "完成24次收获", "need": 24, "done": 10 }],
  "plan": {
    "seedId": 20002,
    "seedName": "白萝卜",
    "growMinutes": 1,
    "landIds": [5, 6, 7],
    "rounds": 5,
    "estimatedMinutes": 5,
    "reason": "白萝卜1分钟成熟，3块地×5轮=15次收获，补足剩余14次"
  },
  "skipped": [{ "taskId": 100061, "desc": "等级提升至16级", "reason": "被动任务，无法主动推进" }]
}
```

---

### 4. Plan Interpreter

解析 AI 输出的 JSON，转换为可执行步骤序列：

```js
function interpretPlan(plan, context) {
  // 验证：landIds 不超过 maxActionLands
  // 验证：seedId 存在且可购买
  // 验证：rounds > 0
  // 生成步骤：
  return [
    { type: 'remove_plant', landIds: [...] },   // 铲除当前作物（如有）
    { type: 'plant', seedId, landIds },          // 种植
    { type: 'wait', minutes: growMinutes },      // 等待成熟
    { type: 'harvest', landIds },                // 收获
    // 重复 rounds 次
    { type: 'restore', landIds },                // 恢复原有种植策略
    { type: 'check_tasks' },                     // 重新检查任务状态
  ];
}
```

---

### 5. Executor + Scheduler

**执行器** 逐步执行 interpretPlan 生成的步骤，调用现有 farm.js 函数：
- `remove_plant` → `removePlant(landIds)`
- `plant` → `plantSeeds(seedId, landIds)`
- `harvest` → `harvestLands(landIds)`
- `restore` → 恢复 preferred 策略种植（原来空地也补种）
- `check_tasks` → `checkAndClaimTasks(force=true)`

**调度器** 处理 `wait` 步骤：不阻塞，用 `setTimeout` 在成熟时间后回调继续执行下一步。

**触发时机：**
1. **定时触发**：每 30 分钟检查一次未完成任务，有可推进任务则启动规划
2. **回调触发**：每轮种植完成后，按 `growMinutes × rounds` 计算下次检查时间，到时自动继续

---

### 6. 安全边界执行

```
执行前检查：
- 当前是否有其他 AI 计划在运行（互斥锁）
- 可动用土地 = floor(totalLands / 3)
- 被动用的土地必须是"空地"或"已成熟可收获"的，不铲除正在生长的作物
- 金币不足购买种子时，降级为使用背包已有种子
- 单次规划最多执行 10 轮，防止无限循环
```

---

### 7. 配置 UI（Settings.vue 新增面板）

新增"AI 任务规划"配置区：
- 开关：启用/禁用
- Provider 选择：claude / openai / custom
- Base URL 输入框
- API Key 输入框（密码类型）
- 模型名称输入框
- 手动触发按钮："立即规划"
- 状态展示：上次规划时间、当前计划进度

---

## 数据流

```
定时/手动触发
    ↓
collectContext()          ← /api/lands + /api/seeds + /api/bag + TaskInfo RPC
    ↓
aiClient.chat(prompt)     ← 调用配置的 AI 接口
    ↓
interpretPlan(json)       ← 验证 + 转换为步骤序列
    ↓
executor.run(steps)       ← 逐步执行，wait 步骤用 setTimeout 回调
    ↓
checkAndClaimTasks()      ← 领取完成的任务奖励
    ↓
（如任务未全部完成）再次规划
```

---

## 文件结构

```
core/src/services/
  ai-client.js          # 新建：多模型 HTTP 客户端
  ai-task-planner.js    # 新建：规划器主逻辑（collector + executor + scheduler）

core/src/models/store.js
  # 新增：aiPlanner 配置的读写函数

core/src/controllers/admin.js
  # 新增：/api/ai-planner/config (GET/POST)
  # 新增：/api/ai-planner/trigger (POST，手动触发)
  # 新增：/api/ai-planner/status (GET，查看当前计划状态)

core/src/core/worker.js
  # 新增：aiPlannerTrigger / aiPlannerStatus worker 命令

web/src/views/Settings.vue
  # 新增：AI 任务规划配置面板
```

---

## 关键边界条件

| 场景 | 处理方式 |
|------|---------|
| AI 返回非法 JSON | 捕获异常，记录日志，跳过本次规划 |
| AI 规划的 landId 超出限制 | Interpreter 截断到 maxActionLands |
| 种子购买失败（金币不足） | 降级用背包种子，无种子则跳过 |
| 收获失败（被偷光） | 继续下一轮，不中断计划 |
| 账号下线 | 清除当前计划，重新登录后不自动恢复 |
| 两个计划并发 | 互斥锁，第二个直接跳过 |
| AI 接口超时/报错 | 记录日志，等下次定时触发重试 |
