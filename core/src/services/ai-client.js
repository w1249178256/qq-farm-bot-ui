/**
 * AI HTTP 客户端 - 支持 Claude / OpenAI / 自定义兼容接口
 * 使用 node:https 原生模块，不引入新依赖
 */

'use strict';

const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

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
    const textBlock = Array.isArray(data.content)
        ? data.content.find((b) => b && b.type === 'text')
        : null;
    if (!textBlock || typeof textBlock.text !== 'string') {
        throw new Error(`ai-client: unexpected Claude response shape: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { content: textBlock.text };
}

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
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    const content = choice && choice.message && typeof choice.message.content === 'string'
        ? choice.message.content
        : null;
    if (content === null) {
        throw new Error(`ai-client: unexpected OpenAI response shape: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return { content };
}

async function chat(messages, config) {
    if (!config || !config.apiKey) {
        throw new Error('ai-client: apiKey is required');
    }
    const provider = String(config.provider || 'claude').toLowerCase();
    if (provider === 'claude') {
        return callClaude(messages, config);
    }
    return callOpenAI(messages, config);
}

module.exports = { chat };
