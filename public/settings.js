const socket = io('http://localhost:3002', {
    withCredentials: true,
    transports: ['websocket', 'polling']
});

const settingsForm = document.getElementById('settingsForm');
const startWarmupButton = document.getElementById('startWarmup');
const stopWarmupButton = document.getElementById('stopWarmup');
const warmupInfoElement = document.getElementById('warmupInfo');
const warmupHistorySection = document.getElementById('warmupHistorySection');
const warmupHistoryElement = document.getElementById('warmupHistory');
const nextMessageInfoElement = document.getElementById('nextMessageInfo');
const warmupStatsElement = document.getElementById('warmupStats');

settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const settings = {
        intervalMin: parseInt(document.getElementById('intervalMin').value),
        intervalMax: parseInt(document.getElementById('intervalMax').value)
    };
    socket.emit('saveSettings', settings);
});

startWarmupButton.addEventListener('click', () => {
    socket.emit('startWarmup');
    warmupHistorySection.style.display = 'block';
    warmupHistoryElement.innerHTML = '';
});

stopWarmupButton.addEventListener('click', () => {
    socket.emit('stopWarmup');
    warmupHistorySection.style.display = 'none';
});

socket.on('settingsSaved', () => {
    alert('Настройки сохранены успешно');
});

socket.on('warmupStarted', () => {
    alert('Прогрев запущен');
    updateWarmupStatus(true);
});

socket.on('warmupStopped', () => {
    alert('Прогрев остановлен');
    updateWarmupStatus(false);
});

socket.on('warmupStatus', (status) => {
    updateWarmupStatus(status.isRunning);
    warmupInfoElement.innerHTML = `
        <p>Отправлено сообщений: ${status.messagesSent}</p>
        <p>Активные сессии: ${status.activeSessions}</p>
        <p>Следующее сообщение через: ${status.nextMessageIn} мин.</p>
    `;
    nextMessageInfoElement.innerHTML = `
        <p>Следующее сообщение через: ${status.nextMessageIn} мин.</p>
        <p>Предполагаемое время отправки: ${status.nextMessageTime}</p>
    `;
    warmupStatsElement.innerHTML = `
        <h3>Статистика прогрева</h3>
        <p>Всего отправлено сообщений: ${status.totalMessagesSent}</p>
        <p>Среднее количество сообщений в час: ${status.averageMessagesPerHour}</p>
        <p>Активные сессии: ${status.activeSessions}</p>
    `;
});

socket.on('newWarmupMessage', (messageData) => {
    const messageElement = document.createElement('div');
    messageElement.className = 'history-entry';
    messageElement.innerHTML = `
        <p><strong>${messageData.time}</strong>: ${messageData.from} → ${messageData.to}</p>
        <p>${messageData.message}</p>
    `;
    warmupHistoryElement.appendChild(messageElement);
    warmupHistoryElement.scrollTop = warmupHistoryElement.scrollHeight;
});

function updateWarmupStatus(isRunning) {
    startWarmupButton.disabled = isRunning;
    stopWarmupButton.disabled = !isRunning;
    warmupInfoElement.style.display = isRunning ? 'block' : 'none';
}

// Запрос текущих настроек при загрузке страницы
socket.emit('getSettings');

socket.on('settings', (settings) => {
    document.getElementById('intervalMin').value = settings.intervalMin;
    document.getElementById('intervalMax').value = settings.intervalMax;
});

socket.on('sessions', (sessions) => {
    updateSessionsList(sessions);
});

function updateSessionsList(sessions) {
    const sessionsElement = document.getElementById('sessions');
    sessionsElement.innerHTML = '';
    Object.entries(sessions).forEach(([sessionId, sessionData]) => {
        const sessionElement = document.createElement('div');
        sessionElement.className = 'session-item';
        sessionElement.innerHTML = `
            <p>Сессия ${sessionId}</p>
            <p>Номер телефона: ${sessionData.phoneNumber || 'Не подключен'}</p>
            <p>Статус: ${sessionData.status}</p>
        `;
        sessionsElement.appendChild(sessionElement);
    });
}

openWarmupHistoryButton.addEventListener('click', () => {
    warmupHistoryModal.style.display = 'block';
    socket.emit('getWarmupHistory');
});

closeWarmupHistoryModal.addEventListener('click', () => {
    warmupHistoryModal.style.display = 'none';
});

window.addEventListener('click', (event) => {
    if (event.target === warmupHistoryModal) {
        warmupHistoryModal.style.display = 'none';
    }
});

socket.on('warmupHistory', (history) => {
    warmupHistoryElement.innerHTML = history.map(entry => `
        <div class="history-entry">
            <p><strong>${entry.time}</strong>: ${entry.from} → ${entry.to}</p>
            <p>${entry.message}</p>
        </div>
    `).join('');
});
