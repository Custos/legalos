"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Loader2, Upload } from "lucide-react";
import {
    assignDocumentToProject,
    listIntake,
    uploadIntakeDocument,
    type IntakeDocument,
    type IntakeProjectsRow,
} from "@/app/lib/mikeApi";

const ROLE_LABEL: Record<string, string> = {
    buyer: "Vendor",
    seller: "Customer",
    mutual: "Mutual",
};

const STATUS_STYLE: Record<string, string> = {
    execution: "bg-emerald-50 text-emerald-700 border-emerald-200",
    draft: "bg-amber-50 text-amber-800 border-amber-200",
    unknown: "bg-gray-50 text-gray-500 border-gray-200",
};

function fuzzyMatch(query: string | null, candidate: string | null): number {
    if (!query || !candidate) return 0;
    const a = query.trim().toLowerCase();
    const b = candidate.trim().toLowerCase();
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length >= 3 && b.includes(a)) return 0.9;
    if (b.length >= 3 && a.includes(b)) return 0.9;
    // crude token overlap
    const aTok = new Set(a.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
    const bTok = new Set(b.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
    let hits = 0;
    for (const t of aTok) if (bTok.has(t)) hits++;
    return hits >= 2 ? 0.7 : 0;
}

export function IntakeOverview() {
    const [docs, setDocs] = useState<IntakeDocument[]>([]);
    const [projects, setProjects] = useState<IntakeProjectsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(0);
    const [pollTick, setPollTick] = useState(0);
    const fileRef = useRef<HTMLInputElement>(null);
    const router = useRouter();

    const refresh = useCallback(async () => {
        try {
            const data = await listIntake();
            setDocs(data.documents);
            setProjects(data.projects);
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        setLoading(true);
        refresh().finally(() => setLoading(false));
    }, [refresh]);

    // While analysis is running on freshly uploaded docs (intake_analyzed_at
    // is null), poll every few seconds so the UI fills in.
    useEffect(() => {
        const pending = docs.some((d) => !d.intake_analyzed_at);
        if (!pending) return;
        const t = setTimeout(() => {
            refresh();
            setPollTick((x) => x + 1);
        }, 4000);
        return () => clearTimeout(t);
    }, [docs, pollTick, refresh]);

    async function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        setUploading((n) => n + files.length);
        await Promise.all(
            Array.from(files).map((f) =>
                uploadIntakeDocument(f)
                    .catch(() => null)
                    .finally(() => setUploading((n) => n - 1)),
            ),
        );
        await refresh();
    }

    return (
        <div className="flex-1 overflow-y-auto bg-white">
            <div className="flex items-center justify-between px-8 py-4">
                <div className="flex items-center gap-3">
                    <Inbox className="h-5 w-5 text-gray-500" />
                    <h1 className="text-2xl font-medium font-serif text-gray-900">
                        Intake
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    {uploading > 0 && (
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Uploading {uploading}…
                        </span>
                    )}
                    <input
                        ref={fileRef}
                        type="file"
                        multiple
                        accept=".pdf,.doc,.docx"
                        className="hidden"
                        onChange={(e) => handleFiles(e.target.files)}
                    />
                    <button
                        onClick={() => fileRef.current?.click()}
                        className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
                    >
                        <Upload className="h-3.5 w-3.5" />
                        Bulk upload
                    </button>
                </div>
            </div>

            <p className="px-8 pb-3 text-xs text-gray-500 max-w-2xl">
                Upload contracts here without picking a project. Each is
                classified (vendor vs customer, draft vs execution, lifecycle
                position) and matched against your existing counterparties so
                you can assign it to an existing project or create a new one.
            </p>

            <div className="px-8 pb-12">
                {loading ? (
                    <div className="text-sm text-gray-400 py-8">Loading…</div>
                ) : docs.length === 0 ? (
                    <div className="border border-dashed border-gray-200 rounded-lg p-12 text-center text-sm text-gray-400">
                        Nothing waiting. Drop contracts here to get started.
                    </div>
                ) : (
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                        {docs.map((d) => (
                            <IntakeRow
                                key={d.id}
                                doc={d}
                                projects={projects}
                                onAssigned={(pid) => {
                                    setDocs((prev) =>
                                        prev.filter((x) => x.id !== d.id),
                                    );
                                    router.push(`/projects/${pid}`);
                                }}
                                onRefresh={refresh}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function IntakeRow({
    doc,
    projects,
    onAssigned,
    onRefresh,
}: {
    doc: IntakeDocument;
    projects: IntakeProjectsRow[];
    onAssigned: (projectId: string) => void;
    onRefresh: () => Promise<void>;
}) {
    const [busy, setBusy] = useState(false);
    const matches = useMemo(() => {
        const cp = doc.intake_counterparty;
        if (!cp) return [];
        return projects
            .map((p) => ({
                project: p,
                score: Math.max(
                    fuzzyMatch(cp, p.counterparty),
                    fuzzyMatch(cp, p.name),
                    fuzzyMatch(cp, p.parent_counterparty),
                ),
            }))
            .filter((m) => m.score >= 0.7)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
    }, [doc, projects]);

    async function handleAssignExisting(projectId: string) {
        setBusy(true);
        try {
            await assignDocumentToProject(doc.id, { project_id: projectId });
            onAssigned(projectId);
        } catch {
            await onRefresh();
        } finally {
            setBusy(false);
        }
    }

    async function handleCreateNew() {
        setBusy(true);
        try {
            const template =
                doc.intake_role === "buyer"
                    ? "vendor"
                    : doc.intake_role === "seller"
                      ? "customer"
                      : "internal";
            // Prefer counterparty, append a lifecycle hint to disambiguate
            // multiple contracts with the same counterparty (e.g. "Adobe Inc.
            // — SOW", "Adobe Inc. — Renewal"). Fall back to filename.
            const cp = doc.intake_counterparty?.trim();
            const hint = doc.intake_lifecycle_hint?.trim();
            const name = cp
                ? hint
                    ? `${cp} — ${hint.toUpperCase()}`
                    : cp
                : doc.filename.replace(/\.[a-z0-9]{2,5}$/i, "");
            const r = await assignDocumentToProject(doc.id, {
                new_project: {
                    name,
                    template,
                    counterparty: doc.intake_counterparty ?? undefined,
                    parent_counterparty:
                        doc.intake_parent_counterparty ?? undefined,
                },
            });
            onAssigned(r.project_id);
        } catch {
            await onRefresh();
        } finally {
            setBusy(false);
        }
    }

    const analyzing = !doc.intake_analyzed_at;
    const status = doc.intake_status ?? "unknown";

    return (
        <div className="border-b border-gray-100 last:border-b-0 px-4 py-3 flex items-start gap-4 hover:bg-gray-50 transition-colors">
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                    {doc.filename}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                    {analyzing ? (
                        <span className="text-gray-400 flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Analyzing…
                        </span>
                    ) : (
                        <>
                            {doc.intake_role && (
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                                    {ROLE_LABEL[doc.intake_role] ??
                                        doc.intake_role}
                                </span>
                            )}
                            <span
                                className={`rounded-full border px-2 py-0.5 ${STATUS_STYLE[status]}`}
                            >
                                {status}
                            </span>
                            {doc.intake_lifecycle_hint && (
                                <span className="rounded-full bg-blue-50 border border-blue-100 text-blue-700 px-2 py-0.5">
                                    {doc.intake_lifecycle_hint}
                                </span>
                            )}
                            {doc.intake_counterparty && (
                                <span className="text-gray-500">
                                    · {doc.intake_counterparty}
                                </span>
                            )}
                            {doc.intake_parent_counterparty && (
                                <span className="text-gray-400">
                                    ↳ {doc.intake_parent_counterparty}
                                </span>
                            )}
                            {doc.intake_confidence != null && (
                                <span className="text-gray-300">
                                    {Math.round(doc.intake_confidence * 100)}%
                                </span>
                            )}
                        </>
                    )}
                </div>
            </div>

            <div className="flex flex-col items-end gap-1.5 shrink-0">
                {matches.length > 0 && !analyzing && (
                    <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400">
                            Likely match
                        </span>
                        {matches.map((m) => (
                            <button
                                key={m.project.id}
                                disabled={busy}
                                onClick={() =>
                                    handleAssignExisting(m.project.id)
                                }
                                title={`Assign to project "${m.project.name}"`}
                                className="text-xs text-gray-700 hover:text-gray-900 underline underline-offset-2 disabled:opacity-50"
                            >
                                {m.project.counterparty ?? m.project.name}
                            </button>
                        ))}
                    </div>
                )}
                <div className="flex items-center gap-1.5">
                    {projects.length > 0 && (
                        <select
                            disabled={busy || analyzing}
                            defaultValue=""
                            onChange={(e) => {
                                const v = e.target.value;
                                e.target.value = "";
                                if (v) handleAssignExisting(v);
                            }}
                            className="text-xs rounded-full border border-gray-200 px-2 py-1 bg-white text-gray-600 disabled:opacity-50"
                        >
                            <option value="">Assign to…</option>
                            {projects
                                .slice()
                                .sort((a, b) =>
                                    (a.counterparty ?? a.name).localeCompare(
                                        b.counterparty ?? b.name,
                                    ),
                                )
                                .map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.counterparty
                                            ? `${p.counterparty} (${p.name})`
                                            : p.name}
                                    </option>
                                ))}
                        </select>
                    )}
                    <button
                        disabled={busy || analyzing}
                        onClick={handleCreateNew}
                        className="text-xs rounded-full px-3 py-1 border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    >
                        Create new project
                    </button>
                </div>
            </div>
        </div>
    );
}
