'use strict';

/**
 * Одноразовый дедуп дублей отзывов ПЕРЕД созданием уникального индекса
 * reviews_consultation_id_unique (миграция 20260808000001).
 *
 * Решение пользователя: оставляем САМЫЙ РАННИЙ отзыв на консультацию
 * (MIN(created_at), тай-брейк по id), поздние дубли удаляем. На dev известен ровно
 * один дубль (консультация 2c660517, оба rating=5 — рейтинг не меняется).
 *
 * Затем пересчитываем агрегаты рейтинга юристов (reviews_count мог считать дубль) —
 * теми же правилами, что ratingService.recomputeLawyerRating (по нескрытым отзывам).
 *
 * Идемпотентно: после прогона дублей нет → DELETE затрагивает 0 строк; пересчёт —
 * тот же результат. down() — no-op (удалённые дубли не восстановить).
 */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    const [deleted] = await sequelize.query(`
      DELETE FROM reviews
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY consultation_id ORDER BY created_at ASC, id ASC
          ) AS rn
          FROM reviews
          WHERE consultation_id IS NOT NULL
        ) t
        WHERE t.rn > 1
      )
      RETURNING id
    `);

    // Пересчёт агрегатов: rating по нескрытым (1 знак после запятой), reviews_count —
    // число нескрытых отзывов. Совпадает с services/ratingService.recomputeLawyerRating.
    await sequelize.query(`
      UPDATE lawyer_profiles lp SET
        reviews_count = COALESCE(
          (SELECT COUNT(*) FROM reviews r WHERE r.lawyer_id = lp.user_id AND r.is_hidden = false), 0),
        rating = COALESCE(
          (SELECT ROUND(AVG(r.rating)::numeric, 1) FROM reviews r WHERE r.lawyer_id = lp.user_id AND r.is_hidden = false), 0)
    `);

    if (deleted && deleted.length) {
      // eslint-disable-next-line no-console
      console.log(`[migration] deduped ${deleted.length} duplicate review(s), recomputed lawyer ratings`);
    }
  },

  async down() {
    // Необратимо: удалённые дубли не восстанавливаются.
  },
};
