"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Loader2, Upload } from "lucide-react";
import {
    assignDocumentToProject,
    bulkAssignDocumentsToProject,
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

type RoleFilter = "all" | "buyer" | "seller" | "mutual";
const ROLE_FILTERS: { id: RoleFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "buyer", label: "Vendors" },
    { id: "seller", label: "Customers" },
    { id: "mutual", label: "Internal / Other" },
];

export function IntakeOverview() {
    const [docs, setDocs] = useState<IntakeDocument[]>([]);
    const [projects, setProjects] = useState<IntakeProjectsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(0);
    const [pollTick, setPollTick] = useState(0);
    const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkProject, setBulkProject] = useState<string>("");
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

    const visibleDocs = useMemo(() => {
        if (roleFilter === "all") return docs;
        return docs.filter((d) => (d.intake_role ?? "mutual") === roleFilter);
    }, [docs, roleFilter]);

    const allVisibleSelected =
        visibleDocs.length > 0 &&
        visibleDocs.every((d) => selected.has(d.id));
    const someVisibleSelected =
        !allVisibleSelected &&
        visibleDocs.some((d) => selected.has(d.id));

    function toggleAll() {
        const next = new Set(selected);
        if (allVisibleSelected) {
            for (const d of visibleDocs) next.delete(d.id);
        } else {
            for (const d of visibleDocs) next.add(d.id);
        }
        setSelected(next);
    }

    function toggleOne(id: string) {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    }

    async function handleBulkAssign() {
        if (!bulkProject || selected.size === 0) return;
        setBulkBusy(true);
        try {
            await bulkAssignDocumentsToProject(Array.from(selected), {
                project_id: bulkProject,
            });
            setSelected(new Set());
            setBulkProject("");
            await refresh();
        } finally {
            setBulkBusy(false);
        }
    }

    async function handleBulkCreate() {
        if (selected.size === 0) return;
        const selectedDocs = docs.filter((d) => selected.has(d.id));
        // Use the most-frequent counterparty + role across the selection.
        const cpCount = new Map<string, number>();
        const roleCount = new Map<string, number>();
        for (const d of selectedDocs) {
            const cp = d.intake_counterparty?.trim();
            if (cp) cpCount.set(cp, (cpCount.get(cp) ?? 0) + 1);
            const r = d.intake_role ?? "mutual";
            roleCount.set(r, (roleCount.get(r) ?? 0) + 1);
        }
        const topCp = [...cpCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const topRole = [...roleCount.entries()].sort(
            (a, b) => b[1] - a[1],
        )[0]?.[0];
        const template =
            topRole === "buyer"
                ? "vendor"
                : topRole === "seller"
                  ? "customer"
                  : "internal";
        const name =
            topCp ?? `${selectedDocs.length} document bundle`;
        setBulkBusy(true);
        try {
            await bulkAssignDocumentsToProject(Array.from(selected), {
                new_project: {
                    name,
                    template,
                },
            });
            setSelected(new Set());
            await refresh();
        } finally {
            setBulkBusy(false);
        }
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
                Standalone documents stay first-class and show up under their
                counterparty without needing a project.
            </p>

            <div className="px-8 pb-2 flex items-center gap-2 flex-wrap">
                {ROLE_FILTERS.map((f) => {
                    const count =
                        f.id === "all"
                            ? docs.length
                            : docs.filter(
                                  (d) =>
                                      (d.intake_role ?? "mutual") === f.id,
                              ).length;
                    return (
                        <button
                            key={f.id}
                            onClick={() => setRoleFilter(f.id)}
                            className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                                roleFilter === f.id
                                    ? "border-gray-900 bg-gray-900 text-white"
                                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                            }`}
                        >
                            {f.label} {count > 0 && `(${count})`}
                        </button>
                    );
                })}
            </div>

            {selected.size > 0 && (
                <div className="mx-8 mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-center gap-2">
                    <span className="text-xs text-gray-700">
                        {selected.size} selected
                    </span>
                    <span className="text-xs text-gray-300">·</span>
                    <select
                        value={bulkProject}
                        onChange={(e) => setBulkProject(e.target.value)}
                        disabled={bulkBusy || projects.length === 0}
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600 disabled:opacity-50"
                    >
                        <option value="">Assign to existing project…</option>
                        {projects
                            .slice()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                    </select>
                    <button
                        disabled={!bulkProject || bulkBusy}
                        onClick={handleBulkAssign}
                        className="text-xs rounded-full bg-gray-900 text-white px-3 py-1 disabled:opacity-40"
                    >
                        Assign
                    </button>
                    <span className="text-xs text-gray-300">or</span>
                    <button
                        disabled={bulkBusy}
                        onClick={handleBulkCreate}
                        className="text-xs rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100 px-3 py-1 disabled:opacity-40"
                    >
                        Create new project from selection
                    </button>
                    <button
                        disabled={bulkBusy}
                        onClick={() => setSelected(new Set())}
                        className="ml-auto text-xs text-gray-500 hover:text-gray-700"
                    >
                        Clear
                    </button>
                </div>
            )}

            <div className="px-8 pb-12">
                {loading ? (
                    <div className="text-sm text-gray-400 py-8">Loading…</div>
                ) : visibleDocs.length === 0 ? (
                    <div className="border border-dashed border-gray-200 rounded-lg p-12 text-center text-sm text-gray-400">
                        {docs.length === 0
                            ? "Nothing waiting. Drop contracts here to get started."
                            : "Nothing matches this filter."}
                    </div>
                ) : (
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-gray-50/40 text-[10px] uppercase tracking-wider text-gray-400">
                            <input
                                type="checkbox"
                                className="h-3 w-3 cursor-pointer accent-black"
                                checked={allVisibleSelected}
                                ref={(el) => {
                                    if (el)
                                        el.indeterminate = someVisibleSelected;
                                }}
                                onChange={toggleAll}
                            />
                            <span>{visibleDocs.length} documents</span>
                        </div>
                        {visibleDocs.map((d) => (
                            <IntakeRow
                                key={d.id}
                                doc={d}
                                projects={projects}
                                checked={selected.has(d.id)}
                                onToggleCheck={() => toggleOne(d.id)}
                                onAssigned={(pid) => {
                                    setDocs((prev) =>
                                        prev.filter((x) => x.id !== d.id),
                                    );
                                    setSelected((prev) => {
                                        const n = new Set(prev);
                                        n.delete(d.id);
                                        return n;
                                    });
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
    checked,
    onToggleCheck,
    onAssigned,
    onRefresh,
}: {
    doc: IntakeDocument;
    projects: IntakeProjectsRow[];
    checked: boolean;
    onToggleCheck: () => void;
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
                score: fuzzyMatch(cp, p.name),
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
                new_project: { name, template },
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
        <div className="border-b border-gray-100 last:border-b-0 px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors">
            <input
                type="checkbox"
                checked={checked}
                onChange={onToggleCheck}
                className="mt-1 h-3 w-3 cursor-pointer accent-black shrink-0"
            />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                    {doc.filename}
                </div>
                {doc.intake_summary && (
                    <div className="mt-0.5 text-[12px] text-gray-600 leading-snug">
                        {doc.intake_summary}
                    </div>
                )}
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
                                {m.project.name}
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
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
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
