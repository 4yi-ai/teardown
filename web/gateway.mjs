/** Server-side OpenAI-compatible gateway client. Never send its token to a browser. */
export class GatewayError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
  }
}

export function createGateway({baseUrl, apiKey, model, fetchImpl = fetch, timeoutMs = 120_000, maxTokens = 8192, reasoningEffort}) {
  if (!baseUrl || !apiKey || !model) throw new GatewayError('gateway_configuration_missing');
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new GatewayError('gateway_url_invalid');
  }
  const endpoint = `${base.href.replace(/\/+$/, '')}/chat/completions`;
  return {
    async complete({messages, tools, signal}) {
      if (!Array.isArray(messages) || !messages.length) throw new GatewayError('messages_invalid');
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'x-request-id': crypto.randomUUID()},
          body: JSON.stringify({model, messages, ...(tools?.length ? {tools} : {}), max_completion_tokens: maxTokens, ...(reasoningEffort ? {reasoning_effort: reasoningEffort} : {})}),
          signal: combined,
        });
      } catch (error) {
        if (signal?.aborted) throw new GatewayError('gateway_cancelled');
        if (timeout.aborted) throw new GatewayError('gateway_timeout');
        throw new GatewayError('gateway_unreachable');
      }
      if (!response.ok) throw new GatewayError('gateway_request_failed', response.status);
      let payload;
      try { payload = await response.json(); } catch { throw new GatewayError('gateway_invalid_response'); }
      const message = payload?.choices?.[0]?.message;
      if (!message || message.role !== 'assistant') throw new GatewayError('gateway_invalid_response');
      return message;
    },
  };
}
