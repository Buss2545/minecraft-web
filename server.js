const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB = path.join(ROOT, 'data.json');

const FRONTEND_ORIGIN =
  'https://buss2545.github.io';

const MINECRAFT_SERVER =
  'marijp2006.svmine.com:11206';


/* ========================================
   DATABASE
======================================== */

let db = {
  users: [],
  orders: []
};

try {
  if (fs.existsSync(DB)) {
    const raw = fs.readFileSync(DB, 'utf8');

    if (raw.trim()) {
      db = JSON.parse(raw);
    }
  }
} catch (error) {
  console.error('data.json error:', error);

  db = {
    users: [],
    orders: []
  };
}

if (!Array.isArray(db.users)) {
  db.users = [];
}

if (!Array.isArray(db.orders)) {
  db.orders = [];
}


/* ========================================
   SESSION
======================================== */

const sessions = new Map();


/* ========================================
   SAVE DATABASE
======================================== */

function save() {
  fs.writeFileSync(
    DB,
    JSON.stringify(db, null, 2),
    'utf8'
  );
}


/* ========================================
   PASSWORD HASH
======================================== */

function hash(
  password,
  salt = crypto
    .randomBytes(16)
    .toString('hex')
) {
  return {
    salt,

    hash: crypto
      .scryptSync(
        password,
        salt,
        64
      )
      .toString('hex')
  };
}


function verify(password, account) {
  try {
    if (
      !account ||
      !account.salt ||
      !account.passwordHash
    ) {
      return false;
    }

    const calculated =
      crypto
        .scryptSync(
          password,
          account.salt,
          64
        )
        .toString('hex');

    const a =
      Buffer.from(
        calculated,
        'hex'
      );

    const b =
      Buffer.from(
        account.passwordHash,
        'hex'
      );

    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      a,
      b
    );

  } catch {
    return false;
  }
}


/* ========================================
   JSON RESPONSE
======================================== */

function json(res, code, object) {
  res.writeHead(
    code,
    {
      'Content-Type':
        'application/json; charset=utf-8',

      'Access-Control-Allow-Origin':
        FRONTEND_ORIGIN,

      'Access-Control-Allow-Credentials':
        'true',

      'Access-Control-Allow-Headers':
        'Content-Type',

      'Access-Control-Allow-Methods':
        'GET, POST, OPTIONS',

      'Cache-Control':
        'no-store'
    }
  );

  res.end(
    JSON.stringify(object)
  );
}


/* ========================================
   REQUEST BODY
======================================== */

function body(req) {
  return new Promise(
    (resolve, reject) => {

      let data = '';

      req.on(
        'data',
        chunk => {

          data += chunk;

          if (
            data.length >
            1000000
          ) {
            reject(
              new Error(
                'Request too large'
              )
            );

            req.destroy();
          }
        }
      );

      req.on(
        'end',
        () => {

          try {
            resolve(
              JSON.parse(
                data || '{}'
              )
            );
          } catch {
            reject(
              new Error(
                'Invalid JSON'
              )
            );
          }

        }
      );

      req.on(
        'error',
        reject
      );

    }
  );
}


/* ========================================
   ESCAPE INPUT
======================================== */

function esc(value) {
  return String(value)
    .replace(
      /[<>]/g,
      ''
    );
}


/* ========================================
   GET USER FROM SESSION
======================================== */

function user(req) {
  const cookie =
    req.headers.cookie || '';

  const match =
    cookie.match(
      /(?:^|;\s*)sid=([^;]+)/
    );

  if (!match) {
    return null;
  }

  return (
    sessions.get(
      match[1]
    ) || null
  );
}


/* ========================================
   CLEAN USER
======================================== */

function clean(account) {
  if (!account) {
    return null;
  }

  return {
    username:
      account.username,

    minecraft:
      account.minecraft || '',

    createdAt:
      account.createdAt
  };
}


/* ========================================
   CREATE SESSION
======================================== */

