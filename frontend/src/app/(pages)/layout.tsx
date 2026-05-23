"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ChatHistoryProvider } from "@/app/contexts/ChatHistoryContext";
import { AppShellProvider } from "@/app/contexts/AppShellContext";
import { TopBar, LeftRail, StatusBar } from "@/app/components/legalos/Shell";

export default function MikeLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isAuthenticated, authLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!authLoading && !isAuthenticated) {
            router.push("/login");
        }
    }, [authLoading, isAuthenticated, router]);

    if (authLoading) {
        return (
            <div
                style={{
                    height: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--bg)",
                }}
            >
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
            </div>
        );
    }
    if (!isAuthenticated) return null;

    return (
        <ChatHistoryProvider>
            <AppShellProvider>
                <div
                    style={{
                        height: "100dvh",
                        display: "flex",
                        flexDirection: "column",
                        background: "var(--bg)",
                        overflow: "hidden",
                    }}
                >
                    <TopBar />
                    <div
                        style={{
                            flex: 1,
                            display: "flex",
                            minHeight: 0,
                            overflow: "hidden",
                        }}
                    >
                        <LeftRail />
                        <main
                            style={{
                                flex: 1,
                                display: "flex",
                                flexDirection: "column",
                                minWidth: 0,
                                background: "var(--bg-subtle)",
                                overflow: "hidden",
                            }}
                        >
                            {children}
                        </main>
                    </div>
                    <StatusBar />
                </div>
            </AppShellProvider>
        </ChatHistoryProvider>
    );
}
