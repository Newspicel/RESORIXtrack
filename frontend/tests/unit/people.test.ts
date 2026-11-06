// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 RESORIX AG
import { describe, expect, it } from "vitest";
import { normalize, rankPeople } from "../../src/lib/people";

const people = [
  { id: 1, name: "Anna Meier", email: "anna.meier@example.com", team_name: "RF" },
  { id: 2, name: "Jonas Keller", email: "jonas.keller@example.com" },
  { id: 3, name: "Zoé Müller", email: "zoe.mueller@example.com" },
  { id: 4, name: "Jean-Marc Dubois", email: "jm@example.com" },
  { id: 5, name: "Marc Dubois", email: "marc.dubois@example.com" },
];

describe("rankPeople", () => {
  it("keeps the order for an empty query", () => {
    expect(rankPeople(people, "  ").map((p) => p.id)).toEqual([1, 2, 3, 4, 5]);
  });
  it("matches the start of the name first, then name parts, then email", () => {
    expect(rankPeople(people, "marc").map((p) => p.id)).toEqual([5, 4]);
    expect(rankPeople(people, "dubois").map((p) => p.name)).toEqual(["Jean-Marc Dubois", "Marc Dubois"]);
    expect(rankPeople(people, "jm@").map((p) => p.id)).toEqual([4]);
  });
  it("ignores case and diacritics", () => {
    expect(normalize("Zoé Müller")).toBe("zoe muller");
    expect(rankPeople(people, "MULLER").map((p) => p.id)).toEqual([3]);
    expect(rankPeople(people, "zoe mu").map((p) => p.id)).toEqual([3]);
  });
  it("requires every word to match", () => {
    expect(rankPeople(people, "anna keller")).toEqual([]);
    expect(rankPeople(people, "jonas kel").map((p) => p.id)).toEqual([2]);
  });
});
