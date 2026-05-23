"use client";
// Legalos design-system primitives. Translated from the Claude Design
// handoff bundle (HTML/JSX prototypes) into typed React. Match the visual
// output of the prototypes; do not chase token-for-token parity beyond
// the design tokens defined in legalos.css.

import * as React from "react";

// ─────────── Button ───────────
type ButtonKind = "primary" | "secondary" | "ghost" | "danger" | "ai";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_SIZES: Record<ButtonSize, { h: number; px: number; fs: number }> = {
    sm: { h: 24, px: 8, fs: 12 },
    md: { h: 28, px: 12, fs: 13 },
    lg: { h: 32, px: 14, fs: 14 },
};
const BUTTON_KINDS: Record<
    ButtonKind,
    { bg: string; color: string; border: string }
> = {
    primary:   { bg: "var(--ink-90)", color: "var(--ink-00)", border: "var(--ink-90)" },
    secondary: { bg: "var(--bg)", color: "var(--fg)", border: "var(--border)" },
    ghost:     { bg: "transparent", color: "var(--fg)", border: "transparent" },
    danger:    { bg: "var(--signal-red-soft)", color: "var(--signal-red)", border: "var(--signal-red-edge)" },
    ai:        { bg: "var(--signal-violet)", color: "white", border: "var(--signal-violet)" },
};

export function Button({
    kind = "secondary",
    size = "md",
    children,
    icon,
    onClick,
    disabled,
    style,
    type,
    title,
}: {
    kind?: ButtonKind;
    size?: ButtonSize;
    children?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    style?: React.CSSProperties;
    type?: "button" | "submit" | "reset";
    title?: string;
}) {
    const s = BUTTON_SIZES[size];
    const k = BUTTON_KINDS[kind];
    return (
        <button
            type={type ?? "button"}
            onClick={onClick}
            disabled={disabled}
            title={title}
            style={{
                height: s.h,
                padding: `0 ${s.px}px`,
                fontSize: s.fs,
                fontWeight: 500,
                fontFamily: "var(--font-sans)",
                background: k.bg,
                color: k.color,
                border: `1px solid ${k.border}`,
                borderRadius: 3,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
                whiteSpace: "nowrap",
                transition: "filter var(--dur-fast) var(--ease-out)",
                ...style,
            }}
        >
            {icon}
            {children}
        </button>
    );
}

// ─────────── Icons (Lucide-aligned, inline) ───────────
const stroke: React.SVGAttributes<SVGElement> = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round",
    strokeLinejoin: "round",
};
type IconProps = React.SVGAttributes<SVGSVGElement>;
const I = (d: React.ReactNode) => (props: IconProps) =>
    (
        <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} {...props}>
            {d}
        </svg>
    );
export const Icon = {
    File:     I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>),
    Folder:   I(<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>),
    Search:   I(<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>),
    Grid:     I(<><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></>),
    Trend:    I(<><polyline points="3,17 9,11 13,15 21,7"/><polyline points="14,7 21,7 21,14"/></>),
    Inbox:    I(<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>),
    Play:     I(<polygon points="5 3 19 12 5 21 5 3"/>),
    Settings: I(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4"/></>),
    Branch:   I(<><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></>),
    Check:    I(<polyline points="20 6 9 17 4 12"/>),
    X:        I(<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>),
    Spark:    I(<path d="M12 2 L13.5 8.5 L20 10 L13.5 11.5 L12 18 L10.5 11.5 L4 10 L10.5 8.5 Z"/>),
    Send:     I(<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>),
    Plus:     I(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>),
    Chevron:  I(<polyline points="6 9 12 15 18 9"/>),
    Side:     I(<><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18"/></>),
};

// ─────────── Tag / Pill ───────────
export type TagTone =
    | "neutral"
    | "high"
    | "med"
    | "clean"
    | "info"
    | "ai"
    | "inverse";
const TAG_TONES: Record<
    TagTone,
    { bg: string; color: string; border: string }
> = {
    neutral: { bg: "var(--bg-subtle)", color: "var(--fg-muted)", border: "var(--border)" },
    high:    { bg: "var(--signal-red-soft)", color: "var(--signal-red)", border: "var(--signal-red-edge)" },
    med:     { bg: "var(--signal-amber-soft)", color: "oklch(48% 0.12 75)", border: "var(--signal-amber-edge)" },
    clean:   { bg: "var(--signal-green-soft)", color: "var(--signal-green)", border: "var(--signal-green-edge)" },
    info:    { bg: "var(--signal-blue-soft)", color: "var(--signal-blue)", border: "var(--signal-blue-edge)" },
    ai:      { bg: "var(--signal-violet-soft)", color: "var(--signal-violet)", border: "var(--signal-violet-edge)" },
    inverse: { bg: "var(--ink-95)", color: "var(--ink-00)", border: "var(--ink-95)" },
};
export function Tag({
    tone = "neutral",
    children,
    mono = false,
    style,
}: {
    tone?: TagTone;
    children: React.ReactNode;
    mono?: boolean;
    style?: React.CSSProperties;
}) {
    const t = TAG_TONES[tone];
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                height: 18,
                padding: "0 6px",
                borderRadius: 2,
                background: t.bg,
                color: t.color,
                border: `1px solid ${t.border}`,
                fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: mono ? 0 : "0.04em",
                whiteSpace: "nowrap",
                ...style,
            }}
        >
            {children}
        </span>
    );
}

