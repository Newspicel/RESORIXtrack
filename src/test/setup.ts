import { beforeEach } from "vitest"
import { freeze } from "@/server/time"
import { resetTestDb } from "./db"

process.env.NODE_ENV = "test"

beforeEach(() => {
  resetTestDb()
  freeze(null)
})
