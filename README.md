# Mari JP SMP Website

Real website starter based on the supplied `index.html`.

## Features
- Live Minecraft status through the server-side `/api/status` proxy
- Real registration/login with salted scrypt password hashes
- Session cookies
- Real order records in `data.json`
- SHOP with VIP/VIP+/MVP/MVP+/LEGEND/EMPEROR
- Account page with order history

## Run
1. Install Node.js 18+.
2. Put `index(2).html`, `server.js`, `package.json` in one folder.
3. Run `node server.js`.
4. Open `http://localhost:3000`.

For production, put the app behind HTTPS and use a proper database (PostgreSQL/MySQL) and payment provider. This starter intentionally does not pretend to process real money or automatically grant Minecraft ranks.
