"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, FileText } from "lucide-react";
import {
    getCounterpartyTimeline,
    type CounterpartyTimeline,
    type ContractFactsRow,
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

export function CounterpartyTimelineView({ slug }: { slug: string }) {
    const [data, setData] = useState<CounterpartyTimeline | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
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

    // Per-document timeline rows. Each document gets its own row keyed on
    // the latest contract_facts effective_date when present, otherwise the
    // upload created_at.
    const rows = useMemo(() => {
        if (!data) return [];
        const factsByDoc = new Map<string, ContractFactsRow>();
        for (const f of data.facts) {
            // Latest fact wins (already ordered ascending by extracted_at).
            factsByDoc.set(f.document_id, f);
        }
        const projectsById = new Map(data.projects.map((p) => [p.id, p]));
        return data.documents
            .map((doc) => {
                const fact = factsByDoc.get(doc.id) ?? null;
                const sortKey =
                    fact?.effective_date ?? doc.created_at;
                return {
                    doc,
                    fact,
                    project: doc.project_id
                        ? projectsById.get(doc.project_id) ?? null
                        : null,
                    sortKey,
                };
            })
            .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    }, [data]);

    const totalActiveValue = useMemo(() => {
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
        <div className="flex-1 overflow-y-auto bg-white">
            <div className="px-8 py-4 border-b border-gray-100">
                <button
                    onClick={() => router.push("/parties")}
                    className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1 mb-2"
                >
                    <ArrowLeft className="h-3 w-3" />
                    Parties
                </button>
                <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-gray-500" />
                    <h1 className="text-2xl font-medium font-serif text-gray-900">
                        {data?.counterparty ?? slug}
                    </h1>
                </div>
                {data && (
                    <div className="mt-2 text-xs text-gray-500 flex items-center gap-3">
                        <span>
                            {docCount}{" "}
                            {docCount === 1 ? "document" : "documents"}
                        </span>
                        {projectCount > 0 && (
                            <>
                                <span>·</span>
                                <span>
                                    Across {projectCount}{" "}
                                    {projectCount === 1
                                        ? "project"
                                        : "projects"}
                                </span>
                            </>
                        )}
                        {totalActiveValue && (
                            <>
                                <span>·</span>
                                <span>
                                    Total active value:{" "}
                                    {formatMoney(
                                        totalActiveValue.sum,
                                        totalActiveValue.currency,
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
                ) : !data || rows.length === 0 ? (
                    <div className="text-sm text-gray-400 text-center py-12">
                        Nothing here yet.
                    </div>
                ) : (
                    <div className="relative">
                        <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-200" />
                        {rows.map((row, i) => {
                            const status =
                                row.doc.intake_status ?? "unknown";
                            const dateLabel = row.fact?.effective_date
                                ? `Effective ${formatDate(row.fact.effective_date)}`
                                : `Uploaded ${formatDate(row.doc.created_at)}`;
                            return (
                                <div
                                    key={row.doc.id}
                                    className="relative pl-10 pb-8 last:pb-0"
                                >
                                    <div className="absolute left-0.5 top-1 h-5 w-5 rounded-full border-2 border-gray-300 bg-white flex items-center justify-center">
                                        <span className="text-[10px] font-medium text-gray-500">
                                            {i + 1}
                                        </span>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <FileText className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />
                                        <button
                                            onClick={() =>
                                                router.push(
                                                    row.doc.project_id
                                                        ? `/projects/${row.doc.project_id}`
                                                        : `/intake`,
                                                )
                                            }
                                            className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors text-left truncate"
                                        >
                                            {row.doc.filename}
                                        </button>
                                        <span
                                            className={`rounded-full border px-1.5 py-0 text-[10px] ${STATUS_STYLE[status]}`}
                                        >
                                            {status}
                                        </span>
                                        {row.doc.intake_lifecycle_hint && (
                                            <span className="rounded-full bg-blue-50 border border-blue-100 text-blue-700 px-1.5 py-0 text-[10px]">
                                                {row.doc.intake_lifecycle_hint}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-gray-500 mt-0.5 ml-5 flex items-center gap-2 flex-wrap">
                                        <span>{dateLabel}</span>
                                        {row.fact?.term_months != null && (
                                            <>
                                                <span>·</span>
                                                <span>
                                                    {row.fact.term_months}{" "}
                                                    months
                                                </span>
                                            </>
                                        )}
                                        {row.fact?.total_value_minor !=
                                            null && (
                                            <>
                                                <span>·</span>
                                                <span>
                                                    {formatMoney(
                                                        row.fact
                                                            .total_value_minor,
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
                                                    className="hover:text-blue-600 underline-offset-2 hover:underline"
                                                >
                                                    in {row.project.name}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                    {row.doc.intake_summary && (
                                        <div className="ml-5 mt-1.5 text-[12px] text-gray-700 leading-snug">
                                            {row.doc.intake_summary}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
