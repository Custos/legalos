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

function buildSystemPrompt(userOrg: string | null): string {
    const orgLine = userOrg
        ? `\n\nThe user's own organization is "${userOrg}". The user is one party to this contract — NEVER return "${userOrg}" (or any obvious variant: "${userOrg.replace(/[,\.]/g, "").trim()}") as the counterparty. The counterparty is always the OTHER party.`
        : "";
    return `You are a legal intake analyst classifying a contract document.${orgLine}

Return ONLY a single minified JSON object, no markdown:
{
  "role": "buyer" | "seller" | "mutual",
  "status": "draft" | "execution" | "unknown",
  "counterparty": <string or null>,
  "parent_counterparty": <string or null>,
  "lifecycle_hint": <string or null>,
  "summary": <string or null>,
  "confidence": <number 0-1>
}

Rules:
- "role": is the user's organization the buyer (vendor contract, we pay), the seller (customer contract, we get paid), or mutual (NDA, partnership, two-sided)? Default to "mutual" if unclear.
- "status": "execution" if signed/executed/final (look for signature blocks, "executed as of", clean text). "draft" if it's a redline, marked-up, has tracked changes, brackets like [TBD], or other work-in-progress signals. "unknown" only if you genuinely cannot tell.
- "counterparty": the OTHER party's legal entity name (not the user's organization). Null if undetermined.
- "parent_counterparty": parent corporate entity of the COUNTERPARTY if the document references one (e.g. "Stripe Inc., a subsidiary of Stripe Holdings"). Otherwise null.
- "lifecycle_hint": one of "original", "amendment", "renewal", "addendum", "sow", "order_form", "msa", "nda", "side_letter", or null. Pick the single best fit based on title/preamble.
- "summary": one or two sentences (max ~200 chars) describing what this agreement actually covers — the product/service, deal shape, anything notable. Plain prose, no preamble. Null only if you truly can't tell.
- "confidence": your overall confidence in this classification, 0.0 to 1.0.
- High confidence threshold for counterparty. Null is the right answer when ambiguous.`;
}

function normaliseEntityName(s: string): string {
    return s
        .toLowerCase()
        .replace(/[,\.]/g, "")
        .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|ag|sa|plc|llp|lp)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function isSelfReference(
    candidate: string | null,
    userOrg: string | null,
): boolean {
    if (!candidate || !userOrg) return false;
    const a = normaliseEntityName(candidate);
    const b = normaliseEntityName(userOrg);
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
}

// Normalise display casing of an entity name. Many contracts spell the
// counterparty in ALL CAPS in the preamble; preserving that yields ugly
// displays and breaks case-insensitive grouping when other docs use
// title case. Heuristic: if the string is fully uppercase OR fully
// lowercase, convert to Title Case (preserving common suffixes like Inc.,
// LLC, GmbH, AG, plc as-is). Acronyms ≤4 letters with no separators are
// left alone (IBM, AT&T, etc.).
const KEEP_AS_IS = new Set([
    "INC",
    "INC.",
    "LLC",
    "LLP",
    "LP",
    "LTD",
    "LTD.",
    "PLC",
    "GMBH",
    "AG",
    "SA",
    "S.A.",
    "S.A",
    "CO",
    "CO.",
    "&",
]);
function canonicaliseSuffix(token: string): string | null {
    // Strip trailing period for matching, then canonicalise.
    const bare = token.replace(/\.$/, "").toUpperCase();
    if (bare === "INC") return "Inc.";
    if (bare === "LLC") return "LLC";
    if (bare === "LLP") return "LLP";
    if (bare === "LP") return "LP";
    if (bare === "LTD") return "Ltd.";
    if (bare === "PLC") return "plc";
    if (bare === "GMBH") return "GmbH";
    if (bare === "AG") return "AG";
    if (bare === "SA") return "S.A.";
    if (bare === "CO") return "Co.";
    if (bare === "CORP") return "Corp.";
    if (bare === "CORPORATION") return "Corporation";
    if (bare === "INCORPORATED") return "Incorporated";
    if (bare === "LIMITED") return "Limited";
    return null;
}

function normaliseEntityCase(input: string): string {
    const s = input.trim();
    if (!s) return s;
    if (s.length <= 4 && /^[A-Z0-9&.]+$/.test(s)) return s; // IBM, AT&T
    const isAllUpper = s === s.toUpperCase() && /[A-Z]/.test(s);
    const isAllLower = s === s.toLowerCase() && /[a-z]/.test(s);
    // Always canonicalise suffix tokens (Inc → Inc., Inc. → Inc., LLC → LLC,
    // etc.) regardless of overall case so we don't end up with "Airbnb, Inc"
    // and "Airbnb, Inc." treated as different entities.
    return s
        .split(/(\s+|[,;])/)
        .map((tok) => {
            if (/^\s+$/.test(tok) || /^[,;]$/.test(tok)) return tok;
            const canonical = canonicaliseSuffix(tok);
            if (canonical) return canonical;
            if (!isAllUpper && !isAllLower) return tok;
            return (
                tok.charAt(0).toUpperCase() +
                tok.slice(1).toLowerCase()
            );
        })
        .join("");
}

export interface IntakeAnalysis {
    role: "buyer" | "seller" | "mutual";
    status: "draft" | "execution" | "unknown";
    counterparty: string | null;
    parent_counterparty: string | null;
    lifecycle_hint: string | null;
    summary: string | null;
    confidence: number;
}

export async function analyzeIntakeFromText(
    model: string,
    filename: string,
    text: string,
    apiKeys?: import("./llm").UserApiKeys,
    userOrg?: string | null,
): Promise<IntakeAnalysis | null> {
    if (!text.trim()) return null;
    const user = `Filename: ${filename}\n\nDocument text (first portion):\n${text.slice(0, 12_000)}`;
    let raw: string;
    try {
        raw = await completeText({
            model,
            systemPrompt: buildSystemPrompt(userOrg ?? null),
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
        let counterparty: string | null =
            typeof parsed.counterparty === "string" &&
            parsed.counterparty.trim()
                ? normaliseEntityCase(parsed.counterparty.trim())
                : null;
        let parent_counterparty: string | null =
            typeof parsed.parent_counterparty === "string" &&
            parsed.parent_counterparty.trim()
                ? normaliseEntityCase(parsed.parent_counterparty.trim())
                : null;
        // Guard: if the model returned the user's own organization as the
        // counterparty (a common failure when the user's name appears in
        // the filename or first paragraph), null it out rather than store
        // a wrong value.
        if (isSelfReference(counterparty, userOrg ?? null)) counterparty = null;
        if (isSelfReference(parent_counterparty, userOrg ?? null))
            parent_counterparty = null;
        return {
            role,
            status,
            counterparty,
            parent_counterparty,
            lifecycle_hint:
                typeof parsed.lifecycle_hint === "string" &&
                parsed.lifecycle_hint.trim()
                    ? parsed.lifecycle_hint.trim()
                    : null,
            summary:
                typeof parsed.summary === "string" && parsed.summary.trim()
                    ? parsed.summary.trim()
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

        const { tabular_model, api_keys, organisation } =
            await getUserModelSettings(opts.userId, db);
        const analysis = await analyzeIntakeFromText(
            tabular_model,
            doc.filename as string,
            text,
            api_keys,
            organisation,
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
                intake_summary: analysis.summary,
                intake_confidence: analysis.confidence,
                intake_analyzed_at: new Date().toISOString(),
            })
            .eq("id", opts.documentId);
    } catch (err) {
        console.warn("[intake] orchestrator failed", err);
    }
}
