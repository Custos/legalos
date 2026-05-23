"use client";
// Per-party timeline. Rebuilt directly with legalos design system.

import * as React from "react";
import { use } from "react";
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
    getCounterpartyTimeline,
    type ContractFactsRow,
    type CounterpartyTimeline,
} from "@/app/lib/mikeApi";

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
    return iso;
}
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

export default function PartyDetailPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);
    const router = useRouter();
    const [data, setData] = React.useState<CounterpartyTimeline | null>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getCounterpartyTimeline(slug)
            .then((d) => {
                if (!cancelled) setData(d);
            })
            .catch(() => {
                if (!cancelled) setData(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [slug]);

    const rows = React.useMemo(() => {
        if (!data) return [];
        const factsByDoc = new Map<string, ContractFactsRow>();
        for (const f of data.facts) factsByDoc.set(f.document_id, f);
        const projectsById = new Map(data.projects.map((p) => [p.id, p]));
        return data.documents
            .map((doc) => ({
                doc,
                fact: factsByDoc.get(doc.id) ?? null,
                project: doc.project_id
                    ? projectsById.get(doc.project_id) ?? null
                    : null,
                sortKey:
                    factsByDoc.get(doc.id)?.effective_date ?? doc.created_at,
            }))
            .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    }, [data]);

    const totalActiveValue = React.useMemo(() => {
        if (!data) return null;
        let sum = 0;
        let currency: string | null = null;
        for (const row of rows) {
            if (row.doc.intake_status !== "execution") continue;
            const v = row.fact?.total_value_minor;
            if (v == null) continue;
            sum += v;
            if (!currency && row.fact?.currency) currency = row.fact.currency;
        }
        if (sum === 0) return null;
        return { sum, currency };
    }, [rows, data]);

    const docCount = data?.documents.length ?? 0;
    const projectCount = data?.projects.length ?? 0;

    return (
        <PageScroll>
            <SectionHeader
                title={data?.counterparty?.toUpperCase() ?? slug.toUpperCase()}
                subtitle={
                    loading
                        ? "loading…"
                        : `${docCount} ${docCount === 1 ? "document" : "documents"}` +
                          (projectCount > 0
                              ? ` · ${projectCount} ${projectCount === 1 ? "matter" : "matters"}`
                              : "")
                }
                right={
                    <Button
                        size="sm"
                        icon={<Icon.Chevron style={{ transform: "rotate(90deg)" }} />}
                        onClick={() => router.push("/parties")}
                    >
                        All parties
                    </Button>
                }
            />

            <div style={{ display: "flex", gap: 10 }}>
                <Stat label="DOCUMENTS" value={String(docCount)} />
                <Stat label="MATTERS" value={String(projectCount)} />
                <Stat
                    label="EXECUTED"
                    value={String(
                        rows.filter((r) => r.doc.intake_status === "execution").length,
                    )}
                    tone="clean"
                />
                <Stat
                    label="ACTIVE VALUE"
                    value={
                        totalActiveValue
                            ? formatMoney(totalActiveValue.sum, totalActiveValue.currency)
                            : "—"
                    }
                />
            </div>

            <Card title="LIFECYCLE · CHRONOLOGICAL">
                {loading ? (
                    <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                        Loading…
                    </div>
                ) : !data || rows.length === 0 ? (
                    <div
                        style={{
                            fontSize: 12,
                            color: "var(--fg-muted)",
                            textAlign: "center",
                            padding: "24px 0",
                        }}
                    >
                        No documents. Drop contracts in /intake to begin.
                    </div>
                ) : (
                    <div style={{ position: "relative" }}>
                        <div
                            style={{
                                position: "absolute",
                                left: 11,
                                top: 4,
                                bottom: 4,
                                width: 1,
                                background: "var(--hairline)",
                            }}
                        />
                        {rows.map((row, i) => {
                            const status = row.doc.intake_status ?? "unknown";
                            const tone =
                                status === "execution"
                                    ? "clean"
                                    : status === "draft"
                                      ? "med"
                                      : "neutral";
                            const dateLabel = row.fact?.effective_date
                                ? `Effective ${formatDateOnly(row.fact.effective_date)}`
                                : `Uploaded ${formatDateOnly(row.doc.created_at)}`;
                            return (
                                <div
                                    key={row.doc.id}
                                    style={{
                                        position: "relative",
                                        paddingLeft: 32,
                                        paddingBottom: i < rows.length - 1 ? 14 : 0,
                                    }}
                                >
                                    <span
                                        style={{
                                            position: "absolute",
                                            left: 6,
                                            top: 4,
                                            width: 12,
                                            height: 12,
                                            border: "2px solid var(--border-strong)",
                                            background: "var(--bg)",
                                            borderRadius: 99,
                                        }}
                                    />
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            flexWrap: "wrap",
                                        }}
                                    >
                                        <button
                                            onClick={() =>
                                                router.push(
                                                    row.doc.project_id
                                                        ? `/projects/${row.doc.project_id}`
                                                        : `/intake`,
                                                )
                                            }
                                            style={{
                                                fontFamily: "var(--font-sans)",
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: "var(--fg-strong)",
                                                background: "transparent",
                                                border: "none",
                                                padding: 0,
                                                cursor: "pointer",
                                                textAlign: "left",
                                            }}
                                        >
                                            {row.doc.filename}
                                        </button>
                                        <Tag tone={tone}>{status}</Tag>
                                        {row.doc.intake_lifecycle_hint && (
                                            <Tag tone="info">
                                                {row.doc.intake_lifecycle_hint}
                                            </Tag>
                                        )}
                                    </div>
                                    <div
                                        style={{
                                            marginTop: 3,
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: 8,
                                            alignItems: "center",
                                            fontFamily: "var(--font-mono)",
                                            fontSize: 11,
                                            color: "var(--fg-muted)",
                                        }}
                                    >
                                        <span>{dateLabel}</span>
                                        {row.fact?.term_months != null && (
                                            <>
                                                <span>·</span>
                                                <span>{row.fact.term_months} mo</span>
                                            </>
                                        )}
                                        {row.fact?.total_value_minor != null && (
                                            <>
                                                <span>·</span>
                                                <span>
                                                    {formatMoney(
                                                        row.fact.total_value_minor,
                                                        row.fact.currency,
                                                    )}
                                                </span>
                                            </>
                                        )}
                                        {row.project && (
                                            <>
                                                <span>·</span>
                                                <button
                                                    onClick={() =>
                                                        router.push(
                                                            `/projects/${row.project!.id}`,
                                                        )
                                                    }
                                                    style={{
                                                        background: "transparent",
                                                        border: "none",
                                                        padding: 0,
                                                        cursor: "pointer",
                                                        color: "var(--signal-blue)",
                                                        fontFamily: "var(--font-mono)",
                                                        fontSize: 11,
                                                    }}
                                                >
                                                    in {row.project.name}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                    {row.doc.intake_summary && (
                                        <div
                                            style={{
                                                marginTop: 5,
                                                fontSize: 12,
                                                color: "var(--fg)",
                                                lineHeight: 1.45,
                                            }}
                                        >
                                            {row.doc.intake_summary}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>
        </PageScroll>
    );
}
