// Who may pick their compose model, and which models they may pick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPOSE_MODELS, DEFAULT_COMPOSE_MODEL, canPickModel, composeModelLabel, pickedModel } from "../lib/composeModels.js";

test("only listed emails may pick, case and spacing ignored", () => {
  const list = " A@example.com, b@example.com\nc@example.com ";
  assert.equal(canPickModel("a@example.com", list), true);
  assert.equal(canPickModel("C@Example.com", list), true);
  assert.equal(canPickModel("d@example.com", list), false);
  assert.equal(canPickModel("", list), false);
  assert.equal(canPickModel("a@example.com", undefined), false);
  assert.equal(canPickModel("a@example.com", ""), false);
});

test("a picked model must be on the list and the account allowed", () => {
  assert.equal(pickedModel("claude-sonnet-5-5", true), "claude-sonnet-5-5");
  assert.equal(pickedModel("claude-sonnet-5-5", false), null);
  assert.equal(pickedModel("some-other-model", true), null);
  assert.equal(pickedModel(undefined, true), null);
});

test("the default is on the menu and every model has a label", () => {
  assert.ok(COMPOSE_MODELS.some((m) => m.id === DEFAULT_COMPOSE_MODEL));
  for (const m of COMPOSE_MODELS) assert.equal(composeModelLabel(m.id), m.label);
});
