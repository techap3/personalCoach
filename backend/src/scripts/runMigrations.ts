import dotenv from "dotenv";
import { runMigrations } from "./migrationRunner";

dotenv.config();

runMigrations()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("[migrate] Migration run failed", error);
    process.exit(1);
  });
