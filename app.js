require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const setupWebSocket = require('./src/websocket');
const logger = require('./src/logger');
const { saveSession, getSession, getAllSessions, getSessionsCount } = require('./src/sessionManager');
const fs = require('fs').promises;
const NodeCache = require('node-cache');

const app = express();
const server = http.createServer(app);
server.on('error', (error) => {
    console.error('Ошибка HTTP сервера:', error);
});

const io = setupWebSocket(server);

io.on('connect_error', (err) => {
  console.log('Ошибка подключения сокета:', err);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));

const clients = new Map();
const phoneNumbers = new Set();
const qrCodeCache = new NodeCache({ stdTTL: 120 });

const QR_UPDATE_INTERVAL = 20000;
const MAX_RETRIES = 3;
const MAX_SESSIONS = Infinity; // Изменим на бесконечность или большое число

let isWarmupRunning = false;

const sessionQueues = new Map();

async function initializeWhatsAppClient(sessionId, retryCount = 0) {
    logger.info(`Начало инициализации клиента WhatsApp для сессии ${sessionId}`);
    if (retryCount >= MAX_RETRIES) {
        logger.error(`Не удалось инициализировать клиент для сессии ${sessionId} после ${MAX_RETRIES} попыток`);
        return;
    }

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-extensions',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
            ],
            headless: true,
            defaultViewport: null,
        },
    });

    client.on('qr', async (qr) => {
        logger.info(`Получен QR-код для сессии ${sessionId}`);
        try {
            const qrCodeData = await qrcode.toDataURL(qr);
            qrCodeCache.set(sessionId, qrCodeData);
            io.emit('qrCode', { sessionId, qrCodeData });
            logger.info(`QR-код отправлен клиенту дл сессии ${sessionId}`);
        } catch (error) {
            logger.error(`Ошибка при генерации QR-кода для сессии ${sessionId}: ${error.message}`);
        }
    });

    client.on('ready', async () => {
        logger.info(`Клиент WhatsApp готов для сессии ${sessionId}`);
        const phoneNumber = client.info.wid.user;
        phoneNumbers.add(phoneNumber);
        io.emit('whatsappReady', { sessionId, phoneNumber });
        
        try {
            await saveSession(sessionId, { status: 'active', phoneNumber });
            updateWarmupParticipants();

            if (clients.size >= 2 && !isWarmupRunning) {
                startWarmup();
            } else if (isWarmupRunning) {
                // Добавляем новую сессию в процесс прогрева
                addSessionToWarmup(sessionId);
            }
        } catch (error) {
            logger.error(`Ошибка при сохранении сессии ${sessionId}: ${error.message}`);
        }
    });

    client.on('authenticated', () => logger.info(`WhatsApp аутентифицирован для сессии ${sessionId}`));

    client.on('auth_failure', () => {
        logger.error(`Ошибка аутентификации WhatsApp для сессии ${sessionId}`);
        clients.delete(sessionId);
        io.emit('authFailure', { sessionId });
        setTimeout(() => initializeWhatsAppClient(sessionId, retryCount + 1), 5000);
    });

    client.on('disconnected', () => {
        logger.info(`WhatsApp отключен для сессии ${sessionId}`);
        clients.delete(sessionId);
        io.emit('disconnected', { sessionId });
        setTimeout(() => initializeWhatsAppClient(sessionId, retryCount + 1), 5000);
    });

    try {
        logger.info(`Начало инициализации клиента для сессии ${sessionId}`);
        await client.initialize();
        logger.info(`Клиент успешно инициализирован для сессии ${sessionId}`);
        clients.set(sessionId, client);
    } catch (error) {
        logger.error(`Ошибка при инициализации клиента для сессии ${sessionId}: ${error.message}`);
        logger.error(error.stack);
        setTimeout(() => initializeWhatsAppClient(sessionId, retryCount + 1), 5000);
    }
}

function updateWarmupParticipants() {
    const sessions = getAllSessions();
    io.emit('sessions', sessions);
    if (warmupInterval) {
        clearInterval(warmupInterval);
        startWarmup();
    }
}

let warmupSettings = { intervalMin: 100, intervalMax: 800 };
let warmupInterval;
let warmupStatus = { isRunning: false, messagesSent: 0, activeSessions: 0, nextMessageIn: 0 };
let warmupHistory = [];

