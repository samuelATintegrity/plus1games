// Real Session class that wraps PartySocket. Returned by every connection
// type in this folder. Game code talks to this — never to PartySocket directly.
//
// Events:
//   'open'         — connected to the room
//   'hello'        — server hello with { yourId, players }
//   'player-join'  — another player joined { playerId }
//   'player-leave' — another player left { playerId }
//   'matched'      — Open Match found you a partner { playRoomId, gameId }
//   'message'      — peer sent a payload { from, data }
//   'close'        — connection closed

import PartySocket from 'partysocket';

const HOST = import.meta.env.VITE_PARTYKIT_HOST || '127.0.0.1:1999';

export class Session {
  constructor(type, room, meta = {}) {
    this.type = type;
    this.room = room;
    this.meta = meta;
    this.id = null;
    this.players = [];
    this.listeners = {};
    this.socket = new PartySocket({ host: HOST, room });

    this.socket.addEventListener('open', () => this.emit('open'));
    this.socket.addEventListener('close', () => this.emit('close'));
    this.socket.addEventListener('message', (e) => {
      const msg = safeParse(e.data);
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'hello':
          this.id = msg.yourId;
          this.players = msg.players || [];
          this.emit('hello', msg);
          break;
        case 'player-join':
          if (!this.players.includes(msg.playerId)) this.players.push(msg.playerId);
          this.emit('player-join', msg);
          break;
        case 'player-leave':
          this.players = this.players.filter((p) => p !== msg.playerId);
          this.emit('player-leave', msg);
          break;
        case 'matched':
          this.emit('matched', msg);
          break;
        case 'message':
          this.emit('message', msg);
          break;
        default:
          this.emit(msg.type, msg);
      }
    });
  }

  on(event, cb) {
    (this.listeners[event] ||= []).push(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    this.listeners[event] = (this.listeners[event] || []).filter((c) => c !== cb);
  }

  emit(event, ...args) {
    (this.listeners[event] || []).forEach((cb) => cb(...args));
  }

  send(data) {
    this.socket.send(JSON.stringify(data));
  }

  close() {
    this.socket.close();
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
