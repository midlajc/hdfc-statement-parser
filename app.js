import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileList = document.getElementById("file-list");
const tileTemplate = document.getElementById("file-tile-template");
const sharedStatus = document.getElementById("shared-status");

const DATE_TIME_RE = /^\s*(\d{2}\/\d{2}\/\d{4})\s*\|\s*(\d{2}:\d{2})\s*(.*)$/;
const DATE_RE = /(\d{2}\/\d{2}\/\d{4})/;
const TIME_RE = /(\d{2}:\d{2})/;
const FOREX_RE = /\b(?<currency>[A-Z]{3})\b\s+(?<amount>[\d,]+(?:\.\d{1,2})?)\s*$/;
const PAGE_SIZE = 20;

function cleanAmount(str) {
  if (!str) return null;
  const match = str.match(/([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ""));
}

function parseNewLine(rawLine) {
  if (!rawLine.trim()) return [];

  let datePart;
  let timePart;
  let rest;
  const m = rawLine.match(DATE_TIME_RE);
  if (m) {
    [, datePart, timePart, rest] = m;
  } else {
    const dm = rawLine.match(DATE_RE);
    if (!dm) return [];
    datePart = dm[1];
    rest = rawLine.slice(dm.index + dm[0].length).trim();
    const tm = rawLine.match(TIME_RE);
    timePart = tm ? tm[1] : "";
  }

  let txnType = "Dr";
  let amountStr = "";
  let splitIndex = rest.lastIndexOf("+ C");
  if (splitIndex !== -1) {
    txnType = "Cr";
    amountStr = rest.slice(splitIndex + 3).trim();
    rest = rest.slice(0, splitIndex).trim();
  } else {
    splitIndex = rest.lastIndexOf(" C");
    if (splitIndex !== -1) {
      amountStr = rest.slice(splitIndex + 2).trim();
      rest = rest.slice(0, splitIndex).trim();
    }
  }

  const amount = cleanAmount(amountStr);
  let forexCurrency = "INR";
  let forexAmount = null;
  let description = rest;

  const forexMatch = rest.match(FOREX_RE);
  if (forexMatch && forexMatch.groups) {
    forexCurrency = forexMatch.groups.currency;
    forexAmount = cleanAmount(forexMatch.groups.amount);
    description = rest.replace(FOREX_RE, "").trim();
  }

  let forexRate = "";
  if (forexAmount && amount) {
    const computed = amount / forexAmount;
    if (Number.isFinite(computed)) {
      forexRate = computed.toFixed(4);
    }
  }

  return [
    {
      date: datePart,
      time: timePart || "",
      description,
      amount: amount ?? "",
      currency: forexCurrency,
      forex_amount: forexAmount ?? "",
      forex_rate: forexRate,
      type: txnType,
    },
  ];
}

function parseOldLine(rawLine, section) {
  if (!rawLine.trim()) return [];
  const dm = rawLine.match(/^\s*(\d{2}\/\d{2}\/\d{4})\s+(.*)$/);
  if (!dm) return [];

  const datePart = dm[1];
  let rest = dm[2].trim();

  const amountMatch = rest.match(/([\d,]+(?:\.\d{1,2})?)\s*(Cr)?\s*$/i);
  if (!amountMatch) return [];

  const amountStr = amountMatch[1];
  const txnType = amountMatch[2] ? "Cr" : "Dr";
  rest = rest.slice(0, amountMatch.index).trim();

  let currency = "INR";
  let forexAmount = "";
  let forexRate = "";
  let description = rest;

  if (section === "international") {
    const forexMatch = rest.match(FOREX_RE);
    if (forexMatch && forexMatch.groups) {
      currency = forexMatch.groups.currency;
      forexAmount = cleanAmount(forexMatch.groups.amount) ?? "";
      description = rest.replace(FOREX_RE, "").trim();
      const amount = cleanAmount(amountStr);
      if (amount && forexAmount) {
        forexRate = (amount / forexAmount).toFixed(2);
      }
    }
  }

  return [
    {
      date: datePart,
      time: "",
      description,
      amount: cleanAmount(amountStr) ?? "",
      currency,
      forex_amount: forexAmount,
      forex_rate: forexRate,
      type: txnType,
    },
  ];
}

function rowsToCsv(rows, format) {
  const cols =
    format === "new"
      ? ["date", "time", "currency", "description", "forex_amount", "forex_rate", "amount", "type"]
      : ["date", "currency", "description", "forex_amount", "forex_rate", "amount", "type"];

  const escapeCell = (value) => {
    const cell = value === null || value === undefined ? "" : String(value);
    return `"${cell.replace(/"/g, '""')}"`;
  };

  const lines = [cols.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(cols.map((col) => escapeCell(row[col] ?? "")).join(","));
  }
  return lines.join("\n");
}

function getColumnsForFormat(format) {
  return format === "new"
    ? ["date", "time", "currency", "description", "forex_amount", "forex_rate", "amount", "type"]
    : ["date", "currency", "description", "forex_amount", "forex_rate", "amount", "type"];
}

async function extractLinesFromPdf(file, password) {
  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data, password: password || undefined });
  const pdf = await loadingTask.promise;

  const allLines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    let buffer = "";
    for (const item of textContent.items) {
      buffer += item.str;
      if (item.hasEOL) {
        allLines.push(buffer.trim());
        buffer = "";
      } else {
        buffer += " ";
      }
    }
    if (buffer.trim()) {
      allLines.push(buffer.trim());
    }
  }

  return allLines;
}

