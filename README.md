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
- Admin-assigned website titles (ฉายาเว็บไซต์) shown on the profile and account bar
- Japan Standard Time (JST) clock in the footer with automatic day/night theme
  (small sakura petals by day and shooting stars at night)

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

## Website titles (ฉายาเว็บไซต์ — separate from Minecraft ranks)

Every new account starts with `สมาชิกใหม่`. An admin can assign one of these
website display titles from the **ผู้ใช้** tab in `/admin.html`. These titles
are completely separate from MEMBER/VIP/MVP ranks and never change a player's
Minecraft rank or shop ownership:

- `admin` — แอดมิน
- `trader` — ผู้ซื้อขาย
- `creator` — ผู้สร้างเซิร์ฟเวอร์และเว็บไซต์
- `moderator` — ผู้ดูแลชุมชน
- `builder` — นักสร้างโลก
- `supporter` — ผู้สนับสนุนเซิร์ฟเวอร์
- `veteran` — ผู้เล่นรุ่นบุกเบิก
- `tester` — นักทดสอบระบบ
- `event_host` — ผู้จัดกิจกรรม

Titles are presentation labels only. They do not grant API or admin
permissions; the existing `ADMIN_KEY` remains the permission boundary.

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

## มินิเกมวงล้อ (หมุนวงล้อสุ่มรางวัล)
A second mini-game alongside the car-racing one: pay a stake, spin, get a
credit multiplier back. The wheel's center shows `public/wheel-avatar.webp`
(swap that file for any image you like — it's just a static asset).

- `GET /api/wheel/config` — stake amount + the list of prize slices (label/color) so the client can draw a wheel matching the server's order.
- `POST /api/wheel/spin` — deducts the stake, picks a prize server-side by weight (`WHEEL_PRIZES` in `server.js`), credits the payout, and returns which slice index won so the client just animates the wheel to that slice. The client never decides the outcome.
- `WHEEL_STAKE` env var — cost per spin in บาท, defaults to `5`.
- Edit `WHEEL_PRIZES` in `server.js` to change the multipliers, odds (`weight`), labels, or colors of each slice.
- Spins are logged best-effort to a `wheelSpins` MongoDB collection for your own reference; nothing reads it back yet.

## แลกเครดิตเป็นเงินในเกม (/money)
Separate from the PlayerPoints redeem above — this credits the server's
**economy plugin balance** (`/money`, e.g. EssentialsX) instead of
PlayerPoints. Players use the **💰 แลกเงินเกม** button on the site:

- Exchange rate defaults to **1 บาทเครดิต = 1,000 เงินในเกม**; override with `MONEY_PER_BAHT`.
- **Daily cap: 100,000 เงินในเกม ต่อวัน ต่อไอดี** (= 100 บาทเครดิต/วัน at the default rate), resetting at midnight Thailand time (Asia/Bangkok). Override with `MAX_MONEY_REDEEM_PER_DAY`. The cap is counted in *in-game money delivered*, not baht spent, and is reserved atomically before the wallet is touched — a failed or insufficient-balance attempt never eats into the day's quota.
- Requires the player to have bound a Minecraft name first (same as the PlayerPoints/RCON binding above), and requires RCON or Pterodactyl to be configured (`GAME_CONSOLE_ENABLED`).
- Sends `economy give <player> <amount>` (the TNE / "The New Economy" plugin's give command — confirmed as what this server actually runs) over RCON/Pterodactyl by default. If you ever switch economy plugins, override the command template with `MONEY_GIVE_COMMAND`, e.g. `MONEY_GIVE_COMMAND="eco give {player} {amount}"` for EssentialsX or `MONEY_GIVE_COMMAND="money give {player} {amount}"` for CMI — `{player}` and `{amount}` are substituted automatically.
- If the console command fails for any reason, the wallet deduction *and* the day's quota usage are both automatically reversed — players are never charged (or have their daily quota eaten) for money that didn't arrive.
- `GET /api/money/status` — returns the current rate, daily cap, and how much of today's quota the logged-in player has left (used by the redeem modal to show live numbers).
- `POST /api/money/redeem` — `{ amount }` in บาทเครดิต; deducts the wallet and delivers `amount * MONEY_PER_BAHT` in-game money.

## Environment variables (/money additions)
- `MONEY_PER_BAHT` — optional, defaults to `1000`. Exchange rate for the /money redeem feature.
- `MAX_MONEY_REDEEM_PER_DAY` — optional, defaults to `100000`. Daily cap in in-game money, per account, resetting at Asia/Bangkok midnight.
- `MONEY_GIVE_COMMAND` — optional, defaults to `economy give {player} {amount}` (TNE). Console command template for your server's economy plugin — only needed if you switch plugins later.

## Admin-adjustable win/lose rates (`/admin.html` → 🎮 เรทเกม)
Admins can tune both mini-games live, no code changes or redeploy needed:

- **เกมแข่งรถ**: a 0-100% slider sets how often the **bot** wins a race match. Real player-vs-player matches are always decided fairly by actual timing accuracy — this setting only affects matches where the opponent is the bot.
- **วงล้อสุ่มรางวัล**: edit each prize slice's label, payout multiplier, weight (odds), and color directly, add/remove slices, and see an estimated RTP (return-to-player %) update live as you edit.

Both are stored in a `settings` MongoDB collection (survives restarts/redeploys) and gated by the same `ADMIN_KEY` as the rest of `/admin.html` — regular players never see these values (the wheel odds still aren't exposed via `/api/wheel/config`, only labels/colors are).

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

## โปรโมชั่น มารี (Promotion Mari) - separate promo board
A third catalog, separate from both the VIP rank shop and the regular Item SHOP, for running time-limited or special promo items. Same behavior as the Item SHOP (server-validated price, auto-delivery via console command when configured, repeatable purchases) but its own button (`🎁 โปรโมชั่น มารี`), catalog endpoint, and purchase endpoint, so promo items never overwrite or get purchased through the regular Item SHOP.

- Catalog: `GET /api/promo-shop`
- Purchase: `POST /api/promo-orders`
- Order history: `GET /api/promo-orders`
- Admin management (`/admin.html` → 🎁 โปรโมชั่น มารี tab): `GET`/`POST /api/admin/promo-items`, `PUT`/`DELETE /api/admin/promo-items/:id`

Stored in its own `promoItems` MongoDB collection. Ships empty by default - an admin adds items from the admin tab.

### Unique serial numbers (UID 1-9999999)
Any promo item can have `assignUid` turned on (checkbox in admin.html, per item): every purchase then gets its own random serial number from **1 to 9,999,999**, unique per product (re-rolled on the rare collision - see `generateUniquePromoUid` in `server.js`). Reference it in the item's `commandTemplate` with `{uid}`, alongside `{player}` - e.g. to engrave it into an item's in-game display name:
```
give {player} minecraft:diamond_sword{display:{Name:'{"text":"ชื่อไอเทม #{uid}","italic":false,"color":"aqua"}'}} 1
```
The number is generated *before* the player's wallet is charged (so a failure to generate one never deducts credit), saved on the order as `promoUid`, and shown to the player after purchase, in their account order history, and to admins in the orders tab.

## Account UID (ทุกบัญชีมีหมายเลขเฉพาะ 1-9999999)
Every user account also gets its own unique number, same 1-9,999,999 range and same generation approach as the promo-item serial numbers above (`generateUniqueAccountUid`, unique-checked against `db.users`, backed by a unique index on `users.uid`):

- New accounts get one immediately at `POST /api/register`.
- Existing accounts (from before this feature) are backfilled automatically the next time the server boots and connects to MongoDB (`backfillUserUids` - runs once per account, safe to run on every restart).
- Shown on the player's own account page (next to their username), and in `/admin.html` → ผู้ใช้ tab next to each account.
- Admin user search also accepts a UID: typing a number into the search box in `/admin.html` → ผู้ใช้ matches either the username or an exact UID.

This `uid` is just a display/lookup number for accounts - unrelated to the per-purchase `promoUid` above, which is scoped to individual Promotion Mari orders, not accounts.

## ขายต่อไอเทมจาก Item SHOP (ราคาลดตามเวลา)
A resale board for Item SHOP items, replacing the old player-to-player trade market entirely. Anyone can list; accounts without the `trader`/`admin`/`creator` website title (i.e. still on the default "สมาชิกใหม่" title) are capped at a low starting price (`RESALE_UNTRUSTED_MAX_PRICE`, default ฿7) to limit a brand-new/unverified account's exposure. Accounts with one of those titles can list up to the item's full Item SHOP price.

- Seller picks an item from the Item SHOP catalog and sets a starting price (server-enforced: can't exceed that item's normal Item SHOP price).
- From the moment it's listed, the price falls in a straight line down to a floor over an admin-configured number of hours, then holds at the floor until it sells or is cancelled.
- Buying delivers a fresh copy of the item straight to the **buyer** via console command (same delivery path as the regular Item SHOP) and pays the (decayed) price into the **seller's** wallet — the site can't see real in-game inventories, so nothing is actually removed from the seller's inventory; this is a personal-discount resale, not a literal item transfer.
- `GET /api/resale/config` — current decay duration + floor %
- `GET /api/resale/listings` — active listings with their live current price
- `GET /api/resale/my-listings` — the logged-in seller's own listings
- `POST /api/resale/listings` — create a listing `{ itemId, price }`
- `DELETE /api/resale/listings/:id` — cancel your own active listing
- `POST /api/resale/listings/:id/buy` — buy at the current price `{ minecraft }`
- Admin: `GET`/`POST /api/admin/resale/config` sets `decayHours` (default 72 = 3 days) and `floorPercent` (default 20%); `GET /api/admin/resale/listings` and `DELETE /api/admin/resale/listings/:id` for moderation. Both config values are snapshotted onto each listing at creation time, so changing them later never affects listings already posted.
- `MAX_ACTIVE_RESALE_LISTINGS_PER_USER` env var — cap on active listings per account, defaults to `10`.
- `RESALE_UNTRUSTED_MAX_PRICE` env var — max starting price for accounts without the `trader`/`admin`/`creator` title, defaults to `7`.

## ล็อกอินรับของประจำวัน (daily login calendar, day 1-31)
A 31-slot calendar keyed by the **real calendar day-of-month** (Asia/Bangkok), not a rolling N-day counter — so it resets itself on the 1st of every month automatically with nothing to configure or restart by hand. A 30-day month simply never reaches slot 31; next month starts back at slot 1 on its own.

- Player button: `📅 เช็คอิน` in the nav bar, opens a 1-31 grid showing every day's reward, which days this month are already claimed (✅), and today's reward highlighted.
- One claim per real calendar day per account (`GET /api/checkin/status`, `POST /api/checkin/claim { minecraft }`) — enforced by a unique index on `(userId, dayKeyBangkok)`, so a double-click can't double-claim.
- **Delivery, per day, admin's choice**: each of the 31 days has its own optional `commandTemplate` (raw console command, same convention as the Item SHOP's `commandTemplate` — `{player}` and `{quantity}` get substituted). If `GAME_CONSOLE_ENABLED` (RCON or Pterodactyl configured) and that day has a command set, claiming it sends the item to the player automatically, same as the Item SHOP. Leave a day's command blank (or if the console isn't configured at all) and that day's claim is saved as "รอแอดมินส่งของ" for staff to hand-deliver from admin.html and mark delivered — same graceful fallback the Item SHOP already uses. A failed automatic send (server offline, bad command, etc.) also falls back to "รอแอดมินส่งของ" with the error noted, rather than losing the claim.
- Admin tab `📅 เช็คอิน` in `admin.html`:
  - Set the icon, item name, quantity, and console command for each of the 31 days. Quantity is hard-capped server-side at `CHECKIN_MAX_QUANTITY_PER_DAY` (3) — "แจกไม่เกิน 2-3 ชิ้นต่อไอเทม". A banner shows whether the server's console connection is currently on or off.
  - View claims filtered by รอส่งของ / ส่งแล้ว / ทั้งหมด, mark a claim delivered, or delete a claim (also frees that day so the player can re-claim it — e.g. if they typed the wrong Minecraft name).
  - `GET`/`POST /api/admin/checkin/config` — the 31-day reward list, each entry `{ day, icon, label, quantity, commandTemplate }`.
  - `GET /api/admin/checkin/claims?status=pending|delivered|all`, `POST /api/admin/checkin/claims/:id/deliver`, `DELETE /api/admin/checkin/claims/:id`.
- Defaults to a เพชร/มรกต/แอปเปิลทอง rotation (qty 2/3/1) with matching vanilla `give` commands across all 31 days until an admin customizes it from admin.html.
