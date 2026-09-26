import { migrationOptions, repositoryOptions } from "./config-fixture.js";
// @vitest-environment node
// Break caught: the development proxy rewrites Host, so a same-origin browser PATCH is rejected at the API boundary.
import { createServer } from "vite";
import request from "supertest";
import { expect, test } from "vitest";
import viteConfig from "../vite.config.js";
import { createApp } from "../src/server/app.js";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";

test("Vite proxy preserves local same-origin mutations and rejects foreign requests", async () => {
  const db = createDatabase(":memory:");
  migrate(db, migrationOptions);
  const repo = new JobRepository(db, repositoryOptions);
  const job = repo.upsertJob({ company: "Acme", title: "Engineer", employmentType: "permanent", source: "web" });
  const applicationId = repo.upsertApplication(job.id, "applied", "2026-09-24T09:00:00.000Z");
  const apiServer = createApp(db, { repositoryOptions }).listen(0, "127.0.0.1");
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await new Promise<void>((resolve) => apiServer.once("listening", resolve));
    const apiAddress = apiServer.address();
    if (!apiAddress || typeof apiAddress === "string") throw new Error("API did not bind a TCP port");
    const apiUrl = `http://127.0.0.1:${apiAddress.port}`;
    const configuredProxy = viteConfig.server?.proxy?.["/api"];
    if (!configuredProxy) throw new Error("Development API proxy is missing");
    const proxy = typeof configuredProxy === "string"
      ? { target: apiUrl, changeOrigin: true }
      : { ...configuredProxy, target: apiUrl };
    vite = await createServer({ configFile: false, plugins: [], logLevel: "silent", server: { host: "127.0.0.1", port: 0, proxy: { "/api": proxy } } });
    await vite.listen();
    const frontendAddress = vite.httpServer?.address();
    if (!frontendAddress || typeof frontendAddress === "string") throw new Error("Vite did not bind a TCP port");
    const frontendUrl = `http://127.0.0.1:${frontendAddress.port}`;

    await request(frontendUrl).patch(`/api/applications/${applicationId}`).set("Origin", frontendUrl).send({ notes: "proxied" }).expect(200);
    expect(repo.listApplications()[0].notes).toBe("proxied");

    await request(frontendUrl).patch(`/api/applications/${applicationId}`).set("Origin", "https://attacker.example").send({ notes: "foreign" }).expect(403);
    expect(repo.listApplications()[0].notes).toBe("proxied");

    await request(apiUrl).patch(`/api/applications/${applicationId}`).set("Origin", apiUrl).send({ notes: "direct" }).expect(200);
    await request(apiUrl).patch(`/api/applications/${applicationId}`).send({ notes: "local client" }).expect(200);
    await request(apiUrl).patch(`/api/applications/${applicationId}`).set("Host", "attacker.example").send({ notes: "rebound" }).expect(400);
    expect(repo.listApplications()[0].notes).toBe("local client");
  } finally {
    await vite?.close();
    await new Promise<void>((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});
