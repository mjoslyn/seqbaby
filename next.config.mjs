/** @type {import('next').NextConfig} */
const nextConfig = {
  // The audio engine (public/js/*) is imperative, DOM- and Web-Audio-driven,
  // and relies on ambient `Tone` / `window.woscillators` globals. It is served
  // as raw static ES modules from public/ and never goes through the bundler,
  // so React StrictMode double-mounting would risk double-booting the engine.
  reactStrictMode: false,
  // /api/compose reads the compose skill (mcp/tools.mjs's guideText(), the
  // same function mcp/server.mjs uses for its seqbaby://guide resource) via
  // fs.readFileSync on a path built at runtime from import.meta.url. Next's
  // build-time file tracer only follows static import/require, so a dynamic
  // fs read like that is invisible to it -- the route worked in every local
  // `next build` (the whole repo is on disk) and then 404'd its own guide
  // file once deployed as a Netlify Function, which only ships whatever the
  // tracer decided the route needed. This is the documented escape hatch:
  // name the file explicitly so it rides along in the function's bundle,
  // rather than inlining the guide text and losing the one-copy guarantee
  // mcp/README.md describes.
  outputFileTracingIncludes: {
    "/api/compose": ["./.claude/skills/compose/SKILL.md"],
  },
};

export default nextConfig;
