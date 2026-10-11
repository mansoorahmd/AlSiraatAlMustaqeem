// The page a password-reset email lands on. Better Auth's link (/api/auth/reset-password/:token)
// checks the token and redirects here with ?token=… (or ?error=INVALID_TOKEN); this page asks
// for the new password and POSTs it back to /api/auth/reset-password. Served by the research
// server itself, so it works the same whether the reader uses the desktop app or the web build.
//
// Self-contained on purpose: no external assets, a strict CSP, and no-referrer so the one-time
// token in the URL can't leak to anything.

export const RESET_PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; " +
    "form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export const RESET_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset password — MQ Research Gate</title>
<style>
  :root{--bg:#f4f4f5;--card:#fff;--ink:#18181b;--soft:#52525b;--line:#e4e4e7;--accent:#2563eb;--bad:#b91c1c;--ok:#15803d}
  @media (prefers-color-scheme:dark){:root{--bg:#18181b;--card:#27272a;--ink:#f4f4f5;--soft:#a1a1aa;--line:#3f3f46;--accent:#60a5fa;--bad:#f87171;--ok:#4ade80}}
  *{box-sizing:border-box} body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;
    background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
  main{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px}
  h1{font-size:19px;margin:0 0 4px} p{margin:0 0 16px;color:var(--soft)}
  label{display:block;font-size:13px;font-weight:500;margin:12px 0 4px}
  input{width:100%;padding:9px 11px;font:inherit;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit}
  input:focus{outline:2px solid var(--accent);outline-offset:-1px}
  button{margin-top:18px;width:100%;padding:10px;font:inherit;font-weight:600;color:#fff;background:var(--accent);
    border:0;border-radius:8px;cursor:pointer} button:disabled{opacity:.55;cursor:default}
  .msg{margin-top:14px;font-size:14px} .bad{color:var(--bad)} .ok{color:var(--ok)}
</style></head>
<body><main>
  <h1>Choose a new password</h1>
  <p id="lead">For your MQ Research Gate account. At least 10 characters.</p>
  <div id="form">
    <label for="pw">New password</label>
    <input id="pw" type="password" autocomplete="new-password" minlength="10" autofocus>
    <label for="pw2">Type it again</label>
    <input id="pw2" type="password" autocomplete="new-password" minlength="10">
    <button id="go" type="button">Set password</button>
  </div>
  <div id="msg" class="msg" role="status"></div>
</main>
<script>
(function () {
  var q = new URLSearchParams(location.search), token = q.get("token");
  // the token has done its job in the address bar; keep it out of history
  if (token || q.get("error")) history.replaceState(null, "", location.pathname);
  var msg = document.getElementById("msg"), form = document.getElementById("form"), go = document.getElementById("go");
  function say(text, cls) { msg.textContent = text; msg.className = "msg " + (cls || ""); }
  if (!token) {
    form.hidden = true;
    say(q.get("error") ? "This reset link has expired or was already used. Ask for a new one from the app (Account → Forgot password)." :
      "Open this page from the link in your reset email.", "bad");
    return;
  }
  function submit() {
    var a = document.getElementById("pw").value, b = document.getElementById("pw2").value;
    if (a.length < 10) return say("Use at least 10 characters.", "bad");
    if (a !== b) return say("The two passwords don't match.", "bad");
    go.disabled = true; say("Saving…");
    fetch("/api/auth/reset-password", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: a, token: token })
    }).then(function (r) {
      if (r.ok) { form.hidden = true; say("Done — your password is changed. Sign in from the app with the new one. Other devices have been signed out.", "ok"); return; }
      return r.json().catch(function () { return {}; }).then(function (j) {
        go.disabled = false;
        say(j && j.code === "INVALID_TOKEN" ? "This reset link has expired or was already used. Ask for a new one from the app." :
          (j && j.message) || "Couldn't change the password — try again.", "bad");
      });
    }, function () { go.disabled = false; say("Couldn't reach the server — check your connection and try again.", "bad"); });
  }
  go.addEventListener("click", submit);
  document.getElementById("pw2").addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
})();
</script>
</body></html>`;
