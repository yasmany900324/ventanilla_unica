import postgres from "postgres";

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

function shouldSuppressNotice(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  if (error.severity === "NOTICE" || error.severity_local === "NOTICE") {
    return true;
  }
  return false;
}

export const sql = connectionString
  ? postgres(connectionString, {
      ssl: "require",
      onnotice: shouldSuppressNotice,
    })
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
