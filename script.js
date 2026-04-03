const resources = [
  // Paste your resources here.
  // Example:
  // {
  //   id: "math-td1-pdf",
  //   title: "Math TD1 (PDF)",
  //   type: "document", // "document" | "video" | "audio" | "image" | "archive"
  //   format: "pdf", // e.g. pdf, mp4, mp3, png, zip
  //   subject: "Math",
  //   url: "https://...",
  //   downloadUrl: "https://..." // optional (if different from url)
  // }
];

const DEFAULT_API_BASE_URL = "https://pelerinsite-web.onrender.com";
const API_BASE_URL = DEFAULT_API_BASE_URL;

const UI_PREFS = {
  lang: localStorage.getItem("plr_lang") || "de",
  theme: localStorage.getItem("plr_theme") || "dark",
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return resp;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeWhatsAppPhone(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const digitsOnly = raw.replace(/[^0-9]/g, "");
  if (!digitsOnly) return "";

  // Common international prefix form: 00<countrycode><number>
  if (digitsOnly.startsWith("00")) return digitsOnly.slice(2);
  return digitsOnly;
}

function parseWhatsAppNumbers(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((s) => normalizeWhatsAppPhone(s))
    .filter((s) => Boolean(s) && String(s).length >= 8);
}

function getStoredWhatsAppNumbers() {
  const rawList = localStorage.getItem("plr_whatsapp_numbers");
  if (rawList) {
    try {
      const parsed = JSON.parse(rawList);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x || "").trim()).filter(Boolean);
    } catch {
      // ignore
    }
  }

  const legacy = localStorage.getItem("plr_whatsapp_number") || "";
  const legacyTrim = legacy.trim();
  if (legacyTrim) return [legacyTrim];
  return [];
}

function getActiveWhatsAppNumber() {
  const numbers = getStoredWhatsAppNumbers();
  const active = (localStorage.getItem("plr_whatsapp_active") || "").trim();
  if (active && numbers.includes(active)) return active;
  return numbers[0] || "";
}

let remoteResources = [];
let hasRemoteLoaded = false;

function isRemoteResourceId(id) {
  const needle = String(id || "").trim();
  if (!needle) return false;
  return remoteResources.some((r) => String(r?.id || "") === needle);
}

const UI_STATE = {
  filter: "all",
  query: "",
  sort: "newest",
  tab: "home",
  viewMode: "list",
};

function setActiveTab(tab) {
  const ttab = String(tab || "home");
  UI_STATE.tab = ttab;
  document.body.dataset.tab = ttab;

  const tabs = Array.from(document.querySelectorAll(".tabbar .tab"));
  for (const btn of tabs) {
    btn.classList.toggle("is-active", String(btn.dataset.tab) === ttab);
  }

}

function initTabs() {
  const tabbar = document.querySelector(".tabbar");
  if (!tabbar) return;

  const sidebar = document.getElementById("sidebar");
  const sidebarOverlay = document.getElementById("sidebarOverlay");

  function setSidebarOpen(open) {
    if (!sidebar || !sidebarOverlay) return;
    const next = Boolean(open);
    sidebar.classList.toggle("is-open", next);
    sidebarOverlay.hidden = !next;
    if (next) document.body.dataset.sidebarOpen = "1";
    else delete document.body.dataset.sidebarOpen;
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  tabbar.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest(".tab") : null;
    if (!target) return;

    const tab = String(target.getAttribute("data-tab") || "home");
    if (tab === "library") {
      setActiveTab("library");
      const isOpen = document.body.dataset.sidebarOpen === "1";
      setSidebarOpen(!isOpen);
      return;
    }

    closeSidebar();
    setActiveTab(tab);
  });

  setActiveTab(UI_STATE.tab);
}