function startWarmup() {
    if (!isWarmupRunning) {
        logger.info('Начало прогрева');
        console.log('Начало прогрева');
        isWarmupRunning = true;
        warmupStatus.isRunning = true;
        warmupStatus.messagesSent = 0;
        warmupHistory = [];
        
        // Инициализация очередей сообщений для каждой сессии
        clients.forEach((client, sessionId) => {
            sessionQueues.set(sessionId, []);
            scheduleNextMessage(sessionId);
        });

        io.emit('warmupStarted');
        updateWarmupStatus();
    }
}

function addSessionToWarmup(sessionId) {
    if (isWarmupRunning && !sessionQueues.has(sessionId)) {
        sessionQueues.set(sessionId, []);
        scheduleNextMessage(sessionId);
        logger.info(`Добавлена новая сессия ${sessionId} в процесс прогрева`);
        io.emit('sessionAddedToWarmup', { sessionId });
    }
}

function scheduleNextMessage(sessionId) {
    if (isWarmupRunning && clients.has(sessionId)) {
        const interval = getRandomInterval();
        setTimeout(() => sendWarmupMessage(sessionId), interval * 1000);
    }
}

async function sendWarmupMessage(senderSessionId) {
    if (!isWarmupRunning || clients.size < 2) {
        return;
    }

    const senderClient = clients.get(senderSessionId);
    const recipientSessionId = getRandomRecipient(senderSessionId);
    const recipientSession = getSession(recipientSessionId);
    const message = getNextMessage(senderSessionId, recipientSessionId);

    try {
        const chat = await senderClient.getChatById(`${recipientSession.phoneNumber}@c.us`);
        await chat.sendMessage(message);
        logger.info(`Отправлено прогревочное сообщение из сессии ${senderSessionId} в сессию ${recipientSessionId}`);
        console.log(`Отправлено прогревочное сообщение из сессии ${senderSessionId} в сессию ${recipientSessionId}`);
        warmupStatus.messagesSent++;

        const messageData = {
            time: new Date().toLocaleString(),
            from: senderSessionId,
            to: recipientSessionId,
            message: message
        };
        
        io.emit('newWarmupMessage', messageData);
        warmupHistory.push(messageData);
        if (warmupHistory.length > 100) warmupHistory.shift();

        // Добавляем сообщение в очередь получателя
        addToQueue(recipientSessionId, senderSessionId, message);
    } catch (error) {
        logger.error(`Ошибка при отправке прогревочного сообщения: ${error.message}`);
        console.error(`Ошибка при отправке прогревочного сообщения: ${error.message}`);
    }

    updateWarmupStatus();
    scheduleNextMessage(senderSessionId);
}

function getRandomRecipient(senderSessionId) {
    const activeSessions = Array.from(clients.keys()).filter(id => id !== senderSessionId);
    return activeSessions[Math.floor(Math.random() * activeSessions.length)];
}

function getNextMessage(senderSessionId, recipientSessionId) {
    const queue = sessionQueues.get(senderSessionId);
    if (queue.length > 0 && queue[0].from === recipientSessionId) {
        // Отвечаем на предыдущее сообщение
        const prevMessage = queue.shift();
        return generateReply(prevMessage.message);
    } else {
        // Отправляем новое сообщение
        return getRandomMessage();
    }
}

function addToQueue(sessionId, fromSessionId, message) {
    const queue = sessionQueues.get(sessionId);
    queue.push({ from: fromSessionId, message: message });
    if (queue.length > 5) queue.shift(); // Ограничиваем размер очереди
}

function generateReply(message) {
    // Здесь можно реализовать более сложную логику генерации ответов
    const replies = [
        "Да, согласен с тобой.",
        "Интересная мысль!",
        "Не совсем понял, можешь объяснить подробнее?",
        "Спасибо за информацию!",
        "Хорошо, давай обсудим это позже."
    ];
    return replies[Math.floor(Math.random() * replies.length)];
}

function updateWarmupStatus() {
    const now = new Date();
    const nextMessageTime = new Date(now.getTime() + warmupStatus.nextMessageIn * 60000);
    
    warmupStatus.activeSessions = clients.size;
    warmupStatus.nextMessageTime = nextMessageTime.toLocaleString();
    warmupStatus.totalMessagesSent = warmupHistory.length;
    warmupStatus.averageMessagesPerHour = calculateAverageMessagesPerHour();
    
    io.emit('warmupStatus', warmupStatus);
    console.log('Обновление статуса прогрева:', warmupStatus);
}

