const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

const PORT = process.env.PORT || 10000;

const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_THIS_SECRET_123456789";

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  "https://minecraft-web-hjrm.onrender.com";

app.use(cors({
  origin: FRONTEND_URL,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());


// =====================================================
// DATABASE ชั่วคราว
// =====================================================

const users = [];
const orders = [];


// =====================================================
// TEST
// =====================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Mari JP SMP Backend is online!",
    time: new Date().toISOString()
  });
});


// =====================================================
// AUTH MIDDLEWARE
// =====================================================

function auth(req, res, next) {

  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({
      error: "กรุณาเข้าสู่ระบบ"
    });
  }

  const token = header.replace("Bearer ", "");

  try {

    const decoded = jwt.verify(token, JWT_SECRET);

    req.userId = decoded.userId;

    next();

  } catch (err) {

    return res.status(401).json({
      error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่"
    });

  }
}


// =====================================================
// REGISTER
// =====================================================

app.post("/api/register", async (req, res) => {

  try {

    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        error: "กรุณากรอก Username และ Password"
      });
    }

    if (username.length < 3 || username.length > 24) {
      return res.status(400).json({
        error: "Username ต้องมี 3-24 ตัวอักษร"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password ต้องมีอย่างน้อย 6 ตัวอักษร"
      });
    }

    const exists = users.find(
      u => u.username.toLowerCase() === username.toLowerCase()
    );

    if (exists) {
      return res.status(409).json({
        error: "Username นี้ถูกใช้งานแล้ว"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = {
      id: String(Date.now()),
      username,
      passwordHash,
      minecraft: null,
      createdAt: new Date().toISOString()
    };

    users.push(user);

    const token = jwt.sign(
      {
        userId: user.id
      },
      JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    res.status(201).json({
      success: true,

      user: {
        id: user.id,
        username: user.username,
        minecraft: user.minecraft
      },

      token
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์"
    });

  }

});


// =====================================================
// LOGIN
// =====================================================

app.post("/api/login", async (req, res) => {

  try {

    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const user = users.find(
      u => u.username.toLowerCase() === username.toLowerCase()
    );

    if (!user) {
      return res.status(401).json({
        error: "Username หรือ Password ไม่ถูกต้อง"
      });
    }

    const valid = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Username หรือ Password ไม่ถูกต้อง"
      });
    }

    const token = jwt.sign(
      {
        userId: user.id
      },
      JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    res.json({
      success: true,

      user: {
        id: user.id,
        username: user.username,
        minecraft: user.minecraft
      },

      token
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์"
    });

  }

});


// =====================================================
// ME
// =====================================================

app.get("/api/me", auth, (req, res) => {

  const user = users.find(
    u => u.id === req.userId
  );

  if (!user) {
    return res.status(404).json({
      error: "ไม่พบผู้ใช้"
    });
  }

  res.json({
    user: {
      id: user.id,
      username: user.username,
      minecraft: user.minecraft
    }
  });

});


// =====================================================
// LOGOUT
// =====================================================

app.post("/api/logout", (req, res) => {

  res.json({
    success: true,
    message: "ออกจากระบบแล้ว"
  });

});


// =====================================================
// ORDERS
// =====================================================

app.get("/api/orders", auth, (req, res) => {

  const userOrders = orders.filter(
    order => order.userId === req.userId
  );

  res.json({
    orders: userOrders
  });

});


app.post("/api/orders", auth, (req, res) => {

  const product = String(req.body.product || "").trim();
  const price = Number(req.body.price || 0);
  const minecraft = String(req.body.minecraft || "").trim();

  if (!product || !minecraft) {

    return res.status(400).json({
      error: "ข้อมูลสินค้าไม่ครบ"
    });

  }

  const order = {

    id:
      "MARI-" +
      Date.now(),

    userId: req.userId,

    product,

    price,

    minecraft,

    status: "รอตรวจสอบ",

    createdAt:
      new Date().toISOString()

  };

  orders.push(order);

  res.status(201).json({
    success: true,
    order
  });

});


// =====================================================
// 404
// =====================================================

app.use((req, res) => {

  res.status(404).json({
    error: "ไม่พบ API นี้"
  });

});


// =====================================================
// START
// =====================================================

app.listen(PORT, "0.0.0.0", () => {

  console.log(
    `Mari JP SMP Backend running on port ${PORT}`
  );

});