function createSession(
  res,
  account
) {
  const sid =
    crypto
      .randomBytes(32)
      .toString('hex');

  sessions.set(
    sid,
    account
  );

  res.setHeader(
    'Set-Cookie',
    [
      `sid=${sid}`,
      'HttpOnly',
      'Secure',
      'SameSite=None',
      'Path=/',
      'Max-Age=604800'
    ].join('; ')
  );
}


/* ========================================
   MINECRAFT STATUS
======================================== */

async function getMinecraftStatus() {

  return new Promise(
    resolve => {

      const requestPath =
        '/3/' +
        encodeURIComponent(
          MINECRAFT_SERVER
        );

      const request =
        http.get(
          {
            host:
              'api.mcsrvstat.us',

            path:
              requestPath,

            headers: {
              'User-Agent':
                'MariJPSMP/1.0'
            }
          },

          response => {

            let data = '';

            response.on(
              'data',
              chunk => {
                data += chunk;
              }
            );

            response.on(
              'end',
              () => {

                try {

                  const result =
                    JSON.parse(
                      data
                    );

                  resolve({
                    online:
                      !!result.online,

                    players:
                      result.players ||
                      {
                        online: 0,
                        max: 0
                      },

                    version:
                      result.version ||
                      '-',

                    motd:
                      result.motd
                        ?.clean
                        ?.join(' ') ||
                      ''
                  });

                } catch {

                  resolve({
                    online: false,

                    players: {
                      online: 0,
                      max: 0
                    },

                    version:
                      '-',

                    motd:
                      ''
                  });

                }

              }
            );

          }
        );


      request.on(
        'error',
        () => {

          resolve({
            online: false,

            players: {
              online: 0,
              max: 0
            },

            version:
              '-',

            motd:
              ''
          });

        }
      );


      request.setTimeout(
        5000,
        () => {

          request.destroy();

          resolve({
            online: false,

            players: {
              online: 0,
              max: 0
            },

            version:
              '-',

            motd:
              ''
          });

        }
      );

    }
  );
}


/* ========================================
   HTTP SERVER
======================================== */

