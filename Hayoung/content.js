(() => {
  "use strict";

  if (window.__HAYOUNG_JOBKOREA__) {
    return;
  }
  window.__HAYOUNG_JOBKOREA__ = true;

  const ROOT_ID = "jk-helper-root";
  const PANEL_ID = "jk-helper-panel";
  const MAX_RECRUIT_PAGES = 250;
  const EMPLOYEE_STORAGE_PREFIX = "hayoung:employee-count:jobkorea:";
  const RECRUIT_STORAGE_PREFIX = "hayoung:recruit-links:jobkorea:";
  const POSTING_COUNT_STORAGE_PREFIX = "hayoung:posting-count:";
  const LOAD_MODE_STORAGE_KEY = "hayoung:load-mode";
  const SIMPLE_MODE_STORAGE_KEY = "hayoung:simple-mode";
  const FONT_SCALE_STORAGE_KEY = "hayoung:font-scale";
  const FAVORITE_SEARCH_STORAGE_KEY = "hayoung:favorite-search-terms";
  const VERSION_CACHE_STORAGE_KEY = "hayoung:version-check";
  const UI_LAYOUT_STORAGE_KEY = "hayoung:ui-layout";
  const VERSION_CACHE_MS = 6 * 60 * 60 * 1000;
  const LOAD_MODE_PRELOAD = "preload";
  const LOAD_MODE_CLICK = "click";
  const RECORD_EXPORT_FORMAT = "project-hayoung-records";
  const RECORD_EXPORT_VERSION = 3;
  const RECORD_EXPORT_CODEC = "hy-xor-shift-v3";
  const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
  const UI_VIEWPORT_MARGIN = 8;
  const UI_PANEL_GAP = 8;
  const UI_LAUNCHER_DESKTOP_EDGE = 22;
  const UI_LAUNCHER_MOBILE_EDGE = 12;
  const UI_PANEL_MIN_WIDTH = 380;
  const UI_PANEL_MIN_HEIGHT = 300;
  const UI_LAYOUT_SPLIT = "split";
  const UI_LAYOUT_SINGLE = "single";
  const FONT_SCALE_STEPS = [1, 1.15, 1.3, 1.45, 1.6];
  const FONT_BASE_SIZES = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 25, 31];
  const FAVORITE_SEARCH_LIMIT = 30;
  const FAVORITE_SEARCH_TERM_MAX_LENGTH = 40;
  const LEFT_MODULE_DEFAULT_ORDER = ["history", "records", "details", "options"];
  const SITE_JOBKOREA = "jobkorea";
  const SITE_GAMEJOB = "gamejob";
  const currentSite = /(^|\.)gamejob\.co\.kr$/i.test(location.hostname) ? SITE_GAMEJOB : SITE_JOBKOREA;
  const WORKFORCE_DATA = globalThis.__HAYOUNG_WORKFORCE_DATA__ || null;
  const WORKFORCE_COMPANIES = Array.isArray(WORKFORCE_DATA?.companies)
    ? WORKFORCE_DATA.companies
    : [];

  function currentPostingId() {
    if (currentSite === SITE_GAMEJOB) {
      return new URL(location.href).searchParams.get("GI_No");
    }
    return location.pathname.match(/\/Recruit\/GI_Read\/(\d+)/i)?.[1] || null;
  }

  function currentPostingKey() {
    const postingId = currentPostingId();
    return postingId ? `${currentSite}:${postingId}` : null;
  }

  function documentPostingId() {
    const values = [
      document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      document.querySelector('meta[property="og:url"]')?.getAttribute("content"),
      document.querySelector('meta[name="twitter:url"]')?.getAttribute("content")
    ];
    for (const value of values) {
      const identity = recruitIdentityFromUrl(value, location.href);
      if (identity?.site === currentSite) {
        return identity.id;
      }
    }
    return null;
  }

  function documentMatchesCurrentPosting() {
    const expectedId = currentPostingId();
    const documentId = documentPostingId();
    return !expectedId || !documentId || expectedId === documentId;
  }

  const state = {
    company: null,
    loaded: false,
    loading: false,
    loadGeneration: 0,
    postingKey: null,
    loadMode: LOAD_MODE_CLICK,
    simpleMode: false,
    fontScale: 1,
    disabledForPage: false,
    overviewLoaded: false,
    overviewLoading: false,
    overviewPage: null,
    loadRequestedThisPage: false,
    profileUrl: null,
    historyUrl: null,
    items: [],
    recruitSummary: null,
    uiLayout: {
      launcherX: null,
      launcherY: null,
      launcherPositionSaved: false,
      panelX: null,
      panelY: null,
      panelWidth: 680,
      panelHeight: null,
      panelOpen: true,
      layoutMode: UI_LAYOUT_SPLIT,
      moduleOrder: [...LEFT_MODULE_DEFAULT_ORDER],
      moduleOpen: {}
    }
  };

  let detectionObserver = null;
  let detectionTimer = null;
  let routeWatcherTimer = null;
  let applicantCountTimer = null;

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function extractJobKoreaApplicantCount() {
    if (currentSite !== SITE_JOBKOREA) {
      return null;
    }

    const visibleText = normalizeText(document.body?.innerText || "");
    const directMatch = visibleText.match(/지원자\s*수\s*[:：]?\s*([\d,]+)\s*명/i);
    if (directMatch) {
      const count = Number(directMatch[1].replace(/,/g, ""));
      return Number.isSafeInteger(count) && count >= 0 ? count : null;
    }

    for (const label of document.querySelectorAll("dt, dd, th, td, strong, span, em, p, h2, h3, h4")) {
      if (!/^지원자\s*수$/i.test(normalizeText(label.textContent))) {
        continue;
      }
      const scopes = [
        label.nextElementSibling,
        label.parentElement,
        label.closest("dl, li, tr, section, article, div")
      ];
      for (const scope of scopes) {
        const match = normalizeText(scope?.textContent).match(/(?:지원자\s*수\s*)?([\d,]+)\s*명/i);
        if (!match) {
          continue;
        }
        const count = Number(match[1].replace(/,/g, ""));
        if (Number.isSafeInteger(count) && count >= 0) {
          return count;
        }
      }
    }
    return null;
  }

  function refreshApplicantCountUi(attempt = 0) {
    clearTimeout(applicantCountTimer);
    applicantCountTimer = null;
    const badge = document.getElementById("jk-helper-applicant-count");
    if (!badge) {
      return;
    }
    if (currentSite !== SITE_JOBKOREA) {
      badge.classList.add("jk-helper-filter-hidden");
      return;
    }

    badge.classList.remove("jk-helper-filter-hidden");
    const count = extractJobKoreaApplicantCount();
    if (count !== null) {
      badge.textContent = `지원자 ${count.toLocaleString("ko-KR")}명`;
      badge.title = `현재 잡코리아 공고 지원자 수: ${count.toLocaleString("ko-KR")}명`;
      badge.classList.remove("jk-helper-applicant-unavailable");
      return;
    }

    badge.textContent = "지원자 —";
    badge.title = "잡코리아 페이지에서 지원자 수를 아직 확인하지 못했습니다.";
    badge.classList.add("jk-helper-applicant-unavailable");
    if (attempt < 20) {
      applicantCountTimer = setTimeout(() => refreshApplicantCountUi(attempt + 1), 250);
    }
  }

  function normalizeWorkforceName(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR")
      .replace(/\b(?:co(?:mpany)?|corp(?:oration)?|inc(?:orporated)?|ltd|limited|llc)\b\.?/g, "")
      .replace(/유한책임회사|유한회사|주식회사|사단법인|재단법인/g, "")
      .replace(/\(\s*주\s*\)|㈜/g, "")
      .replace(/[^0-9a-z가-힣]+/g, "");
  }

  function workforceNameAliases(company) {
    const names = [company?.name];
    for (const value of String(company?.workplaces || "").split(/\s*[|;]\s*/)) {
      names.push(value);
    }
    return [...new Set(names.map(normalizeWorkforceName).filter(Boolean))];
  }

  function workforceBigrams(value) {
    if (value.length < 2) {
      return value ? [value] : [];
    }
    const result = [];
    for (let index = 0; index < value.length - 1; index += 1) {
      result.push(value.slice(index, index + 2));
    }
    return result;
  }

  function workforceDiceScore(left, right) {
    if (!left || !right) {
      return 0;
    }
    if (left === right) {
      return 1;
    }
    const leftPairs = workforceBigrams(left);
    const rightPairs = workforceBigrams(right);
    if (!leftPairs.length || !rightPairs.length) {
      return left.includes(right) || right.includes(left) ? 0.8 : 0;
    }
    const counts = new Map();
    for (const pair of leftPairs) {
      counts.set(pair, (counts.get(pair) || 0) + 1);
    }
    let intersection = 0;
    for (const pair of rightPairs) {
      const count = counts.get(pair) || 0;
      if (count > 0) {
        intersection += 1;
        counts.set(pair, count - 1);
      }
    }
    return (2 * intersection) / (leftPairs.length + rightPairs.length);
  }

  function workforceNameScore(query, candidate) {
    if (!query || !candidate) {
      return 0;
    }
    if (query === candidate) {
      return 1;
    }
    const shorter = Math.min(query.length, candidate.length);
    const longer = Math.max(query.length, candidate.length);
    const containment = query.includes(candidate) || candidate.includes(query)
      ? 0.84 + (0.14 * (shorter / Math.max(longer, 1)))
      : 0;
    const prefixLength = (() => {
      let length = 0;
      while (length < shorter && query[length] === candidate[length]) {
        length += 1;
      }
      return length;
    })();
    const prefix = (prefixLength / Math.max(longer, 1)) * 0.92;
    return Math.min(1, Math.max(containment, prefix, workforceDiceScore(query, candidate)));
  }

  function workforceCandidateScore(company, query) {
    const normalizedQuery = normalizeWorkforceName(query);
    return workforceNameAliases(company).reduce(
      (best, alias) => Math.max(best, workforceNameScore(normalizedQuery, alias)),
      0
    );
  }

  function workforceGameJobIds(company) {
    const values = Array.isArray(company?.gameJobCompanyIds)
      ? company.gameJobCompanyIds
      : [company?.gameJobCompanyId];
    return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
  }

  function workforceHasGameJobId(company, companyId) {
    const preferredId = normalizeText(companyId);
    return Boolean(preferredId && workforceGameJobIds(company).includes(preferredId));
  }

  function rankWorkforceCandidates(query, preferredCompanyId = "", prioritizeId = false) {
    const preferredId = String(preferredCompanyId || "");
    return WORKFORCE_COMPANIES
      .map((company) => ({
        company,
        score: workforceCandidateScore(company, query),
        exactId: workforceHasGameJobId(company, preferredId)
      }))
      .sort((left, right) => {
        if (prioritizeId && left.exactId !== right.exactId) {
          return left.exactId ? -1 : 1;
        }
        return right.score - left.score ||
          Number(right.company.currentEmployees || 0) - Number(left.company.currentEmployees || 0) ||
          String(left.company.name || "").localeCompare(String(right.company.name || ""), "ko");
      })
      .slice(0, 5);
  }

  function signedWorkforceCount(value) {
    if (value === null || value === undefined || value === "") {
      return "확인 불가";
    }
    const number = Number(value) || 0;
    return `${number > 0 ? "+" : ""}${number.toLocaleString("ko-KR")}명`;
  }

  function formatRatio(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
      return null;
    }
    return (numerator / denominator).toLocaleString("ko-KR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }

  function createAlertLine(message, className = "") {
    if (!message) {
      return null;
    }
    const alert = document.createElement("div");
    alert.className = `jk-helper-alert-line ${className}`.trim();
    const label = document.createElement("strong");
    label.textContent = "알림";
    const copy = document.createElement("span");
    copy.textContent = message;
    alert.append(label, copy);
    return alert;
  }

  function normalizeFavoriteSearchTerms(value) {
    const result = [];
    const seen = new Set();
    for (const item of Array.isArray(value) ? value : []) {
      const term = normalizeText(item).slice(0, FAVORITE_SEARCH_TERM_MAX_LENGTH);
      const key = term.toLocaleLowerCase("ko-KR");
      if (!term || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(term);
      if (result.length >= FAVORITE_SEARCH_LIMIT) {
        break;
      }
    }
    return result;
  }

  async function readFavoriteSearchTerms() {
    return normalizeFavoriteSearchTerms(await readStorageValue(FAVORITE_SEARCH_STORAGE_KEY));
  }

  async function addFavoriteSearchTerm(value) {
    const term = normalizeText(value).slice(0, FAVORITE_SEARCH_TERM_MAX_LENGTH);
    if (!term) {
      return readFavoriteSearchTerms();
    }
    const terms = await readFavoriteSearchTerms();
    const key = term.toLocaleLowerCase("ko-KR");
    const next = [term, ...terms.filter((item) => item.toLocaleLowerCase("ko-KR") !== key)]
      .slice(0, FAVORITE_SEARCH_LIMIT);
    await writeStorageValue(FAVORITE_SEARCH_STORAGE_KEY, next);
    return next;
  }

  async function deleteFavoriteSearchTerm(value) {
    const key = normalizeText(value).toLocaleLowerCase("ko-KR");
    const terms = await readFavoriteSearchTerms();
    const next = terms.filter((item) => item.toLocaleLowerCase("ko-KR") !== key);
    await writeStorageValue(FAVORITE_SEARCH_STORAGE_KEY, next);
    return next;
  }

  function jobKoreaAlertText(officialHistory, employeeCount) {
    if (!officialHistory || !Number.isSafeInteger(employeeCount) || employeeCount <= 0) {
      return "";
    }
    const total = Number(officialHistory.total);
    const regular = Number(officialHistory.regular);
    if (Number.isSafeInteger(regular) && regular >= 0 && regular >= employeeCount * 1.5) {
      const ratio = formatRatio(regular, employeeCount);
      return `전체 사원수는 ${employeeCount.toLocaleString("ko-KR")}명이며, 최근 3년간 정규직 채용 횟수는 ${regular.toLocaleString("ko-KR")}회입니다. 최근 3년 정규직 채용 횟수는 현재 사원수의 ${ratio}배입니다.`;
    }
    if (!Number.isSafeInteger(total) || total < 0) {
      return "";
    }
    const ratio = formatRatio(total, employeeCount);
    return `전체 사원수는 ${employeeCount.toLocaleString("ko-KR")}명이며, 최근 3년 공고는 ${total.toLocaleString("ko-KR")}개입니다. 최근 3년간 사원 1인당 ${ratio}개의 공고가 게시되었습니다.`;
  }

  function gameJobAlertText(selected, companyId, activePostingCount) {
    if (!selected || !Number.isSafeInteger(activePostingCount) || activePostingCount < 0) {
      return "";
    }
    const exactId = workforceHasGameJobId(selected, companyId);
    const employeeDelta = selected.employeeDelta;
    if (!exactId) {
      return "";
    }
    const latestJoiners = Number(selected.latestJoiners) || 0;
    if (latestJoiners === 0) {
      return `현재 공고는 ${activePostingCount.toLocaleString("ko-KR")}개며, 26년 6월 신규 가입자는 0명입니다. 신규 가입자 1명당 ÷0개의 공고가 진행중입니다.`;
    }
    const currentEmployees = Number(selected.currentEmployees) || 0;
    if (currentEmployees > 0 && activePostingCount > currentEmployees) {
      const ratio = formatRatio(activePostingCount, currentEmployees);
      return `현재 국민연금 가입자 수는 ${currentEmployees.toLocaleString("ko-KR")}명이며, 진행중인 공고는 ${activePostingCount.toLocaleString("ko-KR")}개입니다. 국민연금 가입자 1인당 ${ratio}개의 공고가 진행중입니다.`;
    }
    return `전체 증감은 ${signedWorkforceCount(employeeDelta)}입니다.`;
  }

  function absoluteUrl(value, base = location.href) {
    try {
      return new URL(value, base).href;
    } catch {
      return null;
    }
  }

  function isUsefulCompanyName(value) {
    const text = normalizeText(value);
    return Boolean(
      text &&
      text.length >= 2 &&
      text.length <= 80 &&
      !/^(기업정보|기업정보 더보기|상세정보|상세보기|채용정보|채용공고|홈페이지|바로가기|더보기)$/i.test(text)
    );
  }

  function parseCompanyRoute(value) {
    const href = absoluteUrl(value);
    if (!href) {
      return null;
    }

    let match = href.match(/\/Recruit\/Co_Read\/Recruit\/C\/(\d+)/i);
    if (match) {
      return { type: "legacy", id: match[1], kind: "history", href };
    }

    match = href.match(/\/Recruit\/Co_Read\/C\/(\d+)/i);
    if (match) {
      return { type: "legacy", id: match[1], kind: "profile", href };
    }

    match = href.match(/\/company\/(\d+)\/recruit(?:\/|$|\?)/i);
    if (match) {
      return { type: "modern", id: match[1], kind: "history", href };
    }

    match = href.match(/\/company\/(\d+)(?:\/|$|\?)/i);
    if (match) {
      return { type: "modern", id: match[1], kind: "profile", href };
    }

    return null;
  }

  function findStructuredCompanyName() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');

    function walk(value) {
      if (!value || typeof value !== "object") {
        return "";
      }

      if (value.hiringOrganization && isUsefulCompanyName(value.hiringOrganization.name)) {
        return normalizeText(value.hiringOrganization.name);
      }

      for (const child of Object.values(value)) {
        if (child && typeof child === "object") {
          const found = walk(child);
          if (found) {
            return found;
          }
        }
      }
      return "";
    }

    for (const script of scripts) {
      try {
        const found = walk(JSON.parse(script.textContent));
        if (found) {
          return found;
        }
      } catch {
        // Ignore malformed page-owned JSON-LD.
      }
    }
    return "";
  }

  function findFallbackCompanyName() {
    const selectors = [
      ".coName",
      ".corpName",
      ".company-name",
      ".company_name",
      '[class*="companyName"]',
      '[class*="company_name"]',
      '[class*="coName"]'
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = normalizeText(element.textContent);
        if (isUsefulCompanyName(text)) {
          return text;
        }
      }
    }

    return findStructuredCompanyName();
  }

  function createCompanyUrls(route, matches) {
    let profileUrl = matches.find((item) => item.route.kind === "profile")?.route.href || null;
    let historyUrl = matches.find((item) => item.route.kind === "history")?.route.href || null;

    if (route.type === "modern") {
      profileUrl ||= `https://www.jobkorea.co.kr/company/${route.id}`;
      historyUrl ||= `https://www.jobkorea.co.kr/company/${route.id}/recruit`;
    } else {
      profileUrl ||= `https://www.jobkorea.co.kr/Recruit/Co_Read/C/${route.id}`;
      historyUrl ||= (
        `https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/${route.id}` +
        "?GI_Part_Code=0&Search_Order=1&ChkDispType=0&Part_Btn_Stat=0"
      );
    }

    return { profileUrl, historyUrl };
  }

  function findJobKoreaCompany() {
    const candidates = [];

    for (const link of document.querySelectorAll("a[href]")) {
      if (link.closest(`#${ROOT_ID}`)) {
        continue;
      }

      const route = parseCompanyRoute(link.getAttribute("href"));
      if (!route) {
        continue;
      }

      const text = normalizeText(link.textContent || link.getAttribute("aria-label") || link.title);
      const parentHint = String(link.parentElement?.className || "");
      let score = route.kind === "profile" ? 50 : 42;

      if (isUsefulCompanyName(text)) {
        score += 35;
      }
      if (/company|corp|co[_-]?info|기업/i.test(parentHint)) {
        score += 18;
      }
      if (/기업정보 더보기|기업 상세/i.test(text)) {
        score += 12;
      }

      candidates.push({ route, link, text, score });
    }

    if (!candidates.length) {
      const html = document.documentElement?.innerHTML || "";
      const patterns = [
        { regex: /\/Recruit\/Co_Read\/Recruit\/C\/(\d+)/i, type: "legacy", kind: "history" },
        { regex: /\/Recruit\/Co_Read\/C\/(\d+)/i, type: "legacy", kind: "profile" },
        { regex: /\/company\/(\d+)\/recruit/i, type: "modern", kind: "history" },
        { regex: /\/company\/(\d+)(?:[/?"'])/i, type: "modern", kind: "profile" }
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern.regex);
        if (match) {
          candidates.push({
            route: { type: pattern.type, id: match[1], kind: pattern.kind, href: null },
            link: null,
            text: "",
            score: 5
          });
          break;
        }
      }
    }

    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => b.score - a.score);
    const primary = candidates[0];
    const sameCompany = candidates.filter(
      (item) => item.route.type === primary.route.type && item.route.id === primary.route.id
    );
    const urls = createCompanyUrls(primary.route, sameCompany);
    const linkName = sameCompany.map((item) => item.text).find(isUsefulCompanyName) || "";

    return {
      id: primary.route.id,
      type: primary.route.type,
      site: SITE_JOBKOREA,
      name: linkName || findFallbackCompanyName() || `회사 ${primary.route.id}`,
      profileUrl: urls.profileUrl,
      historyUrl: urls.historyUrl
    };
  }

  function findGameJobCompany() {
    const candidates = [];
    for (const link of document.querySelectorAll('a[href*="/Company/Detail" i]')) {
      const href = absoluteUrl(link.getAttribute("href"));
      if (!href) {
        continue;
      }
      let url;
      try {
        url = new URL(href);
      } catch {
        continue;
      }
      const id = url.searchParams.get("M");
      if (!/^\d{1,20}$/.test(id || "")) {
        continue;
      }
      const text = normalizeText(link.textContent || link.getAttribute("aria-label") || link.title);
      let score = isUsefulCompanyName(text) ? 80 : 30;
      if (/기업정보|company/i.test(String(link.parentElement?.className || ""))) {
        score += 15;
      }
      candidates.push({ id, text, score });
    }

    if (!candidates.length) {
      const match = (document.documentElement?.innerHTML || "").match(
        /\/Company\/Detail\?[^"'<>]*\bM=(\d{1,20})/i
      );
      if (match) {
        candidates.push({ id: match[1], text: "", score: 1 });
      }
    }
    if (!candidates.length) {
      return null;
    }

    candidates.sort((a, b) => b.score - a.score);
    const primary = candidates[0];
    const name = candidates
      .filter((item) => item.id === primary.id)
      .map((item) => item.text)
      .find(isUsefulCompanyName) || findStructuredCompanyName() || findFallbackCompanyName();
    const profileUrl = `https://www.gamejob.co.kr/Company/Detail?M=${primary.id}`;
    return {
      id: primary.id,
      type: SITE_GAMEJOB,
      site: SITE_GAMEJOB,
      name: name || `회사 ${primary.id}`,
      profileUrl,
      historyUrl: `${profileUrl}&tabcode=3`
    };
  }

  function findCompany() {
    return currentSite === SITE_GAMEJOB ? findGameJobCompany() : findJobKoreaCompany();
  }

  async function fetchHtml(url, request = {}) {
    const response = await chrome.runtime.sendMessage({
      type: "HY_FETCH_HTML",
      url,
      method: request.method || "GET",
      form: request.form || null
    });

    if (!response?.ok) {
      throw new Error(response?.error || "채용 사이트 페이지를 불러오지 못했습니다.");
    }

    const doc = new DOMParser().parseFromString(response.html, "text/html");
    return {
      doc,
      finalUrl: response.finalUrl || url
    };
  }

  function parseDate(text) {
    const normalized = normalizeText(text);
    const closing = [
      ...normalized.matchAll(/(?:마감(?:일)?|종료|~)\s*[:：]?\s*\(?\s*~?\s*(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})\s*일?/g)
    ];
    const general = [
      ...normalized.matchAll(/(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})\s*일?/g)
    ];
    const match = closing.at(-1) || general.at(-1);

    if (!match) {
      const short = [...normalized.matchAll(/(?:^|\D)(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\D|$)/g)].at(-1);
      if (!short) {
        const monthDay = normalized.match(/(?:~|마감(?:일)?\s*[:：]?)\s*(\d{1,2})[.\-/](\d{1,2})(?:\D|$)/);
        if (!monthDay) {
          return null;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let candidate = new Date(today.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]));
        if (candidate.getTime() < today.getTime() - (180 * 24 * 60 * 60 * 1000)) {
          candidate = new Date(today.getFullYear() + 1, Number(monthDay[1]) - 1, Number(monthDay[2]));
        }
        return Number.isNaN(candidate.getTime()) ? null : candidate;
      }
      const shortDate = new Date(2000 + Number(short[1]), Number(short[2]) - 1, Number(short[3]));
      return (
        shortDate.getFullYear() === 2000 + Number(short[1]) &&
        shortDate.getMonth() === Number(short[2]) - 1 &&
        shortDate.getDate() === Number(short[3])
      ) ? shortDate : null;
    }

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return (
      date.getFullYear() === Number(match[1]) &&
      date.getMonth() === Number(match[2]) - 1 &&
      date.getDate() === Number(match[3])
    ) ? date : null;
  }

  function extractRecruitDate(row) {
    const values = [row?.textContent || ""];
    for (const element of row?.querySelectorAll?.(
      '[datetime], [data-date], [data-end-date], [data-deadline], [class*="date" i], [class*="deadline" i]'
    ) || []) {
      values.push(
        element.getAttribute("datetime") ||
        element.getAttribute("data-date") ||
        element.getAttribute("data-end-date") ||
        element.getAttribute("data-deadline") ||
        element.textContent ||
        ""
      );
    }
    return parseDate(values.join(" "));
  }

  function recruitKindsFromText(value) {
    const text = normalizeText(value);
    const both = /경력\s*무관|신입\s*(?:·|\/|,|및|&|\+)\s*경력|신입경력/.test(text);
    return {
      isNewHire: both || /신입/.test(text),
      isExperienced: both || /경력/.test(text)
    };
  }

  function recruitIdsInNode(node, baseUrl) {
    const ids = new Set();
    for (const candidate of node?.querySelectorAll?.("a[href]") || []) {
      const identity = recruitIdentityFromUrl(candidate.getAttribute("href"), baseUrl);
      if (identity?.id) {
        ids.add(identity.id);
      }
    }
    return ids;
  }

  function findRecruitRow(link, baseUrl) {
    let node = link;
    let best = link.parentElement || link;
    let bestScore = -1;
    const linkIdentity = recruitIdentityFromUrl(link.getAttribute("href"), baseUrl);

    for (let depth = 0; depth < 9 && node; depth += 1) {
      node = node.parentElement;
      if (!node) {
        break;
      }

      const className = String(node.className || "");
      const text = normalizeText(node.textContent);
      if (text.length < 10 || text.length > 1800) {
        continue;
      }

      const recruitIds = recruitIdsInNode(node, baseUrl);
      if (recruitIds.size !== 1 || (linkIdentity?.id && !recruitIds.has(linkIdentity.id))) {
        continue;
      }

      let score = Math.max(0, 16 - (depth * 2));
      if (node.matches("li, tr, article")) {
        score += 30;
      }
      if (/recruit|posting|job|list|item|row/i.test(className)) {
        score += 12;
      }
      if (/20\d{2}\s*[년.\-/]\s*\d{1,2}|\b\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}\b/.test(text)) {
        score += 24;
      }
      if (/신입|경력|정규직|계약직|마감|진행중|상시채용/.test(text)) {
        score += 18;
      }
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }

    return best;
  }

  function recruitStatusFromRow(row, context, date, forcedStatus = "") {
    if (forcedStatus === "진행중" || forcedStatus === "마감") {
      return forcedStatus;
    }

    const rowSignals = [
      row?.className,
      row?.id,
      row?.getAttribute?.("data-status"),
      row?.getAttribute?.("data-recruit-status"),
      row?.getAttribute?.("aria-label")
    ].map(normalizeText).join(" ");
    const hasClosedElement = Boolean(row?.querySelector?.(
      '[class~="closed" i], [class*="expired" i], [class*="finished" i], [data-status*="close" i], [data-status*="expire" i]'
    ));
    const isExplicitlyClosed = hasClosedElement ||
      /(?:^|[\s_-])(?:closed|expired|finished|finish|recruit[-_]?end)(?:$|[\s_-])/i.test(rowSignals) ||
      /마감\s*완료|마감\s*공고|채용\s*마감|접수\s*마감|공고\s*마감|모집\s*마감|접수\s*종료|채용\s*종료|모집\s*종료|(?:^|[\s·|])종료(?:$|[\s·|])|(?:^|[\s·|])마감(?:$|[\s·|])/i.test(context);
    const isExplicitlyOngoing = /진행\s*중|상시\s*채용|채용시\s*마감|오늘\s*마감|D-\d+/i.test(context);

    if (isExplicitlyClosed) {
      return "마감";
    }
    if (isExplicitlyOngoing) {
      return "진행중";
    }
    if (date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return date >= today ? "진행중" : "마감";
    }
    return "";
  }

  function titleFromRecruitLink(link) {
    const values = [
      link.textContent,
      link.getAttribute("title"),
      link.getAttribute("aria-label"),
      link.querySelector("img")?.getAttribute("alt")
    ];

    return values
      .map(normalizeText)
      .find((text) => text.length >= 2 && text.length <= 220 && !/^(상세보기|지원하기|홈페이지|스크랩|바로가기)$/i.test(text)) || "";
  }

  function recruitIdentityFromUrl(value, baseUrl) {
    const href = absoluteUrl(value, baseUrl);
    if (!href) {
      return null;
    }
    try {
      const url = new URL(href);
      if (/\bgamejob\.co\.kr$/i.test(url.hostname) && /\/Recruit\/GI_Read\/View\/?$/i.test(url.pathname)) {
        const id = url.searchParams.get("GI_No");
        return /^\d{1,30}$/.test(id || "") ? { id, href, site: SITE_GAMEJOB } : null;
      }
      if (
        (url.hostname === "jobkorea.co.kr" || url.hostname.endsWith(".jobkorea.co.kr")) &&
        /\/Recruit\/GI_Read\/(\d+)/i.test(url.pathname)
      ) {
        return { id: url.pathname.match(/\/Recruit\/GI_Read\/(\d+)/i)[1], href, site: SITE_JOBKOREA };
      }
    } catch {
      return null;
    }
    return null;
  }

  function recruitUrlKey(value, baseUrl = location.href) {
    const identity = recruitIdentityFromUrl(value, baseUrl);
    if (!identity) {
      return "";
    }
    return identity.site === SITE_GAMEJOB
      ? `https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=${identity.id}`
      : `https://www.jobkorea.co.kr/Recruit/GI_Read/${identity.id}`;
  }

  function extractRecruitItems(doc, baseUrl, forcedStatus = "") {
    const map = new Map();
    const links = doc.querySelectorAll(
      'a[href*="/Recruit/GI_Read/" i], a[href*="/recruit/GI_Read/" i], a[href*="GI_No=" i]'
    );

    for (const link of links) {
      const identity = recruitIdentityFromUrl(link.getAttribute("href"), baseUrl);
      const href = identity?.href;
      const id = identity?.id;
      const title = titleFromRecruitLink(link);

      if (!href || !id || !title) {
        continue;
      }

      const row = findRecruitRow(link, baseUrl);
      const context = normalizeText(row?.textContent);
      const recruitKinds = recruitKindsFromText(context);
      const date = extractRecruitDate(row);
      const status = recruitStatusFromRow(row, context, date, forcedStatus);

      const item = {
        key: id,
        id,
        site: identity.site,
        title,
        href,
        date,
        status,
        context,
        isNewHire: recruitKinds.isNewHire,
        isExperienced: recruitKinds.isExperienced,
        isRegular: /정규직/.test(context)
      };

      const urlKey = recruitUrlKey(href, baseUrl);
      const old = map.get(urlKey);
      if (!old || title.length > old.title.length) {
        map.set(urlKey, item);
      }
    }

    return [...map.values()];
  }

  function extractJobKoreaLegacyItems(doc, baseUrl, forcedStatus) {
    const map = new Map();
    const rows = doc.querySelectorAll(
      '.AgiCntnts.list-item[data-gno], [data-gno].list-item, [data-gno][class*="AgiCntnts"]'
    );

    for (const row of rows) {
      const link = row.querySelector('a[href*="/Recruit/GI_Read/" i]');
      const identity = recruitIdentityFromUrl(link?.getAttribute("href"), baseUrl);
      const rowId = normalizeText(row.getAttribute("data-gno"));
      const id = /^\d{1,30}$/.test(rowId) ? rowId : identity?.id;
      const href = identity?.href;
      const title = normalizeText(
        row.querySelector("dt.tit, .booth > .tit, [class~='tit']")?.textContent
      ) || titleFromRecruitLink(link);
      if (!id || !href || !title) {
        continue;
      }

      const context = normalizeText(row.textContent);
      const recruitKinds = recruitKindsFromText(context);
      const date = extractRecruitDate(row);
      map.set(recruitUrlKey(href, baseUrl), {
        key: id,
        id,
        site: SITE_JOBKOREA,
        title,
        href,
        date,
        status: forcedStatus,
        context,
        isNewHire: recruitKinds.isNewHire,
        isExperienced: recruitKinds.isExperienced,
        isRegular: /정규직/.test(context)
      });
    }

    return map.size ? [...map.values()] : extractRecruitItems(doc, baseUrl, forcedStatus);
  }

  function findPaginationUrls(doc, baseUrl) {
    const urls = new Set();
    let base;

    try {
      base = new URL(baseUrl);
    } catch {
      return [];
    }

    for (const link of doc.querySelectorAll("a[href]")) {
      const text = normalizeText(link.textContent || link.getAttribute("aria-label"));
      if (!/^\d+$/.test(text) && !/^(다음|next)$/i.test(text)) {
        continue;
      }

      const href = absoluteUrl(link.getAttribute("href"), baseUrl);
      if (!href) {
        continue;
      }

      let url;
      try {
        url = new URL(href);
      } catch {
        continue;
      }

      const hasPageParameter = [...url.searchParams.keys()].some((key) => /^(page|pageno|page_no|pageindex)$/i.test(key));
      const isGameJobCompanyPage = /(^|\.)gamejob\.co\.kr$/i.test(base.hostname) &&
        /\/Company\/Detail$/i.test(base.pathname) && url.pathname === base.pathname;
      const isJobKoreaHistoryPage = /(^|\.)jobkorea\.co\.kr$/i.test(base.hostname) &&
        /recruit/i.test(url.pathname);
      if (
        url.hostname !== base.hostname ||
        /\/Recruit\/GI_Read\//i.test(url.pathname) ||
        (!isGameJobCompanyPage && !isJobKoreaHistoryPage) ||
        (!hasPageParameter && url.pathname !== base.pathname) ||
        url.href === base.href
      ) {
        continue;
      }

      urls.add(url.href);
    }

    return [...urls].slice(0, MAX_RECRUIT_PAGES - 1);
  }

  function gameJobRecruitPageCount(doc, expectedTotal, firstPageCount) {
    let lastPage = 1;
    for (const link of doc.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/fncCompanyInfoPage\(\s*(\d+)\s*,\s*['\"]Recruit['\"]\s*\)/i);
      if (match) {
        lastPage = Math.max(lastPage, Number(match[1]) || 1);
      }
    }
    if (Number.isSafeInteger(expectedTotal) && expectedTotal > 0 && firstPageCount > 0) {
      lastPage = Math.max(lastPage, Math.ceil(expectedTotal / firstPageCount));
    }
    return Math.min(lastPage, MAX_RECRUIT_PAGES);
  }

  function jobKoreaPageUrl(value, pageNumber) {
    try {
      const url = new URL(value);
      if (!/(^|\.)jobkorea\.co\.kr$/i.test(url.hostname) || !/\/company\/\d+\/recruit\/?$/i.test(url.pathname)) {
        return null;
      }
      url.searchParams.set("page", String(pageNumber));
      return url.href;
    } catch {
      return null;
    }
  }

  function jobKoreaLegacyFilterUrl(value, filterType, pageNumber = 1) {
    try {
      const url = new URL(value);
      if (
        !/(^|\.)jobkorea\.co\.kr$/i.test(url.hostname) ||
        !/\/Recruit\/Co_Read\/Recruit\/C\/\d+/i.test(url.pathname) ||
        (filterType !== 1 && filterType !== 2)
      ) {
        return null;
      }
      url.searchParams.set("GI_Part_Code", "0");
      url.searchParams.set("Search_Order", url.searchParams.get("Search_Order") || "1");
      url.searchParams.set("ChkDispType", String(filterType));
      url.searchParams.set("Part_Btn_Stat", "0");
      if (pageNumber > 1) {
        url.searchParams.set("page", String(pageNumber));
      } else {
        url.searchParams.delete("page");
      }
      return url.href;
    } catch {
      return null;
    }
  }

  function jobKoreaLegacyPageCount(doc, expectedTotal, firstPageCount) {
    let lastPage = 1;
    for (const link of doc.querySelectorAll('a[href*="page=" i]')) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/[?&]page=(\d+)/i);
      if (match) {
        lastPage = Math.max(lastPage, Number(match[1]) || 1);
      }
    }
    if (Number.isSafeInteger(expectedTotal) && expectedTotal > 0 && firstPageCount > 0) {
      lastPage = Math.max(lastPage, Math.ceil(expectedTotal / firstPageCount));
    }
    return Math.min(lastPage, MAX_RECRUIT_PAGES);
  }

  function mergeRecruitItems(...groups) {
    const map = new Map();

    for (const item of groups.flat()) {
      const key = recruitUrlKey(item.href);
      if (!key) {
        continue;
      }
      const old = map.get(key);

      if (!old || (!old.href && item.href)) {
        map.set(key, item);
      }
    }

    return [...map.values()].sort((a, b) => {
      const rank = (item) => {
        if (item.archivedMissing) {
          return 2;
        }
        return /진행중|상시채용|D-\d+/i.test(`${item.status || ""} ${item.context || ""}`) ? 0 : 1;
      };
      const rankDifference = rank(a) - rank(b);
      if (rankDifference) {
        return rankDifference;
      }
      if (a.date && b.date) {
        return b.date.getTime() - a.date.getTime();
      }
      if (a.date) {
        return -1;
      }
      if (b.date) {
        return 1;
      }
      return a.title.localeCompare(b.title, "ko");
    });
  }

  function isClosedRecruit(item) {
    return normalizeText(item?.status) === "마감" ||
      /마감\s*완료|채용\s*마감|접수\s*마감|공고\s*마감|종료/i.test(
        `${item?.status || ""} ${item?.context || ""}`
      );
  }

  function postingCountsFromRecruitView(items, archivedMissing, recruitSummary) {
    const currentItems = Array.isArray(items) ? items : [];
    const summaryIsValid = recruitSummary &&
      Number.isSafeInteger(recruitSummary.active) && recruitSummary.active >= 0 &&
      Number.isSafeInteger(recruitSummary.closed) && recruitSummary.closed >= 0;
    const closed = summaryIsValid
      ? recruitSummary.closed
      : currentItems.filter(isClosedRecruit).length;
    const active = summaryIsValid
      ? recruitSummary.active
      : Math.max(0, currentItems.length - closed);
    return {
      active,
      closed,
      missing: Array.isArray(archivedMissing) ? archivedMissing.length : 0
    };
  }

  function staleLoadError() {
    const error = new Error("새 공고로 이동하여 이전 요청 결과를 무시했습니다.");
    error.name = "HayoungStaleLoad";
    return error;
  }

  function assertLoadGeneration(generation) {
    if (generation !== state.loadGeneration) {
      throw staleLoadError();
    }
  }

  function setLoadingForGeneration(generation, message) {
    assertLoadGeneration(generation);
    setLoading(message);
  }

  async function fetchHtmlWithRetry(url, request = {}, attempts = 2) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fetchHtml(url, request);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      }
    }
    throw lastError || new Error("채용 사이트 페이지를 불러오지 못했습니다.");
  }

  async function loadHistoryPages(url, generation = state.loadGeneration, overviewPage = null) {
    const first = overviewPage || await fetchHtml(url);
    assertLoadGeneration(generation);
    const firstItems = extractRecruitItems(first.doc, first.finalUrl);
    const groups = [firstItems];
    const seenUrls = new Set(firstItems.map((item) => recruitUrlKey(item.href)).filter(Boolean));
    const firstUrl = new URL(first.finalUrl);
    const recruitSummary = extractRecruitSummary(
      first.doc,
      /(^|\.)gamejob\.co\.kr$/i.test(firstUrl.hostname) ? SITE_GAMEJOB : SITE_JOBKOREA
    );

    if (/(^|\.)gamejob\.co\.kr$/i.test(firstUrl.hostname)) {
      const companyId = firstUrl.searchParams.get("M") || state.company?.id;
      groups.length = 0;
      seenUrls.clear();
      const filters = [
        { recruitType: "1", status: "진행중", total: recruitSummary?.active },
        { recruitType: "2", status: "마감", total: recruitSummary?.closed }
      ];

      for (const filter of filters) {
        if (filter.total === 0) {
          continue;
        }
        try {
          setLoadingForGeneration(generation, `게임잡 ${filter.status} 공고 1페이지 확인 중...`);
          const firstFilteredPage = await fetchHtml("https://www.gamejob.co.kr/Company/Company_Recruit", {
            method: "POST",
            form: {
              tabcode: "",
              M: companyId,
              Rpage: 1,
              Recruit_Type: filter.recruitType
            }
          });
          assertLoadGeneration(generation);
          const filteredItems = extractRecruitItems(
            firstFilteredPage.doc,
            firstFilteredPage.finalUrl,
            filter.status
          );
          groups.push(filteredItems);
          for (const item of filteredItems) {
            seenUrls.add(recruitUrlKey(item.href));
          }
          const pageCount = gameJobRecruitPageCount(
            firstFilteredPage.doc,
            filter.total,
            filteredItems.length
          );

          for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
            setLoadingForGeneration(
              generation,
              `게임잡 ${filter.status} 공고 ${pageNumber}/${pageCount} 페이지 확인 중...`
            );
            const page = await fetchHtml("https://www.gamejob.co.kr/Company/Company_Recruit", {
              method: "POST",
              form: {
                tabcode: "",
                M: companyId,
                Rpage: pageNumber,
                Recruit_Type: filter.recruitType
              }
            });
            assertLoadGeneration(generation);
            const pageItems = extractRecruitItems(page.doc, page.finalUrl, filter.status);
            for (const item of pageItems) {
              seenUrls.add(recruitUrlKey(item.href));
            }
            groups.push(pageItems);
          }
        } catch (error) {
          if (error?.name === "HayoungStaleLoad") {
            throw error;
          }
          console.warn("[Hayoung] GameJob filtered posting load failed", filter, error);
        }
      }

      if (!groups.some((group) => group.length)) {
        groups.push(firstItems);
      }
    } else if (/\/Recruit\/Co_Read\/Recruit\/C\/\d+/i.test(firstUrl.pathname)) {
      groups.length = 0;
      seenUrls.clear();
      const filters = [
        { filterType: 1, status: "진행중", total: recruitSummary?.active },
        { filterType: 2, status: "마감", total: recruitSummary?.closed }
      ];
      const failedStatuses = new Set();

      for (const filter of filters) {
        if (filter.total === 0) {
          continue;
        }
        const firstFilterUrl = jobKoreaLegacyFilterUrl(first.finalUrl, filter.filterType, 1);
        if (!firstFilterUrl) {
          continue;
        }
        try {
          setLoadingForGeneration(generation, `잡코리아 ${filter.status} 공고 1페이지 확인 중...`);
          const firstFilteredPage = await fetchHtmlWithRetry(firstFilterUrl);
          assertLoadGeneration(generation);
          const filteredItems = extractJobKoreaLegacyItems(
            firstFilteredPage.doc,
            firstFilteredPage.finalUrl,
            filter.status
          );
          groups.push(filteredItems);
          for (const item of filteredItems) {
            seenUrls.add(recruitUrlKey(item.href));
          }

          const pageCount = jobKoreaLegacyPageCount(
            firstFilteredPage.doc,
            filter.total,
            filteredItems.length
          );
          for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
            const pageUrl = jobKoreaLegacyFilterUrl(first.finalUrl, filter.filterType, pageNumber);
            if (!pageUrl) {
              break;
            }
            setLoadingForGeneration(
              generation,
              `잡코리아 ${filter.status} 공고 ${pageNumber}/${pageCount} 페이지 확인 중...`
            );
            const page = await fetchHtmlWithRetry(pageUrl);
            assertLoadGeneration(generation);
            const pageItems = extractJobKoreaLegacyItems(page.doc, page.finalUrl, filter.status);
            if (!pageItems.length) {
              break;
            }
            for (const item of pageItems) {
              seenUrls.add(recruitUrlKey(item.href));
            }
            groups.push(pageItems);
          }
        } catch (error) {
          if (error?.name === "HayoungStaleLoad") {
            throw error;
          }
          failedStatuses.add(filter.status);
          console.warn("[Hayoung] JobKorea filtered posting load failed", filter, error);
        }
      }

      const filteredItems = mergeRecruitItems(...groups);
      const missingStatuses = filters.filter((filter) => (
        Number.isSafeInteger(filter.total) &&
        filter.total > 0 &&
        !filteredItems.some((item) => item.status === filter.status)
      ));
      if (missingStatuses.length || failedStatuses.size) {
        throw new Error(
          `잡코리아 ${[...new Set([...missingStatuses.map((item) => item.status), ...failedStatuses])].join("·")} 공고 목록을 끝까지 불러오지 못했습니다.`
        );
      }

      if (!groups.some((group) => group.length)) {
        groups.push(firstItems);
      }
    } else {
      const discoveredUrls = findPaginationUrls(first.doc, first.finalUrl);
      const queuedUrls = new Set(discoveredUrls);
      const modernSecondPage = jobKoreaPageUrl(first.finalUrl, 2);
      if (modernSecondPage) {
        queuedUrls.add(modernSecondPage);
      }

      for (const pageUrl of queuedUrls) {
        setLoadingForGeneration(generation, "잡코리아 과거 공고 추가 페이지 확인 중...");
        try {
          const page = await fetchHtml(pageUrl);
          assertLoadGeneration(generation);
          const pageItems = extractRecruitItems(page.doc, page.finalUrl);
          const newItems = pageItems.filter((item) => !seenUrls.has(recruitUrlKey(item.href)));
          for (const item of newItems) {
            seenUrls.add(recruitUrlKey(item.href));
          }
          groups.push(pageItems);
        } catch (error) {
          if (error?.name === "HayoungStaleLoad") {
            throw error;
          }
          console.warn("[Hayoung] JobKorea additional page failed", pageUrl, error);
        }
      }

      if (modernSecondPage) {
        let pageNumber = 2;
        while (pageNumber < MAX_RECRUIT_PAGES) {
          const pageUrl = jobKoreaPageUrl(first.finalUrl, pageNumber);
          if (!pageUrl || queuedUrls.has(pageUrl)) {
            pageNumber += 1;
            continue;
          }
          setLoadingForGeneration(generation, `잡코리아 과거 공고 ${pageNumber}페이지 확인 중...`);
          try {
            const page = await fetchHtml(pageUrl);
            assertLoadGeneration(generation);
            const pageItems = extractRecruitItems(page.doc, page.finalUrl);
            const newItems = pageItems.filter((item) => !seenUrls.has(recruitUrlKey(item.href)));
            if (!newItems.length) {
              break;
            }
            for (const item of newItems) {
              seenUrls.add(recruitUrlKey(item.href));
            }
            groups.push(pageItems);
          } catch (error) {
            if (error?.name === "HayoungStaleLoad") {
              throw error;
            }
            console.warn("[Hayoung] JobKorea sequential page failed", pageUrl, error);
            break;
          }
          pageNumber += 1;
        }
      }
    }

    return {
      items: mergeRecruitItems(...groups),
      finalUrl: first.finalUrl,
      firstDoc: first.doc,
      recruitSummary
    };
  }

  function extractRecruitSummary(doc, source = currentSite) {
    const text = normalizeText(doc.body?.textContent || "");
    const match = text.match(
      /전체\s*([\d,]+)\s*건\s*진행중\s*([\d,]+)\s*건\s*마감\s*([\d,]+)\s*건/i
    );
    if (!match) {
      return null;
    }
    const total = parseOfficialCount(match[1]);
    const active = parseOfficialCount(match[2]);
    const closed = parseOfficialCount(match[3]);
    if ([total, active, closed].some((value) => value === null) || active + closed !== total) {
      return null;
    }
    return { total, active, closed, source };
  }

  const PROFILE_LABELS = [
    ["산업", /^(산업|업종)$/],
    ["기업형태", /^(기업형태|기업구분)$/],
    ["대표자", /^대표자$/],
    ["설립", /^(설립|설립일|설립년도)$/],
    ["사원수", /^(사원수|직원수)$/],
    ["매출액", /^매출액$/],
    ["자본금", /^자본금$/],
    ["주소", /^(주소|본사주소)$/]
  ];

  function canonicalProfileLabel(value) {
    const cleaned = normalizeText(value).replace(/[:：]$/, "");
    return PROFILE_LABELS.find(([, regex]) => regex.test(cleaned))?.[0] || null;
  }

  function parseOfficialCount(value) {
    const normalized = normalizeText(value).replace(/,/g, "");
    if (!/^\d+$/.test(normalized)) {
      return null;
    }
    const count = Number(normalized);
    return Number.isSafeInteger(count) && count >= 0 && count <= 9999999 ? count : null;
  }

  function parseOfficialHistoryText(value) {
    const text = normalizeText(value);
    const totalMatch = text.match(/([\d,]+)\s*회\s*의?\s*채용\s*중/);
    if (!totalMatch) {
      return null;
    }

    const total = parseOfficialCount(totalMatch[1]);
    if (total === null) {
      return null;
    }

    const regularMatch = text.match(/정규직\s*채용\s*은?\s*([\d,]+)\s*회/);
    const regular = regularMatch ? parseOfficialCount(regularMatch[1]) : null;
    let categoryText = text.slice(totalMatch.index + totalMatch[0].length);
    categoryText = categoryText.split(/최근\s*3년(?:간)?/)[0];

    const bothMatch = categoryText.match(
      /(?:신입\s*(?:[,·\/+&]\s*|\s+)경력|경력\s*(?:[,·\/+&]\s*|\s+)신입)\s*[:：|]?\s*([\d,]+)\s*(?:회)?/
    );
    const both = bothMatch ? parseOfficialCount(bothMatch[1]) : 0;
    if (bothMatch) {
      categoryText = categoryText.replace(bothMatch[0], " ");
    }

    const experiencedMatch = categoryText.match(/경력(?:사원)?\s*[:：|]?\s*([\d,]+)\s*(?:회)?/);
    const newMatch = categoryText.match(/신입\s*[:：|]?\s*([\d,]+)\s*(?:회)?/);
    const experiencedOnly = experiencedMatch ? parseOfficialCount(experiencedMatch[1]) : 0;
    const newOnly = newMatch ? parseOfficialCount(newMatch[1]) : 0;
    if ([regular, both, experiencedOnly, newOnly].some((count) => count !== null && count > total)) {
      return null;
    }

    const categorized = experiencedOnly + both + newOnly;
    return {
      total,
      regular,
      experiencedOnly,
      both,
      newOnly,
      other: Math.max(0, total - categorized),
      source: "jobkorea-company-detail"
    };
  }

  function extractOfficialHistory(doc) {
    const headings = [...doc.querySelectorAll("h1, h2, h3, h4, strong, dt, th")].filter((element) => (
      /^채용\s*(?:History|히스토리)$/i.test(normalizeText(element.textContent))
    ));

    for (const heading of headings) {
      let container = heading.parentElement;
      for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
        const text = normalizeText(container.textContent);
        if (text.length > 5000) {
          break;
        }
        const history = parseOfficialHistoryText(text);
        if (history) {
          return history;
        }
      }
    }

    const pageText = normalizeText(doc.body?.textContent);
    const historyWindow = pageText.match(
      /채용\s*(?:History|히스토리)(.{0,3000}?)(?=\s(?:사원수|직원수|채용공고|근무환경)\s|$)/i
    );
    return historyWindow ? parseOfficialHistoryText(historyWindow[0]) : null;
  }

  function extractEmployeeTrend(doc) {
    const currentYear = new Date().getFullYear();

    function normalizePoints(points) {
      const byYear = new Map();
      for (const point of points) {
        const year = Number(point?.year);
        const count = Number(String(point?.count ?? "").replace(/,/g, ""));
        if (
          Number.isInteger(year) &&
          year >= 1990 &&
          year <= currentYear + 1 &&
          Number.isSafeInteger(count) &&
          count >= 0 &&
          count <= 9999999
        ) {
          byYear.set(year, { year, count });
        }
      }
      return [...byYear.values()].sort((a, b) => a.year - b.year).slice(-8);
    }

    function pointsFromText(value) {
      const text = normalizeText(value);
      const paired = [];
      const yearFirst = /\b((?:19|20)\d{2})\s*년?\s*[:：-]?\s*([\d,]+)\s*명/g;
      const countFirst = /([\d,]+)\s*명\s*[:：-]?\s*\b((?:19|20)\d{2})\s*년?/g;

      for (const match of text.matchAll(yearFirst)) {
        paired.push({ year: match[1], count: match[2] });
      }
      for (const match of text.matchAll(countFirst)) {
        paired.push({ year: match[2], count: match[1] });
      }

      let normalized = normalizePoints(paired);
      if (normalized.length >= 1) {
        return normalized;
      }

      const years = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => match[1]);
      const counts = [...text.matchAll(/([\d,]+)\s*명/g)].map((match) => match[1]);
      if (years.length >= 1 && years.length === counts.length && years.length <= 8) {
        normalized = normalizePoints(years.map((year, index) => ({ year, count: counts[index] })));
      }
      return normalized;
    }

    const headings = [...doc.querySelectorAll("h1, h2, h3, h4, strong, dt, th")].filter((element) => (
      /^(사원수|직원수)(\s*추이)?$/.test(normalizeText(element.textContent))
    ));

    for (const heading of headings) {
      let container = heading.parentElement;
      for (let depth = 0; container && depth < 5; depth += 1, container = container.parentElement) {
        const text = normalizeText(container.textContent);
        if (text.length > 4000) {
          break;
        }
        const points = pointsFromText(text);
        if (points.length >= 1) {
          return points;
        }
      }
    }

    for (const script of doc.querySelectorAll("script")) {
      const text = script.textContent || "";
      if (!/(사원수|직원수)/.test(text) || text.length > 1500000) {
        continue;
      }

      const windows = text.match(/.{0,1500}(?:사원수|직원수).{0,5000}/gs) || [];
      for (const windowText of windows) {
        const points = pointsFromText(windowText);
        if (points.length >= 1) {
          return points;
        }

        const yearList = windowText.match(/(?:categories|labels)\s*[:=]\s*\[([^\]]+)]/i)?.[1];
        const countList = windowText.match(/(?:data|values)\s*[:=]\s*\[([^\]]+)]/i)?.[1];
        if (!yearList || !countList) {
          continue;
        }

        const years = [...yearList.matchAll(/(?:19|20)\d{2}/g)].map((match) => match[0]);
        const counts = [...countList.matchAll(/[\d,]+/g)].map((match) => match[0]);
        const pointsFromArrays = normalizePoints(
          years.map((year, index) => ({ year, count: counts[index] }))
        );
        if (years.length === counts.length && pointsFromArrays.length >= 1) {
          return pointsFromArrays;
        }
      }
    }

    return [];
  }

  function extractProfileInfo(doc, fallbackName) {
    const fields = new Map();

    function add(labelValue, contentValue) {
      const label = canonicalProfileLabel(labelValue);
      const value = normalizeText(contentValue);
      if (label && value && value !== "-" && value.length <= 300 && !fields.has(label)) {
        fields.set(label, value);
      }
    }

    for (const dt of doc.querySelectorAll("dt")) {
      add(dt.textContent, dt.nextElementSibling?.textContent);
    }

    for (const row of doc.querySelectorAll("tr")) {
      const cells = row.querySelectorAll(":scope > th, :scope > td");
      if (cells.length >= 2) {
        add(cells[0].textContent, cells[1].textContent);
      }
    }

    for (const item of doc.querySelectorAll("li")) {
      const text = normalizeText(item.textContent);
      const match = text.match(/^(산업|업종|기업형태|기업구분|대표자|설립일|설립년도|사원수|직원수|매출액|자본금|본사주소|주소)\s*[:：]\s*(.+)$/);
      if (match) {
        add(match[1], match[2]);
      }
    }

    if (!fields.has("사원수")) {
      const pageText = normalizeText(doc.body?.textContent);
      const employeeMatch = pageText.match(/(?:사원수|직원수)\s*[:：]?\s*([\d,]+)\s*명/);
      if (employeeMatch) {
        add("사원수", `${employeeMatch[1]}명`);
      }
    }

    let name = "";
    const nameSelectors = [
      ".coName",
      ".corpName",
      ".company-name",
      '[class*="companyName"]',
      "h1"
    ];

    for (const selector of nameSelectors) {
      for (const element of doc.querySelectorAll(selector)) {
        const text = normalizeText(element.textContent);
        if (isUsefulCompanyName(text)) {
          name = text;
          break;
        }
      }
      if (name) {
        break;
      }
    }

    return {
      name: name || fallbackName,
      fields: [...fields.entries()].slice(0, 8),
      employeeTrend: extractEmployeeTrend(doc),
      officialHistory: extractOfficialHistory(doc)
    };
  }

  function extractEmployeeCount(profileInfo) {
    const rawValue = profileInfo?.fields?.find(([label]) => label === "사원수")?.[1] || "";
    const match = normalizeText(rawValue).match(/([\d,]+)\s*명?/);
    if (match) {
      const count = Number(match[1].replace(/,/g, ""));
      if (Number.isSafeInteger(count) && count >= 0) {
        return count;
      }
    }

    const latestOfficialPoint = Array.isArray(profileInfo?.employeeTrend)
      ? profileInfo.employeeTrend.at(-1)
      : null;
    return Number.isSafeInteger(latestOfficialPoint?.count) && latestOfficialPoint.count >= 0
      ? latestOfficialPoint.count
      : null;
  }

  function employeeStorageKey(company) {
    return `${EMPLOYEE_STORAGE_PREFIX}${company.type}:${company.id}`;
  }

  function readEmployeeRecord(company) {
    const key = employeeStorageKey(company);
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result?.[key] || null);
      });
    });
  }

  function normalizeEmployeeSnapshots(record) {
    const source = Array.isArray(record?.snapshots) ? record.snapshots : [];
    const snapshots = source.filter((item) => (
      typeof item?.id === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.capturedDate || "") &&
      Number.isSafeInteger(item.count) &&
      item.count >= 0
    ));

    if (!snapshots.length && Number.isSafeInteger(record?.count) && record.count >= 0) {
      const legacyDate = String(record.savedAt || new Date().toISOString()).slice(0, 10);
      snapshots.push({
        id: `legacy-${record.savedAt || Date.now()}`,
        capturedDate: legacyDate,
        count: record.count,
        addedAt: record.savedAt || new Date().toISOString()
      });
    }

    return snapshots;
  }

  function writeEmployeeSnapshots(company, snapshots) {
    const key = employeeStorageKey(company);
    const record = {
      site: company.site || SITE_JOBKOREA,
      companyType: company.type,
      companyId: company.id,
      companyName: company.name,
      snapshots,
      updatedAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: record }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(record);
      });
    });
  }

  async function addEmployeeSnapshot(company, count, capturedDate) {
    const current = await readEmployeeRecord(company);
    const snapshots = normalizeEmployeeSnapshots(current);
    const id = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    snapshots.push({
      id,
      capturedDate,
      count,
      addedAt: new Date().toISOString()
    });

    return writeEmployeeSnapshots(company, snapshots);
  }

  async function deleteEmployeeSnapshot(company, snapshotId) {
    const current = await readEmployeeRecord(company);
    const snapshots = normalizeEmployeeSnapshots(current).filter((item) => item.id !== snapshotId);
    if (snapshots.length) {
      return writeEmployeeSnapshots(company, snapshots);
    }

    const key = employeeStorageKey(company);
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(key, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(null);
      });
    });
  }

  function recruitStorageKey(company) {
    return `${RECRUIT_STORAGE_PREFIX}${company.type}:${company.id}`;
  }

  function readRecruitRecord(company) {
    const key = recruitStorageKey(company);
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result?.[key] || null);
      });
    });
  }

  function normalizeRecruitArchive(record) {
    if (!Array.isArray(record?.items)) {
      return [];
    }

    const seen = new Set();
    return record.items.filter((item) => {
      const id = normalizeText(item?.id);
      const href = absoluteUrl(item?.href, "https://www.jobkorea.co.kr/");
      const title = normalizeText(item?.title);
      const urlKey = recruitUrlKey(href);
      if (!id || !href || !urlKey || !title || seen.has(urlKey)) {
        return false;
      }
      seen.add(urlKey);
      return true;
    }).map((item) => {
      const context = normalizeText(item.context).slice(0, 800);
      const kinds = recruitKindsFromText(`${item.title || ""} ${context}`);
      return {
        id: normalizeText(item.id),
        href: absoluteUrl(item.href, "https://www.jobkorea.co.kr/"),
        site: item.site === SITE_GAMEJOB || record?.site === SITE_GAMEJOB ? SITE_GAMEJOB : SITE_JOBKOREA,
        title: normalizeText(item.title).slice(0, 220),
        date: /^\d{4}-\d{2}-\d{2}$/.test(item.date || "") ? item.date : null,
        status: normalizeText(item.status).slice(0, 30),
        context,
        isNewHire: Boolean(item.isNewHire) || kinds.isNewHire,
        isExperienced: Boolean(item.isExperienced) || kinds.isExperienced,
        isRegular: Boolean(item.isRegular) || /정규직/.test(context),
        firstSavedAt: item.firstSavedAt || record.savedAt || null,
        lastSavedAt: item.lastSavedAt || record.savedAt || null
      };
    });
  }

  function normalizeRecruitSnapshots(record) {
    if (!Array.isArray(record?.snapshots)) {
      return [];
    }

    const seen = new Set();
    return record.snapshots.filter((snapshot) => {
      if (
        !snapshot ||
        typeof snapshot.id !== "string" ||
        !snapshot.id ||
        snapshot.id.length > 160 ||
        seen.has(snapshot.id) ||
        !validIsoTime(snapshot.capturedAt) ||
        ![snapshot.total, snapshot.active, snapshot.closed, snapshot.missing, snapshot.undatedClosed].every(
          (value) => Number.isSafeInteger(value) && value >= 0 && value <= 9999999
        ) ||
        snapshot.total !== snapshot.active + snapshot.closed ||
        !Array.isArray(snapshot.deadlines) ||
        snapshot.deadlines.length > 2000
      ) {
        return false;
      }

      const deadlineDates = new Set();
      let datedClosed = 0;
      for (const bucket of snapshot.deadlines) {
        if (
          !bucket ||
          !/^\d{4}-\d{2}-\d{2}$/.test(bucket.date || "") ||
          deadlineDates.has(bucket.date) ||
          !Number.isSafeInteger(bucket.count) ||
          bucket.count < 1 ||
          bucket.count > 9999999
        ) {
          return false;
        }
        deadlineDates.add(bucket.date);
        datedClosed += bucket.count;
      }
      if (datedClosed + snapshot.undatedClosed !== snapshot.closed) {
        return false;
      }
      seen.add(snapshot.id);
      return true;
    }).map((snapshot) => ({
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      total: snapshot.total,
      active: snapshot.active,
      closed: snapshot.closed,
      missing: snapshot.missing,
      undatedClosed: snapshot.undatedClosed,
      deadlines: snapshot.deadlines
        .map((bucket) => ({ date: bucket.date, count: bucket.count }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }));
  }

  function formatStorageDate(date) {
    if (!date) {
      return null;
    }
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function archiveItemToRecruitItem(item) {
    const date = item.date ? new Date(`${item.date}T00:00:00`) : null;
    return {
      key: item.id,
      id: item.id,
      title: item.title,
      href: item.href,
      date: date && !Number.isNaN(date.getTime()) ? date : null,
      status: item.status,
      context: item.context,
      isNewHire: item.isNewHire,
      isExperienced: item.isExperienced,
      isRegular: item.isRegular,
      firstSavedAt: item.firstSavedAt,
      lastSavedAt: item.lastSavedAt,
      archivedMissing: true
    };
  }

  function formatSavedTime(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) {
      return "저장 시각 없음";
    }
    return `${[
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join(".")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
  }

  function createRecruitSnapshot(currentItems, missingCount = 0) {
    const closedItems = currentItems.filter(isClosedRecruit);
    const deadlineCounts = new Map();
    let undatedClosed = 0;
    for (const item of closedItems) {
      const date = formatStorageDate(item.date);
      if (date) {
        deadlineCounts.set(date, (deadlineCounts.get(date) || 0) + 1);
      } else {
        undatedClosed += 1;
      }
    }
    return {
      id: typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      capturedAt: new Date().toISOString(),
      total: currentItems.length,
      active: Math.max(0, currentItems.length - closedItems.length),
      closed: closedItems.length,
      missing: Number.isSafeInteger(missingCount) && missingCount >= 0 ? missingCount : 0,
      undatedClosed,
      deadlines: [...deadlineCounts.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date))
    };
  }

  function writeRecruitRecord(company, currentItems, currentRecord, options = {}) {
    const key = recruitStorageKey(company);
    const now = new Date().toISOString();
    const map = new Map(normalizeRecruitArchive(currentRecord).map((item) => [recruitUrlKey(item.href), item]));
    const snapshots = normalizeRecruitSnapshots(currentRecord);

    for (const item of currentItems) {
      const urlKey = recruitUrlKey(item.href);
      if (!urlKey) {
        continue;
      }
      const old = map.get(urlKey);
      map.set(urlKey, {
        id: item.id,
        site: item.site || company.site || SITE_JOBKOREA,
        href: item.href,
        title: item.title,
        date: formatStorageDate(item.date),
        status: item.status || "",
        context: normalizeText(item.context).slice(0, 800),
        isNewHire: item.isNewHire,
        isExperienced: item.isExperienced,
        isRegular: item.isRegular,
        firstSavedAt: old?.firstSavedAt || now,
        lastSavedAt: now
      });
    }

    if (options.addSnapshot && company.site === SITE_JOBKOREA) {
      snapshots.push(createRecruitSnapshot(currentItems, options.missingCount));
    }

    const record = {
      site: company.site || SITE_JOBKOREA,
      companyType: company.type,
      companyId: company.id,
      companyName: company.name,
      items: [...map.values()],
      snapshots,
      savedAt: now
    };

    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: record }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(record);
      });
    });
  }

  async function writeRecruitArchiveState(company, items, snapshots) {
    const key = recruitStorageKey(company);
    if (items.length || snapshots.length) {
      const record = {
        site: company.site || SITE_JOBKOREA,
        companyType: company.type,
        companyId: company.id,
        companyName: company.name,
        items,
        snapshots,
        savedAt: new Date().toISOString()
      };
      await writeStorageValue(key, record);
      return record;
    }

    await new Promise((resolve, reject) => {
      chrome.storage.local.remove(key, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
    return null;
  }

  async function deleteRecruitItems(company, recruitUrls) {
    const current = await readRecruitRecord(company);
    const urls = recruitUrls instanceof Set ? recruitUrls : new Set(recruitUrls || []);
    const items = normalizeRecruitArchive(current).filter((item) => !urls.has(recruitUrlKey(item.href)));
    return writeRecruitArchiveState(company, items, normalizeRecruitSnapshots(current));
  }

  async function deleteRecruitItem(company, recruitUrl) {
    return deleteRecruitItems(company, new Set([recruitUrlKey(recruitUrl)]));
  }

  async function deleteRecruitSnapshot(company, snapshotId) {
    const current = await readRecruitRecord(company);
    const snapshots = normalizeRecruitSnapshots(current)
      .filter((snapshot) => snapshot.id !== snapshotId);
    return writeRecruitArchiveState(company, normalizeRecruitArchive(current), snapshots);
  }

  function postingCountStorageKey(company) {
    return `${POSTING_COUNT_STORAGE_PREFIX}${company.type}:${company.id}`;
  }

  async function readPostingCountRecord(company) {
    return (await readStorageValue(postingCountStorageKey(company))) || null;
  }

  function normalizePostingCountSnapshots(record) {
    if (!Array.isArray(record?.snapshots)) {
      return [];
    }
    const seen = new Set();
    return record.snapshots.filter((snapshot) => {
      if (
        !snapshot ||
        typeof snapshot.id !== "string" ||
        seen.has(snapshot.id) ||
        !validIsoTime(snapshot.capturedAt) ||
        ![snapshot.active, snapshot.closed, snapshot.missing].every(
          (value) => Number.isSafeInteger(value) && value >= 0 && value <= 9999999
        )
      ) {
        return false;
      }
      seen.add(snapshot.id);
      return true;
    }).map((snapshot) => ({
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      active: snapshot.active,
      closed: snapshot.closed,
      missing: snapshot.missing
    }));
  }

  async function writePostingCountSnapshots(company, snapshots) {
    const record = {
      site: company.site || SITE_JOBKOREA,
      companyType: company.type,
      companyId: company.id,
      companyName: company.name,
      snapshots,
      updatedAt: new Date().toISOString()
    };
    await writeStorageValue(postingCountStorageKey(company), record);
    return record;
  }

  async function addPostingCountSnapshot(company, counts) {
    const current = await readPostingCountRecord(company);
    const snapshots = normalizePostingCountSnapshots(current);
    snapshots.push({
      id: typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      capturedAt: new Date().toISOString(),
      active: counts.active,
      closed: counts.closed,
      missing: counts.missing
    });
    return writePostingCountSnapshots(company, snapshots);
  }

  async function deletePostingCountSnapshot(company, snapshotId) {
    const current = await readPostingCountRecord(company);
    const snapshots = normalizePostingCountSnapshots(current)
      .filter((snapshot) => snapshot.id !== snapshotId);
    if (snapshots.length) {
      return writePostingCountSnapshots(company, snapshots);
    }
    await new Promise((resolve, reject) => {
      chrome.storage.local.remove(postingCountStorageKey(company), () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
    return null;
  }

  function storageGetAll() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(null, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result || {});
      });
    });
  }

  function storageSetMany(values) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(values, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  function storageClearAll() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.clear(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  function _hy0(value) {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(_hy0).join(",")}]`;
    }
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${_hy0(value[key])}`).join(",")}}`;
  }

  const _hy1 = new TextEncoder();
  const _hy2 = new TextDecoder("utf-8", { fatal: true });

  function _hy3(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function _hy4(value, shift) {
    return ((value << shift) | (value >>> (8 - shift))) & 255;
  }

  function _hy5(value, shift) {
    return ((value >>> shift) | (value << (8 - shift))) & 255;
  }

  async function _hy6(value) {
    const algorithm = [String.fromCharCode(83, 72, 65), 256].join("-");
    const bytes = typeof value === "string" ? _hy1.encode(value) : value;
    return new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  }

  function _hy7(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function _hy8(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error("기록 데이터 인코딩이 올바르지 않습니다.");
    }
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function _hy9() {
    return String.fromCharCode(
      72, 89, 58, 55, 51, 58, 114, 101, 99, 111, 114, 100, 58, 115, 104, 97, 114, 101, 58, 49
    );
  }

  async function _hyA(label, bytes, binding) {
    const first = await _hy6(_hy3([
      _hy1.encode(_hy9()),
      _hy1.encode(label),
      _hy1.encode(binding),
      bytes
    ]));
    const second = await _hy6(`${binding.length}:${bytes.length}:${_hy9()}:${label}`);
    const output = new Uint8Array(first.length);
    for (let index = 0; index < first.length; index += 1) {
      const mixed = first[index] ^ second[(index * 11 + 7) % second.length] ^
        ((bytes.length + binding.length * 13 + index * 37) & 255);
      output[index] = _hy4(mixed, (index % 7) + 1);
    }
    return _hy7(output);
  }

  async function _hyB(bytes, header, reverse = false) {
    const source = _hy1.encode(`${_hy9()}:${_hy0(header)}`);
    const key = await _hy6(source);
    const output = new Uint8Array(bytes.length);
    const drift = (
      header.companyCount * 17 +
      header.employeeSnapshotCount * 7 +
      header.recruitLinkCount * 11 +
      (header.postingCountSnapshotCount || 0) * 19 +
      (header.recruitSnapshotCount || 0) * 23
    ) & 255;

    for (let index = 0; index < bytes.length; index += 1) {
      const shift = (index % 7) + 1;
      const mask = key[(index * 13 + header.companyCount) % key.length] ^ ((index * 73 + drift) & 255);
      output[index] = reverse ? (_hy5(bytes[index], shift) ^ mask) : _hy4(bytes[index] ^ mask, shift);
    }
    return output;
  }

  async function _hyC(company, formatVersion = RECORD_EXPORT_VERSION) {
    const latest = company.latestEmployeeCount === null ? "x" : String(company.latestEmployeeCount);
    const parts = [
      company.companyName,
      company.savedAt,
      latest,
      company.employeeSnapshotCount,
      company.recruitCount
    ];
    if (formatVersion >= 2) {
      parts.push(company.postingCountSnapshotCount, company.site);
    }
    if (formatVersion >= 3) {
      parts.push(company.recruitSnapshotCount);
    }
    const binding = parts.join("\u001f");
    const seal = await _hyA(String.fromCharCode(67, 51, 49), _hy1.encode(_hy0(company)), binding);
    return `HC1.${seal}`;
  }

  async function _hyD(header, payloadBytes, formatVersion = RECORD_EXPORT_VERSION) {
    const parts = [
      header.exportedAt,
      header.companyCount,
      header.employeeSnapshotCount,
      header.recruitLinkCount
    ];
    if (formatVersion >= 2) {
      parts.push(header.postingCountSnapshotCount);
    }
    if (formatVersion >= 3) {
      parts.push(header.recruitSnapshotCount);
    }
    parts.push(header.codec);
    const binding = parts.join("\u001e");
    const bytes = _hy3([_hy1.encode(_hy0(header)), payloadBytes]);
    const seal = await _hyA(String.fromCharCode(70, 49, 57), bytes, binding);
    return `HY1.${seal}`;
  }

  function storageIdentity(storageKey, prefix) {
    if (!storageKey.startsWith(prefix)) {
      return null;
    }
    const suffix = storageKey.slice(prefix.length);
    const separator = suffix.indexOf(":");
    if (separator <= 0) {
      return null;
    }
    const companyType = suffix.slice(0, separator);
    const companyId = suffix.slice(separator + 1);
    return companyType && companyId ? { companyType, companyId, suffix } : null;
  }

  function latestEmployeeValue(snapshots) {
    if (!snapshots.length) {
      return null;
    }
    const sorted = [...snapshots].sort((a, b) => (
      a.capturedDate.localeCompare(b.capturedDate) ||
      String(a.addedAt || "").localeCompare(String(b.addedAt || ""))
    ));
    return sorted.at(-1).count;
  }

  async function createRecordExport() {
    const stored = await storageGetAll();
    const exportedAt = new Date().toISOString();
    const companyMap = new Map();

    for (const [key, value] of Object.entries(stored)) {
      const employeeIdentity = storageIdentity(key, EMPLOYEE_STORAGE_PREFIX);
      const recruitIdentity = storageIdentity(key, RECRUIT_STORAGE_PREFIX);
      const postingCountIdentity = storageIdentity(key, POSTING_COUNT_STORAGE_PREFIX);
      const identity = employeeIdentity || recruitIdentity || postingCountIdentity;
      if (!identity) {
        continue;
      }
      const entry = companyMap.get(identity.suffix) || {
        companyType: identity.companyType,
        companyId: identity.companyId,
        employeeRecord: null,
        recruitRecord: null,
        postingCountRecord: null
      };
      if (employeeIdentity) {
        entry.employeeRecord = value;
      } else if (recruitIdentity) {
        entry.recruitRecord = value;
      } else {
        entry.postingCountRecord = value;
      }
      companyMap.set(identity.suffix, entry);
    }

    const companies = [];
    for (const entry of companyMap.values()) {
      const employeeSnapshots = normalizeEmployeeSnapshots(entry.employeeRecord)
        .map((snapshot) => ({
          id: snapshot.id,
          capturedDate: snapshot.capturedDate,
          count: snapshot.count,
          addedAt: snapshot.addedAt || null
        }))
        .sort((a, b) => a.capturedDate.localeCompare(b.capturedDate) || a.id.localeCompare(b.id));
      const recruitItems = normalizeRecruitArchive(entry.recruitRecord)
        .sort((a, b) => recruitUrlKey(a.href).localeCompare(recruitUrlKey(b.href)));
      const entrySite = entry.employeeRecord?.site || entry.recruitRecord?.site ||
        entry.postingCountRecord?.site || SITE_JOBKOREA;
      const recruitSnapshots = normalizeRecruitSnapshots(entry.recruitRecord)
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
      const postingCountSnapshots = entrySite === SITE_GAMEJOB
        ? normalizePostingCountSnapshots(entry.postingCountRecord)
          .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id))
        : [];
      if (
        !employeeSnapshots.length &&
        !recruitItems.length &&
        !recruitSnapshots.length &&
        !postingCountSnapshots.length
      ) {
        continue;
      }

      const savedTimes = [
        entry.employeeRecord?.updatedAt,
        entry.recruitRecord?.savedAt,
        entry.postingCountRecord?.updatedAt
      ].filter((value) => typeof value === "string" && !Number.isNaN(Date.parse(value)));
      const company = {
        site: entrySite,
        companyType: entry.companyType,
        companyId: entry.companyId,
        companyName: normalizeText(
          entry.employeeRecord?.companyName || entry.recruitRecord?.companyName ||
          entry.postingCountRecord?.companyName || `회사 ${entry.companyId}`
        ).slice(0, 100),
        savedAt: savedTimes.sort().at(-1) || exportedAt,
        latestEmployeeCount: latestEmployeeValue(employeeSnapshots),
        employeeSnapshotCount: employeeSnapshots.length,
        recruitCount: recruitItems.length,
        recruitSnapshotCount: recruitSnapshots.length,
        postingCountSnapshotCount: postingCountSnapshots.length,
        employeeSnapshots,
        recruitItems,
        recruitSnapshots,
        postingCountSnapshots
      };
      companies.push({
        ...company,
        integrity: await _hyC(company)
      });
    }

    companies.sort((a, b) => (
      a.companyType.localeCompare(b.companyType) || a.companyId.localeCompare(b.companyId)
    ));
    if (!companies.length) {
      throw new Error("내보낼 저장 기록이 없습니다.");
    }

    const header = {
      format: RECORD_EXPORT_FORMAT,
      version: RECORD_EXPORT_VERSION,
      codec: RECORD_EXPORT_CODEC,
      exportedAt,
      companyCount: companies.length,
      employeeSnapshotCount: companies.reduce((sum, company) => sum + company.employeeSnapshotCount, 0),
      recruitLinkCount: companies.reduce((sum, company) => sum + company.recruitCount, 0),
      postingCountSnapshotCount: companies.reduce(
        (sum, company) => sum + company.postingCountSnapshotCount,
        0
      ),
      recruitSnapshotCount: companies.reduce(
        (sum, company) => sum + company.recruitSnapshotCount,
        0
      )
    };
    const payloadBytes = _hy1.encode(_hy0({ schema: "hayoung-share/v3", companies }));
    const hiddenPayload = await _hyB(payloadBytes, header);

    return {
      ...header,
      payload: _hy7(hiddenPayload),
      integrity: await _hyD(header, payloadBytes)
    };
  }

  function validIsoTime(value) {
    return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
  }

  function validRecruitUrl(value, site) {
    const identity = recruitIdentityFromUrl(value, value);
    return Boolean(identity && identity.site === site);
  }

  async function validateImportedCompany(rawCompany, formatVersion = RECORD_EXPORT_VERSION) {
    if (!rawCompany || typeof rawCompany !== "object" || Array.isArray(rawCompany)) {
      throw new Error("회사 기록 형식이 올바르지 않습니다.");
    }
    const { integrity, ...company } = rawCompany;
    if (integrity !== await _hyC(company, formatVersion)) {
      throw new Error(`변조 처리: ${normalizeText(company.companyName) || "알 수 없는 회사"} 기록의 검증값이 맞지 않습니다.`);
    }
    if (
      (formatVersion === 1 ? company.site !== SITE_JOBKOREA : ![SITE_JOBKOREA, SITE_GAMEJOB].includes(company.site)) ||
      !/^[a-z0-9_-]{1,24}$/i.test(company.companyType || "") ||
      !/^\d{1,20}$/.test(company.companyId || "") ||
      !isUsefulCompanyName(company.companyName) ||
      !validIsoTime(company.savedAt) ||
      !Array.isArray(company.employeeSnapshots) ||
      !Array.isArray(company.recruitItems) ||
      (formatVersion >= 2 && !Array.isArray(company.postingCountSnapshots)) ||
      (formatVersion >= 3 && !Array.isArray(company.recruitSnapshots)) ||
      !Number.isSafeInteger(company.employeeSnapshotCount) ||
      !Number.isSafeInteger(company.recruitCount) ||
      (formatVersion >= 2 && !Number.isSafeInteger(company.postingCountSnapshotCount)) ||
      (formatVersion >= 3 && !Number.isSafeInteger(company.recruitSnapshotCount)) ||
      company.employeeSnapshotCount !== company.employeeSnapshots.length ||
      company.recruitCount !== company.recruitItems.length ||
      (formatVersion >= 2 && company.postingCountSnapshotCount !== company.postingCountSnapshots.length) ||
      (formatVersion >= 3 && company.recruitSnapshotCount !== company.recruitSnapshots.length)
    ) {
      throw new Error("변조 처리: 회사명·저장시각·기록 수가 유효하지 않습니다.");
    }

    const employeeSnapshots = company.employeeSnapshots.map((snapshot) => {
      if (
        !snapshot ||
        typeof snapshot.id !== "string" ||
        snapshot.id.length < 1 ||
        snapshot.id.length > 160 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.capturedDate || "") ||
        !Number.isSafeInteger(snapshot.count) ||
        snapshot.count < 0 ||
        snapshot.count > 9999999 ||
        (snapshot.addedAt !== null && !validIsoTime(snapshot.addedAt))
      ) {
        throw new Error(`변조 처리: ${company.companyName}의 직원수 기록이 유효하지 않습니다.`);
      }
      return {
        id: snapshot.id,
        capturedDate: snapshot.capturedDate,
        count: snapshot.count,
        addedAt: snapshot.addedAt || company.savedAt
      };
    });

    const recruitItems = company.recruitItems.map((item) => {
      if (
        !item ||
        !/^\d{1,30}$/.test(item.id || "") ||
        !validRecruitUrl(item.href, company.site) ||
        !normalizeText(item.title) ||
        normalizeText(item.title).length > 220 ||
        (item.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(item.date || "")) ||
        typeof item.isNewHire !== "boolean" ||
        typeof item.isExperienced !== "boolean" ||
        typeof item.isRegular !== "boolean"
      ) {
        throw new Error(`변조 처리: ${company.companyName}의 공고 링크 기록이 유효하지 않습니다.`);
      }
      return {
        id: item.id,
        site: company.site,
        href: item.href,
        title: normalizeText(item.title),
        date: item.date,
        status: normalizeText(item.status).slice(0, 30),
        context: normalizeText(item.context).slice(0, 800),
        isNewHire: item.isNewHire,
        isExperienced: item.isExperienced,
        isRegular: item.isRegular,
        firstSavedAt: validIsoTime(item.firstSavedAt) ? item.firstSavedAt : company.savedAt,
        lastSavedAt: validIsoTime(item.lastSavedAt) ? item.lastSavedAt : company.savedAt
      };
    });

    const recruitSnapshots = (formatVersion >= 3 ? company.recruitSnapshots : []).map((snapshot) => {
      const normalized = normalizeRecruitSnapshots({ snapshots: [snapshot] });
      if (normalized.length !== 1) {
        throw new Error(`변조 처리: ${company.companyName}의 공고 저장 그래프가 유효하지 않습니다.`);
      }
      return normalized[0];
    });

    const postingCountSnapshots = (formatVersion >= 2 ? company.postingCountSnapshots : []).map((snapshot) => {
      if (
        !snapshot ||
        typeof snapshot.id !== "string" ||
        snapshot.id.length < 1 ||
        snapshot.id.length > 160 ||
        !validIsoTime(snapshot.capturedAt) ||
        ![snapshot.active, snapshot.closed, snapshot.missing].every(
          (value) => Number.isSafeInteger(value) && value >= 0 && value <= 9999999
        )
      ) {
        throw new Error(`변조 처리: ${company.companyName}의 공고 수 기록이 유효하지 않습니다.`);
      }
      return {
        id: snapshot.id,
        capturedAt: snapshot.capturedAt,
        active: snapshot.active,
        closed: snapshot.closed,
        missing: snapshot.missing
      };
    });

    if (latestEmployeeValue(employeeSnapshots) !== company.latestEmployeeCount) {
      throw new Error(`변조 처리: ${company.companyName}의 인원 값이 검증 정보와 다릅니다.`);
    }

    return {
      ...company,
      postingCountSnapshotCount: formatVersion >= 2 ? company.postingCountSnapshotCount : 0,
      recruitSnapshotCount: formatVersion >= 3 ? company.recruitSnapshotCount : 0,
      employeeSnapshots,
      recruitItems,
      recruitSnapshots,
      postingCountSnapshots
    };
  }

  async function readRecordExport(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Hayoung 기록 JSON이 아닙니다.");
    }
    const formatVersion = value.version === 1 && value.codec === "hy-xor-shift-v1"
      ? 1
      : value.version === 2 && value.codec === "hy-xor-shift-v2"
        ? 2
        : value.version === RECORD_EXPORT_VERSION && value.codec === RECORD_EXPORT_CODEC
          ? RECORD_EXPORT_VERSION
          : 0;
    const header = {
      format: value.format,
      version: value.version,
      codec: value.codec,
      exportedAt: value.exportedAt,
      companyCount: value.companyCount,
      employeeSnapshotCount: value.employeeSnapshotCount,
      recruitLinkCount: value.recruitLinkCount
    };
    if (formatVersion >= 2) {
      header.postingCountSnapshotCount = value.postingCountSnapshotCount;
    }
    if (formatVersion >= 3) {
      header.recruitSnapshotCount = value.recruitSnapshotCount;
    }
    if (
      header.format !== RECORD_EXPORT_FORMAT ||
      !formatVersion ||
      !validIsoTime(header.exportedAt) ||
      !Number.isSafeInteger(header.companyCount) ||
      !Number.isSafeInteger(header.employeeSnapshotCount) ||
      !Number.isSafeInteger(header.recruitLinkCount) ||
      (formatVersion >= 2 && !Number.isSafeInteger(header.postingCountSnapshotCount)) ||
      (formatVersion >= 3 && !Number.isSafeInteger(header.recruitSnapshotCount)) ||
      header.companyCount < 1 ||
      header.companyCount > 10000 ||
      header.employeeSnapshotCount < 0 ||
      header.recruitLinkCount < 0 ||
      (formatVersion >= 2 && header.postingCountSnapshotCount < 0) ||
      (formatVersion >= 3 && header.recruitSnapshotCount < 0)
    ) {
      throw new Error("Hayoung 기록 파일의 머리말이 올바르지 않습니다.");
    }

    let payloadBytes;
    try {
      payloadBytes = await _hyB(_hy8(value.payload), header, true);
    } catch (error) {
      throw new Error(`변조 처리: 기록 데이터를 해석할 수 없습니다. ${error.message || error}`);
    }
    if (value.integrity !== await _hyD(header, payloadBytes, formatVersion)) {
      throw new Error("변조 처리: 회사명·저장시각·인원·공고 수 또는 기록 내용이 변경되었습니다.");
    }

    let payload;
    try {
      payload = JSON.parse(_hy2.decode(payloadBytes));
    } catch {
      throw new Error("변조 처리: 검증된 기록 데이터를 JSON으로 해석할 수 없습니다.");
    }
    const expectedSchema = `hayoung-share/v${formatVersion}`;
    if (payload?.schema !== expectedSchema || !Array.isArray(payload.companies)) {
      throw new Error("Hayoung 공유 기록 구조가 올바르지 않습니다.");
    }
    if (payload.companies.length !== header.companyCount) {
      throw new Error("변조 처리: 저장된 회사 수가 검증 정보와 다릅니다.");
    }

    const companies = [];
    const companyKeys = new Set();
    for (const rawCompany of payload.companies) {
      const company = await validateImportedCompany(rawCompany, formatVersion);
      const key = `${company.companyType}:${company.companyId}`;
      if (companyKeys.has(key)) {
        throw new Error("변조 처리: 동일한 회사 기록이 중복되어 있습니다.");
      }
      companyKeys.add(key);
      companies.push(company);
    }

    const employeeSnapshotCount = companies.reduce(
      (sum, company) => sum + company.employeeSnapshots.length,
      0
    );
    const recruitLinkCount = companies.reduce((sum, company) => sum + company.recruitItems.length, 0);
    const postingCountSnapshotCount = companies.reduce(
      (sum, company) => sum + company.postingCountSnapshots.length,
      0
    );
    const recruitSnapshotCount = companies.reduce(
      (sum, company) => sum + company.recruitSnapshots.length,
      0
    );
    if (
      employeeSnapshotCount !== header.employeeSnapshotCount ||
      recruitLinkCount !== header.recruitLinkCount ||
      (formatVersion >= 2 && postingCountSnapshotCount !== header.postingCountSnapshotCount) ||
      (formatVersion >= 3 && recruitSnapshotCount !== header.recruitSnapshotCount)
    ) {
      throw new Error("변조 처리: 직원수 또는 공고 수가 검증 정보와 다릅니다.");
    }
    return { header, companies };
  }

  async function mergeImportedCompanies(companies) {
    const stored = await storageGetAll();
    const updates = {};
    const now = new Date().toISOString();
    let addedEmployeeSnapshots = 0;
    let addedRecruitLinks = 0;
    let addedRecruitSnapshots = 0;
    let addedPostingCountSnapshots = 0;

    for (const company of companies) {
      const employeeKey = `${EMPLOYEE_STORAGE_PREFIX}${company.companyType}:${company.companyId}`;
      const recruitKey = `${RECRUIT_STORAGE_PREFIX}${company.companyType}:${company.companyId}`;
      const postingCountKey = `${POSTING_COUNT_STORAGE_PREFIX}${company.companyType}:${company.companyId}`;
      const currentEmployeeRecord = stored[employeeKey] || null;
      const currentRecruitRecord = stored[recruitKey] || null;
      const currentPostingCountRecord = stored[postingCountKey] || null;
      const snapshots = normalizeEmployeeSnapshots(currentEmployeeRecord);
      const snapshotFingerprints = new Set(snapshots.map((snapshot) => (
        `${snapshot.capturedDate}|${snapshot.count}|${snapshot.addedAt || ""}`
      )));
      const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.id));

      for (const imported of company.employeeSnapshots) {
        const fingerprint = `${imported.capturedDate}|${imported.count}|${imported.addedAt || ""}`;
        if (snapshotFingerprints.has(fingerprint)) {
          continue;
        }
        let id = imported.id;
        if (snapshotIds.has(id)) {
          id = typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
        snapshots.push({ ...imported, id });
        snapshotFingerprints.add(fingerprint);
        snapshotIds.add(id);
        addedEmployeeSnapshots += 1;
      }

      if (snapshots.length) {
        updates[employeeKey] = {
          site: company.site,
          companyType: company.companyType,
          companyId: company.companyId,
          companyName: currentEmployeeRecord?.companyName || company.companyName,
          snapshots,
          updatedAt: now
        };
      }

      const recruitMap = new Map(
        normalizeRecruitArchive(currentRecruitRecord).map((item) => [recruitUrlKey(item.href), item])
      );
      for (const imported of company.recruitItems) {
        const urlKey = recruitUrlKey(imported.href);
        if (urlKey && !recruitMap.has(urlKey)) {
          recruitMap.set(urlKey, imported);
          addedRecruitLinks += 1;
        }
      }
      const recruitSnapshots = normalizeRecruitSnapshots(currentRecruitRecord);
      const recruitSnapshotFingerprints = new Set(recruitSnapshots.map((snapshot) => (
        `${snapshot.capturedAt}|${snapshot.total}|${snapshot.active}|${snapshot.closed}|` +
        `${snapshot.missing}|${snapshot.undatedClosed}|${_hy0(snapshot.deadlines)}`
      )));
      const recruitSnapshotIds = new Set(recruitSnapshots.map((snapshot) => snapshot.id));
      for (const imported of company.recruitSnapshots) {
        const fingerprint = `${imported.capturedAt}|${imported.total}|${imported.active}|${imported.closed}|` +
          `${imported.missing}|${imported.undatedClosed}|${_hy0(imported.deadlines)}`;
        if (recruitSnapshotFingerprints.has(fingerprint)) {
          continue;
        }
        let id = imported.id;
        if (recruitSnapshotIds.has(id)) {
          id = typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `import-recruit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
        recruitSnapshots.push({ ...imported, id });
        recruitSnapshotFingerprints.add(fingerprint);
        recruitSnapshotIds.add(id);
        addedRecruitSnapshots += 1;
      }
      if (recruitMap.size || recruitSnapshots.length) {
        updates[recruitKey] = {
          site: company.site,
          companyType: company.companyType,
          companyId: company.companyId,
          companyName: currentRecruitRecord?.companyName || company.companyName,
          items: [...recruitMap.values()],
          snapshots: recruitSnapshots,
          savedAt: now
        };
      }

      const postingCountSnapshots = normalizePostingCountSnapshots(currentPostingCountRecord);
      const postingCountFingerprints = new Set(postingCountSnapshots.map((snapshot) => (
        `${snapshot.capturedAt}|${snapshot.active}|${snapshot.closed}|${snapshot.missing}`
      )));
      const postingCountIds = new Set(postingCountSnapshots.map((snapshot) => snapshot.id));
      for (const imported of company.postingCountSnapshots) {
        const fingerprint = `${imported.capturedAt}|${imported.active}|${imported.closed}|${imported.missing}`;
        if (postingCountFingerprints.has(fingerprint)) {
          continue;
        }
        let id = imported.id;
        if (postingCountIds.has(id)) {
          id = typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `import-count-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
        postingCountSnapshots.push({ ...imported, id });
        postingCountFingerprints.add(fingerprint);
        postingCountIds.add(id);
        addedPostingCountSnapshots += 1;
      }
      if (postingCountSnapshots.length) {
        updates[postingCountKey] = {
          site: company.site,
          companyType: company.companyType,
          companyId: company.companyId,
          companyName: currentPostingCountRecord?.companyName || company.companyName,
          snapshots: postingCountSnapshots,
          updatedAt: now
        };
      }
    }

    if (Object.keys(updates).length) {
      await storageSetMany(updates);
    }
    return {
      addedEmployeeSnapshots,
      addedRecruitLinks,
      addedRecruitSnapshots,
      addedPostingCountSnapshots
    };
  }

  function setTransferStatus(message, type = "") {
    const status = document.getElementById("jk-helper-transfer-status");
    if (!status) {
      return;
    }
    status.textContent = message;
    status.classList.toggle("jk-helper-transfer-error", type === "error");
    status.classList.toggle("jk-helper-transfer-success", type === "success");
  }

  async function exportStoredRecords() {
    const exportButton = document.getElementById("jk-helper-export-records");
    if (exportButton) {
      exportButton.disabled = true;
    }
    setTransferStatus("검증값을 계산하는 중...");
    try {
      const exported = await createRecordExport();
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const download = document.createElement("a");
      const stamp = exported.exportedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
      download.href = url;
      download.download = `hayoung-records-${stamp}.json`;
      download.style.display = "none";
      document.documentElement.appendChild(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferStatus(
        `${exported.companyCount}개 회사 · 직원수 ${exported.employeeSnapshotCount}건 · ` +
        `저장 공고 ${exported.recruitLinkCount}건 · 마감일 그래프 ${exported.recruitSnapshotCount}개 · ` +
        `게임잡 공고 수 ${exported.postingCountSnapshotCount}건 내보냄`,
        "success"
      );
    } catch (error) {
      setTransferStatus(error.message || String(error), "error");
    } finally {
      if (exportButton) {
        exportButton.disabled = false;
      }
    }
  }

  async function importStoredRecords(file) {
    const importButton = document.getElementById("jk-helper-import-records");
    if (!file) {
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setTransferStatus("불러오기 실패: 파일이 20MB를 초과합니다.", "error");
      return;
    }
    if (importButton) {
      importButton.disabled = true;
    }
    setTransferStatus("검증값을 대조하는 중...");
    try {
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error("변조 처리: JSON 구조가 손상되었거나 Hayoung 기록 파일이 아닙니다.");
      }
      const imported = await readRecordExport(parsed);
      const merged = await mergeImportedCompanies(imported.companies);
      setTransferStatus(
        `검증 완료 · 직원수 ${merged.addedEmployeeSnapshots}건 · 저장 공고 ${merged.addedRecruitLinks}건 · ` +
        `마감일 그래프 ${merged.addedRecruitSnapshots}개 · 게임잡 공고 수 ${merged.addedPostingCountSnapshots}건 추가`,
        "success"
      );
      if (state.company) {
        state.loaded = false;
        await loadCompanyData();
      }
    } catch (error) {
      setTransferStatus(error.message || `변조 처리: ${String(error)}`, "error");
    } finally {
      if (importButton) {
        importButton.disabled = false;
      }
    }
  }

  async function factoryReset() {
    const button = document.getElementById("jk-helper-factory-reset");
    const confirmed = window.confirm(
      "Hayoung의 모든 저장 공고·인원 기록·그래프와 UI 설정을 삭제하고 공장 초기화할까요?\n삭제한 데이터는 복구할 수 없습니다."
    );
    if (!confirmed) {
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = "초기화 중...";
    }
    try {
      await storageClearAll();
      setTransferStatus("모든 Hayoung 저장 데이터와 설정을 삭제했습니다.", "success");
      setTimeout(() => location.reload(), 300);
    } catch (error) {
      setTransferStatus(`공장 초기화 실패: ${error.message || error}`, "error");
      if (button) {
        button.disabled = false;
        button.textContent = "공장 초기화";
      }
    }
  }

  function todayInputValue() {
    const today = new Date();
    return [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0")
    ].join("-");
  }

  function readStorageValue(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result?.[key]);
      });
    });
  }

  function writeStorageValue(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
  }

  function clampNumber(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
  }

  function setImportantStyle(element, property, value) {
    element?.style.setProperty(property, value, "important");
  }

  function panelSizeLimits() {
    const maximumWidth = Math.max(240, window.innerWidth - (UI_VIEWPORT_MARGIN * 2));
    const maximumHeight = Math.max(240, window.innerHeight - (UI_VIEWPORT_MARGIN * 2));
    return {
      minimumWidth: Math.min(UI_PANEL_MIN_WIDTH, maximumWidth),
      minimumHeight: Math.min(UI_PANEL_MIN_HEIGHT, maximumHeight),
      maximumWidth,
      maximumHeight
    };
  }

  function updatePanelLayoutMode(panel = document.getElementById(PANEL_ID)) {
    if (!panel) {
      return;
    }
    const single = state.uiLayout.layoutMode === UI_LAYOUT_SINGLE;
    panel.classList.toggle("jk-helper-single-layout", single);
    panel.classList.toggle("jk-helper-split-layout", !single);
    const toggle = document.getElementById("jk-helper-layout-toggle");
    if (toggle) {
      toggle.textContent = single ? "1열" : "2열";
      toggle.title = single ? "2열 화면으로 전환" : "1열 화면으로 전환";
      toggle.setAttribute("aria-label", toggle.title);
      toggle.setAttribute("aria-pressed", String(single));
    }
  }

  function normalizeModuleOrder(value) {
    const result = [];
    for (const id of Array.isArray(value) ? value : []) {
      if (LEFT_MODULE_DEFAULT_ORDER.includes(id) && !result.includes(id)) {
        result.push(id);
      }
    }
    for (const id of LEFT_MODULE_DEFAULT_ORDER) {
      if (!result.includes(id)) {
        result.push(id);
      }
    }
    return result;
  }

  function applyLeftModuleLayout() {
    state.uiLayout.moduleOrder = normalizeModuleOrder(state.uiLayout.moduleOrder);
    const orderById = new Map(state.uiLayout.moduleOrder.map((id, index) => [id, index]));
    for (const module of document.querySelectorAll("[data-jk-module-id]")) {
      const id = module.dataset.jkModuleId;
      module.style.setProperty("order", String(orderById.get(id) ?? LEFT_MODULE_DEFAULT_ORDER.length));
      if (module instanceof HTMLDetailsElement) {
        const savedOpen = state.uiLayout.moduleOpen?.[id];
        if (typeof savedOpen === "boolean" && module.open !== savedOpen) {
          module.open = savedOpen;
        }
      }
    }
  }

  function registerLeftModule(module, id, defaultOpen = true) {
    if (!(module instanceof HTMLElement) || !LEFT_MODULE_DEFAULT_ORDER.includes(id)) {
      return;
    }
    module.dataset.jkModuleId = id;
    module.classList.add("jk-helper-movable-module");
    state.uiLayout.moduleOrder = normalizeModuleOrder(state.uiLayout.moduleOrder);
    module.style.setProperty("order", String(state.uiLayout.moduleOrder.indexOf(id)));
    if (module instanceof HTMLDetailsElement) {
      const hasStoredState = typeof state.uiLayout.moduleOpen?.[id] === "boolean";
      module.open = hasStoredState ? state.uiLayout.moduleOpen[id] : defaultOpen;
      module.addEventListener("toggle", () => {
        state.uiLayout.moduleOpen[id] = module.open;
        void saveUiLayout();
      });
    }

    const summary = module.querySelector(":scope > summary, :scope > .jk-helper-section-title");
    if (summary && !summary.querySelector(".jk-helper-module-drag-handle")) {
      const handle = document.createElement("span");
      handle.className = "jk-helper-module-drag-handle";
      handle.setAttribute("role", "button");
      handle.setAttribute("tabindex", "0");
      handle.setAttribute("draggable", "true");
      handle.setAttribute("aria-label", "카드 순서 이동");
      handle.title = "드래그하여 카드 순서 이동";
      handle.textContent = "⋮⋮";
      const indicator = summary.querySelector(".jk-helper-collapse-indicator");
      summary.insertBefore(handle, indicator || null);
      for (const eventName of ["pointerdown", "click"]) {
        handle.addEventListener(eventName, (event) => event.stopPropagation());
      }
      handle.addEventListener("keydown", (event) => {
        if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) {
          return;
        }
        const order = normalizeModuleOrder(state.uiLayout.moduleOrder);
        const index = order.indexOf(id);
        const nextIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
        if (index < 0 || nextIndex < 0 || nextIndex >= order.length) {
          return;
        }
        [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
        state.uiLayout.moduleOrder = order;
        applyLeftModuleLayout();
        void saveUiLayout();
        event.preventDefault();
        event.stopPropagation();
      });
    }
    applyLeftModuleLayout();
  }

  function enableModuleReordering(root) {
    const column = root.querySelector(".jk-helper-left-column");
    if (!column) {
      return;
    }
    let draggedId = null;
    let orderChanged = false;

    column.addEventListener("dragstart", (event) => {
      const handle = event.target instanceof Element
        ? event.target.closest(".jk-helper-module-drag-handle")
        : null;
      const module = handle?.closest("[data-jk-module-id]");
      if (!handle || !module) {
        return;
      }
      draggedId = module.dataset.jkModuleId;
      orderChanged = false;
      module.classList.add("jk-helper-module-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedId);
      }
    });

    column.addEventListener("dragover", (event) => {
      if (!draggedId) {
        return;
      }
      const target = event.target instanceof Element
        ? event.target.closest("[data-jk-module-id]")
        : null;
      const targetId = target?.dataset.jkModuleId;
      if (!target || !targetId || targetId === draggedId) {
        event.preventDefault();
        return;
      }
      const order = normalizeModuleOrder(state.uiLayout.moduleOrder);
      const fromIndex = order.indexOf(draggedId);
      if (fromIndex < 0) {
        return;
      }
      order.splice(fromIndex, 1);
      const targetIndex = order.indexOf(targetId);
      const before = event.clientY < target.getBoundingClientRect().top + (target.getBoundingClientRect().height / 2);
      order.splice(Math.max(0, targetIndex + (before ? 0 : 1)), 0, draggedId);
      state.uiLayout.moduleOrder = order;
      orderChanged = true;
      applyLeftModuleLayout();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      event.preventDefault();
    });

    const finish = () => {
      if (!draggedId) {
        return;
      }
      document.querySelector(`[data-jk-module-id="${draggedId}"]`)?.classList.remove("jk-helper-module-dragging");
      draggedId = null;
      if (orderChanged) {
        void saveUiLayout();
      }
      orderChanged = false;
    };
    column.addEventListener("drop", (event) => {
      if (draggedId) {
        event.preventDefault();
      }
      finish();
    });
    column.addEventListener("dragend", finish);
  }

  function setPanelLayoutMode(mode, persist = true) {
    state.uiLayout.layoutMode = mode === UI_LAYOUT_SINGLE ? UI_LAYOUT_SINGLE : UI_LAYOUT_SPLIT;
    updatePanelLayoutMode();
    placePanel();
    if (persist) {
      void saveUiLayout();
    }
  }

  function applyPanelSize(width, height) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }
    const limits = panelSizeLimits();
    const nextWidth = clampNumber(Number(width) || 680, limits.minimumWidth, limits.maximumWidth);
    const fallbackHeight = Math.min(680, limits.maximumHeight);
    const nextHeight = clampNumber(Number(height) || fallbackHeight, limits.minimumHeight, limits.maximumHeight);
    state.uiLayout.panelWidth = Math.round(nextWidth);
    state.uiLayout.panelHeight = Math.round(nextHeight);
    setImportantStyle(panel, "width", `${state.uiLayout.panelWidth}px`);
    setImportantStyle(panel, "height", `${state.uiLayout.panelHeight}px`);
    updatePanelLayoutMode(panel);
  }

  function applyLauncherPosition(x, y) {
    const root = document.getElementById(ROOT_ID);
    const launcher = document.getElementById("jk-helper-launcher");
    if (!root || !launcher) {
      return;
    }
    const launcherRect = launcher.getBoundingClientRect();
    const nextX = clampNumber(Number(x) || 0, UI_VIEWPORT_MARGIN, window.innerWidth - launcherRect.width - UI_VIEWPORT_MARGIN);
    const nextY = clampNumber(Number(y) || 0, UI_VIEWPORT_MARGIN, window.innerHeight - launcherRect.height - UI_VIEWPORT_MARGIN);
    state.uiLayout.launcherX = Math.round(nextX);
    state.uiLayout.launcherY = Math.round(nextY);
    setImportantStyle(root, "left", `${state.uiLayout.launcherX}px`);
    setImportantStyle(root, "top", `${state.uiLayout.launcherY}px`);
    setImportantStyle(root, "right", "auto");
    setImportantStyle(root, "bottom", "auto");
  }

  function defaultLauncherPosition(launcher) {
    const rect = launcher.getBoundingClientRect();
    const edge = window.innerWidth <= 760 ? UI_LAUNCHER_MOBILE_EDGE : UI_LAUNCHER_DESKTOP_EDGE;
    return {
      x: Math.max(UI_VIEWPORT_MARGIN, window.innerWidth - rect.width - edge),
      y: Math.max(UI_VIEWPORT_MARGIN, window.innerHeight - rect.height - edge)
    };
  }

  function hasStoredCoordinate(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function resolveStoredLauncherPosition(saved, fallback) {
    const hasCoordinates = hasStoredCoordinate(saved?.launcherX) &&
      hasStoredCoordinate(saved?.launcherY);
    const explicitlySaved = saved?.launcherPositionSaved === true;
    const legacyLeftEdgeBug = hasCoordinates &&
      !explicitlySaved &&
      Number(saved.launcherX) <= UI_VIEWPORT_MARGIN + 1;
    const useSavedPosition = hasCoordinates && !legacyLeftEdgeBug;
    return {
      x: useSavedPosition ? Number(saved.launcherX) : fallback.x,
      y: useSavedPosition ? Number(saved.launcherY) : fallback.y,
      shouldPersist: !explicitlySaved || !hasCoordinates || legacyLeftEdgeBug
    };
  }

  function placePanel() {
    const panel = document.getElementById(PANEL_ID);
    const launcher = document.getElementById("jk-helper-launcher");
    if (!panel || !launcher || !panel.classList.contains("jk-helper-open")) {
      return;
    }

    const launcherRect = launcher.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const maximumLeft = window.innerWidth - panelRect.width - UI_VIEWPORT_MARGIN;
    const maximumTop = window.innerHeight - panelRect.height - UI_VIEWPORT_MARGIN;
    const hasSavedPosition = Number.isFinite(state.uiLayout.panelX) && Number.isFinite(state.uiLayout.panelY);
    const spaceAbove = launcherRect.top - UI_VIEWPORT_MARGIN - UI_PANEL_GAP;
    const spaceBelow = window.innerHeight - launcherRect.bottom - UI_VIEWPORT_MARGIN - UI_PANEL_GAP;
    const openAbove = spaceAbove >= panelRect.height || spaceAbove >= spaceBelow;
    const desiredLeft = hasSavedPosition
      ? state.uiLayout.panelX
      : launcherRect.left + panelRect.width <= window.innerWidth - UI_VIEWPORT_MARGIN
        ? launcherRect.left
        : launcherRect.right - panelRect.width;
    const desiredTop = hasSavedPosition
      ? state.uiLayout.panelY
      : openAbove
        ? launcherRect.top - panelRect.height - UI_PANEL_GAP
        : launcherRect.bottom + UI_PANEL_GAP;

    if (hasSavedPosition) {
      state.uiLayout.panelX = Math.round(clampNumber(desiredLeft, UI_VIEWPORT_MARGIN, maximumLeft));
      state.uiLayout.panelY = Math.round(clampNumber(desiredTop, UI_VIEWPORT_MARGIN, maximumTop));
    }

    setImportantStyle(panel, "left", `${Math.round(clampNumber(desiredLeft, UI_VIEWPORT_MARGIN, maximumLeft))}px`);
    setImportantStyle(panel, "top", `${Math.round(clampNumber(desiredTop, UI_VIEWPORT_MARGIN, maximumTop))}px`);
    setImportantStyle(panel, "right", "auto");
    setImportantStyle(panel, "bottom", "auto");
  }

  async function saveUiLayout() {
    try {
      await writeStorageValue(UI_LAYOUT_STORAGE_KEY, {
        launcherX: state.uiLayout.launcherX,
        launcherY: state.uiLayout.launcherY,
        launcherPositionSaved: state.uiLayout.launcherPositionSaved,
        panelX: state.uiLayout.panelX,
        panelY: state.uiLayout.panelY,
        panelWidth: state.uiLayout.panelWidth,
        panelHeight: state.uiLayout.panelHeight,
        panelOpen: true,
        layoutMode: state.uiLayout.layoutMode,
        moduleOrder: normalizeModuleOrder(state.uiLayout.moduleOrder),
        moduleOpen: { ...state.uiLayout.moduleOpen }
      });
    } catch (error) {
      console.warn("[Hayoung] UI layout save failed", error);
    }
  }

  async function restoreUiLayout() {
    const root = document.getElementById(ROOT_ID);
    const launcher = document.getElementById("jk-helper-launcher");
    if (!root || !launcher) {
      return;
    }

    let saved = null;
    try {
      saved = await readStorageValue(UI_LAYOUT_STORAGE_KEY);
    } catch (error) {
      console.warn("[Hayoung] UI layout read failed", error);
    }

    const fallback = defaultLauncherPosition(launcher);
    const restoredLauncher = resolveStoredLauncherPosition(saved, fallback);
    state.uiLayout.launcherPositionSaved = true;
    state.uiLayout.panelX = saved?.panelX !== null && saved?.panelX !== undefined && Number.isFinite(Number(saved.panelX))
      ? Number(saved.panelX)
      : null;
    state.uiLayout.panelY = saved?.panelY !== null && saved?.panelY !== undefined && Number.isFinite(Number(saved.panelY))
      ? Number(saved.panelY)
      : null;
    state.uiLayout.layoutMode = saved?.layoutMode === UI_LAYOUT_SINGLE ? UI_LAYOUT_SINGLE : UI_LAYOUT_SPLIT;
    state.uiLayout.moduleOrder = normalizeModuleOrder(saved?.moduleOrder);
    state.uiLayout.moduleOpen = saved?.moduleOpen && typeof saved.moduleOpen === "object"
      ? Object.fromEntries(
        Object.entries(saved.moduleOpen).filter(
          ([id, open]) => LEFT_MODULE_DEFAULT_ORDER.includes(id) && typeof open === "boolean"
        )
      )
      : {};
    applyLauncherPosition(restoredLauncher.x, restoredLauncher.y);
    applyPanelSize(saved?.panelWidth, saved?.panelHeight);
    applyLeftModuleLayout();
    state.uiLayout.panelOpen = true;
    openPanel(false);
    if (restoredLauncher.shouldPersist) {
      await saveUiLayout();
    }
  }

  function enableFloatingLayout(root) {
    const launcher = root.querySelector("#jk-helper-launcher");
    const panel = root.querySelector(`#${PANEL_ID}`);
    const panelHeader = panel?.querySelector(".jk-helper-header");
    const resizeHandles = [...root.querySelectorAll(".jk-helper-resize-handle")];
    if (!launcher || !panel || !panelHeader || !resizeHandles.length) {
      return;
    }

    let launcherDrag = null;
    let panelDrag = null;
    let panelResize = null;
    let suppressLauncherClick = false;

    launcher.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary) {
        return;
      }
      const rect = launcher.getBoundingClientRect();
      launcherDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        launcherX: rect.left,
        launcherY: rect.top,
        moved: false
      };
      launcher.setPointerCapture?.(event.pointerId);
      launcher.classList.add("jk-helper-dragging");
      event.preventDefault();
    });

    launcher.addEventListener("pointermove", (event) => {
      if (!launcherDrag || event.pointerId !== launcherDrag.pointerId) {
        return;
      }
      const deltaX = event.clientX - launcherDrag.startX;
      const deltaY = event.clientY - launcherDrag.startY;
      if (!launcherDrag.moved && Math.hypot(deltaX, deltaY) < 4) {
        return;
      }
      launcherDrag.moved = true;
      suppressLauncherClick = true;
      applyLauncherPosition(launcherDrag.launcherX + deltaX, launcherDrag.launcherY + deltaY);
      placePanel();
      event.preventDefault();
    });

    const finishLauncherDrag = (event) => {
      if (!launcherDrag || event.pointerId !== launcherDrag.pointerId) {
        return;
      }
      const moved = launcherDrag.moved;
      launcherDrag = null;
      launcher.classList.remove("jk-helper-dragging");
      if (launcher.hasPointerCapture?.(event.pointerId)) {
        launcher.releasePointerCapture(event.pointerId);
      }
      if (moved) {
        state.uiLayout.launcherPositionSaved = true;
        void saveUiLayout();
        setTimeout(() => {
          suppressLauncherClick = false;
        }, 0);
      }
    };

    launcher.addEventListener("pointerup", finishLauncherDrag);
    launcher.addEventListener("pointercancel", finishLauncherDrag);
    launcher.addEventListener("click", (event) => {
      if (suppressLauncherClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      void togglePanel();
    });

    panelHeader.addEventListener("pointerdown", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.button !== 0 ||
        !event.isPrimary ||
        target?.closest("button, a, input, label, select, textarea, [role='button']")
      ) {
        return;
      }
      const rect = panel.getBoundingClientRect();
      panelDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        panelX: rect.left,
        panelY: rect.top,
        moved: false
      };
      panelHeader.setPointerCapture?.(event.pointerId);
      panel.classList.add("jk-helper-panel-dragging");
      event.preventDefault();
    });

    panelHeader.addEventListener("pointermove", (event) => {
      if (!panelDrag || event.pointerId !== panelDrag.pointerId) {
        return;
      }
      const deltaX = event.clientX - panelDrag.startX;
      const deltaY = event.clientY - panelDrag.startY;
      if (!panelDrag.moved && Math.hypot(deltaX, deltaY) < 3) {
        return;
      }
      panelDrag.moved = true;
      const rect = panel.getBoundingClientRect();
      const maximumLeft = window.innerWidth - rect.width - UI_VIEWPORT_MARGIN;
      const maximumTop = window.innerHeight - rect.height - UI_VIEWPORT_MARGIN;
      state.uiLayout.panelX = Math.round(clampNumber(
        panelDrag.panelX + deltaX,
        UI_VIEWPORT_MARGIN,
        maximumLeft
      ));
      state.uiLayout.panelY = Math.round(clampNumber(
        panelDrag.panelY + deltaY,
        UI_VIEWPORT_MARGIN,
        maximumTop
      ));
      setImportantStyle(panel, "left", `${state.uiLayout.panelX}px`);
      setImportantStyle(panel, "top", `${state.uiLayout.panelY}px`);
      setImportantStyle(panel, "right", "auto");
      setImportantStyle(panel, "bottom", "auto");
      event.preventDefault();
    });

    const finishPanelDrag = (event) => {
      if (!panelDrag || event.pointerId !== panelDrag.pointerId) {
        return;
      }
      const moved = panelDrag.moved;
      panelDrag = null;
      panel.classList.remove("jk-helper-panel-dragging");
      if (panelHeader.hasPointerCapture?.(event.pointerId)) {
        panelHeader.releasePointerCapture(event.pointerId);
      }
      if (moved) {
        void saveUiLayout();
      }
    };

    panelHeader.addEventListener("pointerup", finishPanelDrag);
    panelHeader.addEventListener("pointercancel", finishPanelDrag);

    for (const resizeHandle of resizeHandles) {
      resizeHandle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !event.isPrimary) {
          return;
        }
        const rect = panel.getBoundingClientRect();
        panelResize = {
          pointerId: event.pointerId,
          handle: resizeHandle,
          direction: resizeHandle.dataset.resizeDirection || "se",
          startX: event.clientX,
          startY: event.clientY,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
        state.uiLayout.panelX = Math.round(rect.left);
        state.uiLayout.panelY = Math.round(rect.top);
        resizeHandle.setPointerCapture?.(event.pointerId);
        panel.classList.add("jk-helper-resizing");
        event.preventDefault();
        event.stopPropagation();
      });

      resizeHandle.addEventListener("pointermove", (event) => {
        if (!panelResize || panelResize.handle !== resizeHandle || event.pointerId !== panelResize.pointerId) {
          return;
        }
        const limits = panelSizeLimits();
        const deltaX = event.clientX - panelResize.startX;
        const deltaY = event.clientY - panelResize.startY;
        const west = panelResize.direction.includes("w");
        const east = panelResize.direction.includes("e");
        const north = panelResize.direction.includes("n");
        const south = panelResize.direction.includes("s");
        const maximumWidth = west
          ? panelResize.right - UI_VIEWPORT_MARGIN
          : window.innerWidth - panelResize.left - UI_VIEWPORT_MARGIN;
        const maximumHeight = north
          ? panelResize.bottom - UI_VIEWPORT_MARGIN
          : window.innerHeight - panelResize.top - UI_VIEWPORT_MARGIN;
        const nextWidth = clampNumber(
          panelResize.width + (west ? -deltaX : east ? deltaX : 0),
          limits.minimumWidth,
          maximumWidth
        );
        const nextHeight = clampNumber(
          panelResize.height + (north ? -deltaY : south ? deltaY : 0),
          limits.minimumHeight,
          maximumHeight
        );
        const nextLeft = west ? panelResize.right - nextWidth : panelResize.left;
        const nextTop = north ? panelResize.bottom - nextHeight : panelResize.top;
        state.uiLayout.panelWidth = Math.round(nextWidth);
        state.uiLayout.panelHeight = Math.round(nextHeight);
        state.uiLayout.panelX = Math.round(nextLeft);
        state.uiLayout.panelY = Math.round(nextTop);
        setImportantStyle(panel, "left", `${Math.round(nextLeft)}px`);
        setImportantStyle(panel, "top", `${Math.round(nextTop)}px`);
        setImportantStyle(panel, "right", "auto");
        setImportantStyle(panel, "bottom", "auto");
        setImportantStyle(panel, "width", `${state.uiLayout.panelWidth}px`);
        setImportantStyle(panel, "height", `${state.uiLayout.panelHeight}px`);
        event.preventDefault();
      });

      const finishPanelResize = (event) => {
        if (!panelResize || panelResize.handle !== resizeHandle || event.pointerId !== panelResize.pointerId) {
          return;
        }
        panelResize = null;
        panel.classList.remove("jk-helper-resizing");
        if (resizeHandle.hasPointerCapture?.(event.pointerId)) {
          resizeHandle.releasePointerCapture(event.pointerId);
        }
        void saveUiLayout();
      };

      resizeHandle.addEventListener("pointerup", finishPanelResize);
      resizeHandle.addEventListener("pointercancel", finishPanelResize);
    }

    window.addEventListener("resize", () => {
      const launcherRect = launcher.getBoundingClientRect();
      applyLauncherPosition(launcherRect.left, launcherRect.top);
      applyPanelSize(state.uiLayout.panelWidth, state.uiLayout.panelHeight);
      placePanel();
    });
  }

  async function readLoadMode() {
    try {
      const value = await readStorageValue(LOAD_MODE_STORAGE_KEY);
      return value === LOAD_MODE_PRELOAD ? LOAD_MODE_PRELOAD : LOAD_MODE_CLICK;
    } catch (error) {
      console.warn("[Hayoung] load mode read failed", error);
      return LOAD_MODE_CLICK;
    }
  }

  async function readSimpleMode() {
    try {
      return (await readStorageValue(SIMPLE_MODE_STORAGE_KEY)) === true;
    } catch (error) {
      console.warn("[Hayoung] simple mode read failed", error);
      return false;
    }
  }

  async function readFontScale() {
    try {
      const value = Number(await readStorageValue(FONT_SCALE_STORAGE_KEY));
      return FONT_SCALE_STEPS.includes(value) ? value : 1;
    } catch (error) {
      console.warn("[Hayoung] font scale read failed", error);
      return 1;
    }
  }

  function syncFontScaleUi() {
    const scale = FONT_SCALE_STEPS.includes(state.fontScale) ? state.fontScale : 1;
    const root = document.getElementById(ROOT_ID);
    const panel = document.getElementById(PANEL_ID);
    root?.style.setProperty("--jk-helper-font-scale", String(scale));
    panel?.style.setProperty("--jk-helper-font-scale", String(scale));
    for (const baseSize of FONT_BASE_SIZES) {
      const property = `--jk-helper-font-${baseSize}`;
      const scaledSize = `${Number((baseSize * scale).toFixed(2))}px`;
      root?.style.setProperty(property, scaledSize);
      panel?.style.setProperty(property, scaledSize);
    }
    const value = document.getElementById("jk-helper-font-scale-value");
    if (value) {
      value.textContent = `${Math.round(scale * 100)}%`;
    }
    const index = FONT_SCALE_STEPS.indexOf(scale);
    const decrease = document.getElementById("jk-helper-font-scale-down");
    const increase = document.getElementById("jk-helper-font-scale-up");
    if (decrease instanceof HTMLButtonElement) {
      decrease.disabled = index <= 0;
    }
    if (increase instanceof HTMLButtonElement) {
      increase.disabled = index >= FONT_SCALE_STEPS.length - 1;
    }
  }

  async function changeFontScale(direction) {
    const currentIndex = Math.max(0, FONT_SCALE_STEPS.indexOf(state.fontScale));
    const nextIndex = Math.min(
      FONT_SCALE_STEPS.length - 1,
      Math.max(0, currentIndex + direction)
    );
    state.fontScale = FONT_SCALE_STEPS[nextIndex];
    syncFontScaleUi();
    try {
      await writeStorageValue(FONT_SCALE_STORAGE_KEY, state.fontScale);
    } catch (error) {
      console.warn("[Hayoung] font scale save failed", error);
    }
  }

  function applySimpleMode() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }
    panel.classList.toggle("jk-helper-simple-mode", state.simpleMode);
    panel.classList.toggle(
      "jk-helper-gamejob-simple-mode",
      state.simpleMode && currentSite === SITE_GAMEJOB
    );
    panel.classList.toggle(
      "jk-helper-jobkorea-simple-mode",
      state.simpleMode && currentSite === SITE_JOBKOREA
    );
    panel.classList.toggle("jk-helper-force-single-layout", state.simpleMode);
  }

  function syncSimpleModeUi() {
    const toggle = document.getElementById("jk-helper-simple-mode-toggle");
    if (toggle instanceof HTMLInputElement) {
      toggle.checked = state.simpleMode;
      toggle.setAttribute("aria-label", state.simpleMode
        ? "간편 모드 사용 중. 일반 모드로 전환"
        : "일반 모드 사용 중. 간편 모드로 전환");
      toggle.closest(".jk-helper-simple-switch")?.setAttribute(
        "data-simple-mode",
        state.simpleMode ? "enabled" : "disabled"
      );
    }
    applySimpleMode();
  }

  async function changeSimpleMode(enabled) {
    state.simpleMode = Boolean(enabled);
    syncSimpleModeUi();
    try {
      await writeStorageValue(SIMPLE_MODE_STORAGE_KEY, state.simpleMode);
    } catch (error) {
      console.warn("[Hayoung] simple mode save failed", error);
    }
  }

  function syncLoadModeUi() {
    const toggle = document.getElementById("jk-helper-load-toggle");
    if (toggle instanceof HTMLInputElement) {
      const automatic = state.loadMode === LOAD_MODE_PRELOAD;
      toggle.checked = automatic;
      toggle.setAttribute("aria-label", automatic
        ? "자동 불러오기 사용 중. 수동으로 전환"
        : "수동 불러오기 사용 중. 자동으로 전환");
      toggle.closest(".jk-helper-load-switch")?.setAttribute(
        "data-load-mode",
        automatic ? "automatic" : "manual"
      );
    }
    const status = document.getElementById("jk-helper-load-mode-status");
    if (status) {
      if (state.loadMode === LOAD_MODE_PRELOAD) {
        status.textContent = state.loaded
          ? "미리 불러오기 사용 중 · 현재 회사 정보를 불러왔습니다."
          : "미리 불러오기 사용 중 · 회사가 확인되면 바로 불러옵니다.";
      } else {
        status.textContent = state.loaded
          ? "클릭 시 불러오기 사용 중 · 이미 불러온 현재 데이터는 유지되며 다음 공고부터 적용됩니다."
          : "클릭 시 불러오기 사용 중 · 기업 상세는 1회 자동 확인하고 전체 과거 공고는 버튼을 누를 때 불러옵니다.";
      }
    }
  }

  async function changeLoadMode(value) {
    if (value !== LOAD_MODE_PRELOAD && value !== LOAD_MODE_CLICK) {
      return;
    }
    state.loadMode = value;
    if (value === LOAD_MODE_CLICK && !state.loaded) {
      state.loadRequestedThisPage = false;
    }
    syncLoadModeUi();
    try {
      await writeStorageValue(LOAD_MODE_STORAGE_KEY, value);
    } catch (error) {
      console.warn("[Hayoung] load mode save failed", error);
    }

    const badge = document.getElementById("jk-helper-launcher-badge");
    if (badge && !state.loaded) {
      badge.textContent = value === LOAD_MODE_PRELOAD
        ? "미리 확인 중"
        : state.overviewLoaded ? "요약 확인됨 · 클릭해 전체" : "요약 확인 중";
    }
    if (value === LOAD_MODE_PRELOAD && state.company && !state.loaded) {
      await loadCompanyData();
    } else if (
      value === LOAD_MODE_CLICK &&
      state.company &&
      !state.loaded &&
      document.getElementById(PANEL_ID)?.classList.contains("jk-helper-open")
    ) {
      await loadCompanyOverview();
    }
  }

  function compareVersions(left, right) {
    const leftParts = String(left).split(".").map((part) => Number(part) || 0);
    const rightParts = String(right).split(".").map((part) => Number(part) || 0);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      if ((leftParts[index] || 0) !== (rightParts[index] || 0)) {
        return (leftParts[index] || 0) > (rightParts[index] || 0) ? 1 : -1;
      }
    }
    return 0;
  }

  function currentDisplayVersion() {
    const manifest = chrome.runtime.getManifest();
    return manifest.version_name || manifest.version;
  }

  function renderVersionStatus(result) {
    const status = document.getElementById("jk-helper-version-status");
    const updateLink = document.getElementById("jk-helper-version-update");
    if (!status || !updateLink) {
      return;
    }

    const currentVersion = chrome.runtime.getManifest().version;
    const currentVersionName = currentDisplayVersion();
    const remoteVersionName = result?.versionName || result?.version;
    status.classList.remove("jk-helper-version-outdated", "jk-helper-version-error");
    updateLink.classList.add("jk-helper-filter-hidden");
    if (!result?.ok) {
      status.textContent = `현재 v${currentVersionName} · GitHub 버전 확인 실패`;
      status.classList.add("jk-helper-version-error");
      return;
    }

    const comparison = compareVersions(currentVersion, result.version);
    if (comparison < 0) {
      status.textContent = `현재 v${currentVersionName} · 새 버전 v${remoteVersionName}`;
      status.classList.add("jk-helper-version-outdated");
      updateLink.href = result.updateUrl;
      updateLink.classList.remove("jk-helper-filter-hidden");
    } else if (comparison > 0) {
      status.textContent = `현재 v${currentVersionName} · 저장소 v${remoteVersionName}`;
    } else {
      status.textContent = `현재 v${currentVersionName} · 최신 버전`;
    }
  }

  async function checkForUpdates(force = false) {
    const checkButton = document.getElementById("jk-helper-version-check");
    if (checkButton) {
      checkButton.disabled = true;
    }
    try {
      if (!force) {
        const cached = await readStorageValue(VERSION_CACHE_STORAGE_KEY).catch(() => null);
        const localVersion = chrome.runtime.getManifest().version;
        if (
          cached?.checkedAt &&
          cached.localVersion === localVersion &&
          Date.now() - Number(cached.checkedAt) < VERSION_CACHE_MS &&
          (cached.ok === false || /^\d+(?:\.\d+){1,3}$/.test(cached.version || ""))
        ) {
          renderVersionStatus(cached);
          return;
        }
      }

      const response = await chrome.runtime.sendMessage({ type: "HY_CHECK_VERSION" });
      const result = response?.ok
        ? {
          ok: true,
          version: response.version,
          versionName: response.versionName || response.version,
          localVersion: chrome.runtime.getManifest().version,
          updateUrl: response.updateUrl,
          checkedAt: Date.now()
        }
        : {
          ok: false,
          error: response?.error || "버전 확인 실패",
          localVersion: chrome.runtime.getManifest().version,
          checkedAt: Date.now()
        };
      await writeStorageValue(VERSION_CACHE_STORAGE_KEY, result).catch(() => {});
      renderVersionStatus(result);
    } catch (error) {
      renderVersionStatus({ ok: false, error: error?.message || String(error) });
    } finally {
      if (checkButton) {
        checkButton.disabled = false;
      }
    }
  }

  function mountUi() {
    if (document.getElementById(ROOT_ID)) {
      return;
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <button type="button" id="jk-helper-launcher" aria-expanded="true" title="항상 표시됨 · 클릭하여 불러오기 · 드래그하여 이동">
        <span class="jk-helper-launcher-title">과거 기록 보기</span>
        <span id="jk-helper-launcher-badge" class="jk-helper-launcher-badge">확인 중</span>
      </button>
      <section id="${PANEL_ID}" aria-label="Hayoung 기업 채용 기록 도구">
        <header class="jk-helper-header">
          <div class="jk-helper-heading">
            <strong>Hayoung</strong>
            <span>기업 채용 기록 도구</span>
          </div>
          <div class="jk-helper-header-company-tools">
            <label class="jk-helper-simple-switch" data-simple-mode="disabled" title="간편 모드">
              <span class="jk-helper-simple-switch-label">간편 모드</span>
              <input type="checkbox" id="jk-helper-simple-mode-toggle">
              <span class="jk-helper-simple-switch-track" aria-hidden="true"><i></i></span>
            </label>
            <a
              id="jk-helper-header-history-link"
              class="jk-helper-header-detail-link"
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled="true"
            >기업 상세 ↗</a>
            <span id="jk-helper-applicant-count" class="jk-helper-applicant-count jk-helper-filter-hidden">지원자 —</span>
            <label class="jk-helper-load-switch" data-load-mode="manual" title="회사 정보 불러오기 방식">
              <span class="jk-helper-load-switch-label jk-helper-load-switch-manual">수동</span>
              <input type="checkbox" id="jk-helper-load-toggle">
              <span class="jk-helper-load-switch-track" aria-hidden="true"><i></i></span>
              <span class="jk-helper-load-switch-label jk-helper-load-switch-automatic">자동</span>
            </label>
          </div>
          <div class="jk-helper-header-actions">
            <div class="jk-helper-font-scale" aria-label="폰트 크기 조절">
              <button type="button" id="jk-helper-font-scale-down" title="폰트 작게">A−</button>
              <span id="jk-helper-font-scale-value">100%</span>
              <button type="button" id="jk-helper-font-scale-up" title="폰트 크게">A+</button>
            </div>
            <button type="button" id="jk-helper-layout-toggle" class="jk-helper-layout-button" title="1열 화면으로 전환">2열</button>
            <button type="button" id="jk-helper-refresh" class="jk-helper-icon-button" title="새로고침">↻</button>
            <button type="button" id="jk-helper-close" class="jk-helper-close-button" title="창 닫기 · 버튼은 유지" aria-label="Hayoung 창 닫기 · 버튼은 유지">×</button>
          </div>
        </header>
        <div class="jk-helper-columns">
          <div class="jk-helper-left-column">
            <main id="jk-helper-body">
              <div class="jk-helper-loading">공고에서 회사 링크를 찾는 중...</div>
            </main>
            <details class="jk-helper-section jk-helper-details-section jk-helper-collapsible" aria-label="Hayoung 상세정보" open>
              <summary class="jk-helper-section-title">
                <span class="jk-helper-summary-copy">
                  <strong>데이터</strong>
                  <small>JSON 백업·복원</small>
                </span>
                <span class="jk-helper-collapse-indicator" aria-hidden="true">⌄</span>
              </summary>
              <nav class="jk-helper-source-links">
                <div class="jk-helper-transfer-actions">
                  <button type="button" id="jk-helper-export-records">JSON 내보내기</button>
                  <button type="button" id="jk-helper-import-records">JSON 불러오기</button>
                  <input
                    type="file"
                    id="jk-helper-import-file"
                    accept="application/json,.json"
                    class="jk-helper-filter-hidden"
                    aria-label="Hayoung 저장 기록 JSON 선택"
                  >
                </div>
                <span id="jk-helper-transfer-status" class="jk-helper-transfer-status">
                  저장 기록을 백업하거나 복원합니다.
                </span>
              </nav>
            </details>
            <details class="jk-helper-section jk-helper-options jk-helper-collapsible" aria-label="Hayoung 옵션" open>
              <summary class="jk-helper-section-title jk-helper-options-title">
                <span class="jk-helper-summary-copy">
                  <strong>옵션</strong>
                  <small>업데이트·초기화</small>
                </span>
                <span class="jk-helper-collapse-indicator" aria-hidden="true">⌄</span>
              </summary>
              <div class="jk-helper-options-content">
                <span id="jk-helper-load-mode-status" class="jk-helper-load-mode-status"></span>
                <div class="jk-helper-version-row">
                  <span id="jk-helper-version-status">현재 v${currentDisplayVersion()} · GitHub 확인 중</span>
                  <button type="button" id="jk-helper-version-check">다시 확인</button>
                  <a id="jk-helper-version-update" class="jk-helper-filter-hidden" target="_blank" rel="noopener noreferrer">업데이트</a>
                </div>
                <div class="jk-helper-factory-reset-row">
                  <span>모든 저장 기록과 설정을 삭제합니다.</span>
                  <button type="button" id="jk-helper-factory-reset">공장 초기화</button>
                </div>
              </div>
            </details>
          </div>
          <main id="jk-helper-recruit-body" class="jk-helper-recruit-column">
            <div class="jk-helper-loading">과거 공고는 정보를 불러온 뒤 표시됩니다.</div>
          </main>
        </div>
        ${["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((direction) => `
          <button
            type="button"
            class="jk-helper-resize-handle jk-helper-resize-${direction}"
            data-resize-direction="${direction}"
            aria-label="Hayoung 창 ${direction} 방향 크기 조절"
            title="드래그하여 창 크기 조절"
          ></button>
        `).join("")}
      </section>
    `;

    document.documentElement.appendChild(root);

    registerLeftModule(root.querySelector(".jk-helper-details-section"), "details");
    registerLeftModule(root.querySelector(".jk-helper-options"), "options");
    enableModuleReordering(root);
    enableFloatingLayout(root);
    root.querySelector("#jk-helper-layout-toggle").addEventListener("click", () => {
      setPanelLayoutMode(
        state.uiLayout.layoutMode === UI_LAYOUT_SINGLE ? UI_LAYOUT_SPLIT : UI_LAYOUT_SINGLE
      );
    });
    root.querySelector("#jk-helper-refresh").addEventListener("click", refresh);
    root.querySelector("#jk-helper-close").addEventListener("click", closePanel);
    root.querySelector("#jk-helper-version-check").addEventListener("click", () => {
      void checkForUpdates(true);
    });
    root.querySelector("#jk-helper-load-toggle").addEventListener("change", (event) => {
      const input = event.currentTarget;
      void changeLoadMode(input.checked ? LOAD_MODE_PRELOAD : LOAD_MODE_CLICK);
    });
    root.querySelector("#jk-helper-simple-mode-toggle").addEventListener("change", (event) => {
      void changeSimpleMode(event.currentTarget.checked);
    });
    root.querySelector("#jk-helper-font-scale-down").addEventListener("click", () => {
      void changeFontScale(-1);
    });
    root.querySelector("#jk-helper-font-scale-up").addEventListener("click", () => {
      void changeFontScale(1);
    });
    root.querySelector("#jk-helper-export-records").addEventListener("click", () => {
      void exportStoredRecords();
    });
    root.querySelector("#jk-helper-factory-reset").addEventListener("click", () => {
      void factoryReset();
    });
    const importButton = root.querySelector("#jk-helper-import-records");
    const importInput = root.querySelector("#jk-helper-import-file");
    importButton.addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0] || null;
      importInput.value = "";
      void importStoredRecords(file);
    });
    refreshApplicantCountUi();

    const panel = root.querySelector(`#${PANEL_ID}`);
    const columns = root.querySelector(".jk-helper-columns");
    panel.addEventListener("wheel", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!event.deltaY || !(columns instanceof HTMLElement)) {
        return;
      }

      const nestedCandidates = [];
      const nestedSelector = [
        ".jk-helper-record-table-wrap",
        ".jk-helper-recruit-snapshot-picker",
        ".jk-helper-recruit-list"
      ].join(", ");
      for (let element = target; element && element !== panel; element = element.parentElement) {
        if (element instanceof HTMLElement && element.matches(nestedSelector)) {
          nestedCandidates.push(element);
        }
      }
      let column = target?.closest(".jk-helper-left-column, .jk-helper-recruit-column");
      const singleLayout = state.simpleMode || state.uiLayout.layoutMode === UI_LAYOUT_SINGLE;
      if (!column && !singleLayout) {
        const panelRect = panel.getBoundingClientRect();
        const selector = event.clientX < panelRect.left + (panelRect.width / 2)
          ? ".jk-helper-left-column"
          : ".jk-helper-recruit-column";
        column = panel.querySelector(selector);
      }
      const direction = Math.sign(event.deltaY);
      const outerScroller = singleLayout ? columns : column;
      const candidates = [...new Set([...nestedCandidates, outerScroller])];
      for (const scrollTarget of candidates) {
        if (!(scrollTarget instanceof HTMLElement)) {
          continue;
        }
        if (scrollTarget.scrollHeight <= scrollTarget.clientHeight + 1) {
          continue;
        }
        const canMove = direction > 0
          ? scrollTarget.scrollTop + scrollTarget.clientHeight < scrollTarget.scrollHeight - 1
          : scrollTarget.scrollTop > 1;
        if (!canMove) {
          continue;
        }
        const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 24
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? scrollTarget.clientHeight
            : 1;
        const previousScrollTop = scrollTarget.scrollTop;
        scrollTarget.scrollTop += event.deltaY * multiplier;
        if (scrollTarget.scrollTop !== previousScrollTop) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
    }, { capture: true, passive: false });
  }

  function updateCompanyUi(company) {
    const badge = document.getElementById("jk-helper-launcher-badge");
    const historyLink = document.getElementById("jk-helper-header-history-link");

    if (badge) {
      badge.textContent = state.loadMode === LOAD_MODE_PRELOAD ? "미리 확인 중" : "요약 확인 중";
    }
    if (historyLink) {
      historyLink.href = company.profileUrl;
      historyLink.textContent = "기업 상세 ↗";
      historyLink.title = `${company.site === SITE_GAMEJOB ? "게임잡" : "잡코리아"} 기업 상세정보 열기`;
      historyLink.setAttribute("aria-disabled", "false");
    }
    refreshApplicantCountUi();
  }

  function openPanel(persist = true) {
    const panel = document.getElementById(PANEL_ID);
    const launcher = document.getElementById("jk-helper-launcher");
    panel?.classList.add("jk-helper-open");
    launcher?.setAttribute("aria-expanded", "true");
    state.uiLayout.panelOpen = true;
    updatePanelLayoutMode(panel);
    placePanel();
    if (persist) {
      void saveUiLayout();
    }
  }

  async function togglePanel() {
    if (state.disabledForPage) {
      return;
    }
    state.loadRequestedThisPage = true;
    openPanel();
    if (!state.company) {
      detectAndApplyCompany();
    }
    if (state.company && !state.loaded) {
      await loadCompanyData();
    }
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    const launcher = document.getElementById("jk-helper-launcher");
    panel?.classList.remove("jk-helper-open");
    launcher?.setAttribute("aria-expanded", "false");
    state.uiLayout.panelOpen = false;
  }

  function setLoading(message) {
    const body = document.getElementById("jk-helper-body");
    const recruitBody = document.getElementById("jk-helper-recruit-body");
    if (!body) {
      return;
    }

    body.replaceChildren();
    recruitBody?.classList.remove("jk-helper-gamejob-split");
    recruitBody?.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "jk-helper-loading";
    loading.innerHTML = '<span class="jk-helper-spinner"></span>';
    const text = document.createElement("span");
    text.textContent = message;
    loading.appendChild(text);
    body.appendChild(loading);

    if (recruitBody) {
      const recruitLoading = document.createElement("div");
      recruitLoading.className = "jk-helper-loading";
      recruitLoading.textContent = "과거 공고를 불러오는 중...";
      recruitBody.appendChild(recruitLoading);
    }
  }

  function showClickToLoad() {
    if (state.loaded || state.loading) {
      return;
    }
    const body = document.getElementById("jk-helper-body");
    const recruitBody = document.getElementById("jk-helper-recruit-body");
    if (!body || !recruitBody) {
      return;
    }
    body.replaceChildren();
    recruitBody.classList.remove("jk-helper-gamejob-split");
    recruitBody.replaceChildren();

    const prompt = document.createElement("div");
    prompt.className = "jk-helper-click-load-prompt";
    const title = document.createElement("strong");
    title.textContent = "클릭 시 불러오기 설정입니다.";
    const description = document.createElement("span");
    description.textContent = "아래 버튼을 누를 때만 기업 상세정보와 공고 목록을 요청합니다.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jk-helper-click-load-button";
    button.textContent = "기업 정보 불러오기";
    button.addEventListener("click", () => {
      state.loadRequestedThisPage = true;
      void loadCompanyData();
    });
    prompt.append(title, description, button);
    body.appendChild(prompt);

    const recruitPrompt = document.createElement("div");
    recruitPrompt.className = "jk-helper-click-load-prompt jk-helper-click-load-recruit-prompt";
    recruitPrompt.textContent = "기업 정보 불러오기를 누르면 공고 목록이 표시됩니다.";
    recruitBody.appendChild(recruitPrompt);
  }

  function showDetectionError() {
    const badge = document.getElementById("jk-helper-launcher-badge");
    const body = document.getElementById("jk-helper-body");
    const recruitBody = document.getElementById("jk-helper-recruit-body");
    const historyLink = document.getElementById("jk-helper-header-history-link");
    if (badge) {
      badge.textContent = "링크 없음";
    }
    if (historyLink) {
      historyLink.removeAttribute("href");
      historyLink.textContent = "기업 상세 ↗";
      historyLink.setAttribute("aria-disabled", "true");
    }
    if (body && !state.company) {
      recruitBody?.replaceChildren();
      body.innerHTML = `
        <div class="jk-helper-error">
          <strong>이 공고에서 회사 ID를 찾지 못했습니다.</strong>
          <span>페이지가 완전히 열린 뒤 ↻ 버튼을 누르세요. 계속 같다면 F12 Console의 <code>[Hayoung]</code> 로그와 현재 공고 주소를 확인하면 됩니다.</span>
        </div>
      `;
    }
  }

  function showLoadError(error) {
    const body = document.getElementById("jk-helper-body");
    const recruitBody = document.getElementById("jk-helper-recruit-body");
    if (!body) {
      return;
    }

    body.replaceChildren();
    recruitBody?.classList.remove("jk-helper-gamejob-split");
    recruitBody?.replaceChildren();
    const box = document.createElement("div");
    box.className = "jk-helper-error";
    const title = document.createElement("strong");
    title.textContent = "채용 사이트 정보를 불러오지 못했습니다.";
    const detail = document.createElement("span");
    detail.textContent = error?.message || String(error);
    box.append(title, detail);
    body.appendChild(box);
  }

  function formatDate(date) {
    if (!date) {
      return "날짜 없음";
    }
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join(".");
  }

  function renderEmployeeChart(container, points, title, footnote, minimumPoints = 2) {
    container.replaceChildren();
    if (!Array.isArray(points) || points.length < minimumPoints) {
      container.classList.add("jk-helper-filter-hidden");
      return;
    }

    const chartPoints = points.slice(-8);
    const maximum = Math.max(...chartPoints.map((point) => point.count), 1);
    const heading = document.createElement("div");
    heading.className = "jk-helper-employee-chart-heading";
    const headingTitle = document.createElement("strong");
    headingTitle.textContent = title;
    const headingNote = document.createElement("span");
    headingNote.textContent = chartPoints.length === 1 ? "공식 기록 1개" : `${chartPoints.length}개 기록`;
    heading.append(headingTitle, headingNote);

    const plot = document.createElement("div");
    plot.className = "jk-helper-employee-chart-plot";
    plot.setAttribute(
      "aria-label",
      `${title}: ${chartPoints.map((point) => `${point.label} ${point.count}명`).join(", ")}`
    );

    chartPoints.forEach((point, index) => {
      const item = document.createElement("div");
      item.className = "jk-helper-employee-chart-item";
      if (index === chartPoints.length - 1) {
        item.classList.add("jk-helper-employee-chart-latest");
      }

      const value = document.createElement("strong");
      value.textContent = `${point.count.toLocaleString("ko-KR")}명`;
      const slot = document.createElement("div");
      slot.className = "jk-helper-employee-chart-slot";
      const bar = document.createElement("span");
      bar.className = "jk-helper-employee-chart-bar";
      bar.style.setProperty("--jk-employee-bar-height", `${Math.max(7, (point.count / maximum) * 100)}%`);
      slot.appendChild(bar);
      const label = document.createElement("span");
      label.className = "jk-helper-employee-chart-label";
      label.textContent = point.label;
      item.append(value, slot, label);
      plot.appendChild(item);
    });

    const note = document.createElement("div");
    note.className = "jk-helper-employee-chart-footnote";
    note.textContent = footnote;
    container.append(heading, plot, note);
    container.classList.remove("jk-helper-filter-hidden");
  }

  const POSTING_COUNT_SERIES = [
    { key: "active", label: "활성 공고", color: "#26956a" },
    { key: "closed", label: "마감 공고", color: "#ef6c7a" },
    { key: "missing", label: "확인 안 되는 공고", color: "#6b7280" }
  ];

  function renderPostingCountChart(container, snapshots, enabledKeys) {
    container.replaceChildren();
    const points = normalizePostingCountSnapshots({ snapshots }).sort((a, b) => (
      a.capturedAt.localeCompare(b.capturedAt)
    )).slice(-12);
    const series = POSTING_COUNT_SERIES.filter((item) => enabledKeys.has(item.key));
    if (points.length < 2 || !series.length) {
      container.classList.add("jk-helper-filter-hidden");
      return;
    }

    const width = 680;
    const left = 110;
    const right = 32;
    const top = 24;
    const bandHeight = 84;
    const bottom = 40;
    const height = top + (series.length * bandHeight) + bottom;
    const plotWidth = width - left - right;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      series.map((entry) => `${entry.label}: ${points.map((point) => point[entry.key]).join(", ")}`).join(" / ")
    );
    container.style.setProperty("--jk-posting-chart-height", `${height + 18}px`);
    container.style.setProperty("--jk-posting-chart-plot-height", `${height}px`);

    const addSvg = (name, attributes, text = "") => {
      const element = document.createElementNS("http://www.w3.org/2000/svg", name);
      for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, String(value));
      }
      if (text) {
        element.textContent = text;
      }
      svg.appendChild(element);
      return element;
    };

    series.forEach((entry, seriesIndex) => {
      const bandTop = top + (seriesIndex * bandHeight);
      const bandBottom = bandTop + bandHeight - 22;
      const maximum = Math.max(...points.map((point) => point[entry.key]), 1);
      addSvg("line", {
        x1: left,
        y1: bandBottom,
        x2: width - right,
        y2: bandBottom,
        class: "jk-helper-posting-chart-grid"
      });
      addSvg("text", {
        x: left - 14,
        y: bandTop + 22,
        class: "jk-helper-posting-chart-series-label",
        fill: entry.color,
        "text-anchor": "end"
      }, entry.label);
      addSvg("text", {
        x: left - 14,
        y: bandBottom,
        class: "jk-helper-posting-chart-scale",
        "text-anchor": "end"
      }, `0–${maximum}`);

      const coordinates = points.map((point, index) => {
        const x = points.length === 1 ? left : left + ((plotWidth * index) / (points.length - 1));
        const y = bandBottom - ((point[entry.key] / maximum) * (bandHeight - 38));
        return { x, y, value: point[entry.key] };
      });
      addSvg("polyline", {
        points: coordinates.map((point) => `${point.x},${point.y}`).join(" "),
        fill: "none",
        stroke: entry.color,
        "stroke-width": 3.5,
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      });
      coordinates.forEach((point) => {
        addSvg("circle", {
          cx: point.x,
          cy: point.y,
          r: 4.5,
          fill: entry.color
        });
      });
      const latest = coordinates.at(-1);
      const latestLabel = String(latest.value);
      const labelWidth = Math.max(34, (latestLabel.length * 9) + 16);
      const labelHeight = 24;
      const labelX = Math.max(left, Math.min(
        latest.x - labelWidth - 7,
        width - right - labelWidth
      ));
      const labelY = Math.max(bandTop + 2, latest.y - labelHeight - 10);
      addSvg("rect", {
        x: labelX,
        y: labelY,
        width: labelWidth,
        height: labelHeight,
        rx: 6,
        class: "jk-helper-posting-chart-value-bg"
      });
      addSvg("text", {
        x: labelX + (labelWidth / 2),
        y: labelY + 17,
        class: "jk-helper-posting-chart-value",
        fill: entry.color,
        "text-anchor": "middle"
      }, latestLabel);
    });

    const firstLabel = formatSavedTime(points[0].capturedAt).replace(/^\d{4}\./, "").slice(0, 11);
    const lastLabel = formatSavedTime(points.at(-1).capturedAt).replace(/^\d{4}\./, "").slice(0, 11);
    addSvg("text", { x: left, y: height - 14, class: "jk-helper-posting-chart-date" }, firstLabel);
    addSvg("text", {
      x: width - right,
      y: height - 14,
      class: "jk-helper-posting-chart-date",
      "text-anchor": "end"
    }, lastLabel);
    container.appendChild(svg);
    container.classList.remove("jk-helper-filter-hidden");
  }

  function ensureRecordsSection(parent, kind) {
    let section = parent.querySelector(":scope > .jk-helper-records-section");
    if (!(section instanceof HTMLDetailsElement)) {
      section = document.createElement("details");
      section.className = "jk-helper-section jk-helper-collapsible jk-helper-records-section";
      section.open = true;
      section.innerHTML = `
        <summary class="jk-helper-section-title">
          <span class="jk-helper-summary-copy">
            <strong>기록</strong>
            <small class="jk-helper-records-summary">저장 기록</small>
          </span>
          <span class="jk-helper-collapse-indicator" aria-hidden="true">⌄</span>
        </summary>
        <div class="jk-helper-records-body"></div>
      `;
      registerLeftModule(section, "records");
      parent.appendChild(section);
    }

    const kinds = new Set(
      String(section.dataset.recordKinds || "").split(",").filter(Boolean)
    );
    kinds.add(kind);
    section.dataset.recordKinds = [...kinds].join(",");
    const labels = [
      kinds.has("posting") ? "공고 수" : "",
      kinds.has("employee") ? "사원수" : ""
    ].filter(Boolean);
    const summary = section.querySelector(".jk-helper-records-summary");
    if (summary) {
      summary.textContent = `${labels.join("·")} 저장 기록`;
    }
    return section.querySelector(".jk-helper-records-body");
  }

  function appendPostingCountSection(parent, initialCounts, localRecord, storageError) {
    const recordsBody = ensureRecordsSection(parent, "posting");
    const section = document.createElement("section");
    section.className = "jk-helper-record-block jk-helper-posting-count-section";
    section.innerHTML = `
      <div class="jk-helper-record-block-title">
        <strong>공고 수 기록</strong>
        <span>활성·마감·확인 불가 동시 저장</span>
      </div>
      <div class="jk-helper-posting-current">
        ${POSTING_COUNT_SERIES.map((entry) => `
          <span data-count-key="${entry.key}">
            <i style="--jk-series-color:${entry.color}"></i>${entry.label}<strong>0</strong>
          </span>
        `).join("")}
      </div>
      <button type="button" class="jk-helper-posting-count-add">현재 공고 수 기록</button>
      <div class="jk-helper-posting-count-message"></div>
      <div class="jk-helper-record-table-wrap">
        <table class="jk-helper-record-table jk-helper-posting-record-table">
          <thead>
            <tr><th>기록 시각</th><th>활성</th><th>마감</th><th>확인 불가</th><th>관리</th></tr>
          </thead>
          <tbody class="jk-helper-posting-count-list"></tbody>
        </table>
      </div>
    `;

    let currentCounts = { ...initialCounts };
    const addButton = section.querySelector(".jk-helper-posting-count-add");
    const message = section.querySelector(".jk-helper-posting-count-message");
    const list = section.querySelector(".jk-helper-posting-count-list");

    const updateCurrentCounts = (counts) => {
      currentCounts = { ...counts };
      for (const entry of POSTING_COUNT_SERIES) {
        const value = section.querySelector(`[data-count-key="${entry.key}"] strong`);
        if (value) {
          value.textContent = currentCounts[entry.key].toLocaleString("ko-KR");
        }
      }
    };
    const renderSnapshots = (record) => {
      const snapshots = normalizePostingCountSnapshots(record).sort((a, b) => (
        b.capturedAt.localeCompare(a.capturedAt)
      ));
      list.replaceChildren();
      if (!snapshots.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.className = "jk-helper-record-table-empty";
        cell.textContent = "저장된 공고 수 기록이 없습니다.";
        row.appendChild(cell);
        list.appendChild(row);
        return;
      }
      for (const snapshot of snapshots) {
        const row = document.createElement("tr");
        row.className = "jk-helper-posting-count-row";
        const time = document.createElement("td");
        time.textContent = formatSavedTime(snapshot.capturedAt);
        const active = document.createElement("td");
        active.textContent = snapshot.active.toLocaleString("ko-KR");
        const closed = document.createElement("td");
        closed.textContent = snapshot.closed.toLocaleString("ko-KR");
        const missing = document.createElement("td");
        missing.textContent = snapshot.missing.toLocaleString("ko-KR");
        const action = document.createElement("td");
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "삭제";
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            const next = await deletePostingCountSnapshot(state.company, snapshot.id);
            renderSnapshots(next);
            message.textContent = "공고 수 기록을 삭제했습니다.";
            message.classList.remove("jk-helper-message-error");
          } catch (error) {
            message.textContent = `삭제하지 못했습니다: ${error.message || error}`;
            message.classList.add("jk-helper-message-error");
            remove.disabled = false;
          }
        });
        action.appendChild(remove);
        row.append(time, active, closed, missing, action);
        list.appendChild(row);
      }
    };

    updateCurrentCounts(currentCounts);
    renderSnapshots(localRecord);
    message.textContent = storageError
      ? `공고 수 기록을 읽지 못했습니다: ${storageError.message || storageError}`
      : "현재 확인된 세 상태를 같은 시각의 한 기록으로 저장합니다.";
    message.classList.toggle("jk-helper-message-error", Boolean(storageError));
    addButton.addEventListener("click", async () => {
      addButton.disabled = true;
      try {
        const next = await addPostingCountSnapshot(state.company, currentCounts);
        renderSnapshots(next);
        message.textContent = `${formatSavedTime(new Date().toISOString())} 공고 수를 기록했습니다.`;
        message.classList.remove("jk-helper-message-error");
      } catch (error) {
        message.textContent = `공고 수를 기록하지 못했습니다: ${error.message || error}`;
        message.classList.add("jk-helper-message-error");
      } finally {
        addButton.disabled = false;
      }
    });
    recordsBody.appendChild(section);
    return { updateCurrentCounts };
  }

  function renderRecruitDeadlineSnapshots(container, record, onDelete) {
    const snapshots = normalizeRecruitSnapshots(record).sort((a, b) => (
      b.capturedAt.localeCompare(a.capturedAt)
    ));
    container.replaceChildren();
    if (!snapshots.length) {
      delete container.dataset.selectedSnapshotId;
      const empty = document.createElement("div");
      empty.className = "jk-helper-recruit-snapshot-empty";
      empty.textContent = "공고를 저장하면 해당 시점의 마감 공고를 마감일별 그래프로 남깁니다.";
      container.appendChild(empty);
      return;
    }

    const selectedSnapshot = snapshots.find(
      (snapshot) => snapshot.id === container.dataset.selectedSnapshotId
    ) || snapshots[0];
    container.dataset.selectedSnapshotId = selectedSnapshot.id;

    const browser = document.createElement("div");
    browser.className = "jk-helper-recruit-snapshot-browser";
    const picker = document.createElement("div");
    picker.className = "jk-helper-recruit-snapshot-picker";
    picker.setAttribute("role", "listbox");
    picker.setAttribute("aria-label", "마감일 그래프 저장 목록");

    for (const snapshot of snapshots) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "jk-helper-recruit-snapshot-choice";
      button.classList.toggle(
        "jk-helper-recruit-snapshot-choice-selected",
        snapshot.id === selectedSnapshot.id
      );
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(snapshot.id === selectedSnapshot.id));
      const time = document.createElement("strong");
      time.textContent = formatSavedTime(snapshot.capturedAt);
      const stats = document.createElement("span");
      stats.textContent = `전체 ${snapshot.total} · 마감 ${snapshot.closed}` +
        (snapshot.missing ? ` · 확인 불가 ${snapshot.missing}` : "");
      button.append(time, stats);
      button.addEventListener("click", () => {
        container.dataset.selectedSnapshotId = snapshot.id;
        renderRecruitDeadlineSnapshots(container, record, onDelete);
      });
      picker.appendChild(button);
    }

    const card = document.createElement("article");
    card.className = "jk-helper-recruit-snapshot-card";
    const header = document.createElement("header");
    const heading = document.createElement("div");
    const time = document.createElement("strong");
    time.textContent = formatSavedTime(selectedSnapshot.capturedAt);
    const stats = document.createElement("span");
    stats.textContent = `전체 ${selectedSnapshot.total} · 진행중 ${selectedSnapshot.active} · 마감 ${selectedSnapshot.closed}` +
      (selectedSnapshot.missing ? ` · 확인 불가 ${selectedSnapshot.missing}` : "");
    heading.append(time, stats);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "그래프 삭제";
    remove.title = "선택한 저장 시점의 마감일 그래프만 삭제";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`${formatSavedTime(selectedSnapshot.capturedAt)} 마감일 그래프를 삭제할까요?`)) {
        return;
      }
      remove.disabled = true;
      try {
        await onDelete(selectedSnapshot.id);
      } catch {
        remove.disabled = false;
      }
    });
    header.append(heading, remove);
    card.appendChild(header);

    const buckets = [
      ...selectedSnapshot.deadlines.map((bucket) => ({
          ...bucket,
          label: bucket.date.slice(2).replace(/-/g, "."),
          fullLabel: bucket.date.replace(/-/g, "."),
          undated: false
        })),
      ...(selectedSnapshot.undatedClosed ? [{
        date: "undated",
        label: "날짜 없음",
        fullLabel: "마감일 없음",
        count: selectedSnapshot.undatedClosed,
        undated: true
      }] : [])
    ];
    if (!buckets.length) {
      const empty = document.createElement("div");
      empty.className = "jk-helper-recruit-snapshot-empty";
      empty.textContent = "이 저장 시점에는 마감 공고가 없습니다.";
      card.appendChild(empty);
    } else {
      const maximum = Math.max(...buckets.map((bucket) => bucket.count), 1);
      const scroll = document.createElement("div");
      scroll.className = "jk-helper-deadline-chart-scroll";
      const chart = document.createElement("div");
      chart.className = "jk-helper-deadline-chart";
      chart.style.setProperty("--jk-deadline-columns", String(buckets.length));
      chart.setAttribute(
        "aria-label",
        buckets.map((bucket) => `${bucket.fullLabel} ${bucket.count}건`).join(", ")
      );
      for (const bucket of buckets) {
        const column = document.createElement("div");
        column.className = "jk-helper-deadline-column";
        if (bucket.undated) {
          column.classList.add("jk-helper-deadline-undated");
        }
        column.title = `${bucket.fullLabel}: ${bucket.count}건`;
        const value = document.createElement("strong");
        value.textContent = bucket.count.toLocaleString("ko-KR");
        const slot = document.createElement("span");
        slot.className = "jk-helper-deadline-slot";
        const bar = document.createElement("i");
        bar.style.setProperty(
          "--jk-deadline-height",
          `${Math.max(8, (bucket.count / maximum) * 100)}%`
        );
        slot.appendChild(bar);
        const label = document.createElement("span");
        label.className = "jk-helper-deadline-label";
        label.textContent = bucket.label;
        column.append(value, slot, label);
        chart.appendChild(column);
      }
      scroll.appendChild(chart);
      card.appendChild(scroll);
    }
    browser.append(picker, card);
    container.appendChild(browser);
  }

  function appendEmployeeSection(parent, profileInfo, profileError, localRecord, storageError) {
    const automaticCount = extractEmployeeCount(profileInfo);
    const sourceLabel = state.company?.site === SITE_GAMEJOB ? "게임잡" : "잡코리아";
    const recordsBody = ensureRecordsSection(parent, "employee");
    const section = document.createElement("section");
    section.className = "jk-helper-record-block jk-helper-employee-record-section";

    section.innerHTML = `
      <div class="jk-helper-record-block-title">
        <strong>사원수 기록</strong>
        <span>${sourceLabel} 공식 + 로컬 저장값</span>
      </div>
      <div class="jk-helper-employee-body">
        <div class="jk-helper-employee-auto">
          <span>${sourceLabel} 공식 사원수</span>
          <div class="jk-helper-employee-current">
            <strong class="jk-helper-employee-value"></strong>
            <span class="jk-helper-employee-unit">명</span>
          </div>
          <div class="jk-helper-employee-auto-message"></div>
        </div>
        <div class="jk-helper-snapshot-area">
          <div class="jk-helper-snapshot-title">
            <strong>로컬 직원수 기록</strong>
            <span>현재 공식 값만 저장 · 기존 기록 수정 불가</span>
          </div>
          <div class="jk-helper-employee-capture">
            <span>현재 공식 사원수</span>
            <strong class="jk-helper-employee-capture-value"></strong>
            <button type="button" class="jk-helper-employee-add">현재 값 기록</button>
          </div>
          <div class="jk-helper-employee-message"></div>
          <div class="jk-helper-record-table-wrap">
            <table class="jk-helper-record-table jk-helper-employee-record-table">
              <thead>
                <tr><th>기준일</th><th>사원수</th><th>저장 시각</th><th>관리</th></tr>
              </thead>
              <tbody class="jk-helper-snapshot-list"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const value = section.querySelector(".jk-helper-employee-value");
    const unit = section.querySelector(".jk-helper-employee-unit");
    const automaticMessage = section.querySelector(".jk-helper-employee-auto-message");
    const captureValue = section.querySelector(".jk-helper-employee-capture-value");
    const addButton = section.querySelector(".jk-helper-employee-add");
    const message = section.querySelector(".jk-helper-employee-message");
    const snapshotList = section.querySelector(".jk-helper-snapshot-list");

    const hasAutomaticCount = Number.isSafeInteger(automaticCount) && automaticCount >= 0;
    value.textContent = hasAutomaticCount ? automaticCount.toLocaleString("ko-KR") : "정보 없음";
    unit.classList.toggle("jk-helper-filter-hidden", !hasAutomaticCount);
    if (!hasAutomaticCount && profileError) {
      automaticMessage.textContent = `자동 확인 실패: ${profileError.message || profileError}`;
      automaticMessage.classList.add("jk-helper-message-error");
    } else if (!hasAutomaticCount) {
      automaticMessage.textContent = `${sourceLabel} 기업 상세정보에 공식 사원수가 없습니다.`;
    } else {
      automaticMessage.textContent = `${sourceLabel} 기업 상세정보에서 자동으로 읽은 공식 값입니다.`;
    }

    captureValue.textContent = hasAutomaticCount
      ? `${automaticCount.toLocaleString("ko-KR")}명`
      : "공식 값 없음";
    addButton.disabled = !hasAutomaticCount;

    const renderSnapshots = (record) => {
      snapshotList.replaceChildren();
      const snapshots = normalizeEmployeeSnapshots(record).sort((a, b) => (
        b.capturedDate.localeCompare(a.capturedDate) ||
        String(b.addedAt || "").localeCompare(String(a.addedAt || ""))
      ));

      if (!snapshots.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 4;
        cell.className = "jk-helper-record-table-empty";
        cell.textContent = "저장된 직원수 기록이 없습니다.";
        row.appendChild(cell);
        snapshotList.appendChild(row);
        return;
      }

      for (const snapshot of snapshots) {
        const row = document.createElement("tr");
        row.className = "jk-helper-employee-record-row";
        const date = document.createElement("td");
        date.textContent = snapshot.capturedDate.replace(/-/g, ".");
        const count = document.createElement("td");
        count.textContent = `${snapshot.count.toLocaleString("ko-KR")}명`;
        const savedTime = document.createElement("td");
        const formattedSavedTime = formatSavedTime(snapshot.addedAt);
        savedTime.textContent = formattedSavedTime;
        const action = document.createElement("td");
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "jk-helper-snapshot-delete";
        deleteButton.textContent = "삭제";
        deleteButton.addEventListener("click", async () => {
          deleteButton.disabled = true;
          try {
            const nextRecord = await deleteEmployeeSnapshot(state.company, snapshot.id);
            renderSnapshots(nextRecord);
            message.textContent = "기록을 삭제했습니다.";
            message.classList.remove("jk-helper-message-error");
          } catch (error) {
            message.textContent = `삭제하지 못했습니다: ${error.message || error}`;
            message.classList.add("jk-helper-message-error");
            deleteButton.disabled = false;
          }
        });
        action.appendChild(deleteButton);
        row.append(date, count, savedTime, action);
        snapshotList.appendChild(row);
      }
    };

    renderSnapshots(localRecord);
    if (storageError) {
      message.textContent = `로컬 기록을 읽지 못했습니다: ${storageError.message || storageError}`;
      message.classList.add("jk-helper-message-error");
    } else if (!hasAutomaticCount) {
      message.textContent = `현재 ${sourceLabel} 공식 사원수가 없어 기록할 수 없습니다.`;
    } else {
      message.textContent = "현재 표시된 공식 사원수만 현재 시각으로 저장합니다. 기존 기록은 수정할 수 없습니다.";
    }

    const addSnapshot = async () => {
      if (!hasAutomaticCount) {
        message.textContent = `현재 ${sourceLabel} 공식 사원수가 없어 기록할 수 없습니다.`;
        message.classList.add("jk-helper-message-error");
        return;
      }

      const count = automaticCount;
      const capturedDate = todayInputValue();

      addButton.disabled = true;
      try {
        const nextRecord = await addEmployeeSnapshot(state.company, count, capturedDate);
        renderSnapshots(nextRecord);
        message.textContent = `${capturedDate.replace(/-/g, ".")} 직원수 기록을 추가했습니다.`;
        message.classList.remove("jk-helper-message-error");
      } catch (error) {
        message.textContent = `기록을 추가하지 못했습니다: ${error.message || error}`;
        message.classList.add("jk-helper-message-error");
      } finally {
        addButton.disabled = !hasAutomaticCount;
      }
    };

    addButton.addEventListener("click", addSnapshot);
    recordsBody.appendChild(section);
  }

  function buildDonutGradient(segments, fallbackColor = "#dfe6ef") {
    const normalized = segments
      .map((segment) => ({
        value: Number.isSafeInteger(segment.value) && segment.value > 0 ? segment.value : 0,
        color: segment.color
      }))
      .filter((segment) => segment.value > 0);
    const total = normalized.reduce((sum, segment) => sum + segment.value, 0);
    if (!total) {
      return fallbackColor;
    }

    let cursor = 0;
    const stops = normalized.map((segment) => {
      const start = (cursor / total) * 360;
      cursor += segment.value;
      const end = (cursor / total) * 360;
      return `${segment.color} ${start.toFixed(3)}deg ${end.toFixed(3)}deg`;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }

  function appendHistorySection(
    historyParent,
    recruitParent,
    officialHistory,
    employeeCount,
    items,
    historyError,
    recruitRecord,
    recruitStorageError,
    recruitSummary,
    postingCountRecord,
    postingCountStorageError,
    overviewOnly = false
  ) {
    const sourceLabel = state.company?.site === SITE_GAMEJOB ? "게임잡" : "잡코리아";
    const isJobKorea = state.company?.site === SITE_JOBKOREA;
    const showOfficialHistory = isJobKorea;
    const historySection = document.createElement("details");
    historySection.className = "jk-helper-section jk-helper-collapsible";
    historySection.open = true;
    const saveSection = document.createElement("details");
    saveSection.className = "jk-helper-section jk-helper-collapsible jk-helper-recruit-save-section";
    saveSection.open = true;
    const section = document.createElement("details");
    section.className = "jk-helper-section jk-helper-collapsible jk-helper-recruit-section jk-helper-recruit-history-section";
    section.open = true;
    let activeRecruitRecord = recruitRecord;
    let activeArchiveItems = normalizeRecruitArchive(activeRecruitRecord);
    const deriveRecruitView = () => {
      const currentUrls = new Set([
        ...items.map((item) => recruitUrlKey(item.href)),
        recruitUrlKey(location.href)
      ].filter(Boolean));
      const archivedMissing = historyError
        ? []
        : activeArchiveItems
          .filter((item) => !currentUrls.has(recruitUrlKey(item.href)))
          .map(archiveItemToRecruitItem);
      const archiveByUrl = new Map(activeArchiveItems.map((item) => [recruitUrlKey(item.href), item]));
      const displayItems = mergeRecruitItems(items, archivedMissing).map((item) => {
        const saved = archiveByUrl.get(recruitUrlKey(item.href));
        return saved ? {
          ...item,
          isSaved: true,
          firstSavedAt: saved.firstSavedAt,
          lastSavedAt: saved.lastSavedAt
        } : item;
      });
      return { archivedMissing, displayItems };
    };
    let { archivedMissing, displayItems } = deriveRecruitView();
    const sourcePostingTotal = Number.isSafeInteger(recruitSummary?.total) && recruitSummary.total >= 0
      ? recruitSummary.total
      : null;
    const postingCountTooltip = "사이트 집계에는 중복 공고가 포함될 수 있어 고유 링크 수와 차이가 날 수 있습니다.";
    const currentPostingLabel = () => sourcePostingTotal !== null && sourcePostingTotal !== items.length
      ? `사이트 집계 ${sourcePostingTotal}건 · 링크 확인 ${items.length}건`
      : `현재 ${items.length}건`;
    const hasOfficialHistory = showOfficialHistory && Boolean(officialHistory);
    const historyCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const historyTotal = historyCount(officialHistory?.total);
    const experiencedCount = historyCount(officialHistory?.experiencedOnly);
    const bothCount = historyCount(officialHistory?.both);
    const newCount = historyCount(officialHistory?.newOnly);
    const hasRegularCount = Number.isSafeInteger(officialHistory?.regular) && officialHistory.regular >= 0;
    const regularCount = hasRegularCount ? officialHistory.regular : 0;
    const nonRegularCount = hasRegularCount ? Math.max(historyTotal - regularCount, 0) : historyTotal;
    const distributionGradient = buildDonutGradient([
      { value: experiencedCount, color: "#72b8f4" },
      { value: bothCount, color: "#ff676d" },
      { value: newCount, color: "#f8b927" }
    ]);
    const regularGradient = buildDonutGradient([
      { value: regularCount, color: "#3d9af2" },
      { value: nonRegularCount, color: "#dfe6ef" }
    ]);

    historySection.innerHTML = `
      <summary class="jk-helper-section-title">
        <span class="jk-helper-summary-copy">
          <strong>채용 History</strong>
          <small>잡코리아 기업 상세정보 기준</small>
        </span>
        <span class="jk-helper-collapse-indicator" aria-hidden="true">⌄</span>
      </summary>
      ${hasOfficialHistory ? `<div class="jk-helper-history-card">
        <div class="jk-helper-history-donut-grid" aria-label="잡코리아 공식 최근 3년 채용 History">
          <section class="jk-helper-history-donut-panel">
            <strong class="jk-helper-history-donut-title">공고 분포</strong>
            <div class="jk-helper-history-donut jk-helper-history-distribution-donut" role="img" aria-label="경력 ${experiencedCount}회, 신입/경력 ${bothCount}회, 신입 ${newCount}회">
              <span class="jk-helper-history-donut-center">
                <small>최근 3년</small>
                <strong>${historyTotal.toLocaleString("ko-KR")}회</strong>
              </span>
            </div>
            <div class="jk-helper-history-legend">
              <span class="jk-helper-history-legend-item jk-helper-history-legend-experienced"><i></i><span>경력</span><strong>${experiencedCount.toLocaleString("ko-KR")}</strong></span>
              <span class="jk-helper-history-legend-item jk-helper-history-legend-both"><i></i><span>신입/경력</span><strong>${bothCount.toLocaleString("ko-KR")}</strong></span>
              <span class="jk-helper-history-legend-item jk-helper-history-legend-new"><i></i><span>신입</span><strong>${newCount.toLocaleString("ko-KR")}</strong></span>
            </div>
          </section>
          <section class="jk-helper-history-donut-panel">
            <strong class="jk-helper-history-donut-title">정규직 채용 횟수</strong>
            <div class="jk-helper-history-donut jk-helper-history-regular-donut" role="img" aria-label="정규직 채용 횟수 ${hasRegularCount ? `${regularCount}회` : "정보 없음"}">
              <span class="jk-helper-history-donut-center">
                <small>채용 횟수</small>
                <strong>${hasRegularCount ? `${regularCount.toLocaleString("ko-KR")}회` : "-"}</strong>
              </span>
            </div>
          </section>
        </div>
        <div class="jk-helper-history-footnote">잡코리아 기업 상세정보 · 최근 3년 기준</div>
      </div>` : `
        <div class="jk-helper-official-unavailable">
          잡코리아 기업 상세정보에서 공식 채용 History를 찾지 못했습니다. 공고 링크 수로 대신 계산하지 않습니다.
        </div>
      `}
    `;

    if (hasOfficialHistory) {
      historySection.querySelector(".jk-helper-history-distribution-donut").style.setProperty(
        "--jk-helper-donut-background",
        distributionGradient
      );
      historySection.querySelector(".jk-helper-history-regular-donut").style.setProperty(
        "--jk-helper-donut-background",
        regularGradient
      );
      const alert = createAlertLine(
        jobKoreaAlertText(officialHistory, employeeCount),
        "jk-helper-jobkorea-alert"
      );
      if (alert) {
        historySection.appendChild(alert);
      }
    }

    saveSection.innerHTML = `
      <summary class="jk-helper-section-title">
        <span class="jk-helper-summary-copy">
          <strong>공고 저장</strong>
          <small class="jk-helper-save-summary-stats">저장 ${activeArchiveItems.length}건</small>
        </span>
        <span class="jk-helper-collapse-indicator" aria-hidden="true">⌄</span>
      </summary>
      <div class="jk-helper-archive-controls">
        <button type="button" class="jk-helper-archive-save" ${items.length ? "" : "disabled"}>${isJobKorea ? "현재 공고 저장" : "현재 공고 링크 저장"}</button>
        <span class="jk-helper-archive-status"></span>
        <span class="jk-helper-archive-title-count">${isJobKorea
          ? `저장 공고 ${activeArchiveItems.length}건 · 마감일 기록 ${normalizeRecruitSnapshots(activeRecruitRecord).length}개`
          : `저장 링크 ${activeArchiveItems.length}건`}</span>
      </div>
      <div class="jk-helper-archive-bulk-actions">
        <button type="button" class="jk-helper-archive-delete-missing">확인 불가 전체 삭제</button>
        <button type="button" class="jk-helper-archive-delete-all">저장 공고 전체 삭제</button>
      </div>
      ${isJobKorea ? `
        <section class="jk-helper-recruit-snapshots">
          <div class="jk-helper-recruit-snapshots-title">
            <strong>마감일 그래프</strong>
            <span>저장 목록에서 하나를 선택해 표시</span>
          </div>
          <div class="jk-helper-recruit-snapshot-list"></div>
        </section>
      ` : ""}
    `;

    section.innerHTML = `
      <summary class="jk-helper-section-title">
        <span class="jk-helper-summary-copy">
          <strong>과거 공고</strong>
          <small class="jk-helper-recruit-summary-stats" title="${postingCountTooltip}">${currentPostingLabel()} · 저장 ${activeArchiveItems.length}건</small>
        </span>
        <span class="jk-helper-collapse-indicator" aria-hidden="true">⌄</span>
      </summary>
      ${displayItems.length ? `
        <div class="jk-helper-list-title">
          <strong>과거 공고 검색</strong>
          <span class="jk-helper-list-stats" title="${postingCountTooltip}">${currentPostingLabel()} · 저장 ${activeArchiveItems.length}건 · 확인불가 ${archivedMissing.length}건</span>
        </div>
        <div class="jk-helper-search">
          <div class="jk-helper-search-box">
            <span class="jk-helper-search-icon">⌕</span>
            <input
              type="search"
              class="jk-helper-search-input"
              placeholder="공고명·상태·날짜 검색"
              aria-label="과거 채용공고 문자열 검색"
              autocomplete="off"
              spellcheck="false"
            >
            <button type="button" class="jk-helper-search-clear" title="검색어 지우기">×</button>
          </div>
          <span class="jk-helper-search-count" title="${postingCountTooltip}">전체 ${displayItems.length}건</span>
        </div>
        <div class="jk-helper-favorite-search">
          <strong>즐겨찾기 검색</strong>
          <div class="jk-helper-favorite-search-tags" aria-label="즐겨찾기 검색 단어"></div>
          <button type="button" class="jk-helper-favorite-search-add" disabled>+ 현재 검색어</button>
        </div>
        <div class="jk-helper-search-empty jk-helper-filter-hidden">
          해당 문자열이 포함된 과거 공고가 없습니다.
        </div>
      ` : ""}
      <div class="jk-helper-recruit-list"></div>
    `;

    const archiveButton = saveSection.querySelector(".jk-helper-archive-save");
    const archiveStatus = saveSection.querySelector(".jk-helper-archive-status");
    const archiveTitleCount = saveSection.querySelector(".jk-helper-archive-title-count");
    const deleteMissingButton = saveSection.querySelector(".jk-helper-archive-delete-missing");
    const deleteAllButton = saveSection.querySelector(".jk-helper-archive-delete-all");
    const recruitSnapshotList = saveSection.querySelector(".jk-helper-recruit-snapshot-list");
    const saveSummaryStats = saveSection.querySelector(".jk-helper-save-summary-stats");
    const listStats = section.querySelector(".jk-helper-list-stats");
    const summaryStats = section.querySelector(".jk-helper-recruit-summary-stats");
    let renderRecruitList = () => {};
    let postingCountController = null;

    if (recruitStorageError) {
      archiveStatus.textContent = `저장 기록 확인 실패: ${recruitStorageError.message || recruitStorageError}`;
      archiveStatus.classList.add("jk-helper-message-error");
    } else if (archivedMissing.length) {
      archiveStatus.textContent = `${archivedMissing.length}개 저장 링크가 현재 목록에서 사라졌습니다.`;
      archiveStatus.classList.add("jk-helper-archive-warning");
    } else {
      archiveStatus.textContent = isJobKorea
        ? "현재 공고와 마감일 그래프를 같은 시각에 저장합니다."
        : "저장한 링크와 다음 방문의 목록을 비교합니다.";
    }

    const removeRecruitSnapshot = async (snapshotId) => {
      try {
        activeRecruitRecord = await deleteRecruitSnapshot(state.company, snapshotId);
        activeArchiveItems = normalizeRecruitArchive(activeRecruitRecord);
        renderRecruitList();
        archiveStatus.textContent = "선택한 마감일 그래프를 삭제했습니다.";
        archiveStatus.classList.remove("jk-helper-message-error", "jk-helper-archive-warning");
      } catch (error) {
        archiveStatus.textContent = `마감일 그래프를 삭제하지 못했습니다: ${error.message || error}`;
        archiveStatus.classList.add("jk-helper-message-error");
        throw error;
      }
    };

    archiveButton?.addEventListener("click", async () => {
      archiveButton.disabled = true;
      try {
        const nextRecord = await writeRecruitRecord(
          state.company,
          items,
          activeRecruitRecord,
          {
            addSnapshot: isJobKorea,
            missingCount: archivedMissing.length
          }
        );
        activeRecruitRecord = nextRecord;
        activeArchiveItems = normalizeRecruitArchive(nextRecord);
        renderRecruitList();
        archiveStatus.textContent = isJobKorea
          ? `현재 공고 ${items.length}건과 마감일 그래프 1개를 저장했습니다. 누적 공고 ${activeArchiveItems.length}건`
          : `현재 공고 링크를 저장했습니다. 누적 ${activeArchiveItems.length}건`;
        archiveStatus.classList.remove("jk-helper-message-error", "jk-helper-archive-warning");
      } catch (error) {
        archiveStatus.textContent = `공고를 저장하지 못했습니다: ${error.message || error}`;
        archiveStatus.classList.add("jk-helper-message-error");
      } finally {
        archiveButton.disabled = !items.length;
      }
    });

    deleteMissingButton?.addEventListener("click", async () => {
      const missingUrls = new Set(archivedMissing.map((item) => recruitUrlKey(item.href)).filter(Boolean));
      if (!missingUrls.size) {
        return;
      }
      if (!window.confirm(`${state.company.name}의 확인 불가 저장 공고 ${missingUrls.size}건을 모두 삭제할까요?`)) {
        return;
      }
      deleteMissingButton.disabled = true;
      try {
        activeRecruitRecord = await deleteRecruitItems(state.company, missingUrls);
        activeArchiveItems = normalizeRecruitArchive(activeRecruitRecord);
        renderRecruitList();
        archiveStatus.textContent = `확인 불가 저장 공고 ${missingUrls.size}건을 삭제했습니다.`;
        archiveStatus.classList.remove("jk-helper-message-error", "jk-helper-archive-warning");
      } catch (error) {
        archiveStatus.textContent = `확인 불가 공고를 삭제하지 못했습니다: ${error.message || error}`;
        archiveStatus.classList.add("jk-helper-message-error");
        deleteMissingButton.disabled = false;
      }
    });

    deleteAllButton?.addEventListener("click", async () => {
      if (!activeArchiveItems.length) {
        return;
      }
      const deleteCount = activeArchiveItems.length;
      const graphNote = isJobKorea ? "\n마감일 그래프는 유지됩니다." : "";
      if (!window.confirm(`${state.company.name}의 저장 공고 ${deleteCount}건을 모두 삭제할까요?${graphNote}`)) {
        return;
      }
      deleteAllButton.disabled = true;
      try {
        activeRecruitRecord = await deleteRecruitItems(
          state.company,
          new Set(activeArchiveItems.map((item) => recruitUrlKey(item.href)).filter(Boolean))
        );
        activeArchiveItems = normalizeRecruitArchive(activeRecruitRecord);
        renderRecruitList();
        archiveStatus.textContent = `이 회사의 저장 공고 ${deleteCount}건을 모두 삭제했습니다.`;
        archiveStatus.classList.remove("jk-helper-message-error", "jk-helper-archive-warning");
      } catch (error) {
        archiveStatus.textContent = `저장 공고 전체를 삭제하지 못했습니다: ${error.message || error}`;
        archiveStatus.classList.add("jk-helper-message-error");
        deleteAllButton.disabled = false;
      }
    });

    const list = section.querySelector(".jk-helper-recruit-list");
    const searchInput = section.querySelector(".jk-helper-search-input");
    const clearButton = section.querySelector(".jk-helper-search-clear");
    const resultCount = section.querySelector(".jk-helper-search-count");
    const searchEmpty = section.querySelector(".jk-helper-search-empty");
    const favoriteList = section.querySelector(".jk-helper-favorite-search-tags");
    const favoriteAddButton = section.querySelector(".jk-helper-favorite-search-add");
    let favoriteTerms = [];

    const applySearch = () => {
      const query = normalizeText(searchInput?.value).toLocaleLowerCase("ko-KR");
      const recruitRows = [...list.querySelectorAll(".jk-helper-recruit-row")];
      let visibleCount = 0;

      for (const row of recruitRows) {
        const matches = !query || row.dataset.searchText.includes(query);
        row.classList.toggle("jk-helper-filter-hidden", !matches);
        if (matches) {
          visibleCount += 1;
        }
      }

      if (resultCount) {
        resultCount.textContent = query
          ? `검색 ${visibleCount}/${recruitRows.length}건`
          : `전체 ${recruitRows.length}건`;
      }
      clearButton?.classList.toggle("jk-helper-clear-visible", Boolean(query));
      searchEmpty?.classList.toggle("jk-helper-filter-hidden", visibleCount !== 0);
    };

    const syncFavoriteAddButton = () => {
      if (favoriteAddButton) {
        favoriteAddButton.disabled = !normalizeText(searchInput?.value);
      }
    };

    const renderFavoriteTerms = () => {
      if (!favoriteList) {
        return;
      }
      favoriteList.replaceChildren();
      if (!favoriteTerms.length) {
        const empty = document.createElement("span");
        empty.className = "jk-helper-favorite-search-empty";
        empty.textContent = "등록된 단어 없음";
        favoriteList.appendChild(empty);
        return;
      }
      for (const term of favoriteTerms) {
        const tag = document.createElement("span");
        tag.className = "jk-helper-favorite-search-tag";
        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "jk-helper-favorite-search-apply";
        apply.textContent = term;
        apply.title = `‘${term}’ 바로 검색`;
        apply.addEventListener("click", () => {
          searchInput.value = term;
          applySearch();
          syncFavoriteAddButton();
          searchInput.focus();
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "jk-helper-favorite-search-remove";
        remove.textContent = "×";
        remove.title = `‘${term}’ 즐겨찾기 삭제`;
        remove.setAttribute("aria-label", `‘${term}’ 즐겨찾기 삭제`);
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            favoriteTerms = await deleteFavoriteSearchTerm(term);
            renderFavoriteTerms();
          } catch (error) {
            console.warn("[Hayoung] favorite search delete failed", error);
            remove.disabled = false;
          }
        });
        tag.append(apply, remove);
        favoriteList.appendChild(tag);
      }
    };

    renderRecruitList = () => {
      ({ archivedMissing, displayItems } = deriveRecruitView());
      list.replaceChildren();
      const recruitSnapshots = normalizeRecruitSnapshots(activeRecruitRecord);
      archiveTitleCount.textContent = isJobKorea
        ? `저장 공고 ${activeArchiveItems.length}건 · 마감일 기록 ${recruitSnapshots.length}개`
        : `저장 링크 ${activeArchiveItems.length}건`;
      saveSummaryStats.textContent = `저장 ${activeArchiveItems.length}건`;
      summaryStats.textContent = `${currentPostingLabel()} · 저장 ${activeArchiveItems.length}건`;
      if (listStats) {
        listStats.textContent = `${currentPostingLabel()} · 저장 ${activeArchiveItems.length}건 · 확인불가 ${archivedMissing.length}건`;
      }
      if (deleteMissingButton) {
        deleteMissingButton.disabled = !archivedMissing.length;
        deleteMissingButton.textContent = archivedMissing.length
          ? `확인 불가 전체 삭제 (${archivedMissing.length})`
          : "확인 불가 전체 삭제";
      }
      if (deleteAllButton) {
        deleteAllButton.disabled = !activeArchiveItems.length;
        deleteAllButton.textContent = activeArchiveItems.length
          ? `저장 공고 전체 삭제 (${activeArchiveItems.length})`
          : "저장 공고 전체 삭제";
      }
      if (recruitSnapshotList) {
        renderRecruitDeadlineSnapshots(
          recruitSnapshotList,
          activeRecruitRecord,
          removeRecruitSnapshot
        );
      }
      postingCountController?.updateCurrentCounts(
        postingCountsFromRecruitView(items, archivedMissing, recruitSummary)
      );

      if (!displayItems.length) {
        const empty = document.createElement("div");
        empty.className = "jk-helper-empty";
        empty.textContent = historyError
          ? `공고 목록을 자동 추출하지 못했습니다: ${historyError.message || historyError}`
          : `${sourceLabel} 기업 채용 목록에서 공고를 찾지 못했습니다.`;
        list.appendChild(empty);
        applySearch();
        return;
      }

      for (const item of displayItems) {
        const row = document.createElement("div");
        row.className = "jk-helper-recruit-row";
        const isClosed = isClosedRecruit(item);
        if (isClosed) {
          row.classList.add("jk-helper-recruit-closed");
        }
        if (item.archivedMissing) {
          row.classList.add("jk-helper-recruit-missing");
        }
        row.dataset.searchText = normalizeText(
          `${item.title} ${item.status || ""} ${formatDate(item.date)} ${item.context || ""} ` +
          `${isClosed ? "마감 공고" : "진행중 공고"} ` +
          `${item.archivedMissing ? "링크가 변경되거나 삭제됨" : ""} ` +
          `${item.isSaved ? `저장 ${formatSavedTime(item.lastSavedAt || item.firstSavedAt)}` : ""}`
        ).toLocaleLowerCase("ko-KR");

        const link = document.createElement("a");
        link.className = "jk-helper-recruit-item";
        link.href = item.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        const main = document.createElement("span");
        main.className = "jk-helper-recruit-main";
        const title = document.createElement("strong");
        title.textContent = item.title;
        if (item.archivedMissing) {
          const warning = document.createElement("span");
          warning.className = "jk-helper-recruit-warning";
          warning.textContent = "링크가 변경되거나 삭제됨";
          main.append(title, warning);
        } else {
          main.appendChild(title);
        }
        const meta = document.createElement("span");
        meta.className = "jk-helper-recruit-meta";
        const recruitKinds = [
          item.isNewHire ? "신입" : "",
          item.isExperienced ? "경력" : "",
          item.isRegular ? "정규직" : ""
        ].filter(Boolean);
        meta.textContent = [
          item.status || "상태 없음",
          formatDate(item.date),
          recruitKinds.join("·")
        ].filter(Boolean).join(" · ");
        main.appendChild(meta);
        if (item.isSaved) {
          const savedTime = document.createElement("span");
          savedTime.className = "jk-helper-recruit-saved-time";
          savedTime.textContent = `저장 ${formatSavedTime(item.lastSavedAt || item.firstSavedAt)}`;
          main.appendChild(savedTime);
        }

        const arrow = document.createElement("span");
        arrow.className = "jk-helper-arrow";
        arrow.textContent = "›";
        link.append(main, arrow);
        row.appendChild(link);

        if (item.isSaved) {
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "jk-helper-recruit-delete";
          deleteButton.textContent = "삭제";
          deleteButton.title = "저장된 공고 기록 삭제";
          deleteButton.addEventListener("click", async () => {
            deleteButton.disabled = true;
            try {
              const nextRecord = await deleteRecruitItem(state.company, item.href);
              activeRecruitRecord = nextRecord;
              activeArchiveItems = normalizeRecruitArchive(nextRecord);
              renderRecruitList();
              archiveStatus.textContent = "저장 공고 기록을 삭제했습니다.";
              archiveStatus.classList.remove("jk-helper-message-error", "jk-helper-archive-warning");
            } catch (error) {
              archiveStatus.textContent = `저장 공고를 삭제하지 못했습니다: ${error.message || error}`;
              archiveStatus.classList.add("jk-helper-message-error");
              deleteButton.disabled = false;
            }
          });
          row.appendChild(deleteButton);
        }
        list.appendChild(row);
      }
      applySearch();
    };

    renderRecruitList();
    void readFavoriteSearchTerms()
      .then((terms) => {
        favoriteTerms = terms;
        renderFavoriteTerms();
      })
      .catch((error) => {
        console.warn("[Hayoung] favorite search read failed", error);
        if (favoriteList) {
          favoriteList.textContent = "즐겨찾기를 불러오지 못했습니다.";
        }
      });

    if (searchInput) {
      searchInput?.addEventListener("input", () => {
        applySearch();
        syncFavoriteAddButton();
      });
      searchInput?.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          searchInput.value = "";
          applySearch();
          syncFavoriteAddButton();
        }
      });
      clearButton?.addEventListener("click", () => {
        searchInput.value = "";
        applySearch();
        syncFavoriteAddButton();
        searchInput.focus();
      });
      favoriteAddButton?.addEventListener("click", async () => {
        const term = normalizeText(searchInput.value);
        if (!term) {
          return;
        }
        favoriteAddButton.disabled = true;
        try {
          favoriteTerms = await addFavoriteSearchTerm(term);
          renderFavoriteTerms();
        } catch (error) {
          console.warn("[Hayoung] favorite search save failed", error);
        } finally {
          syncFavoriteAddButton();
        }
      });
      syncFavoriteAddButton();
    }

    if (showOfficialHistory) {
      registerLeftModule(historySection, "history");
      historyParent.appendChild(historySection);
    }
    if (state.company?.site === SITE_GAMEJOB) {
      postingCountController = appendPostingCountSection(
        historyParent,
        postingCountsFromRecruitView(items, archivedMissing, recruitSummary),
        postingCountRecord,
        postingCountStorageError
      );
    }
    if (overviewOnly) {
      const prompt = document.createElement("section");
      prompt.className = "jk-helper-overview-load-prompt";
      prompt.innerHTML = `
        <strong>기업 상세 1회 조회 완료</strong>
        <span>전체 과거 공고는 필요할 때만 추가로 불러옵니다.</span>
        <button type="button">전체 과거 공고 불러오기</button>
      `;
      prompt.querySelector("button").addEventListener("click", () => {
        state.loadRequestedThisPage = true;
        void loadCompanyData();
      });
      recruitParent.appendChild(prompt);
      return;
    }
    const recruitStack = document.createElement("div");
    recruitStack.className = "jk-helper-recruit-stack";
    recruitStack.append(saveSection, section);
    recruitParent.appendChild(recruitStack);
  }

  function appendWorkforceSection(parent, company, activePostingCount) {
    if (!(parent instanceof HTMLElement) || company?.site !== SITE_GAMEJOB) {
      return;
    }

    const section = document.createElement("section");
    section.className = "jk-helper-workforce-section";
    section.setAttribute("aria-label", "국민연금 인원 비교");

    if (!WORKFORCE_COMPANIES.length) {
      section.innerHTML = `
        <div class="jk-helper-workforce-unavailable">
          <strong>국민연금 인원 비교 데이터를 불러오지 못했습니다.</strong>
          <span>확장 프로그램 폴더의 workforce-data.js를 확인하세요.</span>
        </div>
      `;
      parent.appendChild(section);
      return;
    }

    const pastPeriod = normalizeText(WORKFORCE_DATA?.pastPeriod) || "2026-01";
    const currentPeriod = normalizeText(WORKFORCE_DATA?.currentPeriod) || "2026-06";
    const initialQuery = normalizeText(company.name);
    let prioritizeCompanyId = true;
    let candidates = rankWorkforceCandidates(initialQuery, company.id, prioritizeCompanyId);
    let selectedKey = (candidates.find((item) => item.exactId) || candidates[0])?.company.key || "";

    section.innerHTML = `
      <div class="jk-helper-workforce-summary">
        <header class="jk-helper-workforce-heading">
          <span>
            <strong>국민연금 인원 비교</strong>
            <small>${pastPeriod} → ${currentPeriod}</small>
          </span>
          <span class="jk-helper-workforce-heading-actions">
            <button type="button" class="jk-helper-workforce-help-button" aria-expanded="false" aria-label="국민연금 항목 도움말" title="국민연금 항목 도움말">?</button>
            <em>${WORKFORCE_COMPANIES.length.toLocaleString("ko-KR")}개 회사</em>
          </span>
        </header>
        <div class="jk-helper-workforce-help jk-helper-filter-hidden" role="note">
          <span>10인 이하 사업장은 나타나지 않을 수 있음</span>
          <span>증감은 26년 1월~6월 기준</span>
          <span>증가·탈퇴는 26년 6월 기준</span>
          <span>가입자수가 사원수는 아님</span>
        </div>
        <div class="jk-helper-workforce-selected-company">
          <strong class="jk-helper-workforce-selected-name"></strong>
          <span class="jk-helper-workforce-selected-meta"></span>
        </div>
        <div class="jk-helper-workforce-table-wrap">
          <table class="jk-helper-workforce-table">
            <tbody>
              <tr><th>과거 인원 <small>${pastPeriod}</small></th><td data-workforce-value="pastEmployees"></td></tr>
              <tr><th>현재 인원 <small>${currentPeriod}</small></th><td data-workforce-value="currentEmployees"></td></tr>
              <tr><th>총인원 증감</th><td data-workforce-value="employeeDelta"></td></tr>
              <tr><th>신규 가입자 <small>${currentPeriod}</small></th><td data-workforce-value="latestJoiners"></td></tr>
              <tr><th>탈퇴자 <small>${currentPeriod}</small></th><td data-workforce-value="latestLeavers"></td></tr>
            </tbody>
          </table>
        </div>
        <div class="jk-helper-workforce-net-row">
          <span>${currentPeriod} 신규−탈퇴</span>
          <strong class="jk-helper-workforce-net-value"></strong>
        </div>
      </div>
      <div class="jk-helper-workforce-matches">
        <header class="jk-helper-workforce-match-heading">
          <strong>검색 대상과 유사한 회사 5개</strong>
          <span>선택하면 위 표가 바뀝니다.</span>
        </header>
        <label class="jk-helper-workforce-search">
          <span>회사명 검색</span>
          <input type="search" autocomplete="off" spellcheck="false" aria-label="국민연금 비교 회사명 검색">
        </label>
        <div class="jk-helper-workforce-candidates" role="listbox" aria-label="유사 회사 후보"></div>
        <p class="jk-helper-workforce-footnote">자료생성월 기준 국민연금 가입자 수이며 실제 재직자 전원과 다를 수 있습니다.</p>
      </div>
    `;

    const selectedName = section.querySelector(".jk-helper-workforce-selected-name");
    const selectedMeta = section.querySelector(".jk-helper-workforce-selected-meta");
    const netValue = section.querySelector(".jk-helper-workforce-net-value");
    const helpButton = section.querySelector(".jk-helper-workforce-help-button");
    const help = section.querySelector(".jk-helper-workforce-help");
    helpButton?.addEventListener("click", () => {
      const expanded = helpButton.getAttribute("aria-expanded") === "true";
      helpButton.setAttribute("aria-expanded", String(!expanded));
      help?.classList.toggle("jk-helper-filter-hidden", expanded);
    });
    const searchInput = section.querySelector(".jk-helper-workforce-search input");
    const candidateList = section.querySelector(".jk-helper-workforce-candidates");
    searchInput.value = initialQuery;

    const applyTone = (element, value) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      element.classList.toggle("jk-helper-workforce-positive", value > 0);
      element.classList.toggle("jk-helper-workforce-negative", value < 0);
      element.classList.toggle("jk-helper-workforce-neutral", value === 0);
    };

    const renderSelected = () => {
      const selected = WORKFORCE_COMPANIES.find((item) => item.key === selectedKey) || candidates[0]?.company;
      if (!selected) {
        return;
      }
      selectedKey = selected.key;
      selectedName.textContent = selected.name;
      const selectedGameJobIds = workforceGameJobIds(selected);
      const exactCompanyCode = workforceHasGameJobId(selected, company.id);
      section.classList.toggle("jk-helper-workforce-code-warning", !exactCompanyCode);
      section.setAttribute(
        "aria-label",
        exactCompanyCode
          ? "국민연금 인원 비교 · 게임잡 기업 코드 일치"
          : "국민연금 인원 비교 · 경고: 게임잡 기업 코드 불일치"
      );
      selectedMeta.textContent = [
        selectedGameJobIds.length ? `게임잡 ID ${selectedGameJobIds.join(" · ")}` : "게임잡 ID 없음",
        exactCompanyCode ? "기업ID 일치" : "경고: 기업ID 불일치",
        `국민연금 사업장 ${Number(selected.workplaceCount || 0).toLocaleString("ko-KR")}개`
      ].filter(Boolean).join(" · ");

      for (const cell of section.querySelectorAll("[data-workforce-value]")) {
        const field = cell.getAttribute("data-workforce-value");
        const rawValue = selected[field];
        const available = rawValue !== null && rawValue !== undefined && rawValue !== "";
        const value = available ? Number(rawValue) : null;
        cell.textContent = !available
          ? "확인 불가"
          : field === "employeeDelta"
            ? signedWorkforceCount(value)
            : `${value.toLocaleString("ko-KR")}명`;
        if (field === "employeeDelta" && available) {
          applyTone(cell, value);
        } else {
          cell.classList.remove(
            "jk-helper-workforce-positive",
            "jk-helper-workforce-negative",
            "jk-helper-workforce-neutral"
          );
        }
      }

      const latestNet = Number(selected.latestJoiners || 0) - Number(selected.latestLeavers || 0);
      netValue.textContent = signedWorkforceCount(latestNet);
      applyTone(netValue, latestNet);

      const alertMessage = gameJobAlertText(selected, company.id, activePostingCount);
      const alertParent = document.getElementById("jk-helper-body");
      let alertLine = alertParent?.querySelector(".jk-helper-gamejob-alert") || null;
      if (!alertLine && alertMessage && alertParent) {
        alertLine = createAlertLine(alertMessage, "jk-helper-gamejob-alert");
        alertParent.prepend(alertLine);
      }
      if (alertLine) {
        alertLine.classList.toggle("jk-helper-filter-hidden", !alertMessage);
        const alertCopy = alertLine.querySelector("span");
        if (alertCopy) {
          alertCopy.textContent = alertMessage;
        }
      }
    };

    const renderCandidates = () => {
      candidateList.replaceChildren();
      for (const candidate of candidates) {
        const item = candidate.company;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "jk-helper-workforce-candidate";
        button.classList.toggle("jk-helper-workforce-candidate-selected", item.key === selectedKey);
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(item.key === selectedKey));

        const copy = document.createElement("span");
        copy.className = "jk-helper-workforce-candidate-copy";
        const name = document.createElement("strong");
        name.textContent = item.name;
        const meta = document.createElement("small");
        const itemGameJobIds = workforceGameJobIds(item);
        meta.textContent = [
          itemGameJobIds.length ? `ID ${itemGameJobIds.join(" · ")}` : "기업ID 없음",
          `현재 ${Number(item.currentEmployees || 0).toLocaleString("ko-KR")}명`
        ].join(" · ");
        copy.append(name, meta);

        const badge = document.createElement("em");
        badge.className = candidate.exactId
          ? "jk-helper-workforce-match-badge jk-helper-workforce-id-match"
          : "jk-helper-workforce-match-badge";
        badge.textContent = candidate.exactId
          ? "기업ID 일치"
          : `유사 ${Math.round(candidate.score * 100)}%`;
        button.append(copy, badge);
        button.addEventListener("click", () => {
          selectedKey = item.key;
          renderSelected();
          renderCandidates();
        });
        candidateList.appendChild(button);
      }
    };

    const refreshCandidates = () => {
      candidates = rankWorkforceCandidates(searchInput.value, company.id, prioritizeCompanyId);
      selectedKey = (prioritizeCompanyId
        ? candidates.find((item) => item.exactId)
        : null)?.company.key || candidates[0]?.company.key || "";
      renderSelected();
      renderCandidates();
    };

    searchInput.addEventListener("input", () => {
      prioritizeCompanyId = false;
      refreshCandidates();
    });

    renderSelected();
    renderCandidates();
    parent.appendChild(section);
  }

  function renderResults(
    profileInfo,
    items,
    profileError,
    historyError,
    localEmployeeRecord,
    employeeStorageError,
    localRecruitRecord,
    recruitStorageError,
    localPostingCountRecord,
    postingCountStorageError,
    recruitSummary,
    overviewOnly = false
  ) {
    const body = document.getElementById("jk-helper-body");
    const recruitBody = document.getElementById("jk-helper-recruit-body");
    const badge = document.getElementById("jk-helper-launcher-badge");
    if (!body || !recruitBody) {
      return;
    }

    body.replaceChildren();
    recruitBody.replaceChildren();
    recruitBody.classList.toggle("jk-helper-gamejob-split", state.company?.site === SITE_GAMEJOB);
    const postingCounts = postingCountsFromRecruitView(items, [], recruitSummary);
    if (state.company?.site === SITE_GAMEJOB) {
      const initialCandidate = rankWorkforceCandidates(
        normalizeText(state.company.name),
        state.company.id,
        true
      )[0]?.company;
      const alert = createAlertLine(
        gameJobAlertText(initialCandidate, state.company.id, postingCounts.active),
        "jk-helper-gamejob-alert"
      );
      if (alert) {
        body.appendChild(alert);
      }
    }
    appendHistorySection(
      body,
      recruitBody,
      profileInfo?.officialHistory || null,
      extractEmployeeCount(profileInfo),
      items,
      historyError,
      localRecruitRecord,
      recruitStorageError,
      recruitSummary,
      localPostingCountRecord,
      postingCountStorageError,
      overviewOnly
    );
    appendWorkforceSection(recruitBody, state.company, postingCounts.active);
    appendEmployeeSection(body, profileInfo, profileError, localEmployeeRecord, employeeStorageError);
    applySimpleMode();

    if (badge) {
      badge.textContent = overviewOnly ? "요약 확인됨 · 클릭해 전체" : "상세 확인됨";
    }
  }

  async function loadCompanyOverview() {
    if (
      state.disabledForPage ||
      !state.company ||
      state.loaded ||
      state.loading ||
      state.overviewLoading ||
      state.overviewLoaded
    ) {
      return;
    }

    const generation = state.loadGeneration;
    const company = { ...state.company };
    state.overviewLoading = true;
    setLoading("기업 상세정보를 1회 확인하는 중...");

    try {
      const page = await fetchHtml(
        company.site === SITE_GAMEJOB ? company.historyUrl : company.profileUrl
      );
      assertLoadGeneration(generation);
      const profileInfo = extractProfileInfo(page.doc, company.name);
      let items = [];
      let recruitSummary = null;
      if (company.site === SITE_GAMEJOB) {
        profileInfo.employeeTrend = [];
        profileInfo.officialHistory = null;
        items = extractRecruitItems(page.doc, page.finalUrl);
        recruitSummary = extractRecruitSummary(page.doc, SITE_GAMEJOB);
      }

      const [employeeStorageResult, recruitStorageResult, postingCountStorageResult] = await Promise.allSettled([
        readEmployeeRecord(company),
        readRecruitRecord(company),
        company.site === SITE_GAMEJOB ? readPostingCountRecord(company) : Promise.resolve(null)
      ]);
      assertLoadGeneration(generation);

      state.overviewPage = page;
      state.overviewLoaded = true;
      state.items = items;
      state.recruitSummary = recruitSummary;
      state.profileUrl = company.site === SITE_JOBKOREA ? page.finalUrl : company.profileUrl;
      state.historyUrl = company.historyUrl;
      syncLoadModeUi();

      const historyLink = document.getElementById("jk-helper-header-history-link");
      if (historyLink) {
        historyLink.href = state.profileUrl;
      }

      renderResults(
        profileInfo,
        items,
        null,
        null,
        employeeStorageResult.status === "fulfilled" ? employeeStorageResult.value : null,
        employeeStorageResult.status === "rejected" ? employeeStorageResult.reason : null,
        recruitStorageResult.status === "fulfilled" ? recruitStorageResult.value : null,
        recruitStorageResult.status === "rejected" ? recruitStorageResult.reason : null,
        postingCountStorageResult.status === "fulfilled" ? postingCountStorageResult.value : null,
        postingCountStorageResult.status === "rejected" ? postingCountStorageResult.reason : null,
        recruitSummary,
        true
      );
    } catch (error) {
      if (error?.name === "HayoungStaleLoad") {
        return;
      }
      showLoadError(error);
      console.error("[Hayoung] overview load failed", error);
    } finally {
      if (generation === state.loadGeneration) {
        state.overviewLoading = false;
        if (
          !state.disabledForPage &&
          !state.loaded &&
          (state.loadMode === LOAD_MODE_PRELOAD || state.loadRequestedThisPage)
        ) {
          void loadCompanyData();
        }
      }
    }
  }

  async function loadCompanyData() {
    if (state.disabledForPage || !state.company || state.loading || state.overviewLoading) {
      return;
    }

    const generation = state.loadGeneration;
    const company = { ...state.company };
    state.loading = true;
    setLoading("기업 상세정보와 채용 공고를 불러오는 중...");

    try {
      let profileResult;
      let historyResult;
      if (company.site === SITE_GAMEJOB) {
        const [combinedResult] = await Promise.allSettled([
          loadHistoryPages(company.historyUrl, generation, state.overviewPage)
        ]);
        assertLoadGeneration(generation);
        historyResult = combinedResult;
        profileResult = combinedResult.status === "fulfilled"
          ? {
            status: "fulfilled",
            value: {
              doc: combinedResult.value.firstDoc,
              finalUrl: combinedResult.value.finalUrl
            }
          }
          : { status: "rejected", reason: combinedResult.reason };
      } else {
        [profileResult, historyResult] = await Promise.allSettled([
          state.overviewPage ? Promise.resolve(state.overviewPage) : fetchHtml(company.profileUrl),
          loadHistoryPages(company.historyUrl, generation)
        ]);
        assertLoadGeneration(generation);
      }

      const profileInfo = profileResult.status === "fulfilled"
        ? extractProfileInfo(profileResult.value.doc, company.name)
        : { name: company.name, fields: [], employeeTrend: [], officialHistory: null };
      if (company.site === SITE_GAMEJOB) {
        profileInfo.employeeTrend = [];
        profileInfo.officialHistory = null;
      }
      const profileError = profileResult.status === "rejected" ? profileResult.reason : null;

      const historyData = historyResult.status === "fulfilled"
        ? historyResult.value
        : { items: [], finalUrl: company.historyUrl, recruitSummary: null };
      const historyError = historyResult.status === "rejected" ? historyResult.reason : null;

      const [employeeStorageResult, recruitStorageResult, postingCountStorageResult] = await Promise.allSettled([
        readEmployeeRecord(company),
        readRecruitRecord(company),
        company.site === SITE_GAMEJOB ? readPostingCountRecord(company) : Promise.resolve(null)
      ]);
      assertLoadGeneration(generation);
      const localEmployeeRecord = employeeStorageResult.status === "fulfilled"
        ? employeeStorageResult.value
        : null;
      const employeeStorageError = employeeStorageResult.status === "rejected"
        ? employeeStorageResult.reason
        : null;
      const localRecruitRecord = recruitStorageResult.status === "fulfilled"
        ? recruitStorageResult.value
        : null;
      const recruitStorageError = recruitStorageResult.status === "rejected"
        ? recruitStorageResult.reason
        : null;
      const localPostingCountRecord = postingCountStorageResult.status === "fulfilled"
        ? postingCountStorageResult.value
        : null;
      const postingCountStorageError = postingCountStorageResult.status === "rejected"
        ? postingCountStorageResult.reason
        : null;

      state.items = historyData.items;
      state.recruitSummary = historyData.recruitSummary || null;
      state.profileUrl = profileResult.status === "fulfilled"
        ? profileResult.value.finalUrl
        : company.profileUrl;
      state.historyUrl = historyData.finalUrl;
      state.loaded = true;
      state.overviewLoaded = true;
      syncLoadModeUi();

      const historyLink = document.getElementById("jk-helper-header-history-link");
      if (historyLink) {
        historyLink.href = state.profileUrl;
      }
      refreshApplicantCountUi();

      renderResults(
        profileInfo,
        state.items,
        profileError,
        historyError,
        localEmployeeRecord,
        employeeStorageError,
        localRecruitRecord,
        recruitStorageError,
        localPostingCountRecord,
        postingCountStorageError,
        state.recruitSummary
      );
      console.log("[Hayoung] loaded", {
        company,
        employeeCount: extractEmployeeCount(profileInfo),
        employeeTrendCount: profileInfo.employeeTrend.length,
        officialHistory: profileInfo.officialHistory,
        hasLocalEmployeeCount: Boolean(localEmployeeRecord),
        savedRecruitCount: normalizeRecruitArchive(localRecruitRecord).length,
        recruitSnapshotCount: normalizeRecruitSnapshots(localRecruitRecord).length,
        postingCountSnapshotCount: company.site === SITE_GAMEJOB
          ? normalizePostingCountSnapshots(localPostingCountRecord).length
          : 0,
        historyCount: state.items.length
      });
    } catch (error) {
      if (error?.name === "HayoungStaleLoad") {
        return;
      }
      showLoadError(error);
      console.error("[Hayoung] load failed", error);
    } finally {
      if (generation === state.loadGeneration) {
        state.loading = false;
      }
    }
  }

  async function refresh() {
    if (state.disabledForPage) {
      return;
    }
    state.loadGeneration += 1;
    state.loading = false;
    state.overviewLoading = false;
    state.overviewLoaded = false;
    state.overviewPage = null;
    state.loadRequestedThisPage = true;
    state.loaded = false;
    state.items = [];
    state.recruitSummary = null;
    const nextCompany = findCompany();
    if (nextCompany) {
      state.company = nextCompany;
      updateCompanyUi(nextCompany);
      await loadCompanyData();
    } else {
      state.company = null;
      showDetectionError();
    }
  }

  function detectAndApplyCompany() {
    if (state.disabledForPage) {
      return false;
    }
    if (!documentMatchesCurrentPosting()) {
      return false;
    }
    const company = findCompany();
    if (!company) {
      return false;
    }

    state.company = company;
    state.profileUrl = company.profileUrl;
    state.historyUrl = company.historyUrl;
    updateCompanyUi(company);
    detectionObserver?.disconnect();
    detectionObserver = null;
    clearTimeout(detectionTimer);
    console.log("[Hayoung] company detected", company);

    if ((state.loadMode === LOAD_MODE_PRELOAD || state.loadRequestedThisPage) && !state.loaded) {
      void loadCompanyData();
    } else if (
      state.loadMode === LOAD_MODE_CLICK &&
      !state.loaded &&
      document.getElementById(PANEL_ID)?.classList.contains("jk-helper-open")
    ) {
      void loadCompanyOverview();
    }

    return true;
  }

  function startDetection() {
    if (state.disabledForPage) {
      return;
    }
    detectionObserver?.disconnect();
    detectionObserver = null;
    clearTimeout(detectionTimer);
    detectionTimer = null;

    if (detectAndApplyCompany()) {
      return;
    }

    let scheduled = false;
    detectionObserver = new MutationObserver(() => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        detectAndApplyCompany();
      }, 250);
    });

    detectionObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    detectionTimer = setTimeout(() => {
      detectionObserver?.disconnect();
      detectionObserver = null;
      if (!state.company) {
        showDetectionError();
        console.warn("[Hayoung] company link not found", location.href);
      }
    }, 20000);
  }

  function handlePostingChange(nextPostingKey) {
    const shouldReload = state.loadMode === LOAD_MODE_PRELOAD ||
      state.loadRequestedThisPage ||
      state.loaded ||
      state.loading;

    state.loadGeneration += 1;
    state.postingKey = nextPostingKey;
    state.company = null;
    state.loaded = false;
    state.loading = false;
    state.overviewLoaded = false;
    state.overviewLoading = false;
    state.overviewPage = null;
    state.loadRequestedThisPage = shouldReload;
    state.profileUrl = null;
    state.historyUrl = null;
    state.items = [];
    state.recruitSummary = null;
    clearTimeout(applicantCountTimer);
    applicantCountTimer = null;
    const historyLink = document.getElementById("jk-helper-header-history-link");
    if (historyLink) {
      historyLink.removeAttribute("href");
      historyLink.textContent = "기업 상세 ↗";
      historyLink.setAttribute("aria-disabled", "true");
    }
    refreshApplicantCountUi();
    detectionObserver?.disconnect();
    detectionObserver = null;
    clearTimeout(detectionTimer);
    detectionTimer = null;
    if (state.uiLayout.panelOpen) {
      openPanel(false);
    }

    if (shouldReload) {
      setLoading("새 공고로 이동했습니다. 회사 정보를 갱신하는 중...");
    } else {
      setLoading("새 공고의 기업 상세정보를 1회 확인하는 중...");
    }

    setTimeout(() => {
      if (state.postingKey === nextPostingKey) {
        startDetection();
      }
    }, 300);
  }

  function startRouteWatcher() {
    if (state.disabledForPage) {
      return;
    }
    state.postingKey = currentPostingKey();
    clearInterval(routeWatcherTimer);
    routeWatcherTimer = setInterval(() => {
      const nextPostingKey = currentPostingKey();
      if (nextPostingKey && nextPostingKey !== state.postingKey) {
        handlePostingChange(nextPostingKey);
      }
    }, 400);
  }

  async function initialize() {
    mountUi();
    [state.loadMode, state.simpleMode, state.fontScale] = await Promise.all([
      readLoadMode(),
      readSimpleMode(),
      readFontScale()
    ]);
    if (state.disabledForPage) {
      return;
    }
    syncLoadModeUi();
    syncSimpleModeUi();
    syncFontScaleUi();
    await restoreUiLayout();
    void checkForUpdates();
    startRouteWatcher();
    startDetection();
  }

  void initialize();
})();
