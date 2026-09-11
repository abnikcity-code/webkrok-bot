// WEBKROK Telegram bot — webhook-обробник для Vercel (Node.js serverless function)
//
// Логіка: меню-кнопки, без вільного ІІ-діалогу. Кожен крок кодує попередній
// вибір прямо в callback_data, тому окрема база даних для MVP не потрібна.
// Виняток — момент збору контакту: там використовується проста in-memory
// мапа (сесія живе, поки функція "тепла"). Для перших заявок цього досить;
// якщо навантаження зросте — легко перенести на Vercel KV/Upstash або на ту
// саму Neon Postgres, що вже використовується в ig-catalog-builder.

const BOT_TOKEN = process.env.BOT_TOKEN; // клієнтський бот (WebkrokBot)
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN; // бот-сповіщувач (MYwebkrokBot)
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // твій особистий chat_id
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const ADMIN_API = `https://api.telegram.org/bot${ADMIN_BOT_TOKEN}`;

async function tgAdmin(method, payload) {
  const res = await fetch(`${ADMIN_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// сесії: chat_id -> { service, q1, q2 }
const sessions = new Map();

const SERVICES = {
  website: {
    label: '🌐 Сайт / каталог товарів',
    summary: 'Сайт або каталог товарів',
  },
  landing: {
    label: '📱 Landing Page для Instagram/TikTok',
    summary: 'Landing Page для Instagram/TikTok',
  },
  sheets: {
    label: '📊 Каталог на Google Таблицях',
    summary: 'Каталог на Google Таблицях',
  },
  complex: {
    label: '🚀 Комплекс: від реклами до замовлення',
    summary: 'Комплекс "від реклами до замовлення"',
  },
};

async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: SERVICES.website.label, callback_data: 'svc:website' }],
      [{ text: SERVICES.landing.label, callback_data: 'svc:landing' }],
      [{ text: SERVICES.sheets.label, callback_data: 'svc:sheets' }],
      [{ text: SERVICES.complex.label, callback_data: 'svc:complex' }],
    ],
  };
}

function q1Keyboard(svc) {
  return {
    inline_keyboard: [
      [
        { text: 'Так, є', callback_data: `q1:${svc}:yes` },
        { text: 'Ще немає', callback_data: `q1:${svc}:no` },
      ],
    ],
  };
}

function q2Keyboard(svc, q1) {
  return {
    inline_keyboard: [
      [{ text: 'До 50 товарів', callback_data: `q2:${svc}:${q1}:small` }],
      [{ text: '50–200 товарів', callback_data: `q2:${svc}:${q1}:medium` }],
      [{ text: '200+ товарів', callback_data: `q2:${svc}:${q1}:large` }],
      [{ text: 'Не про товари / інше', callback_data: `q2:${svc}:${q1}:other` }],
    ],
  };
}

const SIZE_LABELS = {
  small: 'до 50 товарів',
  medium: '50–200 товарів',
  large: '200+ товарів',
  other: 'не про товари / інше',
};

// приклади кейсів під кожну послугу — заміни на свої посилання/фото пізніше
const CASE_EXAMPLES = {
  website: 'Приклад: каталог TYOMKA.UA — https://tyomka-catalog.vercel.app',
  landing: 'Приклад: лендінг для триколісного велосипеда tyomka.ua',
  sheets: 'Приклад: каталог, який синхронізується з Google Таблицею в реальному часі',
  complex: 'Приклад: реклама → лендінг → Telegram-бот замовлень (весь шлях клієнта)',
};

function contactRequestKeyboard() {
  return {
    keyboard: [
      [{ text: '📞 Поділитись номером', request_contact: true }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

async function handleStart(chatId) {
  sessions.delete(chatId);
  await tg('sendMessage', {
    chat_id: chatId,
    text: '👋 Привіт! Я бот WEBKROK — розкажу про послуги і зберу заявку.\n\nЩо вас цікавить?',
    reply_markup: mainMenuKeyboard(),
  });
}

async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const [step, ...rest] = data.split(':');

  if (step === 'svc') {
    const svc = rest[0];
    sessions.set(chatId, { service: svc });
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: `Обрано: ${SERVICES[svc].summary}\n\nЧи є у вас вже сайт/каталог?`,
      reply_markup: q1Keyboard(svc),
    });
  } else if (step === 'q1') {
    const [svc, answer] = rest;
    const session = sessions.get(chatId) || { service: svc };
    session.q1 = answer;
    sessions.set(chatId, session);
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: 'Приблизний обсяг / формат проєкту?',
      reply_markup: q2Keyboard(svc, answer),
    });
  } else if (step === 'q2') {
    const [svc, q1, size] = rest;
    const session = sessions.get(chatId) || { service: svc };
    session.q1 = q1;
    session.q2 = size;
    sessions.set(chatId, session);

    await tg('editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: `${CASE_EXAMPLES[svc]}\n\nЗалиште номер — і я передам заявку Антону, він зв'яжеться з вами:`,
    });
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Натисніть кнопку нижче, щоб поділитись номером 👇',
      reply_markup: contactRequestKeyboard(),
    });
  }

  await tg('answerCallbackQuery', { callback_query_id: query.id });
}

async function handleContact(message) {
  const chatId = message.chat.id;
  const session = sessions.get(chatId);
  const contact = message.contact;
  const fromName = [message.from.first_name, message.from.last_name].filter(Boolean).join(' ');

  const summaryLines = [
    '📩 Нова заявка з WEBKROK-бота',
    '',
    `Ім'я: ${fromName || '—'}`,
    `Телефон: ${contact.phone_number}`,
  ];

  if (session) {
    summaryLines.push(`Послуга: ${SERVICES[session.service]?.summary || session.service}`);
    if (session.q1) summaryLines.push(`Вже є сайт/каталог: ${session.q1 === 'yes' ? 'так' : 'ще немає'}`);
    if (session.q2) summaryLines.push(`Обсяг: ${SIZE_LABELS[session.q2] || session.q2}`);
  } else {
    summaryLines.push('(деталі вибору не збереглися — сесія втрачена, уточнити вручну)');
  }

  if (ADMIN_CHAT_ID && ADMIN_BOT_TOKEN) {
    await tgAdmin('sendMessage', {
      chat_id: ADMIN_CHAT_ID,
      text: summaryLines.join('\n'),
    });
  }

  await tg('sendMessage', {
    chat_id: chatId,
    text: 'Дякую! Заявку передано Антону — він зв\'яжеться з вами найближчим часом. 🙌',
    reply_markup: { remove_keyboard: true },
  });

  sessions.delete(chatId);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('WEBKROK bot webhook is running');
    return;
  }

  const update = req.body;

  try {
    if (update.message?.text === '/start') {
      await handleStart(update.message.chat.id);
    } else if (update.message?.contact) {
      await handleContact(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }

  res.status(200).send('ok');
}
