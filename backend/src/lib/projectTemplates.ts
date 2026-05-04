// Project templates classify projects by contract type. The slug is what
// gets stored on projects.template; the rest is metadata the UI uses to
// label and filter. Roles tell downstream features (counterparty index,
// lifecycle reports) which side of the agreement we're on.

export type ProjectRole = "buyer" | "seller" | "mutual";

export interface ProjectTemplate {
    slug: string;
    name: string;
    description: string;
    role: ProjectRole;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
    {
        slug: "vendor",
        name: "Vendor Contracts",
        description:
            "Agreements where we're the customer — SaaS subscriptions, services, hardware, etc.",
        role: "buyer",
    },
    {
        slug: "customer",
        name: "Customer Contracts",
        description:
            "Agreements where we're the vendor — order forms, MSAs, SOWs we issue.",
        role: "seller",
    },
    {
        slug: "internal",
        name: "Internal / Other",
        description:
            "NDAs, partnerships, employment agreements, and anything that doesn't fit a vendor/customer split.",
        role: "mutual",
    },
];

const BY_SLUG = new Map(PROJECT_TEMPLATES.map((t) => [t.slug, t]));

export function getTemplate(slug: string | null | undefined): ProjectTemplate | null {
    if (!slug) return null;
    return BY_SLUG.get(slug) ?? null;
}
