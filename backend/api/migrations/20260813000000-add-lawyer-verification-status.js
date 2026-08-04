'use strict';

/**
 * Модерация юриста админом — отдельно от User.isVerified (тот про подтверждение email).
 * Добавляет на lawyer_profiles:
 *   - verification_status ENUM('pending','approved','rejected') DEFAULT 'pending'
 *   - rejection_reason    TEXT (причина отклонения, показывается юристу)
 *
 * Бэкофилл: ранее подтверждённые юристы (users.is_verified = true) → 'approved',
 * иначе остались бы 'pending' и пропали из каталога после ввода поля.
 *
 * Идемпотентно: колонки добавляются только если их ещё нет; бэкофилл затрагивает
 * лишь строки, оставшиеся 'pending' у is_verified-юристов (повторный прогон = no-op).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('lawyer_profiles');

    if (!table.verification_status) {
      await queryInterface.addColumn('lawyer_profiles', 'verification_status', {
        type: Sequelize.ENUM('pending', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      });
    }
    if (!table.rejection_reason) {
      await queryInterface.addColumn('lawyer_profiles', 'rejection_reason', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    // Бэкофилл: кто уже был подтверждён — оставляем видимым (approved).
    await queryInterface.sequelize.query(`
      UPDATE lawyer_profiles p
      SET verification_status = 'approved'
      FROM users u
      WHERE p.user_id = u.id
        AND u.is_verified = true
        AND p.verification_status = 'pending'
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('lawyer_profiles');
    if (table.rejection_reason) {
      await queryInterface.removeColumn('lawyer_profiles', 'rejection_reason');
    }
    if (table.verification_status) {
      await queryInterface.removeColumn('lawyer_profiles', 'verification_status');
    }
    // Убираем ENUM-тип, созданный Postgres под колонку (иначе повторный up упадёт).
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_lawyer_profiles_verification_status"'
    );
  },
};
