'use strict';

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
                { id: 4, unlocked: false, plant: null },
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
        expect(ctx.totalLands).toBe(3);
        expect(ctx.maxActionLands).toBe(1);
    });

    test('classifies land statuses correctly', async () => {
        const ctx = await collectContext();
        const land1 = ctx.lands.find((l) => l.id === 1);
        const land2 = ctx.lands.find((l) => l.id === 2);
        const land3 = ctx.lands.find((l) => l.id === 3);
        expect(land1.status).toBe('empty');
        // mature_time 999999 < serverTime 1000000 → matureInSec=0, seed_id>0 → mature
        expect(land2.status).toBe('mature');
        // mature_time === serverTime → matureInSec=0, seed_id>0 → mature
        expect(land3.status).toBe('mature');
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
