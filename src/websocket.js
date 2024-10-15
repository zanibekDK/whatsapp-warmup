const { Server } = require('socket.io');

function setupWebSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
  });

  io.on('connection', (socket) => {
    console.log('Новое WebSocket соединение', socket.id);
    
    socket.on('requestQRCode', (sessionId) => {
      console.log(`Получен запрос на QR-код для сессии ${sessionId}`);
      // Здесь нужно вызвать функцию для генерации QR-кода
      // Например:
      // generateQRCode(sessionId);
    });

    socket.on('disconnect', (reason) => {
      console.log(`WebSocket соединение закрыто. Причина: ${reason}`, socket.id);
    });

    socket.on('error', (error) => {
      console.error('Ошибка WebSocket:', error);
    });
  });

  return io;
}

module.exports = setupWebSocket;
