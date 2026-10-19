/* FlipHTML5 -> PDF : simple client-side app */
(function () {
  "use strict";

  var $url = document.getElementById("url");
  var $go = document.getElementById("go");
  var $status = document.getElementById("status");
  var $preview = document.getElementById("preview");
  var $download = document.getElementById("download");

  var DECODER_URL =
    "https://static.fliphtml5.com/resourceFiles/html5_templates/js/deString.js";

  var modulePromise = null;
  var downloadUrl = null;
  var busy = false;

  function setStatus(msg) {
    $status.textContent = msg || "";
  }

  // ---- 1. validate the link -------------------------------------------------
  function parseBook(input) {
    var url = new URL(input.trim()); // throws on invalid URL
    if (!/(^|\.)fliphtml5\.com$/i.test(url.hostname)) {
      throw new Error("Not a fliphtml5.com link");
    }
    var parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      throw new Error("Link must look like https://online.fliphtml5.com/<user>/<book>/");
    }
    return {
      base: url.protocol + "//" + url.host + "/" + parts[0] + "/" + parts[1] + "/",
      name: parts[1],
    };
  }

  // ---- 2. load the wasm decoder once ---------------------------------------
  function ensureDecoder() {
    if (modulePromise) return modulePromise;
    modulePromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = DECODER_URL;
      s.onload = function () {
        (function wait() {
          if (window.Module && window.Module.calledRun) resolve();
          else setTimeout(wait, 50);
        })();
      };
      s.onerror = function () { reject(new Error("Could not load the decoder")); };
      document.head.appendChild(s);
    });
    return modulePromise;
  }

  // ---- 3. decode the `fliphtml5_pages` string ------------------------------
  function decodePages(encoded) {
    var M = window.Module;
    var bytes = new TextEncoder().encode(encoded);
    var ptr = M._malloc(bytes.length + 1);
    M.HEAPU8.set(bytes, ptr);
    M.HEAPU8[ptr + bytes.length] = 0;

    var outPtr = M._DeString(ptr);
    var end = outPtr;
    while (M.HEAPU8[end] !== 0) end++;
    var out = new TextDecoder().decode(M.HEAPU8.subarray(outPtr, end));

    if (M._FreeMemory) M._FreeMemory(outPtr);
    if (M._free) M._free(ptr);

    var i = out.lastIndexOf("]");
    if (i >= 0) out = out.substring(0, i + 1);
    return JSON.parse(out);
  }

  // ---- 4. image helpers -----------------------------------------------------
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous"; // so the canvas stays exportable
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("image failed: " + src)); };
      img.src = src;
    });
  }

  function toJpeg(img, maxSide) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var scale = Math.min(1, maxSide / Math.max(w, h));
    var cw = Math.round(w * scale), ch = Math.round(h * scale);

    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);

    var dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    var b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    var bin = atob(b64);
    var data = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { data: data, w: cw, h: ch };
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- 5. main flow ---------------------------------------------------------
  async function start() {
    if (busy) return;
    busy = true;
    $go.disabled = true;
    $download.disabled = true;
    $download.style.display = "none";
    $preview.innerHTML = "";
    if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }

    try {
      var book = parseBook($url.value);
    } catch (e) {
      setStatus("Invalid link: " + e.message);
      busy = false; $go.disabled = false;
      return;
    }

    try {
      setStatus("Fetching book configuration…");
      var resp = await fetch(book.base + "javascript/config.js");
      if (!resp.ok) throw new Error("config.js not found (" + resp.status + ")");
      var cfg = await resp.text();

      var m = cfg.match(/"fliphtml5_pages"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (!m) throw new Error("this book has no page list");
      var encoded = JSON.parse('"' + m[1] + '"');

      setStatus("Loading decoder…");
      await ensureDecoder();

      var pages = decodePages(encoded);
      if (!pages.length) throw new Error("no pages found");

      setStatus("Found " + pages.length + " pages. Loading images…");

      var pdfPages = [];
      for (var i = 0; i < pages.length; i++) {
        var rel = pages[i].n && pages[i].n[0];
        if (!rel) continue;

        var img;
        try {
          img = await loadImage(book.base + rel);
        } catch (e) {
          continue; // skip a broken page, keep going
        }

        $preview.appendChild(img);
        pdfPages.push(toJpeg(img, 1600));
        setStatus("Loaded " + (i + 1) + " / " + pages.length + " pages…");
        await sleep(0); // let the UI breathe
      }

      if (!pdfPages.length) throw new Error("no images could be loaded");

      setStatus("Building PDF…");
      var bytes = window.buildPDF(pdfPages, { width: 612, height: 792 });
      var blob = new Blob([bytes], { type: "application/pdf" });
      downloadUrl = URL.createObjectURL(blob);

      $download.disabled = false;
      $download.style.display = "block";
      setStatus("Done — " + pdfPages.length + " pages. Click Download PDF (top right).");
    } catch (e) {
      setStatus("Error: " + e.message);
    } finally {
      busy = false;
      $go.disabled = false;
    }
  }

  // ---- 6. events ------------------------------------------------------------
  $go.addEventListener("click", start);
  $url.addEventListener("keydown", function (e) {
    if (e.key === "Enter") start();
  });
  $download.addEventListener("click", function () {
    if (!downloadUrl) return;
    var a = document.createElement("a");
    a.href = downloadUrl;
    a.download = (parseBookSafe($url.value) || "book") + ".pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  function parseBookSafe(v) {
    try { return parseBook(v).name; } catch (e) { return null; }
  }
})();
