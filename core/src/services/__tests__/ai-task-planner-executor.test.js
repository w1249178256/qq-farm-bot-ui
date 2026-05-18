'use strict';

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

jest.useFakeTimers();

const farm = require('../farm');
const task = require('../task');
const { buildSteps, executePlan } = require('../ai-task-planner');

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

describe('buildSteps()', () => {
    test('includes pre-harvest for mature lands', () => {
        const steps = buildSteps(plan, context);
        expect(steps[0]).toMatchObject({ type: 'harvest', landIds: [6] });
    });

    test('generates correct number of plant/wait/harvest cycles', () => {
        const steps = buildSteps(plan, context);
        const plantSteps = steps.filter((s) => s.type === 'plant');
        const waitSteps = steps.filter((s) => s.type === 'wait');
        const harvestSteps = steps.filter((s) => s.type === 'harvest');
        expect(plantSteps).toHaveLength(2); // rounds=2
        expect(waitSteps).toHaveLength(2);
        expect(harvestSteps).toHaveLength(3); // 1 pre-harvest + 2 round harvests
    });

    test('ends with restore and check_tasks steps', () => {
        const steps = buildSteps(plan, context);
        const last = steps[steps.length - 1];
        const secondLast = steps[steps.length - 2];
        expect(last.type).toBe('check_tasks');
        expect(secondLast.type).toBe('restore');
    });

    test('returns empty steps when all target lands are growing', () => {
        const growingContext = {
            ...context,
            lands: [
                { id: 5, status: 'growing' },
                { id: 6, status: 'growing' },
            ],
        };
        const steps = buildSteps(plan, growingContext);
        expect(steps).toHaveLength(0);
    });
});

describe('executePlan() step sequencing', () => {
    let setTimeoutSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.clearAllTimers();
        setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    });

    afterEach(() => {
        setTimeoutSpy.mockRestore();
    });

    test('harvests mature lands before first plant', async () => {
        await executePlan(plan, context);
        await Promise.resolve(); // flush microtasks so first step executes
        expect(farm.harvest).toHaveBeenCalledWith([6]);
    });

    test('plants seeds on actionable lands', async () => {
        await executePlan(plan, context);
        // flush microtasks: harvest resolves → plant step runs
        await Promise.resolve();
        await Promise.resolve();
        expect(farm.plantSeeds).toHaveBeenCalledWith(20002, [5, 6]);
    });

    test('wait step triggers setTimeout with correct delay', async () => {
        await executePlan(plan, context);
        // flush until we reach the first wait step (harvest → plant → wait)
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
    });

    test('restore calls autoPlantEmptyLands after all rounds', async () => {
        await executePlan(plan, context);
        await jest.runAllTimersAsync();
        expect(farm.autoPlantEmptyLands).toHaveBeenCalled();
    });

    test('check_tasks calls checkAndClaimTasks at the end', async () => {
        await executePlan(plan, context);
        await jest.runAllTimersAsync();
        expect(task.checkAndClaimTasks).toHaveBeenCalledWith(true);
    });
});
