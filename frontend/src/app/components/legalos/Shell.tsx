"use client";
// Legalos shell — top bar, left rail, status bar.
// Single-tenant (Kodex, Inc.). No persona switching. Rail only lists
// surfaces that are wired to real backend data.

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon, Kbd } from "./Primitives";
import { useAppShell } from "@/app/contexts/AppShellContext";

const VIEW_LABELS: Record<string, string> = {
    "/matters": "Matters",
    "/parties": "Parties",
    "/intake": "Intake",
    "/tabular-reviews": "The Grid",
    "/studio/lifecycle": "Lifecycle",
};

function viewLabelFor(pathname: string): string {
    if (pathname.startsWith("/projects/")) return "Workspace";
    if (pathname.startsWith("/parties/")) return "Parties";
    if (pathname.startsWith("/tabular-reviews/")) return "The Grid";
    if (pathname.startsWith("/studio/")) return "Lifecycle";
    return VIEW_LABELS[pathname] ?? (pathname.replace(/^\//, "") || "Home");
}

export function TopBar() {
    const pathname = usePathname() ?? "/";
    return (
        <div
            style={{
                height: "var(--chrome-h)",
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg)",
                padding: "0 8px",
                gap: 8,
                position: "relative",
                zIndex: 50,
            }}
        >
            <div
                style={{
                    color: "var(--ink-95)",
                    padding: "0 4px",
                    display: "flex",
                    alignItems: "center",
                }}
            >
                <svg width="18" height="18" viewBox="0 0 48 48">
                    <rect x="4" y="4" width="40" height="40" fill="currentColor" />
                    <rect
                        x="14"
                        y="14"
                        width="20"
                        height="20"
                        fill="oklch(99.2% 0.003 75)"
                    />
                    <rect x="14" y="24" width="20" height="10" fill="currentColor" />
                </svg>
            </div>
            <span
                style={{
                    fontSize: 12,
                    color: "var(--fg-muted)",
                    fontFamily: "var(--font-sans)",
                }}
            >
                Kodex, Inc.
            </span>
            <span style={{ color: "var(--fg-faint)" }}>/</span>
            <span
                style={{
                    fontSize: 12,
                    color: "var(--fg-strong)",
                    fontFamily: "var(--font-sans)",
                }}
            >
                {viewLabelFor(pathname)}
            </span>

            <div style={{ flex: 1 }} />

            <button
                style={{
                    height: 24,
                    padding: "0 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "var(--bg-subtle)",
                    border: "1px solid var(--border)",
                    borderRadius: 3,
                    cursor: "pointer",
                    fontFamily: "var(--font-sans)",
                    fontSize: 12,
                    color: "var(--fg-muted)",
                    minWidth: 220,
                }}
            >
                <Icon.Search style={{ width: 11, height: 11 }} />
                <span style={{ flex: 1, textAlign: "left" }}>
                    Search matters, contracts…
                </span>
                <Kbd>⌘K</Kbd>
            </button>
        </div>
    );
}

type RailItemDef = {
    id: string;
    href: string;
    label: string;
    icon: React.ReactNode;
};

const WORKSPACE_ITEMS: RailItemDef[] = [
    { id: "matters", href: "/matters", label: "Matters", icon: <Icon.Folder /> },
    { id: "intake", href: "/intake", label: "Intake", icon: <Icon.Inbox /> },
    { id: "parties", href: "/parties", label: "Parties", icon: <Icon.Branch /> },
];

const STUDIO_ITEMS: RailItemDef[] = [
    {
        id: "grid",
        href: "/tabular-reviews",
        label: "The Grid",
        icon: <Icon.Grid />,
    },
    {
        id: "lifecycle",
        href: "/studio/lifecycle",
        label: "Lifecycle",
        icon: <Icon.Trend />,
    },
];

export function LeftRail() {
    const router = useRouter();
    const pathname = usePathname() ?? "/";

    function isActive(href: string): boolean {
        if (href === "/") return pathname === href;
        return pathname === href || pathname.startsWith(href + "/");
    }

    return (
        <div
            className="legalos-scroll"
            style={{
                width: "var(--rail-w)",
                borderRight: "1px solid var(--border)",
                background: "var(--bg-subtle)",
                display: "flex",
                flexDirection: "column",
                padding: "6px 6px",
                gap: 2,
                overflowY: "auto",
            }}
        >
            <RailHeading>WORKSPACE</RailHeading>
            {WORKSPACE_ITEMS.map((it) => (
                <RailItem
                    key={it.id}
                    label={it.label}
                    icon={it.icon}
                    active={isActive(it.href)}
                    onClick={() => router.push(it.href)}
                />
            ))}

            <RailHeading style={{ paddingTop: 14 }}>STUDIO</RailHeading>
            {STUDIO_ITEMS.map((it) => (
                <RailItem
                    key={it.id}
                    label={it.label}
                    icon={it.icon}
                    active={isActive(it.href)}
                    onClick={() => router.push(it.href)}
                    subtle
                />
            ))}
        </div>
    );
}

function RailHeading({
    children,
    style,
}: {
    children: React.ReactNode;
    style?: React.CSSProperties;
}) {
    return (
        <div
            style={{
                padding: "6px 8px 4px",
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "0.10em",
                color: "var(--fg-muted)",
                textTransform: "uppercase",
                ...style,
            }}
        >
            {children}
        </div>
    );
}

function RailItem({
    label,
    icon,
    active,
    onClick,
    subtle,
}: {
    label: string;
    icon: React.ReactNode;
    active?: boolean;
    onClick?: () => void;
    subtle?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 8px",
                width: "100%",
                border: "1px solid transparent",
                borderRadius: 3,
                background: active ? "var(--bg)" : "transparent",
                borderColor: active ? "var(--border)" : "transparent",
                color: active
                    ? "var(--fg-strong)"
                    : subtle
                      ? "var(--fg-muted)"
                      : "var(--fg)",
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                cursor: "pointer",
                textAlign: "left",
            }}
        >
            <span
                style={{
                    display: "inline-flex",
                    color: active ? "var(--fg-strong)" : "var(--fg-muted)",
                }}
            >
                {icon}
            </span>
            <span style={{ flex: 1 }}>{label}</span>
        </button>
    );
}

export function StatusBar() {
    const { tenant } = useAppShell();
    return (
        <div
            style={{
                height: "var(--statusbar-h)",
                display: "flex",
                alignItems: "center",
                padding: "0 10px",
                gap: 14,
                borderTop: "1px solid var(--border)",
                background: "var(--bg-subtle)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--fg-muted)",
            }}
        >
            <span>{tenant.label}</span>
            <span style={{ flex: 1 }} />
            <span>privileged · attorney work product</span>
        </div>
    );
}
