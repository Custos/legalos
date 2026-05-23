"use client";

import { useEffect, useState } from "react";
import {
    listProjectFacts,
    type ContractFactsRow,
} from "@/app/lib/mikeApi";

interface Props {
    projectId: string;
    /** Optional filename map to label each row. */
    filenameByDocId?: Record<string, string>;
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

function formatTerm(months: number | null): string {
    if (months == null) return "—";
    if (months % 12 === 0) {
        const years = months / 12;
        return `${years} ${years === 1 ? "year" : "years"}`;
    }
    return `${months} months`;
}

function formatDate(iso: string | null): string {
    if (!iso) return "—";
    // SQL DATE columns come back as "YYYY-MM-DD". Parsing those with the
    // Date constructor triggers UTC interpretation, which can roll the day
    // back in negative-UTC timezones. Build a local-time Date from the
    // components instead.
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
        return new Date(iso).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    } catch {
        return iso;
    }
}

export function KeyTermsPanel({ projectId, filenameByDocId }: Props) {
    const [rows, setRows] = useState<ContractFactsRow[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        listProjectFacts(projectId)
            .then((data) => {
                if (!cancelled) setRows(data);
            })
            .catch(() => {
                if (!cancelled) setRows([]);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId]);

    if (rows === null) {
        return (
            <div className="text-xs text-gray-400 px-4 py-3">Loading key terms…</div>
        );
    }
    if (rows.length === 0) {
        return (
            <div className="text-xs text-gray-400 px-4 py-3">
                No key terms extracted yet. Upload a contract document and the
                system will extract effective date, term, value, and renewal
                terms automatically.
            </div>
        );
    }

    // Compute deltas only within the same document's lineage (re-extractions
    // of the same contract). Comparing across distinct documents in a project
    // — especially now that projects can span multiple counterparties — would
    // produce misleading "+20% YoY" badges between unrelated contracts.
    const priorValueByRow = new Map<string, number | null>();
    const byDoc = new Map<string, ContractFactsRow[]>();
    for (const r of rows) {
        const list = byDoc.get(r.document_id) ?? [];
        list.push(r);
        byDoc.set(r.document_id, list);
    }
    for (const list of byDoc.values()) {
        list.sort((a, b) => a.extracted_at.localeCompare(b.extracted_at));
        let lastValue: number | null = null;
        for (const r of list) {
            priorValueByRow.set(r.id, lastValue);
            if (r.total_value_minor != null) lastValue = r.total_value_minor;
        }
    }

    function renderDelta(
        current: number | null,
        prior: number | null,
    ): string | null {
        if (current == null || prior == null || prior === 0) return null;
        const pct = ((current - prior) / prior) * 100;
        if (Math.abs(pct) < 0.5) return null;
        const sign = pct > 0 ? "↑" : "↓";
        return `${sign} ${Math.abs(pct).toFixed(0)}%`;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead className="text-gray-400 border-b border-gray-100">
                    <tr>
                        <th className="text-left font-medium py-2 px-3">Document</th>
                        <th className="text-left font-medium py-2 px-3">Effective</th>
                        <th className="text-left font-medium py-2 px-3">Term</th>
                        <th className="text-left font-medium py-2 px-3">Value</th>
                        <th className="text-left font-medium py-2 px-3">Auto-renew</th>
                        <th className="text-left font-medium py-2 px-3">Notice</th>
                        <th className="text-left font-medium py-2 px-3">Law</th>
                        <th className="text-left font-medium py-2 px-3">Extracted</th>
                    </tr>
                </thead>
                <tbody className="text-gray-700">
                    {rows.map((r) => (
                        <tr
                            key={r.id}
                            className="border-b border-gray-50 last:border-b-0"
                        >
                            <td className="py-2 px-3 truncate max-w-[200px]">
                                {filenameByDocId?.[r.document_id] ?? r.document_id.slice(0, 8)}
                            </td>
                            <td className="py-2 px-3">
                                {formatDate(r.effective_date)}
                            </td>
                            <td className="py-2 px-3">
                                {formatTerm(r.term_months)}
                            </td>
                            <td className="py-2 px-3">
                                <span>
                                    {formatMoney(
                                        r.total_value_minor,
                                        r.currency,
                                    )}
                                </span>
                                {(() => {
                                    const delta = renderDelta(
                                        r.total_value_minor,
                                        priorValueByRow.get(r.id) ?? null,
                                    );
                                    if (!delta) return null;
                                    const up = delta.startsWith("↑");
                                    return (
                                        <span
                                            className={`ml-1.5 text-[10px] font-medium ${
                                                up
                                                    ? "text-emerald-600"
                                                    : "text-red-600"
                                            }`}
                                        >
                                            {delta}
                                        </span>
                                    );
                                })()}
                            </td>
                            <td className="py-2 px-3">
                                {r.auto_renew == null
                                    ? "—"
                                    : r.auto_renew
                                      ? "Yes"
                                      : "No"}
                            </td>
                            <td className="py-2 px-3">
                                {r.notice_days != null
                                    ? `${r.notice_days}d`
                                    : "—"}
                            </td>
                            <td className="py-2 px-3 truncate max-w-[120px]">
                                {r.governing_law ?? "—"}
                            </td>
                            <td className="py-2 px-3 text-gray-400">
                                {new Date(r.extracted_at).toLocaleDateString()}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
