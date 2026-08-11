(() => {
  'use strict';

  /* ---------- 错误提示（方便排查前端问题） ---------- */
  function showFatal(msg) {
    if (document.getElementById('fatal-banner')) return;
    const div = document.createElement('div');
    div.id = 'fatal-banner';
    div.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fef2f2;color:#b91c1c;padding:10px 16px;font:13px/1.6 sans-serif;border-bottom:1px solid #fecaca;white-space:pre-wrap;box-shadow:0 2px 8px rgba(0,0,0,.15);');
    div.textContent = msg;
    document.body.appendChild(div);
  }
  window.addEventListener('error', function (e) {
    showFatal('页面脚本出错：' + (e.message || '未知错误') + '\n位置：' + (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    showFatal('请求出错：' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
  if (location.protocol === 'file:') {
    showFatal('检测到你直接打开了 HTML 文件。请先在项目根目录运行：\n  python -m tuxiaoling.main\n然后浏览器访问：\n  http://localhost:8001/');
  }

  function genId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  const $ = (sel) => document.querySelector(sel);

  const messagesEl = $('#messages');
  const inputEl = $('#input');
  const btnSend = $('#btnSend');
  const btnStop = $('#btnStop');
  const btnImage = $('#btnImage');
  const btnNew = $('#btnNew');
  const btnClear = $('#btnClear');
  const fileInput = $('#fileInput');
  const imagePreview = $('#imagePreview');
  const previewImg = $('#previewImg');
  const btnRemoveImage = $('#removeImage');
  const lightbox = $('#lightbox');
  const lightboxImg = $('#lightboxImg');
  const lightboxClose = $('#lightboxClose');
  const lightboxZoomIn = $('#lightboxZoomIn');
  const lightboxZoomOut = $('#lightboxZoomOut');
  const lightboxZoomReset = $('#lightboxZoomReset');
  const lightboxZoomLabel = $('#lightboxZoomLabel');

  const THREAD_KEY = 'tuxiaoling_thread_id';
  let threadId = localStorage.getItem(THREAD_KEY) || genId();
  localStorage.setItem(THREAD_KEY, threadId);

  let currentImageUrl = null;      // 发送给后端的图片地址（OSS）
  let currentImageLocalUrl = null; // 本地预览/展示地址（data URL）
  let streaming = false;
  let abortController = null;
  let lightboxScale = 1;

  /* ---------- 工具函数 ---------- */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function msgText(m) {
    const c = m && m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c
        .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
        .join('');
    }
    return '';
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /* ---------- Markdown 渲染 ---------- */
  function inline(text) {
    return text
      .replace(
        /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        function (_, alt, src) {
          if (!/^(https?:|data:)/i.test(src)) return '[' + alt + '](' + src + ')';
          return '<div class="img-box"><img src="' + src + '" alt="' + alt + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add(\'img-failed\'); this.remove()"><span class="img-fallback">🖼 ' + alt + '（图片加载失败）</span></div>';
        }
      )
      .replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>'
      )
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function buildTable(rows) {
    function cells(row) {
      return row.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
    }
    const head = cells(rows[0]);
    let body = rows.slice(1);
    if (body.length && /^[\s:|-]+$/.test(body[0]) && body[0].indexOf('-') !== -1) {
      body = body.slice(1);
    }
    let html = '<div class="table-wrap"><table><thead><tr>';
    head.forEach(function (h) { html += '<th>' + inline(h) + '</th>'; });
    html += '</tr></thead><tbody>';
    body.forEach(function (r) {
      const cs = cells(r);
      html += '<tr>';
      head.forEach(function (_, k) { html += '<td>' + inline(cs[k] || '') + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function renderMarkdown(text) {
    if (!text) return '';
    const lines = esc(text).split(/\r?\n/);
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line.trim().startsWith('|')) {
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          rows.push(lines[i]);
          i++;
        }
        out.push(buildTable(rows));
        continue;
      }

      if (/^\s*---+/.test(line)) { out.push('<hr>'); i++; continue; }

      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        const lv = h[1].length;
        out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
        i++;
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push('<li>' + inline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }

      if (/^\s*\d+[.、]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.、]\s+/.test(lines[i])) {
          items.push('<li>' + inline(lines[i].replace(/^\s*\d+[.、]\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ol>' + items.join('') + '</ol>');
        continue;
      }

      if (/^\s*&gt;\s?/.test(line)) {
        const quotes = [];
        while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
          quotes.push(inline(lines[i].replace(/^\s*&gt;\s?/, '')));
          i++;
        }
        out.push('<blockquote>' + quotes.join('<br>') + '</blockquote>');
        continue;
      }

      const buf = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^\s*[#|>-]/.test(lines[i]) &&
        !/^\s*\d+[.、]\s+/.test(lines[i]) &&
        !/^\s*[-*]\s+/.test(lines[i])
      ) {
        buf.push(inline(lines[i]));
        i++;
      }
      if (buf.length) {
        out.push('<p>' + buf.join('<br>') + '</p>');
      } else {
        i++;
      }
    }
    return out.join('');
  }

  /* ---------- 消息渲染 ---------- */
  function addUserMessage(text, img) {
    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    let imgHtml = img ? '<img class="user-img" src="' + esc(img) + '" alt="用户图片">' : '';
    wrap.innerHTML =
      '<div class="bubble">' + imgHtml + '<div class="content">' + renderMarkdown(text) + '</div></div>' +
      '<div class="avatar">🧑</div>';
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function addAssistantMessage(text, isStreaming) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ai';
    wrap.innerHTML =
      '<div class="avatar">✈️</div>' +
      '<div class="bubble"><div class="content"></div></div>';
    const contentEl = wrap.querySelector('.content');
    if (isStreaming) {
      contentEl.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
    } else {
      contentEl.innerHTML = renderMarkdown(text) || '<span class="muted">（无内容）</span>';
      addCopyButton(wrap, text);
    }
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return { wrap: wrap, contentEl: contentEl };
  }

  function addCopyButton(wrap, text) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.title = '复制';
    copyBtn.textContent = '⧉';
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(text).then(function () {
        copyBtn.textContent = '✓';
        setTimeout(function () { copyBtn.textContent = '⧉'; }, 1200);
      }).catch(function () {});
    });
    wrap.querySelector('.bubble').appendChild(copyBtn);
  }

  function renderWelcome() {
    messagesEl.innerHTML =
      '<div class="welcome">' +
      '<div class="welcome-avatar">✈️</div>' +
      '<h2>你好，我是途小灵 👋</h2>' +
      '<p>你的 AI 旅行规划助手，可以帮你查询目的地天气、推荐美食 / 景点 / 住宿，并生成一份完整的旅行攻略。</p>' +
      '<div class="chips">' +
      '<button class="chip" data-text="帮我规划成都三天两晚的行程">🏙 成都三日游攻略</button>' +
      '<button class="chip" data-text="北京最近三天的天气怎么样？">☀️ 查北京天气</button>' +
      '<button class="chip" data-text="重庆有什么必吃的美食和必去的景点？">🍜 重庆美食景点</button>' +
      '<button class="chip" data-text="三亚适合亲子游的酒店推荐">🏨 三亚亲子住宿</button>' +
      '</div></div>';
    messagesEl.querySelectorAll('.chip').forEach(function (b) {
      b.addEventListener('click', function () {
        inputEl.value = b.getAttribute('data-text');
        sendMessage();
      });
    });
  }

  /* ---------- 流式对话 ---------- */
  function setInputDisabled(disabled) {
    inputEl.disabled = disabled;
    btnImage.disabled = disabled;
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || streaming) return;

    addUserMessage(text, currentImageLocalUrl);
    const imageUrl = currentImageUrl;
    clearImagePreview();
    inputEl.value = '';
    inputEl.style.height = 'auto';

    streaming = true;
    btnSend.hidden = true;
    btnStop.hidden = false;
    setInputDisabled(true);

    const ai = addAssistantMessage('', true);
    let acc = '';
    let sseMode = false;
    let renderTimer = null;

    function scheduleRender() {
      if (renderTimer) return;
      renderTimer = setTimeout(function () {
        renderTimer = null;
        ai.contentEl.innerHTML =
          renderMarkdown(acc) || '<span class="typing-dots"><i></i><i></i><i></i></span>';
        scrollToBottom();
      }, 30);
    }

    abortController = new AbortController();
    try {
      const res = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          image_url: imageUrl || null,
          thread_id: threadId,
        }),
        signal: abortController.signal,
      });
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        const chunk = decoder.decode(r.value, { stream: true });
        if (!sseMode && chunk.indexOf('data:') === 0) sseMode = true;
        if (sseMode) {
          chunk.split(/\r?\n/).forEach(function (ln) {
            if (ln.indexOf('data:') === 0) {
              const payload = ln.slice(5).trim();
              if (payload && payload !== '[DONE]') acc += payload;
            }
          });
        } else {
          acc += chunk;
        }
        scheduleRender();
      }
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      acc = acc.replace(/^data:\s?/gm, '').trim();
      ai.contentEl.innerHTML = renderMarkdown(acc) || '<span class="muted">（没有收到回复）</span>';
      addCopyButton(ai.wrap, acc);
    } catch (err) {
      if (err.name === 'AbortError') {
        ai.contentEl.innerHTML = renderMarkdown(acc) || '<span class="muted">已停止生成</span>';
        addCopyButton(ai.wrap, acc);
      } else {
        ai.contentEl.innerHTML = '<span class="error">请求失败：' + esc(err.message) + '，请确认后端服务已启动。</span>';
      }
    } finally {
      streaming = false;
      abortController = null;
      btnSend.hidden = false;
      btnStop.hidden = true;
      setInputDisabled(false);
      inputEl.focus();
      scrollToBottom();
    }
  }

  /* ---------- 历史记录 ---------- */
  async function loadHistory() {
    try {
      const res = await fetch('/api/v1/chat/messages?thread_id=' + encodeURIComponent(threadId));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const list = (data && data.messages) || [];
      if (!list.length) { renderWelcome(); return; }
      messagesEl.innerHTML = '';
      list.forEach(function (m) {
        const t = msgText(m);
        if (!t) return;
        if (m.type === 'human') addUserMessage(t, null);
        else addAssistantMessage(t, false);
      });
      scrollToBottom();
    } catch (e) {
      renderWelcome();
    }
  }

  /* ---------- 图片上传 ---------- */
  function clearImagePreview() {
    currentImageUrl = null;
    currentImageLocalUrl = null;
    imagePreview.hidden = true;
    previewImg.src = '';
  }

  btnImage.addEventListener('click', function () { fileInput.click(); });
  btnRemoveImage.addEventListener('click', clearImagePreview);

  fileInput.addEventListener('change', async function (e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('请选择图片文件'); return; }

    // 1) 本地立即预览（data URL，不依赖 OSS 是否公开可读）
    const dataUrl = await new Promise(function (resolve) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(file);
    });
    if (dataUrl) {
      currentImageLocalUrl = dataUrl;
      previewImg.src = dataUrl;
      imagePreview.hidden = false;
    }

    // 2) 上传到 OSS，得到可访问 URL 发给后端
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const filename = 'tuxiaoling/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    try {
      const presignRes = await fetch('/api/v1/oss/presign?filename=' + encodeURIComponent(filename));
      if (!presignRes.ok) throw new Error('获取上传地址失败');
      const presign = await presignRes.json();
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': presign.contentType },
      });
      if (!putRes.ok) throw new Error('上传失败 ' + putRes.status);
      currentImageUrl = presign.accessUrl;
    } catch (err) {
      currentImageUrl = null;
      alert('图片上传失败：' + err.message + '\n图片仍会在本地预览，但无法发送给 AI。\n提示：如果后端正常，请检查 OSS 桶是否配置了允许浏览器直传的 CORS 规则。');
    }
  });

  /* ---------- 事件绑定 ---------- */
  btnSend.addEventListener('click', sendMessage);

  btnStop.addEventListener('click', function () {
    if (abortController) abortController.abort();
  });

  btnNew.addEventListener('click', function () {
    if (streaming) {
      if (!confirm('当前回复还在生成，确定开启新对话吗？')) return;
      if (abortController) abortController.abort();
    }
    threadId = genId();
    localStorage.setItem(THREAD_KEY, threadId);
    clearImagePreview();
    messagesEl.innerHTML = '';
    renderWelcome();
  });

  btnClear.addEventListener('click', async function () {
    if (streaming) { alert('请先等待回复生成完成'); return; }
    if (!confirm('确定清空当前会话吗？')) return;
    try {
      const res = await fetch('/api/v1/chat/messages?thread_id=' + encodeURIComponent(threadId), { method: 'DELETE' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      messagesEl.innerHTML = '';
      renderWelcome();
    } catch (e) {
      alert('清空失败，请重试');
    }
  });

  /* ---------- 图片放大（灯箱） ---------- */
  function updateLightboxTransform() {
    lightboxImg.style.transform = 'scale(' + lightboxScale + ')';
    lightboxZoomLabel.textContent = Math.round(lightboxScale * 100) + '%';
  }
  function openLightbox(src) {
    if (!src) return;
    lightboxScale = 1;
    lightboxImg.src = src;
    updateLightboxTransform();
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = '';
    document.body.style.overflow = '';
  }

  previewImg.addEventListener('click', function () { openLightbox(previewImg.src); });
  lightboxClose.addEventListener('click', closeLightbox);
  lightboxZoomIn.addEventListener('click', function () {
    lightboxScale = Math.min(5, lightboxScale + 0.25);
    updateLightboxTransform();
  });
  lightboxZoomOut.addEventListener('click', function () {
    lightboxScale = Math.max(0.25, lightboxScale - 0.25);
    updateLightboxTransform();
  });
  lightboxZoomReset.addEventListener('click', function () {
    lightboxScale = 1;
    updateLightboxTransform();
  });
  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox) closeLightbox();
  });
  lightbox.addEventListener('wheel', function (e) {
    e.preventDefault();
    lightboxScale = Math.min(5, Math.max(0.25, lightboxScale + (e.deltaY < 0 ? 0.1 : -0.1)));
    updateLightboxTransform();
  }, { passive: false });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLightbox();
  });
  messagesEl.addEventListener('click', function (e) {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.src) openLightbox(t.src);
  });

  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  /* ---------- 初始化 ---------- */
  loadHistory();
  inputEl.focus();
})();
