const logger = require('./logger');

// Временное хранилище сессий в памяти (не рекомендуется для продакшена)
const sessions = new Map();

async function saveSession(sessionId, sessionData) {
  try {
    sessions.set(sessionId, sessionData);
    logger.info(`Сессия сохранена: ${sessionId}`);
  } catch (error) {
    logger.error(`Ошибка при сохранении сессии: ${error.message}`);
    throw error;
  }
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function getAllSessions() {
  return Object.fromEntries(sessions);
}

function getSessionsCount() {
  return sessions.size;
}

module.exports = { saveSession, getSession, getAllSessions, getSessionsCount };