function getAllResources() {
  if (API_BASE_URL && hasRemoteLoaded) {
    const merged = [...remoteResources, ...resources];
    const seen = new Set();
    return merged.filter((r) => {
      const id = String(r?.id || "").trim();
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  return resources;
}

async function loadRemoteResources() {
  if (!API_BASE_URL) return;

  try {
    const resp = await fetchWithTimeout(`${API_BASE_URL.replace(/\/$/, "")}/api/resources`);
    if (!resp.ok) throw new Error("fetch_failed");
    const json = await resp.json();
    remoteResources = Array.isArray(json.resources) ? json.resources : [];
    hasRemoteLoaded = true;
  } catch {
    hasRemoteLoaded = false;
    remoteResources = [];
  }
}

function initDeleteActions() {
  const grid = document.getElementById("resourcesGrid");
  if (!grid) return;

  grid.addEventListener("click", async (e) => {
    const target = e.target instanceof Element ? e.target.closest("[data-action=delete]") : null;
    if (!target) return;

    const isContributor = localStorage.getItem("plr_is_contributor") === "1";
    if (!isContributor) return;

    const id = String(target.getAttribute("data-id") || "").trim();
    if (!id) return;

    if (!API_BASE_URL || !hasRemoteLoaded || !isRemoteResourceId(id)) {
      showToast(t("msgDeleteFailed"), "error");
      return;
    }

    const ok = window.confirm(t("msgDeleteConfirm"));
    if (!ok) return;

    const adminCode = String(sessionStorage.getItem("plr_admin_code") || "").trim();
    if (!adminCode) {
      showToast(t("msgDeleteNeedCode"), "error");
      return;
    }

    try {
      const url = `${API_BASE_URL.replace(/\/$/, "")}/api/resources/${encodeURIComponent(id)}`;
      const resp = await fetchWithTimeout(
        url,
        {
        method: "DELETE",
        headers: {
          "x-admin-code": adminCode,
        },
        },
        12000
      );

      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
          showToast(t("msgDeleteNeedCode"), "error");
          throw new Error("unauthorized");
        }
        throw new Error("delete_failed");
      }

      remoteResources = remoteResources.filter((r) => String(r.id) !== id);
      resources.splice(
        0,
        resources.length,
        ...resources.filter((r) => String(r.id) !== id)
      );

      const q = (document.getElementById("searchInput")?.value || "").toString();
      UI_STATE.query = q;
      renderCounts({ query: UI_STATE.query });
      renderResources({ filter: UI_STATE.filter, query: UI_STATE.query });
      showToast(t("msgDeleteSuccess"), "success");
    } catch {
      showToast(t("msgDeleteFailed"), "error");
    }
  });
}

function initReader() {
  const grid = document.getElementById("resourcesGrid");
  const modal = document.getElementById("readerModal");
  const overlay = document.getElementById("readerModalOverlay");
  const closeBtn = document.getElementById("readerModalClose");
  const closeBtn2 = document.getElementById("readerClose");
  const openNewTabBtn = document.getElementById("readerOpenNewTab");
  const titleNode = document.getElementById("readerTitle");
  const bodyNode = document.getElementById("readerBody");

  if (!grid || !modal || !overlay || !closeBtn || !closeBtn2 || !openNewTabBtn || !bodyNode) return;

  let lastUrl = "";
  let lastInlineUrl = "";

  const IMAGE_FORMATS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
  const OFFICE_FORMATS = new Set(["doc", "docx", "ppt", "pptx", "xls", "xlsx"]);

  function close() {
    modal.hidden = true;
    bodyNode.innerHTML = "";
    lastUrl = "";
    lastInlineUrl = "";
  }

  function openWithResource(resource) {
    const id = String(resource?.id || "").trim();
    const type = normalizeType(resource?.type || "");
    const format = String(resource?.format || "").trim().toLowerCase();

    const openUrl =
      API_BASE_URL && hasRemoteLoaded && id && isRemoteResourceId(id)
        ? `${API_BASE_URL.replace(/\/$/, "")}/api/resources/${encodeURIComponent(id)}/open`
        : String(resource?.url || "#");

    lastUrl = openUrl;
    lastInlineUrl = openUrl;
    if (titleNode) titleNode.textContent = String(resource?.title || "Reader");

    const safeUrl = escapeHtml(openUrl);

    const isImage = type === "image" || IMAGE_FORMATS.has(format);
    const isVideo = type === "video";
    const isAudio = type === "audio";
    const isPdf = format === "pdf";
    const isOfficeDoc = OFFICE_FORMATS.has(format);

    if (isOfficeDoc) {
      const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(openUrl)}`;
      lastInlineUrl = officeUrl;
    }

    let html = "";
    if (isVideo) {
      html = `<video controls preload="metadata" src="${safeUrl}"></video>`;
    } else if (isAudio) {
      html = `<audio controls preload="metadata" src="${safeUrl}"></audio>`;
    } else if (isImage) {
      html = `<img src="${safeUrl}" alt="${escapeHtml(String(resource?.title || "image"))}" />`;
    } else if (isPdf) {
      html = `<iframe src="${safeUrl}" title="${escapeHtml(String(resource?.title || "pdf"))}"></iframe>`;
    } else if (isOfficeDoc && lastInlineUrl) {
      html = `<iframe src="${escapeHtml(lastInlineUrl)}" title="${escapeHtml(String(resource?.title || "document"))}"></iframe>`;
    } else {
      html = `<iframe src="${safeUrl}" title="${escapeHtml(String(resource?.title || "file"))}"></iframe>`;
    }

    bodyNode.innerHTML = html;
    modal.hidden = false;
  }

  grid.addEventListener("click", (e) => {
    const link = e.target instanceof Element ? e.target.closest("[data-action=open]") : null;
    if (!link) return;
    e.preventDefault();

    const id = String(link.getAttribute("data-id") || "").trim();
    if (!id) return;

    const resource = getAllResources().find((r) => String(r.id) === id);
    if (!resource) return;

    openWithResource(resource);
  });

  openNewTabBtn.addEventListener("click", () => {
    const url = lastUrl || lastInlineUrl;
    if (!url) return;
    window.open(url, "_blank", "noopener");
  });

  overlay.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  closeBtn2.addEventListener("click", close);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });
}

const SUBJECT_COLORS = {
  Math: "#ffcc66",
  "Computer Science": "#6ee7ff",
  Physics: "#a78bfa",
  Chemistry: "#34d399",
  Biology: "#f472b6",
  English: "#fca5a5",
  French: "#93c5fd",
  Economics: "#fbbf24",
};

const UI_TEXT = {
  filters: {
    all: "Alle",
    document: "Dokumente",
    video: "Videos",
    audio: "Audio",
    image: "Bilder",
    archive: "Archive",
  },
  download: "Herunterladen",
};

const I18N = {
  de: {
    subtitle: "Alle Kursdateien an einem Ort",
    sidebarFilterTitle: "Filter",
    sidebarSearchTitle: "Suche",
    heroTitle: "Ressourcen",
    heroSubtitle: "Dokumente, Videos und Audio schnell finden und herunterladen.",
    statShowing: "Anzeige",
    statTotal: "Gesamt",
    statFilter: "Filter",
    emptyTitle: "Keine Ressourcen gefunden",
    emptyText: "Wechsle den Filter oder passe die Suche an.",
    quickAll: "Alle",
    quickDoc: "Dokumente",
    quickVid: "Videos",
    quickAud: "Audio",
    settingsTitle: "Einstellungen",
    langLabel: "Sprache",
    themeLabel: "Thema",
    apiLabel: "Backend-URL (API_BASE_URL)",
    waLabel: "WhatsApp Nummer",
    settingsCancel: "Abbrechen",
    settingsSave: "Speichern",
    waDefaultMessage: "Hallo, ich brauche Hilfe mit den PLR-Ressourcen.",

    addToggle: "+ Hinzufügen",
    addTitle: "Ressource hinzufügen",
    addLabelTitle: "Titel",
    addLabelSubject: "Fach",
    addLabelType: "Typ",
    addTypeDoc: "Dokument",
    addTypeVid: "Video",
    addTypeAud: "Audio",
    addLabelFormat: "Format",
    addLabelFile: "Datei",
    addLabelCode: "Code (für Upload)",
    addCancel: "Abbrechen",
    addSave: "Speichern",

    openLabel: "Öffnen",

    deleteLabel: "Löschen",
    msgDeleteConfirm: "Diese Ressource löschen?",
    msgDeleteNeedCode: "Öffne Einstellungen und bestätige den Contributor-Code.",
    msgDeleteSuccess: "Ressource gelöscht.",
    msgDeleteFailed: "Löschen fehlgeschlagen.",

    msgThemeDark: "Theme: Full dark",
    msgThemeLight: "Theme: Full blanc",
    msgThemeArd: "Theme: ARD Sounds",
  },
  fr: {
    subtitle: "Tous les fichiers du cours au même endroit",
    sidebarFilterTitle: "Filtres",
    sidebarSearchTitle: "Recherche",
    heroTitle: "Ressources",
    heroSubtitle: "Trouve rapidement des documents, vidéos et audios et télécharge-les.",
    statShowing: "Affichage",
    statTotal: "Total",
    statFilter: "Filtre",
    emptyTitle: "Aucune ressource trouvée",
    emptyText: "Change le filtre ou ajuste la recherche.",
    quickAll: "Toutes",
    quickDoc: "Documents",
    quickVid: "Vidéos",
    quickAud: "Audio",
    settingsTitle: "Paramètres",
    langLabel: "Langue",
    themeLabel: "Thème",
    apiLabel: "URL du backend (API_BASE_URL)",
    waLabel: "Numéro WhatsApp",
    settingsCancel: "Annuler",
    settingsSave: "Enregistrer",
    waDefaultMessage: "Bonjour, j'ai besoin d'aide avec les ressources PLR.",

    addToggle: "+ Ajouter",
    addTitle: "Ajouter une ressource",
    addLabelTitle: "Titre",
    addLabelSubject: "Matière",
    addLabelType: "Type",
    addTypeDoc: "Document",
    addTypeVid: "Vidéo",
    addTypeAud: "Audio",
    addLabelFormat: "Format",
    addLabelFile: "Fichier",
    addLabelCode: "Code (upload)",
    addCancel: "Annuler",
    addSave: "Enregistrer",

    openLabel: "Ouvrir",

    deleteLabel: "Supprimer",
    msgDeleteConfirm: "Supprimer cette ressource ?",
    msgDeleteNeedCode: "Ouvre Paramètres et valide le code contributeur.",
    msgDeleteSuccess: "Ressource supprimée.",
    msgDeleteFailed: "Suppression impossible.",

    msgThemeDark: "Thème: Full dark",
    msgThemeLight: "Thème: Full blanc",
    msgThemeArd: "Thème: ARD Sounds",

    msgApiBaseUrlMissing: "API_BASE_URL est vide. Renseigne l'URL du backend dans Paramètres.",
    msgFillAllFields: "Veuillez remplir tous les champs.",
    msgUploadInProgress: "Envoi en cours… Veuillez patienter.",
    msgUploadSuccess: "Upload réussi.",
    msgUploadFailed: "Échec de l'upload. Vérifie le code et l'URL du backend.",
    msgWrongCode: "Code incorrect.",
    msgSettingsSaved: "Paramètres enregistrés.",
    msgSaved: "Enregistré.",
    msgBackendChangedReload: "Backend changé. Actualisation…",
    msgLangFrench: "Langue: Français",
    msgLangGerman: "Langue: Allemand",
    msgThemeBlue: "Thème: Bleu/Cyan",
    msgThemeDark: "Thème: Sombre",
    msgWhatsAppMissing: "Ajoute ton numéro WhatsApp dans Paramètres.",
  },
};

Object.assign(I18N.de, {
  msgApiBaseUrlMissing: "API_BASE_URL ist leer. Setze die Backend-URL in den Einstellungen.",
  msgFillAllFields: "Bitte fülle alle Felder aus.",
  msgUploadInProgress: "Upload läuft… Bitte warten.",
  msgUploadSuccess: "Upload erfolgreich.",
  msgUploadFailed: "Upload fehlgeschlagen. Prüfe den Code und die Backend-URL.",
  msgWrongCode: "Falscher Code.",
  msgSettingsSaved: "Einstellungen gespeichert.",
  msgSaved: "Gespeichert.",
  msgBackendChangedReload: "Backend geändert. Aktualisieren…",
  msgLangFrench: "Sprache: Französisch",
  msgLangGerman: "Sprache: Deutsch",
  msgThemeBlue: "Theme: ARD Sounds",
  msgThemeDark: "Theme: Full dark",
  msgThemeLight: "Theme: Full blanc",
  msgThemeArd: "Theme: ARD Sounds",
  msgWhatsAppMissing: "Trage deine WhatsApp-Nummer in den Einstellungen ein.",
});

function t(key) {
  const lang = UI_PREFS.lang in I18N ? UI_PREFS.lang : "de";
  return I18N[lang][key] || I18N.de[key] || "";
}

function applyTheme() {
  const raw = String(UI_PREFS.theme || "dark").toLowerCase();
  const migrated = raw === "blue" ? "ard" : raw;
  const normalized = migrated === "light" ? "light" : migrated === "ard" ? "ard" : "dark";
  document.documentElement.dataset.theme = normalized;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value || "");
}

function applyLanguage() {
  document.documentElement.lang = UI_PREFS.lang === "fr" ? "fr" : "de";

  setText("uiSubtitle", t("subtitle"));
  setText("uiSidebarFilterTitle", t("sidebarFilterTitle"));
  setText("uiSidebarSearchTitle", t("sidebarSearchTitle"));
  setText("uiHeroTitle", t("heroTitle"));
  setText("uiHeroSubtitle", t("heroSubtitle"));
  setText("uiStatShowing", t("statShowing"));
  setText("uiStatTotal", t("statTotal"));
  setText("uiStatFilter", t("statFilter"));
  setText("uiEmptyTitle", t("emptyTitle"));
  setText("uiEmptyText", t("emptyText"));

  setText("uiSideAll", t("quickAll"));
  setText("uiSideDoc", t("quickDoc"));
  setText("uiSideVid", t("quickVid"));
  setText("uiSideAud", t("quickAud"));

  setText("uiChipAll", t("quickAll"));
  setText("uiChipDoc", t("quickDoc"));
  setText("uiChipVid", t("quickVid"));
  setText("uiChipAud", t("quickAud"));

  setText("uiSettingsTitle", t("settingsTitle"));
  setText("uiLangLabel", t("langLabel"));
  setText("uiThemeLabel", t("themeLabel"));
  setText("uiApiLabel", t("apiLabel"));
  setText("uiWaLabel", t("waLabel"));
  setText("uiSettingsCancel", t("settingsCancel"));
  setText("uiSettingsSave", t("settingsSave"));

  setText("uiAddToggle", t("addToggle"));
  setText("uiAddTitle", t("addTitle"));
  setText("uiAddLabelTitle", t("addLabelTitle"));
  setText("uiAddLabelSubject", t("addLabelSubject"));
  setText("uiAddLabelType", t("addLabelType"));
  setText("uiAddTypeDoc", t("addTypeDoc"));
  setText("uiAddTypeVid", t("addTypeVid"));
  setText("uiAddTypeAud", t("addTypeAud"));
  setText("uiAddLabelFormat", t("addLabelFormat"));
  setText("uiAddLabelFile", t("addLabelFile"));
  setText("uiAddLabelCode", t("addLabelCode"));
  setText("uiAddCancel", t("addCancel"));
  setText("uiAddSave", t("addSave"));

  UI_TEXT.filters.all = t("quickAll") || UI_TEXT.filters.all;
  UI_TEXT.filters.document = t("quickDoc") || UI_TEXT.filters.document;
  UI_TEXT.filters.video = t("quickVid") || UI_TEXT.filters.video;
  UI_TEXT.filters.audio = t("quickAud") || UI_TEXT.filters.audio;
  UI_TEXT.download = UI_PREFS.lang === "fr" ? "Télécharger" : "Herunterladen";
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeType(type) {
  const t = String(type || "").toLowerCase();
  if (t === "documents") return "document";
  if (t === "videos") return "video";
  if (t === "audios") return "audio";
  return t;
}

function inferTypeFromFile(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "document";
  if (mime === "application/zip" || mime === "application/x-zip-compressed") return "archive";
  return "document";
}

function inferFormatFromFilename(filename) {
  const name = String(filename || "");
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function showToast(message, variant) {
  const node = document.getElementById("toast");
  if (!node) return;

  node.textContent = String(message || "");
  node.classList.toggle("is-error", variant === "error");
  node.classList.toggle("is-success", variant === "success");
  node.hidden = false;

  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => {
    node.hidden = true;
  }, 2600);
}

function getIconFor(resource) {
  const type = normalizeType(resource.type);
  const format = String(resource.format || "").toLowerCase();

  if (type === "audio") return { label: "Mic", glyph: "MIC" };
  if (type === "video") return { label: "Video", glyph: "VID" };
  if (type === "image") return { label: "Image", glyph: "IMG" };
  if (type === "archive") return { label: "Archive", glyph: "ZIP" };

  if (format === "pdf") return { label: "PDF", glyph: "PDF" };
  return { label: "Doc", glyph: "DOC" };
}

function subjectDotColor(subject) {
  if (SUBJECT_COLORS[subject]) return SUBJECT_COLORS[subject];

  let hash = 0;
  const s = String(subject || "General");
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${hash} 85% 65%)`;
}

function isPlayable(resource) {
  const type = normalizeType(resource.type);
  return type === "audio" || type === "video";
}

function buildPreviewHtml(resource) {
  const type = normalizeType(resource.type);
  const url = resource.url;

  if (!url) return "";

  if (type === "video") {
    return `
      <div class="preview">
        <video controls preload="metadata" src="${escapeHtml(url)}"></video>
      </div>
    `;
  }

  if (type === "audio") {
    return `
      <div class="preview">
        <audio controls preload="metadata" src="${escapeHtml(url)}"></audio>
      </div>
    `;
  }

  return "";
}

function buildCardHtml(resource) {
  const icon = getIconFor(resource);
  const title = escapeHtml(resource.title || "Untitled");
  const subject = escapeHtml(resource.subject || "General");
  const format = escapeHtml(String(resource.format || ""));
  const downloadUrl = escapeHtml(resource.downloadUrl || resource.url || "#");
  const dotColor = subjectDotColor(resource.subject || "General");

  const canDelete = localStorage.getItem("plr_is_contributor") === "1";
  const deleteBtn = canDelete
    ? `<button class="danger-btn" type="button" data-action="delete" data-id="${escapeHtml(String(resource.id || ""))}">${escapeHtml(
        t("deleteLabel")
      )}</button>`
    : "";

  const preview = isPlayable(resource) ? buildPreviewHtml(resource) : "";

  return `
    <article class="card" data-type="${escapeHtml(normalizeType(resource.type))}">
      <div class="card-inner">
        <div class="card-top">
          <div class="file">
            <div class="file-icon" title="${escapeHtml(icon.label)}">${escapeHtml(icon.glyph)}</div>
            <div>
              <h3 class="file-name">${title}</h3>
              <div class="file-meta">
                <span>${format.toUpperCase() || "FILE"}</span>
              </div>
            </div>
          </div>

          <span class="badge" title="Subject">
            <span class="badge-dot" style="background:${escapeHtml(dotColor)}"></span>
            <span>${subject}</span>
          </span>
        </div>

        ${preview}

        <div class="card-actions">
          <a class="download-btn" href="#" data-action="open" data-id="${escapeHtml(String(resource.id || ""))}">${escapeHtml(
            t("openLabel")
          )}</a>
          <a class="download-btn" href="${downloadUrl}" target="_blank" rel="noopener">${escapeHtml(UI_TEXT.download)}</a>
          ${deleteBtn}
          <span class="format-pill">${format.toUpperCase() || "FILE"}</span>
        </div>
      </div>
    </article>
  `;
}

function buildListItemHtml(resource) {
  const icon = getIconFor(resource);
  const title = escapeHtml(resource.title || "Untitled");
  const subject = escapeHtml(resource.subject || "General");
  const format = escapeHtml(String(resource.format || ""));
  const downloadUrl = escapeHtml(resource.downloadUrl || resource.url || "#");

  const canDelete = localStorage.getItem("plr_is_contributor") === "1";
  const deleteBtn = canDelete
    ? `<button class="danger-btn" type="button" data-action="delete" data-id="${escapeHtml(String(resource.id || ""))}">${escapeHtml(
        t("deleteLabel")
      )}</button>`
    : "";

  return `
    <article class="list-item" data-type="${escapeHtml(normalizeType(resource.type))}">
      <div class="file-icon" title="${escapeHtml(icon.label)}">${escapeHtml(icon.glyph)}</div>
      <div class="list-main">
        <h3 class="list-title">${title}</h3>
        <div class="list-meta">
          <span>${subject}</span>
          <span>•</span>
          <span>${format.toUpperCase() || "FILE"}</span>
        </div>
      </div>
      <div class="list-actions">
        <a class="list-open" href="#" data-action="open" data-id="${escapeHtml(String(resource.id || ""))}">${escapeHtml(
          t("openLabel")
        )}</a>
        <a class="list-open" href="${downloadUrl}" target="_blank" rel="noopener">${escapeHtml(UI_TEXT.download)}</a>
        ${deleteBtn}
      </div>
    </article>
  `;
}

function computeCounts({ query }) {
  const q = normalizeText(query);
  const matchesQuery = (r) => {
    if (!q) return true;
    const haystack = normalizeText(`${r.title || ""} ${r.subject || ""} ${r.format || ""} ${r.type || ""}`);
    return haystack.includes(q);
  };

  const filteredByQuery = getAllResources().filter(matchesQuery);
  const counts = {
    all: filteredByQuery.length,
    document: 0,
    video: 0,
    audio: 0,
    image: 0,
    archive: 0,
  };

  for (const r of filteredByQuery) {
    const t = normalizeType(r.type);
    if (Object.prototype.hasOwnProperty.call(counts, t)) counts[t] += 1;
  }

  return counts;
}

function renderCounts({ query }) {
  const counts = computeCounts({ query });
  const nodes = Array.from(document.querySelectorAll("[data-count]"));
  for (const node of nodes) {
    const key = String(node.dataset.count || "").toLowerCase();
    const value = counts[key] ?? 0;
    node.textContent = String(value);
  }
}

function renderResources({ filter, query }) {
  const grid = document.getElementById("resourcesGrid");
  const empty = document.getElementById("emptyState");

  const normalizedFilter = normalizeType(filter);
  const q = normalizeText(query);
  const filtered = getAllResources().filter((r) => {
    const t = normalizeType(r.type);
    const matchesType = normalizedFilter === "all" ? true : t === normalizedFilter;
    if (!matchesType) return false;

    if (!q) return true;
    const haystack = normalizeText(`${r.title || ""} ${r.subject || ""} ${r.format || ""} ${r.type || ""}`);
    return haystack.includes(q);
  });

  const sort = String(UI_STATE.sort || "newest");
  const getTs = (r) => {
    const raw = r.createdAt || r.created_at || r.date || r.timestamp;
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
    return 0;
  };

  if (sort === "newest") {
    filtered.sort((a, b) => getTs(b) - getTs(a));
  } else if (sort === "oldest") {
    filtered.sort((a, b) => getTs(a) - getTs(b));
  } else if (sort === "title_asc") {
    filtered.sort((a, b) =>
      normalizeText(a.title || "").localeCompare(normalizeText(b.title || ""), undefined, { sensitivity: "base" })
    );
  } else if (sort === "subject_asc") {
    filtered.sort((a, b) =>
      normalizeText(a.subject || "").localeCompare(normalizeText(b.subject || ""), undefined, { sensitivity: "base" })
    );
  }

  const isList = UI_STATE.viewMode === "list";
  grid.classList.toggle("is-list", isList);
  grid.innerHTML = filtered.map(isList ? buildListItemHtml : buildCardHtml).join("");

  empty.hidden = filtered.length !== 0;

  document.getElementById("statShowing").textContent = String(filtered.length);
  document.getElementById("statTotal").textContent = String(getAllResources().length);
  document.getElementById("statFilter").textContent = UI_TEXT.filters[normalizedFilter] || UI_TEXT.filters.all;
}

function initViewToggle() {
  const listBtn = document.getElementById("viewListBtn");
  const cardsBtn = document.getElementById("viewCardsBtn");
  const listBtnSide = document.getElementById("viewListBtnSidebar");
  const cardsBtnSide = document.getElementById("viewCardsBtnSidebar");

  if (!listBtn || !cardsBtn) return;

  function setMode(mode) {
    UI_STATE.viewMode = mode === "cards" ? "cards" : "list";
    listBtn.classList.toggle("is-active", UI_STATE.viewMode === "list");
    cardsBtn.classList.toggle("is-active", UI_STATE.viewMode === "cards");
    if (listBtnSide && cardsBtnSide) {
      listBtnSide.classList.toggle("is-active", UI_STATE.viewMode === "list");
      cardsBtnSide.classList.toggle("is-active", UI_STATE.viewMode === "cards");
    }
    renderResources({ filter: UI_STATE.filter, query: UI_STATE.query });
  }

  listBtn.addEventListener("click", () => setMode("list"));
  cardsBtn.addEventListener("click", () => setMode("cards"));
  if (listBtnSide && cardsBtnSide) {
    listBtnSide.addEventListener("click", () => setMode("list"));
    cardsBtnSide.addEventListener("click", () => setMode("cards"));
  }

  setMode(UI_STATE.viewMode);
}

function setActiveFilterButton(filter) {
  const normalized = normalizeType(filter);
  const buttons = Array.from(document.querySelectorAll(".filter-btn"));
  for (const btn of buttons) {
    const f = normalizeType(btn.dataset.filter);
    btn.classList.toggle("is-active", f === normalized);
  }
}

function initFilters() {
  UI_STATE.filter = UI_STATE.filter || "all";
  UI_STATE.query = UI_STATE.query || "";

  const buttons = Array.from(document.querySelectorAll(".filter-btn"));
  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      UI_STATE.filter = btn.dataset.filter || "all";
      setActiveFilterButton(UI_STATE.filter);
      renderResources({ filter: UI_STATE.filter, query: UI_STATE.query });
    });
  }

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      UI_STATE.query = searchInput.value || "";
      renderCounts({ query: UI_STATE.query });
      renderResources({ filter: UI_STATE.filter, query: UI_STATE.query });
    });
  }

  setActiveFilterButton(UI_STATE.filter);
  renderCounts({ query: UI_STATE.query });
  renderResources({ filter: UI_STATE.filter, query: UI_STATE.query });
}