const server =
  http.createServer(
    async (req, res) => {

      try {

        /* ==================================
           CORS OPTIONS
        ================================== */

        if (
          req.method ===
          'OPTIONS'
        ) {

          res.writeHead(
            204,
            {
              'Access-Control-Allow-Origin':
                FRONTEND_ORIGIN,

              'Access-Control-Allow-Credentials':
                'true',

              'Access-Control-Allow-Headers':
                'Content-Type',

              'Access-Control-Allow-Methods':
                'GET, POST, OPTIONS'
            }
          );

          return res.end();
        }


        /* ==================================
           REGISTER
        ================================== */

        if (
          req.url ===
            '/api/register' &&
          req.method ===
            'POST'
        ) {

          const data =
            await body(req);

          const username =
            esc(
              data.username ||
              ''
            ).trim();

          const password =
            String(
              data.password ||
              ''
            );


          if (
            !/^[A-Za-z0-9_]{3,24}$/.test(
              username
            )
          ) {

            return json(
              res,
              400,
              {
                error:
                  'Username ต้องเป็น A-Z, 0-9 หรือ _ และยาว 3-24 ตัว'
              }
            );
          }


          if (
            password.length <
            6
          ) {

            return json(
              res,
              400,
              {
                error:
                  'Password ต้องมีอย่างน้อย 6 ตัว'
              }
            );
          }


          const exists =
            db.users.some(
              account =>
                account.username
                  .toLowerCase() ===
                username.toLowerCase()
            );


          if (exists) {

            return json(
              res,
              409,
              {
                error:
                  'Username นี้ถูกใช้แล้ว'
              }
            );
          }


          const passwordData =
            hash(password);


          const account = {

            username,

            salt:
              passwordData.salt,

            passwordHash:
              passwordData.hash,

            minecraft:
              '',

            createdAt:
              new Date()
                .toISOString()

          };


          db.users.push(
            account
          );

          save();

          createSession(
            res,
            account
          );


          return json(
            res,
            201,
            {
              user:
                clean(account)
            }
          );
        }


        /* ==================================
           LOGIN
        ================================== */

        if (
          req.url ===
            '/api/login' &&
          req.method ===
            'POST'
        ) {

          const data =
            await body(req);

          const username =
            String(
              data.username ||
              ''
            );

          const password =
            String(
              data.password ||
              ''
            );


          const account =
            db.users.find(
              item =>
                item.username
                  .toLowerCase() ===
                username.toLowerCase()
            );


          if (
            !account ||
            !verify(
              password,
              account
            )
          ) {

            return json(
              res,
              401,
              {
                error:
                  'Username หรือ Password ไม่ถูกต้อง'
              }
            );
          }


          createSession(
            res,
            account
          );


          return json(
            res,
            200,
            {
              user:
                clean(account)
            }
          );
        }


        /* ==================================
           LOGOUT
        ================================== */

        if (
          req.url ===
            '/api/logout' &&
          req.method ===
            'POST'
        ) {

          const cookie =
            req.headers.cookie ||
            '';

          const match =
            cookie.match(
              /(?:^|;\s*)sid=([^;]+)/
            );


          if (match) {

            sessions.delete(
              match[1]
            );

          }


          res.setHeader(
            'Set-Cookie',
            [
              'sid=',
              'HttpOnly',
              'Secure',
              'SameSite=None',
              'Path=/',
              'Max-Age=0'
            ].join('; ')
          );


          return json(
            res,
            200,
            {
              ok: true
            }
          );
        }


        /* ==================================
           CURRENT USER
        ================================== */

        if (
          req.url ===
            '/api/me' &&
          req.method ===
            'GET'
        ) {

          const account =
            user(req);


          return json(
            res,
            200,
            {
              user:
                clean(account)
            }
          );
        }


        /* ==================================
           MINECRAFT STATUS
        ================================== */

        if (
          req.url ===
            '/api/status' &&
          req.method ===
            'GET'
        ) {

          const result =
            await getMinecraftStatus();


          return json(
            res,
            200,
            result
          );
        }


        /* ==================================
           GET ORDERS
        ================================== */

        if (
          req.url ===
            '/api/orders' &&
          req.method ===
            'GET'
        ) {

          const account =
            user(req);


          if (!account) {

            return json(
              res,
              401,
              {
                error:
                  'กรุณาเข้าสู่ระบบ'
              }
            );
          }


          const orders =
            db.orders
              .filter(
                order =>
                  order.username ===
                  account.username
              )
              .sort(
                (a, b) =>
                  b.createdAt.localeCompare(
                    a.createdAt
                  )
              );


          return json(
            res,
            200,
            {
              orders
            }
          );
        }


        /* ==================================
           CREATE ORDER
        ================================== */

        if (
          req.url ===
            '/api/orders' &&
          req.method ===
            'POST'
        ) {

          const account =
            user(req);


          if (!account) {

            return json(
              res,
              401,
              {
                error:
                  'กรุณาเข้าสู่ระบบ'
              }
            );
          }


          const data =
            await body(req);


          const products = {

            VIP:
              50,

            'VIP+':
              100,

            MVP:
              150,

            'MVP+':
              200,

            LEGEND:
              500,

            EMPEROR:
              1000

          };


          const product =
            String(
              data.product ||
              ''
            );


          const price =
            Number(
              data.price
            );


          const minecraft =
            esc(
              data.minecraft ||
              ''
            ).trim();


          if (
            !Object.prototype.hasOwnProperty.call(
              products,
              product
            )
          ) {

            return json(
              res,
              400,
              {
                error:
                  'สินค้าไม่ถูกต้อง'
              }
            );
          }


          if (
            products[product] !==
            price
          ) {

            return json(
              res,
              400,
              {
                error:
                  'ราคาสินค้าไม่ถูกต้อง'
              }
            );
          }


          if (
            !/^[A-Za-z0-9_]{3,16}$/.test(
              minecraft
            )
          ) {

            return json(
              res,
              400,
              {
                error:
                  'ชื่อ Minecraft ไม่ถูกต้อง'
              }
            );
          }


          const order = {

            id:
              'MARI-' +
              Date.now()
                .toString(36)
                .toUpperCase() +
              '-' +
              crypto
                .randomBytes(2)
                .toString('hex')
                .toUpperCase(),

            username:
              account.username,

            minecraft:
              minecraft,

            product:
              product,

            price:
              price,

            status:
              'PENDING',

            createdAt:
              new Date()
                .toISOString()

          };


          db.orders.push(
            order
          );

          account.minecraft =
            minecraft;

          save();


          return json(
            res,
            201,
            {
              order
            }
          );
        }


        /* ==================================
           UNKNOWN API
        ================================== */

        if (
          req.url.startsWith(
            '/api/'
          )
        ) {

          return json(
            res,
            404,
            {
              error:
                'Not found'
            }
          );
        }


        /* ==================================
           WEBSITE
           
           ใช้ index.html เท่านั้น
           ไม่มี index(2).html
        ================================== */

        let file =
          req.url === '/'
            ? '/index.html'
            : decodeURIComponent(
                req.url.split('?')[0]
              );


        if (
          file.includes('..')
        ) {

          return json(
            res,
            400,
            {
              error:
                'bad path'
            }
          );
        }


        let filePath =
          path.join(
            ROOT,
            file
          );


        /* ==================================
           FALLBACK
           
           ถ้าไม่พบไฟล์
           ให้กลับไป index.html
        ================================== */

        if (
          !fs.existsSync(
            filePath
          ) ||
          fs.statSync(
            filePath
          ).isDirectory()
        ) {

          filePath =
            path.join(
              ROOT,
              'index.html'
            );
        }


        /* ==================================
           CONTENT TYPE
        ================================== */

        const extension =
          path.extname(
            filePath
          ).toLowerCase();


        const types = {

          '.html':
            'text/html; charset=utf-8',

          '.js':
            'text/javascript; charset=utf-8',

          '.css':
            'text/css; charset=utf-8',

          '.json':
            'application/json; charset=utf-8',

          '.png':
            'image/png',

          '.jpg':
            'image/jpeg',

          '.jpeg':
            'image/jpeg',

          '.webp':
            'image/webp',

          '.svg':
            'image/svg+xml',

          '.ico':
            'image/x-icon'

        };


        res.writeHead(
          200,
          {
            'Content-Type':
              types[
                extension
              ] ||
              'application/octet-stream'
          }
        );


        fs  password,
  salt = crypto.randomBytes(16).toString('hex')
) {
  return {
    salt: salt,
    hash: crypto
      .scryptSync(password, salt, 64)
      .toString('hex')
  };
}

function verify(password, user) {
  const calculated = crypto
    .scryptSync(password, user.salt, 64)
    .toString('hex');

  const a = Buffer.from(calculated, 'hex');
  const b = Buffer.from(user.passwordHash, 'hex');

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type':
      'application/json; charset=utf-8',

    'Access-Control-Allow-Origin':
      '*',

    'Access-Control-Allow-Credentials':
      'true',

    'Cache-Control':
      'no-store'
  });

  res.end(
    JSON.stringify(obj)
  );
}

