/** Development-only client for a separately managed local renderer. */
export function createLocalVisualRenderer({url, fetchImpl = fetch}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('visual_url_invalid');
  return async ({html, signal}) => {
    const timeout = AbortSignal.timeout(45000);
    const response = await fetchImpl(endpoint, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({html}), signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error'});
    if (!response.ok) throw new Error('visual_renderer_failed');
    const text = await response.text();
    if (text.length > 4_000_000) throw new Error('visual_response_invalid');
    return JSON.parse(text);
  };
}
