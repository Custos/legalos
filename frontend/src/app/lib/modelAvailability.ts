import { MODELS, type ModelOption } from "../components/assistant/ModelToggle";

export type ModelProvider = "claude" | "gemini" | "xai";

export function getModelProvider(modelId: string): ModelProvider | null {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) return null;
    if (model.group === "Anthropic") return "claude";
    if (model.group === "xAI") return "xai";
    return "gemini";
}

export function isModelAvailable(
    modelId: string,
    apiKeys: {
        claudeApiKey: string | null;
        geminiApiKey: string | null;
        xaiApiKey?: string | null;
    },
): boolean {
    const provider = getModelProvider(modelId);
    if (!provider) return false;
    // xAI: a per-user key in apiKeys.xaiApiKey is preferred; the backend
    // falls back to the env XAI_API_KEY if the user hasn't supplied one,
    // so xai is treated as available whenever the user *has* a key OR we
    // assume the env fallback exists. Show as available unconditionally
    // — calls will fail at runtime if no key is configured anywhere.
    if (provider === "xai") return true;
    return provider === "claude"
        ? !!apiKeys.claudeApiKey?.trim()
        : !!apiKeys.geminiApiKey?.trim();
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: {
        claudeApiKey: string | null;
        geminiApiKey: string | null;
        xaiApiKey?: string | null;
    },
): boolean {
    if (provider === "xai") return true;
    return provider === "claude"
        ? !!apiKeys.claudeApiKey?.trim()
        : !!apiKeys.geminiApiKey?.trim();
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "claude") return "Anthropic (Claude)";
    if (provider === "xai") return "xAI (Grok)";
    return "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    if (group === "Anthropic") return "claude";
    if (group === "xAI") return "xai";
    return "gemini";
}