function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', chunk => {
      data += chunk;

      if (data.length > 1000000) {
        req.destroy();

        reject(
          new Error('Request too large')
        );
      }
    });

    req.on('end', () => {
      try {
        resolve(
          JSON.parse(data || '{}')
        );
      } catch {
        reject(
          new Error('Invalid JSON')
        );
      }
    });
  });
}

function user(req) {
  const cookie =
    req.headers.cookie || '';

  const match =
    cookie.match(/sid=([^;]+)/);

  if (!match) {
    return null;
  }

  return (
    sessions.get(match[1]) ||
    null
  );
}

function clean(user) {
  if (!user) {
    return null;
  }

  return {
    username: user.username,
    minecraft: user.minecraft || '',
    createdAt: user.createdAt
  };
}

function session(res, user) {
  const sid =
    crypto.randomBytes(32).toString('hex');

  sessions.set(
    sid,
    user
  );

  res.setHeader(
    'Set-Cookie',
    `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
  );
}

function esc(value) {
  return String(value)
    .replace(/[<>]/g, '');
}

/*
========================================
Minecraft Server Status
========================================
*/

async function status() {
  return await new Promise(resolve => {

    const host =
      'api.mcsrvstat.us';

    const serverAddress =
      'marijp2006.svmine.com:11206';

    const requestPath =
      '/3/' +
      encodeURIComponent(
        serverAddress
      );

    const request =
      http.get(
        {
          host: host,
          path: requestPath,
          headers: {
            'User-Agent':
              'MariJPSMP/1.0'
          }
        },

        response => {

          let data = '';

          response.on(
            'data',
            chunk => {
              data += chunk;
            }
          );

          response.on(
            'end',
            () => {

              try {

                const result =
                  JSON.parse(data);

                resolve({
                  online:
                    !!result.online,

                  players:
                    result.players || {},

                  version:
                    result.version || '-',

                  motd:
                    result.motd?.clean?.join(' ') || ''
                });

              } catch {

                resolve({
                  online: false,
                  players: {},
                  version: '-',
                  motd: ''
                });

              }

            }
          );

        }
      );

    request.on(
      'error',
      () => {
        resolve({
          online: false,
          players: {},
          version: '-',
          motd: ''
        });
      }
    );

    request.setTimeout(
      5000,
      () => {

        request.destroy();

        resolve({
          online: false,
          players: {},
          version: '-',
          motd: ''
        });

      }
    );

  });
}


/*
========================================
HTTP Server
========================================
*/

const server =
  http.createServer(
    async (req, res) => {

      try {

        /*
        ================================
        CORS
        ================================
        */

        if (
          req.method ===
          'OPTIONS'
        ) {

          res.writeHead(
            204,
            {
              'Access-Control-Allow-Origin':
                '*',

              'Access-Control-Allow-Headers':
                'Content-Type',

              'Access-Control-Allow-Credentials':
                'true'
            }
          );

          return res.end();
        }


        /*
        ================================
        REGISTER
        ================================
        */

        if (
          req.url ===
            '/api/register' &&
          req.method ===
            'POST'
        ) {

          const data =
            await body(req);

          const name =
            esc(
              data.username || ''
            ).trim();

          const password =
            String(
              data.password || ''
            );


          if (
            !/^[A-Za-z0-9_]{3,24}$/.test(
              name
            )
          ) {

            return json(
              res,
              400,
              {
                error:
                  'Username ต้องเป็น A-Z, 0-9 หรือ _ และยาว 3-24 ตัว'
              }
            );

          }


          if (
            password.length < 6
          ) {

            return json(
              res,
              400,
              {
                error:
                  'Password ต้องมีอย่างน้อย 6 ตัว'
              }
            );

          }


          const exists =
            db.users.some(
              item =>
                item.username
                  .toLowerCase() ===
                name.toLowerCase()
            );


          if (exists) {

            return json(
              res,
              409,
              {
                error:
                  'Username นี้ถูกใช้แล้ว'
              }
            );

          }


          const passwordData =
            hash(password);


          const newUser = {

            username: name,

            salt:
              passwordData.salt,

            passwordHash:
              passwordData.hash,

            minecraft: '',

            createdAt:
              new Date().toISOString()

          };


          db.users.push(
            newUser
          );

          save();

          session(
            res,
            newUser
          );


          return json(
            res,
            201,
            {
              user:
                clean(newUser)
            }
          );

        }


        /*
        ================================
        LOGIN
        ================================
        */

        if (
          req.url ===
            '/api/login' &&
          req.method ===
            'POST'
        ) {

          const data =
            await body(req);

          const username =
            String(
              data.username || ''
            );

          const password =
            String(
              data.password || ''
            );


          const foundUser =
            db.users.find(
              item =>
                item.username
                  .toLowerCase() ===
                username.toLowerCase()
            );


          if (
            !foundUser ||
            !verify(
              password,
              foundUser
            )
          ) {

            return json(
              res,
              401,
              {
                error:
                  'Username หรือ Password ไม่ถูกต้อง'
              }
            );

          }


          session(
            res,
            foundUser
          );


          return json(
            res,
            200,
            {
              user:
                clean(foundUser)
            }
          );

        }


        /*
        ================================
        LOGOUT
        ================================
        */

        if (
          req.url ===
            '/api/logout' &&
          req.method ===
            'POST'
        ) {

          const cookie =
            req.headers.cookie ||
            '';

          const match =
            cookie.match(
              /sid=([^;]+)/
            );


          if (match) {
            sessions.delete(
              match[1]
            );
          }


          res.setHeader(
            'Set-Cookie',
            'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
          );


          return json(
            res,
            200,
            {
              ok: true
            }
          );

        }


        /*
        ================================
        CURRENT USER
        ================================
        */

        if (
          req.url ===
            '/api/me'
        ) {

          const currentUser =
            user(req);


          return json(
            res,
            200,
            {
              user:
                clean(currentUser)
            }
          );

        }


        /*
        ================================
        MINECRAFT STATUS
        ================================
        */

        if (
          req.url ===
            '/api/status'
        ) {

          const serverStatus =
            await status();


          return json(
            res,
            200,
            serverStatus
          );

        }


        /*
        ================================
        GET ORDERS
        ================================
        */

        if (
          req.url ===
            '/api/orders' &&
          req.method ===
            'GET'
        ) {

          const currentUser =
            user(req);


          if (!currentUser) {

            return json(
              res,
              401,
              {
                error:
                  'กรุณาเข้าสู่ระบบ'
              }
            );

          }


          const orders =
            db.orders
              .filter(
                item =>
                  item.username ===
                  currentUser.username
              )
              .sort(
                (a, b) =>
                  b.createdAt.localeCompare(
                    a.createdAt
                  )
              );


          return json(
            res,
            200,
            {
              orders
            }
          );

        }


        /*
        ================================
        CREATE ORDER
        ================================
        */

        if (
          req.url ===
            '/api/orders' &&
          req.method ===
            'POST'
        ) {

          const currentUser =
            user(req);


          if (!currentUser) {

            return json(
              res,
              401,
              {
                error:
                  'กรุณาเข้าสู่ระบบ'
              }
            );

          }


          const data =
            await body(req);


          const products = {

            VIP: 50,

            'VIP+': 100,

            MVP: 150,

            'MVP+': 200,

            LEGEND: 500,

            EMPEROR: 1000

          };


          const product =
            String(
              data.product || ''
            );


          const price =
            Number(
              data.price
            );


          const minecraft =
            esc(
              data.minecraft || ''
            ).trim();


          if (
            products[product] !==
            price
          ) {

            return json(
              res,
              400,
              {
                error:
                  'สินค้าไม่ถูกต้อง'
              }
            );

          }


          if (
            !/^[A-Za-z0-9_]{3,16}$/.test(
              minecraft
            )
          ) {

            return json(
              res,
              400,
              {
                error:
                  'ชื่อ Minecraft ไม่ถูกต้อง'
              }
            );

          }


          const order = {

            id:
              'MARI-' +
              Date.now()
                .toString(36)
                .toUpperCase() +
              '-' +
              crypto
                .randomBytes(2)
                .toString('hex')
                .toUpperCase(),

            username:
              currentUser.username,

            minecraft:
              minecraft,

            product:
              product,

            price:
              price,

            status:
              'PENDING',

            createdAt:
              new Date().toISOString()

          };


          db.orders.push(
            order
          );

          currentUser.minecraft =
            minecraft;

          save();


          return json(
            res,
            201,
            {
              order
            }
          );

        }


        /*
        ================================
        UNKNOWN API
        ================================
        */

        if (
          req.url.startsWith(
            '/api/'
          )
        ) {

          return json(
            res,
            404,
            {
              error:
                'Not found'
            }
          );

        }


        /*
        ================================
        STATIC WEBSITE
        ================================
        */

        let file =
          req.url === '/'
            ? '/index.html'
            : decodeURIComponent(
                req.url.split('?')[0]
              );


        if (
          file.includes('..')
        ) {

          return json(
            res,
            400,
            {
              error:
                'bad path'
            }
          );

        }


        let filePath =
          path.join(
            ROOT,
            file
          );


        /*
        ถ้าหาไฟล์ไม่เจอ
        ให้ใช้ index.html
        */

        if (
          !fs.existsSync(
            filePath
          ) ||
          fs.statSync(
            filePath
          ).isDirectory()
        ) {

          filePath =
            path.join(
              ROOT,
              'index.html'
            );

        }


        const extension =
          path.extname(
            filePath
          );


        const contentTypes = {

          '.html':
            'text/html; charset=utf-8',

          '.js':
            'text/javascript; charset=utf-8',

          '.css':
            'text/css; charset=utf-8',

          '.json':
            'application/json; charset=utf-8',

          '.png':
            'image/png',

          '.jpg':
            'image/jpeg',

          '.jpeg':
            'image/jpeg',

          '.svg':
            'image/svg+xml',

          '.ico':
            'image/x-icon'

        };


        res.writeHead(
          200,
          {
            'Content-Type':
              contentTypes[
                extension
              ] ||
              'application/octet-stream'
          }
        );


        fs.createReadStream(
          filePath
        ).pipe(res);


      } catch (error) {

        console.error(
          error
        );

        return json(
          res,
          500,
          {
            error:
              'Server error'
          }
        );

      }

    }
  );


/*
========================================
START SERVER
========================================
*/

server.listen(
  PORT,
  () => {

    console.log(
      `Mari JP SMP website: http://localhost:${PORT}`
    );

  }
);function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => {
      s += c;
      if (s.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(s || '{}'));
      } catch {
        reject();
      }
    });
  });
}

