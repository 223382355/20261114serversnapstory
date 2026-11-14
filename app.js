(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = {
    photo: null,
    exif: {},
    story: "",
    style: "文艺",
    recipe: null,
    pageUrl: "",
    randomQueue: [],
    randomBusy: false,
    copyRound: 0,
    copyBusy: false,
    serverUrl: ""
  };

  // ---------------- 通用 UI ----------------
  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function setStep(step) {
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    if (step === "result") {
      $("panel-result").classList.add("active");
    } else {
      $(`panel-${step}`).classList.add("active");
    }
    document.querySelectorAll(".step-dot").forEach((dot) => {
      const n = Number(dot.dataset.step);
      dot.classList.toggle("active", step === "result" ? true : n <= step);
    });
  }

  const loadingTexts = [
    "正在看看这张照片…",
    "正在想想今天的故事…",
    "正在挑一句温柔的话…",
    "正在把照片放进画框…",
    "正在写下祝福…",
    "快好了，再等一下下…"
  ];
  let loadingTimer = null;

  function showLoading(on) {
    $("loading").classList.toggle("hidden", !on);
  }
  function startLoading() {
    let i = 0;
    $("loading-text").textContent = loadingTexts[0];
    clearInterval(loadingTimer);
    loadingTimer = setInterval(() => {
      i = (i + 1) % loadingTexts.length;
      $("loading-text").textContent = loadingTexts[i];
    }, 2300);
  }
  function stopLoading() { clearInterval(loadingTimer); }

  // ---------------- 拍照 / 相册 ----------------
  async function handleFile(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) {
      toast("请选择一张照片");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast("照片太大了，请换一张");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      state.exif = SnapStory.parseExif(buf);
      const raw = await SnapStory.fileToDataUrl(file);
      const compressed = await SnapStory.compressDataUrl(raw, 1400, 0.86);
      state.photo = compressed;
      $("shot-preview").src = compressed;
      setStep(2);
    } catch (e) {
      console.error(e);
      toast("这张照片打不开，换一张试试");
    }
  }

  $("camera-input").addEventListener("change", (e) => handleFile(e.target.files[0]));
  $("album-input").addEventListener("change", (e) => handleFile(e.target.files[0]));
  $("album-btn").addEventListener("click", () => $("album-input").click());

  // ---------------- 语音转文字 ----------------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let voiceState = "idle"; // idle | starting | listening
  let voiceMode = "browser"; // browser | cloud
  let voiceSupported = !!SpeechRecognition;
  let voiceTimer = null;
  let voiceBase = "";
  let voiceFinal = "";
  let voiceStoppedByUser = false;
  let voiceError = "";

  function setVoiceUI(state) {
    voiceState = state;
    const btn = $("voice-btn");
    btn.classList.toggle("recording", state === "listening");
    btn.classList.toggle("starting", state === "starting");
    if (state === "starting") {
      $("voice-label").textContent = "正在打开麦克风…";
    } else if (state === "listening") {
      $("voice-label").textContent = "正在录音… 松开手指结束";
    } else {
      $("voice-label").textContent = voiceSupported ? "按下说话，松开结束" : "直接打字";
    }
  }

  function setVoiceFallbackUI(on) {
    const tip = $("voice-tip");
    const keyboardBtn = $("voice-keyboard");
    if (tip) tip.classList.toggle("error", on);
    if (keyboardBtn) keyboardBtn.classList.toggle("attention", on);
  }

  function focusKeyboardVoice() {
    const input = $("story-input");
    input.focus();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    setVoiceFallbackUI(false);
    $("voice-tip").textContent = "请点手机键盘上的话筒图标说话，说完文字会出现在输入框里";
  }

  function showVoiceFallback(message) {
    $("voice-tip").textContent = message;
    setVoiceFallbackUI(true);
  }

  function clearVoiceTimer() {
    if (voiceTimer) {
      clearTimeout(voiceTimer);
      voiceTimer = null;
    }
  }

  function stopRecognition(tip) {
    clearVoiceTimer();
    voiceStoppedByUser = true;
    if (recognition && voiceState !== "idle") {
      try { recognition.stop(); } catch (e) { /* 忽略 */ }
      setTimeout(() => {
        if (voiceState !== "idle") {
          try { recognition.abort(); } catch (e) { /* 忽略 */ }
          setVoiceUI("idle");
        }
      }, 800);
    }
    setVoiceUI("idle");
    if (tip) $("voice-tip").textContent = tip;
  }

  function stopVoiceIfListening() {
    if (voiceState === "idle") return;
    if (voiceMode === "cloud") stopCloudRecording(true);
    else stopRecognition();
  }

  function initBrowserVoice() {
    voiceMode = "browser";
    const btn = $("voice-btn");
    const keyboardBtn = $("voice-keyboard");

    if (!voiceSupported) {
      btn.classList.add("keyboard-mode");
      $("voice-label").textContent = "用键盘话筒";
      $("voice-tip").textContent = "这个浏览器不支持网页语音，点按钮打开输入框，再点键盘上的话筒";
      btn.addEventListener("click", focusKeyboardVoice);
      if (keyboardBtn) keyboardBtn.classList.add("hidden");
      return;
    }

    try {
      recognition = new SpeechRecognition();
    } catch (e) {
      voiceSupported = false;
      btn.classList.add("keyboard-mode");
      $("voice-label").textContent = "用键盘话筒";
      $("voice-tip").textContent = "语音启动失败，请点按钮打开输入框，再用键盘上的话筒";
      btn.addEventListener("click", focusKeyboardVoice);
      if (keyboardBtn) keyboardBtn.classList.add("hidden");
      return;
    }

    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (voiceState === "idle") {
        // 用户已经取消，但浏览器这时才真正启动
        try { recognition.abort(); } catch (e) { /* 忽略 */ }
        return;
      }
      clearVoiceTimer();
      voiceStoppedByUser = false;
      voiceError = "";
      setVoiceUI("listening");
      setVoiceFallbackUI(false);
      $("voice-tip").textContent = "正在录音… 松开手指结束";
      voiceTimer = setTimeout(() => {
        if (voiceState === "listening") {
          stopRecognition(voiceFinal ? "先转成文字，不够再点一次" : "没有识别到文字，请稍后重试");
          if (!voiceFinal) {
            setVoiceFallbackUI(true);
          }
        }
      }, 30000);
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) voiceFinal += text;
        else interim += text;
      }
      $("story-input").value = (voiceBase + voiceFinal + interim).slice(0, 200);
      if (voiceFinal) {
        setVoiceFallbackUI(false);
        $("voice-tip").textContent = "已转成文字，可以修改";
      }
    };

    recognition.onerror = (event) => {
      clearVoiceTimer();
      const code = event.error || "";
      voiceError = code;
      console.warn("语音识别失败：", code);
      setVoiceUI("idle");
      if (code === "aborted") {
        // 用户主动取消，不覆盖现有提示
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        showVoiceFallback("没有麦克风权限。请在浏览器设置里允许，");
      } else if (code === "no-speech") {
        showVoiceFallback("没有听到声音，再点一次，");
      } else if (code === "network") {
        showVoiceFallback("语音服务连不上，请稍后重试");
      } else if (code === "audio-capture") {
        showVoiceFallback("没找到麦克风，请稍后重试");
      } else {
        showVoiceFallback("语音识别没成功，请稍后重试");
      }
    };

    recognition.onend = () => {
      clearVoiceTimer();
      const hadText = !!voiceFinal;
      setVoiceUI("idle");
      if (voiceError) {
        voiceError = "";
        return;
      }
      if (voiceStoppedByUser) {
        voiceStoppedByUser = false;
        return;
      }
      if (hadText) {
        $("voice-tip").textContent = "已转成文字，可以修改";
      } else {
        showVoiceFallback("没有识别到文字。这个浏览器的语音服务可能连不上，请稍后重试");
      }
    };

    function browserPressStart() {
      if (voiceState !== "idle") {
        const hadText = !!voiceFinal;
        stopRecognition(hadText ? "已停止，可以继续修改文字" : "没有识别到文字，请稍后重试");
        if (!hadText) setVoiceFallbackUI(true);
        return;
      }

      voiceBase = $("story-input").value;
      voiceFinal = "";
      voiceStoppedByUser = false;
      voiceError = "";
      setVoiceUI("starting");
      setVoiceFallbackUI(false);
      $("voice-tip").textContent = "正在启动麦克风…";

      clearVoiceTimer();
      voiceTimer = setTimeout(() => {
        if (voiceState === "starting") {
          stopRecognition("语音没有启动成功，请稍后重试");
          setVoiceFallbackUI(true);
        }
      }, 4500);

      try { recognition.start(); } catch (e) {
        clearVoiceTimer();
        try { recognition.abort(); } catch (e2) { /* 忽略 */ }
        setVoiceUI("idle");
        showVoiceFallback("语音启动失败，请稍后重试");
      }
    }

    function browserPressEnd() {
      if (voiceState === "listening" || voiceState === "starting") {
        stopRecognition();
      }
    }

    btn.addEventListener("mousedown", browserPressStart);
    btn.addEventListener("mouseup", browserPressEnd);
    btn.addEventListener("mouseleave", browserPressEnd);
    btn.addEventListener("touchstart", browserPressStart, { passive: false });
    btn.addEventListener("touchend", browserPressEnd, { passive: false });
    btn.addEventListener("touchcancel", browserPressEnd, { passive: false });

    if (keyboardBtn) {
      keyboardBtn.addEventListener("click", focusKeyboardVoice);
    }
  }

  // ---------------- 录音上传，云端转文字（硅基流动） ----------------
  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];
  let cloudTimer = null;
  let cloudCancelled = false;
  let voiceTranscribing = false;

  function clearCloudTimer() {
    if (cloudTimer) {
      clearTimeout(cloudTimer);
      cloudTimer = null;
    }
  }

  function stopMediaStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  function pickAudioMime() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (const type of types) {
      try {
        if (MediaRecorder.isTypeSupported(type)) return type;
      } catch (e) { /* 忽略 */ }
    }
    return "";
  }

  function audioExt(type) {
    if (type.includes("mp4")) return "m4a";
    if (type.includes("ogg")) return "ogg";
    if (type.includes("wav")) return "wav";
    return "webm";
  }

  function micErrorMessage(err) {
    const name = err && err.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "没有麦克风权限。请在浏览器设置里允许，";
    }
    if (name === "NotFoundError") {
      return "没找到麦克风，请稍后重试";
    }
    return "打不开麦克风，请稍后重试";
  }

  function initCloudVoice() {
    voiceMode = "cloud";
    voiceSupported = true;
    const btn = $("voice-btn");
    const keyboardBtn = $("voice-keyboard");

    function onPressStart(e) {
      if (voiceTranscribing) {
        $("voice-tip").textContent = "正在转文字，请稍等…";
        e.preventDefault();
        return;
      }
      if (voiceState !== "idle") {
        stopCloudRecording(false);
        e.preventDefault();
        return;
      }
      startCloudRecording(SnapStory.getConfig().asrKey);
      e.preventDefault(); // 阻止 click 触发两次
    }

    function onPressEnd(e) {
      if (voiceState === "listening" || voiceState === "starting") {
        stopCloudRecording(false);
        e.preventDefault();
      }
    }

    // 按压事件（同时支持鼠标和触屏）
    btn.addEventListener("mousedown", onPressStart);
    btn.addEventListener("mouseup", onPressEnd);
    btn.addEventListener("mouseleave", onPressEnd); // 拖着手指移开也停止
    btn.addEventListener("touchstart", onPressStart, { passive: false });
    btn.addEventListener("touchend", onPressEnd, { passive: false });
    btn.addEventListener("touchcancel", onPressEnd, { passive: false });

    if (keyboardBtn) {
      keyboardBtn.addEventListener("click", focusKeyboardVoice);
    }

    $("voice-tip").textContent = "按住话筒说话，松开自动转文字";
  }

  async function startCloudRecording(key) {
    setVoiceUI("starting");
    setVoiceFallbackUI(false);
    $("voice-tip").textContent = "正在打开麦克风…";
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
    } catch (e) {
      if (voiceState === "idle") return;
      setVoiceUI("idle");
      showVoiceFallback(micErrorMessage(e));
      return;
    }
    if (voiceState === "idle") {
      stopMediaStream();
      return;
    }

    const mime = pickAudioMime();
    try {
      mediaRecorder = mime ? new MediaRecorder(mediaStream, { mimeType: mime }) : new MediaRecorder(mediaStream);
    } catch (e) {
      try {
        mediaRecorder = new MediaRecorder(mediaStream);
      } catch (e2) {
        stopMediaStream();
        setVoiceUI("idle");
        showVoiceFallback("这个浏览器不支持网页录音，请稍后重试");
        return;
      }
    }

    audioChunks = [];
    cloudCancelled = false;
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const cancelled = cloudCancelled;
      const type = (mediaRecorder && mediaRecorder.mimeType) || mime || "audio/webm";
      const chunks = audioChunks;
      audioChunks = [];
      stopMediaStream();
      mediaRecorder = null;
      if (cancelled) return;
      const blob = new Blob(chunks, { type });
      if (blob.size < 800) {
        setVoiceUI("idle");
        showVoiceFallback("没有录到声音，请再点一次");
        return;
      }
      transcribeAudio(blob, key, type);
    };

    try {
      mediaRecorder.start();
    } catch (e) {
      stopMediaStream();
      mediaRecorder = null;
      setVoiceUI("idle");
      showVoiceFallback("录音启动失败，请稍后重试");
      return;
    }

    setVoiceUI("listening");
    $("voice-tip").textContent = "正在录音… 松开手指结束";
    clearCloudTimer();
    cloudTimer = setTimeout(() => {
      if (voiceState === "listening") stopCloudRecording(false);
    }, 30000);
  }

  function stopCloudRecording(cancel) {
    clearCloudTimer();
    if (cancel) cloudCancelled = true;
    const wasStarting = voiceState === "starting";
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      setVoiceUI("idle");
      $("voice-tip").textContent = cancel ? "已取消录音" : "正在转文字…";
      try {
        mediaRecorder.stop();
      } catch (e) {
        stopMediaStream();
        mediaRecorder = null;
        showVoiceFallback("录音结束失败，请再点一次");
      }
      return;
    }
    stopMediaStream();
    setVoiceUI("idle");
    if (cancel || wasStarting) $("voice-tip").textContent = "已取消录音";
  }

  async function transcribeAudio(blob, key, type) {
    voiceTranscribing = true;
    $("voice-tip").textContent = "正在转文字…";
    const form = new FormData();
    form.append("model", "FunAudioLLM/SenseVoiceSmall");
    form.append("file", blob, "voice." + audioExt(type));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
      const resp = await fetch("https://api.siliconflow.cn/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: "Bearer " + key },
        body: form,
        signal: controller.signal
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data.message || (data.error && data.error.message) || ("HTTP " + resp.status);
        if (resp.status === 401 || resp.status === 403) {
          showVoiceFallback("语音服务暂时不可用，请稍后再试");
        } else {
          showVoiceFallback("语音转文字失败：" + msg);
        }
        return;
      }
      const text = String(data.text || data.result || (data.data && data.data.text) || "").trim();
      if (!text) {
        showVoiceFallback("没有识别到文字，请再说一次");
        return;
      }
      const input = $("story-input");
      const base = input.value.trim();
      input.value = (base ? base + text : text).slice(0, 200);
      setVoiceFallbackUI(false);
      $("voice-tip").textContent = "已转成文字，可以修改";
    } catch (e) {
      if (e.name === "AbortError") showVoiceFallback("转文字超时，请检查网络后再试");
      else showVoiceFallback("语音转文字失败，请检查网络或 Key");
      console.warn("语音转文字失败：", e);
    } finally {
      clearTimeout(timer);
      voiceTranscribing = false;
    }
  }

  function initVoiceMode() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder) {
      initCloudVoice();
    } else {
      initBrowserVoice();
    }
  }

  try {
    initVoiceMode();
  } catch (e) {
    console.warn("语音初始化失败：", e);
    $("voice-btn").addEventListener("click", focusKeyboardVoice);
    $("voice-label").textContent = "用键盘话筒";
    $("voice-tip").textContent = "语音初始化失败，请点按钮打开输入框，再用键盘上的话筒";
  }

  // ---------------- 文字 ----------------
  function backToStep1() {
    stopVoiceIfListening();
    state.photo = null;
    state.exif = {};
    state.story = "";
    $("story-input").value = "";
    $("voice-tip").textContent = "说完会自动变成文字，可以再改";
    $("shot-preview").removeAttribute("src");
    $("camera-input").value = "";
    $("album-input").value = "";
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("skip-story").addEventListener("click", backToStep1);
  $("retake-btn").addEventListener("click", backToStep1);
  $("story-input").addEventListener("input", () => {
    state.story = $("story-input").value.trim();
  });
  $("next-story").addEventListener("click", () => {
    stopVoiceIfListening();
    state.story = $("story-input").value.trim();
    setStep(3);
  });

  // ---------------- 风格 ----------------
  const styleCards = document.querySelectorAll(".style-card");
  function selectStyle(style) {
    state.style = style;
    SnapStory.setCurrentStyle(style);
    styleCards.forEach((c) => c.classList.toggle("selected", c.dataset.style === style));
  }
  styleCards.forEach((card) => {
    card.addEventListener("click", () => selectStyle(card.dataset.style));
  });
  selectStyle("文艺");

  // ---------------- 生成 ----------------
  const posterCanvas = document.createElement("canvas");

  function normalizeTitle(title, style) {
    let t = String(title || "").replace(/[《》“”"'。，、！？!?：:\-—\s]/g, "");
    if (Array.from(t).length < 2 || Array.from(t).length > 10) {
      t = SnapStory.FALLBACK_TITLES[style] || "美好时光";
    }
    return t;
  }

  async function generate() {
    if (!state.photo) { setStep(1); return; }
    SnapStory.setCurrentStyle(state.style);
    showLoading(true);
    startLoading();
    try {
      const captured = state.exif.date || new Date();
      const oldPhoto = Math.abs(Date.now() - captured.getTime()) > 24 * 3600 * 1000;
      // 只在 EXIF 有 GPS 时查坐标，避免触发浏览器定位权限弹窗
      // （用户不需要看到「获取地址」提示）
      const coords = state.exif.gps || null;

      // 先取天气地点，再把天气传给文案匹配（本地模板按天气排序需要）
      const pw = await SnapStory.resolvePlaceWeather(coords, oldPhoto);
      const ai = await SnapStory.analyzePhoto(state.photo, state.story, 0, pw.weather);

      const a = ai.analysis;
      const recipe = {
        id: SnapStory.newId(),
        syncKey: SnapStory.newSyncKey(),
        style: state.style,
        photo: state.photo,
        dateText: SnapStory.formatDateCN(captured),
        weather: pw.weather || "",
        location: pw.place || a.locationGuess || "",
        title: normalizeTitle(a.title, state.style),
        caption: a.caption || SnapStory.FALLBACK_CAPTIONS[state.style],
        event: a.event || "今天的好光景",
        scene: a.scene || "",
        emotion: a.emotion || "",
        keywords: a.keywords || [],
        blessing: a.blessing || SnapStory.FALLBACK_BLESSINGS[state.style],
        story: state.story,
        comments: [],
        createdAt: Date.now(),
        aiUsed: !!ai.aiUsed
      };

      await showResult(recipe, ai);
    } catch (e) {
      console.error(e);
      toast("生成失败，请再试一次");
    } finally {
      stopLoading();
      showLoading(false);
    }
  }

  // ---------------- 家人留言同步 ----------------
  let stopCommentSync = null;
  let refreshTimer = null;

  function commentSignature(c) {
    return `${Number(c.at) || 0}|${c.name || ""}|${c.content || ""}`;
  }

  function mergeComments(recipe, incoming) {
    recipe.comments = Array.isArray(recipe.comments) ? recipe.comments : [];
    const seen = new Set(recipe.comments.map(commentSignature));
    let added = 0;
    (incoming || []).forEach((c) => {
      if (!c || !c.content) return;
      const comment = {
        name: String(c.name || "家人").slice(0, 12),
        content: String(c.content).slice(0, 200),
        at: Number(c.at) || Date.now()
      };
      const sig = commentSignature(comment);
      if (seen.has(sig)) return;
      seen.add(sig);
      recipe.comments.push(comment);
      added += 1;
    });
    recipe.comments.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
    return added;
  }

  function schedulePosterRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (!state.recipe) return;
      try {
        await SnapStory.renderPoster(posterCanvas, state.recipe);
        const dataUrl = posterCanvas.toDataURL("image/jpeg", 0.92);
        $("poster-img").src = dataUrl;
        $("download").href = dataUrl;
      } catch (e) {
        console.warn("更新海报失败：", e);
      }
    }, 220);
  }

  function startCommentSync(recipe) {
    if (stopCommentSync) {
      stopCommentSync();
      stopCommentSync = null;
    }
    const note = $("sync-note");
    const key = recipe.syncKey;
    if (!key || !window.SnapSync) {
      note.textContent = "这张海报是旧链接，留言只保存在家人手机上";
      return;
    }

    note.textContent = "家人留言会自动出现在海报上";
    SnapSync.fetchAll(key).then((list) => {
      if (mergeComments(recipe, list)) {
        SnapStory.updatePoster(recipe);
        schedulePosterRefresh();
      }
    }).catch(() => { /* 忽略，实时通道仍会尝试 */ });

    stopCommentSync = SnapSync.subscribe(key, (c) => {
      if (mergeComments(recipe, [c])) {
        SnapStory.updatePoster(recipe);
        schedulePosterRefresh();
        toast(`${c.name || "家人"} 留言了`);
      }
    }, (status) => {
      if (status === "open") {
        note.textContent = "已连接，家人留言会自动出现";
      } else if (status === "error") {
        note.textContent = "实时同步暂不可用，家人可以复制留言发给您";
      }
    });
  }

  // 更新海报保存状态提示
  function setSaveState(kind, text) {
    const el = $("save-state");
    if (!el) return;
    el.className = "save-state" + (kind ? " " + kind : "");
    el.textContent = text || "";
  }

  // 异步上传到自建后端（若已配置）。不阻塞主流程，失败静默降级。
  function uploadToBackend(recipe, dataUrl) {
    if (!window.SnapBackend || !SnapBackend.isConfigured()) {
      setSaveState("", "已保存在这台手机上，家人扫码可查看");
      return Promise.resolve("");
    }
    if (!recipe || !recipe.syncKey || !dataUrl) return Promise.resolve("");

    setSaveState("", "正在同步到云端…");
    const userId = (typeof SnapStory.getUserId === "function") ? SnapStory.getUserId() : "";
    return SnapBackend.uploadPoster(recipe.syncKey, userId, dataUrl, {
      title: recipe.title || "",
      dateText: recipe.dateText || "",
      style: recipe.style || "",
      createdAt: recipe.createdAt || Date.now(),
      weather: recipe.weather || "",
      location: recipe.location || ""
    }).then((url) => {
      if (url) {
        state.serverUrl = url;
        setSaveState("ok", "已保存到云端，家人扫码永久可见");
      } else {
        const reason = (SnapBackend.getLastError && SnapBackend.getLastError()) || "";
        setSaveState("warn", "云端没连上（" + reasonText(reason) + "），已存本机；家人扫码 3 小时内可见");
      }
      return url;
    }).catch(() => {
      setSaveState("warn", "云端没连上（网络错误），已存本机；家人扫码 3 小时内可见");
      return "";
    });
  }

  // 把技术错误码翻译成老人和你能看懂的话
  function reasonText(code) {
    if (code === "timeout") return "连接超时，隧道可能断了";
    if (code === "network") return "网络不通，地址可能已失效";
    if (code === "http-404") return "地址能用但不是这个服务";
    if (code === "http-502" || code === "http-503" || code === "http-504") return "隧道在线但后端没响应";
    if (code.indexOf("http-") === 0) return "服务器返回 " + code.slice(5);
    return "未知原因";
  }

  async function showResult(recipe, ai) {
    state.recipe = recipe;
    state.serverUrl = "";
    resetRandomCycle();
    await SnapStory.renderPoster(posterCanvas, recipe);

    const dataUrl = posterCanvas.toDataURL("image/jpeg", 0.92);
    $("poster-img").src = dataUrl;
    $("download").href = dataUrl;

    // 把海报传到同步通道，家人扫码时就能直接看到图片
    if (recipe.syncKey && window.SnapSync) {
      SnapSync.uploadPoster(dataUrl, `snapstory-${recipe.id}.jpg`, recipe.syncKey)
        .catch(() => { /* 上传失败时家人仍可看文字版 */ });
    }
    // 同时异步上传到自建后端（永久保存），失败自动降级
    uploadToBackend(recipe, dataUrl);

    const pageUrl = SnapStory.pageUrlFor(recipe);
    state.pageUrl = pageUrl;
    const qr = SnapStory.makeQrCanvas(pageUrl, 560);
    $("qr-img").src = qr.toDataURL("image/png");
    $("page-link").href = pageUrl;

    renderInsight(recipe, ai);
    const ok = SnapStory.savePoster(recipe);
    if (!ok) toast("本机存储空间不足，留言页可能打不开");

    setStep("result");
    startCommentSync(recipe);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderInsight(recipe, ai) {
    const box = $("insight");
    if (!box) return;
    const parts = [];
    if (recipe.scene) parts.push(`<p><span>画面</span>${escapeHtml(recipe.scene)}</p>`);
    if (recipe.emotion) parts.push(`<p><span>情绪</span>${escapeHtml(recipe.emotion)}</p>`);
    if (recipe.keywords && recipe.keywords.length) {
      parts.push(`<p><span>关键词</span>${recipe.keywords.map((k) => `<b>${escapeHtml(k)}</b>`).join("")}</p>`);
    }
    const note = ai && ai.aiUsed ? "AI 已识别照片并生成文案" : "";
    box.innerHTML = `${note ? `<div class="insight-head">${note}</div>` : ""}${parts.join("")}`;
    box.classList.toggle("hidden", !note && parts.length === 0);
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl || "").split(",");
    if (parts.length !== 2) return null;
    const mime = (parts[0].match(/data:([^;]+)/) || [])[1] || "image/jpeg";
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  $("generate-btn").addEventListener("click", generate);

  // ---------------- 结果操作 ----------------
  $("share").addEventListener("click", async () => {
    const url = state.pageUrl;
    const dataUrl = $("poster-img").src;

    // 优先直接分享海报图片，家人在聊天里就能看到
    if (navigator.share && navigator.canShare && dataUrl.startsWith("data:")) {
      try {
        const blob = dataUrlToBlob(dataUrl);
        const file = new File([blob], "记忆相册-海报.jpg", { type: "image/jpeg" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: "给你做了一张海报" });
          return;
        }
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }

    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "记忆相册", text: "给你做了一张海报，点开看看", url });
        return;
      } catch (e) { /* 用户取消 */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("链接已复制，发给家人吧");
    } catch (e) {
      window.prompt("复制这个链接发给家人：", url);
    }
  });

  $("download").addEventListener("click", () => {
    // 双保险：用户点"保存海报"也写入 gallery，避免生成流程中途异常跳过 savePoster
    if (state.recipe) {
      SnapStory.savePoster(state.recipe);
      // 点保存时再补传一次后端，防止生成时上传失败
      const dataUrl = $("poster-img").src;
      if (dataUrl && dataUrl.indexOf("data:") === 0) uploadToBackend(state.recipe, dataUrl);
    }
    if (state.serverUrl) {
      toast("已存到云端。长按海报可另存到手机相册");
    } else {
      toast("长按海报可保存到手机相册");
    }
  });

  function resetRandomCycle() {
    state.randomQueue = [];
    state.randomBusy = false;
    state.copyRound = 0;
    state.copyBusy = false;
    const hint = $("random-hint");
    if (hint) hint.textContent = "随机风格换配色；更换文案只换主文案；也可以直接点海报上的文案修改。";
    const btn = $("random-style");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "随机风格";
    }
    const copyBtn = $("change-copy");
    if (copyBtn) {
      copyBtn.disabled = false;
      copyBtn.textContent = "更换文案";
    }
  }

  async function changeRandomStyle() {
    if (!state.recipe || state.randomBusy || state.copyBusy) return;
    const styles = (SnapStory.RANDOM_STYLES || []).slice();
    if (!styles.length) return;

    if (!state.randomQueue.length) {
      state.randomQueue = styles;
      for (let i = state.randomQueue.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.randomQueue[i], state.randomQueue[j]] = [state.randomQueue[j], state.randomQueue[i]];
      }
      if (state.randomQueue[0] === state.recipe.style && state.randomQueue.length > 1) {
        state.randomQueue.push(state.randomQueue.shift());
      }
    }

    const style = state.randomQueue.shift();
    const btn = $("random-style");
    state.randomBusy = true;
    btn.disabled = true;
    btn.textContent = "正在换…";

    try {
      const recipe = state.recipe;
      recipe.style = style;
      state.copyRound = 0;
      recipe.manualCopy = false;
      SnapStory.setCurrentStyle(style);
      $("random-hint").textContent = "正在根据照片和心情写文案…";

      const ai = await SnapStory.analyzePhoto(recipe.photo, recipe.story, 0, recipe.weather);
      const a = ai.analysis;
      recipe.title = normalizeTitle(a.title, style);
      recipe.caption = a.caption || SnapStory.FALLBACK_CAPTIONS[style];
      recipe.event = a.event || recipe.event || "今天的好光景";
      recipe.scene = a.scene || recipe.scene || "";
      recipe.emotion = a.emotion || recipe.emotion || "";
      recipe.keywords = a.keywords || [];
      recipe.blessing = a.blessing || SnapStory.FALLBACK_BLESSINGS[style];
      recipe.aiUsed = !!ai.aiUsed;

      await SnapStory.renderPoster(posterCanvas, recipe);
      const dataUrl = posterCanvas.toDataURL("image/jpeg", 0.92);
      $("poster-img").src = dataUrl;
      $("download").href = dataUrl;

      const pageUrl = SnapStory.pageUrlFor(recipe);
      state.pageUrl = pageUrl;
      $("page-link").href = pageUrl;
      $("qr-img").src = SnapStory.makeQrCanvas(pageUrl, 560).toDataURL("image/png");
      renderInsight(recipe, ai);
      // 换风格不写入 gallery，只有首次生成才保存
      if (recipe.syncKey && window.SnapSync) {
        SnapSync.uploadPoster(dataUrl, `snapstory-${recipe.id}.jpg`, recipe.syncKey)
          .catch(() => { /* 忽略，留言仍可同步 */ });
      }
      uploadToBackend(recipe, dataUrl);

      const left = state.randomQueue.length;
      $("random-hint").textContent = left
        ? `已换成「${style}」，还能换 ${left} 种`
        : `已换成「${style}」，6 种都看过了，再点从头开始`;
    } catch (e) {
      console.error(e);
      $("random-hint").textContent = "换风格失败，请再试一次";
      toast("换风格失败，请再试一次");
    } finally {
      state.randomBusy = false;
      btn.disabled = false;
      btn.textContent = "随机风格";
    }
  }

  async function refreshRecipeView(recipe, ai) {
    await SnapStory.renderPoster(posterCanvas, recipe);
    const dataUrl = posterCanvas.toDataURL("image/jpeg", 0.92);
    $("poster-img").src = dataUrl;
    $("download").href = dataUrl;

    const pageUrl = SnapStory.pageUrlFor(recipe);
    state.pageUrl = pageUrl;
    $("page-link").href = pageUrl;
    $("qr-img").src = SnapStory.makeQrCanvas(pageUrl, 560).toDataURL("image/png");

    renderInsight(recipe, ai || { aiUsed: !!recipe.aiUsed });
    // 换文案等预览刷新不写入 gallery

    if (recipe.syncKey && window.SnapSync) {
      SnapSync.uploadPoster(dataUrl, `snapstory-${recipe.id}.jpg`, recipe.syncKey)
        .catch(() => { /* 上传失败时家人仍可看文字版 */ });
    }
    uploadToBackend(recipe, dataUrl);
  }

  async function changeCopy() {
    if (!state.recipe || state.copyBusy || state.randomBusy) return;
    const btn = $("change-copy");
    state.copyBusy = true;
    btn.disabled = true;
    btn.textContent = "正在换…";
    $("random-hint").textContent = "正在根据照片换一版文案…";

    try {
      state.copyRound += 1;
      const recipe = state.recipe;
      const ai = await SnapStory.analyzePhoto(recipe.photo, recipe.story, state.copyRound, recipe.weather);
      const a = ai.analysis;

      recipe.blessing = a.blessing || SnapStory.FALLBACK_BLESSINGS[recipe.style];
      recipe.event = a.event || recipe.event;
      recipe.scene = a.scene || recipe.scene;
      recipe.emotion = a.emotion || recipe.emotion;
      recipe.keywords = a.keywords || recipe.keywords || [];
      recipe.caption = a.caption || recipe.caption;
      recipe.title = normalizeTitle(a.title, recipe.style);
      recipe.aiUsed = !!ai.aiUsed;

      await refreshRecipeView(recipe, ai);
      $("random-hint").textContent = `已换第 ${state.copyRound + 1} 版文案；可以继续换，或直接点海报修改。`;
    } catch (e) {
      console.error(e);
      $("random-hint").textContent = "换文案失败，请再试一次";
      toast("换文案失败，请再试一次");
    } finally {
      state.copyBusy = false;
      btn.disabled = false;
      btn.textContent = "更换文案";
    }
  }

  function openCopyEditor() {
    if (!state.recipe) return;
    $("copy-input").value = state.recipe.blessing || "";
    $("copy-modal").classList.remove("hidden");
    setTimeout(() => {
      $("copy-input").focus();
      $("copy-input").select();
    }, 50);
  }

  function closeCopyEditor() {
    $("copy-modal").classList.add("hidden");
  }

  async function saveCopyEdit() {
    if (!state.recipe) return;
    const text = $("copy-input").value.trim();
    if (!text) {
      toast("写一句文案再保存");
      return;
    }
    const btn = $("copy-save");
    btn.disabled = true;
    try {
      state.recipe.blessing = text.slice(0, 32);
      state.recipe.manualCopy = true;
      closeCopyEditor();
      await refreshRecipeView(state.recipe);
      $("random-hint").textContent = "文案已改成你写的这句；还可以点「更换文案」再换。";
    } catch (e) {
      console.error(e);
      toast("保存文案失败，请再试一次");
    } finally {
      btn.disabled = false;
    }
  }

  if (window.SnapVoice) {
    SnapVoice.attach({
      button: "copy-voice",
      label: "copy-voice-label",
      tip: "copy-voice-tip",
      target: "copy-input",
      maxLength: 32,
      replace: true,
      getKey: () => SnapStory.getConfig().asrKey
    });
  }

  $("random-style").addEventListener("click", changeRandomStyle);
  $("change-copy").addEventListener("click", changeCopy);
  $("edit-copy").addEventListener("click", openCopyEditor);
  $("copy-cancel").addEventListener("click", closeCopyEditor);
  $("copy-save").addEventListener("click", saveCopyEdit);
  $("copy-modal").addEventListener("click", (e) => {
    if (e.target === $("copy-modal")) closeCopyEditor();
  });

  $("change-style").addEventListener("click", () => {
    if (stopCommentSync) {
      stopCommentSync();
      stopCommentSync = null;
    }
    clearTimeout(refreshTimer);
    resetRandomCycle();
    setStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("again").addEventListener("click", () => {
    if (stopCommentSync) {
      stopCommentSync();
      stopCommentSync = null;
    }
    clearTimeout(refreshTimer);
    resetRandomCycle();
    stopVoiceIfListening();
    state.photo = null;
    state.exif = {};
    state.story = "";
    state.recipe = null;
    state.pageUrl = "";
    $("story-input").value = "";
    $("voice-tip").textContent = "说完会自动变成文字，可以再改";
    $("shot-preview").removeAttribute("src");
    $("camera-input").value = "";
    $("album-input").value = "";
    selectStyle("文艺");
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---------------- 家人昵称设置 ----------------
  const FAMILY_KEY_BASE = "snapstory.familyNames";
  const DEFAULT_FAMILY = ["老人"];

  function loadFamilyNames() {
    try {
      const raw = localStorage.getItem(SnapStory.storageKey(FAMILY_KEY_BASE));
      if (!raw) return DEFAULT_FAMILY.slice();
      const list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) return DEFAULT_FAMILY.slice();
      return list.map((n) => String(n || "").trim().slice(0, 12)).filter(Boolean);
    } catch (e) {
      return DEFAULT_FAMILY.slice();
    }
  }

  function saveFamilyNames(list) {
    localStorage.setItem(SnapStory.storageKey(FAMILY_KEY_BASE), JSON.stringify(list));
  }

  let familyDraft = [];

  function renderFamilyList() {
    const box = $("family-list");
    box.innerHTML = "";
    familyDraft.forEach((name, i) => {
      const item = document.createElement("div");
      item.className = "family-item" + (i === 0 ? " first" : "");
      item.dataset.index = String(i);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "family-name";
      input.maxLength = 12;
      input.value = name;
      input.placeholder = i === 0 ? "老人的称呼" : "家人昵称";
      input.addEventListener("input", () => {
        familyDraft[i] = input.value.trim();
      });

      const actions = document.createElement("div");
      actions.className = "family-actions";

      const up = document.createElement("button");
      up.type = "button";
      up.innerHTML = "↑";
      up.title = "上移";
      up.disabled = i === 0;
      up.addEventListener("click", () => {
        if (i === 0) return;
        [familyDraft[i - 1], familyDraft[i]] = [familyDraft[i], familyDraft[i - 1]];
        renderFamilyList();
      });

      const down = document.createElement("button");
      down.type = "button";
      down.innerHTML = "↓";
      down.title = "下移";
      down.disabled = i === familyDraft.length - 1;
      down.addEventListener("click", () => {
        if (i === familyDraft.length - 1) return;
        [familyDraft[i + 1], familyDraft[i]] = [familyDraft[i], familyDraft[i + 1]];
        renderFamilyList();
      });

      const del = document.createElement("button");
      del.type = "button";
      del.innerHTML = "×";
      del.title = "删除";
      del.addEventListener("click", () => {
        if (familyDraft.length <= 1) {
          toast("至少保留一个昵称");
          return;
        }
        familyDraft.splice(i, 1);
        renderFamilyList();
      });

      actions.appendChild(up);
      actions.appendChild(down);
      actions.appendChild(del);

      item.appendChild(input);
      item.appendChild(actions);
      box.appendChild(item);
    });
  }

  function openFamilyModal() {
    familyDraft = loadFamilyNames();
    if (!familyDraft.length) familyDraft = DEFAULT_FAMILY.slice();
    renderFamilyList();
    $("family-new-input").value = "";
    $("family-modal").classList.remove("hidden");
    setTimeout(() => $("family-new-input").focus(), 50);
  }

  function closeFamilyModal() {
    $("family-modal").classList.add("hidden");
  }

  $("family-btn").addEventListener("click", openFamilyModal);
  $("family-cancel").addEventListener("click", closeFamilyModal);

  function addFamilyName() {
    const input = $("family-new-input");
    const val = input.value.trim().slice(0, 12);
    if (!val) { toast("写一个昵称再加"); return; }
    if (familyDraft.includes(val)) { toast("已经有这个昵称了"); input.value = ""; return; }
    familyDraft.push(val);
    input.value = "";
    renderFamilyList();
    input.focus();
  }

  $("family-add-btn").addEventListener("click", addFamilyName);
  $("family-new-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addFamilyName(); }
  });

  $("family-save").addEventListener("click", () => {
    const clean = familyDraft.map((n) => String(n || "").trim().slice(0, 12)).filter(Boolean);
    if (!clean.length) { toast("至少保留一个昵称"); return; }
    saveFamilyNames(clean);
    closeFamilyModal();
    toast("已保存家人昵称");
  });

  // ---------------- 我的身份 ----------------
  function refreshUserIdDisplay() {
    $("user-id-display").textContent = SnapStory.getUserId();
  }

  function openUserModal() {
    refreshUserIdDisplay();
    $("user-import-label").classList.add("hidden");
    $("user-import-input").classList.add("hidden");
    $("user-import-input").value = "";
    $("user-import-actions").classList.add("hidden");
    // 回填后端地址
    const beUrl = $("backend-url");
    if (beUrl && window.SnapBackend) beUrl.value = SnapBackend.getBase();
    $("user-modal").classList.remove("hidden");
  }

  function closeUserModal() { $("user-modal").classList.add("hidden"); }

  $("user-btn").addEventListener("click", openUserModal);
  $("user-close").addEventListener("click", closeUserModal);
  document.getElementById("user-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeUserModal();
  });

  // ---------------- 后端服务器配置 ----------------
  // 地址规范化 + 基本校验，返回错误说明（空串表示通过）
  function normalizeBackendUrl(raw) {
    let url = String(raw || "").trim();
    if (!url) return { url: "", error: "请先填地址" };
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    url = url.replace(/\/+$/, "");
    // 本地打开页面时，https 也能访问 http 后端；线上页面是 https，http 后端会被浏览器拦截
    if (location.protocol === "https:" && url.indexOf("http://") === 0) {
      return { url, error: "线上页面是 https，后端地址必须是 https:// 开头，否则浏览器会拦截" };
    }
    return { url, error: "" };
  }

  $("backend-save").addEventListener("click", () => {
    const r = normalizeBackendUrl($("backend-url").value);
    if (r.error && !r.url) { toast(r.error); return; }
    if (r.error) { toast(r.error); return; }
    $("backend-url").value = r.url;
    if (window.SnapBackend) SnapBackend.setBase(r.url);
    toast("后端地址已保存");
  });
  $("backend-clear").addEventListener("click", () => {
    $("backend-url").value = "";
    if (window.SnapBackend) SnapBackend.setBase("");
    toast("已清除后端地址，恢复本机保存");
  });
  $("backend-test").addEventListener("click", async () => {
    const r = normalizeBackendUrl($("backend-url").value);
    if (r.error) { toast(r.error); return; }
    $("backend-url").value = r.url;
    if (window.SnapBackend) SnapBackend.setBase(r.url);

    toast("正在测试，最多等 6 秒…");
    const ok = window.SnapBackend ? await SnapBackend.health(true) : false;
    if (ok) {
      toast("连接成功，后端在线");
    } else {
      const code = (SnapBackend.getLastError && SnapBackend.getLastError()) || "";
      toast("连接失败：" + reasonText(code));
    }
  });

  $("user-id-copy").addEventListener("click", async () => {
    const id = SnapStory.getUserId();
    try { await navigator.clipboard.writeText(id); toast("已复制"); }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = id; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("已复制"); } catch (e2) { toast("请长按选择复制"); }
      document.body.removeChild(ta);
    }
  });

  $("user-export").addEventListener("click", () => {
    const id = SnapStory.getUserId();
    const text = "SHIGUANGJIAYI_" + id;
    if (confirm("把下面这串复制到另一台设备的身份设置里：\n\n" + text + "\n\n是否复制到剪贴板？")) {
      navigator.clipboard.writeText(text).then(() => toast("已复制")).catch(() => prompt("请长按复制：", text));
    }
  });

  $("user-import").addEventListener("click", () => {
    $("user-import-label").classList.remove("hidden");
    $("user-import-input").classList.remove("hidden");
    $("user-import-actions").classList.remove("hidden");
    setTimeout(() => $("user-import-input").focus(), 50);
  });
  $("user-import-cancel").addEventListener("click", () => {
    $("user-import-label").classList.add("hidden");
    $("user-import-input").classList.add("hidden");
    $("user-import-input").value = "";
    $("user-import-actions").classList.add("hidden");
  });
  $("user-import-confirm").addEventListener("click", () => {
    const raw = $("user-import-input").value.trim();
    if (!raw) { toast("请先粘贴身份码"); return; }
    const id = raw.startsWith("SHIGUANGJIAYI_") ? raw.slice(14) : raw;
    if (!id || id.length < 4) { toast("身份码不对"); return; }
    if (confirm("切换身份后，这台设备原来的海报和设置暂时看不到（但没删）。是否继续？")) {
      SnapStory.setUserId(id);
      toast("已切换身份，刷新中…");
      setTimeout(() => location.reload(), 1200);
    }
  });

  $("user-reset").addEventListener("click", () => {
    if (!confirm("确定要重置身份吗？原来的海报还在但看不到了。")) return;
    if (!confirm("再确认：真的重置吗？")) return;
    SnapStory.newUser();
    toast("已生成新身份");
    setTimeout(() => location.reload(), 1000);
  });

  // ---------------- 最近的海报 ----------------
  let galleryToken = 0;
  let historyToken = 0;

  function showGalleryList() {
    $("gallery-list-view").classList.remove("hidden");
    $("gallery-detail-view").classList.add("hidden");
  }

  function formatCommentTime(ts) {
    const d = new Date(Number(ts) || Date.now());
    return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function renderHistoryComments(recipe) {
    const box = $("history-comments");
    const comments = Array.isArray(recipe.comments) ? recipe.comments : [];
    if (!comments.length) {
      box.innerHTML = '<p class="gallery-empty">还没有家人留言。</p>';
      return;
    }
    box.innerHTML = `<h3>家人的留言（${comments.length}）</h3>` + comments.map((c) => `
      <div class="history-comment">
        <strong>${escapeHtml(c.name || "家人")}</strong>
        <p>${escapeHtml(c.content || "")}</p>
        <span>${escapeHtml(formatCommentTime(c.at))}</span>
      </div>
    `).join("");
  }

  let galleryItems = [];
  let historyIndex = 0;

  function remoteViewUrl(item) {
    const u = new URL("view.html", location.href);
    const params = ["k=" + encodeURIComponent(item.syncKey || "")];
    if (window.SnapBackend && SnapBackend.getBase()) {
      params.push("b=" + encodeURIComponent(SnapBackend.getBase()));
    }
    u.hash = params.join("&");
    return u.href;
  }

  // 云端海报是生成时的快照，把留言重新画进「家人的留言」区域
  function paintRemoteComments(posterEl, recipe, comments, token) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (token !== historyToken) return;
      try {
        const c = document.createElement("canvas");
        c.width = 1080; c.height = 1820;
        c.getContext("2d").drawImage(img, 0, 0, 1080, 1820);
        SnapStory.paintComments(c, { style: recipe.style || "文艺", comments: comments });
        posterEl.src = c.toDataURL("image/jpeg", 0.92);
      } catch (e) { /* 取不到像素就保留原图 */ }
    };
    img.src = recipe.remoteUrl;
  }

  async function openHistoryAt(index) {
    const total = galleryItems.length;
    if (!total) return;
    historyIndex = ((index % total) + total) % total;
    const recipe = galleryItems[historyIndex];
    if (!recipe) return;

    const token = ++historyToken;
    $("gallery-list-view").classList.add("hidden");
    $("gallery-detail-view").classList.remove("hidden");
    $("history-title").textContent = `${recipe.title || "海报"}${recipe.dateText ? " · " + recipe.dateText : ""}`;
    $("history-page-link").href = recipe.remote ? remoteViewUrl(recipe) : SnapStory.pageUrlFor(recipe);

    const multi = total > 1;
    $("history-counter").textContent = multi
      ? `第 ${historyIndex + 1} 张 / 共 ${total} 张，左右滑动翻看`
      : "";
    $("history-prev").classList.toggle("hidden", !multi);
    $("history-next").classList.toggle("hidden", !multi);

    const poster = $("history-poster");
    poster.style.opacity = "0.35";

    // 只有云端记录（换设备后恢复出来的），直接用云端图片
    if (recipe.remote) {
      poster.src = recipe.remoteUrl;
      poster.style.opacity = "1";
      renderHistoryComments({ comments: [] });
      if (window.SnapBackend && recipe.syncKey) {
        SnapBackend.fetchComments(recipe.syncKey).then((list) => {
          if (token !== historyToken) return;
          renderHistoryComments({ comments: list });
          if (list.length) paintRemoteComments(poster, recipe, list, token);
        }).catch(() => { /* 云端取不到就显示空 */ });
      }
      return;
    }

    // 本机海报：先渲染，再补留言；补到后重画，让留言出现在海报里
    let canvas = null;
    const repaint = async () => {
      try {
        if (!canvas) canvas = document.createElement("canvas");
        await SnapStory.renderPoster(canvas, recipe);
        if (token !== historyToken) return;
        poster.src = canvas.toDataURL("image/jpeg", 0.9);
      } catch (e) {
        poster.src = recipe.photo || "";
      }
      if (token === historyToken) poster.style.opacity = "1";
    };
    await repaint();
    if (token !== historyToken) return;
    renderHistoryComments(recipe);

    const afterMerge = (list) => {
      if (token !== historyToken) return;
      if (!mergeComments(recipe, list)) return;
      SnapStory.updatePoster(recipe);
      renderHistoryComments(recipe);
      repaint();
    };

    if (recipe.syncKey && window.SnapBackend) {
      SnapBackend.fetchComments(recipe.syncKey).then(afterMerge).catch(() => { /* 离线时看本机留言 */ });
    }
    if (recipe.syncKey && window.SnapSync) {
      SnapSync.fetchAll(recipe.syncKey).then(afterMerge).catch(() => { /* 离线时看本机留言 */ });
    }
  }

  function stepHistory(delta) {
    if (galleryItems.length < 2) return;
    openHistoryAt(historyIndex + delta);
  }

  (function bindHistorySwipe() {
    const zone = $("history-swipe");
    let startX = 0;
    let startY = 0;
    let tracking = false;
    zone.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      tracking = true;
    });
    zone.addEventListener("pointerup", (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) < 45) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.3) return;
      stepHistory(dx < 0 ? 1 : -1);
    });
    zone.addEventListener("pointercancel", () => { tracking = false; });
  })();

  function loadImageCORS(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function gallerySubText(item) {
    const n = Array.isArray(item.comments) ? item.comments.length : 0;
    const date = item.dateText || "";
    const tail = n ? `${n} 条留言` : "还没有留言";
    return date ? `${date} · ${tail}` : tail;
  }

  // 云端海报：把留言画进「家人的留言」区域，再换成缩略画布
  async function paintRemoteThumb(card, img, item, token) {
    const list = Array.isArray(item.comments) ? item.comments : [];
    if (!list.length || !item.remoteUrl) return;
    try {
      const image = await loadImageCORS(item.remoteUrl);
      if (token !== galleryToken) return;
      const full = document.createElement("canvas");
      full.width = 1080; full.height = 1820;
      const fctx = full.getContext("2d");
      fctx.drawImage(image, 0, 0, 1080, 1820);
      SnapStory.paintComments(full, { style: item.style || "文艺", comments: list });
      const thumb = document.createElement("canvas");
      thumb.className = "gallery-thumb";
      thumb.width = 270; thumb.height = 455;
      thumb.getContext("2d").drawImage(full, 0, 0, thumb.width, thumb.height);
      if (token !== galleryToken) return;
      if (img.parentNode === card) card.replaceChild(thumb, img);
    } catch (e) { /* 取不到像素就保留原图 */ }
  }

  async function drawLocalThumb(thumb, item, token) {
    try {
      const full = document.createElement("canvas");
      await SnapStory.renderPoster(full, item);
      if (token !== galleryToken) return;
      thumb.getContext("2d").drawImage(full, 0, 0, thumb.width, thumb.height);
    } catch (e) {
      const img = new Image();
      img.onload = () => {
        try { thumb.getContext("2d").drawImage(img, 0, 0, thumb.width, thumb.height); } catch (e2) { /* 忽略 */ }
      };
      img.src = item.photo || "";
    }
  }

  // 异步补全每张卡片的留言（云端可用时），失败静默保留本机结果
  async function refreshGalleryComments(pairs, token) {
    if (!window.SnapBackend || !SnapBackend.isConfigured()) return;
    const queue = pairs.filter((p) => p.item && p.item.syncKey).slice(0, 12);
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const cur = queue[cursor++];
        if (token !== galleryToken) return;
        const list = await SnapBackend.fetchComments(cur.item.syncKey);
        if (token !== galleryToken) return;
        if (!Array.isArray(list) || !list.length) continue;
        // 与本机已有留言合并去重，避免云端少一条时把本机留言冲掉
        const before = Array.isArray(cur.item.comments) ? cur.item.comments.length : 0;
        mergeComments(cur.item, list);
        if (cur.item.comments.length === before) continue;
        if (cur.sub) cur.sub.textContent = gallerySubText(cur.item);
        await cur.refresh();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  function renderGalleryItems(items, token) {
    const grid = $("gallery-grid");
    grid.innerHTML = "";
    const pairs = [];

    items.forEach((item, idx) => {
      const card = document.createElement("button");
      card.className = "gallery-item";
      card.type = "button";
      card.setAttribute("aria-label", `查看 ${item.title || "海报"} ${item.dateText || ""}`);

      const meta = document.createElement("span");
      meta.className = "gallery-meta";
      meta.innerHTML = `<strong>${escapeHtml(item.title || "美好时光")}</strong><small>${escapeHtml(gallerySubText(item))}</small>`;
      const sub = meta.querySelector("small");
      card.appendChild(meta);

      card.addEventListener("click", () => openHistoryAt(idx));
      grid.appendChild(card);

      if (item.remote) {
        const img = document.createElement("img");
        img.className = "gallery-thumb";
        img.loading = "lazy";
        img.alt = "海报";
        img.src = item.remoteUrl;
        card.insertBefore(img, meta);
        pairs.push({
          item, sub,
          refresh: async () => {
            if (Array.isArray(item.comments) && item.comments.length) {
              await paintRemoteThumb(card, img, item, token);
            }
          }
        });
        return;
      }

      const thumb = document.createElement("canvas");
      thumb.className = "gallery-thumb";
      thumb.width = 270;
      thumb.height = 455;
      card.insertBefore(thumb, meta);
      drawLocalThumb(thumb, item, token);
      pairs.push({
        item, sub,
        refresh: async () => { await drawLocalThumb(thumb, item, token); }
      });
    });

    // 本机先出卡片，再异步用云端留言补全（换设备后也能看到）
    refreshGalleryComments(pairs, token);
  }

  async function openGallery() {
    const token = ++galleryToken;
    showGalleryList();
    $("gallery-modal").classList.remove("hidden");

    // 先渲染本机海报，保证后端不通时也能正常用
    const local = SnapStory.listPosters();
    galleryItems = local;
    $("gallery-empty").classList.toggle("hidden", local.length > 0);
    renderGalleryItems(local, token);

    // 再异步补充云端海报：换设备后输入同一身份码也能看到
    if (!window.SnapBackend || !SnapBackend.isConfigured()) return;
    let remote = [];
    try {
      remote = await SnapBackend.listPosters(SnapStory.getUserId());
    } catch (e) {
      remote = [];
    }
    if (token !== galleryToken || !remote.length) return;

    const seen = new Set(local.map((r) => r.syncKey).filter(Boolean));
    const extra = remote
      .filter((p) => p.syncKey && !seen.has(p.syncKey))
      .map((p) => ({
        id: "cloud-" + p.syncKey,
        syncKey: p.syncKey,
        remote: true,
        remoteUrl: p.url,
        createdAt: Number(p.meta && p.meta.createdAt) || p.at || 0,
        title: (p.meta && p.meta.title) || "云端保存的海报",
        style: (p.meta && p.meta.style) || "文艺",
        dateText: (p.meta && p.meta.dateText) || (p.at ? new Date(p.at).toLocaleDateString("zh-CN") : ""),
        comments: []
      }));
    if (!extra.length) return;

    galleryItems = local.concat(extra).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    $("gallery-empty").classList.add("hidden");
    renderGalleryItems(galleryItems, token);
  }

  $("gallery-btn").addEventListener("click", openGallery);
  $("gallery-close").addEventListener("click", () => {
    galleryToken += 1;
    $("gallery-modal").classList.add("hidden");
    showGalleryList();
  });
  $("gallery-back").addEventListener("click", () => {
    historyToken += 1;
    showGalleryList();
  });
  $("history-prev").addEventListener("click", () => stepHistory(-1));
  $("history-next").addEventListener("click", () => stepHistory(1));

  // ---------------- 帮助 ----------------
  $("help-btn").addEventListener("click", () => $("help-modal").classList.remove("hidden"));
  $("help-close").addEventListener("click", () => $("help-modal").classList.add("hidden"));

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });
  });

  setStep(1);
})();
