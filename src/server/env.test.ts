import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const production = {
  NODE_ENV: "production",
  DATABASE_PATH: "D:/opd/opd.sqlite",
  BACKUP_DIR: "E:/opd-backups",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://opd.hospital.example",
};

describe("parseEnv", () => {
  it("accepts a complete production environment", () => {
    expect(parseEnv(production)).toMatchObject({ NODE_ENV: "production", DATABASE_PATH: "D:/opd/opd.sqlite" });
  });

  it.each(["DATABASE_PATH", "BACKUP_DIR", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"])(
    "throws in production when %s is missing",
    (key) => {
      expect(() => parseEnv({ ...production, [key]: undefined })).toThrow(key);
      expect(() => parseEnv({ ...production, [key]: "  " })).toThrow(key);
    },
  );

  it("throws in production when the secret is shorter than 32 characters", () => {
    expect(() => parseEnv({ ...production, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("never puts values in the error message", () => {
    expect(() => parseEnv({ ...production, BETTER_AUTH_SECRET: "leaky-secret" })).not.toThrow(/leaky-secret/);
  });

  it("uses local defaults in development", () => {
    expect(parseEnv({ NODE_ENV: "development" })).toMatchObject({
      DATABASE_PATH: "data/dev.sqlite",
      BACKUP_DIR: "data/backups",
      BETTER_AUTH_URL: "http://localhost:3000",
    });
    expect(parseEnv({}).NODE_ENV).toBe("development");
  });
});