function user(req) {
  const c = req.headers.cookie || '';
  const m = c.match(/sid=([^;]+)/);
  return m ? sessions.get(m[1]) : null;
}

function clean(u) {
  return u ? { username: u.username, minecraft: u.minecraft || '', createdAt: u.createdAt } : null;
}

function session(res, u) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, u);
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function esc(s) {
  return String(s).replace(/[<>]/g, '');
}

async function status() {
  return await new Promise(resolve => {
    const host = 'api.mcsrvstat.us';
    const p = '/3/' + encodeURIComponent('marijp2006.svmine.com:11206');
    const r = http.get({ host, path: p, headers: { 'User-Agent': 'MariJPSMP/1.0' } }, x => {
      let s = '';
      x.on('data', c => (s += c));
      x.on('end', () => {
        try {
          const d = JSON.parse(s);
          resolve({
            online: !!d.online,
            players: d.players || {},
            version: d.version || '-',
            motd: d.motd?.clean?.join(' ') || ''
          });
        } catch {
          resolve({ online: false });
        }
      });
    });
    r.on('error', () => resolve({ online: false }));
    r.setTimeout(5000, () => {
      r.destroy();
      resolve({ online: false });
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // CORS Preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true'
      });
      return res.end();
    }

    // Register
    if (req.url === '/api/register' && req.method === 'POST') {
      const b = await body(req);
      const name = esc(b.username || '').trim();
      const pass = String(b.password || '');

      if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) {
        return json(res, 400, { error: 'Username ต้องเป็น A-Z, 0-9 หรือ _ และยาว 3-24 ตัว' });
      }
      if (pass.length < 6) {
        return json(res, 400, { error: 'Password ต้องมีอย่างน้อย 6 ตัว' });
      }
      if (db.users.some(x => x.username.toLowerCase() === name.toLowerCase())) {
        return json(res, 409, { error: 'Username นี้ถูกใช้แล้ว' });
      }

      const h = hash(pass);
      const u = {
        username: name,
        salt: h.salt,
        passwordHash: h.hash,
        minecraft: '',
        createdAt: new Date().toISOString()
      };
      db.users.push(u);
      save();
      session(res, u);
      return json(res, 201, { user: clean(u) });
    }

    // Login
    if (req.url === '/api/login' && req.method === 'POST') {
      const b = await body(req);
      const u = db.users.find(x => x.username.toLowerCase() === String(b.username || '').toLowerCase());
      if (!u || !verify(String(b.password || ''), u)) {
        return json(res, 401, { error: 'Username หรือ Password ไม่ถูกต้อง' });
      }
      session(res, u);
      return json(res, 200, { user: clean(u) });
    }

    // Logout
    if (req.url === '/api/logout' && req.method === 'POST') {
      const c = req.headers.cookie || '';
      const m = c.match(/sid=([^;]+)/);
      if (m) sessions.delete(m[1]);
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }

    // Current User Data
    if (req.url === '/api/me') {
      const u = user(req);
      return json(res, 200, { user: clean(u) });
    }

    // Server Status
    if (req.url === '/api/status') {
      return json(res, 200, await status());
    }

    // Get Orders
    if (req.url === '/api/orders' && req.method === 'GET') {
      const u = user(req);
      if (!u) return json(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
      return json(res, 200, {
        orders: db.orders
          .filter(x => x.username === u.username)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      });
    }

    // Create Order
    if (req.url === '/api/orders' && req.method === 'POST') {
      const u = user(req);
      if (!u) return json(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });

      const b = await body(req);
      const products = { VIP: 50, 'VIP+': 100, MVP: 150, 'MVP+': 200, LEGEND: 500, EMPEROR: 1000 };
      const product = String(b.product || '');
      const price = Number(b.price);
      const mc = esc(b.minecraft || '').trim();

      if (products[product] !== price) {
        return json(res, 400, { error: 'สินค้าไม่ถูกต้อง' });
      }
      if (!/^[A-Za-z0-9_]{3,16}$/.test(mc)) {
        return json(res, 400, { error: 'ชื่อ Minecraft ไม่ถูกต้อง' });
      }

      const o = {
        id: 'MARI-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(),
        username: u.username,
        minecraft: mc,
        product,
        price,
        status: 'PENDING',
        createdAt: new Date().toISOString()
      };
      db.orders.push(o);
      u.minecraft = mc;
      save();
      return json(res, 201, { order: o });
    }

    // Unknown API
    if (req.url.startsWith('/api/')) {
      return json(res, 404, { error: 'Not found' });
    }

    // Static Files Server
    let file = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
    if (file.includes('..')) {
      return json(res, 400, { error: 'bad path' });
    }

    let fp = path.join(ROOT, file);
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      fp = path.join(ROOT, 'index.html');
    }

    const ext = path.extname(fp);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json'
    };

    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    json(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => console.log(`Mari JP SMP website: http://localhost:${PORT}`));
        fs.createReadStream(fp).pipe(res)
    } catch (e) { json(res, 500, { error: 'Server error' }) }
});

server.listen(PORT, () => console.log(`Mari JP SMP website: http://localhost:${PORT}`));
