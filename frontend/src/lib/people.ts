// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
/** Matching and ranking for search pickers (people, projects). Pure functions so they can be unit-tested. */

export interface Person { id: number; name: string; email?: string | null; team_name?: string | null; is_active?: boolean }

/** Lower-case and strip diacritics, so "muller" finds "Müller" and "Zoe" finds "Zoé". */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Ranks items for a query. Every word of the query must match: the start of the name (best), the start of a
 * name part, or anywhere in the name or the extra text (email, code). Ties are broken alphabetically.
 * An empty query keeps the input order.
 */
export function rankItems<T>(items: T[], query: string, text: (item: T) => { name: string; extra?: string | null }): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  const scored: { item: T; name: string; score: number }[] = [];
  for (const item of items) {
    const { name: rawName, extra } = text(item);
    const name = normalize(rawName);
    const parts = name.split(/[\s\-'.]+/);
    const more = normalize(extra || "");
    let score = 0;
    for (const term of terms) {
      if (name.startsWith(term)) score += 3;
      else if (parts.some((w) => w.startsWith(term))) score += 2;
      else if (name.includes(term) || more.includes(term)) score += 1;
      else { score = -1; break; }
    }
    if (score > 0) scored.push({ item, name: rawName, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map((x) => x.item);
}

export function rankPeople<P extends Person>(people: P[], query: string): P[] {
  return rankItems(people, query, (p) => ({ name: p.name, extra: p.email }));
}
