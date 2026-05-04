// Document intake analysis. Runs once per uploaded document (project-less or
// project-attached) to classify it for triage:
//
//   - intake_role: are we the buyer (vendor contract), seller (customer
//     contract), or mutual (NDA, partnership)?
//   - intake_status: draft (work-in-progress, redline, marked-up) vs
//     execution (signed final). Falls back to "unknown".
//   - intake_counterparty + intake_parent_counterparty: who's the other
//     side, and any parent company mentioned.
//   - intake_lifecycle_hint: free-form classifier ("original", "amendment",
//     "renewal", "addendum", "sow", "order_form", etc.).
//   - intake_confidence: 0.0–1.0 self-reported confidence.

import { createServerSupabase } from "./supabase";
import { downloadFile } from "./storage";
import { loadActiveVersion } from "./documentVersions";
import { extractPdfMarkdown, extractDocxMarkdown } from "./textExtraction";
import { completeText } from "./llm";
import { getUserModelSettings } from "./userSettings";

const SYSTEM = `You are a legal intake analyst classifying a contract document.

Return ONLY a single minified JSON object, no markdown:
{
  "role": "buyer" | "seller" | "mutual",
  "status": "draft" | "execution" | "unknown",
  "counterparty": <string or null>,
  "parent_counterparty": <string or null>,
  "lifecycle_hint": <string or null>,
  "confidence": <number 0-1>
}

Rules:
- "role": is the user's organization the buyer (vendor contract, we pay), the seller (customer contract, we get paid), or mutual (NDA, partnership, two-sided)? Default to "mutual" if unclear.
- "status": "execution" if signed/executed/final (look for signature blocks, "executed as of", clean text). "draft" if it's a redline, marked-up, has tracked changes, brackets like [TBD], or other work-in-progress signals. "unknown" only if you genuinely cannot tell.
- "counterparty": the other party's legal entity name. Null if undetermined.
- "parent_counterparty": parent corporate entity if the document references one (e.g. "Stripe Inc., a subsidiary of Stripe Holdings"). Null otherwise.
- "lifecycle_hint": one of "original", "amendment", "renewal", "addendum", "sow", "order_form", "msa", "nda", "side_letter", or null. Pick the single best fit based on title/preamble.
- "confidence": your overall confidence in this classification, 0.0 to 1.0.
- High confidence threshold for counterparty. Null is the right answer when ambiguous.`;

export interface IntakeAnalysis {
    role: "buyer" | "seller" | "mutual";
    status: "draft" | "execution" | "unknown";
    counterparty: string | null;
    parent_counterparty: string | null;
    lifecycle_hint: string | null;
    confidence: number;
}

export async function analyzeIntakeFromText(
    model: string,
    filename: string,
    text: string,
    apiKeys?: import("./llm").UserApiKeys,
): Promise<IntakeAnalysis | null> {
    if (!text.trim()) return null;
    const user = `Filename: ${filename}\n\nDocument text (first portion):\n${text.slice(0, 12_000)}`;
    let raw: string;
    try {
        raw = await completeText({
            model,
            systemPrompt: SYSTEM,
            user,
            maxTokens: 300,
            apiKeys,
        });
    } catch (err) {
        console.warn("[intake] LLM call failed", err);
        return null;
    }
    const cleaned = raw
        .replace(/^```(?:json)?\n?/i, "")
        .replace(/\n?```$/, "")
        .trim();
    try {
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;
        const role =
            parsed.role === "buyer" || parsed.role === "seller" || parsed.role === "mutual"
                ? parsed.role
                : "mutual";
        const status =
            parsed.status === "draft" ||
            parsed.status === "execution" ||
            parsed.status === "unknown"
                ? parsed.status
                : "unknown";
        return {
            role,
            status,
            counterparty:
                typeof parsed.counterparty === "string" &&
                parsed.counterparty.trim()
                    ? parsed.counterparty.trim()
                    : null,
            parent_counterparty:
                typeof parsed.parent_counterparty === "string" &&
                parsed.parent_counterparty.trim()
                    ? parsed.parent_counterparty.trim()
                    : null,
            lifecycle_hint:
                typeof parsed.lifecycle_hint === "string" &&
                parsed.lifecycle_hint.trim()
                    ? parsed.lifecycle_hint.trim()
                    : null,
            confidence:
                typeof parsed.confidence === "number"
                    ? Math.max(0, Math.min(1, parsed.confidence))
                    : 0.5,
        };
    } catch {
        return null;
    }
}

export async function maybeAnalyzeIntake(opts: {
    documentId: string;
    userId: string;
}): Promise<void> {
    try {
        const db = createServerSupabase();
        const { data: doc } = await db
            .from("documents")
            .select("id, filename, file_type, intake_analyzed_at")
            .eq("id", opts.documentId)
            .single();
        if (!doc) return;
        if (doc.intake_analyzed_at) return; // already analyzed; skip

        const active = await loadActiveVersion(opts.documentId, db);
        if (!active) return;
        const buf = await downloadFile(active.storage_path);
        if (!buf) return;
        let text = "";
        try {
            text =
                (doc.file_type as string) === "pdf"
                    ? await extractPdfMarkdown(buf)
                    : await extractDocxMarkdown(buf);
        } catch {
            return;
        }
        if (!text) return;

        const { tabular_model, api_keys } = await getUserModelSettings(
            opts.userId,
            db,
        );
        const analysis = await analyzeIntakeFromText(
            tabular_model,
            doc.filename as string,
            text,
            api_keys,
        );
        if (!analysis) return;

        await db
            .from("documents")
            .update({
                intake_role: analysis.role,
                intake_status: analysis.status,
                intake_counterparty: analysis.counterparty,
                intake_parent_counterparty: analysis.parent_counterparty,
                intake_lifecycle_hint: analysis.lifecycle_hint,
                intake_confidence: analysis.confidence,
                intake_analyzed_at: new Date().toISOString(),
            })
            .eq("id", opts.documentId);
    } catch (err) {
        console.warn("[intake] orchestrator failed", err);
    }
}
