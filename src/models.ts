/**
 * Grok Build model catalog (official CLI proxy parity).
 *
 * Offline seed matches `GET https://cli-chat-proxy.grok.com/v1/models` for a
 * signed-in Grok CLI 1.0.70 account (2026-10-28): grok-4.7, grok-4.7-build-fast,
 * grok-4.6, grok-4.5. Each row is registered at its largest advertised context
 * window. Signed-in `fetchGrokBuildModels` replaces this seed with the live list.
 *
 * Wire path via custom stream API `grok-build-cli` → openai-responses transport
 * with official CLI fingerprint headers (see stream.ts / identity.ts).
 */

import { GROK_BUILD_API, GROK_BUILD_BASE_URL, GROK_BUILD_HEADERS } from "./constants";

export interface GrokBuildModelDef {
	id: string;
	name: string;
	api?: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
	baseUrl?: string;
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;
const DEFAULT_MAX_TOKENS = 64_000;

/** Efforts the CLI proxy names. Unknown values are dropped. */
const KNOWN_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
type KnownEffort = (typeof KNOWN_EFFORTS)[number];

interface LiveEffort {
	value?: unknown;
	id?: unknown;
}

interface LiveModelRow {
	id?: unknown;
	name?: unknown;
	description?: unknown;
	context_window?: unknown;
	context_windows?: unknown;
	supports_reasoning_effort?: unknown;
	reasoning_efforts?: unknown;
}

/**
 * Offline snapshot of the signed-in CLI catalog. Live discovery uses the same
 * mapper, so a newer account lineup replaces these rows after login.
 */
const SEED_ROWS: readonly LiveModelRow[] = [
	{
		id: "grok-4.7",
		name: "Grok 4.7",
		description: "SpaceXAI's latest frontier model",
		context_window: 256_000,
		context_windows: [256_000, 500_000],
		supports_reasoning_effort: true,
		reasoning_efforts: [
			{ value: "xhigh" },
			{ value: "high" },
			{ value: "medium" },
			{ value: "low" },
		],
	},
	{
		id: "grok-4.7-build-fast",
		name: "Grok 4.7 Fast",
		description: "Fast variant. 2x the price.",
		context_window: 256_000,
		context_windows: [256_000, 500_000],
		supports_reasoning_effort: true,
		reasoning_efforts: [
			{ value: "xhigh" },
			{ value: "high" },
			{ value: "medium" },
			{ value: "low" },
		],
	},
	{
		id: "grok-4.6",
		name: "Grok 4.6",
		context_window: 256_000,
		context_windows: [256_000, 500_000],
		supports_reasoning_effort: true,
		reasoning_efforts: [
			{ value: "xhigh" },
			{ value: "high" },
			{ value: "medium" },
			{ value: "low" },
		],
	},
	{
		id: "grok-4.5",
		name: "Grok 4.5",
		context_window: 256_000,
		context_windows: [256_000, 500_000],
		supports_reasoning_effort: true,
		reasoning_efforts: [{ value: "high" }, { value: "medium" }, { value: "low" }],
	},
];

function asPositiveInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	return Math.floor(value);
}

function largestContextWindow(row: LiveModelRow): number {
	const windows: number[] = [];
	const primary = asPositiveInt(row.context_window);
	if (primary) windows.push(primary);
	if (Array.isArray(row.context_windows)) {
		for (const entry of row.context_windows) {
			const parsed = asPositiveInt(entry);
			if (parsed) windows.push(parsed);
		}
	}
	return windows.length > 0 ? Math.max(...windows) : 200_000;
}

function effortList(row: LiveModelRow): KnownEffort[] {
	if (!Array.isArray(row.reasoning_efforts)) return [];
	const found: KnownEffort[] = [];
	for (const entry of row.reasoning_efforts) {
		if (!entry || typeof entry !== "object") continue;
		const raw = (entry as LiveEffort).value ?? (entry as LiveEffort).id;
		if (typeof raw !== "string") continue;
		const effort = raw.trim().toLowerCase();
		if ((KNOWN_EFFORTS as readonly string[]).includes(effort) && !found.includes(effort as KnownEffort)) {
			found.push(effort as KnownEffort);
		}
	}
	return found;
}

