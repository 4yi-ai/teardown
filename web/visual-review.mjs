/** Inspect an isolated renderer's output using a vision-capable gateway model. */
export function createVisualReviewer({render, gateway}) {
  if (typeof render !== 'function' || !gateway?.complete) throw new Error('visual_configuration_invalid');
  return async ({html, description, signal}) => {
    if (signal?.aborted) throw new Error('cancelled');
    const result = await render({html, signal});
    if (!Number.isInteger(result?.canvasCount) || !Array.isArray(result.errors) || typeof result.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(result.image) || result.image.length > 3_000_000) throw new Error('visual_response_invalid');
    if (result.canvasCount < 1 || result.errors.length) return {passed: false, feedback: result.canvasCount < 1 ? 'No canvas was rendered.' : 'The page raised a JavaScript error during rendering.'};
    const response = await gateway.complete({signal, messages: [
      {role: 'system', content: 'Assess a screenshot of an interactive 3D mechanical simulator. Return only JSON with boolean passed and a concise feedback string. Fail if the model is missing, blank, visibly broken, or clearly unrelated to the requested mechanism. Do not claim that interaction or motion was tested.'},
      {role: 'user', content: [{type: 'text', text: `Requested mechanism: ${description}`}, {type: 'image_url', image_url: {url: `data:image/jpeg;base64,${result.image}`}}]},
    ]});
    let review;
    try { review = JSON.parse(response.content); } catch { throw new Error('visual_review_invalid'); }
    if (typeof review?.passed !== 'boolean' || typeof review.feedback !== 'string' || review.feedback.length > 1000) throw new Error('visual_review_invalid');
    return {passed: review.passed, feedback: review.feedback};
  };
}
