// Remote service configuration. The default connection string targets the local Postgres
// (user `postgres`, password `researchgate`, database `researchgate`, port 5432); override
// with DATABASE_URL in any real deployment.

export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://postgres:researchgate@localhost:5432/researchgate",
  port: Number(process.env.REMOTE_PORT ?? 8100),
};
