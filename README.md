# Mari JP SMP Website

Real website starter based on the supplied `index.html`.

## Features
- Live Minecraft status through the server-side `/api/status` proxy (checks both Java and Bedrock, cached ~15s)
- Real registration/login with salted **scrypt** password hashes (no plaintext, no SHA-256-only hashing)
- Session cookies (`httpOnly`, `sameSite=lax`) — no tokens or passwords ever touch `localStorage`
- Data (accounts, credit balances, orders, top-ups) stored in **MongoDB Atlas** (free tier) so it survives redeploys/restarts — Render's free plan has no persistent disk, so this is required, not optional
- Product prices validated server-side (the client can't fake a discount)
- Separate VIP rank shop and item SHOP, paid for from wallet credit
- Account page with order + top-up history

## Run
1. Install Node.js 18+.
2. Set up a free MongoDB Atlas database (see below) and get its connection string.
3. From this folder, run:
   ```
   npm install
   MONGODB_URI="<your connection string>" npm start
   ```
4. Open http://localhost:3000

## Setting up MongoDB Atlas (free, ~5 minutes)
1. Go to https://www.mongodb.com/cloud/atlas/register and create a free account.
2. Create a new **free (M0) cluster** — any provider/region is fine.
3. **Database Access** (left sidebar) → **Add New Database User** → set a username + password (save these — you'll need them in step 6). Give it "Read and write to any database".
4. **Network Access** (left sidebar) → **Add IP Address** → choose **Allow Access from Anywhere** (`0.0.0.0/0`). Render's servers don't have a fixed IP, so this is required.
5. Go back to your cluster → **Connect** → **Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. Replace `<username>` and `<password>` with the database user from step 3, and add a database name right after `.net/`, e.g.:
   ```
   mongodb+srv://myuser:mypassword@cluster0.xxxxx.mongodb.net/marijpsmp?retryWrites=true&w=majority
   ```
7. On Render: your service → **Environment** → add `MONGODB_URI` with that full string as the value → **Save Changes**.

The app creates its collections and indexes automatically on first connect — no manual database setup needed beyond this.

## Project layout
```
mari-jp-smp/
├── server.js        # Express backend: auth, sessions, orders, wallet, /api/status proxy
├── package.json
└── public/
    ├── index.html    # the site
    ├── auth.html     # login/register (dedicated page)
    └── admin.html    # top-up approval queue (gated by ADMIN_KEY)
```
`data.json` from earlier versions of this starter is no longer used — safe to delete it from your repo.

## How auth works
- Passwords are hashed with `crypto.scrypt` + a random 16-byte salt per user, stored as `salt:hash` in MongoDB. Login re-derives the hash and compares with `crypto.timingSafeEqual`.
- On login/register the server creates a random session id (`crypto.randomBytes(32)`), keeps it in an in-memory `Map`, and sends it to the browser as an `httpOnly` cookie. Restarting the server invalidates existing sessions (people just log in again) — only account data lives in MongoDB, not sessions.
- Every `/api/*` write is validated server-side — usernames, password length, and especially **order price**, which is always looked up from the server's own `SHOP_PRODUCTS` table rather than trusted from the client. Wallet purchases use an atomic MongoDB update (`balance >= price` in the same query that deducts it) so two simultaneous purchases can never double-spend the same balance.

## Production checklist (not done here on purpose)
This is a starter, so a few things are intentionally left out — wire these up before taking real money or players:
- **HTTPS**: put this behind a reverse proxy (Caddy/Nginx) or a host that terminates TLS. Cookies are marked `secure` automatically when `NODE_ENV=production`.
- **Payment provider**: top-ups are manual (player transfers money, sends proof on Discord, staff approves in `/admin.html`) — nothing here charges cards or moves real money automatically. Hook up a real gateway (Omise, Stripe, TrueMoney's API, etc.) if you want that automated.
- **Persistent/shared sessions**: use `connect-mongo` or similar if you run more than one server process, or want logins to survive a restart.
- **Rate limiting**: there's a minimal in-memory limiter on `/api/login` and `/api/register`; consider `express-rate-limit` + a shared store for anything public-facing.

## Wallet top-up system (เติมเงิน)
Users top up credit, then spend it instantly in the SHOP (no more manual "pending review" per order):

1. User clicks **เติมเงิน** → submits an amount → creates a `pending` top-up request (no money moves automatically — this site has no payment gateway on purpose, see below).
2. User sends the actual transfer slip through Discord (or wherever you take payments) as before.
3. You check the slip, then go to **`/admin.html`**, enter your `ADMIN_KEY`, and approve the request — this credits the user's wallet balance.
4. From then on, buying a rank in the SHOP deducts straight from their wallet balance and completes instantly (status `สำเร็จ (จ่ายด้วยเครดิต)`), instead of sitting in a review queue.

If they don't have enough balance, the SHOP tells them to top up first — nothing is created insecurely or trusted from the client (price and balance checks all happen server-side).

## Pages
- `/` — main site
- `/auth.html` — login/register (dedicated page, not a popup — better on mobile)
- `/admin.html` — top-up approval queue + order list, gated by `ADMIN_KEY`

## Redeeming wallet credit for in-game PlayerPoints
Requires the [PlayerPoints](https://modrinth.com/plugin/playerpoints) plugin installed on your Minecraft server, plus `RCON_HOST`/`RCON_PORT`/`RCON_PASSWORD` configured (same RCON setup as the Minecraft ID binding feature above).

- Player enters an amount on the **เติมเงิน** page → the server deducts that from their wallet balance and immediately runs `points give <name> <amount>` over RCON.
- Exchange rate defaults to **1 baht = 1 point**; override with the `POINTS_PER_BAHT` env var.
- Requires the player to have bound a Minecraft name first (works even if they're offline - PlayerPoints resolves the UUID itself).
- If the RCON command fails for any reason (server down, wrong RCON password, etc.), the wallet deduction is automatically reversed - players are never charged for points that didn't arrive.

## Environment variables
- `MONGODB_URI` — **required**. Your MongoDB Atlas connection string (see setup steps above). The server refuses to start without it.
- `PORT` — defaults to `3000`
- `MC_HOST` / `MC_PORT` — the Minecraft server the status widget checks (defaults to `marijp2006.svmine.com` / `11206`)
- `NODE_ENV=production` — marks session cookies `secure` (requires HTTPS)
- `RCON_HOST` / `RCON_PORT` / `RCON_PASSWORD` — optional, enables **verified** Minecraft ID binding (see below). Leave unset to disable.
- `ADMIN_KEY` — required to use `/admin.html` and approve top-ups. Pick any long random string; without it, all `/api/admin/*` endpoints return 403.
- `POINTS_PER_BAHT` — optional, defaults to `1`. Exchange rate for the PlayerPoints redeem feature.

## "ผูกไอดี Minecraft" (bind + verify a Minecraft username)
Users can save a Minecraft username to their website account from the Account page, so they don't have to re-type it on every order.

- **Without RCON configured:** the name is saved as-is, unverified. Fine for small servers where staff eyeball the name before granting a rank manually.
- **With RCON configured:** when someone clicks "ผูกไอดี", the server runs the `list` command over RCON and only accepts the bind if that exact username is online at that moment — a lightweight way to prove they control that account, with no custom plugin needed.

To turn this on, get your RCON host/port/password from your hosting panel (Multicraft, Pterodactyl, etc. all expose this) and set `RCON_HOST`, `RCON_PORT`, and `RCON_PASSWORD` as environment variables on Render (Dashboard → your service → Environment). **Note:** the RCON port is almost always different from the port players connect on — don't reuse `MC_PORT` here.

This does **not** auto-grant ranks yet — it only verifies identity. See the LuckPerms section below for automatic rank granting on purchase.

## Automatic LuckPerms rank granting on purchase
When a player buys a rank in the SHOP and pays with wallet credit, the server now runs `lp user <name> parent add <group>` on your actual Minecraft server right after the credit deduction succeeds — no more manually granting ranks from a spreadsheet of orders.

- **Requires** the same console access as the PlayerPoints feature above: either `RCON_HOST`/`RCON_PORT`/`RCON_PASSWORD`, or `PTERO_PANEL_URL`/`PTERO_SERVER_ID`/`PTERO_API_KEY`. Without either set, orders fall back to the old behavior — saved with status "รอแอดมินติดยศให้" for staff to grant by hand.
- **Rank → LuckPerms group mapping** (matched to this server's actual LuckPerms groups): `VIP`→`vip`, `VIP+`→`vipplus`, `MVP`→`megavip`, `MVP+`→`ultravip`, `LEGEND`→`legend`. Override any of these with the `LUCKPERMS_GROUPS` env var as a JSON object, e.g. `LUCKPERMS_GROUPS={"VIP":"vip"}` — the group name must match exactly what exists in LuckPerms.
- **ELITE and EMPEROR are removed from the shop for now** — there was no matching LuckPerms group for them. Once those groups exist on the server, add them back to `SHOP_PRODUCTS` in `server.js` (pick a price) and to `DEFAULT_LUCKPERMS_GROUPS`, and re-add their rank cards in `public/index.html`.
- **Optional expiry**: set `LUCKPERMS_DURATION` (e.g. `30d`, `1y`) to grant a timed rank instead of permanent. Leave unset for permanent.
- **If the grant fails** (server offline, wrong group name, connection error), the wallet deduction is automatically reversed and the order is removed — same "never charge for something that didn't arrive" guarantee as the PlayerPoints redeem feature. The player sees an error and can just try again.
- **Manual retry**: `/admin.html` has a retry button on every rank/item order — useful for orders placed while console access was off, or to retry a stuck one.

## Environment variables (LuckPerms additions)
- `LUCKPERMS_GROUPS` — optional JSON object overriding the rank→group name mapping (see above).
- `LUCKPERMS_DURATION` — optional, e.g. `30d`. Leave unset for permanent grants.

## Separate in-game item SHOP
The item shop is separate from the VIP rank shop. It has its own button (`🛒 SHOP`), catalog endpoint, and purchase endpoint, so item products cannot overwrite or be purchased through the VIP rank endpoint.

- VIP rank shop: `GET /api/shop` and `POST /api/orders`
- Item SHOP: `GET /api/item-shop` and `POST /api/item-orders`
- Item order history: `GET /api/item-orders`

The item SHOP contains repeatable vanilla items (diamond, emerald, and golden apple). The server validates each item price and sends the item with a console command after payment:

- `ITEM_DIAMOND` — ฿10 — `give <player> minecraft:diamond 1`
- `ITEM_EMERALD` — ฿15 — `give <player> minecraft:emerald 16`
- `ITEM_GOLDEN_APPLE` — ฿25 — `give <player> minecraft:golden_apple 1`

Edit `SHOP_ITEMS` in `server.js` to change prices, labels, or commands. Item purchases can be repeated; VIP rank purchases remain limited to one per rank. If RCON/Pterodactyl is not configured, the item order is saved for an admin to deliver manually. Existing mixed order history remains readable after this separation.