function initSort() {
  const select = document.getElementById("sortSelect");
  const selectSide = document.getElementById("sortSelectSidebar");
  if (!select) return;

  UI_STATE.sort = String(select.value || UI_STATE.sort || "newest");

  if (selectSide) {
    selectSide.value = UI_STATE.sort;
  }

  function setSort(value) {
    UI_STATE.sort = String(value || "newest");
    if (select) select.value = UI_STATE.sort;
    if (selectSide) selectSide.value = UI_STATE.sort;
    renderResources({ filter: UI_STATE.filter, query: UI_STATE.query });

    const activeSelect = selectSide && document.activeElement === selectSide ? selectSide : select;
    const label = activeSelect?.options?.[activeSelect.selectedIndex]?.textContent || "";
    if (label) showToast(`Sortierung: ${label}`, "success");
  }

  select.addEventListener("change", () => setSort(select.value));
  if (selectSide) selectSide.addEventListener("change", () => setSort(selectSide.value));
}

function initTypeGroup() {
  const toggle = document.getElementById("typeGroupToggle");
  const group = document.getElementById("typeGroup");
  if (!toggle || !group) return;

  const isExpanded = toggle.getAttribute("aria-expanded") !== "false";
  if (!isExpanded) group.hidden = true;

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "false";
    const next = !expanded;
    toggle.setAttribute("aria-expanded", next ? "true" : "false");
    group.hidden = !next;
  });
}

