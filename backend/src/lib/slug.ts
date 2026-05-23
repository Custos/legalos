// Counterparty slug helpers. Counterparties are not their own table — they
// are strings stored on documents.intake_counterparty (and historically on
// projects.counterparty). To avoid duplicates like "Airbnb, Inc" vs "Airbnb,
// Inc." showing as separate customers, we group by a canonical slug.
//
// Slug rules:
//   - lowercase
//   - drop common entity suffixes (inc, llc, ltd, gmbh, corp, etc.)
//   - drop punctuation
//   - collapse whitespace into single hyphens
//
// "Adobe Inc."     → "adobe"
// "Airbnb, Inc"    → "airbnb"
// "Airbnb, Inc."   → "airbnb"
// "Stripe, Inc."   → "stripe"

const ENTITY_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation",
  "co", "company", "gmbh", "ag", "sa", "plc", "llp", "lp", "nv", "bv",
  "kg", "kk", "pty", "pte", "spa",
]);

export function slugifyCounterparty(name: string): string {
  if (!name) return "";
  const cleaned = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, " ") // punctuation → space
    .split(/\s+/)
    .filter((tok) => tok && !ENTITY_SUFFIXES.has(tok))
    .join("-");
  return cleaned.replace(/^-+|-+$/g, "");
}
