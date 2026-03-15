# SEO 實踐指南 (SEO Implementation Guide)

本文件描述了 iLoveFood 專案目前的 SEO 最佳實踐及實作細節。

## 🌐 核心概念與實作

作為一個以 Angular 開發的單頁應用程式 (SPA)，我們需要確保搜尋引擎能有效解析並索引網站的內容：

1.  **動態 Meta 標籤注入**
    *   在 `src/app/services/seo.service.ts` 中，我們提供了動態設定網頁標題 (`<title>`) 與 Meta 標籤的功能。
    *   在建立不同的路由或卡片頁面時，動態更新 `description`, `keywords`, `og:title`, `og:description`, `og:image` 等標籤，以提升在社群媒體分享時的呈現效果與搜尋引擎的理解。

2.  **語意化 HTML 架構**
    *   在組件模板中 (如 `new-search.component.html`)，應謹慎使用 `<h1>`, `<h2>` 等標籤。
    *   確保頁面結構層次分明，讓爬蟲能輕易分辨頁面的主題與重點。

3.  **效能與載入體驗 (Core Web Vitals)**
    *   移除不必要的套件以縮小打包體積。
    *   使用延遲載入 (Lazy Loading) 機制來載入非首頁必要的模組或圖片，提升 LCP (Largest Contentful Paint) 表現。
    *   確保所有圖片都加上了正確的 `alt` 屬性。

## 🚦 接下來的 SEO 優化項目

*   **建立 Sitemap.xml**: 為網站生成動態或靜態的 `sitemap.xml`，並提交至 Google Search Console。
*   **robots.txt**: 確保有正確的 `robots.txt` 檔案，指引爬蟲哪些頁面可以抓取，哪些不需要。
*   **Angular Universal (SSR) 或預渲染 (Prerendering)**: 如果專案需要更高的 SEO 權重，未來可考慮引入 Server-Side Rendering，這對於需要被搜尋引擎深度索引的 SPA 是關鍵技術。目前專案純依賴於 Googlebot 解析 JavaScript。
*   **結構化資料 (Structured Data)**: 針對超商、商品折價資訊，可以加入 JSON-LD 格式的結構化資料，讓搜尋結果出現更豐富的卡片版位 (Rich Snippets)。