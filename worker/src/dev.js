// Local development only, run by `npm run dev`. Cloudflare's test keys report
// their hostname as example.com, which the production list rejects, so this adds
// it. `wrangler deploy` names no entry point, so it deploys wrangler.toml's main,
// which is src/index.js, and index.js imports nothing, so no deployed bundle
// contains this file.
import gate from './index.js';

export default {
  fetch: (request, env, ctx) =>
    gate.fetch(request, env, ctx, ['gatewaysmash.com', 'www.gatewaysmash.com', 'example.com']),
};
