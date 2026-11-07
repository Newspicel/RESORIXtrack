import { describe, expect, it } from "vitest"
import { loadActor, makeAbsenceType, makeUser } from "@/test/factories"
import {
  DEFAULT_ABSENCE_TYPES,
  ensureDefaultAbsenceTypes,
  getAbsenceType,
  listAbsenceTypes,
  requestableTypes,
} from "./absence-types"

describe("absence types", () => {
  it("installs the defaults once and keeps existing keys", () => {
    makeAbsenceType({ key: "vacation", label: "Ferien (v1)" })
    expect(ensureDefaultAbsenceTypes()).toBe(DEFAULT_ABSENCE_TYPES.length - 1)
    expect(ensureDefaultAbsenceTypes()).toBe(0)
    expect(listAbsenceTypes().map((t) => t.key)).toEqual([
      "sick",
      "accident",
      "military",
      "training",
      "parental",
      "unpaid",
      "compensation",
      "other",
      "vacation",
    ])
    expect(getAbsenceType("vacation").label).toBe("Ferien (v1)")
  })

  it("resolves by id or key, refuses inactive ones and filters requestable types", () => {
    ensureDefaultAbsenceTypes()
    const sick = getAbsenceType("sick")
    expect(getAbsenceType(sick.id).key).toBe("sick")
    expect(getAbsenceType(String(sick.id)).key).toBe("sick")
    const old = makeAbsenceType({ key: "old", isActive: false })
    expect(() => getAbsenceType(old.id)).toThrow(/Unknown absence type/)
    expect(() => getAbsenceType("nope")).toThrow(/Unknown absence type/)
    const emp = loadActor(makeUser().id)
    const hr = loadActor(makeUser({ capabilities: ["hr"] }).id)
    expect(requestableTypes(emp).map((t) => t.key)).not.toContain("accident")
    expect(requestableTypes(hr).map((t) => t.key)).toContain("accident")
  })
})