function initAddModal() {
  const openBtn = document.getElementById("addToggle");
  const modal = document.getElementById("addModal");
  const overlay = document.getElementById("addModalOverlay");
  const closeBtn = document.getElementById("addModalClose");
  const cancelBtn = document.getElementById("addFormCancel");
  const form = document.getElementById("addForm");
  const statusNode = document.getElementById("addFormStatus");
  const searchInput = document.getElementById("searchInput");
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  const fileInput = form ? form.querySelector('input[name="file"]') : null;
  const typeSelect = form ? form.querySelector('select[name="type"]') : null;
  const formatInput = form ? form.querySelector('input[name="format"]') : null;

  if (!openBtn || !modal || !overlay || !closeBtn || !cancelBtn || !form) return;

  function setStatus(message, variant) {
    if (!statusNode) return;
    statusNode.textContent = String(message || "");
    statusNode.classList.toggle("is-error", variant === "error");
    statusNode.classList.toggle("is-success", variant === "success");
  }

  function setSubmitting(isSubmitting) {
    if (submitBtn) {
      submitBtn.disabled = isSubmitting;
      submitBtn.textContent = isSubmitting ? t("msgUploadInProgress") : t("addSave");
    }
    if (cancelBtn) cancelBtn.disabled = isSubmitting;
    if (closeBtn) closeBtn.disabled = isSubmitting;
    if (openBtn) openBtn.disabled = isSubmitting;
  }

  function open() {
    modal.hidden = false;
    setStatus("", "");
  }

  function close() {
    modal.hidden = true;
    form.reset();
    setSubmitting(false);
    setStatus("", "");
  }

  openBtn.addEventListener("click", open);
  overlay.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });

  if (fileInput && typeSelect && formatInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const inferredType = inferTypeFromFile(file);
      const inferredFormat = inferFormatFromFilename(file.name);

      if (inferredType && ["document", "video", "audio"].includes(inferredType)) {
        typeSelect.value = inferredType;
      }
      if (inferredFormat && !String(formatInput.value || "").trim()) {
        formatInput.value = inferredFormat;
      }
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    if (submitBtn && submitBtn.disabled) return;

    if (!API_BASE_URL) {
      showToast(t("msgApiBaseUrlMissing"), "error");
      setStatus(t("msgApiBaseUrlMissing"), "error");
      return;
    }

    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    const subject = String(fd.get("subject") || "").trim();

    const file = fd.get("file");
    const fileObj = file instanceof File ? file : null;

    const rawType = normalizeType(fd.get("type"));
    const inferredType = fileObj ? inferTypeFromFile(fileObj) : "";
    const type = rawType || inferredType;

    const rawFormat = String(fd.get("format") || "").trim().toLowerCase();
    const inferredFormat = fileObj ? inferFormatFromFilename(fileObj.name) : "";
    const format = rawFormat || inferredFormat;

    const rawAdminCode = String(fd.get("adminCode") || "").trim();
    const storedAdminCode = String(sessionStorage.getItem("plr_admin_code") || "").trim();
    const adminCode = rawAdminCode || storedAdminCode;

    if (!title || !subject || !type || !format || !adminCode || !fileObj || !fileObj.size) {
      setStatus(t("msgFillAllFields"), "error");
      return;
    }

    setSubmitting(true);
    setStatus(t("msgUploadInProgress"), "");

    const body = new FormData();
    body.set("title", title);
    body.set("subject", subject);
    body.set("type", type);
    body.set("format", format);
    body.set("file", fileObj);

    const url = `${API_BASE_URL.replace(/\/$/, "")}/api/upload`;

    fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "x-admin-code": adminCode,
        },
        body,
      },
      45000
    )
      .then(async (resp) => {
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          const code = String(err?.error || "").trim();
          const status = Number(resp.status) || 0;
          throw new Error(code || (status ? `http_${status}` : "upload_failed"));
        }
        return resp.json();
      })
      .then((json) => {
        const resource = json.resource;
        if (resource && typeof resource === "object") {
          remoteResources = [resource, ...remoteResources];
          hasRemoteLoaded = true;
        }

        UI_STATE.query = searchInput ? searchInput.value || "" : UI_STATE.query;
        renderCounts({ query: UI_STATE.query });
        renderResources({ filter: UI_STATE.filter, query: UI_STATE.query });

        showToast(t("msgUploadSuccess"), "success");
        setStatus(t("msgUploadSuccess"), "success");
        close();

        localStorage.setItem("plr_is_contributor", "1");
        initWhatsAppFab();
      })
      .catch((err) => {
        const code = String(err?.message || "").trim();
        const msg =
          code === "unauthorized"
            ? t("msgWrongCode")
            : code === "file_too_large" || code === "http_413"
              ? "Fichier trop volumineux."
              : code === "missing_fields"
                ? t("msgFillAllFields")
                : code === "missing_file"
                  ? t("msgFillAllFields")
                  : `${t("msgUploadFailed")} (${code || "unknown"})`;
        showToast(msg, "error");
        setStatus(msg, "error");
      })
      .finally(() => {
        setSubmitting(false);
      });
  });
}

