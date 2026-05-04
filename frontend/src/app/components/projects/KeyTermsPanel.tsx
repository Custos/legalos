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

    // Diff helpers across rows of the same document (renewals show changes).
    const valueByDoc = new Map<string, number | null>();
    for (const r of [...rows].sort(
        (a, b) => a.extracted_at.localeCompare(b.extracted_at),
    )) {
        valueByDoc.set(r.document_id, r.total_value_minor);
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
                                {formatMoney(
                                    r.total_value_minor,
                                    r.currency,
                                )}
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
