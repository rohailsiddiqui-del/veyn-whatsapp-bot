/**
 * Embeddable AI Chat Widget
 * Drop-in, no dependencies. Single <script> tag.
 *
 * Usage:
 *   <script
 *     src="http://<YOUR-IP>:<WIDGET-PORT>/widget.js"
 *     data-bot-url="http://<YOUR-IP>:<WIDGET-PORT>"
 *     data-bot-name="Assistant"
 *     data-theme-color="#25D366"
 *     data-welcome="Hi! How can I help you today? 😊"
 *     data-placeholder="Type a message..."
 *   ></script>
 */
(function () {
  "use strict";

  // --- Config from script tag data attributes ---
  const scriptTag = document.currentScript || (function () {
    const tags = document.getElementsByTagName("script");
    return tags[tags.length - 1];
  })();

  const BOT_URL      = (scriptTag.getAttribute("data-bot-url") || "").replace(/\/$/, "");
  const BOT_NAME     = scriptTag.getAttribute("data-bot-name") || "Assistant";
  const THEME_COLOR  = scriptTag.getAttribute("data-theme-color") || "#25D366";
  const WELCOME_MSG  = scriptTag.getAttribute("data-welcome") || "Hi! 👋 How can I help you today?";
  const PLACEHOLDER  = scriptTag.getAttribute("data-placeholder") || "Type a message...";

  if (!BOT_URL) {
    console.warn("[ChatWidget] data-bot-url is required");
    return;
  }

  // --- Session ID — persisted in localStorage so context survives page reloads ---
  const STORAGE_KEY = "cw_session_" + btoa(BOT_URL).replace(/[^a-z0-9]/gi, "").slice(0, 16);
  function getSessionId() {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = "s" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }
  const SESSION_ID = getSessionId();

  // --- Inject styles ---
  const STYLES = `
    #cw-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #cw-bubble {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      width: 56px; height: 56px; border-radius: 50%;
      background: ${THEME_COLOR}; color: #fff;
      border: none; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.25);
      display: flex; align-items: center; justify-content: center;
      transition: transform .2s, box-shadow .2s;
    }
    #cw-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,.3); }
    #cw-bubble svg { width: 26px; height: 26px; fill: #fff; }
    #cw-badge {
      position: absolute; top: 0; right: 0; width: 16px; height: 16px;
      background: #e74c3c; border-radius: 50%; border: 2px solid #fff;
      display: none;
    }
    #cw-panel {
      position: fixed; bottom: 92px; right: 24px; z-index: 99998;
      width: 360px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,.18);
      display: flex; flex-direction: column;
      transform: scale(.85) translateY(20px); opacity: 0;
      pointer-events: none;
      transition: transform .2s cubic-bezier(.34,1.56,.64,1), opacity .15s;
    }
    #cw-panel.cw-open {
      transform: scale(1) translateY(0); opacity: 1; pointer-events: auto;
    }
    #cw-header {
      background: ${THEME_COLOR}; color: #fff;
      padding: 14px 16px; border-radius: 16px 16px 0 0;
      display: flex; align-items: center; gap: 10px;
    }
    #cw-header-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,.25);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0;
    }
    #cw-header-info { flex: 1; min-width: 0; }
    #cw-header-name { font-weight: 600; font-size: 15px; }
    #cw-header-status { font-size: 12px; opacity: .85; }
    #cw-close {
      background: none; border: none; color: #fff; cursor: pointer;
      opacity: .8; padding: 4px; border-radius: 4px; line-height: 1;
      font-size: 20px;
    }
    #cw-close:hover { opacity: 1; }
    #cw-messages {
      flex: 1; overflow-y: auto; padding: 16px 14px 8px;
      display: flex; flex-direction: column; gap: 8px;
      scroll-behavior: smooth;
    }
    #cw-messages::-webkit-scrollbar { width: 4px; }
    #cw-messages::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }
    .cw-msg {
      max-width: 82%; padding: 9px 13px; border-radius: 16px;
      font-size: 14px; line-height: 1.45; word-break: break-word;
    }
    .cw-msg-bot {
      align-self: flex-start; background: #f1f0f0; color: #111;
      border-bottom-left-radius: 4px;
    }
    .cw-msg-user {
      align-self: flex-end; color: #fff;
      border-bottom-right-radius: 4px;
      background: ${THEME_COLOR};
    }
    .cw-typing {
      align-self: flex-start; background: #f1f0f0;
      padding: 10px 14px; border-radius: 16px; border-bottom-left-radius: 4px;
    }
    .cw-typing span {
      display: inline-block; width: 7px; height: 7px;
      background: #999; border-radius: 50%; margin: 0 1px;
      animation: cw-bounce .9s infinite;
    }
    .cw-typing span:nth-child(2) { animation-delay: .15s; }
    .cw-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes cw-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-6px); }
    }
    #cw-footer {
      padding: 10px 12px; border-top: 1px solid #eee;
      display: flex; gap: 8px; align-items: flex-end;
    }
    #cw-input {
      flex: 1; resize: none; border: 1.5px solid #e0e0e0;
      border-radius: 20px; padding: 9px 14px;
      font-size: 14px; line-height: 1.4; outline: none;
      max-height: 96px; overflow-y: auto;
      transition: border-color .15s;
    }
    #cw-input:focus { border-color: ${THEME_COLOR}; }
    #cw-send {
      width: 38px; height: 38px; border-radius: 50%; border: none;
      background: ${THEME_COLOR}; color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: opacity .15s;
    }
    #cw-send:disabled { opacity: .45; cursor: default; }
    #cw-send svg { width: 18px; height: 18px; fill: #fff; }
    #cw-powered {
      text-align: center; font-size: 11px; color: #bbb;
      padding: 6px 0 10px; user-select: none;
    }
  `;

  const styleEl = document.createElement("style");
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  // --- Build DOM ---
  const root = document.createElement("div");
  root.id = "cw-root";
  root.innerHTML = `
    <button id="cw-bubble" aria-label="Open chat">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
      </svg>
      <span id="cw-badge"></span>
    </button>
    <div id="cw-panel" role="dialog" aria-label="${BOT_NAME} chat">
      <div id="cw-header">
        <div id="cw-header-avatar">🤖</div>
        <div id="cw-header-info">
          <div id="cw-header-name">${BOT_NAME}</div>
          <div id="cw-header-status">Online</div>
        </div>
        <button id="cw-close" aria-label="Close chat">✕</button>
      </div>
      <div id="cw-messages" aria-live="polite"></div>
      <div id="cw-footer">
        <textarea id="cw-input" rows="1" placeholder="${PLACEHOLDER}" aria-label="Your message"></textarea>
        <button id="cw-send" aria-label="Send message" disabled>
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
      <div id="cw-powered">Powered by AI</div>
    </div>
  `;
  document.body.appendChild(root);

  // --- Element refs ---
  const bubble   = root.querySelector("#cw-bubble");
  const panel    = root.querySelector("#cw-panel");
  const messages = root.querySelector("#cw-messages");
  const input    = root.querySelector("#cw-input");
  const sendBtn  = root.querySelector("#cw-send");
  const closeBtn = root.querySelector("#cw-close");
  const badge    = root.querySelector("#cw-badge");

  // --- State ---
  let isOpen = false;
  let isSending = false;
  let welcomeShown = false;

  // --- Helpers ---
  function addMessage(text, role) {
    // Remove typing indicator if present
    const typing = messages.querySelector(".cw-typing");
    if (typing) typing.remove();

    const el = document.createElement("div");
    el.className = "cw-msg cw-msg-" + role;
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  function showTyping() {
    const el = document.createElement("div");
    el.className = "cw-typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  function setBusy(busy) {
    isSending = busy;
    input.disabled = busy;
    sendBtn.disabled = busy || !input.value.trim();
  }

  function openPanel() {
    isOpen = true;
    panel.classList.add("cw-open");
    badge.style.display = "none";
    // Switch bubble icon to close (X)
    bubble.querySelector("svg").innerHTML = '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>';
    if (!welcomeShown) {
      welcomeShown = true;
      setTimeout(() => addMessage(WELCOME_MSG, "bot"), 300);
    }
    setTimeout(() => input.focus(), 350);
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove("cw-open");
    // Switch bubble icon back to chat
    bubble.querySelector("svg").innerHTML = '<path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>';
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isSending) return;

    addMessage(text, "user");
    input.value = "";
    input.style.height = "auto";
    sendBtn.disabled = true;
    setBusy(true);

    const typingEl = showTyping();

    try {
      const res = await fetch(BOT_URL + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_ID, message: text, name: "Web Visitor" }),
      });

      typingEl.remove();
      const data = await res.json();

      if (res.ok && data.reply) {
        addMessage(data.reply, "bot");
        if (!isOpen) {
          badge.style.display = "block";
        }
      } else {
        addMessage(data.error || "Something went wrong — please try again.", "bot");
      }
    } catch {
      typingEl.remove();
      addMessage("Connection error — please check your internet and try again.", "bot");
    } finally {
      setBusy(false);
    }
  }

  // --- Event listeners ---
  bubble.addEventListener("click", () => isOpen ? closePanel() : openPanel());
  closeBtn.addEventListener("click", closePanel);

  input.addEventListener("input", function () {
    sendBtn.disabled = !this.value.trim() || isSending;
    // Auto-resize textarea
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 96) + "px";
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener("click", sendMessage);

  // Close on outside click
  document.addEventListener("click", function (e) {
    if (isOpen && !root.contains(e.target)) closePanel();
  });
})();
