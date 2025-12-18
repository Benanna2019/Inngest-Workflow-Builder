import type { Config } from "drizzle-kit";
import "dotenv/config";

console.log("database env", process.env.DATABASE_URL);

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://localhost:5432/workflow",
  },
} satisfies Config;
