import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TIMEOUTS } from '../constants.js';
import { SpectorError } from '../utils/mcp-response.js';

const ALLOWED_CDP_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const ALLOWED_CDP_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

export function validateCdpEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch (err) {
    throw new SpectorError('INVALID_CDP_ENDPOINT', `Invalid CDP URL format: "${endpoint}"`, undefined, { cause: err });
  }

  if (!ALLOWED_CDP_PROTOCOLS.has(url.protocol)) {
    throw new SpectorError(
      'CDP_ENDPOINT_DENIED',
      `SecurityPolicyError: CDP protocol "${url.protocol}" is denied. Only http/https/ws/wss endpoints on localhost are permitted.`
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!ALLOWED_CDP_HOSTS.has(hostname)) {
    throw new SpectorError(
      'CDP_ENDPOINT_DENIED',
      `SecurityPolicyError: Remote CDP host "${hostname}" is denied. Only localhost/127.0.0.1 is permitted.`
    );
  }
}

export function extractCdpPort(cdpUrl: string): string {
  const parsed = new URL(cdpUrl);
  if (parsed.port) return parsed.port;
  return parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? '443' : '9222';
}

export function findChromeExecutable(): string | null {
  const platform = os.platform();
  if (platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return 'chrome.exe';
  }
  if (platform === 'darwin') {
    const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    return fs.existsSync(macPath) ? macPath : 'google-chrome';
  }
  return 'google-chrome';
}

export async function waitForCdp(cdpUrl: string, maxWaitMs = TIMEOUTS.CDP_WAIT_MS): Promise<boolean> {
  const endpoint = `${cdpUrl.replace(/\/$/, '')}/json/version`;
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(600) });
      if (res.ok) return true;
    } catch {
      // Chrome remote debugging socket not listening yet; keep polling until deadline.
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return false;
}

export async function launchChromeForCdp(cdpUrl: string): Promise<boolean> {
  const chromeExe = findChromeExecutable();
  if (!chromeExe) return false;

  const port = extractCdpPort(cdpUrl);
  const devProfile = path.join(os.tmpdir(), 'chrome_dev_profile');
  const child = spawn(
    chromeExe,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${devProfile}`],
    {
      detached: true,
      stdio: 'ignore'
    }
  );
  child.unref();

  return await waitForCdp(cdpUrl, TIMEOUTS.CDP_WAIT_MS);
}
