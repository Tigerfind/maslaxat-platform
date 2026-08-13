import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Container, Typography } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import AmbientBackground from '../../components/GlassKit/AmbientBackground';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { axelionColors as C } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';

const DOCUMENTS = {
  ru: {
    updated: 'Редакция от 13 августа 2026 года', operator: 'Оператор: администрация платформы eMaslaXat', contact: 'Контакт: support@maslaxat.uz',
    terms: {
      title: 'Публичная оферта и условия использования',
      intro: 'Используя eMaslaXat или создавая аккаунт, пользователь принимает эти условия. Платные услуги оформляются только после отображения цены и условий оплаты.',
      sections: [
        ['1. Назначение платформы', 'eMaslaXat предоставляет техническую площадку для AI-справки, работы с документами и связи с независимыми юристами. AI-ответ является информационным и не заменяет индивидуальную юридическую консультацию.'],
        ['2. Аккаунт пользователя', 'Пользователь сообщает достоверные данные, защищает доступ к аккаунту и не передаёт его третьим лицам. Действия из аккаунта считаются совершёнными его владельцем до сообщения о компрометации.'],
        ['3. Юристы и консультации', 'Юристы оказывают услуги самостоятельно и несут ответственность за профессиональные рекомендации. Платформа проверяет заявленные документы профиля, но не гарантирует конкретный результат дела.'],
        ['4. Цена и оплата', 'Стоимость и продолжительность показываются до бронирования. Если применяется отложенное списание, оно выполняется по условиям, показанным перед подтверждением. История платежей доступна в аккаунте.'],
        ['5. Допустимое использование', 'Запрещены незаконные действия, вмешательство в работу сервиса, загрузка вредоносных файлов, выдача себя за другое лицо и распространение чужих персональных данных без основания.'],
        ['6. Ответственность', 'Платформа не отвечает за решения, принятые только на основании AI-справки, перебои внешних провайдеров и обстоятельства вне разумного контроля. Ограничение не применяется там, где ответственность обязательна по закону.'],
        ['7. Изменения условий', 'Новая редакция публикуется на этой странице. Существенные изменения сообщаются через интерфейс или email. Продолжение использования после вступления изменений в силу означает принятие новой редакции.'],
      ],
    },
    privacy: {
      title: 'Политика конфиденциальности',
      intro: 'Политика описывает обработку персональных данных пользователей eMaslaXat и применяется к сайту, кабинетам, чатам, документам и видеоконсультациям.',
      sections: [
        ['1. Какие данные обрабатываются', 'Имя, email, телефон, роль, профиль юриста, настройки, обращения, документы, сообщения, сведения о консультациях и платежных статусах. Полные реквизиты банковских карт и CVV платформа не хранит.'],
        ['2. Цели обработки', 'Регистрация и защита аккаунта, оказание услуг, бронирование, связь сторон, платежный учёт, поддержка, предотвращение мошенничества, соблюдение закона и улучшение качества сервиса.'],
        ['3. Основания', 'Обработка выполняется для исполнения пользовательского соглашения, на основании согласия, законного интереса по защите сервиса и требований применимого законодательства Республики Узбекистан.'],
        ['4. Получатели и обработчики', 'Данные передаются только в необходимом объёме поставщикам хостинга, AI, email/SMS, push, видеосвязи и платежей. Юрист получает данные, необходимые для выбранной консультации.'],
        ['5. Документы и AI', 'Загруженный документ может передаваться AI-провайдеру для запрошенного анализа. Не загружайте данные третьих лиц без законного основания. Файлы защищаются контролем доступа и удаляются по правилам хранения.'],
        ['6. Срок хранения', 'Данные хранятся пока действует аккаунт и далее в течение срока, необходимого для финансового учёта, разрешения споров и исполнения закона. Избыточные данные удаляются или обезличиваются.'],
        ['7. Права пользователя', 'Можно запросить доступ, исправление, экспорт или удаление данных, отозвать согласие и подать обращение через support@maslaxat.uz. Некоторые данные сохраняются, если этого требует закон.'],
        ['8. Безопасность', 'Используются разграничение ролей, шифрование соединения, журналирование, 2FA для привилегированных ролей и ограничение доступа к документам. Абсолютная безопасность передачи данных не может быть гарантирована.'],
      ],
    },
    refund: {
      title: 'Правила отмены и возврата',
      intro: 'Возврат зависит от состояния консультации и подтверждения платёжного провайдера. Статус заявки отображается в аккаунте.',
      sections: [
        ['1. До начала консультации', 'При отмене до начала консультации внутренний резерв снимается, а возврат ставится в очередь. Фактическое зачисление зависит от подтверждения Payme и банка пользователя.'],
        ['2. После начала', 'После фактического начала консультации автоматический полный возврат обычно недоступен. Пользователь может открыть спор, если услуга не состоялась, связь была непригодна или имело место существенное нарушение.'],
        ['3. Подтверждение провайдера', 'Статус «возврат запрошен» не означает зачисление. Возврат считается завершённым только после подтверждения Payme. Банковская обработка может занять дополнительное время.'],
        ['4. Подписки и бесплатные услуги', 'Неиспользованная платная подписка рассматривается по обращению. Использованные AI-запросы, консультации и предоставленные цифровые услуги учитываются при расчёте возможного возврата.'],
        ['5. Как подать обращение', 'Напишите на support@maslaxat.uz, укажите email аккаунта, номер консультации, сумму, дату и причину. Не отправляйте CVV, пароль или полный номер карты.'],
        ['6. Срок рассмотрения', 'Обращение регистрируется и рассматривается в разумный срок. Если требуется проверка юриста или провайдера, пользователь получает промежуточный статус.'],
      ],
    },
  },
  uz: {
    updated: '2026 йил 13 август таҳрири', operator: 'Оператор: eMaslaXat платформаси маъмурияти', contact: 'Алоқа: support@maslaxat.uz',
    terms: { title: 'Оммавий оферта ва фойдаланиш шартлари', intro: 'eMaslaXatдан фойдаланиш ёки аккаунт яратиш орқали фойдаланувчи ушбу шартларни қабул қилади.', sections: [['1. Платформа вазифаси', 'eMaslaXat AI маълумотномаси, ҳужжатлар билан ишлаш ва мустақил юристлар билан боғланиш учун техник платформа тақдим этади. AI жавоби шахсий юридик консультация ўрнини босмайди.'], ['2. Аккаунт', 'Фойдаланувчи ҳаққоний маълумот беради ва аккаунт хавфсизлигини таъминлайди.'], ['3. Юристлар', 'Юристлар хизматни мустақил кўрсатади ва ўз профессионал тавсиялари учун жавоб беради. Платформа иш натижасини кафолатламайди.'], ['4. Нарх ва тўлов', 'Нарх ва давомийлик тасдиқлашдан олдин кўрсатилади. Кечиктирилган ечиб олиш шартлари бронлаш пайтида кўрсатилади.'], ['5. Тақиқлар', 'Ноқонуний ҳаракатлар, зарарли файллар, бошқа шахс номидан фойдаланиш ва асоссиз шахсий маълумот тарқатиш тақиқланади.'], ['6. Жавобгарлик', 'Платформа фақат AI маълумоти асосида қабул қилинган қарорлар ёки ташқи провайдер узилишлари учун қонунда белгиланган чегарада жавоб бермайди.'], ['7. Ўзгаришлар', 'Янги таҳрир ушбу саҳифада эълон қилинади. Муҳим ўзгаришлар интерфейс ёки email орқали хабар қилинади.']] },
    privacy: { title: 'Махфийлик сиёсати', intro: 'Сиёсат eMaslaXatда шахсий маълумотлар қандай қайта ишланишини тушунтиради.', sections: [['1. Маълумотлар', 'Исм, email, телефон, роль, юрист профили, созламалар, мурожаатлар, ҳужжатлар, хабарлар, консультация ва тўлов ҳолатлари. Тўлиқ карта рақами ва CVV сақланмайди.'], ['2. Мақсадлар', 'Рўйхатдан ўтиш, хавфсизлик, хизмат кўрсатиш, бронлаш, алоқа, тўлов ҳисоби, қўллаб-қувватлаш ва фирибгарликдан ҳимоя.'], ['3. Асослар', 'Шартномани бажариш, розилик, хизматни ҳимоя қилиш манфаати ва Ўзбекистон қонунчилиги талаблари.'], ['4. Олувчилар', 'Маълумот зарур ҳажмда хостинг, AI, email/SMS, push, видео ва тўлов провайдерларига берилиши мумкин.'], ['5. Ҳужжатлар ва AI', 'Сўралган таҳлил учун ҳужжат AI провайдерига юборилиши мумкин. Учинчи шахс маълумотини қонуний асосисиз юкламанг.'], ['6. Сақлаш', 'Маълумот аккаунт фаоллиги ва молиявий ҳисоб, низолар ҳамда қонун талаблари учун зарур муддат давомида сақланади.'], ['7. Ҳуқуқлар', 'Маълумотга кириш, тузатиш, экспорт ёки ўчириш учун support@maslaxat.uz манзилига мурожаат қилиш мумкин.'], ['8. Хавфсизлик', 'Роллар, шифрланган алоқа, журналлар, 2FA ва ҳужжатларга кириш назорати қўлланади.']] },
    refund: { title: 'Бекор қилиш ва пул қайтариш қоидалари', intro: 'Қайтариш консультация ҳолати ва тўлов провайдери тасдиғига боғлиқ.', sections: [['1. Бошланишидан олдин', 'Консультация бошланишидан олдин бекор қилинса, ички резерв ечилади ва қайтариш навбатга қўйилади.'], ['2. Бошланганидан кейин', 'Консультация бошланганидан кейин автоматик тўлиқ қайтариш одатда мавжуд эмас. Хизмат амалга ошмаган бўлса, низо очиш мумкин.'], ['3. Провайдер тасдиғи', '«Қайтариш сўралди» ҳолати пул тушганини англатмайди. Қайтариш Payme тасдиғидан кейин якунланади.'], ['4. Обуналар', 'Фойдаланилмаган обуна мурожаат асосида кўриб чиқилади; ишлатилган хизматлар ҳисобга олинади.'], ['5. Мурожаат', 'support@maslaxat.uz га аккаунт email, консультация рақами, сумма, сана ва сабабни юборинг. CVV ёки тўлиқ карта рақамини юборманг.'], ['6. Муддат', 'Мурожаат оқилона муддатда кўриб чиқилади, зарур бўлса оралиқ ҳолат берилади.']] },
  },
  en: {
    updated: 'Effective 13 August 2026', operator: 'Operator: eMaslaXat platform administration', contact: 'Contact: support@maslaxat.uz',
    terms: { title: 'Public offer and terms of use', intro: 'By using eMaslaXat or creating an account, the user accepts these terms.', sections: [['1. Platform purpose', 'eMaslaXat provides technical tools for AI information, documents and communication with independent lawyers. AI output is informational and is not individual legal advice.'], ['2. Account', 'Users provide accurate information, protect account access and remain responsible for account activity until compromise is reported.'], ['3. Lawyers', 'Lawyers provide services independently and remain responsible for professional advice. Verification does not guarantee a specific case outcome.'], ['4. Price and payment', 'Price and duration are displayed before confirmation. Deferred charging terms are shown during booking.'], ['5. Acceptable use', 'Illegal activity, service interference, malicious files, impersonation and unlawful disclosure of personal data are prohibited.'], ['6. Liability', 'To the extent permitted by law, the platform is not liable for decisions based solely on AI information or failures of external providers.'], ['7. Changes', 'New versions are published here. Material changes are communicated through the interface or email.']] },
    privacy: { title: 'Privacy policy', intro: 'This policy explains how eMaslaXat processes personal data across the website, accounts, chats, documents and consultations.', sections: [['1. Data collected', 'Name, email, phone, role, lawyer profile, settings, support requests, documents, messages, consultations and payment statuses. Full card details and CVV are not stored.'], ['2. Purposes', 'Registration, account security, service delivery, booking, communication, payment accounting, support, fraud prevention and legal compliance.'], ['3. Legal bases', 'Contract performance, consent, legitimate security interests and applicable laws of Uzbekistan.'], ['4. Recipients', 'Necessary data may be shared with hosting, AI, email/SMS, push, video and payment providers.'], ['5. Documents and AI', 'A document may be sent to an AI provider for the requested analysis. Do not upload third-party data without a lawful basis.'], ['6. Retention', 'Data is retained while the account is active and as required for accounting, disputes and legal duties.'], ['7. User rights', 'Request access, correction, export or deletion and withdraw consent via support@maslaxat.uz.'], ['8. Security', 'Role controls, encrypted transport, logging, privileged-role 2FA and document access controls are used.']] },
    refund: { title: 'Cancellation and refund policy', intro: 'Refunds depend on consultation status and payment-provider confirmation.', sections: [['1. Before consultation', 'Cancellation before the consultation starts releases internal escrow and queues a refund. Actual crediting depends on Payme and the user bank.'], ['2. After consultation starts', 'An automatic full refund is generally unavailable after service starts. A dispute may be opened if the service did not take place or materially failed.'], ['3. Provider confirmation', '“Refund requested” does not mean credited. A refund completes only after Payme confirmation.'], ['4. Subscriptions', 'Unused paid subscriptions are reviewed on request; consumed digital services are considered in the calculation.'], ['5. Requesting a refund', 'Email support@maslaxat.uz with account email, consultation ID, amount, date and reason. Never send CVV, password or a full card number.'], ['6. Review period', 'Requests are reviewed within a reasonable period and an interim status is provided when provider checks are needed.']] },
  },
};

