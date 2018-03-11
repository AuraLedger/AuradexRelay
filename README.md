# aurasocks
websocket server for auradex

## Pre-reqs
[NodeJS](https://nodejs.org/en/)
Tested with version 8.0.0+, YMMV with earlier versions

## Install
```
git clone https://github.com/YouStock/aurasocks.git
cd aurasocks
npm install
```

## Development server

Run `npm run dist && npm start` for a dev server. This runs at `ws://localhost:8998/`.

Run `npm run debug` for debugging, and add breakpoints by navigating to `chrome://inspect` and selecting your remote target
