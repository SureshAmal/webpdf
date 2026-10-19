/* FlipHTML5 -> PDF : simple client-side app */
(function () {
  "use strict";

  var $url = document.getElementById("url");
  var $go = document.getElementById("go");
  var $status = document.getElementById("status");
  var $preview = document.getElementById("preview");
  var $downloads = document.getElementById("downloads");
  var $dlOptimized = document.getElementById("download-optimized");
  var $dlLarge = document.getElementById("download-large");

  var DECODER_URL =
    "https://static.fliphtml5.com/resourceFiles/html5_templates/js/deString.js";

  var CONCURRENCY = 10;   // pages downloaded at the same time
  var MAX_RETRIES = 5;    // per page, on rate limiting / network errors

  // two output qualities, built from the same decoded pages
  var QUALITY = {
    optimized: { maxSide: 1200, quality: 0.72 }, // smaller file
    large:     { maxSide: 1700, quality: 0.92 }, // best quality / bigger file
  };

  var modulePromise = null;
  var downloadUrls = { optimized: null, large: null };
  var objectUrls = [];
  var busy = false;

  function setStatus(msg) { $status.textContent = msg || ""; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- 1. validate the link -------------------------------------------------
  function parseBook(input) {
    var url = new URL(input.trim());
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

  // ---- 4. fetching with rate-limit handling --------------------------------
  function backoff(attempt) {
    return Math.min(10000, 400 * Math.pow(2, attempt)) + Math.random() * 200;
  }

  async function fetchBlob(url, attempt) {
    attempt = attempt || 0;
    var resp;
    try {
      resp = await fetch(url, { cache: "force-cache" });
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        await sleep(backoff(attempt));
        return fetchBlob(url, attempt + 1);
      }
      throw e;
    }

    var ct = resp.headers.get("content-type") || "";
    var rateLimited = resp.status === 429 || resp.status === 503;
    // a soft block often returns 200 with an HTML body instead of an image
    var wrongType = resp.ok && !ct.startsWith("image/");

    if (rateLimited || wrongType) {
      if (attempt >= MAX_RETRIES) {
        throw new Error("blocked/rate-limited (HTTP " + resp.status + ", " + ct + ")");
      }
      var ra = parseFloat(resp.headers.get("retry-after"));
      var delay = (!isNaN(ra) && ra > 0)
        ? ra * 1000
        : Math.min(30000, 500 * Math.pow(2, attempt)) + Math.random() * 300;
      setStatus("Rate limited — waiting " + Math.round(delay / 1000) + "s…");
      await sleep(delay);
      return fetchBlob(url, attempt + 1);
    }

    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.blob();
  }

  // ---- 5. image -> jpeg -----------------------------------------------------
  function size(src) {
    return { w: src.width || src.naturalWidth, h: src.height || src.naturalHeight };
  }

  function toJpeg(src, maxSide, quality) {
    var s = size(src);
    var scale = Math.min(1, maxSide / Math.max(s.w, s.h));
    var cw = Math.round(s.w * scale), ch = Math.round(s.h * scale);

    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(src, 0, 0, cw, ch);

    var dataUrl = canvas.toDataURL("image/jpeg", quality);
    var b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    var bin = atob(b64);
    var data = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { data: data, w: cw, h: ch };
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("image failed")); };
      img.src = src;
    });
  }

  // ---- 6. run N workers over N jobs, keeping results indexed ---------------
  async function runPool(n, limit, worker) {
    var next = 0;
    async function runner() {
      while (true) {
        var i = next++;
        if (i >= n) return;
        await worker(i);
      }
    }
    var runners = [];
    for (var k = 0; k < Math.min(limit, n); k++) runners.push(runner());
    await Promise.all(runners);
  }

  function buildBlobUrl(pdfPages) {
    var bytes = window.buildPDF(pdfPages, { width: 612, height: 792 });
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  }

  // ---- 7. main flow ---------------------------------------------------------
  async function start() {
    if (busy) return;
    busy = true;
    $go.disabled = true;
    $downloads.style.display = "none";
    $dlOptimized.disabled = true;
    $dlLarge.disabled = true;
    $preview.innerHTML = "";
    objectUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    objectUrls = [];
    ["optimized", "large"].forEach(function (k) {
      if (downloadUrls[k]) { URL.revokeObjectURL(downloadUrls[k]); downloadUrls[k] = null; }
    });

    var book;
    try {
      book = parseBook($url.value);
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

      var items = [];
      pages.forEach(function (pg) { if (pg.n && pg.n[0]) items.push(pg.n[0]); });
      setStatus("Found " + items.length + " pages. Loading " + CONCURRENCY + " at a time…");

      var imgs = items.map(function () {
        var im = document.createElement("img");
        $preview.appendChild(im);
        return im;
      });

      var optPages = new Array(items.length);
      var largePages = new Array(items.length);
      var done = 0, failed = 0;

      await runPool(items.length, CONCURRENCY, async function (i) {
        var url = book.base + items[i];
        var blob;
        try {
          blob = await fetchBlob(url);
        } catch (e) {
          console.warn("page " + (i + 1) + " failed:", e);
          optPages[i] = null; largePages[i] = null; failed++;
          return;
        }

        var objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        imgs[i].src = objectUrl;

        var source;
        try {
          source = await createImageBitmap(blob);
        } catch (e) {
          source = await loadImage(objectUrl); // fallback decoder
        }

        optPages[i] = toJpeg(source, QUALITY.optimized.maxSide, QUALITY.optimized.quality);
        largePages[i] = toJpeg(source, QUALITY.large.maxSide, QUALITY.large.quality);

        done++;
        setStatus("Loaded " + done + " / " + items.length + " pages…");
      });

      var optOk = optPages.filter(Boolean);
      var largeOk = largePages.filter(Boolean);
      if (!optOk.length) throw new Error("no images could be loaded");

      setStatus("Building PDFs…");
      downloadUrls.optimized = buildBlobUrl(optOk);
      downloadUrls.large = buildBlobUrl(largeOk);

      $dlOptimized.disabled = false;
      $dlLarge.disabled = false;
      $downloads.style.display = "flex";
      setStatus(
        "Done — " + optOk.length + " pages" +
        (failed ? " (" + failed + " skipped)" : "") +
        ". Choose optimized (small) or large (best quality)."
      );
    } catch (e) {
      setStatus("Error: " + e.message);
    } finally {
      busy = false;
      $go.disabled = false;
    }
  }

  function save(kind) {
    if (!downloadUrls[kind]) return;
    var a = document.createElement("a");
    a.href = downloadUrls[kind];
    a.download = (parseBookSafe($url.value) || "book") + "-" + kind + ".pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---- 8. events ------------------------------------------------------------
  $go.addEventListener("click", start);
  $url.addEventListener("keydown", function (e) { if (e.key === "Enter") start(); });
  $dlOptimized.addEventListener("click", function () { save("optimized"); });
  $dlLarge.addEventListener("click", function () { save("large"); });

  function parseBookSafe(v) {
    try { return parseBook(v).name; } catch (e) { return null; }
  }

  // optional auto-start: index.html?url=https://online.fliphtml5.com/<user>/<book>/
  try {
    var preset = new URLSearchParams(location.search).get("url");
    if (preset) { $url.value = preset; start(); }
  } catch (e) {}
})();