const LegalPage = ({ documentType }) => {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const locale = DOCUMENTS[language] || DOCUMENTS.ru;
  const document = locale[documentType] || locale.terms;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.bgCream, position: 'relative' }}>
      <AmbientBackground />
      <Box sx={{ position: 'relative', zIndex: 2 }}>
        <Box component="header" sx={{ position: 'sticky', top: 0, zIndex: 5, backdropFilter: 'blur(18px)', bgcolor: 'rgba(245,241,235,.85)', borderBottom: `1px solid ${C.borderLight}` }}>
          <Container maxWidth="md" sx={{ py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Button startIcon={<ArrowBack />} onClick={() => navigate('/')} sx={{ color: C.textDark, textTransform: 'none' }}>eMaslaXat</Button>
            <LanguageSwitcher variant="dropdown" />
          </Container>
        </Box>
        <Container maxWidth="md" sx={{ py: { xs: 5, md: 8 } }}>
          <Box sx={{ bgcolor: 'rgba(255,255,255,.78)', border: `1px solid ${C.borderLight}`, borderRadius: 3, p: { xs: 3, md: 6 }, boxShadow: '0 18px 60px rgba(61,48,35,.08)' }}>
            <Typography variant="h3" sx={{ fontSize: { xs: 26, md: 38 }, fontWeight: 300, color: C.textDark, mb: 2 }}>{document.title}</Typography>
            <Typography sx={{ color: C.textMuted, fontSize: 13 }}>{locale.updated}</Typography>
            <Typography sx={{ color: C.textMuted, fontSize: 13 }}>{locale.operator} · {locale.contact}</Typography>
            <Typography sx={{ color: C.textSecondary, lineHeight: 1.75, mt: 3, mb: 4 }}>{document.intro}</Typography>
            {document.sections.map(([title, text]) => (
              <Box key={title} component="section" sx={{ mb: 3.5 }}>
                <Typography variant="h6" sx={{ color: C.textDark, fontWeight: 500, mb: 1 }}>{title}</Typography>
                <Typography sx={{ color: C.textSecondary, lineHeight: 1.75 }}>{text}</Typography>
              </Box>
            ))}
          </Box>
        </Container>
      </Box>
    </Box>
  );
};

export default LegalPage;
