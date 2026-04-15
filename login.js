let emailGlobal = "";
let resendCooldown = false;

// =======================
// LOGIN SUBMIT
// =======================
document.getElementById("loginForm").addEventListener("submit", function(e){
    e.preventDefault();

    const emailInput = document.getElementById("email");
    const email = emailInput.value.trim().toLowerCase();

    if(!email.endsWith("@umb.edu")){
        document.getElementById("message").innerText = "Only UMB students can login.";
        return;
    }

    emailGlobal = email;

    sendCode(email);
});

// =======================
// SEND CODE (USED FOR LOGIN + RESEND)
// =======================
function sendCode(email) {
    fetch("/login", {
        method: "POST",
        headers: {
            "Content-Type":"application/json"
        },
        body: JSON.stringify({ email })
    })
    .then(res => res.json())
    .then(data => {

        document.getElementById("message").innerText = 
            "Verification code sent! Check your inbox.";

        if(data.success){
            showCodeInput();
            startResendCooldown();
        }
    });
}

// =======================
// SHOW CODE SCREEN
// =======================
function showCodeInput() {

    const form = document.getElementById("loginForm");

    // 🔥 HIDE email form completely
    form.style.display = "none";

    // prevent duplicates
    if (document.getElementById("codeSection")) return;

    const container = document.querySelector(".login-container");

    const div = document.createElement("div");
    div.id = "codeSection";

    div.innerHTML = `
        <input type="text" id="code" placeholder="Enter verification code">

        <button onclick="verifyCode()">Verify</button>

        <button id="resendBtn" onclick="resendCode()">Resend Code</button>

        <button onclick="goBackToEmail()" class="back-btn">← Back</button>
    `;

    container.appendChild(div);
}

// =======================
// RESEND CODE
// =======================
function resendCode() {
    if (resendCooldown) return;
    sendCode(emailGlobal);
}

// =======================
// COOLDOWN TIMER (30s)
// =======================
function startResendCooldown() {
    resendCooldown = true;

    const btn = document.getElementById("resendBtn");
    let timeLeft = 30;

    btn.disabled = true;
    btn.innerText = `Resend (${timeLeft}s)`;

    const interval = setInterval(() => {
        timeLeft--;
        btn.innerText = `Resend (${timeLeft}s)`;

        if (timeLeft <= 0) {
            clearInterval(interval);
            resendCooldown = false;
            btn.disabled = false;
            btn.innerText = "Resend Code";
        }
    }, 1000);
}

// =======================
// BACK BUTTON
// =======================
function goBackToEmail() {

    const codeSection = document.getElementById("codeSection");
    if (codeSection) codeSection.remove();

    // 🔥 SHOW email form again
    document.getElementById("loginForm").style.display = "block";

    document.getElementById("message").innerText = "";
}

// =======================
// VERIFY CODE
// =======================
function verifyCode() {

    const code = document.getElementById("code").value;

    fetch("/verify-code", {
        method: "POST",
        headers: {
            "Content-Type":"application/json"
        },
        body: JSON.stringify({
            email: emailGlobal,
            code: code
        })
    })
    .then(res => res.json())
    .then(data => {

        document.getElementById("message").innerText = data.message;

        if(data.success){
            // ✅ Store using keys expected by sell.html
            localStorage.setItem("userEmail", data.email);
            localStorage.setItem("userId", data.user_id);

            window.location.href = "mainpage.html";
        }
    });
}