function calculateAverageMessagesPerHour() {
    if (warmupHistory.length < 2) return 0;
    const firstMessage = new Date(warmupHistory[0].time);
    const lastMessage = new Date(warmupHistory[warmupHistory.length - 1].time);
    const hoursDiff = (lastMessage - firstMessage) / (1000 * 60 * 60);
    return (warmupHistory.length / hoursDiff).toFixed(2);
}

function getRandomInterval() {
    return Math.floor(Math.random() * (warmupSettings.intervalMax - warmupSettings.intervalMin + 1) + warmupSettings.intervalMin);
}

function getRandomPair(array) {
    const index1 = Math.floor(Math.random() * array.length);
    let index2;
    do {
        index2 = Math.floor(Math.random() * array.length);
    } while (index2 === index1);
    return [array[index1], array[index2]];
}

async function loadMessages() {
    try {
        const data = await fs.readFile(path.join(__dirname, 'dataset.txt'), 'utf8');
        return data.split('\n').filter(line => line.trim() !== '');
    } catch (error) {
        logger.error('Ошибка при загрузке сообщений:', error);
        return [];
    }
}

let messages = [];
loadMessages().then(loadedMessages => messages = loadedMessages);

function getRandomMessage() {
    return messages[Math.floor(Math.random() * messages.length)];
}

io.on('connection', (socket) => {
    logger.info('Новое WebSocket соединение');

    socket.on('requestSessions', () => {
        const sessions = getAllSessions();
        socket.emit('sessions', sessions);
        
        // Всегда отправляем QR-код для новой сессии
        const newSessionId = `session_${Object.keys(sessions).length + 1}`;
        initializeWhatsAppClient(newSessionId);
    });

    socket.on('requestQRCode', (sessionId) => {
        if (clients.has(sessionId)) {
            const client = clients.get(sessionId);
            if (client.pupPage) {
                client.pupPage.evaluate(() => {
                    if (window.Store && window.Store.Conn) {
                        window.Store.Conn.generateNewQRCode();
                    }
                }).catch(error => {
                    logger.error(`Ошибка при запросе QR-кода для сессии ${sessionId}: ${error.message}`);
                });
            }
        } else {
            initializeWhatsAppClient(sessionId);
        }
    });

    socket.on('sendTestMessage', async ({ sessionId, phoneNumber, message }) => {
        if (clients.has(sessionId)) {
            const client = clients.get(sessionId);
            try {
                const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
                await client.sendMessage(chatId, message);
                socket.emit('messageSent', { sessionId, success: true });
            } catch (error) {
                logger.error(`Ошибка при отправке сообщения: ${error.message}`);
                socket.emit('messageSent', { sessionId, success: false, error: error.message });
            }
        } else {
            socket.emit('messageSent', { sessionId, success: false, error: 'Сессия не найдена' });
        }
    });

    socket.on('saveSettings', (settings) => {
        warmupSettings = settings;
        socket.emit('settingsSaved');
    });

    socket.on('getSettings', () => socket.emit('settings', warmupSettings));

    socket.on('stopWarmup', () => {
        if (isWarmupRunning) {
            isWarmupRunning = false;
            warmupStatus.isRunning = false;
            socket.emit('warmupStopped');
            updateWarmupStatus();
        }
    });

    socket.on('getMessageTemplates', () => socket.emit('messageTemplates', messages));

    socket.on('saveMessageTemplate', async (template) => {
        messages.push(template);
        await fs.appendFile(path.join(__dirname, 'dataset.txt'), '\n' + template);
        io.emit('messageTemplates', messages);
    });

    socket.on('deleteMessageTemplate', async (index) => {
        messages.splice(index, 1);
        await fs.writeFile(path.join(__dirname, 'dataset.txt'), messages.join('\n'));
        io.emit('messageTemplates', messages);
    });

    socket.on('getMessages', () => socket.emit('messages', messages));

    socket.on('getWarmupHistory', () => socket.emit('warmupHistory', warmupHistory));
});

const PORT = process.env.PORT || 3002;

server.listen(PORT, () => {
    logger.info(`Сервер запущен на порту ${PORT}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

initializeWhatsAppClient('session_1');