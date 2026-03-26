export default {
  async fetch(request, env, ctx) {
    // 檢查 HTTP 方法，如果是 OPTIONS (CORS 預檢)，直接回傳允許
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response("Missing 'url' query parameter", { status: 400 });
    }

    try {
      // 偽裝成普通瀏覽器，避免被 Google 當成機器人
      const mapRequest = new Request(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        // manual 代表不要自動跟隨重導向，我們自己攔截 301/302 的 Location
        redirect: "manual" 
      });

      const mapResponse = await fetch(mapRequest);
      
      let finalUrl = targetUrl;
      let htmlBody = "";

      // 如果 Google 給了 301/302 轉址，直接抓取 Location 網址 (通常就是展開後的長網址)
      if ([301, 302, 303, 307, 308].includes(mapResponse.status)) {
        finalUrl = mapResponse.headers.get("Location") || targetUrl;
      } else {
        // 如果 Google 給了 200，那就是一個網頁，我們抓取整裝 HTML 回去讓前端用 RegExp 自己解析
        htmlBody = await mapResponse.text();
      }

      // 回傳結果給我們的前端
      const responseData = {
        originalUrl: targetUrl,
        resolvedUrl: finalUrl,
        html: htmlBody // 如果 finalUrl 沒有答案，前端就在這個 html 裡找 !3d
      };

      return new Response(JSON.stringify(responseData), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*", // 允許您的網站呼叫
        }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        }
      });
    }
  }
};
