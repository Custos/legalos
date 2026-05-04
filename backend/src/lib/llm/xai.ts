import type {
    StreamChatParams,
    StreamChatResult,
    NormalizedToolCall,
    OpenAIToolSchema,
} from "./types";

const XAI_BASE_URL = "https://api.x.ai/v1";

type OpenAIChatMessage =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | {
          role: "assistant";
          content: string | null;
          tool_calls?: {
              id: string;
              type: "function";
              function: { name: string; arguments: string };
          }[];
      }
    | { role: "tool"; tool_call_id: string; content: string };

function apiKey(override?: string | null): string {
    const k = override?.trim() || process.env.XAI_API_KEY || "";
    if (!k) throw new Error("XAI_API_KEY is not set");
    return k;
}

function toMessages(params: StreamChatParams): OpenAIChatMessage[] {
    const out: OpenAIChatMessage[] = [];
    if (params.systemPrompt) out.push({ role: "system", content: params.systemPrompt });
    for (const m of params.messages) {
        if (m.role === "assistant") out.push({ role: "assistant", content: m.content });
        else out.push({ role: "user", content: m.content });
    }
    return out;
}

async function* sseLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).replace(/\r$/, "");
            buf = buf.slice(idx + 1);
            if (line) yield line;
        }
    }
    if (buf) yield buf;
}

export async function streamXai(params: StreamChatParams): Promise<StreamChatResult> {
    const { model, tools = [], callbacks = {}, runTools, apiKeys } = params;
    const maxIter = params.maxIterations ?? 10;
    const key = apiKey(apiKeys?.xai);

    const messages = toMessages(params);
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        const body: Record<string, unknown> = {
            model,
            messages,
            stream: true,
        };
        if (tools.length) {
            body.tools = tools as OpenAIToolSchema[];
            body.tool_choice = "auto";
        }

        const resp = await fetch(`${XAI_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify(body),
        });
        if (!resp.ok || !resp.body) {
            const errText = await resp.text().catch(() => "");
            throw new Error(`xAI API error ${resp.status}: ${errText}`);
        }

        const textParts: string[] = [];
        const callBuffers = new Map<
            number,
            { id: string; name: string; argsText: string }
        >();
        const toolCalls: NormalizedToolCall[] = [];

        for await (const line of sseLines(resp.body)) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") break;
            let chunk: {
                choices?: {
                    delta?: {
                        content?: string;
                        reasoning_content?: string;
                        tool_calls?: {
                            index: number;
                            id?: string;
                            function?: { name?: string; arguments?: string };
                        }[];
                    };
                }[];
            };
            try {
                chunk = JSON.parse(payload);
            } catch {
                continue;
            }
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;
            if (delta.reasoning_content) callbacks.onReasoningDelta?.(delta.reasoning_content);
            if (delta.content) {
                textParts.push(delta.content);
                callbacks.onContentDelta?.(delta.content);
            }
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const cur = callBuffers.get(tc.index) ?? { id: "", name: "", argsText: "" };
                    if (tc.id) cur.id = tc.id;
                    if (tc.function?.name) cur.name = tc.function.name;
                    if (tc.function?.arguments) cur.argsText += tc.function.arguments;
                    callBuffers.set(tc.index, cur);
                }
            }
        }

        for (const cur of callBuffers.values()) {
            let input: Record<string, unknown> = {};
            try {
                input = cur.argsText ? JSON.parse(cur.argsText) : {};
            } catch {
                input = { _raw: cur.argsText };
            }
            const call: NormalizedToolCall = {
                id: cur.id || `${cur.name}-${toolCalls.length}`,
                name: cur.name,
                input,
            };
            callbacks.onToolCallStart?.(call);
            toolCalls.push(call);
        }

        fullText += textParts.join("");

        if (!toolCalls.length || !runTools) break;

        messages.push({
            role: "assistant",
            content: textParts.join("") || null,
            tool_calls: toolCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
            })),
        });

        const results = await runTools(toolCalls);
        for (const r of results) {
            messages.push({
                role: "tool",
                tool_call_id: r.tool_use_id,
                content: r.content,
            });
        }
    }

    return { fullText };
}

export async function completeXaiText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    apiKeys?: { xai?: string | null };
    maxTokens?: number;
}): Promise<string> {
    const key = apiKey(params.apiKeys?.xai);
    const messages: OpenAIChatMessage[] = [];
    if (params.systemPrompt) messages.push({ role: "system", content: params.systemPrompt });
    messages.push({ role: "user", content: params.user });

    const resp = await fetch(`${XAI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
            model: params.model,
            messages,
            ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
        }),
    });
    if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`xAI API error ${resp.status}: ${errText}`);
    }
    const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
}