async function parseWithFormat(lines, format) {
  const rows = [];
  if (format === "new") {
    for (const line of lines) {
      rows.push(...parseNewLine(line));
    }
  } else {
    let section = "";
    for (const line of lines) {
      if (/Domestic Transactions/i.test(line)) {
        section = "domestic";
        continue;
      }
      if (/International Transactions/i.test(line)) {
        section = "international";
        continue;
      }
      if (!section) continue;
      rows.push(...parseOldLine(line, section));
    }
  }
  return rows;
}

function renderCsvPreview(container, rows, format) {
  container.innerHTML = "";
  const cols = getColumnsForFormat(format);
  const table = document.createElement("table");
  table.className = "csv-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  cols.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    cols.forEach((col) => {
      const td = document.createElement("td");
      td.textContent = row[col] ?? "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function createTile(file) {
  const node = tileTemplate.content.firstElementChild.cloneNode(true);
  const nameEl = node.querySelector(".file-name");
  const statusEl = node.querySelector(".file-status");
  const removeBtn = node.querySelector(".file-remove");
  const downloadLink = node.querySelector(".download-link");
  const passwordBox = node.querySelector(".password-inline");
  const passwordInput = passwordBox.querySelector("input");
  const passwordSubmit = node.querySelector(".password-submit");
  const previewPanel = node.querySelector(".preview-panel");
  const previewClose = node.querySelector(".preview-close");
  const previewPdfBtn = node.querySelector(".preview-pdf-btn");
  const previewCsvBtn = node.querySelector(".preview-csv-btn");
  const previewPdf = node.querySelector(".preview-pdf-view");
  const previewCsv = node.querySelector(".preview-csv-view");

  let csvUrl = null;
  let pdfUrl = null;
  let parsedRows = null;
  let parsedFormat = null;
  let currentPage = 1;

  const setStatus = (message) => {
    statusEl.textContent = message;
  };

  const cleanup = () => {
    if (csvUrl) {
      URL.revokeObjectURL(csvUrl);
      csvUrl = null;
    }
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      pdfUrl = null;
    }
    node.remove();
  };

  const showPreviewPanel = () => {
    previewPanel.hidden = false;
  };

  const hidePreviewPanel = () => {
    previewPanel.hidden = true;
    previewPdf.hidden = true;
    previewCsv.hidden = true;
  };

  const renderPdfPreview = () => {
    previewPdf.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.src = pdfUrl;
    previewPdf.appendChild(iframe);
  };

  const renderCsvPreviewIfReady = () => {
    previewCsv.innerHTML = "";
    if (!parsedRows || !parsedFormat) {
      const msg = document.createElement("p");
      msg.className = "csv-note";
      msg.textContent = "Parse the statement to preview CSV.";
      previewCsv.appendChild(msg);
      return;
    }
    const totalPages = Math.max(1, Math.ceil(parsedRows.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, parsedRows.length);
    const previewRows = parsedRows.slice(start, end);

    renderCsvPreview(previewCsv, previewRows, parsedFormat);

    const pagination = document.createElement("div");
    pagination.className = "csv-pagination";

    const info = document.createElement("span");
    info.className = "page-info";
    info.textContent = `Page ${currentPage} of ${totalPages} \u2014 rows ${start + 1}-${end} of ${parsedRows.length}`;

    const controls = document.createElement("div");
    controls.className = "page-controls";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "ghost";
    prevBtn.textContent = "Previous";
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener("click", () => {
      currentPage = Math.max(1, currentPage - 1);
      renderCsvPreviewIfReady();
    });

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "ghost";
    nextBtn.textContent = "Next";
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener("click", () => {
      currentPage = Math.min(totalPages, currentPage + 1);
      renderCsvPreviewIfReady();
    });

    controls.appendChild(prevBtn);
    controls.appendChild(nextBtn);
    pagination.appendChild(info);
    pagination.appendChild(controls);
    previewCsv.appendChild(pagination);
  };

  const runParse = async () => {
    downloadLink.hidden = true;
    passwordBox.hidden = true;
    previewPdfBtn.hidden = true;
    previewCsvBtn.hidden = true;
    setStatus("Parsing...");

    try {
      const lines = await extractLinesFromPdf(file, passwordInput.value.trim());
      let rows = await parseWithFormat(lines, "old");
      let parserUsed = "old";

      if (!rows.length) {
        rows = await parseWithFormat(lines, "new");
        parserUsed = "new";
      }

      if (!rows.length) {
        setStatus("No transactions detected. The statement may use a different layout.");
        return;
      }

      const csv = rowsToCsv(rows, parserUsed);
      const blob = new Blob([csv], { type: "text/csv" });

      if (csvUrl) {
        URL.revokeObjectURL(csvUrl);
      }
      csvUrl = URL.createObjectURL(blob);

      downloadLink.href = csvUrl;
      downloadLink.download = file.name.replace(/\.pdf$/i, "") + ".csv";
      downloadLink.hidden = false;

      parsedRows = rows;
      parsedFormat = parserUsed;
      currentPage = 1;
      previewPdfBtn.hidden = false;
      previewCsvBtn.hidden = false;
      setStatus(`Parsed ${rows.length} transactions using ${parserUsed.toUpperCase()} parser.`);
    } catch (err) {
      if (err?.name === "PasswordException") {
        passwordBox.hidden = false;
        previewPdfBtn.hidden = true;
        previewCsvBtn.hidden = true;
        setStatus("Password required to open this PDF.");
      } else {
        setStatus(`Failed to parse PDF: ${err.message || err}`);
      }
    }
  };

  nameEl.textContent = file.name;
  setStatus("Parsing...");
  pdfUrl = URL.createObjectURL(file);

  removeBtn.addEventListener("click", cleanup);
  passwordSubmit.addEventListener("click", runParse);
  previewClose.addEventListener("click", hidePreviewPanel);

  previewPdfBtn.addEventListener("click", () => {
    showPreviewPanel();
    previewCsv.hidden = true;
    previewPdf.hidden = false;
    renderPdfPreview();
  });

  previewCsvBtn.addEventListener("click", () => {
    showPreviewPanel();
    previewPdf.hidden = true;
    previewCsv.hidden = false;
    renderCsvPreviewIfReady();
  });

  fileList.appendChild(node);
  runParse();
}

