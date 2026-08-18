module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query("SET LOCAL lock_timeout = '3s'", { transaction });
      await queryInterface.sequelize.query("SET LOCAL statement_timeout = '60s'", { transaction });
      await queryInterface.sequelize.query(`
        UPDATE "public"."consultations"
        SET problems = jsonb_build_array(question)
        WHERE COALESCE(question, '') <> ''
          AND (
            problems IS NULL
            OR jsonb_typeof(problems) <> 'array'
            OR problems = '[]'::jsonb
            OR problems = '[null]'::jsonb
            OR problems = '[""]'::jsonb
          )
      `, { transaction });
    });
  },

  async down() {
    throw new Error('Forward-only migration: historical problems backfill is not reversible');
  },
};
