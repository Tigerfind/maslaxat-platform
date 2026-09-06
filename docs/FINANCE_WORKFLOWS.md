# Возвраты и выплаты

## Возврат платежа Payme

Локальная отмена консультации больше не означает, что деньги уже вернулись клиенту.

1. Консультация атомарно переводится в `cancelled` или `rejected`.
2. Внутренний escrow снимается с `pendingBalance` юриста.
3. `Payment.status` остаётся `paid`, а `refundStatus` становится `requested`.
4. Возврат инициируется в Payme Business либо через официальный Subscribe API `receipts.cancel`, если получены cashbox credentials.
5. Только подтверждённый callback `CancelTransaction` переводит платёж в `refunded/completed`.

Публичная документация:

- https://developer.help.paycom.uz/metody-merchant-api/canceltransaction
- https://business.help.paycom.uz/platezhi/otmena-platezha
- https://developer.help.paycom.uz/metody-subscribe-api/receipts.cancel

До подключения Subscribe API возвраты со статусом `requested` являются очередью ручной обработки Payme Business.

## Выплата юристу

Публичного Payme API для payout физическим лицам не найдено. Поэтому используется контролируемый ручной workflow:

```text
pending → processing → paid
                    └→ failed + возврат на баланс
pending → cancelled + возврат на баланс
```

- Юрист передаёт имя владельца и только последние четыре цифры реквизитов. Полный PAN и CVV не хранятся.
- Каждый запрос имеет `Idempotency-Key`; retry не создаёт повторную заявку.
- Администратор сначала берёт заявку в обработку.
- `paid` требует уникальные ID банковской операции и reference.
- Неизвестный результат остаётся `processing`; деньги не возвращаются автоматически.
- Все переходы записываются в append-only `FinancialEvent`.

Для автоматических выплат требуется отдельный договор с лицензированным payout-провайдером и официальная спецификация API.