function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");

  if (!sidebar || !overlay) return;

  function open() {
    sidebar.classList.add("is-open");
    overlay.hidden = false;
  }

  function close() {
    sidebar.classList.remove("is-open");
    delete document.body.dataset.sidebarOpen;
    overlay.hidden = true;
  }

  overlay.addEventListener("click", close);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  const filterButtons = Array.from(sidebar.querySelectorAll(".filter-btn"));
  for (const btn of filterButtons) {
    btn.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 620px)").matches) close();
    });
  }
}

function initSettingsModal() {
  const openBtnTop = document.getElementById("menuToggle");
  const openBtnSide = document.getElementById("menuToggleSidebar");
  const openBtns = [openBtnTop, openBtnSide].filter(Boolean);
  const modal = document.getElementById("settingsModal");
  const overlay = document.getElementById("settingsModalOverlay");
  const closeBtn = document.getElementById("settingsModalClose");
  const cancelBtn = document.getElementById("settingsCancel");
  const form = document.getElementById("settingsForm");
  const statusNode = document.getElementById("settingsStatus");

  if (openBtns.length === 0 || !modal || !overlay || !closeBtn || !cancelBtn || !form) return;

  const apiInput = form.querySelector('input[name="apiBaseUrl"]');
  const waNumbers = document.getElementById("waNumbers");
  const waActiveSelect = document.getElementById("waActiveSelect");
  const langSelect = form.querySelector('select[name="lang"]');
  const themeSelect = form.querySelector('select[name="theme"]');

  const waSection = document.getElementById("waSection");
  const contributorCodeInput = form.querySelector('input[name="contributorCode"]');
  const contributorVerifyBtn = document.getElementById("contributorVerifyBtn");

  const settingsNavItems = Array.from(form.querySelectorAll(".settings-nav-item[data-settings-tab]"));
  const settingsPanels = Array.from(form.querySelectorAll("[data-settings-panel]"));

  function getAvailableTabIds() {
    const ids = new Set(settingsPanels.filter((p) => !p.hidden).map((p) => String(p.dataset.settingsPanel || "").trim()));
    return ids;
  }

  function setActiveSettingsTab(tabId) {
    const id = String(tabId || "").trim();
    if (!id) return;

    const available = getAvailableTabIds();
    const nextId = available.has(id) ? id : available.has("general") ? "general" : Array.from(available)[0];
    if (!nextId) return;

    for (const btn of settingsNavItems) {
      btn.classList.toggle("is-active", String(btn.dataset.settingsTab) === nextId);
    }

    for (const panel of settingsPanels) {
      const panelId = String(panel.dataset.settingsPanel || "").trim();

      // Keep permission-based hiding intact (e.g. WhatsApp locked behind contributor code)
      if (panel.hidden) {
        panel.classList.add("is-tab-hidden");
        continue;
      }

      panel.classList.toggle("is-tab-hidden", panelId !== nextId);
    }
  }

  function refreshSettingsTabs() {
    const available = getAvailableTabIds();

    for (const btn of settingsNavItems) {
      const id = String(btn.dataset.settingsTab || "").trim();
      const isAvailable = available.has(id);
      btn.disabled = !isAvailable;
      btn.style.opacity = isAvailable ? "1" : "0.55";
      btn.style.cursor = isAvailable ? "pointer" : "not-allowed";
    }

    const activeBtn = settingsNavItems.find((b) => b.classList.contains("is-active"));
    const activeId = String(activeBtn?.dataset.settingsTab || "").trim();
    setActiveSettingsTab(activeId || "general");
  }

  function refreshResourcesUi() {
    const q = (document.getElementById("searchInput")?.value || "").toString();
    UI_STATE.query = q;
    renderCounts({ query: UI_STATE.query });
    renderResources({ filter: UI_STATE.filter, query: UI_STATE.query });
  }

  function setStatus(message, variant) {
    if (!statusNode) return;
    statusNode.textContent = String(message || "");
    statusNode.classList.toggle("is-error", variant === "error");
    statusNode.classList.toggle("is-success", variant === "success");
  }

  function setContributorEnabled(enabled) {
    const isEnabled = Boolean(enabled);
    if (isEnabled) localStorage.setItem("plr_is_contributor", "1");
    else localStorage.removeItem("plr_is_contributor");

    if (waSection) waSection.hidden = !isEnabled;
    if (waNumbers) waNumbers.disabled = !isEnabled;
    if (waActiveSelect) waActiveSelect.disabled = !isEnabled;

    refreshSettingsTabs();

    refreshResourcesUi();
  }

  async function verifyContributorCode() {
    const code = String(contributorCodeInput?.value || "").trim();
    if (!code) {
      setContributorEnabled(false);
      sessionStorage.removeItem("plr_admin_code");
      setStatus(t("msgWrongCode"), "error");
      return;
    }

    try {
      const url = `${API_BASE_URL.replace(/\/$/, "")}/api/check-code`;
      const resp = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            "x-admin-code": code,
          },
        },
        12000
      );

      if (!resp.ok) throw new Error("unauthorized");

      setContributorEnabled(true);
      sessionStorage.setItem("plr_admin_code", code);
      setStatus("OK", "success");

      const numbers = getStoredWhatsAppNumbers();
      const active = getActiveWhatsAppNumber();
      if (waNumbers) waNumbers.value = numbers.join("\n");
      if (waActiveSelect) {
        waActiveSelect.innerHTML = "";
        for (const n of numbers) {
          const opt = document.createElement("option");
          opt.value = n;
          opt.textContent = n;
          waActiveSelect.appendChild(opt);
        }

        if (numbers.length === 0) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "-";
          waActiveSelect.appendChild(opt);
        }

        waActiveSelect.value = active;
      }
    } catch {
      setContributorEnabled(false);
      sessionStorage.removeItem("plr_admin_code");
      setStatus(t("msgWrongCode"), "error");
    }
  }

  function open() {
    if (apiInput) {
      apiInput.value = DEFAULT_API_BASE_URL;
      apiInput.readOnly = true;
    }

    const isContributor = localStorage.getItem("plr_is_contributor") === "1";
    setContributorEnabled(isContributor);

    refreshResourcesUi();

    const numbers = getStoredWhatsAppNumbers();
    const active = getActiveWhatsAppNumber();

    if (isContributor) {
      if (waNumbers) waNumbers.value = numbers.join("\n");
      if (waActiveSelect) {
        waActiveSelect.innerHTML = "";
        for (const n of numbers) {
          const opt = document.createElement("option");
          opt.value = n;
          opt.textContent = n;
          waActiveSelect.appendChild(opt);
        }

        if (numbers.length === 0) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "-";
          waActiveSelect.appendChild(opt);
        }

        waActiveSelect.value = active;
      }
    }

    if (langSelect) langSelect.value = UI_PREFS.lang;
    if (themeSelect) themeSelect.value = UI_PREFS.theme === "blue" ? "ard" : UI_PREFS.theme;
    setStatus("", "");
    refreshSettingsTabs();
    modal.hidden = false;
  }

  for (const btn of settingsNavItems) {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      setActiveSettingsTab(btn.dataset.settingsTab);
    });
  }

  if (contributorVerifyBtn) {
    contributorVerifyBtn.addEventListener("click", () => {
      verifyContributorCode();
    });
  }

  if (langSelect) {
    langSelect.addEventListener("change", () => {
      UI_PREFS.lang = String(langSelect.value || "de").toLowerCase() === "fr" ? "fr" : "de";
      applyLanguage();
      showToast(UI_PREFS.lang === "fr" ? t("msgLangFrench") : t("msgLangGerman"), "success");
      const q = (document.getElementById("searchInput")?.value || "").toString();
      renderCounts({ query: q });
      renderResources({ filter: UI_STATE.filter, query: q });
    });
  }

  if (themeSelect) {
    themeSelect.addEventListener("change", () => {
      const raw = String(themeSelect.value || "dark").trim().toLowerCase();
      const migrated = raw === "blue" ? "ard" : raw;
      const normalized = migrated === "light" ? "light" : migrated === "ard" ? "ard" : "dark";
      UI_PREFS.theme = normalized;
      applyTheme();
      showToast(UI_PREFS.theme === "light" ? t("msgThemeLight") : UI_PREFS.theme === "ard" ? t("msgThemeArd") : t("msgThemeDark"), "success");
    });
  }

  function close() {
    modal.hidden = true;
    setStatus("", "");
    form.reset();
  }

  for (const btn of openBtns) btn.addEventListener("click", open);
  overlay.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const isContributor = localStorage.getItem("plr_is_contributor") === "1";

    const numbers = isContributor ? parseWhatsAppNumbers(waNumbers?.value || "") : null;
    const activeRaw = isContributor ? String(waActiveSelect?.value || "").trim() : "";
    const active =
      isContributor && numbers ? (activeRaw && numbers.includes(activeRaw) ? activeRaw : numbers[0] || "") : "";
    const lang = String(langSelect?.value || "de").trim().toLowerCase();
    const rawTheme = String(themeSelect?.value || "dark").trim().toLowerCase();
    const migrated = rawTheme === "blue" ? "ard" : rawTheme;
    const theme = migrated === "light" ? "light" : migrated === "ard" ? "ard" : "dark";

    if (isContributor && numbers) {
      localStorage.setItem("plr_whatsapp_numbers", JSON.stringify(numbers));
      if (active) localStorage.setItem("plr_whatsapp_active", active);
      else localStorage.removeItem("plr_whatsapp_active");

      // legacy key: keep in sync for backward compatibility
      if (active) localStorage.setItem("plr_whatsapp_number", active);
      else localStorage.removeItem("plr_whatsapp_number");
    }

    localStorage.setItem("plr_lang", lang === "fr" ? "fr" : "de");
    localStorage.setItem("plr_theme", theme);

    UI_PREFS.lang = lang === "fr" ? "fr" : "de";
    UI_PREFS.theme = theme;
    applyTheme();
    applyLanguage();

    initWhatsAppFab();

    showToast(t("msgSettingsSaved"), "success");
    setStatus(t("msgSaved"), "success");

    window.setTimeout(() => {
      modal.hidden = true;
    }, 250);
  });
}

