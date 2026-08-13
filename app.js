"use strict";

const KIT_CATEGORIES = ["HG", "RG", "MG", "PG", "EG", "SD", "RE/100", "Figure-rise", "30MM", "30MS", "30MF", "その他"];
const DB_NAME = "plamo-stock-db";
const DB_VERSION = 1;
const LOW_STOCK_LEVEL = 25;

const state = {
  db: null,
  kits: [],
  paints: [],
  selectedPhotos: [],
  objectUrls: new Set(),
  previewUrls: new Set(),
  toastTimer: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "未入力";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

function formatCurrency(value) {
  if (value === "" || value === null || value === undefined) return "未入力";
  return `${Number(value).toLocaleString("ja-JP")}円`;
}

function durationInDays(start, end) {
  if (!start || !end) return null;
  const startTime = new Date(`${start}T00:00:00`).getTime();
  const endTime = new Date(`${end}T00:00:00`).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) return null;
  return Math.round((endTime - startTime) / 86400000);
}

function durationLabel(start, end) {
  const days = durationInDays(start, end);
  if (days === null) return "未計算";
  if (days === 0) return "当日完成";
  if (days < 30) return `${days}日`;
  const months = Math.floor(days / 30);
  const remainder = days % 30;
  return remainder ? `約${months}か月 ${remainder}日` : `約${months}か月`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kits")) db.createObjectStore("kits", { keyPath: "id" });
      if (!db.objectStoreNames.contains("paints")) db.createObjectStore("paints", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbRequest(storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const getAll = (store) => dbRequest(store, "readonly", (s) => s.getAll());
const putRecord = (store, record) => dbRequest(store, "readwrite", (s) => s.put(record));
const deleteRecord = (store, id) => dbRequest(store, "readwrite", (s) => s.delete(id));
const clearStore = (store) => dbRequest(store, "readwrite", (s) => s.clear());

async function refreshState() {
  [state.kits, state.paints] = await Promise.all([getAll("kits"), getAll("paints")]);
  renderAll();
}

function trackObjectUrl(blob, preview = false) {
  const url = URL.createObjectURL(blob);
  (preview ? state.previewUrls : state.objectUrls).add(url);
  return url;
}

function releaseUrls(collection) {
  collection.forEach((url) => URL.revokeObjectURL(url));
  collection.clear();
}

function photoMarkup(kit, className = "") {
  const firstPhoto = kit.photos?.[0];
  if (!firstPhoto) return `<div class="placeholder-art ${className}" data-label="${escapeHtml(kit.category || "MODEL KIT")}"></div>`;
  const blob = firstPhoto.blob instanceof Blob ? firstPhoto.blob : firstPhoto;
  return `<img class="${className}" src="${trackObjectUrl(blob)}" alt="${escapeHtml(kit.name)}の写真" />`;
}

function kitStatusText(kit) {
  return kit.status === "built" ? "組立済み" : "未組立";
}

function isLowPaint(paint) {
  return Number(paint.quantity || 0) === 0 || (paint.opened === "opened" && Number(paint.stockLevel) <= LOW_STOCK_LEVEL);
}

function renderAll() {
  releaseUrls(state.objectUrls);
  renderDashboard();
  renderKitFilters();
  renderKits();
  renderPaints();
}

function renderDashboard() {
  const totalKits = state.kits.length;
  const built = state.kits.filter((kit) => kit.status === "built").length;
  const unbuilt = totalKits - built;
  const rate = totalKits ? Math.round((built / totalKits) * 100) : 0;
  const lowPaints = state.paints.filter(isLowPaint).length;

  $("#todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  $("#metricUnbuilt").textContent = unbuilt;
  $("#metricBuilt").textContent = built;
  $("#metricPaints").textContent = state.paints.reduce((sum, paint) => sum + Number(paint.quantity || 0), 0);
  $("#metricLowPaint").textContent = lowPaints;
  $("#completionRate").textContent = rate;
  $("#heroBuiltCount").textContent = `${built} / ${totalKits}`;
  $("#completionRing").style.background = `conic-gradient(var(--accent) ${rate}%, #343932 ${rate}%)`;

  const recent = [...state.kits].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 3);
  const recentList = $("#recentKitList");
  recentList.innerHTML = recent.length ? recent.map((kit) => `
    <button class="mini-kit-card" type="button" data-kit-detail="${escapeHtml(kit.id)}">
      <span class="mini-thumb">${photoMarkup(kit)}</span>
      <span>
        <span class="status-chip ${kit.status}">${kitStatusText(kit)}</span>
        <strong>${escapeHtml(kit.name)}</strong>
        <small>${escapeHtml(kit.category || "その他")} ${kit.purchaseDate ? `・${formatDate(kit.purchaseDate)}` : ""}</small>
      </span>
    </button>`).join("") : emptyInline("まだ登録がありません", "最初のプラモデルを登録すると、ここに表示されます。", "dashboard-add-kit");

  const counts = state.kits.reduce((map, kit) => map.set(kit.category || "その他", (map.get(kit.category || "その他") || 0) + 1), new Map());
  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maximum = Math.max(...categories.map(([, count]) => count), 1);
  $("#categoryChart").innerHTML = categories.length ? categories.map(([category, count]) => `
    <div class="category-row">
      <span>${escapeHtml(category)}</span>
      <div class="chart-track"><i style="width:${Math.max(8, Math.round((count / maximum) * 100))}%"></i></div>
      <strong>${count}</strong>
    </div>`).join("") : `<div class="empty-state" style="min-height:220px;padding:25px"><div><strong>内訳はまだありません</strong><p>キットを登録するとカテゴリーごとの数が表示されます。</p></div></div>`;
}

function emptyInline(title, text, action) {
  return `<div class="empty-state"><div><span class="empty-shape" aria-hidden="true"></span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p><button class="primary-button" type="button" data-empty-action="${action}">登録する</button></div></div>`;
}

function renderKitFilters() {
  const current = $("#kitCategoryFilter").value || "all";
  const categories = [...new Set([...KIT_CATEGORIES, ...state.kits.map((kit) => kit.category).filter(Boolean)])];
  $("#kitCategoryFilter").innerHTML = `<option value="all">すべてのカテゴリー</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  $("#kitCategoryFilter").value = categories.includes(current) ? current : "all";
}

function filteredKits() {
  const query = $("#kitSearch").value.trim().toLocaleLowerCase("ja");
  const status = $("#kitStatusFilter").value;
  const category = $("#kitCategoryFilter").value;
  const sort = $("#kitSort").value;
  const values = state.kits.filter((kit) => {
    const haystack = [kit.name, kit.series, kit.maker, kit.store, kit.location, ...(kit.tags || [])].join(" ").toLocaleLowerCase("ja");
    return (!query || haystack.includes(query)) && (status === "all" || kit.status === status) && (category === "all" || kit.category === category);
  });
  values.sort((a, b) => {
    if (sort === "name") return String(a.name).localeCompare(String(b.name), "ja");
    if (sort === "purchase-newest") return String(b.purchaseDate || "").localeCompare(String(a.purchaseDate || ""));
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
  return values;
}

function renderKits() {
  const kits = filteredKits();
  $("#kitCountLabel").textContent = `${state.kits.length}件を登録中`;
  $("#kitGrid").innerHTML = kits.length ? kits.map((kit) => `
    <article class="kit-card">
      <button class="kit-card-button" type="button" data-kit-detail="${escapeHtml(kit.id)}" aria-label="${escapeHtml(kit.name)}の詳細を見る">
        <div class="kit-card-photo">
          ${photoMarkup(kit)}
          <span class="status-chip ${kit.status}">${kitStatusText(kit)}</span>
          ${kit.photos?.length > 1 ? `<span class="photo-count">写真 ${kit.photos.length}</span>` : ""}
        </div>
        <div class="kit-card-copy">
          <div class="kit-card-kicker"><span class="category-chip">${escapeHtml(kit.category || "その他")}</span><small>${escapeHtml(kit.scale || kit.maker || "")}</small></div>
          <h3>${escapeHtml(kit.name)}</h3>
          <div class="kit-meta">
            ${kit.status === "built" ? `<span>${escapeHtml(kit.buildFinish || "素組")}</span>` : ""}
            ${kit.purchaseDate ? `<span>購入 ${formatDate(kit.purchaseDate)}</span>` : ""}
            ${kit.location ? `<span>${escapeHtml(kit.location)}</span>` : ""}
          </div>
        </div>
      </button>
    </article>`).join("") : emptyInline(
      state.kits.length ? "条件に合うキットがありません" : "プラモデルを登録しましょう",
      state.kits.length ? "検索語や絞り込み条件を変更してください。" : "写真、購入情報、製作状況をひとつにまとめられます。",
      "add-kit"
    );
}

function filteredPaints() {
  const query = $("#paintSearch").value.trim().toLocaleLowerCase("ja");
  const type = $("#paintTypeFilter").value;
  const lowOnly = $("#lowStockOnly").checked;
  return [...state.paints].filter((paint) => {
    const haystack = [paint.name, paint.maker, paint.line, paint.code, paint.location].join(" ").toLocaleLowerCase("ja");
    return (!query || haystack.includes(query)) && (type === "all" || paint.type === type) && (!lowOnly || isLowPaint(paint));
  }).sort((a, b) => String(a.maker || "").localeCompare(String(b.maker || ""), "ja") || String(a.name).localeCompare(String(b.name), "ja"));
}

function renderPaints() {
  const paints = filteredPaints();
  const quantity = state.paints.reduce((sum, paint) => sum + Number(paint.quantity || 0), 0);
  const sealed = state.paints.filter((paint) => paint.opened === "sealed").length;
  const low = state.paints.filter(isLowPaint).length;
  $("#paintCountLabel").textContent = `${state.paints.length}色・${quantity}本を登録中`;
  $("#paintTotal").textContent = state.paints.length;
  $("#paintSealed").textContent = sealed;
  $("#paintLow").textContent = low;
  $("#paintList").innerHTML = paints.length ? paints.map((paint) => {
    const level = paint.opened === "sealed" ? 100 : Number(paint.stockLevel ?? 100);
    const lowPaint = isLowPaint(paint);
    return `<article class="paint-card" data-paint-id="${escapeHtml(paint.id)}">
      <div class="paint-swatch" style="background:${escapeHtml(paint.swatch || "#737A7C")}" aria-label="色見本 ${escapeHtml(paint.swatch || "#737A7C")}"></div>
      <div class="paint-copy">
        <small>${escapeHtml([paint.maker, paint.line, paint.code].filter(Boolean).join(" / ") || "メーカー未入力")}</small>
        <h3>${escapeHtml(paint.name)}</h3>
        <div class="paint-meta"><span>${escapeHtml(paint.type || "その他")}</span><span>${paint.opened === "sealed" ? "未開封" : "開封済み"}</span><span>${Number(paint.quantity || 0)}本</span>${lowPaint ? `<span class="stock-chip low">要補充</span>` : ""}</div>
      </div>
      <div class="stock-visual ${lowPaint ? "is-low" : ""}"><strong>${level}%</strong><div class="stock-bar"><i style="width:${Math.min(100, Math.max(0, level))}%"></i></div></div>
      <div class="paint-card-menu"><button type="button" data-edit-paint="${escapeHtml(paint.id)}" aria-label="${escapeHtml(paint.name)}を編集">⋯</button></div>
    </article>`;
  }).join("") : emptyInline(
    state.paints.length ? "条件に合う塗料がありません" : "塗料を登録しましょう",
    state.paints.length ? "検索語や絞り込み条件を変更してください。" : "色名、品番、残量を記録して買い足し忘れを防げます。",
    "add-paint"
  );
}

function setView(view, updateHash = true) {
  if (!['dashboard', 'kits', 'paints'].includes(view)) view = "dashboard";
  $$('[data-view-panel]').forEach((panel) => panel.classList.toggle("is-active", panel.dataset.viewPanel === view));
  $$('[data-view]').forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function populateCategorySelect() {
  $("#kitCategory").innerHTML = KIT_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
}

function selectedRadio(name) {
  return $(`input[name="${name}"]:checked`)?.value;
}

function setRadio(name, value) {
  const input = $$(`input[name="${name}"]`).find((item) => item.value === value);
  if (input) input.checked = true;
}

function resetPhotoSelection() {
  releaseUrls(state.previewUrls);
  state.selectedPhotos = [];
  $("#kitCameraInput").value = "";
  $("#kitGalleryInput").value = "";
  $("#photoPreviewList").innerHTML = "";
  $("#deleteExistingPhotos").checked = false;
}

function openKitForm(id = null) {
  const form = $("#kitForm");
  form.reset();
  resetPhotoSelection();
  $("#kitId").value = "";
  $("#kitCategory").value = "HG";
  $("#kitDialogTitle").textContent = "プラモデルを登録";
  $("#deleteKitButton").hidden = true;
  $("#deletePhotosLabel").hidden = true;

  if (id) {
    const kit = state.kits.find((item) => item.id === id);
    if (!kit) return;
    $("#kitId").value = kit.id;
    $("#kitName").value = kit.name || "";
    $("#kitCategory").value = KIT_CATEGORIES.includes(kit.category) ? kit.category : "その他";
    $("#kitSeries").value = kit.series || "";
    $("#kitMaker").value = kit.maker || "";
    $("#kitScale").value = kit.scale || "";
    setRadio("kitStatus", kit.status || "unbuilt");
    setRadio("buildFinish", kit.buildFinish || "素組");
    $("#kitStartedAt").value = kit.startedAt || "";
    $("#kitCompletedAt").value = kit.completedAt || "";
    $("#kitPurchaseDate").value = kit.purchaseDate || "";
    $("#kitStore").value = kit.store || "";
    $("#kitPrice").value = kit.price ?? "";
    $("#kitLocation").value = kit.location || "";
    $("#kitTags").value = (kit.tags || []).join(", ");
    $("#kitNotes").value = kit.notes || "";
    $("#kitDialogTitle").textContent = "プラモデルを編集";
    $("#deleteKitButton").hidden = false;
    $("#deletePhotosLabel").hidden = !(kit.photos?.length);
  }
  updateBuiltFields();
  updateDurationPreview();
  $("#kitDialog").showModal();
  requestAnimationFrame(() => $("#kitName").focus());
}

function updateBuiltFields() {
  $("#builtFields").hidden = selectedRadio("kitStatus") !== "built";
}

function updateDurationPreview() {
  const start = $("#kitStartedAt").value;
  const end = $("#kitCompletedAt").value;
  const days = durationInDays(start, end);
  $("#durationPreview").textContent = days === null
    ? "開始日と完成日を入れると製作期間を自動計算します。"
    : `製作期間：${durationLabel(start, end)}`;
}

async function imageToBlob(file) {
  if (!file.type.startsWith("image/")) throw new Error("画像ファイルではありません");
  let source;
  let sourceWidth;
  let sourceHeight;
  if ("createImageBitmap" in window) {
    source = await createImageBitmap(file);
    sourceWidth = source.width;
    sourceHeight = source.height;
  } else {
    const url = URL.createObjectURL(file);
    source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    URL.revokeObjectURL(url);
    sourceWidth = source.naturalWidth;
    sourceHeight = source.naturalHeight;
  }
  const maxSide = 1600;
  const ratio = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * ratio));
  canvas.height = Math.max(1, Math.round(sourceHeight * ratio));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("写真を処理できませんでした")), "image/jpeg", 0.84));
}

async function addSelectedPhotos(files) {
  const editingKit = state.kits.find((kit) => kit.id === $("#kitId").value);
  const existingCount = $("#deleteExistingPhotos").checked ? 0 : (editingKit?.photos?.length || 0);
  const available = Math.max(0, 5 - existingCount - state.selectedPhotos.length);
  const chosen = [...files].slice(0, available);
  if (!chosen.length) {
    showToast("写真は最大5枚まで登録できます");
    return;
  }
  try {
    for (const file of chosen) {
      const blob = await imageToBlob(file);
      state.selectedPhotos.push({ blob, name: file.name || "photo.jpg", type: "image/jpeg" });
    }
    if (files.length > chosen.length) showToast("最大5枚まで追加しました");
    renderSelectedPhotoPreviews();
  } catch (error) {
    console.error(error);
    showToast("写真を読み込めませんでした。別の画像を選んでください");
  }
}

function renderSelectedPhotoPreviews() {
  releaseUrls(state.previewUrls);
  $("#photoPreviewList").innerHTML = state.selectedPhotos.map((photo, index) => `
    <div class="photo-preview-item">
      <img src="${trackObjectUrl(photo.blob, true)}" alt="追加する写真 ${index + 1}" />
      <button type="button" data-remove-photo="${index}" aria-label="写真${index + 1}を外す">×</button>
    </div>`).join("");
}

async function saveKit(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const editing = state.kits.find((kit) => kit.id === $("#kitId").value);
  const name = $("#kitName").value.trim();
  const category = $("#kitCategory").value;
  const duplicate = state.kits.find((kit) => kit.id !== editing?.id && kit.name.trim().toLocaleLowerCase("ja") === name.toLocaleLowerCase("ja") && kit.category === category);
  if (duplicate && !confirm(`「${duplicate.name}」は同じカテゴリーですでに登録されています。追加しますか？`)) return;

  let photos = editing?.photos || [];
  if ($("#deleteExistingPhotos").checked) photos = [];
  photos = [...photos, ...state.selectedPhotos].slice(0, 5);
  const status = selectedRadio("kitStatus");
  const now = new Date().toISOString();
  const record = {
    id: editing?.id || uid("kit"),
    name,
    category,
    series: $("#kitSeries").value.trim(),
    maker: $("#kitMaker").value.trim(),
    scale: $("#kitScale").value.trim(),
    status,
    buildFinish: status === "built" ? selectedRadio("buildFinish") : "",
    startedAt: status === "built" ? $("#kitStartedAt").value : "",
    completedAt: status === "built" ? $("#kitCompletedAt").value : "",
    purchaseDate: $("#kitPurchaseDate").value,
    store: $("#kitStore").value.trim(),
    price: $("#kitPrice").value === "" ? null : Number($("#kitPrice").value),
    location: $("#kitLocation").value.trim(),
    tags: $("#kitTags").value.split(/[,、]/).map((tag) => tag.trim()).filter(Boolean),
    notes: $("#kitNotes").value.trim(),
    photos,
    createdAt: editing?.createdAt || now,
    updatedAt: now,
  };
  await putRecord("kits", record);
  $("#kitDialog").close();
  resetPhotoSelection();
  await refreshState();
  showToast(editing ? "プラモデルを更新しました" : "プラモデルを登録しました");
}

async function removeKit(id) {
  const kit = state.kits.find((item) => item.id === id);
  if (!kit || !confirm(`「${kit.name}」を削除しますか？`)) return;
  await deleteRecord("kits", id);
  $("#kitDialog").close();
  $("#kitDetailDialog").open && $("#kitDetailDialog").close();
  await refreshState();
  showToast("プラモデルを削除しました");
}

function openPaintForm(id = null) {
  const form = $("#paintForm");
  form.reset();
  $("#paintId").value = "";
  $("#paintSwatch").value = "#737a7c";
  $("#paintSwatchText").value = "#737A7C";
  $("#paintDialogTitle").textContent = "塗料を登録";
  $("#deletePaintButton").hidden = true;
  if (id) {
    const paint = state.paints.find((item) => item.id === id);
    if (!paint) return;
    $("#paintId").value = paint.id;
    $("#paintName").value = paint.name || "";
    $("#paintMaker").value = paint.maker || "";
    $("#paintLine").value = paint.line || "";
    $("#paintCode").value = paint.code || "";
    $("#paintType").value = paint.type || "ラッカー";
    $("#paintSwatch").value = paint.swatch || "#737a7c";
    $("#paintSwatchText").value = (paint.swatch || "#737A7C").toUpperCase();
    $("#paintQuantity").value = paint.quantity ?? 1;
    setRadio("paintOpened", paint.opened || "sealed");
    $("#paintStockLevel").value = paint.stockLevel ?? 100;
    $("#paintPurchaseDate").value = paint.purchaseDate || "";
    $("#paintStore").value = paint.store || "";
    $("#paintLocation").value = paint.location || "";
    $("#paintNotes").value = paint.notes || "";
    $("#paintDialogTitle").textContent = "塗料を編集";
    $("#deletePaintButton").hidden = false;
  }
  updatePaintOpenedFields();
  updateStockOutput();
  $("#paintDialog").showModal();
  requestAnimationFrame(() => $("#paintName").focus());
}

function updatePaintOpenedFields() {
  $("#stockLevelField").hidden = selectedRadio("paintOpened") !== "opened";
}

function updateStockOutput() {
  $("#stockLevelOutput").textContent = `${$("#paintStockLevel").value}%`;
}

async function savePaint(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const editing = state.paints.find((paint) => paint.id === $("#paintId").value);
  const opened = selectedRadio("paintOpened");
  const now = new Date().toISOString();
  const record = {
    id: editing?.id || uid("paint"),
    name: $("#paintName").value.trim(),
    maker: $("#paintMaker").value.trim(),
    line: $("#paintLine").value.trim(),
    code: $("#paintCode").value.trim(),
    type: $("#paintType").value,
    swatch: $("#paintSwatchText").value.toUpperCase(),
    quantity: Number($("#paintQuantity").value || 0),
    opened,
    stockLevel: opened === "opened" ? Number($("#paintStockLevel").value) : 100,
    purchaseDate: $("#paintPurchaseDate").value,
    store: $("#paintStore").value.trim(),
    location: $("#paintLocation").value.trim(),
    notes: $("#paintNotes").value.trim(),
    createdAt: editing?.createdAt || now,
    updatedAt: now,
  };
  await putRecord("paints", record);
  $("#paintDialog").close();
  await refreshState();
  showToast(editing ? "塗料を更新しました" : "塗料を登録しました");
}

async function removePaint(id) {
  const paint = state.paints.find((item) => item.id === id);
  if (!paint || !confirm(`「${paint.name}」を削除しますか？`)) return;
  await deleteRecord("paints", id);
  $("#paintDialog").close();
  await refreshState();
  showToast("塗料を削除しました");
}

function showKitDetail(id) {
  const kit = state.kits.find((item) => item.id === id);
  if (!kit) return;
  const photos = (kit.photos || []).map((photo) => photo.blob instanceof Blob ? photo.blob : photo);
  const photoUrls = photos.map((photo) => trackObjectUrl(photo));
  const mainPhoto = photoUrls[0]
    ? `<img class="detail-main-photo" id="detailMainPhoto" src="${photoUrls[0]}" alt="${escapeHtml(kit.name)}の写真" />`
    : `<div class="placeholder-art" data-label="${escapeHtml(kit.category || "MODEL KIT")}"></div>`;
  const duration = kit.status === "built" ? durationLabel(kit.startedAt, kit.completedAt) : "未組立";
  $("#kitDetailContent").innerHTML = `
    <div class="detail-layout">
      <div class="detail-gallery">
        ${mainPhoto}
        ${photoUrls.length > 1 ? `<div class="detail-photo-strip">${photoUrls.map((url, index) => `<button class="${index === 0 ? "is-active" : ""}" type="button" data-detail-photo="${url}"><img src="${url}" alt="写真 ${index + 1}" /></button>`).join("")}</div>` : ""}
      </div>
      <div class="detail-copy">
        <div class="detail-copy-header">
          <div><div class="detail-badges"><span class="status-chip ${kit.status}">${kitStatusText(kit)}</span><span class="category-chip">${escapeHtml(kit.category || "その他")}</span>${kit.buildFinish ? `<span class="finish-chip">${escapeHtml(kit.buildFinish)}</span>` : ""}</div><h2 id="detailKitName">${escapeHtml(kit.name)}</h2></div>
          <button class="close-button" aria-label="閉じる" type="button" data-close-dialog>×</button>
        </div>
        <div class="detail-copy-body">
          <div class="detail-grid">
            <div><span>シリーズ・作品</span><strong>${escapeHtml(kit.series || "未入力")}</strong></div>
            <div><span>メーカー / スケール</span><strong>${escapeHtml([kit.maker, kit.scale].filter(Boolean).join(" / ") || "未入力")}</strong></div>
            <div><span>購入日</span><strong>${formatDate(kit.purchaseDate)}</strong></div>
            <div><span>購入店</span><strong>${escapeHtml(kit.store || "未入力")}</strong></div>
            <div><span>購入価格</span><strong>${formatCurrency(kit.price)}</strong></div>
            <div><span>保管場所</span><strong>${escapeHtml(kit.location || "未入力")}</strong></div>
            ${kit.status === "built" ? `<div><span>製作開始日</span><strong>${formatDate(kit.startedAt)}</strong></div><div><span>完成日 / 製作期間</span><strong>${formatDate(kit.completedAt)} / ${duration}</strong></div>` : ""}
          </div>
          ${kit.notes ? `<div class="detail-notes">${escapeHtml(kit.notes)}</div>` : ""}
          ${kit.tags?.length ? `<div class="tag-list">${kit.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        </div>
        <div class="detail-copy-footer"><button class="secondary-button" type="button" data-edit-detail-kit="${escapeHtml(kit.id)}">編集する</button></div>
      </div>
    </div>`;
  $("#kitDetailDialog").showModal();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function exportBackup() {
  showToast("バックアップを作成しています");
  const kits = [];
  for (const kit of state.kits) {
    const photos = [];
    for (const photo of kit.photos || []) {
      const blob = photo.blob instanceof Blob ? photo.blob : photo;
      photos.push({ name: photo.name || "photo.jpg", type: blob.type || "image/jpeg", data: await blobToDataUrl(blob) });
    }
    kits.push({ ...kit, photos });
  }
  const payload = { app: "PLAMO STOCK", version: 1, exportedAt: new Date().toISOString(), kits, paints: state.paints };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `plamo-stock-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("バックアップを書き出しました");
}

async function importBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.app !== "PLAMO STOCK" || !Array.isArray(payload.kits) || !Array.isArray(payload.paints)) throw new Error("invalid");
    if (!confirm(`現在のデータを置き換え、プラモデル${payload.kits.length}件・塗料${payload.paints.length}色を復元しますか？`)) return;
    const restoredKits = [];
    for (const kit of payload.kits) {
      const photos = [];
      for (const photo of kit.photos || []) {
        if (!photo.data?.startsWith("data:image/")) continue;
        photos.push({ blob: await dataUrlToBlob(photo.data), name: photo.name || "photo.jpg", type: photo.type || "image/jpeg" });
      }
      restoredKits.push({ ...kit, photos });
    }
    await Promise.all([clearStore("kits"), clearStore("paints")]);
    for (const kit of restoredKits) await putRecord("kits", kit);
    for (const paint of payload.paints) await putRecord("paints", paint);
    $("#backupDialog").close();
    await refreshState();
    showToast("バックアップから復元しました");
  } catch (error) {
    console.error(error);
    showToast("このバックアップは読み込めませんでした");
  } finally {
    $("#importInput").value = "";
  }
}

function openAddChoice() { $("#addChoiceDialog").showModal(); }
function openBackup() { $("#backupDialog").showModal(); }

function bindEvents() {
  $$('[data-view]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$('[data-go-view]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.goView)));
  window.addEventListener("hashchange", () => setView(location.hash.slice(1), false));
  $("#quickAddButton").addEventListener("click", openAddChoice);
  $("#mobileAddButton").addEventListener("click", openAddChoice);
  $("#heroAddKit").addEventListener("click", () => openKitForm());
  $("#heroAddPaint").addEventListener("click", () => openPaintForm());
  $("#addKitButton").addEventListener("click", () => openKitForm());
  $("#addPaintButton").addEventListener("click", () => openPaintForm());
  $("#choiceAddKit").addEventListener("click", () => { $("#addChoiceDialog").close(); openKitForm(); });
  $("#choiceAddPaint").addEventListener("click", () => { $("#addChoiceDialog").close(); openPaintForm(); });
  $("#backupButton").addEventListener("click", openBackup);
  $("#mobileBackupButton").addEventListener("click", openBackup);

  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $$('dialog').forEach((dialog) => dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }));

  $$('input[name="kitStatus"]').forEach((input) => input.addEventListener("change", updateBuiltFields));
  $("#kitStartedAt").addEventListener("change", updateDurationPreview);
  $("#kitCompletedAt").addEventListener("change", updateDurationPreview);
  $("#kitForm").addEventListener("submit", saveKit);
  $("#deleteKitButton").addEventListener("click", () => removeKit($("#kitId").value));
  $("#cameraButton").addEventListener("click", () => $("#kitCameraInput").click());
  $("#galleryButton").addEventListener("click", () => $("#kitGalleryInput").click());
  $("#kitCameraInput").addEventListener("change", (event) => addSelectedPhotos(event.target.files));
  $("#kitGalleryInput").addEventListener("change", (event) => addSelectedPhotos(event.target.files));
  $("#photoPreviewList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-photo]");
    if (!button) return;
    state.selectedPhotos.splice(Number(button.dataset.removePhoto), 1);
    renderSelectedPhotoPreviews();
  });

  $$('input[name="paintOpened"]').forEach((input) => input.addEventListener("change", updatePaintOpenedFields));
  $("#paintStockLevel").addEventListener("input", updateStockOutput);
  $("#paintSwatch").addEventListener("input", (event) => { $("#paintSwatchText").value = event.target.value.toUpperCase(); });
  $("#paintSwatchText").addEventListener("input", (event) => { if (/^#[0-9a-f]{6}$/i.test(event.target.value)) $("#paintSwatch").value = event.target.value; });
  $("#paintForm").addEventListener("submit", savePaint);
  $("#deletePaintButton").addEventListener("click", () => removePaint($("#paintId").value));

  [$("#kitSearch"), $("#kitStatusFilter"), $("#kitCategoryFilter"), $("#kitSort")].forEach((input) => input.addEventListener("input", renderAll));
  [$("#paintSearch"), $("#paintTypeFilter"), $("#lowStockOnly")].forEach((input) => input.addEventListener("input", renderPaints));

  document.addEventListener("click", (event) => {
    const kitButton = event.target.closest("[data-kit-detail]");
    if (kitButton) showKitDetail(kitButton.dataset.kitDetail);
    const editPaintButton = event.target.closest("[data-edit-paint]");
    if (editPaintButton) openPaintForm(editPaintButton.dataset.editPaint);
    const paintCard = event.target.closest("[data-paint-id]");
    if (paintCard && !editPaintButton) openPaintForm(paintCard.dataset.paintId);
    const emptyAction = event.target.closest("[data-empty-action]")?.dataset.emptyAction;
    if (emptyAction === "add-kit" || emptyAction === "dashboard-add-kit") openKitForm();
    if (emptyAction === "add-paint") openPaintForm();
    const detailPhoto = event.target.closest("[data-detail-photo]");
    if (detailPhoto) {
      $("#detailMainPhoto").src = detailPhoto.dataset.detailPhoto;
      $$('[data-detail-photo]').forEach((button) => button.classList.toggle("is-active", button === detailPhoto));
    }
    const editKit = event.target.closest("[data-edit-detail-kit]");
    if (editKit) { $("#kitDetailDialog").close(); openKitForm(editKit.dataset.editDetailKit); }
  });

  $("#exportButton").addEventListener("click", exportBackup);
  $("#importButton").addEventListener("click", () => $("#importInput").click());
  $("#importInput").addEventListener("change", (event) => event.target.files[0] && importBackup(event.target.files[0]));
}

async function init() {
  populateCategorySelect();
  bindEvents();
  setView(location.hash.slice(1) || "dashboard", false);
  try {
    state.db = await openDatabase();
    await refreshState();
  } catch (error) {
    console.error(error);
    showToast("端末内の保存領域を開けませんでした");
  }
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker.js").catch(console.error);
}

init();
