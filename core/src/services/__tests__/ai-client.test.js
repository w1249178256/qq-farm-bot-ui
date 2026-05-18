'use strict';

const { chat } = require('../ai-client');
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
