const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, "data.json");

const MINECRAFT_HOST = "marijp2006.svmine.com";
const MINECRAFT_PORT = 11206;

const ALLOWED_ORIGIN = "https://buss2545.github.io";

const PRODUCTS = {
  "VIP": 50,
  "VIP+": 100,
  "MVP": 150,
  "MVP+": 200,
  "LEGEND": 500,
  "EMPEROR": 1000
};

// ======================================================
// DATABASE
// ======================================================

let db = {
  users: [],
  orders: []
};

try {
  if (fs.existsSync(DB_FILE)) {
    const text = fs.readFileSync(DB_FILE, "utf8").trim();

    if (text) {
      db = JSON.parse(text);
    }
  }
} catch (error) {
  console.error("ไม่สามารถอ่าน data.json:", error.message);
}

if (!Array.isArray(db.users)) {
  db.users = [];
}

if (!Array.isArray(db.orders)) {
  db.orders = [];
}

function saveDatabase() {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(db, null, 2),
      "utf8"
    );

    return true;
  } catch (error) {
    console.error("ไม่สามารถบันทึก data.json:", error.message);
    return false;
  }
}

// ======================================================
// PASSWORD
// ======================================================

function createPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto
    .scryptSync(String(password), salt, 64)
    .toString("hex");

  return {
    salt,
    passwordHash: hash
  };
}

function checkPassword(password, user) {
  try {
    if (!user || !user.salt || !user.passwordHash) {
      return false;
    }

    const hash = crypto
      .scryptSync(String(password), user.salt, 64)
      .toString("hex");

    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(user.passwordHash, "hex");

    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(a, b);

  } catch {
    return false;
  }
}

// ======================================================
// SESSION
// ======================================================

const sessions = new Map();

function createSession(res, user) {
  const sid = crypto
    .randomBytes(32)
    .toString("hex");

  sessions.set(sid, user);

  res.setHeader(
    "Set-Cookie",
    [
      `sid=${sid}`,
      "HttpOnly",
      "Secure",
      "SameSite=None",
      "Path=/",
      "Max-Age=604800"
    ].join("; ")
  );
}

function deleteSession(req, res) {
  const cookie = req.headers.cookie || "";

  const match = cookie.match(
    /(?:^|;\s*)sid=([^;]+)/
  );

  if (match) {
    sessions.delete(match[1]);
  }

  res.setHeader(
    "Set-Cookie",
    [
      "sid=",
      "HttpOnly",
      "Secure",
      "SameSite=None",
      "Path=/",
      "Max-Age=0"
    ].join("; ")
  );
}

function getCurrentUser(req) {
  const cookie = req.headers.cookie || "";

  const match = cookie.match(
    /(?:^|;\s*)sid=([^;]+)/
  );

  if (!match) {
    return null;
  }

  return sessions.get(match[1]) || null;
}

// ======================================================
// USER DATA
// ======================================================

function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    username: user.username,
    minecraft: user.minecraft || "",
    createdAt: user.createdAt || null
  };
}

// ======================================================
// CORS
// ======================================================

function setCors(res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    ALLOWED_ORIGIN
  );

  res.setHeader(
    "Access-Control-Allow-Credentials",
    "true"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );
}

// ======================================================
// JSON RESPONSE
// ======================================================

