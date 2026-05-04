"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";
import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import {
    listCounterparties,
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
    }, [role]);

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
                      }`}
            </div>

            <div className="px-8 pb-8">
                {!loading && filtered.length === 0 ? (
                    <div className="text-sm text-gray-400 py-12 text-center">
                        {role === "seller"
                            ? "No customer-template projects yet. Create one and set its counterparty to start the index."
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
                                        <div className="text-sm font-medium text-gray-900 truncate">
                                            {g.counterparty}
                                        </div>
                                        {g.parent_counterparty && (
                                            <div className="text-[11px] text-gray-500 truncate">
                                                ↳ {g.parent_counterparty}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500 shrink-0">
                                        {g.project_count}{" "}
                                        {g.project_count === 1
                                            ? "project"
                                            : "projects"}
                                    </div>
                                    <div className="text-xs text-gray-400 shrink-0 w-24 text-right">
                                        {relTime(g.last_activity)}
                                    </div>
                                </summary>
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
                                </div>
                            </details>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
