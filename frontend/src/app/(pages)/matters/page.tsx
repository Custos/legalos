"use client";
// Matters view — extends the existing `projects` table. We render a list
// of projects from the backend and overlay design columns (type, owner,
// status, risk, next due, OC spend) where backend data exists, falling
// back to "—" otherwise.

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
import { listProjects } from "@/app/lib/mikeApi";
import type { MikeProject } from "@/app/components/shared/types";

const COLS = "80px 1fr 110px 90px 110px";
const HEADERS = ["ID", "TITLE", "TEMPLATE", "DOCS", "UPDATED"];

function relTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const d = Math.floor(diff / 86_400_000);
    if (d === 0) return "today";
    if (d === 1) return "1d ago";
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    if (d < 365) return `${Math.floor(d / 30)}mo ago`;
    return `${Math.floor(d / 365)}y ago`;
}

export default function MattersPage() {
    const router = useRouter();
    const [projects, setProjects] = React.useState<MikeProject[] | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        listProjects()
            .then((data) => {
                if (!cancelled) setProjects(data);
            })
            .catch(() => {
                if (!cancelled) setProjects([]);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const matters = projects ?? [];
    const open = matters.length;

    return (
        <PageScroll>
            <SectionHeader
                title="MATTERS"
                subtitle={`${open} ${open === 1 ? "matter" : "matters"}`}
                right={
                    <div style={{ display: "flex", gap: 6 }}>
                        <Button size="sm" icon={<Icon.Settings />}>
                            Filters
                        </Button>
                        <Button
                            size="sm"
                            kind="primary"
                            icon={<Icon.Plus />}
                            onClick={() => router.push("/projects")}
                        >
                            New matter
                        </Button>
                    </div>
                }
            />

            <div style={{ display: "flex", gap: 10 }}>
                <Stat label="MATTERS" value={String(open)} />
                <Stat
                    label="WITH TEMPLATE"
                    value={String(matters.filter((m) => m.template).length)}
                />
                <Stat
                    label="SHARED WITH OTHERS"
                    value={String(
                        matters.filter((m) => (m.shared_with?.length ?? 0) > 0)
                            .length,
                    )}
                />
            </div>

            <Card>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: COLS,
                        height: 24,
                        background: "var(--bg-subtle)",
                        borderBottom: "1px solid var(--border)",
                    }}
                >
                    {HEADERS.map((h, i) => (
                        <div
                            key={h}
                            style={{
                                padding: "0 10px",
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
                {projects === null ? (
                    <div
                        style={{
                            padding: "16px 12px",
                            fontSize: 12,
                            color: "var(--fg-muted)",
                        }}
                    >
                        Loading matters…
                    </div>
                ) : matters.length === 0 ? (
                    <div
                        style={{
                            padding: "16px 12px",
                            fontSize: 12,
                            color: "var(--fg-muted)",
                        }}
                    >
                        No matters yet. Create one from /projects.
                    </div>
                ) : (
                    matters.map((m, i) => (
                        <div
                            key={m.id}
                            onClick={() => router.push(`/projects/${m.id}`)}
                            style={{
                                display: "grid",
                                gridTemplateColumns: COLS,
                                height: 30,
                                borderBottom:
                                    i < matters.length - 1
                                        ? "1px solid var(--hairline)"
                                        : "none",
                                cursor: "pointer",
                            }}
                        >
                            <div style={cell("var(--fg-muted)", "mono")}>
                                {m.id.slice(0, 6)}
                            </div>
                            <div
                                style={{
                                    ...cell("var(--fg-strong)"),
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {m.name}
                            </div>
                            <div style={cell()}>
                                {m.template ? (
                                    <Tag tone="neutral">{m.template}</Tag>
                                ) : (
                                    <span style={{ color: "var(--fg-faint)" }}>
                                        —
                                    </span>
                                )}
                            </div>
                            <div style={cell("var(--fg)", "mono")}>
                                {m.document_count ?? 0}
                            </div>
                            <div style={cell("var(--fg-muted)", "mono")}>
                                {relTime(m.updated_at)}
                            </div>
                        </div>
                    ))
                )}
            </Card>
        </PageScroll>
    );
}

function cell(color = "var(--fg)", font?: "mono"): React.CSSProperties {
    return {
        padding: "0 10px",
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
