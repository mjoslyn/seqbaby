/** @type {import('next').NextConfig} */
const nextConfig = {
  // The audio engine (public/js/*) is imperative, DOM- and Web-Audio-driven,
  // and relies on ambient `Tone` / `window.woscillators` globals. It is served
  // as raw static ES modules from public/ and never goes through the bundler,
  // so React StrictMode double-mounting would risk double-booting the engine.
  reactStrictMode: false,
};

export default nextConfig;
