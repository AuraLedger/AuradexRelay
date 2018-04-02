# Auradex Relay
websocket relayer for auradex

This is a simple and temporary message relaying server for Auradex that will eventually be replaced by a p2p messaging system.

## Pre-reqs
[NodeJS](https://nodejs.org/en/)
Tested with version 8.0.0+, YMMV with earlier versions

## Install
```
git clone https://github.com/Aura/AuradexRelay.git
cd AuradexRelay
npm install
```

## Development server

Run `npm run dist && npm start` for a dev server. This runs at `ws://localhost:8998/`.

Run `npm run debug` for debugging, and add breakpoints by navigating to `chrome://inspect` and selecting your remote target
