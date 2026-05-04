"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, FileText } from "lucide-react";
import {
    getCounterpartyTimeline,
    type CounterpartyTimeline,
} from "@/app/lib/mikeApi";

const STATUS_STYLE: Record<string, string> = {
    execution: "bg-emerald-50 text-emerald-700 border-emerald-200",
    draft: "bg-amber-50 text-amber-800 border-amber-200",
    unknown: "bg-gray-50 text-gray-500 border-gray-200",
};

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

function formatDate(iso: string | null): string {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    } catch {
        return iso;
    }
}

export function CounterpartyTimelineView({ name }: { name: string }) {
    const [data, setData] = useState<CounterpartyTimeline | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getCounterpartyTimeline(name)
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
    }, [name]);

    // Build a per-project timeline grouping the docs and facts. Standalone
    // documents (project_id is null) are bucketed under a synthetic
    // "Unassigned" entry at the top so they're visible even when no
    // projects exist for this counterparty yet.
    const timeline = useMemo(() => {
        if (!data) return [];
        const docsByProject = new Map<string, typeof data.documents>();
        const standaloneDocs: typeof data.documents = [];
        for (const d of data.documents) {
            if (!d.project_id) {
                standaloneDocs.push(d);
                continue;
            }
            const list = docsByProject.get(d.project_id) ?? [];
            list.push(d);
            docsByProject.set(d.project_id, list);
        }
        const factsByProject = new Map<string, typeof data.facts>();
        for (const f of data.facts) {
            if (!f.project_id) continue;
            const list = factsByProject.get(f.project_id) ?? [];
            list.push(f);
            factsByProject.set(f.project_id, list);
        }
        type Row = {
            project: typeof data.projects[number] | {
                id: string;
                name: string;
                counterparty: string | null;
                parent_counterparty: string | null;
                role: "buyer" | "seller" | "mutual" | null;
                template: string | null;
                created_at: string;
                updated_at: string;
            };
            docs: typeof data.documents;
            facts: typeof data.facts;
            latestFact: typeof data.facts[number] | undefined;
            sortKey: string;
            isStandalone: boolean;
        };
        const projectRows: Row[] = [...data.projects]
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((p) => {
                const docs = docsByProject.get(p.id) ?? [];
                const facts = factsByProject.get(p.id) ?? [];
                const latestFact = facts[facts.length - 1];
                const earliestDoc = docs[0];
                const sortKey =
                    latestFact?.effective_date ||
                    earliestDoc?.created_at ||
                    p.created_at;
                return {
                    project: p,
                    docs,
                    facts,
                    latestFact,
                    sortKey,
                    isStandalone: false,
                };
            });
        const allRows: Row[] = [...projectRows];
        if (standaloneDocs.length > 0) {
            standaloneDocs.sort((a, b) =>
                a.created_at.localeCompare(b.created_at),
            );
            allRows.push({
                project: {
                    id: "__standalone__",
                    name: `${standaloneDocs.length} unassigned ${
                        standaloneDocs.length === 1 ? "document" : "documents"
                    }`,
                    counterparty: data.counterparty,
                    parent_counterparty: null,
                    role: null,
                    template: null,
                    created_at: standaloneDocs[0].created_at,
                    updated_at:
                        standaloneDocs[standaloneDocs.length - 1].created_at,
                },
                docs: standaloneDocs,
                facts: [] as typeof data.facts,
                latestFact: undefined as typeof data.facts[number] | undefined,
                sortKey: standaloneDocs[0].created_at,
                isStandalone: true,
            });
        }
        return allRows.sort((a, b) =>
            a.sortKey.localeCompare(b.sortKey),
        );
    }, [data]);

    // Total contract value across the latest fact for each project
    // (treats each project as one contract for aggregate purposes).
    const totalValue = useMemo(() => {
        if (!data) return null;
        const sum = timeline.reduce((acc, row) => {
            const v = row.latestFact?.total_value_minor;
            return v != null ? acc + v : acc;
        }, 0);
        const currency =
            timeline.find((r) => r.latestFact?.currency)?.latestFact
                ?.currency ?? null;
        if (sum === 0) return null;
        return { sum, currency };
    }, [timeline, data]);

    return (
        <div className="flex-1 overflow-y-auto bg-white">
            <div className="px-8 py-4 border-b border-gray-100">
                <button
                    onClick={() => router.push("/customers")}
                    className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1 mb-2"
                >
                    <ArrowLeft className="h-3 w-3" />
                    Customers
                </button>
                <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-gray-500" />
                    <h1 className="text-2xl font-medium font-serif text-gray-900">
                        {name}
                    </h1>
                </div>
                {data && (
                    <div className="mt-2 text-xs text-gray-500 flex items-center gap-3">
                        <span>
                            {data.projects.length}{" "}
                            {data.projects.length === 1
                                ? "project"
                                : "projects"}
                        </span>
                        <span>·</span>
                        <span>{data.documents.length} documents</span>
                        {totalValue && (
                            <>
                                <span>·</span>
                                <span>
                                    Total active value:{" "}
                                    {formatMoney(
                                        totalValue.sum,
                                        totalValue.currency,
                                    )}
                                </span>
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className="px-8 py-6 max-w-5xl">
                {loading ? (
                    <div className="text-sm text-gray-400">Loading…</div>
                ) : !data || timeline.length === 0 ? (
                    <div className="text-sm text-gray-400 text-center py-12">
                        Nothing here yet.
                    </div>
                ) : (
                    <div className="relative">
                        {/* Vertical timeline rule */}
                        <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-200" />
                        {timeline.map((row, i) => (
                            <div
                                key={row.project.id}
                                className="relative pl-10 pb-8 last:pb-0"
                            >
                                <div className={`absolute left-0.5 top-1 h-5 w-5 rounded-full border-2 ${row.isStandalone ? "border-amber-300" : "border-gray-300"} bg-white flex items-center justify-center`}>
                                    <span className="text-[10px] font-medium text-gray-500">
                                        {i + 1}
                                    </span>
                                </div>
                                {row.isStandalone ? (
                                    <button
                                        onClick={() => router.push("/intake")}
                                        className="text-sm font-medium text-amber-700 hover:text-amber-900 transition-colors text-left"
                                    >
                                        {row.project.name} — go to /intake
                                    </button>
                                ) : (
                                    <button
                                        onClick={() =>
                                            router.push(
                                                `/projects/${row.project.id}`,
                                            )
                                        }
                                        className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors text-left"
                                    >
                                        {row.project.name}
                                    </button>
                                )}
                                <div className="text-[11px] text-gray-500 mt-0.5">
                                    {row.project.template && (
                                        <span className="capitalize">
                                            {row.project.template}
                                        </span>
                                    )}
                                    {row.latestFact?.effective_date && (
                                        <>
                                            {" · Effective "}
                                            {formatDate(
                                                row.latestFact.effective_date,
                                            )}
                                        </>
                                    )}
                                    {row.latestFact?.term_months != null && (
                                        <>
                                            {" · "}
                                            {row.latestFact.term_months}{" "}
                                            months
                                        </>
                                    )}
                                    {row.latestFact?.total_value_minor !=
                                        null && (
                                        <>
                                            {" · "}
                                            {formatMoney(
                                                row.latestFact
                                                    .total_value_minor,
                                                row.latestFact.currency,
                                            )}
                                        </>
                                    )}
                                </div>

                                {row.docs.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                        {row.docs.map((d) => {
                                            const status =
                                                d.intake_status ?? "unknown";
                                            return (
                                                <div
                                                    key={d.id}
                                                    className="flex items-center gap-2 text-[11px] text-gray-600"
                                                >
                                                    <FileText className="h-3 w-3 text-gray-400 shrink-0" />
                                                    <span className="truncate">
                                                        {d.filename}
                                                    </span>
                                                    <span
                                                        className={`rounded-full border px-1.5 py-0 text-[10px] ${STATUS_STYLE[status]}`}
                                                    >
                                                        {status}
                                                    </span>
                                                    {d.intake_lifecycle_hint && (
                                                        <span className="rounded-full bg-blue-50 border border-blue-100 text-blue-700 px-1.5 py-0 text-[10px]">
                                                            {
                                                                d.intake_lifecycle_hint
                                                            }
                                                        </span>
                                                    )}
                                                    <span className="text-gray-400 ml-auto">
                                                        {formatDate(
                                                            d.created_at,
                                                        )}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
