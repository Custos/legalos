"use client";
// Single-tenant context (Kodex, Inc.). Persona switching has been removed —
// the app runs against real backend data without role overlays for now.

import * as React from "react";

export const TENANT = {
    id: "kodex",
    label: "Kodex, Inc.",
    initials: "K",
    color: "oklch(22% 0.012 75)",
} as const;

type Ctx = { tenant: typeof TENANT };
const AppShellContext = React.createContext<Ctx>({ tenant: TENANT });

export function AppShellProvider({ children }: { children: React.ReactNode }) {
    return (
        <AppShellContext.Provider value={{ tenant: TENANT }}>
            {children}
        </AppShellContext.Provider>
    );
}

export function useAppShell(): Ctx {
    return React.useContext(AppShellContext);
}
