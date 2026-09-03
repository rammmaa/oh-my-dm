import assert from "node:assert/strict";
import test from "node:test";

import {
  DISPLAY_MODELS,
  effortFromModelValue,
  findDisplayModel,
  formatDisplayModel,
  getDisplayModel,
} from "../src/ui/model.js";

test("Claude, Codex, GLM과 Kimi 모델 표기를 제공한다", () => {
  assert.ok(DISPLAY_MODELS.some((model) => model.label === "Opus 5"));
  assert.ok(DISPLAY_MODELS.some((model) => model.label === "gpt-5.6-sol"));
  assert.ok(DISPLAY_MODELS.some((model) => model.label === "gpt-5.6-terra"));
  assert.ok(DISPLAY_MODELS.some((model) => model.label === "GLM-5.1"));
  assert.ok(DISPLAY_MODELS.some((model) => model.label === "Kimi K2.6"));
});

test("모델 id, 이름과 별칭을 찾는다", () => {
  assert.equal(findDisplayModel("Opus 5")?.id, "opus-5");
  assert.equal(findDisplayModel("sol")?.label, "gpt-5.6-sol");
  assert.equal(findDisplayModel("glm")?.id, "glm-5.1");
  assert.equal(findDisplayModel("kimi")?.id, "kimi-k2.6");
  assert.equal(getDisplayModel("missing").id, "opus-5");
});

test("기존 모델 문자열에서 effort를 마이그레이션하고 합쳐 표시한다", () => {
  const model = getDisplayModel("gpt-5.6-sol-medium");
  assert.equal(model.id, "gpt-5.6-sol");
  assert.equal(effortFromModelValue("gpt-5.6-sol-medium"), "medium");
  assert.equal(formatDisplayModel(model, "high"), "gpt-5.6-sol high");
});

test("GLM과 Kimi는 low, medium, high effort를 제공한다", () => {
  const glm = getDisplayModel("glm");
  const kimi = getDisplayModel("kimi");

  assert.deepEqual(glm.efforts, ["low", "medium", "high"]);
  assert.equal(glm.defaultEffort, "medium");
  assert.equal(formatDisplayModel(glm, "high"), "GLM-5.1 high");
  assert.deepEqual(kimi.efforts, ["low", "medium", "high"]);
  assert.equal(kimi.defaultEffort, "medium");
  assert.equal(formatDisplayModel(kimi, "low"), "Kimi K2.6 low");
});
