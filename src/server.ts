import * as express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';

const app = express();

//initialize a simple http server
const server = http.createServer(app);

//initialize the WebSocket server instance
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws: WebSocket) => {

  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  //TODO: connect to the market nodes

  //connection is up 
  ws.on('bid', (message: string) => {
    

  });

  //send immediatly a feedback to the incoming connection    
  ws.send('Hi there, I am a WebSocket server');
});

//check for broken connections
setInterval(() => {
  wss.clients.forEach((ws: ExtWebSocket) => {

    if (!ws.isAlive) return ws.terminate();

    ws.isAlive = false;
    ws.ping(null, false, true);
  });
}, 30000);

//start our server
server.listen(8999, () => {
  console.log(`Server started on port ${server.address().port} :)`);
});
