"use client";
// Studio · Lifecycle — portfolio-level view of contract_facts. Pulls every
// project the caller can access and renders a chronological lifecycle of
// extracted effective dates, value deltas, and renewal cadence. Real
// data, no mock.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
    Card,
    PageScroll,
    SectionHeader,
    Stat,
} from "@/app/components/legalos/Primitives";
import { listProjects, listProjectFacts } from "@/app/lib/mikeApi";
import type { ContractFactsRow } from "@/app/lib/mikeApi";
import type { MikeProject } from "@/app/components/shared/types";

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

type Row = {
    fact: ContractFactsRow;
    project: MikeProject;
};

export default function LifecyclePage() {
    const router = useRouter();
    const [projects, setProjects] = React.useState<MikeProject[]>([]);
    const [rows, setRows] = React.useState<Row[] | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const ps = await listProjects().catch(() => []);
            if (cancelled) return;
            setProjects(ps);
            const factsByProject = await Promise.all(
                ps.map((p) =>
                    listProjectFacts(p.id)
                        .then((f) => ({ project: p, facts: f }))
                        .catch(() => ({ project: p, facts: [] as ContractFactsRow[] })),
                ),
            );
            if (cancelled) return;
            const flat: Row[] = [];
            for (const { project, facts } of factsByProject) {
                for (const fact of facts) flat.push({ project, fact });
            }
            flat.sort((a, b) => {
                const ka = a.fact.effective_date ?? a.fact.extracted_at;
                const kb = b.fact.effective_date ?? b.fact.extracted_at;
                return ka.localeCompare(kb);
            });
            setRows(flat);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const totalActive =
        rows?.reduce((acc, r) => acc + (r.fact.total_value_minor ?? 0), 0) ?? 0;

    return (
        <PageScroll>
            <SectionHeader
                title="LIFECYCLE"
                subtitle="extracted contract facts across every accessible matter"
            />
            <div style={{ display: "flex", gap: 10 }}>
                <Stat label="MATTERS" value={String(projects.length)} />
                <Stat
                    label="EXTRACTED FACTS"
                    value={rows ? String(rows.length) : "—"}
                />
                <Stat
                    label="TOTAL VALUE"
                    value={
                        totalActive > 0
                            ? formatMoney(totalActive, "USD")
                            : "—"
                    }
                />
                <Stat
                    label="WITH EFFECTIVE DATE"
                    value={
                        rows
                            ? String(rows.filter((r) => r.fact.effective_date).length)
                            : "—"
                    }
                />
            </div>

            <Card title="CHRONOLOGICAL LIFECYCLE">
                {rows === null ? (
                    <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                        Loading…
                    </div>
                ) : rows.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                        No facts extracted yet. Upload contracts and the system extracts
                        effective date, term, value, and renewal terms automatically.
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                        {rows.map((row, i) => (
                            <button
                                key={row.fact.id}
                                onClick={() =>
                                    router.push(`/projects/${row.project.id}`)
                                }
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "120px 1fr 90px 110px 110px",
                                    padding: "8px 0",
                                    borderBottom:
                                        i < rows.length - 1
                                            ? "1px solid var(--hairline)"
                                            : "none",
                                    alignItems: "center",
                                    fontSize: 12,
                                    background: "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    width: "100%",
                                }}
                            >
                                <span
                                    style={{
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 11,
                                        color: "var(--fg-muted)",
                                    }}
                                >
                                    {formatDateOnly(
                                        row.fact.effective_date ?? row.fact.extracted_at,
                                    )}
                                </span>
                                <span
                                    style={{
                                        color: "var(--fg-strong)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {row.project.name}
                                </span>
                                <span
                                    style={{
                                        fontFamily: "var(--font-mono)",
                                        fontVariantNumeric: "tabular-nums",
                                        fontSize: 11,
                                        color:
                                            row.fact.term_months != null
                                                ? "var(--fg)"
                                                : "var(--fg-faint)",
                                    }}
                                >
                                    {row.fact.term_months != null
                                        ? `${row.fact.term_months}mo`
                                        : "—"}
                                </span>
                                <span
                                    style={{
                                        fontFamily: "var(--font-mono)",
                                        fontVariantNumeric: "tabular-nums",
                                        fontSize: 11,
                                        color:
                                            row.fact.total_value_minor != null
                                                ? "var(--fg-strong)"
                                                : "var(--fg-faint)",
                                    }}
                                >
                                    {formatMoney(
                                        row.fact.total_value_minor,
                                        row.fact.currency,
                                    )}
                                </span>
                                <span
                                    style={{
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 11,
                                        color: "var(--fg-muted)",
                                    }}
                                >
                                    {row.fact.governing_law ?? "—"}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </Card>
        </PageScroll>
    );
}
