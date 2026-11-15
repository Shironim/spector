import type { McpToolResponse } from '../types.js';
import { TOKEN_BUDGETS } from '../constants.js';
import { SpectorError } from './mcp-response.js';

const verifiedDefaultResponses = new WeakSet<McpToolResponse>();

export function enforceResponseBudget(response: McpToolResponse, limit = TOKEN_BUDGETS.MAX_RESPONSE_BYTES): McpToolResponse {
  if (limit === TOKEN_BUDGETS.MAX_RESPONSE_BYTES && verifiedDefaultResponses.has(response)) {
    return response;
  }
  const bytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
  if (bytes > limit) {
    throw new SpectorError('RESOURCE_LIMIT_EXCEEDED', 'MCP response exceeds the byte budget.',
      'Request a narrower selector or fewer breakpoints; for cached pins use includeScreenshot:false. The preceding action may have completed; do not retry side effects automatically.',
      { details: { bytes, limitBytes: limit, operationMayHaveCompleted: true } });
  }
  if (limit === TOKEN_BUDGETS.MAX_RESPONSE_BYTES) {
    verifiedDefaultResponses.add(response);
  }
  return response;
}
