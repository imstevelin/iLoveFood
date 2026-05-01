import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');

cli({
  site: 'ilovefood',
  name: 'search',
  description: '搜尋超商商品資料庫 (全家 & 7-11)',
  domain: 'ilovefood.imstevelin.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'keyword', type: 'string', positional: true, required: true, help: '搜尋關鍵字' },
    { name: 'brand', type: 'string', default: 'all', help: '品牌: all / 711 / fm' },
    { name: 'limit', type: 'int', default: 20, help: '返回數量' },
  ],
  columns: ['brand', 'category', 'name', 'price', 'description'],
  func: async (_page, args) => {
    const keyword = args.keyword.toLowerCase();
    const brand = args.brand.toLowerCase();
    const limit = args.limit || 20;

    const results = [];

    const loadProducts = (filePath, brandName) => {
      if (!fs.existsSync(filePath)) return [];
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const products = Array.isArray(data) ? data : (data.element || []);
        return products.map(p => {
          const rawPrice = p.Price || p.price || 0;
          return {
            brand: brandName,
            category: p.category || p.CategoryName || '一般',
            name: p.name || p.ItemName || p.title || '',
            price: (rawPrice && rawPrice != 0) ? rawPrice : "未標示",
            description: p.Content || p.description || p.Description || '',
          };
        });
      } catch (e) {
        return [];
      }
    };

    if (brand === 'all' || brand === '711') {
      const p711 = loadProducts(path.join(DATA_DIR, 'seven_eleven_products.json'), '7-11');
      results.push(...p711);
    }

    if (brand === 'all' || brand === 'fm') {
      const pfm = loadProducts(path.join(DATA_DIR, 'family_mart_products.json'), 'FamilyMart');
      results.push(...pfm);
    }

    const filtered = results.filter(p => 
      p.name.toLowerCase().includes(keyword) || 
      p.category.toLowerCase().includes(keyword) ||
      p.description.toLowerCase().includes(keyword)
    );

    if (filtered.length === 0) {
      throw new CliError('NO_DATA', `找不到包含 "${keyword}" 的商品`);
    }

    return filtered.slice(0, limit);
  },
});