function acceptFiles(fileListLike) {
  const files = Array.from(fileListLike);
  files.forEach((file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
      return;
    }
    createTile(file);
  });
}

function setSharedStatus(message, isError = false) {
  if (!sharedStatus) return;
  if (!message) {
    sharedStatus.textContent = "";
    sharedStatus.hidden = true;
    sharedStatus.classList.remove("is-error");
    return;
  }

  sharedStatus.textContent = message;
  sharedStatus.hidden = false;
  sharedStatus.classList.toggle("is-error", isError);
}

function clearSharedUrlParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("shared");
  window.history.replaceState({}, "", url);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/service-worker.js");
  } catch (err) {
    console.error("Service worker registration failed:", err);
  }
}

async function waitForServiceWorkerControl(timeoutMs = 5000) {
  if (navigator.serviceWorker.controller) {
    return;
  }

  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for service worker")), timeoutMs);
    }),
  ]);

  if (!navigator.serviceWorker.controller) {
    throw new Error("Current page is not controlled by service worker");
  }
}

async function importSharedFilesIfAny() {
  const url = new URL(window.location.href);
  const sharedState = url.searchParams.get("shared");
  let importedCount = 0;

  if (!sharedState) {
    return;
  }

  if (sharedState === "empty") {
    setSharedStatus("Share target did not include a PDF file.", true);
    clearSharedUrlParams();
    return;
  }

  if (!("serviceWorker" in navigator)) {
    setSharedStatus("Shared import needs service worker support.", true);
    clearSharedUrlParams();
    return;
  }

  try {
    await waitForServiceWorkerControl();
    const pendingResponse = await fetch("/shared-files/pending", { cache: "no-store" });

    if (pendingResponse.status === 204) {
      setSharedStatus("No shared PDF is pending. Upload a file manually.");
      clearSharedUrlParams();
      return;
    }

    if (!pendingResponse.ok) {
      throw new Error(`Pending request failed with status ${pendingResponse.status}`);
    }

    const pending = await pendingResponse.json();
    const sharedFiles = [];

    for (const meta of pending.files || []) {
      if (!meta?.url) continue;

      const fileResponse = await fetch(meta.url, { cache: "no-store" });
      if (!fileResponse.ok) continue;

      const blob = await fileResponse.blob();
      sharedFiles.push(
        new File([blob], meta.name || "statement.pdf", {
          type: meta.type || blob.type || "application/pdf",
          lastModified: Date.now(),
        }),
      );
    }

    if (sharedFiles.length) {
      acceptFiles(sharedFiles);
      importedCount = sharedFiles.length;
      setSharedStatus(
        `Imported ${sharedFiles.length} PDF${sharedFiles.length === 1 ? "" : "s"} from share target.`,
      );
    } else {
      setSharedStatus("No valid PDF was found in shared data.", true);
    }

    // Cleanup should not flip the UI into an import-failure state.
    try {
      if (pending.id) {
        await fetch(`/shared-files/consume?id=${encodeURIComponent(pending.id)}`, {
          cache: "no-store",
        });
      } else {
        await fetch("/shared-files/consume", { cache: "no-store" });
      }
    } catch (consumeErr) {
      console.warn("Shared cleanup failed:", consumeErr);
    }
  } catch (err) {
    if (!importedCount) {
      setSharedStatus("Could not import shared PDF. You can still upload manually.", true);
    }
    console.error("Shared import failed:", err);
  } finally {
    clearSharedUrlParams();
  }
}

registerServiceWorker();
importSharedFilesIfAny();

fileInput.addEventListener("change", (event) => {
  acceptFiles(event.target.files);
  fileInput.value = "";
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("is-dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  acceptFiles(event.dataTransfer.files);
});

dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
