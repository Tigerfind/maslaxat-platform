const path = require('path');

const fixture = require(path.join(__dirname, 'fixtures', 'representative-db'));
const databaseName = `emaslaxat_session_a_a1_scale_${process.pid}`;

test('deterministic scale fixture preserves 50 lawyers, 200 clients, and 1000 consultations', async () => {
  await fixture.recreateDisposableDatabase(databaseName);
  try {
    await fixture.createRepresentativeDatabase(databaseName);
    await fixture.createRepresentativeScaleData(databaseName);
    const before = await fixture.readRepresentativeScaleSnapshot(databaseName);
    expect(before).toEqual({
      lawyers: 50,
      clients: 200,
      consultations: 1000,
      firstLawyerId: '10000000-0000-4000-8000-000000000001',
      lastLawyerId: '10000000-0000-4000-8000-000000000050',
      firstClientId: '20000000-0000-4000-8000-000000000001',
      lastClientId: '20000000-0000-4000-8000-000000000200',
      firstConsultationId: '40000000-0000-4000-8000-000000000001',
      lastConsultationId: '40000000-0000-4000-8000-000000001000',
    });

    const migration = fixture.runMigrations(databaseName);
    expect({ status: migration.status, stderr: migration.stderr }).toEqual({ status: 0, stderr: '' });
    await expect(fixture.readRepresentativeScaleSnapshot(databaseName)).resolves.toEqual(before);
  } finally {
    await fixture.dropDisposableDatabase(databaseName);
  }
}, 120000);
