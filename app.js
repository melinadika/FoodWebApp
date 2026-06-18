const DB_NAME = "cafeteria-tracker";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const API_URL = "/api/entries";
const PUBLISH_STATUS_URL = "/api/publish/status";
const STATIC_DATA_URL = "data/entries.json";
const TAGS = ["Healthy", "Filling", "Light", "Spicy", "Vegetarian", "Bland", "Too salty", "Good value", "Repeat", "Avoid"];

const state = {
  db: null,
  entries: [],
  storageMode: "browser",
  selectedDate: toDateKey(new Date()),
  visibleMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  search: "",
  rating: 4,
  selectedTags: new Set(),
  photoData: "",
  publishStatus: null,
  publishPollId: null,
};

const els = {
  calendarGrid: document.querySelector("#calendarGrid"),
  monthLabel: document.querySelector("#monthLabel"),
  selectedDateLabel: document.querySelector("#selectedDateLabel"),
  dayStats: document.querySelector("#dayStats"),
  breakfastList: document.querySelector("#breakfastList"),
  lunchList: document.querySelector("#lunchList"),
  prevMonth: document.querySelector("#prevMonth"),
  nextMonth: document.querySelector("#nextMonth"),
  todayButton: document.querySelector("#todayButton"),
  quickAddButton: document.querySelector("#quickAddButton"),
  searchInput: document.querySelector("#searchInput"),
  publishStatus: document.querySelector("#publishStatus"),
  publishStatusText: document.querySelector("#publishStatusText"),
  mealDialog: document.querySelector("#mealDialog"),
  mealForm: document.querySelector("#mealForm"),
  mealId: document.querySelector("#mealId"),
  mealDate: document.querySelector("#mealDate"),
  mealType: document.querySelector("#mealType"),
  dishName: document.querySelector("#dishName"),
  ratingGroup: document.querySelector("#ratingGroup"),
  wouldEatAgain: document.querySelector("#wouldEatAgain"),
  tagOptions: document.querySelector("#tagOptions"),
  photoInput: document.querySelector("#photoInput"),
  photoPreview: document.querySelector("#photoPreview"),
  notes: document.querySelector("#notes"),
  dialogTitle: document.querySelector("#dialogTitle"),
  deleteButton: document.querySelector("#deleteButton"),
  cancelButton: document.querySelector("#cancelButton"),
  closeDialog: document.querySelector("#closeDialog"),
  mealCardTemplate: document.querySelector("#mealCardTemplate"),
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("mealType", "mealType", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function sortEntries(entries) {
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

function transaction(mode = "readonly") {
  return state.db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function getBrowserEntries() {
  return new Promise((resolve, reject) => {
    const request = transaction().getAll();
    request.onsuccess = () => resolve(sortEntries(request.result));
    request.onerror = () => reject(request.error);
  });
}

function saveBrowserEntry(entry) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").put(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteBrowserEntry(id) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearBrowserEntries() {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function apiRequest(options = {}) {
  const response = await fetch(API_URL, {
    headers: { "content-type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`File storage request failed: ${response.status}`);
  }

  return response.json();
}

async function getPublishStatus() {
  const response = await fetch(PUBLISH_STATUS_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Publish status request failed: ${response.status}`);
  }
  return response.json();
}

async function getServerEntries() {
  const data = await apiRequest();
  return sortEntries(data.entries || []);
}

async function getStaticEntries() {
  const response = await fetch(STATIC_DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Static data request failed: ${response.status}`);
  }

  const data = await response.json();
  return sortEntries(Array.isArray(data) ? data : data.entries || []);
}

async function writeServerEntries(entries) {
  const data = await apiRequest({
    method: "PUT",
    body: JSON.stringify({ entries: sortEntries([...entries]) }),
  });
  return sortEntries(data.entries || []);
}

async function syncBrowserEntriesToServer() {
  if (!state.db) return;

  const browserEntries = await getBrowserEntries();
  if (browserEntries.length) {
    const merged = new Map(state.entries.map((entry) => [entry.id, entry]));
    browserEntries.forEach((entry) => merged.set(entry.id, entry));
    state.entries = await writeServerEntries([...merged.values()]);
    await clearBrowserEntries();
  }
}

async function initializeStorage() {
  try {
    state.db = await openDb();
  } catch (error) {
    console.warn("Browser storage is unavailable.", error);
  }

  try {
    state.entries = await getServerEntries();
    state.storageMode = "file";
    await syncBrowserEntriesToServer();
  } catch (apiError) {
    try {
      state.entries = await getStaticEntries();
      state.storageMode = "static";
    } catch (staticError) {
      console.warn("Repo file storage is unavailable; using browser storage.", { apiError, staticError });
      if (!state.db) {
        throw new Error("No repo data file or browser storage is available.");
      }
      state.storageMode = "browser";
      state.entries = await getBrowserEntries();
    }
  }
}

function isReadOnly() {
  return state.storageMode === "static";
}

function applyStorageModeUi() {
  document.body.classList.toggle("is-read-only", isReadOnly());
  els.quickAddButton.hidden = isReadOnly();
  document.querySelectorAll(".add-meal-button").forEach((button) => {
    button.hidden = isReadOnly();
  });
  renderPublishStatus();
}

async function ensureEditable() {
  if (!isReadOnly()) return true;
  alert("This hosted copy is read-only. Run the app locally with npm start to add or edit entries.");
  return false;
}

async function refreshStaticEntries() {
  try {
    state.entries = await getStaticEntries();
  } catch (error) {
    console.warn("Could not refresh static entries.", error);
  }
}

async function refreshFileEntries() {
  if (state.storageMode === "file") {
    return getServerEntries();
  }
  if (state.storageMode === "static") {
    await refreshStaticEntries();
    return state.entries;
  }
  return getBrowserEntries();
}

async function getAllEntries() {
  return refreshFileEntries();
}

async function saveEntry(entry) {
  if (!(await ensureEditable())) return;
  if (state.storageMode === "file") {
    const nextEntries = state.entries.filter((item) => item.id !== entry.id);
    nextEntries.push(entry);
    const data = await apiRequest({
      method: "PUT",
      body: JSON.stringify({ entries: sortEntries([...nextEntries]) }),
    });
    state.entries = sortEntries(data.entries || []);
    state.publishStatus = data.publish || state.publishStatus;
    renderPublishStatus();
    return;
  }
  await saveBrowserEntry(entry);
}

async function deleteEntry(id) {
  if (!(await ensureEditable())) return;
  if (state.storageMode === "file") {
    const data = await apiRequest({
      method: "PUT",
      body: JSON.stringify({ entries: state.entries.filter((entry) => entry.id !== id) }),
    });
    state.entries = sortEntries(data.entries || []);
    state.publishStatus = data.publish || state.publishStatus;
    renderPublishStatus();
    return;
  }
  await deleteBrowserEntry(id);
}

async function clearEntries() {
  if (!(await ensureEditable())) return;
  if (state.storageMode === "file") {
    const data = await apiRequest({
      method: "PUT",
      body: JSON.stringify({ entries: [] }),
    });
    state.entries = sortEntries(data.entries || []);
    state.publishStatus = data.publish || state.publishStatus;
    renderPublishStatus();
    return;
  }
  await clearBrowserEntries();
}

function toDateKey(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(key, options = { weekday: "long", month: "long", day: "numeric" }) {
  return parseDateKey(key).toLocaleDateString(undefined, options);
}

function monthRange(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const item = new Date(start);
    item.setDate(start.getDate() + index);
    return item;
  });
}

function filteredEntries() {
  const query = state.search.trim().toLowerCase();
  if (!query) return state.entries;

  return state.entries.filter((entry) => {
    const haystack = [entry.dishName, entry.notes, entry.mealType, ...(entry.tags || [])].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function entriesForDate(key) {
  return filteredEntries().filter((entry) => entry.date === key);
}

function stars(rating) {
  return "★★★★★".slice(0, rating) + "☆☆☆☆☆".slice(0, 5 - rating);
}

function averageRating(entries) {
  if (!entries.length) return 0;
  return entries.reduce((sum, entry) => sum + Number(entry.rating || 0), 0) / entries.length;
}

function render() {
  applyStorageModeUi();
  renderCalendar();
  renderDayPanel();
}

function formatRelativeTime(isoString) {
  if (!isoString) return "";
  const ms = new Date(isoString).getTime() - Date.now();
  if (ms <= 0) return "soon";
  const minutes = Math.ceil(ms / 60000);
  return `${minutes} min`;
}

function renderPublishStatus() {
  if (!els.publishStatus) return;

  const status = state.publishStatus;
  const shouldShow = state.storageMode === "file" && status?.enabled;
  els.publishStatus.hidden = !shouldShow;
  if (!shouldShow) return;

  els.publishStatus.dataset.status = status.status || "idle";

  if (status.status === "pending") {
    els.publishStatusText.textContent = `Publishing in ${formatRelativeTime(status.nextRunAt)}`;
    return;
  }

  if (status.status === "publishing") {
    els.publishStatusText.textContent = "Publishing...";
    return;
  }

  if (status.status === "published") {
    els.publishStatusText.textContent = "Published to GitHub";
    return;
  }

  if (status.status === "error") {
    els.publishStatusText.textContent = "Publish failed";
    return;
  }

  els.publishStatusText.textContent = "Local changes saved";
}

async function refreshPublishStatus() {
  if (state.storageMode !== "file") return;

  try {
    state.publishStatus = await getPublishStatus();
    renderPublishStatus();
  } catch (error) {
    console.warn("Could not refresh publish status.", error);
  }
}

function startPublishStatusPolling() {
  if (state.storageMode !== "file" || state.publishPollId) return;
  refreshPublishStatus();
  state.publishPollId = setInterval(refreshPublishStatus, 10000);
}

function renderCalendar() {
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
  els.monthLabel.textContent = monthFormatter.format(state.visibleMonth);
  els.calendarGrid.replaceChildren();

  monthRange(state.visibleMonth).forEach((date) => {
    const key = toDateKey(date);
    const dayEntries = entriesForDate(key);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-cell";
    button.setAttribute("aria-label", `${formatDate(key)}${dayEntries.length ? `, ${dayEntries.length} logged items` : ""}`);
    if (date.getDay() === 0 || date.getDay() === 6) button.classList.add("is-weekend");
    if (date.getMonth() !== state.visibleMonth.getMonth()) button.classList.add("is-muted");
    if (key === toDateKey(new Date())) button.classList.add("is-today");
    if (key === state.selectedDate) button.classList.add("is-selected");

    const mealCounts = dayEntries.reduce(
      (counts, entry) => {
        counts[entry.mealType] += 1;
        return counts;
      },
      { breakfast: 0, lunch: 0 },
    );

    const average = averageRating(dayEntries);
    button.innerHTML = `
      <div class="day-number">
        <span>${date.getDate()}</span>
        ${key === toDateKey(new Date()) ? '<span class="today-dot" aria-hidden="true"></span>' : ""}
      </div>
      <div class="day-summary">
        ${mealCounts.breakfast ? `<span class="badge">B ${mealCounts.breakfast}</span>` : ""}
        ${mealCounts.lunch ? `<span class="badge lunch">L ${mealCounts.lunch}</span>` : ""}
        ${average ? `<span class="rating-mini">${stars(Math.round(average))}</span>` : ""}
      </div>
      <div class="thumb-strip">
        ${dayEntries
          .filter((entry) => entry.photo)
          .slice(0, 3)
          .map((entry) => `<span class="thumb" style="background-image: url('${entry.photo.replaceAll("'", "%27")}')"></span>`)
          .join("")}
      </div>
    `;
    button.addEventListener("click", () => {
      state.selectedDate = key;
      state.visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      render();
    });
    els.calendarGrid.append(button);
  });
}

function renderDayPanel() {
  const dayEntries = entriesForDate(state.selectedDate);
  const breakfast = dayEntries.filter((entry) => entry.mealType === "breakfast");
  const lunch = dayEntries.filter((entry) => entry.mealType === "lunch");
  const average = averageRating(dayEntries);

  els.selectedDateLabel.textContent = formatDate(state.selectedDate);
  els.dayStats.innerHTML = `
    <div class="stat"><strong>${dayEntries.length}</strong><span>Total items</span></div>
    <div class="stat"><strong>${average ? average.toFixed(1) : "—"}</strong><span>Avg rating</span></div>
    <div class="stat"><strong>${dayEntries.filter((entry) => entry.wouldEatAgain).length}</strong><span>Repeat picks</span></div>
  `;

  renderMealList(els.breakfastList, breakfast, "breakfast");
  renderMealList(els.lunchList, lunch, "lunch");
}

function renderMealList(container, entries, mealType) {
  container.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.search ? `No ${mealType} items match the search.` : `No ${mealType} items logged.`;
    container.append(empty);
    return;
  }

  entries.forEach((entry) => {
    const card = els.mealCardTemplate.content.firstElementChild.cloneNode(true);
    const photo = card.querySelector(".meal-photo");
    const title = card.querySelector("h4");
    const rating = card.querySelector(".rating-pill");
    const meta = card.querySelector(".meal-meta");
    const tags = card.querySelector(".meal-tags");
    const notes = card.querySelector(".meal-notes");
    const actions = card.querySelector(".meal-actions");

    title.textContent = entry.dishName;
    rating.textContent = stars(entry.rating);
    meta.textContent = `${entry.wouldEatAgain ? "Would eat again" : "Not marked as repeat"} · ${formatDate(entry.date, { month: "short", day: "numeric" })}`;
    notes.textContent = entry.notes || "";
    notes.hidden = !entry.notes;

    if (entry.photo) {
      photo.style.backgroundImage = `url('${entry.photo.replaceAll("'", "%27")}')`;
    } else {
      photo.classList.add("no-photo");
      photo.textContent = "No photo";
    }

    (entry.tags || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = tag;
      tags.append(chip);
    });

    actions.hidden = isReadOnly();
    if (!isReadOnly()) {
      card.querySelector(".edit-meal").addEventListener("click", () => openMealDialog(entry));
      card.querySelector(".delete-meal").addEventListener("click", async () => {
        if (!confirm(`Delete ${entry.dishName}?`)) return;
        await deleteEntry(entry.id);
        await refreshEntries();
      });
    }

    container.append(card);
  });
}

function renderRatingButtons() {
  els.ratingGroup.replaceChildren();
  for (let value = 1; value <= 5; value += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = stars(value);
    button.className = value === state.rating ? "is-active" : "";
    button.setAttribute("aria-pressed", String(value === state.rating));
    button.addEventListener("click", () => {
      state.rating = value;
      renderRatingButtons();
    });
    els.ratingGroup.append(button);
  }
}

function renderTagButtons() {
  els.tagOptions.replaceChildren();
  TAGS.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag;
    button.className = state.selectedTags.has(tag) ? "is-active" : "";
    button.setAttribute("aria-pressed", String(state.selectedTags.has(tag)));
    button.addEventListener("click", () => {
      if (state.selectedTags.has(tag)) state.selectedTags.delete(tag);
      else state.selectedTags.add(tag);
      renderTagButtons();
    });
    els.tagOptions.append(button);
  });
}

function renderPhotoPreview() {
  els.photoPreview.className = state.photoData ? "photo-preview" : "photo-preview empty";
  els.photoPreview.replaceChildren();
  if (!state.photoData) {
    els.photoPreview.textContent = "No photo selected";
    return;
  }

  const image = document.createElement("img");
  image.src = state.photoData;
  image.alt = "Selected meal";
  els.photoPreview.append(image);
}

function openMealDialog(entry = null, mealType = "lunch") {
  if (isReadOnly()) {
    ensureEditable();
    return;
  }

  const isEdit = Boolean(entry);
  els.dialogTitle.textContent = isEdit ? "Edit item" : "Add item";
  els.mealId.value = entry?.id || "";
  els.mealDate.value = entry?.date || state.selectedDate;
  els.mealType.value = entry?.mealType || mealType;
  els.dishName.value = entry?.dishName || "";
  els.wouldEatAgain.checked = Boolean(entry?.wouldEatAgain);
  els.notes.value = entry?.notes || "";
  els.photoInput.value = "";
  els.deleteButton.hidden = !isEdit;
  state.rating = Number(entry?.rating || 4);
  state.selectedTags = new Set(entry?.tags || []);
  state.photoData = entry?.photo || "";
  renderRatingButtons();
  renderTagButtons();
  renderPhotoPreview();
  els.mealDialog.showModal();
  els.dishName.focus();
}

function closeMealDialog() {
  els.mealDialog.close();
}

async function refreshEntries() {
  state.entries = await getAllEntries();
  render();
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function wireEvents() {
  els.prevMonth.addEventListener("click", () => {
    state.visibleMonth = new Date(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth() - 1, 1);
    render();
  });

  els.nextMonth.addEventListener("click", () => {
    state.visibleMonth = new Date(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth() + 1, 1);
    render();
  });

  els.todayButton.addEventListener("click", () => {
    const today = new Date();
    state.selectedDate = toDateKey(today);
    state.visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    render();
  });

  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  els.quickAddButton.addEventListener("click", () => openMealDialog(null, "lunch"));

  document.querySelectorAll(".add-meal-button").forEach((button) => {
    button.addEventListener("click", () => openMealDialog(null, button.dataset.mealType));
  });

  els.closeDialog.addEventListener("click", closeMealDialog);
  els.cancelButton.addEventListener("click", closeMealDialog);

  els.photoInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    state.photoData = await imageFileToDataUrl(file);
    renderPhotoPreview();
  });

  els.mealForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const now = new Date().toISOString();
    const existing = state.entries.find((entry) => entry.id === els.mealId.value);
    const entry = {
      id: existing?.id || crypto.randomUUID(),
      date: els.mealDate.value,
      mealType: els.mealType.value,
      dishName: els.dishName.value.trim(),
      rating: state.rating,
      photo: state.photoData,
      notes: els.notes.value.trim(),
      wouldEatAgain: els.wouldEatAgain.checked,
      tags: [...state.selectedTags],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (!entry.dishName) return;
    await saveEntry(entry);
    state.selectedDate = entry.date;
    state.visibleMonth = new Date(parseDateKey(entry.date).getFullYear(), parseDateKey(entry.date).getMonth(), 1);
    closeMealDialog();
    await refreshEntries();
  });

  els.deleteButton.addEventListener("click", async () => {
    if (!els.mealId.value) return;
    const entry = state.entries.find((item) => item.id === els.mealId.value);
    if (!confirm(`Delete ${entry?.dishName || "this item"}?`)) return;
    await deleteEntry(els.mealId.value);
    closeMealDialog();
    await refreshEntries();
  });

}

async function init() {
  await initializeStorage();
  wireEvents();
  await refreshEntries();
  startPublishStatusPolling();
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main class="app-shell"><h1>Could not load the app</h1><p>${error.message}</p></main>`;
});
