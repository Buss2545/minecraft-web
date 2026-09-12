# Mari JP SMP Website

Real website starter based on the supplied `index.html`.

## Features
- Live Minecraft status through the server-side `/api/status` proxy (checks both Java and Bedrock, cached 20s)
- Real registration/login with salted **scrypt** password hashes (no plaintext, no SHA-256-only hashing)
- Session cookies (`httpOnly`, `sameSite=lax`) — no tokens or passwords ever touch `localStorage`
- Real order records in `data.json`, with product prices validated server-side (the client can't fake a discount)
- SHOP with VIP / VIP+ / MVP / MVP+ / ELITE / LEGEND / EMPEROR
- Account page with order history

## Run
1. Install Node.js 18+.
2. From this folder, run:
   ```
   npm install
   npm start
   ```
3. Open http://localhost:3000

## Project layout
```
mari-jp-smp/
├── server.js        # Express backend: auth, sessions, orders, /api/status proxy
├── package.json
├── data.json         # users + orders (created automatically if missing)
└── public/
    └── index.html    # the site (same design as the original, backend calls now hit /api/*)
```

## How auth works
- Passwords are hashed with `crypto.scrypt` + a random 16-byte salt per user, stored as `salt:hash` in `data.json`. Login re-derives the hash and compares with `crypto.timingSafeEqual`.
- On login/register the server creates a random session id (`crypto.randomBytes(32)`), keeps it in an in-memory `Map`, and sends it to the browser as an `httpOnly` cookie. Restarting the server invalidates existing sessions (fine for a starter; swap in Redis/a DB table for production so sessions survive restarts).
- Every `/api/*` write is validated server-side — usernames, password length, and especially **order price**, which is always looked up from the server's own `SHOP_PRODUCTS` table rather than trusted from the client.

## Production checklist (not done here on purpose)
This is a starter, so a few things are intentionally left out — wire these up before taking real money or players:
- **HTTPS**: put this behind a reverse proxy (Caddy/Nginx) or a host that terminates TLS. Cookies are marked `secure` automatically when `NODE_ENV=production`.
- **Real database**: swap the `data.json` file for PostgreSQL/MySQL once you have concurrent write volume — the file-based store is serialized and safe, but won't scale past a small hobby server.
- **Payment provider**: the SHOP page displays your payment info and creates a "pending review" order — it does not charge cards or auto-grant ranks. Hook up a real gateway (Omise, Stripe, TrueMoney's API, etc.) if you want that automated.
- **Persistent/shared sessions**: use `connect-redis` or a sessions table if you run more than one server process, or want logins to survive a restart.
- **Rate limiting**: there's a minimal in-memory limiter on `/api/login` and `/api/register`; consider `express-rate-limit` + a shared store for anything public-facing.

## Environment variables (optional)
- `PORT` — defaults to `3000`
- `MC_HOST` / `MC_PORT` — the Minecraft server the status widget checks (defaults to `marijp2006.svmine.com` / `11206`)
- `NODE_ENV=production` — marks session cookies `secure` (requires HTTPS)
- `RCON_HOST` / `RCON_PORT` / `RCON_PASSWORD` — optional, enables **verified** Minecraft ID binding (see below). Leave unset to disable.

## "ผูกไอดี Minecraft" (bind + verify a Minecraft username)
Users can save a Minecraft username to their website account from the Account page, so they don't have to re-type it on every order.

- **Without RCON configured:** the name is saved as-is, unverified. Fine for small servers where staff eyeball the name before granting a rank manually.
- **With RCON configured:** when someone clicks "ผูกไอดี", the server runs the `list` command over RCON and only accepts the bind if that exact username is online at that moment — a lightweight way to prove they control that account, with no custom plugin needed.

To turn this on, get your RCON host/port/password from your hosting panel (Multicraft, Pterodactyl, etc. all expose this) and set `RCON_HOST`, `RCON_PORT`, and `RCON_PASSWORD` as environment variables on Render (Dashboard → your service → Environment). **Note:** the RCON port is almost always different from the port players connect on — don't reuse `MC_PORT` here.

This does **not** auto-grant ranks yet — it only verifies identity. Auto-granting a rank after a real payment would mean running a command like `lp user <name> parent add vip` over the same RCON connection right after payment confirms; ask if you want that wired up once you have a real payment gateway in place.

