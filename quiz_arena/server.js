const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mainQuestions = require('./questions');
const easyQuestions = require('./easy-questions').map((q, i) => ({ ...q, id: q.id || `easy${i+1}` }));
// Junta os dois bancos e remove perguntas repetidas pelo enunciado normalizado.
const seenQuestionTexts = new Set();
const questions = [...mainQuestions, ...easyQuestions].filter(q => {
  const key = String(q.text || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!key || seenQuestionTexts.has(key)) return false;
  seenQuestionTexts.add(key);
  return Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length;
});
const app = express(); const server = http.createServer(app); const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
const rooms = new Map(); const MAX_PLAYERS = 8; const MIN_PLAYERS = 2; const quickQueue = [];
const HISTORY_FILE = path.join(__dirname, 'question-history.json');
const HISTORY_LIMIT = 350;
let history = [];
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); if (!Array.isArray(history)) history = []; } catch { history = []; }
function saveHistory() { try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-HISTORY_LIMIT), null, 2)); } catch (e) { console.error('Não foi possível salvar o histórico:', e.message); } }
const ALLOWED_AVATARS=new Set(['🦊','🐼','🐸','🦁','🐙','🐯','🐨','🐲','🦉','🐵','🦄','🐧']);
function validAvatar(value) { return ALLOWED_AVATARS.has(value) ? value : '🦊'; }
function code() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function shuffle(arr) { const a = [...arr]; for (let i=a.length-1;i>0;i--) { const j=crypto.randomInt(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function publicRoom(room) { return { code:room.code, hostId:room.hostId, status:room.status, players:[...room.players.values()].map(p=>({id:p.id,name:p.name,avatar:p.avatar,score:p.score,answered:p.answered,isHost:p.id===room.hostId,correct:p.correct,wrong:p.wrong,unanswered:p.unanswered})), questionIndex:room.questionIndex, totalQuestions:room.questionCount, questionCount:room.questionCount, durationSeconds:room.durationSeconds }; }
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function stopTimer(room) { if(room.timer) clearTimeout(room.timer); room.timer=null; }
function selectQuestions(count) {
  const recent = new Set(history.slice(-HISTORY_LIMIT));
  const fresh = questions.filter(q => !recent.has(q.id));
  const older = questions.filter(q => recent.has(q.id));
  const pool = fresh.length >= count ? fresh : [...fresh, ...shuffle(older)];

  // Embaralha dentro de cada categoria e intercala categorias para evitar blocos previsíveis.
  const buckets = new Map();
  for (const q of shuffle(pool)) {
    if (!buckets.has(q.category)) buckets.set(q.category, []);
    buckets.get(q.category).push(q);
  }
  const selected = [];
  let lastCategory = null;
  while (selected.length < count) {
    let categories = shuffle([...buckets.keys()].filter(category => buckets.get(category).length));
    if (categories.length > 1 && categories[0] === lastCategory) {
      [categories[0], categories[1]] = [categories[1], categories[0]];
    }
    if (!categories.length) break;
    for (const category of categories) {
      if (selected.length >= count) break;
      const q = buckets.get(category).pop();
      selected.push(q);
      lastCategory = category;
    }
  }

  history.push(...selected.map(q => q.id));
  history = history.slice(-HISTORY_LIMIT);
  saveHistory();

  // Também muda a posição das alternativas em toda partida, mantendo a resposta correta.
  return selected.map(q => {
    const order = shuffle(q.options.map((_, i) => i));
    return { ...q, options: order.map(i => q.options[i]), answer: order.indexOf(q.answer) };
  });
}
function sendQuestion(room) {
  stopTimer(room);
  if(room.questionIndex>=room.questionCount) return finishGame(room);
  room.status='playing'; room.questionStartedAt=Date.now();
  room.players.forEach(p=>{p.answered=false;p.lastAnswer=null;});
  const q=room.questions[room.questionIndex]; const roundMs=room.durationSeconds*1000;
  io.to(room.code).emit('game:question',{index:room.questionIndex+1,total:room.questionCount,category:q.category,text:q.text,options:q.options,duration:room.durationSeconds,endsAt:room.questionStartedAt+roundMs});
  emitRoom(room); room.timer=setTimeout(()=>revealAnswer(room,true),roundMs);
}
function revealAnswer(room,timedOut=false) {
  if(!room||room.status!=='playing') return; stopTimer(room); const q=room.questions[room.questionIndex]; room.status='reveal';
  room.players.forEach(p=>{if(!p.answered){p.unanswered++;p.answered=true;}});
  io.to(room.code).emit('game:reveal',{correctIndex:q.answer,explanation:q.explanation,timedOut,leaderboard:[...room.players.values()].sort((a,b)=>b.score-a.score).map(p=>({id:p.id,name:p.name,score:p.score}))});
  emitRoom(room); room.timer=setTimeout(()=>{room.questionIndex++;sendQuestion(room);},3000);
}
function finishGame(room) {
  stopTimer(room); room.status='finished';
  const leaderboard=[...room.players.values()].sort((a,b)=>b.score-a.score||b.correct-a.correct).map((p,i)=>({id:p.id,name:p.name,avatar:p.avatar,score:p.score,correct:p.correct,wrong:p.wrong,unanswered:p.unanswered,place:i+1}));
  io.to(room.code).emit('game:finished',{leaderboard,totalQuestions:room.questionCount}); emitRoom(room);
  room.timer=setTimeout(()=>{
    if(!rooms.has(room.code)||room.status!=='finished') return;
    room.status='lobby'; room.questionIndex=0; room.questions=[]; room.questionStartedAt=null; room.timer=null;
    room.players.forEach(p=>{p.answered=false;p.lastAnswer=null;});
    io.to(room.code).emit('room:return-lobby',publicRoom(room)); emitRoom(room);
  },8000);
}
function validSettings(data) { const n=Number(data?.questionCount); const t=Number(data?.durationSeconds); return { questionCount:Number.isInteger(n)?Math.max(10,Math.min(50,n)):20, durationSeconds:[15,20,25].includes(t)?t:20 }; }
io.on('connection',socket=>{
  socket.on('match:find',({name,avatar},cb)=>{
    name=String(name||'').trim().slice(0,18); avatar=validAvatar(avatar);
    if(!name)return cb?.({error:'Escolha um apelido antes de continuar.'});
    if(socket.data.roomCode)return cb?.({error:'Você já está em uma sala.'});
    const existing=quickQueue.findIndex(item=>item.socketId===socket.id);
    if(existing>=0)quickQueue.splice(existing,1);
    let opponent=null;
    while(quickQueue.length&&!opponent){const candidate=quickQueue.shift();const peer=io.sockets.sockets.get(candidate.socketId);if(peer&&peer.connected&&!peer.data.roomCode)opponent={socket:peer,profile:candidate};}
    if(!opponent){quickQueue.push({socketId:socket.id,name,avatar});socket.data.quickQueued=true;socket.emit('match:waiting');return cb?.({waiting:true});}
    const peer=opponent.socket;
    const roomCode=code();
    const room={code:roomCode,hostId:peer.id,players:new Map(),status:'lobby',questionIndex:0,questionCount:10,durationSeconds:20,questions:[],timer:null,questionStartedAt:null,quickMatch:true};
    room.players.set(peer.id,{id:peer.id,name:opponent.profile.name,avatar:opponent.profile.avatar,score:0,answered:false,lastAnswer:null,correct:0,wrong:0,unanswered:0});
    room.players.set(socket.id,{id:socket.id,name,avatar,score:0,answered:false,lastAnswer:null,correct:0,wrong:0,unanswered:0});
    rooms.set(roomCode,room);
    [peer,socket].forEach(player=>{player.join(roomCode);player.data.roomCode=roomCode;player.data.quickQueued=false;player.emit('match:found',publicRoom(room));});
    room.questions=selectQuestions(room.questionCount);room.questionIndex=0;sendQuestion(room);
    cb?.({matched:true,room:publicRoom(room)});
  });
  socket.on('match:cancel',()=>{
    const index=quickQueue.findIndex(item=>item.socketId===socket.id);
    if(index>=0)quickQueue.splice(index,1);
    socket.data.quickQueued=false;socket.emit('match:cancelled');
  });
  socket.on('room:create',({name,avatar},cb)=>{
    name=String(name||'').trim().slice(0,18); avatar=validAvatar(avatar); if(!name)return cb?.({error:'Escolha um apelido.'});
    let roomCode; do{roomCode=code();}while(rooms.has(roomCode));
    const room={code:roomCode,hostId:socket.id,players:new Map(),status:'lobby',questionIndex:0,questionCount:20,durationSeconds:20,questions:[],timer:null,questionStartedAt:null};
    room.players.set(socket.id,{id:socket.id,name,avatar,score:0,answered:false,lastAnswer:null,correct:0,wrong:0,unanswered:0}); rooms.set(roomCode,room); socket.join(roomCode); socket.data.roomCode=roomCode; cb?.({room:publicRoom(room)}); emitRoom(room);
  });
  socket.on('room:join',({code:roomCode,name,avatar},cb)=>{
    roomCode=String(roomCode||'').trim().toUpperCase(); name=String(name||'').trim().slice(0,18); avatar=validAvatar(avatar); const room=rooms.get(roomCode);
    if(!name)return cb?.({error:'Escolha um apelido.'}); if(!room)return cb?.({error:'Sala não encontrada. Confira o código.'}); if(room.status!=='lobby')return cb?.({error:'Essa partida já começou.'}); if(room.players.size>=MAX_PLAYERS)return cb?.({error:'A sala está cheia (máximo de 8).'});
    if([...room.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return cb?.({error:'Esse nome já está sendo usado na sala.'});
    room.players.set(socket.id,{id:socket.id,name,avatar,score:0,answered:false,lastAnswer:null,correct:0,wrong:0,unanswered:0}); socket.join(roomCode); socket.data.roomCode=roomCode; cb?.({room:publicRoom(room)}); emitRoom(room);
  });
  socket.on('room:leave',(_,cb)=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room){socket.data.roomCode=null;socket.leave(socket.data.roomCode);return cb?.({ok:true});}
    room.players.delete(socket.id); socket.leave(room.code); socket.data.roomCode=null;
    if(!room.players.size){stopTimer(room);rooms.delete(room.code);return cb?.({ok:true});}
    if(room.hostId===socket.id) room.hostId=room.players.keys().next().value;
    emitRoom(room); cb?.({ok:true});
  });
  socket.on('room:settings',(data,cb)=>{const room=rooms.get(socket.data.roomCode); if(!room)return cb?.({error:'Sala não encontrada.'}); if(socket.id!==room.hostId)return cb?.({error:'Somente o anfitrião pode alterar as configurações.'}); if(room.status!=='lobby')return cb?.({error:'A partida já começou.'}); const s=validSettings(data); room.questionCount=s.questionCount; room.durationSeconds=s.durationSeconds; emitRoom(room); cb?.({ok:true});});
  socket.on('game:start',(_,cb)=>{const room=rooms.get(socket.data.roomCode); if(!room)return cb?.({error:'Sala não encontrada.'}); if(socket.id!==room.hostId)return cb?.({error:'Somente o anfitrião pode iniciar.'}); if(room.status!=='lobby')return cb?.({error:'A partida já começou.'}); if(room.players.size<MIN_PLAYERS)return cb?.({error:'São necessários pelo menos 2 jogadores.'});
    room.questions=selectQuestions(room.questionCount); room.questionIndex=0; room.players.forEach(p=>{p.score=0;p.answered=false;p.correct=0;p.wrong=0;p.unanswered=0;}); sendQuestion(room); cb?.({ok:true}); });
  socket.on('game:answer',({index},cb)=>{const room=rooms.get(socket.data.roomCode); if(!room||room.status!=='playing')return cb?.({error:'Não há pergunta ativa.'}); const player=room.players.get(socket.id); if(!player)return cb?.({error:'Jogador não encontrado.'}); if(player.answered)return cb?.({error:'Você já respondeu.'}); const q=room.questions[room.questionIndex]; if(!Number.isInteger(index)||index<0||index>=q.options.length)return cb?.({error:'Alternativa inválida.'});
    player.answered=true; player.lastAnswer=index; const correct=index===q.answer; let points=0; if(correct){const elapsed=Date.now()-room.questionStartedAt;const remaining=Math.max(0,room.durationSeconds*1000-elapsed);points=100+Math.round(50*remaining/(room.durationSeconds*1000));player.score+=points;player.correct++;}else player.wrong++;
    cb?.({ok:true,correct,points}); io.to(room.code).emit('player:answered',{playerId:player.id,playerName:player.name,correct,points}); emitRoom(room); if([...room.players.values()].every(p=>p.answered))revealAnswer(room,false);
  });
  socket.on('disconnect',()=>{const queuedIndex=quickQueue.findIndex(item=>item.socketId===socket.id);if(queuedIndex>=0)quickQueue.splice(queuedIndex,1);const room=rooms.get(socket.data.roomCode);if(!room)return;room.players.delete(socket.id);if(!room.players.size){stopTimer(room);rooms.delete(room.code);return;}if(room.hostId===socket.id)room.hostId=room.players.keys().next().value;if(room.status==='playing'&&[...room.players.values()].every(p=>p.answered))revealAnswer(room,false);emitRoom(room);});
});
server.listen(PORT,()=>console.log(`Quiz Arena rodando em http://localhost:${PORT}`));
