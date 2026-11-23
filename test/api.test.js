import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesign } from '../api/design.js';
import { bracket, validateDesign } from '../src/spec.js';

const key = 'Bearer sk-example_key_0000';
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAABlBMVEUAAAD///+l2Z/dAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==';

test('hands the model description, photo, measurements, and existing features', async () => {
  const [status, result] = await createDesign({
    description: 'Move each hole inward by 3 mm.',
    measurement: 'Base width 64 mm', image: photo, previous: bracket,
  }, key, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.authorization, key);
    const input = JSON.parse(options.body);
    assert.equal(input.store, false);
    assert.equal(input.text.format.strict, true);
    const [brief, image] = input.input[0].content;
    assert.equal(image.image_url, photo);
    assert.equal(image.type, 'input_image');
    const parsed = JSON.parse(brief.text);
    assert.equal(parsed.knownMeasurements, 'Base width 64 mm');
    assert.equal(parsed.currentDesign.features.length, 4);
    assert.equal(parsed.description, 'Move each hole inward by 3 mm.');
    return Response.json({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(bracket) }] }],
    });
  });
  assert.equal(status, 200);
  assert.deepEqual(result.design, bracket);
});

test('rejects missing credentials or remote image URLs before contacting OpenAI', async () => {
  const neverSend = () => assert.fail('rejected input reached OpenAI');
  assert.equal((await createDesign({ image: photo }, '', neverSend))[0], 401);
  assert.equal((await createDesign({ image: 'https://example.com/photo.jpg' }, key, neverSend))[0], 400);
});

test('preserves a photo-scale assumption for review', () => {
  const provisional = validateDesign({ ...bracket, assumptions: ['Estimated width of 64 mm.'] });
  assert.equal(provisional.needsReview, true);
});

test('handles a provider refusal without returning a design', async () => {
  const [status, payload] = await createDesign({ description: 'Bracket' }, key, async () => Response.json({
    status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'No design.' }] }],
  }));
  assert.equal(status, 422);
  assert.match(payload.error, /could not complete/);
});
