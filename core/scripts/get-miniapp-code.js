#!/usr/bin/env node

const QRCode = require('qrcode');
const { MiniProgramLoginSession } = require('../src/services/qrlogin');

function parseArgs(argv) {
    const options = {
        appid: process.env.QQ_FARM_APPID || '1112386029',
        apiDomain: process.env.QQ_FARM_QR_API_DOMAIN || MiniProgramLoginSession.DEFAULT_API_DOMAIN,
        timeoutMs: Number(process.env.QQ_FARM_QR_TIMEOUT_MS || 120000),
        intervalMs: Number(process.env.QQ_FARM_QR_INTERVAL_MS || 1000),
        json: false,
        qr: true,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = () => argv[++i];

        if (arg === '--') continue;
        else if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg === '--appid') options.appid = String(next() || '').trim();
        else if (arg === '--api-domain') options.apiDomain = String(next() || '').trim();
        else if (arg === '--timeout') options.timeoutMs = Number(next());
        else if (arg === '--interval') options.intervalMs = Number(next());
        else if (arg === '--json') options.json = true;
        else if (arg === '--no-qr') options.qr = false;
        else throw new Error(`未知参数: ${arg}`);
    }

    if (!options.appid) throw new Error('appid 不能为空');
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('timeout 必须是正数毫秒');
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) throw new Error('interval 必须是正数毫秒');

    return options;
}

function printHelp() {
    console.log(`Usage: pnpm -C core get-code [options]

Options:
  --appid <appid>          小程序 appid，默认 1112386029
  --api-domain <domain>   QQ 开发者接口域名，默认 q.qq.com
  --timeout <ms>          扫码等待超时，默认 120000
  --interval <ms>         查询扫码状态间隔，默认 1000
  --json                  只输出最终 JSON
  --no-qr                 不在终端渲染二维码，只打印 URL
  -h, --help              显示帮助
`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function logTerminalQr(url) {
    const text = await QRCode.toString(url, {
        type: 'terminal',
        small: true,
        margin: 1,
        errorCorrectionLevel: 'M',
    });
    process.stderr.write(`${text}\n`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const loginOptions = { apiDomain: options.apiDomain };
    const login = await MiniProgramLoginSession.requestLoginCode(loginOptions);

    if (!options.json) {
        process.stderr.write(`登录 URL: ${login.url}\n`);
        process.stderr.write('请用 QQ 扫码授权，等待获取 code...\n');
        if (options.qr) await logTerminalQr(login.url);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < options.timeoutMs) {
        const status = await MiniProgramLoginSession.queryStatus(login.code, loginOptions);

        if (!status || status.status === 'Wait') {
            await sleep(options.intervalMs);
            continue;
        }

        if (status.status === 'Used') {
            throw new Error('二维码已失效，请重新运行脚本');
        }

        if (status.status !== 'OK') {
            throw new Error(status.msg || status.error || `扫码状态异常: ${status.status}`);
        }

        const ticket = String(status.ticket || '').trim();
        if (!ticket) throw new Error('扫码成功但 ticket 为空');

        const code = await MiniProgramLoginSession.getAuthCode(ticket, options.appid, loginOptions);
        const result = {
            code,
            appid: options.appid,
            uin: status.uin || '',
            nickname: status.nickname || '',
        };

        if (options.json) {
            console.log(JSON.stringify(result));
        } else {
            console.log(`code=${result.code}`);
            if (result.uin) console.log(`uin=${result.uin}`);
            if (result.nickname) console.log(`nickname=${result.nickname}`);
        }
        return;
    }

    throw new Error('等待扫码超时');
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
});
