/*
 * pdf.js - tiny dependency-free PDF writer.
 * Writes one page per image. Each image must already be JPEG bytes.
 *
 *   buildPDF([{ data: Uint8Array(jpegBytes), w: pxWidth, h: pxHeight }, ...],
 *            { width: 612, height: 792 })  ->  Uint8Array (the .pdf file)
 */
(function (global) {
  function buildPDF(pages, opts) {
    opts = opts || {};
    var pageW = opts.width || 612;
    var pageH = opts.height || 792;

    var chunks = [];
    var len = 0;
    var enc = new TextEncoder();

    function push(d) {
      if (typeof d === "string") d = enc.encode(d);
      chunks.push(d);
      len += d.length;
    }
    function writeObj(num, dict, stream) {
      off[num] = len;
      push(num + " 0 obj\n" + dict + "\n");
      if (stream) {
        push("stream\n");
        push(stream);
        push("\nendstream\n");
      }
      push("endobj\n");
    }

    var off = [];
    var N = pages.length;
    var total = 2 + N * 3;

    // file header (with the recommended binary comment line)
    push("%PDF-1.4\n");
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    // 1: catalog
    writeObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    // 2: pages tree
    var kids = "";
    for (var i = 0; i < N; i++) kids += (5 + 3 * i) + " 0 R ";
    writeObj(2, "<< /Type /Pages /Kids [ " + kids + "] /Count " + N + " >>");

    for (var j = 0; j < N; j++) {
      var imgId = 3 + 3 * j;
      var contId = 4 + 3 * j;
      var pageId = 5 + 3 * j;
      var p = pages[j];
      var content = "q " + pageW + " 0 0 " + pageH + " 0 0 cm /Im0 Do Q";

      // image XObject
      writeObj(
        imgId,
        "<< /Type /XObject /Subtype /Image /Width " + p.w + " /Height " + p.h +
          " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
          p.data.length + " >>",
        p.data
      );
      // content stream
      writeObj(contId, "<< /Length " + enc.encode(content).length + " >>", content);
      // page
      writeObj(
        pageId,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pageW + " " + pageH +
          "] /Resources << /XObject << /Im0 " + imgId + " 0 R >> >> /Contents " +
          contId + " 0 R >>"
      );
    }

    // xref
    var xrefPos = len;
    var xref = "xref\n0 " + (total + 1) + "\n0000000000 65535 f \n";
    for (var n = 1; n <= total; n++) {
      xref += String(off[n]).padStart(10, "0") + " 00000 n \n";
    }
    push(xref);
    push(
      "trailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\nstartxref\n" +
        xrefPos + "\n%%EOF\n"
    );

    // concat
    var out = new Uint8Array(len);
    var pos = 0;
    for (var k = 0; k < chunks.length; k++) {
      out.set(chunks[k], pos);
      pos += chunks[k].length;
    }
    return out;
  }

  global.buildPDF = buildPDF;
  if (typeof module !== "undefined" && module.exports) module.exports = buildPDF;
})(typeof self !== "undefined" ? self : this);
