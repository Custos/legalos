"use client";
// Tabular reviews list — Studio · The Grid landing. Rebuilt with the
// legalos design system; kept create/rename/delete via the existing
// AddNewTRModal + endpoint helpers.

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
import { AddNewTRModal } from "@/app/components/tabular/AddNewTRModal";
import { OwnerOnlyModal } from "@/app/components/shared/OwnerOnlyModal";
import {
    createTabularReview,
    deleteTabularReview,
    listProjects,
    listTabularReviews,
} from "@/app/lib/mikeApi";
import type { MikeProject, TabularReview } from "@/app/components/shared/types";
import { useAuth } from "@/contexts/AuthContext";

type Tab = "all" | "in-project" | "standalone";
const TABS: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "in-project", label: "In matter" },
    { id: "standalone", label: "Standalone" },
];

const COLS = "1fr 90px 100px 180px 110px 60px";

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

export default function TabularReviewsPage() {
    const [reviews, setReviews] = React.useState<TabularReview[]>([]);
    const [projects, setProjects] = React.useState<MikeProject[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [creating, setCreating] = React.useState(false);
    const [newOpen, setNewOpen] = React.useState(false);
    const [tab, setTab] = React.useState<Tab>("all");
    const [search, setSearch] = React.useState("");
    const [ownerBlock, setOwnerBlock] = React.useState<string | null>(null);
    const router = useRouter();
    const { user } = useAuth();

    React.useEffect(() => {
        Promise.all([
            listTabularReviews().catch(() => []),
            listProjects().catch(() => []),
        ])
            .then(([r, p]) => {
                setReviews(r);
                setProjects(p);
            })
            .finally(() => setLoading(false));
    }, []);

    const q = search.toLowerCase();
    const filtered = reviews
        .filter((r) => {
            if (tab === "in-project") return !!r.project_id;
            if (tab === "standalone") return !r.project_id;
            return true;
        })
        .filter((r) => !q || (r.title ?? "").toLowerCase().includes(q));

    async function handleNew(
        title: string,
        projectId?: string,
        documentIds?: string[],
        columnsConfig?:
            | import("@/app/components/shared/types").ColumnConfig[]
            | null,
    ) {
        setCreating(true);
        try {
            const review = await createTabularReview({
                title,
                document_ids: documentIds ?? [],
                columns_config: columnsConfig ?? [],
                ...(projectId && { project_id: projectId }),
            });
            router.push(
                projectId
                    ? `/projects/${projectId}/tabular-reviews/${review.id}`
                    : `/tabular-reviews/${review.id}`,
            );
        } finally {
            setCreating(false);
        }
    }

    async function handleDelete(review: TabularReview) {
        if (user?.id && review.user_id !== user.id) {
            setOwnerBlock("delete this tabular review");
            return;
        }
        await deleteTabularReview(review.id).catch(() => {});
        setReviews((prev) => prev.filter((r) => r.id !== review.id));
    }

    return (
        <PageScroll>
            <SectionHeader
                title="STUDIO · THE GRID"
                subtitle="multi-document tabular extraction"
                right={
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search reviews…"
                            style={{
                                height: 24,
                                padding: "0 8px",
                                fontFamily: "var(--font-sans)",
                                fontSize: 12,
                                border: "1px solid var(--border)",
                                borderRadius: 3,
                                background: "var(--bg)",
                                color: "var(--fg)",
                                outline: "none",
                                width: 200,
                            }}
                        />
                        <Button
                            kind="primary"
                            size="sm"
                            icon={<Icon.Plus />}
                            disabled={creating}
                            onClick={() => setNewOpen(true)}
                        >
                            New review
                        </Button>
                    </div>
                }
            />

            <div style={{ display: "flex", gap: 10 }}>
                <Stat label="REVIEWS" value={String(reviews.length)} />
                <Stat
                    label="IN MATTER"
                    value={String(reviews.filter((r) => r.project_id).length)}
                />
                <Stat
                    label="STANDALONE"
                    value={String(reviews.filter((r) => !r.project_id).length)}
                />
                <Stat
                    label="MATTERS WITH REVIEWS"
                    value={String(
                        new Set(
                            reviews
                                .map((r) => r.project_id)
                                .filter((x): x is string => !!x),
                        ).size,
                    )}
                />
            </div>

            <div style={{ display: "flex", gap: 6 }}>
                {TABS.map((t) => {
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
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
                            {t.label}
                        </button>
                    );
                })}
            </div>

            <Card padding={0}>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: COLS,
                        height: 24,
                        background: "var(--bg-subtle)",
                        borderBottom: "1px solid var(--border)",
                    }}
                >
                    {["TITLE", "COLUMNS", "DOCUMENTS", "MATTER", "CREATED", ""].map(
                        (h, i) => (
                            <div
                                key={i}
                                style={{
                                    padding: "0 12px",
                                    display: "flex",
                                    alignItems: "center",
                                    borderLeft: i ? "1px solid var(--hairline)" : "none",
                                    fontSize: 10,
                                    fontWeight: 600,
                                    letterSpacing: "0.08em",
                                    color: "var(--fg-muted)",
                                    textTransform: "uppercase",
                                }}
                            >
                                {h}
                            </div>
                        ),
                    )}
                </div>
                {loading ? (
                    <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--fg-muted)" }}>
                        Loading…
                    </div>
                ) : filtered.length === 0 ? (
                    <div
                        style={{
                            padding: "32px 12px",
                            textAlign: "center",
                            fontSize: 12,
                            color: "var(--fg-muted)",
                        }}
                    >
                        No reviews yet. Create one to extract data into tables.
                    </div>
                ) : (
                    filtered.map((r, i) => {
                        const project = projects.find((p) => p.id === r.project_id);
                        return (
                            <div
                                key={r.id}
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: COLS,
                                    height: 30,
                                    borderBottom:
                                        i < filtered.length - 1
                                            ? "1px solid var(--hairline)"
                                            : "none",
                                    cursor: "pointer",
                                }}
                                onClick={() =>
                                    router.push(
                                        r.project_id
                                            ? `/projects/${r.project_id}/tabular-reviews/${r.id}`
                                            : `/tabular-reviews/${r.id}`,
                                    )
                                }
                            >
                                <div
                                    style={{
                                        ...cell("var(--fg-strong)"),
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {r.title ?? "Untitled Review"}
                                </div>
                                <div style={cell("var(--fg)", "mono")}>
                                    {r.columns_config?.length ?? 0}
                                </div>
                                <div style={cell("var(--fg)", "mono")}>
                                    {r.document_count ?? 0}
                                </div>
                                <div style={cell("var(--fg-muted)")}>
                                    {project?.name ?? "—"}
                                </div>
                                <div style={cell("var(--fg-muted)", "mono")}>
                                    {r.created_at ? formatDate(r.created_at) : "—"}
                                </div>
                                <div
                                    style={cell()}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(r);
                                    }}
                                >
                                    <span
                                        style={{
                                            fontFamily: "var(--font-mono)",
                                            fontSize: 11,
                                            color: "var(--signal-red)",
                                            cursor: "pointer",
                                        }}
                                    >
                                        ×
                                    </span>
                                </div>
                            </div>
                        );
                    })
                )}
            </Card>

            <AddNewTRModal
                open={newOpen}
                onClose={() => setNewOpen(false)}
                onAdd={handleNew}
                projects={projects}
            />

            <OwnerOnlyModal
                open={!!ownerBlock}
                action={ownerBlock ?? undefined}
                onClose={() => setOwnerBlock(null)}
            />
        </PageScroll>
    );
}

function cell(color = "var(--fg)", font?: "mono"): React.CSSProperties {
    return {
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        borderLeft: "1px solid var(--hairline)",
        fontSize: font === "mono" ? 11 : 12,
        color,
        ...(font === "mono"
            ? {
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums" as const,
              }
            : {}),
    };
}
