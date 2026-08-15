import process from "node:process";

process.env.NODE_ENV = "production";

await import("../apps/server/dist/main.js");