function sendJson(res, statusCode, data) {
  setCors(res);

  res.writeHead(statusCode, {
    "Content-Type":
      "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

// ======================================================
// REQUEST BODY
// ======================================================

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk.toString();

      if (data.length > 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

// ======================================================
// INPUT CLEAN
// ======================================================

function clean(value) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .trim();
}

// ======================================================
// MINECRAFT SERVER STATUS
// ======================================================

function getMinecraftStatus() {
  return new Promise(resolve => {

    const apiPath =
      "/3/" +
      encodeURIComponent(
        `${MINECRAFT_HOST}:${MINECRAFT_PORT}`
      );

    const request = http.get(
      {
        hostname: "api.mcsrvstat.us",
        path: apiPath,
        headers: {
          "User-Agent": "Mari-JP-SMP-Web/1.0"
        }
      },

      response => {

        let data = "";

        response.on("data", chunk => {
          data += chunk.toString();
        });

        response.on("end", () => {

          try {

            const result = JSON.parse(data);

            resolve({
              online: result.online === true,

              players: {
                online:
                  Number(
                    result.players?.online || 0
                  ),

                max:
                  Number(
                    result.players?.max || 0
                  )
              },

              version:
                result.version || "-",

              motd:
                result.motd?.clean?.join(" ") || ""
            });

          } catch {

            resolve({
              online: false,
              players: {
                online: 0,
                max: 0
              },
              version: "-",
              motd: ""
            });

          }

        });

      }
    );

    request.on("error", () => {

      resolve({
        online: false,
        players: {
          online: 0,
          max: 0
        },
        version: "-",
        motd: ""
      });

    });

    request.setTimeout(5000, () => {

      request.destroy();

      resolve({
        online: false,
        players: {
          online: 0,
          max: 0
        },
        version: "-",
        motd: ""
      });

    });

  });
}

// ======================================================
// WEBSITE FILE
// ======================================================

function serveWebsite(req, res) {

  let requestPath;

  try {

    requestPath = decodeURIComponent(
      (req.url || "/").split("?")[0]
    );

  } catch {

    return sendJson(res, 400, {
      error: "Bad path"
    });

  }

  // หน้าแรก = index.html เท่านั้น
  if (requestPath === "/") {
    requestPath = "/index.html";
  }

  // ป้องกันเข้าถึงไฟล์สำคัญ
  if (
    requestPath.includes("..") ||
    requestPath === "/server.js" ||
    requestPath === "/data.json"
  ) {

    return sendJson(res, 403, {
      error: "Forbidden"
    });

  }

  const relativePath =
    requestPath.replace(/^\/+/, "");

  let filePath =
    path.join(ROOT, relativePath);

  const safeRoot =
    ROOT.endsWith(path.sep)
      ? ROOT
      : ROOT + path.sep;

  if (
    filePath !== ROOT &&
    !filePath.startsWith(safeRoot)
  ) {

    return sendJson(res, 403, {
      error: "Forbidden"
    });

  }

  // ถ้าไม่มีไฟล์ ให้กลับไป index.html
  if (
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory()
  ) {

    filePath =
      path.join(ROOT, "index.html");

  }

  const extension =
    path.extname(filePath).toLowerCase();

  const contentTypes = {

    ".html":
      "text/html; charset=utf-8",

    ".css":
      "text/css; charset=utf-8",

    ".js":
      "text/javascript; charset=utf-8",

    ".json":
      "application/json; charset=utf-8",

    ".png":
      "image/png",

    ".jpg":
      "image/jpeg",

    ".jpeg":
      "image/jpeg",

    ".webp":
      "image/webp",

    ".gif":
      "image/gif",

    ".svg":
      "image/svg+xml",

    ".ico":
      "image/x-icon"

  };

  res.writeHead(200, {

    "Content-Type":
      contentTypes[extension] ||
      "application/octet-stream",

    "Cache-Control":
      extension === ".html"
        ? "no-cache"
        : "public, max-age=3600"

  });

  fs.createReadStream(filePath)
    .on("error", () => {

      if (!res.headersSent) {

        sendJson(res, 500, {
          error: "ไม่สามารถเปิดไฟล์ได้"
        });

      } else {

        res.end();

      }

    })
    .pipe(res);
}

// ======================================================
// MAIN SERVER
// ======================================================

const server = http.createServer(
  async (req, res) => {

    try {

      // --------------------------------------------------
      // OPTIONS / CORS
      // --------------------------------------------------

      if (req.method === "OPTIONS") {

        setCors(res);

        res.writeHead(204);

        return res.end();

      }

      const url =
        (req.url || "/").split("?")[0];

      // ==================================================
      // REGISTER
      // ==================================================

      if (
        url === "/api/register" &&
        req.method === "POST"
      ) {

        const body =
          await readBody(req);

        const username =
          clean(body.username);

        const password =
          String(body.password || "");

        if (
          !/^[A-Za-z0-9_]{3,24}$/.test(username)
        ) {

          return sendJson(res, 400, {

            error:
              "Username ต้องเป็น A-Z, 0-9 หรือ _ และยาว 3-24 ตัว"

          });

        }

        if (password.length < 6) {

          return sendJson(res, 400, {

            error:
              "Password ต้องมีอย่างน้อย 6 ตัว"

          });

        }

        const exists =
          db.users.some(
            user =>
              String(user.username)
                .toLowerCase() ===
              username.toLowerCase()
          );

        if (exists) {

          return sendJson(res, 409, {

            error:
              "Username นี้ถูกใช้แล้ว"

          });

        }

        const passwordData =
          createPassword(password);

        const user = {

          username,

          salt:
            passwordData.salt,

          passwordHash:
            passwordData.passwordHash,

          minecraft: "",

          createdAt:
            new Date().toISOString()

        };

        db.users.push(user);

        if (!saveDatabase()) {

          db.users.pop();

          return sendJson(res, 500, {

            error:
              "ไม่สามารถบันทึกข้อมูลผู้ใช้ได้"

          });

        }

        createSession(res, user);

        return sendJson(res, 201, {

          user:
            publicUser(user)

        });

      }

      // ==================================================
      // LOGIN
      // ==================================================

      if (
        url === "/api/login" &&
        req.method === "POST"
      ) {

        const body =
          await readBody(req);

        const username =
          String(body.username || "");

        const password =
          String(body.password || "");

        const user =
          db.users.find(
            account =>
              String(account.username)
                .toLowerCase() ===
              username.toLowerCase()
          );

        if (
          !user ||
          !checkPassword(password, user)
        ) {

          return sendJson(res, 401, {

            error:
              "Username หรือ Password ไม่ถูกต้อง"

          });

        }

        createSession(res, user);

        return sendJson(res, 200, {

          user:
            publicUser(user)

        });

      }

      // ==================================================
      // LOGOUT
      // ==================================================

      if (
        url === "/api/logout" &&
        req.method === "POST"
      ) {

        deleteSession(req, res);

        return sendJson(res, 200, {
          ok: true
        });

      }

      // ==================================================
      // CURRENT USER
      // ==================================================

      if (
        url === "/api/me" &&
        req.method === "GET"
      ) {

        const user =
          getCurrentUser(req);

        return sendJson(res, 200, {

          user:
            publicUser(user)

        });

      }

      // ==================================================
      // SERVER STATUS
      // ==================================================

      if (
        url === "/api/status" &&
        req.method === "GET"
      ) {

        const status =
          await getMinecraftStatus();

        return sendJson(
          res,
          200,
          status
        );

      }

      // ==================================================
      // GET ORDERS
      // ==================================================

      if (
        url === "/api/orders" &&
        req.method === "GET"
      ) {

        const user =
          getCurrentUser(req);

        if (!user) {

          return sendJson(res, 401, {

            error:
              "กรุณาเข้าสู่ระบบ"

          });

        }

        const orders =
          db.orders
            .filter(
              order =>
                order.username ===
                user.username
            )
            .sort(
              (a, b) =>
                String(b.createdAt)
                  .localeCompare(
                    String(a.createdAt)
                  )
            );

        return sendJson(res, 200, {
          orders
        });

      }

      // ==================================================
      // CREATE SHOP ORDER
      // ==================================================

      if (
        url === "/api/orders" &&
        req.method === "POST"
      ) {

        const user =
          getCurrentUser(req);

        if (!user) {

          return sendJson(res, 401, {

            error:
              "กรุณาเข้าสู่ระบบ"

          });

        }

        const body =
          await readBody(req);

        const product =
          String(body.product || "");

        const price =
          Number(body.price);

        const minecraft =
          clean(body.minecraft);

        if (
          !Object.prototype.hasOwnProperty.call(
            PRODUCTS,
            product
          )
        ) {

          return sendJson(res, 400, {

            error:
              "สินค้าไม่ถูกต้อง"

          });

        }

        if (
          PRODUCTS[product] !== price
        ) {

          return sendJson(res, 400, {

            error:
              "ราคาสินค้าไม่ถูกต้อง"

          });

        }

        if (
          !/^[A-Za-z0-9_]{3,16}$/.test(
            minecraft
          )
        ) {

          return sendJson(res, 400, {

            error:
              "ชื่อ Minecraft ไม่ถูกต้อง"

          });

        }

        const order = {

          id:
            "MARI-" +
            Date.now()
              .toString(36)
              .toUpperCase() +
            "-" +
            crypto
              .randomBytes(2)
              .toString("hex")
              .toUpperCase(),

          username:
            user.username,

          minecraft,

          product,

          price,

          status:
            "PENDING",

          createdAt:
            new Date().toISOString()

        };

        db.orders.push(order);

        const oldMinecraft =
          user.minecraft;

        user.minecraft =
          minecraft;

        if (!saveDatabase()) {

          db.orders.pop();

          user.minecraft =
            oldMinecraft;

          return sendJson(res, 500, {

            error:
              "ไม่สามารถบันทึกคำสั่งซื้อได้"

          });

        }

        return sendJson(res, 201, {
          order
        });

      }

      // ==================================================
      // UNKNOWN API
      // ==================================================

      if (
        url.startsWith("/api/")
      ) {

        return sendJson(res, 404, {

          error:
            "API endpoint not found"

        });

      }

      // ==================================================
      // WEBSITE
      // ==================================================

      return serveWebsite(req, res);

    } catch (error) {

      console.error(
        "Server error:",
        error
      );

      if (!res.headersSent) {

        return sendJson(res, 500, {

          error:
            "Server error"

        });

      }

      res.end();

    }

  }
);

// ======================================================
// SERVER ERROR
// ======================================================

server.on(
  "error",
  error => {

    console.error(
      "HTTP server error:",
      error
    );

    process.exit(1);

  }
);

// ======================================================
// START
// ======================================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================="
    );

    console.log(
      "Mari JP SMP Website Server"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Minecraft: ${MINECRAFT_HOST}:${MINECRAFT_PORT}`
    );

    console.log(
      "Website: index.html"
    );

    console.log(
      "================================="
    );

  }
);
