async function runStartup({
  initializeDatabase,
  authorize = async () => {},
  seed,
  connectRedis,
  attachRedisAdapter,
  listen,
  startJobs,
  onFatal,
}) {
  try {
    const migrationState = await initializeDatabase();
    await authorize(migrationState);
    await seed(migrationState);
    await connectRedis();
    await attachRedisAdapter();
    await listen();
    await startJobs();
    return migrationState;
  } catch (error) {
    await onFatal(error);
    return null;
  }
}

module.exports = { runStartup };
