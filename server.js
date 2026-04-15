require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mysql = require("mysql2");
const multer = require("multer");
const path = require("path");
const { Resend } = require("resend");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// =======================
// RESEND EMAIL
// =======================
const resend = new Resend(process.env.RESEND_API_KEY);

// =======================
// MIDDLEWARE
// =======================
app.use(express.static(__dirname));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// FIXED: cross-platform uploads folder (Render-safe)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// =======================
// MULTER CONFIG
// =======================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// =======================
// MYSQL (Render-safe via env vars)
// =======================
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect(err => {
    if (err) {
        console.error("DB Connection Error:", err);
    } else {
        console.log("Connected to MySQL");
    }
});

// =======================
// TEMP STORAGE
// =======================
const verificationCodes = {};
const loginAttempts = {};
const verifyAttempts = {};

// =======================
// LOGIN (SEND CODE)
// =======================
app.post("/login", async (req, res) => {
    const email = req.body.email.trim().toLowerCase();

    if (loginAttempts[email]?.lastRequest) {
        const diff = Date.now() - loginAttempts[email].lastRequest;
        if (diff < 30000) {
            return res.json({ success: false, message: "Please wait before requesting another code." });
        }
    }

    loginAttempts[email] = { lastRequest: Date.now() };

    if (!email.endsWith("@umb.edu")) {
        return res.json({ success: false, message: "Only UMB emails allowed" });
    }

    const code = Math.floor(100000 + Math.random() * 900000);
    verificationCodes[email] = code;

    setTimeout(() => {
        delete verificationCodes[email];
        delete loginAttempts[email];
        delete verifyAttempts[email];
    }, 10 * 60 * 1000);

    try {
        await resend.emails.send({
            from: "UMB Exchange <onboarding@resend.dev>",
            to: email,
            subject: "Your UMB Exchange Verification Code",
            html: `<h2>Your code: ${code}</h2>`,
            text: `Your verification code is: ${code}`
        });

        res.json({ success: true, message: "Verification code sent" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Error sending email" });
    }
});

// =======================
// VERIFY CODE
// =======================
app.post("/verify-code", (req, res) => {
    const email = req.body.email.trim().toLowerCase();
    const code = req.body.code;

    verifyAttempts[email] = (verifyAttempts[email] || 0) + 1;
    if (verifyAttempts[email] > 5) {
        return res.json({ success: false, message: "Too many attempts" });
    }

    if (!verificationCodes[email]) {
        return res.json({ success: false, message: "Code expired or not found" });
    }

    if (verificationCodes[email] != code) {
        return res.json({ success: false, message: "Invalid code" });
    }

    delete verificationCodes[email];
    delete verifyAttempts[email];

    const sql = `INSERT INTO users (email) VALUES (?) ON DUPLICATE KEY UPDATE email=email`;

    db.query(sql, [email], (err) => {
        if (err) return res.json({ success: false });

        db.query("SELECT id FROM users WHERE email = ?", [email], (err, rows) => {
            if (err || rows.length === 0) {
                return res.json({ success: false });
            }

            res.json({
                success: true,
                user_id: rows[0].id,
                email
            });
        });
    });
});

// =======================
// CREATE LISTING
// =======================
app.post("/createListing", upload.single("image"), (req, res) => {
    const {
        course_code,
        title,
        edition,
        price,
        book_condition,
        rating,
        description,
        seller_email,
        seller_id
    } = req.body;

    const image = req.file ? req.file.filename : null;

    if (!seller_email || !seller_id) {
        return res.json({ success: false, message: "User not logged in" });
    }

    const sql = `
        INSERT INTO listings 
        (course_code, title, edition, price, book_condition, rating, description, seller_email, seller_id, image)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        course_code,
        title,
        edition || null,
        price,
        book_condition,
        rating || null,
        description || null,
        seller_email,
        seller_id,
        image
    ], (err) => {
        if (err) {
            console.error(err);
            return res.json({ success: false });
        }

        io.emit("newListing");
        res.json({ success: true });
    });
});

// =======================
// GET LISTINGS
// =======================
app.get("/getListings", (req, res) => {
    const course = req.query.course;

    let sql = "SELECT * FROM listings";
    const params = [];

    if (course) {
        sql += " WHERE course_code = ?";
        params.push(course);
    }

    sql += " ORDER BY created_at DESC";

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error("GET LISTINGS ERROR:", err);
            return res.json([]);
        }
        res.json(results);
    });
});

// =======================
// DELETE LISTING
// =======================
app.post("/deleteListing", (req, res) => {
    const { id, seller_email } = req.body;

    const sql = "DELETE FROM listings WHERE id = ? AND seller_email = ?";

    db.query(sql, [id, seller_email], (err) => {
        if (err) return res.json({ success: false });

        io.emit("newListing");
        res.json({ success: true });
    });
});

// =======================
// SOCKET.IO
// =======================
io.on("connection", (socket) => {
    socket.on("joinRoom", (room) => socket.join(room));

    socket.on("sendMessage", (data) => {
        db.query(
            "INSERT INTO messages (sender_id, receiver_id, message, listing_id, course_code, book_title) VALUES (?, ?, ?, ?, ?, ?)",
            [
                data.sender_id,
                data.receiver_id,
                data.message,
                data.listing_id || null,
                data.course_code || null,
                data.book_title || null
            ]
        );

        io.to(data.room).emit("receiveMessage", {
            ...data,
            listing_id: data.listing_id || null,
            timestamp: new Date().toISOString()
        });
    });
});

// =======================
// START SERVER (ONLY ONCE)
// =======================
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});