function initWhatsAppFab() {
  const fab = document.getElementById("whatsappFab");

  if (!fab) return;

  fab.hidden = false;

  // Prevent stacking multiple click handlers when initWhatsAppFab() is called repeatedly
  fab.onclick = null;

  const phoneNumber = normalizeWhatsAppPhone(getActiveWhatsAppNumber());
  const defaultMessage = t("waDefaultMessage");

  if (!phoneNumber) {
    fab.setAttribute("href", "#");
    fab.onclick = (e) => {
      e.preventDefault();
      showToast(t("msgWhatsAppMissing"), "error");
    };
    return;
  }

  const waUrl = `https://api.whatsapp.com/send?phone=${encodeURIComponent(phoneNumber)}&text=${encodeURIComponent(
    defaultMessage
  )}`;
  const waWebUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phoneNumber)}&text=${encodeURIComponent(
    defaultMessage
  )}`;

  fab.setAttribute("href", waUrl);
  fab.setAttribute("target", "_blank");
  fab.setAttribute("rel", "noopener");

  // Some environments open WhatsApp but don't start the chat when the number is malformed.
  // Give a clear hint about the exact number being used and provide a web fallback.
  fab.onclick = () => {
    showToast(`WhatsApp: ${phoneNumber}`, "success");
    if (window.matchMedia && window.matchMedia("(pointer:fine)").matches) {
      fab.setAttribute("href", waWebUrl);
      window.setTimeout(() => fab.setAttribute("href", waUrl), 500);
    }
  };
}

async function bootstrap() {
  applyTheme();
  applyLanguage();
  initTabs();
  initViewToggle();
  initFilters();
  initSort();
  initWhatsAppFab();
  initSidebar();
  initDeleteActions();
  initReader();
  initTypeGroup();
  initAddModal();
  initSettingsModal();

  await loadRemoteResources();

  const query = (document.getElementById("searchInput")?.value || "").toString();
  UI_STATE.query = query;
  renderCounts({ query: UI_STATE.query });
  renderResources({ filter: UI_STATE.filter, query: UI_STATE.query });
}

bootstrap();
