// Contract fact extraction. Pulls structured economic terms (effective date,
// term length, total value, currency, auto-renew, notice period, governing
// law) out of a contract document and stores them in contract_facts. Each
// document upload creates one row tied to that document's current version,
// so renewals and re-uploads produce a timeline.
//
// Designed to run alongside counterparty extraction. Failures are
// swallowed; the upload path must not depend on this.

import { createServerSupabase } from "./supabase";
import { downloadFile } from "./storage";
import { loadActiveVersion } from "./documentVersions";
import { extractPdfMarkdown, extractDocxMarkdown } from "./textExtraction";
import { completeText } from "./llm";
import { getUserModelSettings } from "./userSettings";

const SYSTEM = `You are a legal document analyst extracting structured economic terms from a contract.

Return ONLY a single minified JSON object, no markdown:
{
  "effective_date": <YYYY-MM-DD or null>,
  "term_months": <integer or null>,
  "total_value": <number or null>,
  "currency": <ISO 4217 code or null>,
  "auto_renew": <true | false | null>,
  "notice_days": <integer or null>,
  "governing_law": <string or null>
}

Rules:
- "effective_date": when the agreement starts. Null if not stated.
- "term_months": initial term length in whole months. "1 year" → 12. "3 years" → 36. Null if perpetual or not stated.
- "total_value": the total contract value as a number, in major units (dollars, not cents). Null if no fixed total. For "up to" or "not to exceed" caps, use the cap.
- "currency": ISO 4217 code (USD, EUR, GBP, etc.). Null if no monetary amount.
- "auto_renew": true if the contract auto-renews unless terminated, false if it expressly does not, null if unclear.
- "notice_days": how many days notice required to terminate or non-renew. Null if not stated.
- "governing_law": the named state, country, or jurisdiction (e.g. "Delaware", "England and Wales"). Null if not stated.
- Confidence threshold is high. Null is the right answer when ambiguous. Do NOT guess.`;

export interface ContractFacts {
    effective_date: string | null;
    term_months: number | null;
    total_value: number | null;
    currency: string | null;
    auto_renew: boolean | null;
    notice_days: number | null;
    governing_law: string | null;
}

async function loadDocText(
    documentId: string,
    db: ReturnType<typeof createServerSupabase>,
): Promise<{ text: string; versionId: string | null }> {
    const { data: doc } = await db
        .from("documents")
        .select("file_type")
        .eq("id", documentId)
        .single();
    if (!doc) return { text: "", versionId: null };
    const active = await loadActiveVersion(documentId, db);
    if (!active) return { text: "", versionId: null };
    const buf = await downloadFile(active.storage_path);
    if (!buf) return { text: "", versionId: active.id };
    try {
        const text =
            (doc.file_type as string) === "pdf"
                ? await extractPdfMarkdown(buf)
                : await extractDocxMarkdown(buf);
        return { text, versionId: active.id };
    } catch {
        return { text: "", versionId: active.id };
    }
}

export async function extractContractFacts(
    model: string,
    text: string,
    apiKeys?: import("./llm").UserApiKeys,
): Promise<ContractFacts | null> {
    if (!text.trim()) return null;
    let raw: string;
    try {
        raw = await completeText({
            model,
            systemPrompt: SYSTEM,
            user: `Document:\n\n${text.slice(0, 30_000)}`,
            maxTokens: 400,
            apiKeys,
        });
    } catch (err) {
        console.warn("[contract-facts] LLM call failed", err);
        return null;
    }
    const cleaned = raw
        .replace(/^```(?:json)?\n?/i, "")
        .replace(/\n?```$/, "")
        .trim();
    try {
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;
        return {
            effective_date:
                typeof parsed.effective_date === "string"
                    ? parsed.effective_date
                    : null,
            term_months:
                typeof parsed.term_months === "number"
                    ? Math.round(parsed.term_months)
                    : null,
            total_value:
                typeof parsed.total_value === "number"
                    ? parsed.total_value
                    : null,
            currency:
                typeof parsed.currency === "string" ? parsed.currency : null,
            auto_renew:
                typeof parsed.auto_renew === "boolean"
                    ? parsed.auto_renew
                    : null,
            notice_days:
                typeof parsed.notice_days === "number"
                    ? Math.round(parsed.notice_days)
                    : null,
            governing_law:
                typeof parsed.governing_law === "string"
                    ? parsed.governing_law
                    : null,
        };
    } catch {
        return null;
    }
}

// Orchestrator. Loads doc text, runs extraction, writes a new
// contract_facts row tied to the doc's current version. Each call is
// independent — re-uploads and new versions accumulate rows.
export async function maybeExtractContractFacts(opts: {
    projectId: string | null;
    documentId: string;
    userId: string;
}): Promise<void> {
    try {
        const db = createServerSupabase();
        const { text, versionId } = await loadDocText(opts.documentId, db);
        if (!text) return;
        const { tabular_model, api_keys } = await getUserModelSettings(
            opts.userId,
            db,
        );
        const facts = await extractContractFacts(tabular_model, text, api_keys);
        if (!facts) return;

        const totalValueMinor =
            facts.total_value != null
                ? Math.round(facts.total_value * 100)
                : null;

        await db.from("contract_facts").insert({
            project_id: opts.projectId,
            document_id: opts.documentId,
            document_version_id: versionId,
            effective_date: facts.effective_date,
            term_months: facts.term_months,
            total_value_minor: totalValueMinor,
            currency: facts.currency,
            auto_renew: facts.auto_renew,
            notice_days: facts.notice_days,
            governing_law: facts.governing_law,
            raw_extraction: facts as unknown as Record<string, unknown>,
            model: tabular_model,
        });
    } catch (err) {
        console.warn("[contract-facts] orchestrator failed", err);
    }
}
