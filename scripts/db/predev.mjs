import nextEnv from "@next/env";
import { assertDatabaseEnvironment } from "../../src/lib/db/accessPolicy.mjs";
nextEnv.loadEnvConfig(process.cwd(), true);
assertDatabaseEnvironment(process.env);
