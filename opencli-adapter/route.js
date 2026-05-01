import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

cli({
  site: 'ilovefood',
  name: 'route',
  description: 'Google Maps 路線網址解析 (獲取起終點座標)',
  domain: 'ilovefood.imstevelin.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'url', type: 'string', positional: true, required: true, help: 'Google Maps 路線網址' },
  ],
  columns: ['type', 'lat', 'lng'],
  func: async (_page, args) => {
    const { url } = args;
    
    // Web app 專用的代理伺服器 URL，用來解析短網址
    const workerUrl = `https://ilovefood.imstevelin.workers.dev/?url=${encodeURIComponent(url)}`;
    
    try {
        const resp = await fetch(workerUrl);
        const data = await resp.json();
        
        if (data.error) {
            throw new CliError('API_ERROR', '路線解析錯誤: ' + data.error);
        }
        
        let html = data.html || '';
        const regex = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g;
        let match;
        const coords = [];
        while ((match = regex.exec(html)) !== null) {
          coords.push({ lat: parseFloat(match[1]), lng: parseFloat(match[2]) });
        }
        
        if (coords.length < 2) {
          throw new CliError('NO_DATA', '無法從該網址解析出路線座標');
        }
        
        return [
          { type: 'origin', lat: coords[0].lat, lng: coords[0].lng },
          { type: 'destination', lat: coords[coords.length - 1].lat, lng: coords[coords.length - 1].lng }
        ];
    } catch (e) {
        throw new CliError('API_ERROR', '無法連接到路線解析代理：' + e.message);
    }
  }
});
