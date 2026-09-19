// wakeLock.js has no imports and touches `navigator` / `document` / `window`
// only inside its two exported calls, so the whole of it runs under node --test
// against a stub of the Screen Wake Lock API — which is worth doing, because
// every real failure mode here (a refusal, a hidden document, the platform
// revoking the lock when the screen locks anyway) is one you cannot reproduce
// by looking at a browser that behaved.
import assert from "node:assert/strict";
import test from "node:test";

let nextModule = 0;

/**
 * Install a stubbed wake-lock environment and hand back a fresh copy of the
 * module bound to it. A query string on the specifier is what buys the fresh
 * copy: the module's held sentinel is module-global state, so two tests
 * sharing one instance would share a lock.
 */
async function withEnv({ supported = true, visible = true, refuse = false } = {}) {
  const env = {
    visible,
    requests: 0,
    releases: 0,
    sentinels: [],
    listeners: { visibilitychange: [], pageshow: [] },
    pending: [],           // resolvers for requests held open on purpose
    holdRequests: false,
  };
  const makeSentinel = () => {
    const s = {
      released: false,
      _onRelease: [],
      release() { s.released = true; env.releases++; return Promise.resolve(); },
      addEventListener(type, fn) { if (type === "release") s._onRelease.push(fn); },
      fireRelease() { s.released = true; for (const fn of s._onRelease) fn(); },
    };
    env.sentinels.push(s);
    return s;
  };
  const navigatorStub = supported
    ? {
        wakeLock: {
          request(type) {
            assert.equal(type, "screen");
            env.requests++;
            if (refuse) return Promise.reject(new Error("refused"));
            if (env.holdRequests) return new Promise((res) => env.pending.push(() => res(makeSentinel())));
            return Promise.resolve(makeSentinel());
          },
        },
      }
    : {};
  const documentStub = {
    get visibilityState() { return env.visible ? "visible" : "hidden"; },
    addEventListener(type, fn) { (env.listeners[type] ||= []).push(fn); },
  };
  const windowStub = { addEventListener: documentStub.addEventListener };
  for (const [name, value] of [["navigator", navigatorStub], ["document", documentStub], ["window", windowStub]]) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  env.fire = (type) => { for (const fn of env.listeners[type] || []) fn(); };
  const mod = await import(`../public/js/wakeLock.js?t=${nextModule++}`);
  return { env, mod };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("play takes one lock, stop hands it back", async () => {
  const { env, mod } = await withEnv();
  mod.holdScreenAwake();
  await settle();
  assert.equal(env.requests, 1);
  assert.equal(env.sentinels.length, 1);
  assert.equal(env.sentinels[0].released, false);
  mod.releaseScreenAwake();
  assert.equal(env.sentinels[0].released, true);
  assert.equal(env.releases, 1);
});

test("holding twice does not take a second lock", async () => {
  const { env, mod } = await withEnv();
  mod.holdScreenAwake();
  mod.holdScreenAwake();          // a doubled click, or bounce's stop-then-play
  await settle();
  mod.holdScreenAwake();
  await settle();
  assert.equal(env.requests, 1);
});

test("stopping while the request is in flight releases it on arrival", async () => {
  const { env, mod } = await withEnv();
  env.holdRequests = true;
  mod.holdScreenAwake();
  mod.releaseScreenAwake();       // stopped before the platform answered
  for (const resolve of env.pending) resolve();
  await settle();
  assert.equal(env.sentinels.length, 1);
  assert.equal(env.sentinels[0].released, true);
});

test("a hidden document defers the request to the next return", async () => {
  const { env, mod } = await withEnv({ visible: false });
  mod.holdScreenAwake();
  await settle();
  assert.equal(env.requests, 0, "the platform would reject this one");
  env.visible = true;
  env.fire("visibilitychange");
  await settle();
  assert.equal(env.requests, 1);
});

test("the platform revoking the lock is re-asked for, once back", async () => {
  const { env, mod } = await withEnv();
  mod.holdScreenAwake();
  await settle();
  env.sentinels[0].fireRelease();  // what the screen locking actually does
  env.fire("visibilitychange");
  await settle();
  assert.equal(env.requests, 2);
  assert.equal(env.sentinels.length, 2);
});

test("a returning page with the transport stopped asks for nothing", async () => {
  const { env, mod } = await withEnv();
  mod.holdScreenAwake();
  await settle();
  mod.releaseScreenAwake();
  env.fire("visibilitychange");
  env.fire("pageshow");
  await settle();
  assert.equal(env.requests, 1);
});

test("no API and a refused request are both survivable", async () => {
  const bare = await withEnv({ supported: false });
  bare.mod.holdScreenAwake();
  bare.mod.releaseScreenAwake();
  await settle();
  assert.equal(bare.env.requests, 0);

  const refused = await withEnv({ refuse: true });
  refused.mod.holdScreenAwake();
  await settle();
  assert.equal(refused.env.requests, 1);
  refused.mod.releaseScreenAwake();
  refused.mod.holdScreenAwake();   // and it can be asked for again afterwards
  await settle();
  assert.equal(refused.env.requests, 2);
});
