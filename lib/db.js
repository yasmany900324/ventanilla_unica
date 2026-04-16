import postgres from "postgres";

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

export const sql = connectionString
  ? postgres(connectionString, { ssl: "require" })
  : null;

export function hasDatabase() {
  return Boolean(sql);
}

export function ensureDatabase() {
  if (!sql) {
    throw new Error("Missing POSTGRES_URL or DATABASE_URL environment variable.");
  }

  return sql;
}
