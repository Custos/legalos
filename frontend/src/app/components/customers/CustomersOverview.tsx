"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight, GitMerge } from "lucide-react";
import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import {
    listCounterparties,
    mergeCounterparty,
    type CounterpartyGroup,
} from "@/app/lib/mikeApi";

type RoleFilter = "seller" | "buyer" | "all";

const ROLE_LABELS: Record<RoleFilter, string> = {
    seller: "Customers",
    buyer: "Vendors",
    all: "All counterparties",
};

function relTime(iso: string): string {
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
}

export function CustomersOverview() {
    const [role, setRole] = useState<RoleFilter>("seller");
    const [groups, setGroups] = useState<CounterpartyGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [mergingFrom, setMergingFrom] = useState<string | null>(null);
    const [mergeTarget, setMergeTarget] = useState<string>("");
    const [refreshTick, setRefreshTick] = useState(0);
    const router = useRouter();

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        listCounterparties(role)
            .then((data) => {
                if (cancelled) return;
                setGroups(data);
            })
            .catch(() => {
                if (cancelled) return;
                setGroups([]);
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [role, refreshTick]);

    async function handleMerge(from: string) {
        const target = mergeTarget.trim();
        if (!target || target === from) {
            setMergingFrom(null);
            setMergeTarget("");
            return;
        }
        try {
            await mergeCounterparty(from, target);
        } catch {
            /* ignore — surfaces nothing for now */
        }
        setMergingFrom(null);
        setMergeTarget("");
        setRefreshTick((t) => t + 1);
    }

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return groups;
        return groups.filter((g) =>
            [g.counterparty, g.parent_counterparty ?? ""]
                .join(" ")
                .toLowerCase()
                .includes(q),
        );
    }, [groups, search]);

    const totalProjects = filtered.reduce(
        (acc, g) => acc + g.project_count,
        0,
    );
    const totalStandalone = filtered.reduce(
        (acc, g) => acc + (g.standalone_count ?? 0),
        0,
    );

    return (
        <div className="flex-1 overflow-y-auto bg-white">
            <div className="flex items-center justify-between px-8 py-4">
                <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-gray-500" />
                    <h1 className="text-2xl font-medium font-serif text-gray-900">
                        {ROLE_LABELS[role]}
                    </h1>
                </div>
                <HeaderSearchBtn
                    value={search}
                    onChange={setSearch}
                    placeholder="Search…"
                />
            </div>

            <div className="flex items-center gap-2 px-8 pb-3 -mt-1">
                {(["seller", "buyer", "all"] as RoleFilter[]).map((r) => (
                    <button
                        key={r}
                        onClick={() => setRole(r)}
                        className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                            role === r
                                ? "border-gray-900 bg-gray-900 text-white"
                                : "border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                    >
                        {ROLE_LABELS[r]}
                    </button>
                ))}
            </div>

            <div className="px-8 pb-2 text-xs text-gray-500">
                {loading
                    ? "Loading…"
                    : `${filtered.length} ${
                          filtered.length === 1 ? "counterparty" : "counterparties"
                      } · ${totalProjects} ${
                          totalProjects === 1 ? "project" : "projects"
                      } · ${totalStandalone} standalone ${
                          totalStandalone === 1 ? "doc" : "docs"
                      }`}
            </div>

            <div className="px-8 pb-8">
                {!loading && filtered.length === 0 ? (
                    <div className="text-sm text-gray-400 py-12 text-center">
                        {role === "seller"
                            ? "No customers yet. Upload contracts where you're the seller — they'll show up here automatically."
                            : role === "buyer"
                              ? "No vendors yet. Upload contracts where you're the buyer."
                              : "Nothing here yet."}
                    </div>
                ) : (
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                        {filtered.map((g, i) => (
                            <details
                                key={`${g.counterparty}-${i}`}
                                className="group border-b border-gray-100 last:border-b-0"
                            >
                                <summary className="cursor-pointer flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                                    <ChevronRight className="h-3.5 w-3.5 text-gray-400 group-open:rotate-90 transition-transform" />
                                    <div className="flex-1 min-w-0">
                                        {g.counterparty === "(Unassigned)" ? (
                                            <div className="text-sm font-medium text-gray-900 truncate">
                                                {g.counterparty}
                                            </div>
                                        ) : (
                                            <button
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    router.push(
                                                        `/customers/${encodeURIComponent(g.counterparty)}`,
                                                    );
                                                }}
                                                className="text-sm font-medium text-gray-900 truncate hover:text-blue-600 transition-colors text-left w-full"
                                            >
                                                {g.counterparty}
                                            </button>
                                        )}
                                        {g.parent_counterparty && (
                                            <div className="text-[11px] text-gray-500 truncate">
                                                ↳ {g.parent_counterparty}
                                            </div>
                                        )}
                                    </div>
                                    {g.counterparty !== "(Unassigned)" && (
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setMergingFrom(g.counterparty);
                                                setMergeTarget("");
                                            }}
                                            title="Merge into another counterparty"
                                            className="text-gray-300 hover:text-gray-700 transition-colors"
                                        >
                                            <GitMerge className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                    <div className="text-xs text-gray-500 shrink-0 flex items-center gap-2">
                                        <span>
                                            {g.project_count}{" "}
                                            {g.project_count === 1
                                                ? "project"
                                                : "projects"}
                                        </span>
                                        {g.standalone_count > 0 && (
                                            <span className="text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-1.5 py-0">
                                                +{g.standalone_count} standalone
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-400 shrink-0 w-24 text-right">
                                        {g.last_activity
                                            ? relTime(g.last_activity)
                                            : "—"}
                                    </div>
                                </summary>
                                {mergingFrom === g.counterparty && (
                                    <div className="bg-amber-50 border-t border-amber-100 px-10 py-3 flex items-center gap-2">
                                        <span className="text-xs text-gray-700">
                                            Merge <strong>{g.counterparty}</strong> into:
                                        </span>
                                        <select
                                            value={mergeTarget}
                                            onChange={(e) =>
                                                setMergeTarget(e.target.value)
                                            }
                                            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                                        >
                                            <option value="">Pick target…</option>
                                            {filtered
                                                .filter(
                                                    (other) =>
                                                        other.counterparty !==
                                                            g.counterparty &&
                                                        other.counterparty !==
                                                            "(Unassigned)",
                                                )
                                                .map((other) => (
                                                    <option
                                                        key={other.counterparty}
                                                        value={other.counterparty}
                                                    >
                                                        {other.counterparty}
                                                    </option>
                                                ))}
                                        </select>
                                        <button
                                            onClick={() =>
                                                handleMerge(g.counterparty)
                                            }
                                            disabled={!mergeTarget}
                                            className="text-xs rounded-full px-3 py-1 bg-gray-900 text-white disabled:opacity-40"
                                        >
                                            Merge
                                        </button>
                                        <button
                                            onClick={() => {
                                                setMergingFrom(null);
                                                setMergeTarget("");
                                            }}
                                            className="text-xs text-gray-500 hover:text-gray-700"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                )}
                                <div className="bg-gray-50/50 border-t border-gray-100">
                                    {g.projects
                                        .slice()
                                        .sort((a, b) =>
                                            b.updated_at.localeCompare(
                                                a.updated_at,
                                            ),
                                        )
                                        .map((p) => (
                                            <button
                                                key={p.id}
                                                onClick={() =>
                                                    router.push(
                                                        `/projects/${p.id}`,
                                                    )
                                                }
                                                className="w-full flex items-center justify-between px-10 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                                            >
                                                <span className="truncate">
                                                    {p.name}
                                                </span>
                                                <span className="text-xs text-gray-400 shrink-0 ml-2">
                                                    {relTime(p.updated_at)}
                                                </span>
                                            </button>
                                        ))}
                                    {g.standalone_count > 0 && (
                                        <button
                                            onClick={() =>
                                                router.push(
                                                    `/customers/${encodeURIComponent(g.counterparty)}`,
                                                )
                                            }
                                            className="w-full flex items-center justify-between px-10 py-2 text-left text-xs text-amber-700 hover:bg-amber-50 transition-colors border-t border-gray-100"
                                        >
                                            <span>
                                                {g.standalone_count} standalone{" "}
                                                {g.standalone_count === 1
                                                    ? "document"
                                                    : "documents"}{" "}
                                                — view full timeline →
                                            </span>
                                        </button>
                                    )}
                                </div>
                            </details>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
