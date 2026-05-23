"use client";
// Parties — counterparty index. Rebuilt directly with the legalos design
// system; replaces CustomersOverview's Tailwind chrome.

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
    if (days === 1) return "1d ago";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}

const COLS = "1fr 140px 140px 100px";

export default function PartiesPage() {
    const [role, setRole] = React.useState<RoleFilter>("seller");
    const [groups, setGroups] = React.useState<CounterpartyGroup[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [search, setSearch] = React.useState("");
    const router = useRouter();

    React.useEffect(() => {
        let cancelled = false;
        setLoading(true);
        listCounterparties(role)
            .then((data) => {
                if (!cancelled) setGroups(data);
            })
            .catch(() => {
                if (!cancelled) setGroups([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [role]);

    const filtered = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return groups;
        return groups.filter((g) =>
            [g.counterparty, g.parent_counterparty ?? ""]
                .join(" ")
                .toLowerCase()
                .includes(q),
        );
    }, [groups, search]);

    const totalDocs = filtered.reduce((acc, g) => acc + g.document_count, 0);
    const totalProjects = filtered.reduce((acc, g) => acc + g.project_count, 0);

    return (
        <PageScroll>
            <SectionHeader
                title={`PARTIES · ${ROLE_LABELS[role].toUpperCase()}`}
                subtitle={
                    loading
                        ? "loading…"
                        : `${filtered.length} ${
                              filtered.length === 1 ? "party" : "parties"
                          } · ${totalDocs} documents · ${totalProjects} matters`
                }
                right={
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search…"
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
                            width: 220,
                        }}
                    />
                }
            />

            <div style={{ display: "flex", gap: 6 }}>
                {(["seller", "buyer", "all"] as RoleFilter[]).map((r) => {
                    const active = role === r;
                    return (
                        <button
                            key={r}
                            onClick={() => setRole(r)}
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
                            {ROLE_LABELS[r]}
                        </button>
                    );
                })}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
                <Stat label="PARTIES" value={String(filtered.length)} />
                <Stat label="DOCUMENTS" value={String(totalDocs)} />
                <Stat label="MATTERS" value={String(totalProjects)} />
                <Stat
                    label="WITH PARENT ENTITY"
                    value={String(
                        filtered.filter((g) => g.parent_counterparty).length,
                    )}
                />
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
                    {["PARTY", "DOCUMENTS", "MATTERS", "LAST"].map((h, i) => (
                        <div
                            key={h}
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
                    ))}
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
                        {role === "seller"
                            ? "No customers yet. Upload contracts where you're the seller."
                            : role === "buyer"
                              ? "No vendors yet. Upload contracts where you're the buyer."
                              : "No counterparties."}
                    </div>
                ) : (
                    filtered.map((g, i) => (
                        <button
                            key={g.slug}
                            onClick={() => router.push(`/parties/${g.slug}`)}
                            style={{
                                display: "grid",
                                gridTemplateColumns: COLS,
                                height: 30,
                                width: "100%",
                                borderBottom:
                                    i < filtered.length - 1
                                        ? "1px solid var(--hairline)"
                                        : "none",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                textAlign: "left",
                                padding: 0,
                            }}
                        >
                            <div style={cell("var(--fg-strong)")}>
                                <span
                                    style={{
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {g.counterparty}
                                </span>
                                {g.parent_counterparty && (
                                    <span
                                        style={{
                                            marginLeft: 8,
                                            fontFamily: "var(--font-mono)",
                                            fontSize: 11,
                                            color: "var(--fg-faint)",
                                        }}
                                    >
                                        ↳ {g.parent_counterparty}
                                    </span>
                                )}
                            </div>
                            <div style={cell("var(--fg)", "mono")}>
                                {g.document_count}
                            </div>
                            <div style={cell("var(--fg)", "mono")}>
                                {g.project_count}
                            </div>
                            <div style={cell("var(--fg-muted)", "mono")}>
                                {g.last_activity ? relTime(g.last_activity) : "—"}
                            </div>
                        </button>
                    ))
                )}
            </Card>
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
