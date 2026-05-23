"use client";
// Project Workspace — IDE-style three-pane layout. Real backend data only.
// Left pane: project + document tree
// Center pane: active document detail (header, lifecycle facts, summary)
// Right pane: version history + assistant entry point
//
// Ported from the Legalos design bundle's ui_kits/workspace.

import * as React from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import {
    Button,
    Card,
    Icon,
    Tag,
    type TagTone,
} from "@/app/components/legalos/Primitives";
import {
    getProject,
    listDocumentVersions,
    listProjectFacts,
    type ContractFactsRow,
    type MikeDocumentVersion,
} from "@/app/lib/mikeApi";
import type {
    MikeDocument,
    MikeProject,
} from "@/app/components/shared/types";

function formatMoney(minor: number | null, currency: string | null): string {
    if (minor == null) return "—";
    const major = minor / 100;
    if (!currency) return major.toLocaleString();
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            maximumFractionDigits: 0,
        }).format(major);
    } catch {
        return `${currency} ${major.toLocaleString()}`;
    }
}
function formatDateOnly(iso: string | null): string {
    if (!iso) return "—";
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
        const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return dt.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }
    try {
        return new Date(iso).toLocaleDateString();
    } catch {
        return iso;
    }
}
function relTime(iso: string | null): string {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return formatDateOnly(iso);
}

interface Props {
    params: Promise<{ id: string }>;
}

export default function WorkspacePage({ params }: Props) {
    const { id: projectId } = use(params);
    const router = useRouter();
    const [project, setProject] = React.useState<MikeProject | null>(null);
    const [facts, setFacts] = React.useState<ContractFactsRow[]>([]);
    const [activeDocId, setActiveDocId] = React.useState<string | null>(null);
    const [versions, setVersions] = React.useState<MikeDocumentVersion[]>([]);
    const [currentVersionId, setCurrentVersionId] = React.useState<string | null>(
        null,
    );
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        Promise.all([
            getProject(projectId).catch(() => null),
            listProjectFacts(projectId).catch(() => [] as ContractFactsRow[]),
        ]).then(([p, f]) => {
            if (cancelled) return;
            if (!p) {
                setError("Matter not found");
                return;
            }
            setProject(p);
            setFacts(f);
            const docs = p.documents ?? [];
            setActiveDocId((prev) => prev ?? docs[0]?.id ?? null);
        });
        return () => {
            cancelled = true;
        };
    }, [projectId]);

    React.useEffect(() => {
        if (!activeDocId) {
            setVersions([]);
            setCurrentVersionId(null);
            return;
        }
        let cancelled = false;
        listDocumentVersions(activeDocId)
            .then((r) => {
                if (cancelled) return;
                setVersions(r.versions);
                setCurrentVersionId(r.current_version_id);
            })
            .catch(() => {
                if (cancelled) return;
                setVersions([]);
                setCurrentVersionId(null);
            });
        return () => {
            cancelled = true;
        };
    }, [activeDocId]);

    const documents = project?.documents ?? [];
    const activeDoc = documents.find((d) => d.id === activeDocId) ?? null;
    const docFacts = facts.filter((f) => f.document_id === activeDocId);
    const latestFact = docFacts[docFacts.length - 1] ?? null;

    if (error) {
        return (
            <div
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--fg-muted)",
                    fontSize: 13,
                }}
            >
                {error}
            </div>
        );
    }
    if (!project) {
        return (
            <div
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--fg-muted)",
                    fontSize: 13,
                }}
            >
                Loading matter…
            </div>
        );
    }

    return (
        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
            <FilePane
                project={project}
                documents={documents}
                activeDocId={activeDocId}
                onPick={setActiveDocId}
            />

            <div
                style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0,
                    background: "var(--bg-subtle)",
                    overflow: "hidden",
                }}
            >
                <TabStrip activeDoc={activeDoc} />
                <div
                    className="legalos-scroll"
                    style={{
                        flex: 1,
                        overflow: "auto",
                        padding: "16px 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 14,
                    }}
                >
                    {!activeDoc ? (
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flex: 1,
                                fontSize: 13,
                                color: "var(--fg-muted)",
                            }}
                        >
                            No documents in this matter yet.
                        </div>
                    ) : (
                        <DocumentPane
                            doc={activeDoc}
                            fact={latestFact}
                            allFacts={docFacts}
                        />
                    )}
                </div>
            </div>

            <RightRail
                doc={activeDoc}
                versions={versions}
                currentVersionId={currentVersionId}
                onOpenAssistant={() => router.push(`/assistant`)}
            />
        </div>
    );
}

