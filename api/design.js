import { designInstructions, designPrompt, designSchema, validateDesign } from '../src/spec.js';

export async function createDesign(body, authorization, send = fetch) {
  const key = authorization?.match(/^Bearer (sk-[\w-]{12,300})$/)?.[1];
  if (!key) return [401, { error: 'Connect an OpenAI API key to generate a design here.' }];
  const { description = '', measurement = '', image = null, previous = null } = body ?? {};
  if (typeof description !== 'string' || description.length > 4000 ||
      typeof measurement !== 'string' || measurement.length > 500 ||
      (!description.trim() && !image)) {
    return [400, { error: 'Add a description or a reference photo. The description can be up to 4,000 characters.' }];
  }
  if (image !== null && (typeof image !== 'string' || image.length > 2_800_000 ||
      !/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i.test(image))) {
    return [400, { error: 'Choose a JPEG, PNG, or WebP reference photo under 2 MB.' }];
  }
  let current;
  try {
    current = previous ? validateDesign(previous) : null;
  } catch {
    return [400, { error: 'The existing design could not be read. Start a new design or load another revision.' }];
  }
  const content = [{ type: 'input_text', text: designPrompt({ description, measurement, image, previous: current }) }];
  if (image) content.push({ type: 'input_image', image_url: image, detail: 'high' });

  try {
    const result = await send('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(48_000),
      body: JSON.stringify({
        model: 'gpt-5.4-mini', instructions: designInstructions, store: false,
        reasoning: { effort: 'low' }, max_output_tokens: 6000,
        input: [{ role: 'user', content }],
        text: { format: { type: 'json_schema', name: 'printlab_design', strict: true, schema: designSchema } },
      }),
    });
    if (result.status === 401 || result.status === 403) return [401, { error: 'OpenAI rejected this key or model access. Check the key in AI settings.' }];
    if (result.status === 429) return [429, { error: 'OpenAI reached an account usage or billing limit. Check API usage and billing.' }];
    if (result.status === 400 && image) return [422, { error: 'OpenAI could not read this request. Try a different photo or generate from the description first.' }];
    if (!result.ok) return [502, { error: 'OpenAI could not complete the request. Try again in a moment.' }];
    const payload = await result.json();
    const message = payload.output?.flatMap(item => item.content ?? []).find(item => item.type === 'output_text');
    if (payload.status !== 'completed' || !message) {
      return [422, { error: 'The model could not complete that design. Try a simpler shape or add measurements.' }];
    }
    return [200, { design: validateDesign(JSON.parse(message.text)) }];
  } catch {
    return [502, { error: 'The AI response was unavailable or invalid. Try again with a shorter description.' }];
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Use POST to build a design.' });
  }
  const [status, payload] = await createDesign(request.body, request.headers.authorization);
  return response.status(status).json(payload);
}
