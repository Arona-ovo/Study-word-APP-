// 临时校验：pages.json（HBuilderX 会写 JSON5 注释，先剥注释再 parse）
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'uniapp', 'pages.json')
const raw = fs.readFileSync(file, 'utf8')
const cleaned = raw
  .split('\n')
  .map(line => line.replace(/\/\/.*$/, ''))
  .join('\n')
try {
  const o = JSON.parse(cleaned)
  console.log('pages.json OK  pages=' + o.pages.length)
  console.log('globalStyle   =', JSON.stringify(o.globalStyle))
  const bad = []
  o.pages.forEach(p => {
    if (!fs.existsSync(path.join(__dirname, '..', 'uniapp', p.path + '.vue'))) bad.push(p.path)
  })
  console.log('missing files =', bad.length ? bad.join(', ') : 'none')
} catch (e) {
  console.log('pages.json FAIL:', e.message)
  process.exitCode = 1
}
