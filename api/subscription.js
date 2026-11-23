import { sandboxRequest } from '../subscription/sandbox.js';
import { handleSubscription } from '../subscription/access.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const secret = process.env.PRINTLAB_OWNER_CODE;
  const result = await handleSubscription(request, { secret: secret?.length >= 24 ? secret : undefined, call: sandboxRequest });
  if (result.setCookie) response.setHeader('Set-Cookie', result.setCookie);
  return response.status(result.status).json(result.payload);
}
