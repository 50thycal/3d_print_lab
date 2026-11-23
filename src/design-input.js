import { validateDesign } from './spec.js';

export function readDesignInput(body) {
  const { description = '', measurement = '', image = null, previous = null } = body ?? {};
  if (typeof description !== 'string' || description.length > 4000 ||
      typeof measurement !== 'string' || measurement.length > 500 ||
      (!description.trim() && !image)) {
    throw new Error('Add a description or a reference photo. The description can be up to 4,000 characters.');
  }
  if (image !== null && (typeof image !== 'string' || image.length > 2_800_000 ||
      !/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i.test(image))) {
    throw new Error('Choose a JPEG, PNG, or WebP reference photo under 2 MB.');
  }
  try {
    return { description, measurement, image, previous: previous ? validateDesign(previous) : null };
  } catch {
    throw new Error('The existing design could not be read. Start a new design or load another revision.');
  }
}
