"use client";

import { use } from "react";
import { CounterpartyTimelineView } from "@/app/components/customers/CounterpartyTimelineView";

export default function CounterpartyDetailPage({
    params,
}: {
    params: Promise<{ name: string }>;
}) {
    const { name } = use(params);
    return <CounterpartyTimelineView name={decodeURIComponent(name)} />;
}
