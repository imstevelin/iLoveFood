const Fuse = require('fuse.js');
const list = [{ name: '晶英滷肉刈包' }];
const fuse = new Fuse(list, { includeScore: true, threshold: 0.3, keys: ['name'] });
console.log('Threshold 0.3:', fuse.search('(韓)晶英滷肉刈包'));
const fuse2 = new Fuse(list, { includeScore: true, threshold: 0.5, keys: ['name'] });
console.log('Threshold 0.5:', fuse2.search('(韓)晶英滷肉刈包'));