// ─────────── FilePane ───────────
function FilePane({
    project,
    documents,
    activeDocId,
    onPick,
}: {
    project: MikeProject;
    documents: MikeDocument[];
    activeDocId: string | null;
    onPick: (id: string) => void;
}) {
    const router = useRouter();
    return (
        <div
            style={{
                width: 240,
                flexShrink: 0,
                borderRight: "1px solid var(--border)",
                background: "var(--bg)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
            }}
        >
            <div
                style={{
                    height: 28,
                    padding: "0 10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "1px solid var(--hairline)",
                }}
            >
                <span
                    style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        color: "var(--fg-muted)",
                        textTransform: "uppercase",
                    }}
                >
                    Matter
                </span>
                <button
                    onClick={() => router.push("/matters")}
                    title="Back to all matters"
                    style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--fg-muted)",
                        cursor: "pointer",
                    }}
                >
                    <Icon.Chevron style={{ transform: "rotate(90deg)" }} />
                </button>
            </div>

            <div
                style={{
                    padding: "8px 10px",
                    borderBottom: "1px solid var(--hairline)",
                }}
            >
                <div
                    style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--fg-strong)",
                    }}
                >
                    {project.name}
                </div>
                <div
                    style={{
                        marginTop: 2,
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--fg-muted)",
                    }}
                >
                    {project.template ?? "untemplated"} · {documents.length}{" "}
                    {documents.length === 1 ? "doc" : "docs"}
                </div>
            </div>

            <div
                className="legalos-scroll"
                style={{ flex: 1, overflow: "auto", padding: "4px 0" }}
            >
                {documents.length === 0 ? (
                    <div
                        style={{
                            padding: "12px 12px",
                            fontSize: 11,
                            color: "var(--fg-muted)",
                        }}
                    >
                        No documents.
                    </div>
                ) : (
                    documents.map((d) => {
                        const active = d.id === activeDocId;
                        return (
                            <div
                                key={d.id}
                                onClick={() => onPick(d.id)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    height: 24,
                                    padding: "0 10px",
                                    cursor: "pointer",
                                    background: active
                                        ? "var(--bg-subtle)"
                                        : "transparent",
                                    borderLeft: active
                                        ? "2px solid var(--ink-90)"
                                        : "2px solid transparent",
                                    color: active
                                        ? "var(--fg-strong)"
                                        : "var(--fg)",
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 11,
                                }}
                            >
                                <Icon.File />
                                <span
                                    style={{
                                        flex: 1,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {d.filename}
                                </span>
                                {d.status !== "ready" && (
                                    <span
                                        style={{
                                            fontSize: 9,
                                            color: "var(--signal-amber)",
                                        }}
                                    >
                                        {d.status}
                                    </span>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

// ─────────── TabStrip ───────────
function TabStrip({ activeDoc }: { activeDoc: MikeDocument | null }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "flex-end",
                height: "var(--tab-h)",
                background: "var(--bg-subtle)",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
            }}
        >
            {activeDoc ? (
                <div
                    style={{
                        height: "var(--tab-h)",
                        padding: "0 12px",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: "var(--bg)",
                        borderRight: "1px solid var(--border)",
                        borderLeft: "1px solid var(--border)",
                        marginBottom: -1,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--fg-strong)",
                    }}
                >
                    <Icon.File />
                    <span
                        style={{
                            maxWidth: 320,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {activeDoc.filename}
                    </span>
                </div>
            ) : (
                <div
                    style={{
                        padding: "0 14px",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--fg-muted)",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                    }}
                >
                    No document selected
                </div>
            )}
        </div>
    );
}

// ─────────── DocumentPane ───────────
function DocumentPane({
    doc,
    fact,
    allFacts,
}: {
    doc: MikeDocument;
    fact: ContractFactsRow | null;
    allFacts: ContractFactsRow[];
}) {
    const intake = doc as MikeDocument & {
        intake_role?: string | null;
        intake_status?: string | null;
        intake_summary?: string | null;
        intake_lifecycle_hint?: string | null;
        intake_counterparty?: string | null;
    };
    const status = (intake.intake_status ?? "unknown") as
        | "execution"
        | "draft"
        | "unknown";
    const statusTone: TagTone =
        status === "execution" ? "clean" : status === "draft" ? "med" : "neutral";

    return (
        <>
            <Card padding={16}>
                <div
                    style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--fg-muted)",
                    }}
                >
                    {doc.id.slice(0, 8)} · {doc.file_type ?? "—"} ·{" "}
                    {doc.page_count ?? "—"} pages
                </div>
                <h2
                    style={{
                        margin: "4px 0 0",
                        fontSize: 18,
                        fontWeight: 600,
                        color: "var(--fg-strong)",
                    }}
                >
                    {doc.filename}
                </h2>
                <div
                    style={{
                        marginTop: 6,
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                        alignItems: "center",
                    }}
                >
                    <Tag tone={statusTone}>{status}</Tag>
                    {intake.intake_lifecycle_hint && (
                        <Tag tone="info">{intake.intake_lifecycle_hint}</Tag>
                    )}
                    {intake.intake_counterparty && (
                        <span
                            style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 11,
                                color: "var(--fg)",
                            }}
                        >
                            · {intake.intake_counterparty}
                        </span>
                    )}
                </div>
                {intake.intake_summary && (
                    <p
                        style={{
                            marginTop: 12,
                            marginBottom: 0,
                            fontFamily: "var(--font-serif)",
                            fontSize: 14,
                            lineHeight: 1.55,
                            color: "var(--fg)",
                        }}
                    >
                        {intake.intake_summary}
                    </p>
                )}
            </Card>

            <Card title="LIFECYCLE · KEY TERMS">
                {!fact ? (
                    <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                        No facts extracted yet.
                    </div>
                ) : (
                    <FactsStrip fact={fact} priorFacts={allFacts.slice(0, -1)} />
                )}
            </Card>

            {allFacts.length > 1 && (
                <Card title="EXTRACTION HISTORY">
                    <div style={{ display: "flex", flexDirection: "column" }}>
                        {allFacts.map((f, i) => (
                            <div
                                key={f.id}
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "120px 1fr 120px 110px",
                                    padding: "6px 0",
                                    borderBottom:
                                        i < allFacts.length - 1
                                            ? "1px solid var(--hairline)"
                                            : "none",
                                    alignItems: "center",
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 11,
                                    color: "var(--fg)",
                                }}
                            >
                                <span style={{ color: "var(--fg-muted)" }}>
                                    {formatDateOnly(f.extracted_at)}
                                </span>
                                <span>
                                    {formatDateOnly(f.effective_date)} ·{" "}
                                    {f.term_months != null
                                        ? `${f.term_months}mo`
                                        : "—"}
                                </span>
                                <span
                                    style={{
                                        fontVariantNumeric: "tabular-nums",
                                    }}
                                >
                                    {formatMoney(f.total_value_minor, f.currency)}
                                </span>
                                <span style={{ color: "var(--fg-muted)" }}>
                                    {f.governing_law ?? "—"}
                                </span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </>
    );
}

function FactsStrip({
    fact,
    priorFacts,
}: {
    fact: ContractFactsRow;
    priorFacts: ContractFactsRow[];
}) {
    const prior = priorFacts[priorFacts.length - 1] ?? null;
    const valueDelta =
        fact.total_value_minor != null &&
        prior?.total_value_minor != null &&
        prior.total_value_minor > 0
            ? ((fact.total_value_minor - prior.total_value_minor) /
                  prior.total_value_minor) *
              100
            : null;

    type Cell = {
        label: string;
        value: string;
        extra?: React.ReactNode;
    };
    const cells: Cell[] = [
        { label: "EFFECTIVE", value: formatDateOnly(fact.effective_date) },
        { label: "TERM", value: fact.term_months != null ? `${fact.term_months} mo` : "—" },
        {
            label: "TOTAL VALUE",
            value: formatMoney(fact.total_value_minor, fact.currency),
            extra:
                valueDelta != null && Math.abs(valueDelta) >= 0.5 ? (
                    <span
                        style={{
                            marginLeft: 6,
                            fontFamily: "var(--font-mono)",
                            fontSize: 10,
                            color:
                                valueDelta > 0
                                    ? "var(--delta-up)"
                                    : "var(--delta-down)",
                            fontWeight: 600,
                        }}
                    >
                        {valueDelta > 0 ? "+" : "−"}
                        {Math.abs(valueDelta).toFixed(0)}%
                    </span>
                ) : null,
        },
        {
            label: "AUTO-RENEW",
            value:
                fact.auto_renew == null ? "—" : fact.auto_renew ? "Yes" : "No",
        },
        {
            label: "NOTICE",
            value: fact.notice_days != null ? `${fact.notice_days}d` : "—",
        },
        { label: "GOVERNING LAW", value: fact.governing_law ?? "—" },
    ];

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                gap: 1,
                background: "var(--hairline)",
                border: "1px solid var(--hairline)",
            }}
        >
            {cells.map((c) => (
                <div
                    key={c.label}
                    style={{
                        background: "var(--bg)",
                        padding: "10px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                    }}
                >
                    <div
                        style={{
                            fontSize: 9,
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            color: "var(--fg-muted)",
                            textTransform: "uppercase",
                        }}
                    >
                        {c.label}
                    </div>
                    <div
                        style={{
                            fontFamily: "var(--font-mono)",
                            fontVariantNumeric: "tabular-nums",
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--fg-strong)",
                        }}
                    >
                        {c.value}
                        {c.extra}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─────────── Right rail ───────────
function RightRail({
    doc,
    versions,
    currentVersionId,
    onOpenAssistant,
}: {
    doc: MikeDocument | null;
    versions: MikeDocumentVersion[];
    currentVersionId: string | null;
    onOpenAssistant: () => void;
}) {
    return (
        <div
            style={{
                width: 320,
                flexShrink: 0,
                borderLeft: "1px solid var(--border)",
                background: "var(--bg)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
            }}
        >
            <div
                style={{
                    height: 28,
                    padding: "0 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "1px solid var(--hairline)",
                }}
            >
                <span
                    style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        color: "var(--fg-muted)",
                        textTransform: "uppercase",
                    }}
                >
                    Versions
                </span>
                {doc && (
                    <span
                        style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 10,
                            color: "var(--fg-faint)",
                        }}
                    >
                        {versions.length}
                    </span>
                )}
            </div>
            <div
                className="legalos-scroll"
                style={{ flex: 1, overflow: "auto", padding: "4px 0" }}
            >
                {!doc ? (
                    <div
                        style={{
                            padding: "12px",
                            fontSize: 11,
                            color: "var(--fg-muted)",
                        }}
                    >
                        Select a document.
                    </div>
                ) : versions.length === 0 ? (
                    <div
                        style={{
                            padding: "12px",
                            fontSize: 11,
                            color: "var(--fg-muted)",
                        }}
                    >
                        No version history.
                    </div>
                ) : (
                    versions.map((v) => {
                        const current = v.id === currentVersionId;
                        return (
                            <div
                                key={v.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "6px 12px",
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 11,
                                    color: current
                                        ? "var(--fg-strong)"
                                        : "var(--fg-muted)",
                                }}
                            >
                                <span
                                    style={{
                                        width: 14,
                                        textAlign: "center",
                                        color: current
                                            ? "var(--signal-violet)"
                                            : "var(--fg-faint)",
                                    }}
                                >
                                    {current ? "●" : "○"}
                                </span>
                                <span style={{ width: 24 }}>
                                    v{v.version_number}
                                </span>
                                <span
                                    style={{
                                        flex: 1,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {v.display_name ?? "—"}
                                </span>
                                <span style={{ color: "var(--fg-faint)" }}>
                                    {relTime(v.created_at)}
                                </span>
                            </div>
                        );
                    })
                )}
            </div>

            <div
                style={{
                    borderTop: "1px solid var(--border)",
                    background: "var(--bg-subtle)",
                    padding: 10,
                }}
            >
                <Button
                    kind="primary"
                    size="sm"
                    icon={<Icon.Spark />}
                    onClick={onOpenAssistant}
                    style={{ width: "100%", justifyContent: "center" }}
                >
                    Open assistant
                </Button>
            </div>
        </div>
    );
}
