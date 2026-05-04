"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { History, X } from "lucide-react";
import { getCellVersions, type CellVersion } from "@/app/lib/mikeApi";

interface Props {
    open: boolean;
    onClose: () => void;
    reviewId: string;
    cellId: string | null;
}

interface CurrentCell {
    id: string;
    content: string | null;
    status: string | null;
    citations: unknown;
    model: string | null;
    system_prompt: string | null;
    column_prompt: string | null;
    updated_at: string;
}

function parseSummary(content: string | null): string {
    if (!content) return "";
    try {
        const parsed = JSON.parse(content) as { summary?: unknown };
        if (typeof parsed.summary === "string") return parsed.summary;
    } catch {
        /* fall through */
    }
    return content;
}

function formatModel(model: string | null): string {
    if (!model) return "unknown model";
    return model;
}

function formatTime(iso: string): string {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

export function CellHistoryModal({ open, onClose, reviewId, cellId }: Props) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [current, setCurrent] = useState<CurrentCell | null>(null);
    const [versions, setVersions] = useState<CellVersion[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !cellId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        getCellVersions(reviewId, cellId)
            .then((data) => {
                if (cancelled) return;
                setCurrent(data.current);
                setVersions(data.versions);
                setSelectedId(data.versions[0]?.id ?? null);
            })
            .catch((e) => {
                if (cancelled) return;
                setError((e as Error).message ?? "Failed to load history");
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, cellId, reviewId]);

    if (!open) return null;

    const selectedVersion = versions.find((v) => v.id === selectedId) ?? null;

    return createPortal(
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 backdrop-blur-xs"
            onClick={onClose}
        >
            <div
                className="w-full max-w-5xl h-[80vh] rounded-2xl bg-white shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <History className="h-4 w-4" />
                        Cell history
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-700 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                        Loading…
                    </div>
                ) : error ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-red-500">
                        {error}
                    </div>
                ) : !current ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                        No data.
                    </div>
                ) : (
                    <div className="flex-1 grid grid-cols-[220px_1fr_1fr] min-h-0">
                        {/* Version list */}
                        <div className="border-r border-gray-200 overflow-y-auto">
                            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                                Versions
                            </div>
                            <button
                                onClick={() => setSelectedId(null)}
                                className={`w-full text-left px-3 py-2 text-xs border-b border-gray-100 transition-colors ${
                                    selectedId === null
                                        ? "bg-blue-50 text-blue-900"
                                        : "hover:bg-gray-50"
                                }`}
                            >
                                <div className="font-medium">Current</div>
                                <div className="text-[10px] text-gray-500">
                                    {formatModel(current.model)}
                                </div>
                                <div className="text-[10px] text-gray-400">
                                    {formatTime(current.updated_at)}
                                </div>
                            </button>
                            {versions.map((v) => (
                                <button
                                    key={v.id}
                                    onClick={() => setSelectedId(v.id)}
                                    className={`w-full text-left px-3 py-2 text-xs border-b border-gray-100 transition-colors ${
                                        selectedId === v.id
                                            ? "bg-blue-50 text-blue-900"
                                            : "hover:bg-gray-50"
                                    }`}
                                >
                                    <div className="font-medium">
                                        {formatModel(v.model)}
                                    </div>
                                    <div className="text-[10px] text-gray-400">
                                        {formatTime(v.created_at)}
                                    </div>
                                </button>
                            ))}
                        </div>

                        {/* Selected version detail */}
                        <div className="overflow-y-auto p-4 border-r border-gray-200">
                            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                                {selectedVersion ? "Archived" : "Current"}
                            </div>
                            <div className="text-xs text-gray-500 mb-3">
                                {formatModel(
                                    selectedVersion?.model ?? current.model,
                                )}
                                {" · "}
                                {formatTime(
                                    selectedVersion?.created_at ??
                                        current.updated_at,
                                )}
                            </div>
                            <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 font-sans">
                                {parseSummary(
                                    selectedVersion?.content ?? current.content,
                                )}
                            </pre>
                        </div>

                        {/* Prompt panel */}
                        <div className="overflow-y-auto p-4">
                            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                                Column prompt
                            </div>
                            <pre className="whitespace-pre-wrap break-words text-xs text-gray-700 font-sans mb-4 bg-gray-50 rounded p-2">
                                {selectedVersion?.column_prompt ??
                                    current.column_prompt ??
                                    "—"}
                            </pre>
                            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                                System prompt
                            </div>
                            <pre className="whitespace-pre-wrap break-words text-[11px] text-gray-600 font-sans bg-gray-50 rounded p-2">
                                {selectedVersion?.system_prompt ??
                                    current.system_prompt ??
                                    "—"}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
