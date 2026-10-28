import { describe, expect, test } from "bun:test";
import { modelDefFromLiveRow, modelsFromApiPayload, STATIC_SEED } from "./models";

const LIVE_FIXTURE = {
	object: "list",
	data: [
		{
			id: "grok-4.7",
			name: "Grok 4.7",
			context_window: 256000,
			context_windows: [256000, 500000],
			supports_reasoning_effort: true,
			reasoning_efforts: [{ value: "xhigh" }, { value: "high" }, { value: "medium" }, { value: "low" }],
		},
		{
			id: "grok-4.7-build-fast",
			name: "Grok 4.7 Fast",
			context_window: 256000,
			context_windows: [256000, 500000],
			supports_reasoning_effort: true,
			reasoning_efforts: [{ value: "low" }, { value: "xhigh" }],
		},
		{
			id: "grok-4.6",
			name: "Grok 4.6",
			context_window: 256000,
			context_windows: [256000, 500000],
			supports_reasoning_effort: true,
			reasoning_efforts: [{ value: "high" }, { value: "xhigh" }],
		},
		{
			id: "grok-4.5",
			name: "Grok 4.5",
			context_window: 256000,
			context_windows: [256000, 500000],
			supports_reasoning_effort: true,
			reasoning_efforts: [{ value: "high" }, { value: "medium" }, { value: "low" }],
		},
	],
};

describe("Grok Build model catalog", () => {
	test("static seed is the signed-in CLI lineup at the largest window", () => {
		expect(STATIC_SEED.map(model => model.id)).toEqual([
			"grok-4.7",
			"grok-4.7-build-fast",
			"grok-4.6",
			"grok-4.5",
		]);
		for (const model of STATIC_SEED) {
			expect(model.contextWindow).toBe(500_000);
			expect(model.headers?.["x-grok-context-window"]).toBe("500000");
			expect(model.headers?.["x-grok-model-override"]).toBe(model.id);
			expect(model.input).toEqual(["text", "image"]);
		}
	});

	test("keeps native xhigh on 4.6 and 4.7 and folds it on 4.5", () => {
		const byId = Object.fromEntries(STATIC_SEED.map(model => [model.id, model]));
		const map47 = byId["grok-4.7"]?.compat?.reasoningEffortMap as Record<string, string>;
		const map45 = byId["grok-4.5"]?.compat?.reasoningEffortMap as Record<string, string>;
		expect(map47.xhigh).toBeUndefined();
		expect(map47.minimal).toBe("low");
		expect(map45.xhigh).toBe("high");
		expect(map45.minimal).toBe("low");
	});

	test("parses a live /v1/models payload and skips blank rows", () => {
		const models = modelsFromApiPayload({
			data: [...LIVE_FIXTURE.data, { id: "  " }, null, { name: "missing id" }],
		});
		expect(models.map(model => model.id)).toEqual([
			"grok-4.7",
			"grok-4.7-build-fast",
			"grok-4.6",
			"grok-4.5",
		]);
		expect(models[1]?.name).toBe("Grok 4.7 Fast");
	});

	test("drops an empty id", () => {
		expect(modelDefFromLiveRow({ id: "" })).toBeUndefined();
		expect(modelsFromApiPayload({})).toEqual([]);
	});
});