function reasoningCompat(efforts: readonly KnownEffort[]): Record<string, unknown> {
	const reasoningEffortMap: Record<string, string> = { minimal: "low" };
	if (!efforts.includes("xhigh")) reasoningEffortMap.xhigh = "high";
	return {
		supportsReasoningEffort: efforts.length > 0,
		supportsReasoningParams: efforts.length > 0,
		reasoningEffortMap,
		promptCacheSessionHeader: "x-grok-conv-id",
	};
}

/** Map one `/v1/models` row onto the omp provider model at its largest window. */
export function modelDefFromLiveRow(row: LiveModelRow): GrokBuildModelDef | undefined {
	if (typeof row.id !== "string" || row.id.trim().length === 0) return undefined;
	const id = row.id.trim();
	const contextWindow = largestContextWindow(row);
	const efforts = effortList(row);
	const reasoning = row.supports_reasoning_effort === true || efforts.length > 0;
	const name = typeof row.name === "string" && row.name.trim().length > 0 ? row.name.trim() : id;
	return {
		id,
		name,
		api: GROK_BUILD_API,
		reasoning,
		input: id.startsWith("grok-") ? ["text", "image"] : ["text"],
		cost: { ...ZERO_COST },
		contextWindow,
		maxTokens: Math.min(contextWindow, DEFAULT_MAX_TOKENS),
		headers: {
			"x-grok-model-override": id,
			"x-grok-context-window": String(contextWindow),
		},
		compat: reasoning ? reasoningCompat(efforts) : { promptCacheSessionHeader: "x-grok-conv-id" },
		baseUrl: GROK_BUILD_BASE_URL,
	};
}

/** Parse a `/v1/models` JSON body. Returns [] when the payload has no rows. */
export function modelsFromApiPayload(payload: unknown): GrokBuildModelDef[] {
	if (!payload || typeof payload !== "object") return [];
	const data = "data" in payload ? payload.data : undefined;
	if (!Array.isArray(data)) return [];
	const models: GrokBuildModelDef[] = [];
	for (const row of data) {
		if (!row || typeof row !== "object") continue;
		const model = modelDefFromLiveRow(row);
		if (model) models.push(model);
	}
	return models;
}

export const STATIC_SEED: readonly GrokBuildModelDef[] = SEED_ROWS.flatMap(row => {
	const model = modelDefFromLiveRow(row);
	return model ? [model] : [];
});

export function toProviderModel(model: GrokBuildModelDef) {
	return {
		id: model.id,
		name: model.name,
		api: GROK_BUILD_API,
		reasoning: model.reasoning,
		input: model.input,
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		headers: model.headers,
		compat: model.compat,
	};
}

/**
 * Live catalog for the signed-in account. Throws when unauthenticated or the
 * proxy rejects the call so omp keeps {@link STATIC_SEED} instead of caching
 * an empty list.
 */
export async function fetchGrokBuildModels(apiKey: string | undefined): Promise<GrokBuildModelDef[]> {
	if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
		throw new Error("Grok Build model discovery requires a signed-in account");
	}
	const response = await fetch(`${GROK_BUILD_BASE_URL}/models`, {
		headers: {
			Authorization: `Bearer ${apiKey.trim()}`,
			Accept: "application/json",
			...GROK_BUILD_HEADERS,
		},
	});
	if (!response.ok) {
		throw new Error(`Grok Build GET /v1/models failed: ${response.status}`);
	}
	const models = modelsFromApiPayload(await response.json());
	if (models.length === 0) {
		throw new Error("Grok Build GET /v1/models returned no models");
	}
	return models;
}
