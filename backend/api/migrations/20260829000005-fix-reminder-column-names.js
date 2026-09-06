'use strict';

module.exports = {
  async up(queryInterface) {
    let columns = await queryInterface.describeTable('consultations');
    if (columns.reminder_24_sent && !columns.reminder24_sent) {
      await queryInterface.renameColumn('consultations', 'reminder_24_sent', 'reminder24_sent');
    }
    columns = await queryInterface.describeTable('consultations');
    if (columns.reminder_10_sent && !columns.reminder10_sent) {
      await queryInterface.renameColumn('consultations', 'reminder_10_sent', 'reminder10_sent');
    }
  },
  async down() { throw new Error('Forward-only migration: reminder column names'); },
};
