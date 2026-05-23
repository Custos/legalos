"use client";
// Intake — bulk upload + classify + assign. Built directly with the
// legalos design system. The previous Tailwind-based IntakeOverview
// component is bypassed.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
    Button,
    Card,
    Icon,
    PageScroll,
    SectionHeader,
    Stat,
    Tag,
} from "@/app/components/legalos/Primitives";
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
type RoleFilter = "all" | "buyer" | "seller" | "mutual";
const ROLE_FILTERS: { id: RoleFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "buyer", label: "Vendors" },
    { id: "seller", label: "Customers" },
    { id: "mutual", label: "Internal · Other" },
];

function fuzzyMatch(query: string | null, candidate: string | null): number {
    if (!query || !candidate) return 0;
    const a = query.trim().toLowerCase();
    const b = candidate.trim().toLowerCase();
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length >= 3 && b.includes(a)) return 0.9;
    if (b.length >= 3 && a.includes(b)) return 0.9;
    const aTok = new Set(a.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
    const bTok = new Set(b.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
    let hits = 0;
    for (const t of aTok) if (bTok.has(t)) hits++;
    return hits >= 2 ? 0.7 : 0;
}

export default function IntakePage() {
    const [docs, setDocs] = React.useState<IntakeDocument[]>([]);
    const [projects, setProjects] = React.useState<IntakeProjectsRow[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [uploading, setUploading] = React.useState(0);
    const [pollTick, setPollTick] = React.useState(0);
    const [roleFilter, setRoleFilter] = React.useState<RoleFilter>("all");
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [bulkBusy, setBulkBusy] = React.useState(false);
    const [bulkProject, setBulkProject] = React.useState("");
    const fileRef = React.useRef<HTMLInputElement>(null);
    const router = useRouter();

    const refresh = React.useCallback(async () => {
        try {
            const data = await listIntake();
            setDocs(data.documents);
            setProjects(data.projects);
        } catch {
            /* ignore */
        }
    }, []);

    React.useEffect(() => {
        setLoading(true);
        refresh().finally(() => setLoading(false));
    }, [refresh]);

    React.useEffect(() => {
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

    const visibleDocs = React.useMemo(() => {
        if (roleFilter === "all") return docs;
        return docs.filter((d) => (d.intake_role ?? "mutual") === roleFilter);
    }, [docs, roleFilter]);

    const allVisible =
        visibleDocs.length > 0 && visibleDocs.every((d) => selected.has(d.id));
    const someVisible =
        !allVisible && visibleDocs.some((d) => selected.has(d.id));

    function toggleAll() {
        const next = new Set(selected);
        if (allVisible) for (const d of visibleDocs) next.delete(d.id);
        else for (const d of visibleDocs) next.add(d.id);
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
        const sel = docs.filter((d) => selected.has(d.id));
        const cpCount = new Map<string, number>();
        const roleCount = new Map<string, number>();
        for (const d of sel) {
            const cp = d.intake_counterparty?.trim();
            if (cp) cpCount.set(cp, (cpCount.get(cp) ?? 0) + 1);
            const r = d.intake_role ?? "mutual";
            roleCount.set(r, (roleCount.get(r) ?? 0) + 1);
        }
        const topCp = [...cpCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const topRole = [...roleCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const template =
            topRole === "buyer"
                ? "vendor"
                : topRole === "seller"
                  ? "customer"
                  : "internal";
        const name = topCp ?? `${sel.length} document bundle`;
        setBulkBusy(true);
        try {
            await bulkAssignDocumentsToProject(Array.from(selected), {
                new_project: { name, template },
            });
            setSelected(new Set());
            await refresh();
        } finally {
            setBulkBusy(false);
        }
    }

    const counts: Record<RoleFilter, number> = {
        all: docs.length,
        buyer: docs.filter((d) => d.intake_role === "buyer").length,
        seller: docs.filter((d) => d.intake_role === "seller").length,
        mutual: docs.filter((d) => (d.intake_role ?? "mutual") === "mutual").length,
    };
    const pendingAnalysis = docs.filter((d) => !d.intake_analyzed_at).length;

    return (
        <PageScroll>
            <SectionHeader
                title="INTAKE · TRIAGE"
                subtitle={
                    pendingAnalysis > 0
                        ? `${docs.length} pending · ${pendingAnalysis} analyzing`
                        : `${docs.length} pending · all classified`
                }
                right={
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {uploading > 0 && (
                            <span
                                style={{
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 11,
                                    color: "var(--fg-muted)",
                                }}
                            >
                                uploading {uploading}…
                            </span>
                        )}
                        <input
                            ref={fileRef}
                            type="file"
                            multiple
                            accept=".pdf,.doc,.docx"
                            style={{ display: "none" }}
                            onChange={(e) => handleFiles(e.target.files)}
                        />
                        <Button
                            kind="primary"
                            size="sm"
                            icon={<Icon.Plus />}
                            onClick={() => fileRef.current?.click()}
                        >
                            Bulk upload
                        </Button>
                    </div>
                }
            />

            <div style={{ display: "flex", gap: 10 }}>
                <Stat label="PENDING" value={String(docs.length)} />
                <Stat
                    label="ANALYZING"
                    value={String(pendingAnalysis)}
                    tone={pendingAnalysis > 0 ? "info" : "neutral"}
                />
                <Stat label="CUSTOMERS" value={String(counts.seller)} />
                <Stat label="VENDORS" value={String(counts.buyer)} />
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ROLE_FILTERS.map((f) => {
                    const c = counts[f.id];
                    const active = roleFilter === f.id;
                    return (
                        <button
                            key={f.id}
                            onClick={() => setRoleFilter(f.id)}
                            style={{
                                height: 24,
                                padding: "0 10px",
                                fontFamily: "var(--font-sans)",
                                fontSize: 12,
                                border: "1px solid var(--border)",
                                borderRadius: 3,
                                background: active ? "var(--ink-90)" : "var(--bg)",
                                color: active ? "var(--ink-00)" : "var(--fg)",
                                cursor: "pointer",
                            }}
                        >
                            {f.label} {c > 0 ? `(${c})` : ""}
                        </button>
                    );
                })}
            </div>

            {selected.size > 0 && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        background: "var(--bg-subtle)",
                        border: "1px solid var(--border)",
                        borderRadius: 3,
                    }}
                >
                    <span
                        style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            color: "var(--fg-strong)",
                        }}
                    >
                        {selected.size} selected
                    </span>
                    <span style={{ color: "var(--fg-faint)" }}>·</span>
                    <select
                        value={bulkProject}
                        onChange={(e) => setBulkProject(e.target.value)}
                        disabled={bulkBusy || projects.length === 0}
                        style={{
                            fontFamily: "var(--font-sans)",
                            fontSize: 12,
                            padding: "0 8px",
                            height: 24,
                            border: "1px solid var(--border)",
                            borderRadius: 3,
                            background: "var(--bg)",
                            color: "var(--fg)",
                        }}
                    >
                        <option value="">Assign to existing matter…</option>
                        {projects
                            .slice()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                    </select>
                    <Button
                        kind="primary"
                        size="sm"
                        disabled={!bulkProject || bulkBusy}
                        onClick={handleBulkAssign}
                    >
                        Assign
                    </Button>
                    <span style={{ color: "var(--fg-faint)", fontSize: 11 }}>or</span>
                    <Button size="sm" disabled={bulkBusy} onClick={handleBulkCreate}>
                        Create matter from selection
                    </Button>
                    <span style={{ flex: 1 }} />
                    <Button
                        kind="ghost"
                        size="sm"
                        disabled={bulkBusy}
                        onClick={() => setSelected(new Set())}
                    >
                        Clear
                    </Button>
                </div>
            )}

            <Card padding={0}>
                {loading ? (
                    <div
                        style={{
                            padding: "16px 14px",
                            fontSize: 12,
                            color: "var(--fg-muted)",
                        }}
                    >
                        Loading…
                    </div>
                ) : visibleDocs.length === 0 ? (
                    <div
                        style={{
                            padding: "32px 14px",
                            textAlign: "center",
                            fontSize: 12,
                            color: "var(--fg-muted)",
                        }}
                    >
                        {docs.length === 0
                            ? "No documents in intake. Drop files or click Bulk upload to begin."
                            : "Nothing matches this filter."}
                    </div>
                ) : (
                    <>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "0 12px",
                                height: 24,
                                background: "var(--bg-subtle)",
                                borderBottom: "1px solid var(--border)",
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: "0.08em",
                                color: "var(--fg-muted)",
                                textTransform: "uppercase",
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={allVisible}
                                ref={(el) => {
                                    if (el) el.indeterminate = someVisible;
                                }}
                                onChange={toggleAll}
                                style={{ accentColor: "var(--ink-90)" }}
                            />
                            <span>{visibleDocs.length} documents</span>
                        </div>
                        {visibleDocs.map((d, i) => (
                            <IntakeRow
                                key={d.id}
                                doc={d}
                                projects={projects}
                                checked={selected.has(d.id)}
                                onToggle={() => toggleOne(d.id)}
                                last={i === visibleDocs.length - 1}
                                onAssigned={(pid) => {
                                    setDocs((prev) => prev.filter((x) => x.id !== d.id));
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
                    </>
                )}
            </Card>

            <div
                style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--fg-faint)",
                }}
            >
                ↑↓ navigate · ⏎ open · ⌘E approve · ⌘R re-route
            </div>
        </PageScroll>
    );
}

function IntakeRow({
    doc,
    projects,
    checked,
    onToggle,
    onAssigned,
    onRefresh,
    last,
}: {
    doc: IntakeDocument;
    projects: IntakeProjectsRow[];
    checked: boolean;
    onToggle: () => void;
    onAssigned: (projectId: string) => void;
    onRefresh: () => Promise<void>;
    last: boolean;
}) {
    const [busy, setBusy] = React.useState(false);
    const matches = React.useMemo(() => {
        const cp = doc.intake_counterparty;
        if (!cp) return [];
        return projects
            .map((p) => ({ project: p, score: fuzzyMatch(cp, p.name) }))
            .filter((m) => m.score >= 0.7)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
    }, [doc, projects]);

    async function assignExisting(projectId: string) {
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
    async function createNew() {
        setBusy(true);
        try {
            const template =
                doc.intake_role === "buyer"
                    ? "vendor"
                    : doc.intake_role === "seller"
                      ? "customer"
                      : "internal";
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
    const statusTone =
        status === "execution" ? "clean" : status === "draft" ? "med" : "neutral";

    return (
        <div
            style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 12px",
                borderBottom: last ? "none" : "1px solid var(--hairline)",
                background: "var(--bg)",
            }}
        >
            <input
                type="checkbox"
                checked={checked}
                onChange={onToggle}
                style={{ marginTop: 4, accentColor: "var(--ink-90)" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--fg-strong)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {doc.filename}
                </div>
                {doc.intake_summary && (
                    <div
                        style={{
                            fontSize: 12,
                            color: "var(--fg)",
                            marginTop: 3,
                            lineHeight: 1.4,
                        }}
                    >
                        {doc.intake_summary}
                    </div>
                )}
                <div
                    style={{
                        marginTop: 6,
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 6,
                    }}
                >
                    {analyzing ? (
                        <span
                            style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 10,
                                color: "var(--fg-muted)",
                            }}
                        >
                            analyzing…
                        </span>
                    ) : (
                        <>
                            {doc.intake_role && (
                                <Tag tone="neutral">
                                    {ROLE_LABEL[doc.intake_role] ?? doc.intake_role}
                                </Tag>
                            )}
                            <Tag tone={statusTone}>{status}</Tag>
                            {doc.intake_lifecycle_hint && (
                                <Tag tone="info">{doc.intake_lifecycle_hint}</Tag>
                            )}
                            {doc.intake_counterparty && (
                                <span
                                    style={{
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 11,
                                        color: "var(--fg)",
                                    }}
                                >
                                    · {doc.intake_counterparty}
                                </span>
                            )}
                            {doc.intake_parent_counterparty && (
                                <span
                                    style={{
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 11,
                                        color: "var(--fg-muted)",
                                    }}
                                >
                                    ↳ {doc.intake_parent_counterparty}
                                </span>
                            )}
                            {doc.intake_confidence != null && (
                                <span
                                    style={{
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 10,
                                        color: "var(--fg-faint)",
                                    }}
                                >
                                    {Math.round(doc.intake_confidence * 100)}%
                                </span>
                            )}
                        </>
                    )}
                </div>
            </div>

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 6,
                    flexShrink: 0,
                }}
            >
                {matches.length > 0 && !analyzing && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            gap: 2,
                        }}
                    >
                        <span
                            style={{
                                fontSize: 9,
                                fontWeight: 600,
                                letterSpacing: "0.10em",
                                color: "var(--fg-muted)",
                                textTransform: "uppercase",
                            }}
                        >
                            LIKELY MATCH
                        </span>
                        {matches.map((m) => (
                            <button
                                key={m.project.id}
                                disabled={busy}
                                onClick={() => assignExisting(m.project.id)}
                                style={{
                                    fontFamily: "var(--font-sans)",
                                    fontSize: 11,
                                    color: "var(--fg)",
                                    background: "transparent",
                                    border: "none",
                                    borderBottom: "1px dotted var(--fg-faint)",
                                    cursor: "pointer",
                                    padding: 0,
                                    opacity: busy ? 0.5 : 1,
                                }}
                            >
                                {m.project.name}
                            </button>
                        ))}
                    </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                    {projects.length > 0 && (
                        <select
                            disabled={busy || analyzing}
                            defaultValue=""
                            onChange={(e) => {
                                const v = e.target.value;
                                e.target.value = "";
                                if (v) assignExisting(v);
                            }}
                            style={{
                                fontFamily: "var(--font-sans)",
                                fontSize: 11,
                                padding: "0 6px",
                                height: 22,
                                border: "1px solid var(--border)",
                                borderRadius: 3,
                                background: "var(--bg)",
                                color: "var(--fg-muted)",
                            }}
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
                    <Button size="sm" disabled={busy || analyzing} onClick={createNew}>
                        Create matter
                    </Button>
                </div>
            </div>
        </div>
    );
}