// ─────────── RiskFlag ───────────
export function RiskFlag({ level }: { level: "high" | "med" | "clean" | "pending" }) {
    const map = {
        high: { glyph: "▲", color: "var(--signal-red)", label: "HIGH" },
        med: { glyph: "◆", color: "oklch(48% 0.12 75)", label: "MED" },
        clean: { glyph: "●", color: "var(--signal-green)", label: "CLEAN" },
        pending: { glyph: "○", color: "var(--fg-muted)", label: "PEND" },
    }[level];
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontFamily: "var(--font-sans)",
                fontSize: 11,
                fontWeight: 600,
                color: map.color,
            }}
        >
            <span style={{ fontSize: 10 }}>{map.glyph}</span>
            {map.label}
        </span>
    );
}

// ─────────── Delta ───────────
export function Delta({ value }: { value: number | string }) {
    const v = typeof value === "string" ? parseFloat(value) : value;
    const color =
        v > 0 ? "var(--delta-up)" : v < 0 ? "var(--delta-down)" : "var(--delta-flat)";
    const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
    return (
        <span
            style={{
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
                fontSize: 12,
                fontWeight: 600,
                color,
            }}
        >
            {sign}
            {Math.abs(v).toFixed(1)}%
        </span>
    );
}

// ─────────── Kbd ───────────
export function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 18,
                height: 18,
                padding: "0 4px",
                borderRadius: 2,
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--fg-muted)",
            }}
        >
            {children}
        </span>
    );
}

// AssistBadge replaced the older mascot signature with a neutral marker.
// Used wherever a value, edit, or marker came from the model rather than
// from a human. Kept as a tiny "AI" pill so machine-touched values are
// visually distinct without naming an agent.
export function AssistBadge({ working = false }: { working?: boolean }) {
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--signal-violet)",
                fontWeight: 600,
            }}
        >
            <span
                style={{
                    display: "inline-block",
                    width: 6,
                    height: 12,
                    background: "var(--signal-violet)",
                    animation: working ? "ai-blink 1s steps(2) infinite" : "none",
                }}
            />
            AI
        </span>
    );
}

// ─────────── Card ───────────
export function Card({
    title,
    right,
    children,
    padding = 16,
    style,
}: {
    title?: React.ReactNode;
    right?: React.ReactNode;
    children: React.ReactNode;
    padding?: number;
    style?: React.CSSProperties;
}) {
    return (
        <div
            style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                ...style,
            }}
        >
            {title && (
                <div
                    style={{
                        padding: "10px 14px",
                        borderBottom: "1px solid var(--hairline)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    <span
                        style={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            color: "var(--fg-muted)",
                            textTransform: "uppercase",
                        }}
                    >
                        {title}
                    </span>
                    {right}
                </div>
            )}
            <div style={{ padding }}>{children}</div>
        </div>
    );
}

// ─────────── Stat ───────────
export type StatTone = "neutral" | "high" | "med" | "clean" | "info";
const STAT_COLOR: Record<StatTone, string> = {
    neutral: "var(--fg-strong)",
    high: "var(--signal-red)",
    med: "var(--signal-amber)",
    clean: "var(--signal-green)",
    info: "var(--signal-blue)",
};
export function Stat({
    label,
    value,
    sub,
    tone = "neutral",
}: {
    label: string;
    value: React.ReactNode;
    sub?: React.ReactNode;
    tone?: StatTone;
}) {
    return (
        <div
            style={{
                flex: 1,
                padding: "14px 16px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 0,
            }}
        >
            <div
                style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    color: "var(--fg-muted)",
                    textTransform: "uppercase",
                }}
            >
                {label}
            </div>
            <div
                style={{
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 26,
                    fontWeight: 600,
                    color: STAT_COLOR[tone],
                    lineHeight: 1.1,
                }}
            >
                {value}
            </div>
            {sub && (
                <div
                    style={{
                        fontSize: 11,
                        color: "var(--fg-muted)",
                        fontFamily: "var(--font-mono)",
                    }}
                >
                    {sub}
                </div>
            )}
        </div>
    );
}

// ─────────── SectionHeader ───────────
export function SectionHeader({
    title,
    subtitle,
    right,
}: {
    title: string;
    subtitle?: string;
    right?: React.ReactNode;
}) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
            }}
        >
            <div>
                <div
                    style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.10em",
                        color: "var(--fg-muted)",
                        textTransform: "uppercase",
                    }}
                >
                    {title}
                </div>
                {subtitle && (
                    <div
                        style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            color: "var(--fg-muted)",
                            marginTop: 2,
                        }}
                    >
                        {subtitle}
                    </div>
                )}
            </div>
            {right}
        </div>
    );
}

// ─────────── PageScroll ───────────
export function PageScroll({
    children,
    padding = "20px 24px",
}: {
    children: React.ReactNode;
    padding?: string;
}) {
    return (
        <div
            className="legalos-scroll"
            style={{
                flex: 1,
                overflow: "auto",
                padding,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                minHeight: 0,
            }}
        >
            {children}
        </div>
    );
}
