/** JSON-serialisable values (what server functions may return). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }
