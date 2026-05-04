// Counterparty auto-extraction. After a document is uploaded to a templated
// project (vendor / customer), we kick off a small LLM call to identify the
// counterparty (the *other* side of the agreement) and an optional parent
// entity. Result is written back to projects.counterparty if that field is
// still empty — never overwrites a manual edit.
//
// Designed to be fire-and-forget. Failures are swallowed; the upload path
// must not depend on this.

import { createServerSupabase } from "./supabase";
import { downloadFile } from "./storage";
import { loadActiveVersion } from "./documentVersions";
import { extractPdfMarkdown, extractDocxMarkdown } from "./textExtraction";
import { completeText } from "./llm";
import { getUserModelSettings } from "./userSettings";
import { getTemplate } from "./projectTemplates";

function buildSystemPrompt(userOrg: string | null): string {
    const orgLine = userOrg
        ? `\n\nThe user's own organization is "${userOrg}". The user is one party to this contract — NEVER return "${userOrg}" or any obvious variant as the counterparty. The counterparty is always the OTHER party.`
        : "";
    return `You are a legal document analyst. Identify the counterparty in this contract.${orgLine}

If the role hint says "buyer", the counterparty is the vendor/seller. If the role hint says "seller", the counterparty is the customer/buyer. If the role is "mutual" (NDA, partnership), pick whichever party is NOT the user's organization, or return null if undetermined.

Return ONLY a single minified JSON object, no markdown, no preamble:
{"name": <string or null>, "parent": <string or null>}

Rules:
- "name": the OTHER party's legal entity name (preserve "Inc.", "LLC", commas, etc.). Null if you can't identify with high confidence.
- "parent": parent corporate entity of the COUNTERPARTY if the document mentions one. Otherwise null.
- Do not guess. Confidence threshold is high — null is the right answer when it's ambiguous.`;
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

interface ExtractResult {
    name: string | null;
    parent: string | null;
}

async function loadDocText(
    documentId: string,
    db: ReturnType<typeof createServerSupabase>,
): Promise<string> {
    const { data: doc } = await db
        .from("documents")
        .select("file_type")
        .eq("id", documentId)
        .single();
    if (!doc) return "";
    const active = await loadActiveVersion(documentId, db);
    if (!active) return "";
    const buf = await downloadFile(active.storage_path);
    if (!buf) return "";
    try {
        return (doc.file_type as string) === "pdf"
            ? await extractPdfMarkdown(buf)
            : await extractDocxMarkdown(buf);
    } catch {
        return "";
    }
}

export async function extractCounterpartyFromText(
    model: string,
    role: "buyer" | "seller" | "mutual",
    filename: string,
    text: string,
    apiKeys?: import("./llm").UserApiKeys,
    userOrg?: string | null,
): Promise<ExtractResult | null> {
    if (!text.trim()) return null;
    const user = `Role hint: ${role}\nFilename: ${filename}\n\nFirst portion of document:\n${text.slice(0, 8_000)}`;
    let raw: string;
    try {
        raw = await completeText({
            model,
            systemPrompt: buildSystemPrompt(userOrg ?? null),
            user,
            maxTokens: 200,
            apiKeys,
        });
    } catch (err) {
        console.warn("[counterparty] LLM call failed", err);
        return null;
    }
    const cleaned = raw
        .replace(/^```(?:json)?\n?/i, "")
        .replace(/\n?```$/, "")
        .trim();
    try {
        const parsed = JSON.parse(cleaned) as {
            name?: unknown;
            parent?: unknown;
        };
        let name: string | null =
            typeof parsed.name === "string" && parsed.name.trim()
                ? parsed.name.trim()
                : null;
        let parent: string | null =
            typeof parsed.parent === "string" && parsed.parent.trim()
                ? parsed.parent.trim()
                : null;
        if (isSelfReference(name, userOrg ?? null)) name = null;
        if (isSelfReference(parent, userOrg ?? null)) parent = null;
        return { name, parent };
    } catch {
        return null;
    }
}

// Orchestrator. Loads the project, decides whether extraction should run,
// and writes the result back if appropriate. Safe to call fire-and-forget.
export async function maybeAutofillCounterparty(opts: {
    projectId: string;
    documentId: string;
    userId: string;
}): Promise<void> {
    try {
        const db = createServerSupabase();
        const { data: project } = await db
            .from("projects")
            .select(
                "id, template, role, counterparty, parent_counterparty",
            )
            .eq("id", opts.projectId)
            .single();
        if (!project) return;
        const tmpl = getTemplate(project.template as string | null);
        if (!tmpl) return; // Untemplated projects skip auto-extraction.
        if ((project.counterparty as string | null)?.trim()) return; // manual value wins
        const text = await loadDocText(opts.documentId, db);
        if (!text) return;

        const { tabular_model, api_keys, organisation } =
            await getUserModelSettings(opts.userId, db);
        const result = await extractCounterpartyFromText(
            tabular_model,
            tmpl.role,
            "uploaded document",
            text,
            api_keys,
            organisation,
        );
        if (!result?.name) return;

        // Re-check the project before writing — a concurrent manual edit
        // should not be overwritten.
        const { data: latest } = await db
            .from("projects")
            .select("counterparty, parent_counterparty")
            .eq("id", opts.projectId)
            .single();
        if (!latest) return;
        const updates: Record<string, unknown> = {};
        if (!(latest.counterparty as string | null)?.trim())
            updates.counterparty = result.name;
        if (
            result.parent &&
            !(latest.parent_counterparty as string | null)?.trim()
        )
            updates.parent_counterparty = result.parent;
        if (Object.keys(updates).length === 0) return;
        updates.updated_at = new Date().toISOString();
        await db.from("projects").update(updates).eq("id", opts.projectId);
    } catch (err) {
        console.warn("[counterparty] orchestrator failed", err);
    }
}
