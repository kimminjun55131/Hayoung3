"use strict";

const REQUEST_TIMEOUT_MS = 20000;
const VERSION_MANIFEST_URL = "https://raw.githubusercontent.com/kimminjun55131/Hayoung3/main/Hayoung/manifest.json";
const UPDATE_URL = "https://github.com/kimminjun55131/Hayoung3/releases/latest";

function supportedSiteName(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }
    if (url.hostname === "jobkorea.co.kr" || url.hostname.endsWith(".jobkorea.co.kr")) {
      return "잡코리아";
    }
    if (url.hostname === "gamejob.co.kr" || url.hostname.endsWith(".gamejob.co.kr")) {
      return "게임잡";
    }
    return null;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === "HY_CHECK_VERSION") {
    (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(VERSION_MANIFEST_URL, {
          method: "GET",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          headers: { Accept: "application/json" }
        });
        if (!response.ok) {
          throw new Error(`GitHub 버전 확인 오류: HTTP ${response.status}`);
        }
        const manifest = await response.json();
        if (!/^\d+(?:\.\d+){1,3}$/.test(manifest?.version || "")) {
          throw new Error("GitHub manifest.json의 버전 형식이 올바르지 않습니다.");
        }
        sendResponse({
          ok: true,
          version: manifest.version,
          versionName: String(manifest.version_name || manifest.version),
          updateUrl: UPDATE_URL
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error?.name === "AbortError"
            ? "GitHub 버전 확인 시간이 20초를 초과했습니다."
            : (error?.message || String(error))
        });
      } finally {
        clearTimeout(timer);
      }
    })();
    return true;
  }

  if (message.type !== "HY_FETCH_HTML") {
    return false;
  }

  const siteName = supportedSiteName(message.url);
  if (!siteName) {
    sendResponse({ ok: false, error: "허용되지 않은 채용 사이트 URL입니다." });
    return false;
  }

  let requestMethod = "GET";
  let requestBody;
  if (message.method === "POST") {
    let requestUrl;
    try {
      requestUrl = new URL(message.url);
    } catch {
      sendResponse({ ok: false, error: "요청 URL 형식이 올바르지 않습니다." });
      return false;
    }
    const form = message.form && typeof message.form === "object" ? message.form : {};
    const companyId = String(form.M || "");
    const pageNumber = Number(form.Rpage);
    const recruitType = String(form.Recruit_Type ?? "0");
    if (
      siteName !== "게임잡" ||
      requestUrl.pathname !== "/Company/Company_Recruit" ||
      !/^\d{1,20}$/.test(companyId) ||
      !/^[012]$/.test(recruitType) ||
      !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > 250
    ) {
      sendResponse({ ok: false, error: "허용되지 않은 게임잡 페이지 요청입니다." });
      return false;
    }
    requestMethod = "POST";
    requestBody = new URLSearchParams({
      tabcode: "",
      M: companyId,
      Rpage: String(pageNumber),
      Recruit_Type: recruitType
    }).toString();
  }

  (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(message.url, {
        method: requestMethod,
        body: requestBody,
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          ...(requestMethod === "POST" ? {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
          } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`${siteName} 응답 오류: HTTP ${response.status}`);
      }

      if (supportedSiteName(response.url || message.url) !== siteName) {
        throw new Error(`${siteName} 외부 주소로 이동되어 요청을 중단했습니다.`);
      }

      const html = await response.text();
      sendResponse({
        ok: true,
        html,
        finalUrl: response.url || message.url
      });
    } catch (error) {
      const messageText = error?.name === "AbortError"
        ? `${siteName} 응답 시간이 20초를 초과했습니다.`
        : (error?.message || String(error));

      console.error("[Hayoung] fetch failed", message.url, error);
      sendResponse({ ok: false, error: messageText });
    } finally {
      clearTimeout(timer);
    }
  })();

  return true;
});
