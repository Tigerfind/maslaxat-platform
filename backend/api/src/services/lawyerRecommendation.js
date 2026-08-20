const RECOMMENDATION_WEIGHTS = Object.freeze({
  verifiedDocuments: 25,
  description: 10,
  schedule: 15,
  specializations: 10,
  price: 5,
  experience: 15,
  reviewRating: 15,
  reviewPresence: 5,
});

// Доверие и возможность реально записаться весят больше декоративной полноты.
// Стаж и отзывы ограничены сверху, чтобы один старый профиль не закрепился первым
// навсегда, а новые качественно заполненные юристы сохраняли шанс на показы.
function recommendedScoreSql() {
  const w = RECOMMENDATION_WEIGHTS;
  return `(
    CASE WHEN EXISTS (
      SELECT 1 FROM lawyer_documents d
      WHERE d.user_id = "User"."id" AND d.verified_at IS NOT NULL
        AND d.type IN ('diploma', 'license', 'certificate', 'id')
    ) THEN ${w.verifiedDocuments} ELSE 0 END
    + CASE WHEN char_length(btrim(COALESCE("profile"."description", ''))) >= 50 THEN ${w.description} ELSE 0 END
    + CASE WHEN COALESCE((
      SELECT SUM(CASE
        WHEN entry.value->>'enabled' = 'true'
          AND entry.value->>'from' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          AND entry.value->>'to' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          AND (entry.value->>'to')::time > (entry.value->>'from')::time
        THEN FLOOR(EXTRACT(EPOCH FROM ((entry.value->>'to')::time - (entry.value->>'from')::time)) / 1800)
        ELSE 0 END)
      FROM jsonb_each(CASE WHEN jsonb_typeof("profile"."schedule") = 'object' THEN "profile"."schedule" ELSE '{}'::jsonb END) entry
    ), 0) >= 3 THEN ${w.schedule} ELSE 0 END
    + CASE WHEN EXISTS (
      SELECT 1 FROM unnest(COALESCE("profile"."specializations", ARRAY[]::varchar[])) spec
      WHERE btrim(spec) <> '' AND spec NOT IN ('Не указана', 'Общее право', 'General law', 'Umumiy huquq')
    ) THEN ${w.specializations} ELSE 0 END
    + CASE WHEN COALESCE("profile"."price", 0) >= 50000 THEN ${w.price} ELSE 0 END
    + LEAST(GREATEST(COALESCE("profile"."experience", 0), 0), ${w.experience})
    + COALESCE((
      SELECT LEAST(AVG(r.rating) * ${w.reviewRating / 5}, ${w.reviewRating})
      FROM reviews r WHERE r.lawyer_id = "User"."id" AND r.is_hidden = false
    ), 0)
    + CASE WHEN EXISTS (
      SELECT 1 FROM reviews r WHERE r.lawyer_id = "User"."id" AND r.is_hidden = false
    ) THEN ${w.reviewPresence} ELSE 0 END
  )`;
}

module.exports = { RECOMMENDATION_WEIGHTS, recommendedScoreSql };
