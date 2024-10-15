const socket = io('http://localhost:3002', {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
});

const qrCodeElement = document.getElementById('qrCode');
const statusElement = document.getElementById('status');
const sessionsElement = document.getElementById('sessions');

socket.on('connect', () => {
    console.log('Подключено к серверу', socket.id);
    socket.emit('requestSessions');
});

socket.on('connect_error', (error) => {
    console.error('Ошибка подключения:', error);
});

socket.on('disconnect', (reason) => {
    console.log('Отключено от сервера. Причина:', reason);
});

socket.on('sessions', (sessions) => {
    updateSessionsList(sessions);
});

socket.on('qrCode', ({ sessionId, qrCodeData }) => {
    console.log(`Получен QR-код для сессии ${sessionId}`);
    if (qrCodeData) {
        console.log('QR-код данные получены, обновление изображения');
        updateQRCode(qrCodeData);
    } else {
        console.error('Получены пустые данные QR-кода');
    }
    statusElement.textContent = `Отсканируйте QR-код для подключения WhatsApp (Сессия ${sessionId})`;
    statusElement.className = 'status pending';
});

socket.on('whatsappReady', ({ sessionId }) => {
    console.log(`WhatsApp готов к использованию для сессии ${sessionId}`);
    qrCodeElement.innerHTML = '<i class="fas fa-check-circle" style="font-size: 100px; color: #25D366;"></i>';
    statusElement.textContent = `WhatsApp подключен и готов к использованию (Сессия ${sessionId})`;
    statusElement.className = 'status success';
    socket.emit('requestSessions');
});

socket.on('error', (errorMessage) => {
    console.error('Ошибка:', errorMessage);
    statusElement.textContent = 'Ошибка: ' + errorMessage;
    statusElement.className = 'status error';
});

socket.on('authFailure', ({ sessionId }) => {
    console.error(`Ошибка аутентификации для сессии ${sessionId}`);
    updateSessionStatus(sessionId, 'Ошибка аутентификации');
});

socket.on('disconnected', ({ sessionId }) => {
    console.log(`Сессия ${sessionId} отключена`);
    updateSessionStatus(sessionId, 'Отключена');
});

socket.on('warmupStarted', () => {
    console.log('Прогрев запущен автоматически');
    logToConsole('Прогрев запущен автоматически');
    updateWarmupStatus(true);
});

socket.on('warmupStatus', (status) => {
    updateWarmupStatus(status.isRunning);
    const warmupInfoElement = document.getElementById('warmupInfo');
    if (warmupInfoElement) {
        warmupInfoElement.innerHTML = `
            <p>Прогрев активен</p>
            <p>Отправлено сообщений: ${status.messagesSent}</p>
            <p>Активные сессии: ${status.activeSessions}</p>
            <p>Следующее сообщение через: ${status.nextMessageIn} мин.</p>
        `;
    }
    logToConsole(`Обновление статуса прогрева: Отправлено ${status.messagesSent} сообщений, Активные сессии: ${status.activeSessions}`);
});

socket.on('newWarmupMessage', (messageData) => {
    console.log('Новое сообщение прогрева:', messageData);
    logToConsole(`Новое сообщение: ${messageData.from} → ${messageData.to}: ${messageData.message}`);
});

socket.on('warmupReady', () => {
    console.log('Прогрев готов к запуску');
    const startWarmupButton = document.createElement('button');
    startWarmupButton.textContent = 'Начать прогрев';
    startWarmupButton.className = 'btn start-warmup';
    startWarmupButton.addEventListener('click', () => {
        socket.emit('startWarmup');
    });
    document.body.appendChild(startWarmupButton);
});

socket.on('warmupNotReady', () => {
    console.log('Недостаточно активных сессий для начала прогрева');
    alert('Для начала прогрева необходимо минимум 2 активные сессии');
});

function updateQRCode(qrCodeData) {
    console.time('updateQRCode');
    qrCodeElement.innerHTML = '';
    const img = document.createElement('img');
    img.src = qrCodeData;
    img.onload = () => {
        console.log('QR-код успешно загружен');
        console.timeEnd('updateQRCode');
    };
    img.onerror = (e) => console.error('Ошибка при загрузке изображения QR-кода', e);
    qrCodeElement.appendChild(img);
}

function updateSessionsList(sessions) {
    sessionsElement.innerHTML = '';
    Object.entries(sessions).forEach(([sessionId, sessionData]) => {
        const sessionElement = document.createElement('div');
        sessionElement.className = 'session-item';
        sessionElement.innerHTML = `
            <p>Сессия ${sessionId}</p>
            <p>Номер телефона: ${sessionData.phoneNumber || 'Не подключен'}</p>
            <p>Статус: ${getStatusText(sessionData.status)}</p>
        `;
        sessionsElement.appendChild(sessionElement);
    });
}

function getStatusClass(status) {
    if (typeof status !== 'string') {
        console.warn('Unexpected status type:', status);
        return '';
    }
    switch (status.toLowerCase()) {
        case 'active':
            return 'success';
        case 'pending':
            return 'pending';
        case 'disconnected':
            return 'error';
        default:
            return '';
    }
}

function getStatusText(status) {
    if (typeof status !== 'string') {
        console.warn('Unexpected status type:', status);
        return 'Неизвестно';
    }
    switch (status.toLowerCase()) {
        case 'active':
            return 'Активна';
        case 'pending':
            return 'Ожидание';
        case 'disconnected':
            return 'Отключена';
        default:
            return status;
    }
}

function updateSessionStatus(sessionId, status) {
    const sessionElement = document.querySelector(`.session-item[data-session-id="${sessionId}"]`);
    if (sessionElement) {
        const statusElement = sessionElement.querySelector('.status');
        statusElement.textContent = status;
        statusElement.className = `status ${getStatusClass(status)}`;
    }
}

socket.on('messageSent', ({ sessionId, success, error }) => {
    if (success) {
        alert(`Сообщение успешно отправлено для сессии ${sessionId}`);
    } else {
        alert(`Ошибка при отправке сообщения для сессии ${sessionId}: ${error}`);
    }
});

console.log('Страница загружена, ожидание подключения к серверу');

// Добавьте это в конец файла
console.log('Запрос на получение QR-кода');
socket.emit('requestQRCode', 'session_1');

const consoleElement = document.getElementById('console');

function logToConsole(message) {
    const logEntry = document.createElement('div');
    logEntry.className = 'console-entry';
    const time = new Date().toLocaleTimeString();
    logEntry.innerHTML = `<span class="console-time">[${time}]</span> <span class="console-message">${message}</span>`;
    consoleElement.appendChild(logEntry);
    consoleElement.scrollTop = consoleElement.scrollHeight;
}

function updateDialogView(messageData) {
    const dialogContainer = document.getElementById('dialogContainer');
    if (!dialogContainer) {
        const container = document.createElement('div');
        container.id = 'dialogContainer';
        container.style.maxHeight = '300px';
        container.style.overflowY = 'auto';
        container.style.border = '1px solid #ccc';
        container.style.padding = '10px';
        container.style.marginTop = '20px';
        document.body.appendChild(container);
    }

    const messageElement = document.createElement('div');
    messageElement.innerHTML = `<strong>${messageData.from} → ${messageData.to}:</strong> ${messageData.message}`;
    dialogContainer.appendChild(messageElement);
    dialogContainer.scrollTop = dialogContainer.scrollHeight;
}

socket.on('sessionAddedToWarmup', ({ sessionId }) => {
    console.log(`Сессия ${sessionId} добавлена в процесс прогрева`);
    logToConsole(`Сессия ${sessionId} добавлена в процесс прогрева`);
});
