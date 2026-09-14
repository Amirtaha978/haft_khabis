const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = [];
    for (let i = 0; i < 2; i++) {
        for (let suit of suits) {
            for (let value of values) {
                deck.push({ suit, value, id: Math.random().toString(36).substr(2, 9) });
            }
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    socket.on('createOrJoin', ({ roomId, username }) => {
        if (!roomId || !username) return socket.emit('errorMsg', 'لطفا نام و کد اتاق را وارد کنید.');
        
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                players: [],
                deck: createDeck(),
                discardPile: [],
                turnIndex: 0,
                direction: 1,
                penaltyCount: 0,
                activeSuit: null,
                started: false
            };
        }

        const room = rooms[roomId];
        if (room.started) return socket.emit('errorMsg', 'بازی در این اتاق شروع شده است.');
        if (room.players.length >= 6) return socket.emit('errorMsg', 'ظرفیت اتاق تکمیل است.');

        socket.join(roomId);
        room.players.push({ id: socket.id, username, cards: [] });
        
        socket.emit('joinSuccess');
        io.to(roomId).emit('roomUpdate', room);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.players.length < 2) return;
        room.started = true;
        room.players.forEach(p => { p.cards = room.deck.splice(0, 7); });
        let firstCard = room.deck.pop();
        while (['7', '8', '10', 'J', 'A'].includes(firstCard.value)) {
            room.deck.unshift(firstCard);
            firstCard = room.deck.pop();
        }
        room.discardPile.push(firstCard);
        room.activeSuit = firstCard.suit;
        io.to(roomId).emit('gameStarted', room);
    });

    socket.on('playCard', ({ roomId, cardId, chosenSuit }) => {
        const room = rooms[roomId];
        if (!room || !room.started) return;
        const currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== socket.id) return;
        
        const cardIndex = currentPlayer.cards.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
        const card = currentPlayer.cards[cardIndex];
        const topCard = room.discardPile[room.discardPile.length - 1];
        
        let isValid = false;
        if (room.penaltyCount > 0) {
            if (card.value === '7') isValid = true;
        } else {
            if (card.value === 'J') isValid = true;
            else if (card.suit === room.activeSuit || card.value === topCard.value) isValid = true;
        }

        if (!isValid) return socket.emit('errorMsg', 'این کارت مجاز نیست!');

        currentPlayer.cards.splice(cardIndex, 1);
        room.discardPile.push(card);
        room.activeSuit = (card.value === 'J' && chosenSuit) ? chosenSuit : card.suit;

        if (currentPlayer.cards.length === 0) {
            io.to(roomId).emit('gameOver', { winner: currentPlayer.username });
            delete rooms[roomId];
            return;
        }

        let skipTurn = false;
        if (card.value === '7') room.penaltyCount += 2;
        else if (card.value === '10') room.direction *= -1;
        else if (card.value === 'A') skipTurn = true;

        if (card.value !== '8') {
            let step = room.direction * (skipTurn ? 2 : 1);
            room.turnIndex = (room.turnIndex + step + room.players.length * 100) % room.players.length;
        }

        io.to(roomId).emit('gameStateUpdate', room);
    });

    socket.on('drawCard', (roomId) => {
        const room = rooms[roomId];
        if (!room || !room.started) return;
        const currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== socket.id) return;

        const cardsToDraw = room.penaltyCount > 0 ? room.penaltyCount : 1;
        room.penaltyCount = 0;

        for (let i = 0; i < cardsToDraw; i++) {
            if (room.deck.length === 0) {
                const top = room.discardPile.pop();
                room.deck = room.discardPile.sort(() => Math.random() - 0.5);
                room.discardPile = [top];
            }
            if (room.deck.length > 0) currentPlayer.cards.push(room.deck.pop());
        }

        room.turnIndex = (room.turnIndex + room.direction + room.players.length) % room.players.length;
        io.to(roomId).emit('gameStateUpdate', room);
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                if (room.players.length === 0) {
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit('roomUpdate', room);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
